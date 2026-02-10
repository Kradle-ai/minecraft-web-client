import { Vec3 } from 'vec3'
import { proxy } from 'valtio'
import { pointerLock } from './utils'
import { toggleFly } from './controls'

// ===== Types =====

export type CameraMode = 'firstPerson' | 'thirdPerson' | 'birdsEyeView' | 'freeRoam'

export interface CameraState {
  mode: CameraMode
  target: string | null
}

// ===== Reactive State =====

export const cameraState = proxy<CameraState>({
  mode: 'firstPerson',
  target: null
})

// ===== Spectator Camera State =====

let spectatorCameraPosition: Vec3 | null = null
let spectatorCameraYaw: number | null = null
let spectatorCameraPitch: number | null = null

export function getSpectatorCameraPosition () {
  return spectatorCameraPosition
}

export function getSpectatorCameraDirection () {
  if (spectatorCameraYaw !== null && spectatorCameraPitch !== null) {
    return { yaw: spectatorCameraYaw, pitch: spectatorCameraPitch }
  }
  return null
}

export function updateSpectatorCameraDirection (yaw: number, pitch: number) {
  if (spectatorCameraPosition) {
    spectatorCameraYaw = yaw
    spectatorCameraPitch = pitch
  }
}

export function setSpectatorCameraPosition (pos: Vec3 | null, yaw?: number, pitch?: number) {
  spectatorCameraPosition = pos ? pos.clone() : null
  if (pos && yaw !== undefined && pitch !== undefined) {
    spectatorCameraYaw = yaw
    spectatorCameraPitch = pitch
  } else if (!pos) {
    spectatorCameraYaw = null
    spectatorCameraPitch = null
  }
}

// ===== Internal Follow State =====

// Persistent username for entity recovery in MCPR replays
let followingUsername: string | null = null

// Cache for last valid birds eye position
let lastValidBirdsEyePosition: { position: Vec3, yaw: number, pitch: number } | null = null

// ===== PostMessage =====

function sendMessageToParent (payload: Record<string, any>) {
  if (window !== window.parent) {
    window.parent.postMessage({
      ...payload,
      source: 'minecraft-web-client'
    }, '*')
  }
}

export function reportCameraState () {
  sendMessageToParent({
    action: 'cameraState',
    mode: cameraState.mode,
    target: cameraState.target
  })
}

// ===== Camera Position Calculations =====

export function getThirdPersonCameraPosition () {
  const targetPosition: Vec3 = following.entity.position

  const { yaw } = following.entity
  const distance = 5
  const heightOffset = 2

  const dx = Math.sin(yaw) * distance
  const dz = Math.cos(yaw) * distance

  const cameraPosition = targetPosition.offset(dx, heightOffset, dz)
  const cameraYaw = yaw
  const cameraPitch = -0.2

  return {
    position: cameraPosition,
    yaw: cameraYaw,
    pitch: cameraPitch
  }
}

export function getBirdsEyeCameraPosition () {
  if (!bot) {
    return lastValidBirdsEyePosition || {
      position: new Vec3(0, 82, 12),
      yaw: 0,
      pitch: -Math.PI / 4
    }
  }

  const players: Vec3[] = []
  const excludedNames = new Set(['KradleWebViewer', 'watcher'])

  const isAtDefaultOrigin = (pos: Vec3 | undefined) => pos && pos.x === 0 && pos.y === 0 && pos.z === 0

  if (bot.entity?.position && !excludedNames.has(bot.username || '') && !isAtDefaultOrigin(bot.entity.position)) {
    players.push(bot.entity.position)
  }

  for (const entity of Object.values(bot.entities)) {
    if (entity.type === 'player' && entity.position && entity.username) {
      if (!excludedNames.has(entity.username) && !isAtDefaultOrigin(entity.position)) {
        players.push(entity.position)
      }
    }
  }

  if (players.length === 0) {
    if (lastValidBirdsEyePosition) {
      return lastValidBirdsEyePosition
    }

    const fallbackY = bot.entity?.position?.y || 70
    const fallbackX = bot.entity?.position?.x || 0
    const fallbackZ = bot.entity?.position?.z || 0
    const result = {
      position: new Vec3(fallbackX, fallbackY + 12, fallbackZ + 12),
      yaw: 0,
      pitch: -Math.PI / 4
    }
    if (!isAtDefaultOrigin(bot.entity?.position)) {
      lastValidBirdsEyePosition = result
    }
    return result
  }

  let centerX = 0
  let centerY = 0
  let centerZ = 0
  for (const pos of players) {
    centerX += pos.x
    centerY += pos.y
    centerZ += pos.z
  }
  const center = new Vec3(
    centerX / players.length,
    centerY / players.length,
    centerZ / players.length
  )

  let maxDistance = 0
  for (const pos of players) {
    const distance = Math.hypot(
      pos.x - center.x,
      pos.z - center.z
    )
    if (distance > maxDistance) {
      maxDistance = distance
    }
  }

  const heightAbovePlayers = Math.min(12, Math.max(8, maxDistance * 0.4))
  const cameraOffset = Math.min(15, Math.max(10, maxDistance * 0.6))

  const cameraY = center.y + heightAbovePlayers
  const cameraPosition = new Vec3(center.x, cameraY, center.z + cameraOffset)

  const result = {
    position: cameraPosition,
    yaw: 0,
    pitch: -Math.PI / 4
  }

  lastValidBirdsEyePosition = result
  return result
}

