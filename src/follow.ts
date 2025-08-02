import type { Vec3 } from 'vec3'

// Simple camera smoothing state
let currentCameraPos: Vec3 | null = null
let targetCameraPos: Vec3 | null = null
let currentYaw = 0
let targetYaw = 0
let currentPitch = 0
let targetPitch = 0
let isSmoothingActive = false
let lastTargetPosition: Vec3 | null = null
let lastTargetVelocity: Vec3 = { x: 0, y: 0, z: 0 }
let lastTargetTime: number = Date.now()

// Drone-like smoothing configuration
const POSITION_SMOOTHING_SPEED = 0.09
const ROTATION_SMOOTHING_SPEED = 0.02
const DRONE_HEIGHT_OFFSET = 2.25
const DRONE_DISTANCE = 4
const DRONE_PITCH = -0.35
const INERTIA_BASE = 0.3

function handleMovement() {
  const now = Date.now()
  if (now - appViewer.lastCamUpdate < 16) return

  if (following && !following?.entity?.position) {
    console.log('The entity to follow could no longer be found')
    void setFollowingPlayer()
    return
  }

  appViewer.lastCamUpdate = now
  setThirdPersonCamera()
  void appViewer.worldView?.updatePosition(following.entity.position)
}

function getThirdPersonCameraPosition() {
  const targetPosition: Vec3 = following.entity.position
  const now = Date.now()
  const deltaTime = (now - lastTargetTime) / 1000
  lastTargetTime = now

  if (lastTargetPosition && deltaTime > 0) {
    lastTargetVelocity = {
      x: (targetPosition.x - lastTargetPosition.x) / deltaTime,
      y: (targetPosition.y - lastTargetPosition.y) / deltaTime,
      z: (targetPosition.z - lastTargetPosition.z) / deltaTime
    }
  }
  lastTargetPosition = targetPosition

  const speed = Math.sqrt(
    lastTargetVelocity.x ** 2 +
    lastTargetVelocity.y ** 2 +
    lastTargetVelocity.z ** 2
  )

  const dynamicInertia = Math.min(1, INERTIA_BASE + speed * 0.05)

  const smoothedTargetPosition: Vec3 = lastTargetPosition && lastTargetPosition !== targetPosition ? {
    x: lerp(lastTargetPosition.x, targetPosition.x, 1 - dynamicInertia),
    y: lerp(lastTargetPosition.y, targetPosition.y, 1 - dynamicInertia),
    z: lerp(lastTargetPosition.z, targetPosition.z, 1 - dynamicInertia)
  } : targetPosition

  const { yaw } = following.entity
  const orbitOffset = Math.sin(now * 0.000325) * 0.925

  let dx = Math.sin(yaw + orbitOffset) * DRONE_DISTANCE
  let dz = Math.cos(yaw + orbitOffset) * DRONE_DISTANCE

  const isIdle = speed < 0.05
  if (isIdle) {
    const t = now / 1000
    dx += Math.cos(t * 0.5) * 0.35
    dz += Math.sin(t * 0.5) * 0.35
  }

  const cameraPosition: Vec3 = {
    x: smoothedTargetPosition.x + dx,
    y: smoothedTargetPosition.y + DRONE_HEIGHT_OFFSET + (isIdle ? Math.sin(now * 0.00025) * 0.25 : 0),
    z: smoothedTargetPosition.z + dz
  }

  const cameraYaw = yaw + orbitOffset
  const cameraPitch = DRONE_PITCH

  return {
    position: cameraPosition,
    yaw: cameraYaw,
    pitch: cameraPitch
  }
}

function smoothLerp(start: number, end: number, factor: number): number {
  const smoothFactor = factor * factor * (3 - 2 * factor)
  return start + (end - start) * smoothFactor
}

function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor
}

function updateCameraSmoothing() {
  if (!isSmoothingActive || !targetCameraPos) return

  if (!currentCameraPos) {
    currentCameraPos = { ...targetCameraPos }
    currentYaw = targetYaw
    currentPitch = targetPitch
    return
  }

  currentCameraPos.x = smoothLerp(currentCameraPos.x, targetCameraPos.x, POSITION_SMOOTHING_SPEED)
  currentCameraPos.y = smoothLerp(currentCameraPos.y, targetCameraPos.y, POSITION_SMOOTHING_SPEED)
  currentCameraPos.z = smoothLerp(currentCameraPos.z, targetCameraPos.z, POSITION_SMOOTHING_SPEED)

  let yawDiff = targetYaw - currentYaw
  if (yawDiff > Math.PI) yawDiff -= 2 * Math.PI
  if (yawDiff < -Math.PI) yawDiff += 2 * Math.PI
  currentYaw += yawDiff * ROTATION_SMOOTHING_SPEED

  currentPitch = smoothLerp(currentPitch, targetPitch, ROTATION_SMOOTHING_SPEED)

  appViewer.backend?.updateCamera(currentCameraPos, currentYaw, currentPitch)
}

export function setThirdPersonCamera(directionOnly = false) {
  if (following === bot) {
    const { position, yaw, pitch } = bot.entity
    appViewer.backend?.updateCamera(directionOnly ? null : position, yaw, pitch)
    return
  }

  if (!following?.entity?.position) {
    console.warn('Cannot set third person camera. The followed entity position could not be found')
    return
  }

  const { position, yaw, pitch } = getThirdPersonCameraPosition()

  targetCameraPos = position
  targetYaw = yaw
  targetPitch = pitch
  isSmoothingActive = true

  if (!currentCameraPos) {
    appViewer.backend?.updateCamera(directionOnly ? null : position, yaw, pitch)
  }
}

export function trackFollowerMovement() {
  bot.on('move', handleMovement)
  bot.on('forcedMove', handleMovement)
  bot.on('entityElytraFlew', handleMovement)
  bot.on('entityAttributes', handleMovement)
  bot.on('entitySpawn', handleMovement)
  bot.on('entityGone', handleMovement)
  bot.on('entityMoved', handleMovement)
  bot.on('entityUpdate', handleMovement)

  const smoothUpdateLoop = () => {
    updateCameraSmoothing()
    requestAnimationFrame(smoothUpdateLoop)
  }
  requestAnimationFrame(smoothUpdateLoop)
  handleMovement()
}

export async function setFollowingPlayer(username?: string) {
  if (username && bot.players[username]) {
    console.log(`Following player '${username}'`)
    bot.whisper('watcher', `follow ${username}`)
    let target = bot.players[username]

    if (!target) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      target = bot.players[username]
    }

    if (!target) {
      console.error(`Failed to follow player '${username}' - player not found`)
      return
    }

    if (!target?.entity?.position) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    if (!target?.entity?.position) {
      console.error(`Failed to follow player '${username}' - could not find entity position`)
      return
    }

    window.following = target
    controMax.enabled = false
    customEvents.emit('followingPlayer', username)
  } else {
    console.log(`Following self (main bot)`)

    if (following !== bot && following?.entity?.position) {
      const { position, yaw, pitch } = getThirdPersonCameraPosition()
      bot.whisper('watcher', `unfollow ${position.x} ${position.y} ${position.z}`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      bot.look(yaw, pitch).catch(() => {})
    } else {
      bot.whisper('watcher', 'unfollow')
    }

    window.following = bot
    isSmoothingActive = false
    // lastTargetPosition = null
    controMax.enabled = true
    customEvents.emit('followingPlayer', undefined)
  }
}

customEvents.on('kradle:followPlayer', async (data) => {
  const { username } = data
  console.log(`Follow player '${username}' requested`)
  await setFollowingPlayer(username)
})
