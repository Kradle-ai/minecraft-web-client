/* eslint-disable no-await-in-loop */

import { createServer, ServerClient } from 'minecraft-protocol'
import { ParsedReplayPacket, parseReplayContents } from 'mcraft-fun-mineflayer/build/packetsLogger'
import { PACKETS_REPLAY_FILE_EXTENSION, WORLD_STATE_FILE_EXTENSION } from 'mcraft-fun-mineflayer/build/worldState'
import MinecraftData from 'minecraft-data'
import { GameMode } from 'mineflayer'
import { LocalServer } from '../customServer'
import { UserError } from '../mineflayer/userError'
import { packetsReplayState } from '../react/state/packetsReplayState'
import { getFixedFilesize } from '../react/simpleUtils'

import { setLoadingScreenStatus } from '../appStatus'
import { appQueryParams } from '../appParams'
import { clearKradleverseChat, setSkipChatMessages } from '../react/ChatProvider'

export const VALID_REPLAY_EXTENSIONS = [
  PACKETS_REPLAY_FILE_EXTENSION,
  WORLD_STATE_FILE_EXTENSION,
]


const SUPPORTED_FORMAT_VERSION = 1

type ReplayDefinition = {
  minecraftVersion: string
  replayAgainst?: 'client' | 'server'
  serverIp?: string
}

interface OpenFileOptions {
  contents: string
  filename?: string
  filesize?: number
}

export function openFile ({ contents, filename = 'unnamed', filesize }: OpenFileOptions) {
  packetsReplayState.replayName = `${filename} (${getFixedFilesize(filesize ?? contents.length)})`
  packetsReplayState.isPlaying = false

  const connectOptions = {
    worldStateFileContents: contents,
    username: 'replay'
  }
  dispatchEvent(new CustomEvent('connect', { detail: connectOptions }))
}

/**
 * Open a pre-parsed replay (from gzipped msgpack)
 * @param packets - Pre-parsed packets array
 * @param header - Replay header with metadata
 * @param filename - The filename for display
 * @param filesize - The file size for display
 */
export async function openParsedReplay (
  packets: ParsedReplayPacket[],
  header: any,
  filename = 'unnamed',
  filesize?: number
) {
  console.log('openParsedReplay - received', packets.length, 'packets, version:', header.minecraftVersion)

  packetsReplayState.replayName = `${filename} (${getFixedFilesize(filesize ?? packets.length * 100)})`
  packetsReplayState.isPlaying = false

  const connectOptions = {
    worldStateFileContents: '',
    username: 'KradleWebViewer',
    mcprReplayData: { packets, header }
  }
  dispatchEvent(new CustomEvent('connect', { detail: connectOptions }))
}

// Overloads
export function startLocalReplayServer (packets: ParsedReplayPacket[], header: any): { server: any, version: string }
export function startLocalReplayServer (contents: string): { server: any, version: string }
export function startLocalReplayServer (contentsOrPackets: string | ParsedReplayPacket[], headerOrUndefined?: any): { server: any, version: string } {
  let packets: ParsedReplayPacket[]
  let header: any

  if (Array.isArray(contentsOrPackets)) {
    packets = contentsOrPackets
    header = headerOrUndefined
  } else {
    const parsed = parseReplayContents(contentsOrPackets)
    packets = parsed.packets
    header = parsed.header
  }

  console.log('startLocalReplayServer - version:', header.minecraftVersion, 'packets:', packets.length)

  packetsReplayState.packetsPlayback = []
  packetsReplayState.isOpen = true
  packetsReplayState.isPlaying = true
  packetsReplayState.progress = {
    current: 0,
    total: packets.filter(packet => packet.isFromServer).length
  }
  packetsReplayState.speed = 1

  // In live mode, start at 25 seconds (will fast-forward packets)
  if (appQueryParams.live) {
    packetsReplayState.seekTargetMs = 25_000
  }

  if (appQueryParams.timeMs) {
    const timeMs = parseInt(appQueryParams.timeMs, 10)
    if (!isNaN(timeMs) && timeMs >= 0) {
      packetsReplayState.seekTargetMs = timeMs
    }
  }

  if (!packetsReplayState.replayName || packetsReplayState.replayName === '') {
    const sizeEstimate = typeof contentsOrPackets === 'string' ? contentsOrPackets.length : packets.length * 100
    packetsReplayState.replayName = `local ${getFixedFilesize(sizeEstimate)}`
  }
  if (!packetsReplayState.replayName.startsWith(header.minecraftVersion)) {
    packetsReplayState.replayName = `${header.minecraftVersion} ${packetsReplayState.replayName}`
  }

  if ('formatVersion' in header && header.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    throw new UserError(`Unsupported format version: ${header.formatVersion}`)
  }
  if ('replayAgainst' in header && header.replayAgainst === 'server') {
    throw new Error('not supported')
  }

  const server = createServer({
    Server: LocalServer as any,
    version: header.minecraftVersion,
    'online-mode': false
  })

  const data = MinecraftData(header.minecraftVersion)
  const isMcprReplay = 'mcprMetadata' in header
  const eventToWaitFor = (data.supportFeature('hasConfigurationState') && !isMcprReplay) ? 'playerJoin' : 'login'

  console.log(`Replay server waiting for '${eventToWaitFor}' event`)

  server.on(eventToWaitFor as any, async client => {
    console.log(`Replay server received '${eventToWaitFor}' event`)
    await mainPacketsReplayer(client, packets, isMcprReplay, header)
  })

  return { server, version: header.minecraftVersion }
}