// ===== Camera Update Logic =====

export function updateCameraForCurrentMode () {
  if (following === bot) {
    if (!bot.entity) return
    const spectatorPos = getSpectatorCameraPosition()
    if (bot.physics.gravity === 0 && spectatorPos) {
      const { yaw, pitch } = bot.entity
      appViewer.backend?.updateCamera(spectatorPos, yaw, pitch)
    } else {
      const { position, yaw, pitch } = bot.entity
      appViewer.backend?.updateCamera(position, yaw, pitch)
    }
    return
  }

  if (!following?.entity?.position) {
    console.warn('[InteractiveControls] Cannot update camera - followed entity position not found')
    return
  }

  const { position, yaw, pitch } = getThirdPersonCameraPosition()
  appViewer.backend?.updateCamera(position, yaw, pitch)
}

function handleMovement () {
  const now = Date.now()
  if (now - appViewer.lastCamUpdate < 1000 / 60) return
  appViewer.lastCamUpdate = Date.now()

  // freeRoam: spectator camera position is independent, just update chunk loading
  if (cameraState.mode === 'freeRoam' && getSpectatorCameraPosition()) {
    void appViewer.worldView?.updatePosition(getSpectatorCameraPosition()!)
    return
  }

  // birdsEyeView: calculate dynamic overhead position
  if (cameraState.mode === 'birdsEyeView') {
    const { position, yaw, pitch } = getBirdsEyeCameraPosition()
    appViewer.backend?.updateCamera(position, yaw, pitch)
    void appViewer.worldView?.updatePosition(position)
    return
  }

  // firstPerson: bot's own view
  if (cameraState.mode === 'firstPerson' || following === bot) {
    if (!bot.entity) return
    const isAtDefaultOrigin = bot.entity.position.x === 0 &&
      bot.entity.position.y === 0 &&
      bot.entity.position.z === 0
    updateCameraForCurrentMode()
    if (!isAtDefaultOrigin) {
      void appViewer.worldView?.updatePosition(bot.entity.position)
    }
    return
  }

  // thirdPerson: following another player
  if (following && following !== bot && !following?.entity?.position) {
    // Try entity recovery (for MCPR replays where entities get recreated)
    const usernameToRecover = followingUsername || following?.username
    if (usernameToRecover) {
      const recoveredEntity = Object.values(bot.entities).find(
        e => e.type === 'player' && e.username === usernameToRecover
      )
      if (recoveredEntity) {
        const recoveredPlayer = bot.players[usernameToRecover]
        if (recoveredPlayer) {
          recoveredPlayer.entity = recoveredEntity
          window.following = recoveredPlayer
          console.log('[InteractiveControls] Recovered entity reference for', usernameToRecover)
          return
        }
      }
    }

    // Entity lost - report to parent and do nothing
    console.log('[InteractiveControls] Followed entity lost:', usernameToRecover)
    sendMessageToParent({ action: 'followingPlayerLost' })
    return
  }

  if (following?.entity?.position) {
    updateCameraForCurrentMode()
    void appViewer.worldView?.updatePosition(following.entity.position)
  }
}

// Check if a spawned/updated entity is the one we're following (for MCPR replay recovery)
function checkEntityForFollowRecovery (entity: any) {
  if (!followingUsername || following === bot) return

  if (entity.type === 'player' && entity.username === followingUsername) {
    const player = bot.players[followingUsername]
    if (player && (!player.entity || player.entity !== entity)) {
      player.entity = entity
      window.following = player
      console.log('[InteractiveControls] Updated entity reference for', followingUsername, 'after spawn/update')
    }
  }
}

// ===== Public API =====

