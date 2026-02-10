import { useEffect, useRef, useState } from 'react'
import type { Block } from 'prismarine-block'
import { getThreeJsRendererMethods } from 'renderer/viewer/three/threeJsMethods'
import { getFixedFilesize } from '../downloadAndOpenFile'
import { options } from '../optionsStorage'
import { BlockStateModelInfo } from '../../renderer/viewer/lib/mesher/shared'
import styles from './DebugOverlay.module.css'

export default () => {
  const received = useRef({ ...defaultPacketsCount })
  const sent = useRef({ ...defaultPacketsCount })
  const customEntries = useRef({} as any)
  const receivedTotal = useRef(0)
  const packetsCountByNamePerSec = useRef({
    received: {} as { [key: string]: number },
    sent: {} as { [key: string]: number }
  })
  window.packetsCountByNamePerSec = packetsCountByNamePerSec
  const packetsCountByNamePer10Sec = useRef({
    received: {} as { [key: string]: number },
    sent: {} as { [key: string]: number }
  })
  window.packetsCountByNamePer10Sec = packetsCountByNamePer10Sec
  const packetsCountByName = useRef({
    received: {} as { [key: string]: number },
    sent: {} as { [key: string]: number }
  })
  window.packetsCountByName = packetsCountByName
  const ignoredPackets = useRef(new Set([] as any[]))
  const [packetsString, setPacketsString] = useState('')
  const [showDebug, setShowDebug] = useState(false)
  const [pos, setPos] = useState<{ x: number, y: number, z: number }>({ x: 0, y: 0, z: 0 })
  const [skyL, setSkyL] = useState(0)
  const [blockL, setBlockL] = useState(0)
  const [biomeId, setBiomeId] = useState(0)
  const [day, setDay] = useState(0)
  const [dimension, setDimension] = useState('')
  const [cursorBlock, setCursorBlock] = useState<Block | null>(null)
  const [blockInfo, setBlockInfo] = useState<{ customBlockName?: string, modelInfo?: BlockStateModelInfo } | null>(null)
  const [clientTps, setClientTps] = useState(0)
  const minecraftYaw = useRef(0)
  const minecraftQuad = useRef(0)
  const rendererDevice = appViewer.rendererState.renderer ?? 'No render backend'

  const quadsDescription = [
    'north (towards negative Z)',
    'east (towards positive X)',
    'south (towards positive Z)',
    'west (towards negative X)'
  ]

  const viewDegToMinecraft = (yaw) => yaw % 360 - 180 * (yaw < 0 ? -1 : 1)

  const handleF3 = (e) => {
    if (e.code === 'F3') {
      setShowDebug(prev => !prev)
      e.preventDefault()
    }
  }

  const readPacket = (data, { name }, _buf, fullBuffer) => {
    if (fullBuffer) {
      const size = fullBuffer.byteLength
      receivedTotal.current += size
      received.current.size += size
    }
    received.current.count++
    managePackets('received', name, data)
  }

  const managePackets = (type, name, data) => {
    packetsCountByName.current[type][name] ??= 0
    packetsCountByName.current[type][name]++
    packetsCountByNamePerSec.current[type][name] ??= 0
    packetsCountByNamePerSec.current[type][name]++
    packetsCountByNamePer10Sec.current[type][name] ??= 0
    packetsCountByNamePer10Sec.current[type][name]++
    if (options.debugLogNotFrequentPackets && !ignoredPackets.current.has(name) && !hardcodedListOfDebugPacketsToIgnore[type].includes(name)) {
      if (packetsCountByNamePerSec.current[type][name] > 5 || packetsCountByName.current[type][name] > 100) { // todo think of tracking the count within 10s
        console.info(`[packet ${name} was ${type} too frequent] Ignoring...`)
        ignoredPackets.current.add(name)
      } else {
        console.info(`[packet ${type}] ${name}`, /* ${JSON.stringify(data, null, 2)}` */ data)
      }
    }
  }

  useEffect(() => {
    let lastTpsReset = 0
    let lastTps = 0
    let lastTickDate = 0
    const updateTps = (increment = false) => {
      if (Date.now() - lastTpsReset >= 1000) {
        setClientTps(lastTps)
        window.lastTpsArray ??= []
        window.lastTpsArray.push(lastTps)
        lastTps = 0
        lastTpsReset = Date.now()
      }
      if (increment) {
        lastTickDate = Date.now()
        lastTps++
      }
    }

    document.addEventListener('keydown', handleF3)
    let update = 0
    const packetsUpdateInterval = setInterval(() => {
      setPacketsString(`↓ ${received.current.count} (${(received.current.size / 1024).toFixed(2)} KB/s, ${getFixedFilesize(receivedTotal.current)}) ↑ ${sent.current.count}`)
      received.current = { ...defaultPacketsCount }
      sent.current = { ...defaultPacketsCount }
      packetsCountByNamePerSec.current.received = {}
      packetsCountByNamePerSec.current.sent = {}
      if (update++ % 10 === 0) {
        packetsCountByNamePer10Sec.current.received = {}
        packetsCountByNamePer10Sec.current.sent = {}
      }
      updateTps(false)
    }, 1000)

    bot.on('physicsTick', () => {
      updateTps(true)
    })
    bot._client.on('packet', () => {
      updateTps(false)
    })

    const freqUpdateInterval = setInterval(() => {
      const position = following?.entity?.position || bot.entity.position

      setPos({ ...position })
      setSkyL(bot.world.getSkyLight(position))
      setBlockL(bot.world.getBlockLight(position))
      setBiomeId(bot.world.getBiome(position))
      setDimension(bot.game.dimension)
      setDay(bot.time.day)
      try {
        setCursorBlock(bot.mouse.getCursorState().cursorBlock)
      } catch {
        // Ignore raycast errors (e.g., during replay when block intersect may be undefined)
        setCursorBlock(null)
      }

    }, 100)

    const notFrequentUpdateInterval = setInterval(async () => {
      const block = bot.mouse.cursorBlock
      if (!block) {
        setBlockInfo(null)
        return
      }
      const { customBlockName, modelInfo } = await getThreeJsRendererMethods()?.getBlockInfo(pos, block.stateId) ?? {}
      setBlockInfo({ customBlockName, modelInfo })
    }, 300)

    // @ts-expect-error
    bot._client.on('packet', readPacket)
    // @ts-expect-error
    bot._client.on('packet_name' as any, (name, data) => readPacket(data, { name })) // custom client
    bot._client.on('writePacket' as any, (name, data) => {
      sent.current.count++
      managePackets('sent', name, data)
    })

    return () => {
      document.removeEventListener('keydown', handleF3)
      clearInterval(packetsUpdateInterval)
      clearInterval(freqUpdateInterval)
      clearInterval(notFrequentUpdateInterval)
      console.log('Last physics tick before disconnect was', Date.now() - lastTickDate, 'ms ago')
    }
  }, [])

  useEffect(() => {
    const yaw = following?.entity?.yaw ?? 0
    minecraftYaw.current = viewDegToMinecraft(yaw * -180 / Math.PI)
    minecraftQuad.current = Math.floor(((minecraftYaw.current + 180) / 90 + 0.5) % 4)
  }, [following?.entity?.yaw])

  if (!showDebug) return null

  return <>
    <div className={`debug-left-side ${styles['debug-left-side']}`}>
      <p>Prismarine Web Client ({bot.version})</p>
      {appViewer.backend?.getDebugOverlay?.().entitiesString && <p>E: {appViewer.backend.getDebugOverlay().entitiesString}</p>}
      <p>{dimension}</p>
      <div className={styles.empty} />
      <p>XYZ: {pos.x.toFixed(3)} / {pos.y.toFixed(3)} / {pos.z.toFixed(3)}</p>
      <p>Chunk: {Math.floor(pos.x % 16)} ~ {Math.floor(pos.z % 16)} in {Math.floor(pos.x / 16)} ~ {Math.floor(pos.z / 16)}</p>
      <p>Packets: {packetsString}</p>
      <p>Client TPS: {clientTps}</p>
      <p>Facing (viewer): {(following?.entity?.yaw ?? 0).toFixed(3)} {(following?.entity?.pitch ?? 0).toFixed(3)}</p>
      <p>Facing (minecraft): {quadsDescription[minecraftQuad.current]} ({minecraftYaw.current.toFixed(1)} {((following?.entity?.pitch ?? 0) * -180 / Math.PI).toFixed(1)})</p>
      <p>Light: {blockL} ({skyL} sky)</p>

      <p>Biome: minecraft:{loadedData.biomesArray[biomeId]?.name ?? 'unknown biome'}</p>
      <p>Day: {day}</p>
      <div className={styles.empty} />
      {Object.entries(appViewer.backend?.getDebugOverlay?.().left ?? {}).map(([name, value]) => <p key={name}>{name}: {value}</p>)}
    </div>

    <div className={`debug-right-side ${styles['debug-right-side']}`}>
      <p>Backend: {appViewer.backend?.displayName}</p>
      <p>Renderer: {rendererDevice}</p>
      <div className={styles.empty} />
      {cursorBlock ? (<>
        <p>{cursorBlock.name}</p>
        {
          Object.entries(cursorBlock.getProperties()).map(([name, value], idx, arr) => {
            return <p key={name}>
              {name}: {
                typeof value === 'boolean' ? (
                  <span style={{ color: value ? 'lightgreen' : 'red' }}>{String(value)}</span>
                ) : value
              }
            </p>
          })
        }
      </>)
        : ''}
      {cursorBlock ? (
        <p>Looking at: {cursorBlock.position.x} {cursorBlock.position.y} {cursorBlock.position.z}</p>
      ) : ''}
      <div className={styles.empty} />
      {blockInfo && (() => {
        const { customBlockName, modelInfo } = blockInfo
        return modelInfo && (
          <>
            {customBlockName && <p style={{ fontSize: 7, }}>Custom block: {customBlockName}</p>}
            {modelInfo.issues.map((issue, i) => (
              <p key={i} style={{ color: 'yellow', fontSize: 7, }}>{issue}</p>
            ))}
            {/* <p style={{ fontSize: 7, }}>Resolved models chain: {modelInfo.modelNames.join(' -> ')}</p> */}
            <p style={{ fontSize: 7, }}>Resolved model: {modelInfo.modelNames[0] ?? '-'}</p>
            <p style={{ fontSize: 7, whiteSpace: 'nowrap', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {modelInfo.conditions.join(', ')}
            </p>
          </>
        )
      })()}
      {Object.entries(appViewer.backend?.getDebugOverlay?.().right ?? {}).map(([name, value]) => <p key={name}>{name}: {value}</p>)}
    </div>
  </>
}

const hardcodedListOfDebugPacketsToIgnore = {
  received: [
    'entity_velocity',
    'sound_effect',
    'rel_entity_move',
    'entity_head_rotation',
    'entity_metadata',
    'entity_move_look',
    'teams',
    'entity_teleport',
    'entity_look',
    'ping',
    'entity_update_attributes',
    'player_info',
    'update_time',
    'animation',
    'entity_equipment',
    'entity_destroy',
    'named_entity_spawn',
    'update_light',
    'set_slot',
    'block_break_animation',
    'map_chunk',
    'spawn_entity',
    'world_particles',
    'keep_alive',
    'chat',
    'playerlist_header',
    'scoreboard_objective',
    'scoreboard_score',
    'entity_status'
  ],
  sent: [
    'pong',
    'position',
    'look',
    'keep_alive',
    'position_look'
  ]
}

const defaultPacketsCount = {
  count: 0,
  size: 0
}