const FLATTEN_CLIENT_PACKETS = new Set([] as string[])

const positions = { client: 0, server: 0 }

const addPacketToReplayer = (name: string, data, isFromClient: boolean, wasUpcoming = false) => {
  const side = isFromClient ? 'client' : 'server'

  if (wasUpcoming) {
    const lastUpcoming = packetsReplayState.packetsPlayback.find(p => p.isUpcoming && p.name === name)
    if (lastUpcoming) {
      lastUpcoming.isUpcoming = false
    }
  } else {
    packetsReplayState.packetsPlayback.push({
      name,
      data,
      isFromClient,
      position: ++positions[side]!,
      isUpcoming: false,
      timestamp: Date.now()
    })
  }

  if (!isFromClient && !wasUpcoming) {
    packetsReplayState.progress.current++
  }
}

const IGNORE_SERVER_PACKETS = new Set([
  'kick_disconnect',
  'unload_chunk', // Don't unload chunks during replay - keeps world visible
  'respawn', // Don't process respawn - can reset world state
  'death_combat_event', // Don't show death screen during replay
  'position', // Don't update viewer's position from recorded player's position
  'synchronize_player_position', // Same as above (1.19+ packet name)
])
const ADDITIONAL_DELAY = 500

/**
 * Patch bot.world to handle missing chunks gracefully
 * In replay mode, chunks may not be loaded when various methods are called
 */
function patchWorldForReplay (bot: typeof window.bot) {
  if (!bot?.world) {
    console.warn('patchWorldForReplay: bot.world is undefined')
    return
  }

  const { world } = bot

  // Note: Don't manually set world.columns - it breaks the link to async.columns
  // WorldSync delegates to async.columns via getters

  // Track error counts to avoid spam
  const errorCounts: Record<string, number> = {}

  // Helper to safely wrap world methods
  const safePatch = (methodName: string, returnValue: any = null) => {
    const original = world[methodName]
    if (typeof original !== 'function') return

    world[methodName] = function (...args: any[]) {
      try {
        return original.apply(this, args)
      } catch (err: any) {
        // Log errors (limited to avoid spam)
        errorCounts[methodName] = (errorCounts[methodName] || 0) + 1
        if (errorCounts[methodName] <= 5) {
          console.warn(`world.${methodName} error (${errorCounts[methodName]}):`, err?.message, 'args:', args)
        }
        return returnValue
      }
    }
  }

  // Patch all methods that access columns
  safePatch('getBlock', null)
  safePatch('getBlockType', 0)
  safePatch('getBlockData', 0)
  safePatch('getBlockLight', 0)
  safePatch('getSkyLight', 15)
  safePatch('getBiome', 0)
  safePatch('getBlockStateId', 0)

  // Patch raycast separately (it's async)
  if (typeof world.raycast === 'function') {
    const originalRaycast = world.raycast.bind(world)
    world.raycast = async function (...args: any[]) {
      try {
        // eslint-disable-next-line @typescript-eslint/return-await
        return await originalRaycast(...args)
      } catch (err: any) {
        return null
      }
    }
  }

  console.log('World patched for replay mode')
}