export function setCamera (config: { mode: CameraMode, target?: string }) {
  const { mode, target } = config
  const previousMode = cameraState.mode

  console.log('[InteractiveControls] setCamera:', previousMode, '->', mode, target ? `(target: ${target})` : '')

  switch (mode) {
    case 'firstPerson': {
      // Clear spectator position
      setSpectatorCameraPosition(null)
      // Follow self
      window.following = bot
      followingUsername = null
      cameraState.mode = 'firstPerson'
      cameraState.target = null
      // Enable keyboard control
      controMax.enabled = true
      break
    }

    case 'thirdPerson': {
      if (!target) {
        console.error('[InteractiveControls] thirdPerson requires a target username')
        return
      }
      // Clear spectator position
      setSpectatorCameraPosition(null)
      cameraState.mode = 'thirdPerson'
      cameraState.target = target
      // Disable keyboard control
      controMax.enabled = false
      // Start following (async with retry)
      void doFollowPlayer(target)
      break
    }

    case 'birdsEyeView': {
      // Clear spectator position
      setSpectatorCameraPosition(null)
      // Set bot as default following (camera ignores it)
      window.following = bot
      followingUsername = null
      cameraState.mode = 'birdsEyeView'
      cameraState.target = null
      // Disable keyboard control
      controMax.enabled = false
      // Initial camera positioning
      const { position, yaw, pitch } = getBirdsEyeCameraPosition()
      appViewer.backend?.updateCamera(position, yaw, pitch)
      void appViewer.worldView?.updatePosition(position)
      break
    }

    case 'freeRoam': {
      // Get camera position from current mode to start from
      let startPos = getBirdsEyeCameraPosition()
      if (previousMode === 'thirdPerson' && following?.entity?.position) {
        startPos = getThirdPersonCameraPosition()
      }

      if (startPos?.position) {
        setSpectatorCameraPosition(startPos.position)
        toggleFly(true)
        setTimeout(() => {
          bot.look(startPos.yaw, startPos.pitch).catch(() => {})
        }, 50)
      }

      window.following = bot
      followingUsername = null
      cameraState.mode = 'freeRoam'
      cameraState.target = null
      // Enable keyboard control for WASD camera movement
      controMax.enabled = true
      // Request pointer lock for mouse capture
      void pointerLock.requestPointerLock()
      break
    }
  }

  reportCameraState()
}

async function doFollowPlayer (username: string) {
  let target = bot.players[username]

  if (!target) {
    // Retry every 2 seconds for up to 30 seconds
    const maxRetries = 15
    let retryCount = 0

    const retryFollow = () => {
      if (retryCount >= maxRetries) {
        console.error(`[InteractiveControls] Failed to follow player '${username}' after ${maxRetries} retries`)
        sendMessageToParent({ action: 'followingPlayerLost' })
        return
      }

      if (bot.players[username]) {
        console.log(`[InteractiveControls] Player ${username} found after ${retryCount} retries`)
        void doFollowPlayer(username)
      } else {
        retryCount++
        setTimeout(retryFollow, 2000)
      }
    }

    setTimeout(retryFollow, 2000)
    return
  }

  // Wait for entity position if needed
  if (!target?.entity?.position) {
    await new Promise(resolve => { setTimeout(resolve, 1000) })
    target = bot.players[username]
  }

  if (!target?.entity?.position) {
    await new Promise(resolve => { setTimeout(resolve, 1000) })
    target = bot.players[username]
  }

  if (!target?.entity?.position) {
    console.error(`[InteractiveControls] Failed to follow player '${username}' - could not find entity position`)
    return
  }

  window.following = target
  followingUsername = username
  reportCameraState()
}

export async function reestablishFollowing () {
  if (!followingUsername || cameraState.mode !== 'thirdPerson') {
    return
  }

  console.log('[InteractiveControls] Re-establishing follow for', followingUsername)

  await new Promise(resolve => { setTimeout(resolve, 500) })

  const player = bot.players[followingUsername]
  if (player) {
    const entity = Object.values(bot.entities).find(
      e => e.type === 'player' && e.username === followingUsername
    )
    if (entity) {
      player.entity = entity
      window.following = player
      console.log('[InteractiveControls] Successfully re-established following for', followingUsername)
    } else {
      console.log('[InteractiveControls] Entity not yet loaded for', followingUsername, ', waiting for spawn')
    }
  } else {
    console.log('[InteractiveControls] Player not found for', followingUsername, ', clearing follow state')
    followingUsername = null
    sendMessageToParent({ action: 'followingPlayerLost' })
  }
}

// ===== Initialization =====

export function trackCameraMovement () {
  bot.on('move', () => handleMovement())
  bot.on('forcedMove', () => handleMovement())
  bot.on('entityElytraFlew', () => handleMovement())
  bot.on('entityAttributes', () => handleMovement())
  bot.on('entitySpawn', (entity) => {
    checkEntityForFollowRecovery(entity)
    handleMovement()
  })
  bot.on('entityGone', () => handleMovement())
  bot.on('entityMoved', () => handleMovement())
  bot.on('entityUpdate', (entity) => {
    checkEntityForFollowRecovery(entity)
    handleMovement()
  })

  handleMovement()
}

// Listen for postMessage commands from parent
function setupPostMessageListener () {
  customEvents.on('kradle:setCamera', (data: any) => {
    const { mode, target } = data
    if (mode) {
      setCamera({ mode, target })
    }
  })

  // Legacy event handlers for backward compatibility
  customEvents.on('kradle:followPlayer', (data: any) => {
    const { username } = data
    if (username) {
      setCamera({ mode: 'thirdPerson', target: username })
    }
  })

  customEvents.on('kradle:birdsEyeViewFollow', () => {
    setCamera({ mode: 'birdsEyeView' })
  })

  customEvents.on('kradle:freeRoamMode', () => {
    setCamera({ mode: 'freeRoam' })
  })

  // Pointer lock release: just report to parent, no mode change
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) {
      sendMessageToParent({ action: 'pointerLockReleased' })
    }
  })
}

setupPostMessageListener()