const mainPacketsReplayer = async (
  client: ServerClient,
  packets: ParsedReplayPacket[],
  isMcprReplay: boolean,
  header?: any
) => {
  // For MCPR replays, collect player UUIDs from player_info packets
  // ServerReplay often spawns players as text_display entities instead of player entities
  const playerUuids = new Set<string>()
  if (isMcprReplay) {
    for (const packet of packets) {
      if (packet.name === 'player_info' && packet.params?.data) {
        for (const entry of packet.params.data) {
          if (entry.uuid) {
            playerUuids.add(entry.uuid)
          }
        }
      }
    }
    console.log('MCPR: Found', playerUuids.size, 'player UUIDs:', [...playerUuids])
  }

  // Get player entity type ID for this version
  let playerEntityTypeId = 122 // Default for 1.20.4
  try {
    const mcData = MinecraftData(header?.minecraftVersion || '1.20.4')
    playerEntityTypeId = mcData.entitiesByName?.player?.id ?? 122
    console.log('Player entity type ID:', playerEntityTypeId)
  } catch (e) {
    console.warn('Could not get player entity type ID, using default:', playerEntityTypeId)
  }

  // For MCPR replays, use a unique entity ID for "us" to avoid conflicts with player entities
  const MCPR_VIEWER_ENTITY_ID = 99_999

  // Fields that minecraft-protocol's chat.js expects to be BigInt
  // eslint-disable-next-line unicorn/prefer-set-has
  const BIGINT_REQUIRED_FIELDS = ['timestamp', 'salt']

  // Convert a [high, low] int64 array (from msgpack) to BigInt
  const int64ArrayToBigInt = (arr: any): bigint | null => {
    if (!Array.isArray(arr) || arr.length !== 2) return null
    const [high, low] = arr
    if (typeof high !== 'number' || typeof low !== 'number') return null
    // Combine high and low 32-bit parts into a 64-bit BigInt
    const highBigInt = BigInt(high) << 32n
    const lowBigInt = BigInt(low >>> 0) // >>> 0 converts to unsigned 32-bit
    return highBigInt | lowBigInt
  }

  // Process packet data:
  // 1. Convert most BigInt to Number/String to avoid "Cannot mix BigInt" errors
  // 2. But ensure timestamp/salt are BigInt (minecraft-protocol's chat.js expects these)
  // 3. Handle msgpack's [high, low] array format for 64-bit integers
  const processPacketData = (obj: any, key?: string): any => {
    if (obj === null || obj === undefined) return obj

    // For fields that minecraft-protocol expects as BigInt, ensure they are BigInt
    if (key && BIGINT_REQUIRED_FIELDS.includes(key)) {
      if (typeof obj === 'bigint') {
        return obj // Already BigInt
      }
      if (typeof obj === 'number' || typeof obj === 'string') {
        return BigInt(obj) // Convert to BigInt
      }
      // Handle msgpack's [high, low] array format for 64-bit integers
      if (Array.isArray(obj) && obj.length === 2) {
        const bigIntValue = int64ArrayToBigInt(obj)
        if (bigIntValue !== null) {
          return bigIntValue
        }
      }
    }

    if (typeof obj === 'bigint') {
      return obj >= Number.MIN_SAFE_INTEGER && obj <= Number.MAX_SAFE_INTEGER
        ? Number(obj)
        : obj.toString()
    }
    if (Buffer.isBuffer(obj) || ArrayBuffer.isView(obj)) return obj
    if (Array.isArray(obj)) return obj.map(item => processPacketData(item))
    if (typeof obj === 'object') {
      const result: any = {}
      for (const objKey of Object.keys(obj)) {
        result[objKey] = processPacketData(obj[objKey], objKey)
      }
      return result
    }
    return obj
  }

  const writePacket = (name: string, data: any) => {
    data = processPacketData(restoreData(data))

    // Debug: Log chat packets
    if (name.includes('chat')) {
      console.log('[writePacket] Writing chat packet:', name)
      console.log('[writePacket] timestamp:', typeof data?.timestamp, data?.timestamp)
      console.log('[writePacket] salt:', typeof data?.salt, data?.salt)
    }

    // Handle MCPR replay specific packet modifications
    if (isMcprReplay) {
      // Change login packet entity ID to avoid conflict with player entities
      // This allows other players (who may have the same entity ID) to be rendered
      if (name === 'login' && typeof data.entityId === 'number') {
        console.log('MCPR: Changing login entityId from', data.entityId, 'to', MCPR_VIEWER_ENTITY_ID)
        data = { ...data, entityId: MCPR_VIEWER_ENTITY_ID }
      }

      // Convert entities with player UUIDs to actual player entities
      if (name === 'spawn_entity' && data.objectUUID && playerUuids.has(data.objectUUID)) {
        console.log('Converting entity', data.entityId, 'to player (UUID:', data.objectUUID, ')')
        data = { ...data, type: playerEntityTypeId }
      }

      // Debug: log block_change packets
      if (name === 'block_change') {
        console.log('MCPR block_change:', data.location, 'type:', data.type)
      }
    }
    client.write(name, data)
  }

  // Wait for window.bot to be available
  console.log('Waiting for window.bot...')
  let { bot } = window
  let waitAttempts = 0
  while (!bot && waitAttempts < 200) {
    await new Promise(resolve => setTimeout(resolve, 25)) // eslint-disable-line no-promise-executor-return
    bot = window.bot
    waitAttempts++
  }

  if (!bot) {
    throw new Error(`Bot not available after ${waitAttempts * 25}ms`)
  }
  console.log('window.bot available after', waitAttempts * 25, 'ms')

  // Log packet state distribution
  // eslint-disable-next-line unicorn/no-array-reduce
  const stateDistribution = packets.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1
    return acc
  }, {} as Record<string, number>) // eslint-disable-line @typescript-eslint/prefer-reduce-type-parameter
  console.log('Packet state distribution:', stateDistribution)

  // For MCPR replays, process configuration packets to set up registries
  if (isMcprReplay) {
    const configPackets = packets.filter(p => p.state === 'configuration')
    console.log('Configuration packets:', configPackets.length)

    // Find and log registry_data packets
    const registryPackets = configPackets.filter(p => p.name === 'registry_data')
    console.log('registry_data packets:', registryPackets.length)

    // Process registry_data packets to populate dimension registry
    for (const packet of registryPackets) {
      if (packet.params) {
        console.log('Processing registry_data packet:', Object.keys(packet.params))
        try {
          // Emit the registry_data packet to populate bot.registry
          bot._client.emit('registry_data', packet.params)
        } catch (e) {
          console.warn('Error processing registry_data:', e)
        }
      }
    }

    // Check if dimension registry was populated
    console.log('Dimension registry after config packets:', Object.keys(bot.registry?.dimensionsByName || {}))
  }

  // Filter to play-state packets only
  const playPackets = packets.filter(p => p.state === 'play')
  console.log('Play packets:', playPackets.length, 'of', packets.length)

  // Find login packet index
  const loginPacketIndex = playPackets.findIndex(p => p.name === 'login')
  const hasLoginPacket = loginPacketIndex !== -1
  console.log('Login packet at index:', loginPacketIndex)

  // Set up error handling
  let lastSentPacket: { name: string, params: any } | null = null

  const playServerPacket = (name: string, params: any) => {
    // Skip packets that would disrupt replay (chunk unloads, disconnects, etc.)
    if (IGNORE_SERVER_PACKETS.has(name)) {
      return
    }

    try {
      writePacket(name, params)
      // Skip packet logging for MCPR replays to prevent memory leak
      // (700+ packets/sec would fill memory quickly)
      if (!isMcprReplay) {
        addPacketToReplayer(name, params, false)
      }
      lastSentPacket = { name, params }
    } catch (err: any) {
      // Silently ignore getBlock errors - chunks not loaded yet
      if (!err?.message?.includes('getBlock')) {
        console.warn('Packet error:', name, err?.message)
      }
    }
  }

  // Initialize bot.world for MCPR replay
  if (isMcprReplay) {
    console.log('Setting up world for MCPR replay')

    if (bot.registry && !bot.registry.dimensionsByName) {
      bot.registry.dimensionsByName = {}
    }

    // For Minecraft 1.18+, set correct world dimensions BEFORE creating the world
    // This is critical for block_change packets to work correctly
    const versionStr = header?.minecraftVersion || bot.version || '1.20.4'
    const majorMinor = versionStr.split('.').slice(0, 2).map(Number)
    const is118Plus = majorMinor[0] >= 1 && majorMinor[1] >= 18
    console.log('Version check:', versionStr, 'majorMinor:', majorMinor, 'is118Plus:', is118Plus)
    if (is118Plus) {
      // 1.18+ uses minY=-64, height=384
      if (!bot.game) {
        bot.game = {} as any
      }
      bot.game.minY = -64
      bot.game.height = 384
      console.log('Set 1.18+ world dimensions: minY=-64, height=384')
    }

    if (!bot.world) {
      console.log('Creating new bot.world for version:', bot.version)
      try {
        const World = require('prismarine-world')(bot.version)
        // IMPORTANT: Must use .sync to get the sync world interface that blocks.js expects
        bot.world = new World(null, bot.storageBuilder?.(bot.version, bot.worldFolder)).sync
        console.log('bot.world created successfully (sync interface)')

        // CRITICAL: Set up event forwarding from bot.world to bot
        // Mineflayer's blocks plugin normally does this, but since we created a new world,
        // the forwarding was set up on the old world. We need to do it again.
        const forwardedEvents = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload']
        for (const event of forwardedEvents) {
          bot.world.on(event, (...args: any[]) => bot.emit(event as any, ...args))
        }
        console.log('Set up event forwarding from bot.world to bot')
      } catch (err) {
        console.error('Failed to create bot.world:', err)
      }
    }

    // WorldSync creates its own empty columns object, but we need it to use async.columns
    // where the actual chunk data is stored by blocks.js
    if (bot.world?.async?.columns) {
      bot.world.columns = bot.world.async.columns
      console.log('Linked bot.world.columns to async.columns')
    }
    console.log('World setup complete - bot.world:', !!bot.world, 'columns:', Object.keys(bot.world?.columns || {}).length)

    // Load chunks from region files if provided
    // TODO: Temporarily disabled - chunks from region files don't have all required methods
    // (getProperties, setBlockEntity) and conflict with map_chunk packets
    const worldRegionPaths = header?.worldRegionPaths as string[] | undefined
    if (worldRegionPaths?.length && bot.world) {
      console.log('Region files available:', worldRegionPaths.length, '- chunk pre-loading disabled for now')
      // try {
      //   const chunksLoaded = await loadChunksFromRegionFiles(
      //     worldRegionPaths,
      //     bot.world,
      //     bot.version,
      //     (msg) => console.log(msg)
      //   )
      //   console.log('Loaded', chunksLoaded, 'chunks from region files')
      // } catch (err) {
      //   console.error('Failed to load chunks from region files:', err)
      // }
    }
  }

  // Patch world methods to handle missing chunks gracefully
  patchWorldForReplay(bot)
  console.log('After patch - bot.world:', !!bot.world)

  // Send login packet if present to initialize game state
  let startPacketIndex = 0
  if (hasLoginPacket) {
    const loginPacket = playPackets[loginPacketIndex]
    if (loginPacket?.params) {
      console.log('Sending login packet')
      console.log('bot.game BEFORE login:', { minY: bot.game?.minY, height: bot.game?.height })
      try {
        writePacket(loginPacket.name, loginPacket.params)
      } catch (err) {
        console.warn('Login packet error (expected):', err)
      }
      // Small delay to let login packet process synchronously
      await new Promise(resolve => setTimeout(resolve, 1)) // eslint-disable-line no-promise-executor-return
      console.log('bot.game AFTER login (1ms):', { minY: bot.game?.minY, height: bot.game?.height, dimension: bot.game?.dimension })

      // Check if dimension registry has data
      const dimData = bot.registry?.dimensionsByName?.[bot.game?.dimension]
      console.log('Dimension registry lookup for', bot.game?.dimension, ':', dimData ? { minY: dimData.minY, height: dimData.height } : 'NOT FOUND')

      // Re-set world dimensions AFTER login packet (login packet may reset bot.game)
      if (isMcprReplay) {
        const versionStr = header?.minecraftVersion || bot.version || '1.20.4'
        const majorMinor = versionStr.split('.').slice(0, 2).map(Number)
        if (majorMinor[0] >= 1 && majorMinor[1] >= 18 && bot.game) {
          // Force correct dimensions for 1.18+
          bot.game.minY = -64
          bot.game.height = 384
          console.log('Forced 1.18+ world dimensions: minY=-64, height=384')
        }
      }
    }
    startPacketIndex = loginPacketIndex + 1
  }

  // Create bot.entity if needed
  if (!bot.entity) {
    console.log('Creating bot.entity')
    const Entity = require('prismarine-entity')(bot.version)
    const loginPacket = hasLoginPacket ? playPackets[loginPacketIndex] : null
    const entityId = loginPacket?.params?.entityId ?? 0
    bot.entity = new Entity(entityId)
    bot.entity.username = bot.username
    bot.entity.type = 'player'
  }

  // Ensure entity has a valid position (required for viewer raycasting and camera)
  // Note: Entity constructor sets position to Vec3(0,0,0) by default, so we need to check
  // if it's at the origin AND find a better position from packets
  const isAtDefaultOrigin = bot.entity.position &&
    bot.entity.position.x === 0 &&
    bot.entity.position.y === 0 &&
    bot.entity.position.z === 0
  if (!bot.entity.position || isAtDefaultOrigin) {
    const { Vec3 } = require('vec3')
    // Find first position packet to get initial position
    const positionPacket = playPackets.find(p => p.isFromServer && (p.name === 'position' || p.name === 'synchronize_player_position'))
    if (positionPacket?.params) {
      const { x, y, z } = positionPacket.params
      bot.entity.position = new Vec3(x ?? 0, y ?? 64, z ?? 0)
      console.log('Set initial position from packet:', bot.entity.position)
    } else {
      // No position packet found, keep at origin but log it
      console.log('No position packet found, keeping default position:', bot.entity.position)
    }
  }

  // Set initial health state
  bot.health = 20
  bot.food = 20
  bot.foodSaturation = 5

  // Disable physics during replay - prevents player from falling
  if (bot.physics) {
    bot.physics.gravity = 0
    console.log('Disabled physics gravity for replay mode')
  }

  // Wait for forcedMove listener (used by index.ts to start viewer in replay mode)
  // In replay mode, spawnEarlier is true so index.ts listens for forcedMove, not health
  console.log('Waiting for forcedMove listener...')
  let listenerAttempts = 0
  while (bot.listenerCount('forcedMove') === 0 && listenerAttempts < 200) {
    await new Promise(resolve => setTimeout(resolve, 25)) // eslint-disable-line no-promise-executor-return
    listenerAttempts++
  }
  console.log('forcedMove listeners:', bot.listenerCount('forcedMove'), 'after', listenerAttempts * 25, 'ms')

  // Emit forcedMove event to trigger viewer initialization (index.ts listens for this)
  console.log('Emitting forcedMove event to start viewer')
  bot.emit('forcedMove')

  // Small delay to let viewer initialize
  await new Promise(resolve => setTimeout(resolve, 100)) // eslint-disable-line no-promise-executor-return

  // For MCPR replays, set KradleWebViewer to spectator mode for free camera movement
  if (isMcprReplay) {
    bot._client.emit('abilities', { flags: 6 }) // Allow flying
    bot._client.emit('game_state_change', { reason: 3, gameMode: 3 }) // Spectator mode
    // Also directly set bot.game.gameMode to ensure UI updates
    if (bot.game) {
      bot.game.gameMode = 'spectator'
      bot.emit('game')
    }
    // Start in birds eye view mode for replays - emit event so overlay shows
    // Start in birds eye view for MCPR replays
    const { setCamera } = require('../interactiveControls')
    setCamera({ mode: 'birdsEye' })
  }

  // Ensure the client is in PLAY state for packet processing
  const states = require('minecraft-protocol/src/states')
  if (bot._client.state !== states.PLAY) {
    console.log('Setting bot._client state to PLAY (was:', bot._client.state, ')')
    bot._client.state = states.PLAY
  }

  // Start main replay loop
  console.log('Starting MCPR replay from packet', startPacketIndex)

  // Analyze packet timing for diagnostics
  const serverPackets = playPackets.slice(startPacketIndex).filter(p => p.isFromServer && p.params !== null)
  let totalReplayTime = 0
  const packetsWithTimestamp = serverPackets.map(packet => {
    totalReplayTime += packet.diff
    return { ...packet, timestamp: totalReplayTime }
  })

  console.log('MCPR packet timing analysis:', {
    totalPackets: packetsWithTimestamp.length,
    totalReplayTime: `${(totalReplayTime / 1000).toFixed(1)}s`,
    avgDiff: `${(totalReplayTime / packetsWithTimestamp.length).toFixed(1)}ms`,
    currentSpeed: packetsReplayState.speed
  })

  // Initialize state for React components
  packetsReplayState.totalDurationMs = totalReplayTime
  packetsReplayState.currentTimeMs = 0

  // Extract chat markers for timeline display
  const PLAYER_CHAT_TRANSLATE_KEYS = new Set([
    'chat.type.text',
    'chat.type.emote',
    'chat.type.announcement',
    'chat.type.team.text',
    'chat.type.team.sent',
  ])

  // Extract plain text from Minecraft chat components, NBT-wrapped values, or plain strings
  const chatToText = (val: any): string => {
    if (typeof val === 'string') return val
    if (val === null || val === undefined) return ''
    if (typeof val !== 'object') return String(val)
    // NBT-wrapped: {type: "string", value: "text"} or {type: "compound", value: {text: "..."}}
    if (val.value !== undefined && val.type !== undefined) return chatToText(val.value)
    // Chat component: {text: "hello", extra: [{text: " world"}]}
    let result = val.text === undefined ? '' : chatToText(val.text)
    if (Array.isArray(val.extra)) {
      for (const part of val.extra) {
        result += chatToText(part)
      }
    }
    // Fallback: insertion field often has the raw player name
    if (!result && val.insertion) return chatToText(val.insertion)
    return result
  }

  const chatMarkers: Array<{ timeMs: number, sender: string, message: string }> = []
  for (const packet of packetsWithTimestamp) {
    switch (packet.name) {
      case 'player_chat': {
        const msg = chatToText(packet.params?.plainMessage || packet.params?.signedChatContent)
        const sender = chatToText(packet.params?.networkName || packet.params?.senderName)
        if (msg && sender && !msg.includes('I\'m sorry, I\'m having trouble generating a response')) {
          chatMarkers.push({ timeMs: packet.timestamp, sender, message: msg })
        }
        break
      }
      case 'profileless_chat': {
        try {
          const nameJson = JSON.parse(chatToText(packet.params?.name) || '""')
          const sender = typeof nameJson === 'string' ? nameJson : (nameJson?.text || '')
          const msgJson = JSON.parse(chatToText(packet.params?.message) || '""')
          const message = typeof msgJson === 'string' ? msgJson : (msgJson?.text || '')
          if (sender && message) {
            chatMarkers.push({ timeMs: packet.timestamp, sender, message })
          }
        } catch { /* skip malformed */ }
        break
      }
      case 'system_chat': {
        try {
          const rawContent = chatToText(packet.params?.content) || packet.params?.content
          const content = typeof rawContent === 'string'
            ? JSON.parse(rawContent)
            : rawContent
          if (content?.translate && PLAYER_CHAT_TRANSLATE_KEYS.has(content.translate) && Array.isArray(content.with) && content.with.length >= 2) {
            const sender = chatToText(content.with[0])
            const message = chatToText(content.with[1])
            if (sender && message) {
              chatMarkers.push({ timeMs: packet.timestamp, sender, message })
            }
          }
        } catch { /* skip malformed */ }
        break
      }
      // No default
    }
  }
  packetsReplayState.chatMarkers = chatMarkers
  console.log(`[replay] Extracted ${chatMarkers.length} chat markers for timeline`)

  // ============================================================
  // TIMER-BASED DRIP SYSTEM - mimics real network event delivery
  // ============================================================

  let currentPacketIndex = 0
  let replayStartTime = 0
  let pausedAt = 0
  let totalPausedTime = 0
  let loadingScreenCleared = false
  let lastLoggedIndex = 0
  let lastStatusUpdateTime = 0

  // Helper to format milliseconds to HH:MM:SS
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  // Process packets that are "due" based on elapsed time
  let replayFinished = false

  const processPacketsDue = () => {
    // Handle restart request - check this FIRST so it works even after replay finishes
    if (packetsReplayState.restartRequested) {
      packetsReplayState.restartRequested = false

      // Clear all entities except the player's own entity
      const entitiesToRemove = Object.values(bot.entities).filter(entity => entity !== bot.entity)
      console.log(`Clearing ${entitiesToRemove.length} entities for restart`)
      for (const entity of entitiesToRemove as Entity[]) {
        bot.emit('entityGone', entity)
        delete bot.entities[entity.id]
      }

      // Clear chat messages
      customEvents.emit('clearChat')
      clearKradleverseChat() // Synchronously clear kradleverse chat

      // Reset replay state
      currentPacketIndex = 0
      replayStartTime = performance.now()
      totalPausedTime = 0
      pausedAt = 0
      packetsReplayState.progress.current = 0
      packetsReplayState.isPlaying = true
      replayFinished = false
      console.log('Replay restarted')
    }

    // Handle seek request - check this FIRST so it works even after replay finishes
    if (packetsReplayState.seekTargetMs !== null) {
      const targetMs = packetsReplayState.seekTargetMs
      packetsReplayState.seekTargetMs = null

      // Find the packet index closest to the target timestamp
      let targetIndex = 0
      for (let i = 0; i < packetsWithTimestamp.length; i++) { // eslint-disable-line unicorn/no-for-loop
        if (packetsWithTimestamp[i].timestamp >= targetMs) {
          targetIndex = i
          break
        }
        targetIndex = i
      }

      console.log(`Seeking to ${targetMs}ms, packet index ${targetIndex}`)

      // Clear all entities except the player's own entity (same as restart)
      const entitiesToRemove = Object.values(bot.entities).filter(entity => entity !== bot.entity)
      console.log(`Clearing ${entitiesToRemove.length} entities for seek`)
      for (const entity of entitiesToRemove as Entity[]) {
        bot.emit('entityGone', entity)
        delete bot.entities[entity.id]
      }

      // Clear chat messages when seeking
      customEvents.emit('clearChat')
      clearKradleverseChat() // Synchronously clear kradleverse chat before fast-forward

      // Fast-forward: replay all packets from 0 to targetIndex immediately (no timing)
      console.log(`Fast-forwarding ${targetIndex} packets...`)
      setSkipChatMessages(true)
      for (let i = 0; i < targetIndex; i++) {
        const packet = packetsWithTimestamp[i]
        playServerPacket(packet.name, packet.params)
      }
      setSkipChatMessages(false)
      customEvents.emit('seekComplete')
      console.log('Fast-forward complete')

      // Update replay position to continue from target
      currentPacketIndex = targetIndex
      // Adjust replayStartTime so elapsed time matches target
      const speed = Math.max(0.1, packetsReplayState.speed)
      replayStartTime = performance.now() - (targetMs / speed)
      totalPausedTime = 0
      packetsReplayState.progress.current = targetIndex
      packetsReplayState.currentTimeMs = targetMs
      packetsReplayState.isPlaying = true
      pausedAt = 0
      replayFinished = false
    }

    // If paused or finished, track pause time and keep loop running for restart/seek
    if (!packetsReplayState.isPlaying || replayFinished) {
      if (pausedAt === 0) {
        pausedAt = performance.now()
      }
      requestAnimationFrame(processPacketsDue)
      return
    }

    // If we just resumed from pause, account for paused time
    if (pausedAt > 0) {
      totalPausedTime += performance.now() - pausedAt
      pausedAt = 0
    }

    const speed = Math.max(0.1, packetsReplayState.speed)
    const elapsed = (performance.now() - replayStartTime - totalPausedTime) * speed

    // Process packets that should have arrived, but limit time spent per frame
    // This keeps TPS healthy by leaving time for physics ticks
    const frameStartTime = performance.now()
    const maxFrameTime = 8 // Max 8ms per frame for packet processing (leaves time for physics/render)

    while (currentPacketIndex < packetsWithTimestamp.length) {
      const packet = packetsWithTimestamp[currentPacketIndex]

      // Check if this packet is due
      if (packet.timestamp > elapsed) {
        break // Not yet time for this packet
      }

      // Process the packet
      playServerPacket(packet.name, packet.params)
      currentPacketIndex++

      // Update progress
      packetsReplayState.progress.current = currentPacketIndex

      // Periodic logging
      if (currentPacketIndex - lastLoggedIndex >= 500) {
        lastLoggedIndex = currentPacketIndex
        const columnsCount = bot.world?.columns ? Object.keys(bot.world.columns).length : 0
        console.log(`Packet progress: ${currentPacketIndex}/${packetsWithTimestamp.length}, chunks: ${columnsCount}`)
      }

      // Clear loading screen once chunks are loaded
      if (!loadingScreenCleared) {
        const columnsCount = bot.world?.columns ? Object.keys(bot.world.columns).length : 0
        if (columnsCount > 0) {
          console.log('Chunks loaded, clearing loading screen')
          setLoadingScreenStatus(undefined)
          loadingScreenCleared = true
        }
      }

      // Time-based limit: don't block for more than maxFrameTime
      if (performance.now() - frameStartTime > maxFrameTime) {
        break
      }
    }

    // Check if replay is complete
    if (currentPacketIndex >= packetsWithTimestamp.length && !replayFinished) {
      replayFinished = true
      const finalColumnsCount = bot.world?.columns ? Object.keys(bot.world.columns).length : 0
      console.log(`Replay finished - chunks in world: ${finalColumnsCount}`)

      // Pause the replay (keep entities and world visible)
      packetsReplayState.isPlaying = false

      // Update state for React components
      packetsReplayState.currentTimeMs = totalReplayTime
      packetsReplayState.totalDurationMs = totalReplayTime

      // Emit final status with 100% progress
      customEvents.emit('replayProgress', {
        currentTime: formatTime(totalReplayTime),
        progress: 1,
        percentage: 100,
        isPaused: true,
        totalDuration: totalReplayTime
      })
      // Keep loop running for restart/seek
      requestAnimationFrame(processPacketsDue)
      return
    }

    // Emit replay progress every 250ms for UI updates
    const now = performance.now()
    if (now - lastStatusUpdateTime > 250) {
      lastStatusUpdateTime = now
      const currentTimestamp = packetsWithTimestamp[currentPacketIndex]?.timestamp || 0
      const progress = currentTimestamp / totalReplayTime
      const percentage = Math.round(progress * 100)
      // Update state for React components
      packetsReplayState.currentTimeMs = currentTimestamp
      packetsReplayState.totalDurationMs = totalReplayTime
      customEvents.emit('replayProgress', {
        currentTime: formatTime(currentTimestamp),
        progress,
        percentage,
        isPaused: !packetsReplayState.isPlaying,
        totalDuration: totalReplayTime
      })
    }

    // Schedule next frame - requestAnimationFrame syncs with browser's render cycle
    requestAnimationFrame(processPacketsDue)
  }

  // Start the timer-based replay using requestAnimationFrame
  replayStartTime = performance.now()
  requestAnimationFrame(processPacketsDue)

  console.log('Started rAF-based packet replay (synced with browser render cycle)')
}

export const switchGameMode = (gameMode: GameMode) => {
  const gamemodes = {
    survival: 0,
    creative: 1,
    adventure: 2,
    spectator: 3
  }
  if (gameMode === 'spectator') {
    bot._client.emit('abilities', { flags: 6 })
  }
  bot._client.emit('game_state_change', {
    reason: 3,
    gameMode: gamemodes[gameMode]
  })
}

interface PacketsWaiterOptions {
  unexpectedPacketReceived?: (name: string, params: any) => void
  expectedPacketReceived?: (name: string, params: any) => void
  onUnexpectedPacketsLimitReached?: () => void
  unexpectedPacketsLimit?: number
}

interface PacketsWaiter {
  addPacket(name: string, params: any): void
  waitForPackets(packets: string[]): Promise<void>
  stopWaiting(): void
}

const createPacketsWaiter = (options: PacketsWaiterOptions): PacketsWaiter => {
  let packets: string[] = []
  let resolve: (() => void) | null = null
  let unexpectedPacketsCount = 0

  return {
    addPacket (name: string, params: any) {
      const index = packets.indexOf(name)
      if (index === -1) {
        unexpectedPacketsCount++
        options.unexpectedPacketReceived?.(name, params)
        if (unexpectedPacketsCount >= (options.unexpectedPacketsLimit ?? Infinity)) {
          options.onUnexpectedPacketsLimitReached?.()
        }
      } else {
        packets.splice(index, 1)
        options.expectedPacketReceived?.(name, params)
        if (packets.length === 0 && resolve) {
          resolve()
        }
      }
    },
    async waitForPackets (packetsToWait: string[]) {
      packets = packetsToWait
      unexpectedPacketsCount = 0
      return new Promise<void>(r => { resolve = r })
    },
    stopWaiting () {
      resolve?.()
      packets = []
    }
  }
}

const restoreData = (data: any): any => {
  if (typeof data !== 'object' || data === null) {
    return data
  }

  // Handle Buffer restoration - standard JSON.stringify format
  if (data.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data)
  }

  // Handle arrays - check if it's a byte array that should be a Buffer
  if (Array.isArray(data)) {
    // If array has many numeric elements (0-255), it's likely a serialized Buffer
    if (data.length > 10) {
      const looksLikeBytes = data.slice(0, 20).every(v => typeof v === 'number' && v >= 0 && v <= 255)
      if (looksLikeBytes) {
        return Buffer.from(data)
      }
    }
    // Otherwise recursively restore array elements
    return data.map(item => restoreData(item))
  }

  // Handle objects that look like serialized Buffers (numeric keys with byte values)
  // This happens when Buffers are sent through CustomChannelClient
  const keys = Object.keys(data)
  if (keys.length > 0) {
    const allNumericKeys = keys.every(k => /^\d+$/.test(k))
    if (allNumericKeys && keys.length > 10) {
      // This is likely a serialized Buffer - convert back
      const values = new Array(keys.length) // eslint-disable-line unicorn/no-new-array
      for (const key of keys) {
        values[Number(key)] = data[key]
      }
      // Verify it looks like byte data (all values 0-255)
      const looksLikeBytes = values.slice(0, 20).every(v => typeof v === 'number' && v >= 0 && v <= 255)
      if (looksLikeBytes) {
        return Buffer.from(values)
      }
    }
  }

  // Handle objects - create new object to avoid "Cannot set property" errors
  // on objects with getter-only properties
  const result: any = {}
  for (const key of keys) {
    try {
      result[key] = restoreData(data[key])
    } catch {
      // If we can't access the property, skip it
      result[key] = data[key]
    }
  }
  return result
}
