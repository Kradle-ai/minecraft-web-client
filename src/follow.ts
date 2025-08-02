import type { Vec3 } from 'vec3'

// Simple camera smoothing state
let currentCameraPos: Vec3 | null = null
let targetCameraPos: Vec3 | null = null
let currentYaw = 0
let targetYaw = 0
let currentPitch = 0
let targetPitch = 0
let isSmoothingActive = false
let lastTargetPosition: Vec3 | null = null // Track last target position for inertia

// Drone-like smoothing configuration
const POSITION_SMOOTHING_SPEED = 0.08 // Faster for better target tracking
const ROTATION_SMOOTHING_SPEED = 0.015 // Faster rotation for better responsiveness
const DRONE_HEIGHT_OFFSET = 2.25 // Higher up like a drone
const DRONE_DISTANCE = 4 // Slightly further back for better view
const DRONE_PITCH = -0.35 // Look down slightly like a drone camera
const INERTIA_FACTOR = 0.4 // Reduced lag for better target tracking (0-1, higher = more lag)


function handleMovement () {
  // Throttle the function to prevent excessive updates
  const now = Date.now()
  if (now - appViewer.lastCamUpdate < 16) { // 60fps cap
    return
  }

  // handle losing the entity
  if (following && !following?.entity?.position) {
    // if the following entity cannot be found, switch back to following the bot itself
    console.log('The entity to follow could no longer be found (left/died/too far away/etc.)')
    console.log('Switching back to following the bot itself')
    void setFollowingPlayer()
    return
  }

  appViewer.lastCamUpdate = Date.now()
  setThirdPersonCamera()
  void appViewer.worldView?.updatePosition(following.entity.position)
}

// Calculate the camera position and angle to follow the entity
function getThirdPersonCameraPosition () {
  const targetPosition: Vec3 = following.entity.position

  // Add inertia - camera lags behind target movement
  let smoothedTargetPosition = targetPosition
  if (lastTargetPosition) {
    // Interpolate between last position and current position for inertia
    smoothedTargetPosition = {
      x: lerp(lastTargetPosition.x, targetPosition.x, 1 - INERTIA_FACTOR),
      y: lerp(lastTargetPosition.y, targetPosition.y, 1 - INERTIA_FACTOR),
      z: lerp(lastTargetPosition.z, targetPosition.z, 1 - INERTIA_FACTOR)
    } as Vec3
  }
  lastTargetPosition = targetPosition

  // Calculate drone-like camera position - circles around the smoothed target
  const { yaw } = following.entity
  const distance = DRONE_DISTANCE
  const heightOffset = DRONE_HEIGHT_OFFSET

  // Create a circular orbit around the smoothed target
  // Add a slight offset to make it more dynamic and drone-like
  const orbitOffset = Math.sin(Date.now() * 0.000825) * 0.625 // Subtle circular motion
  const dx = Math.sin(yaw + orbitOffset) * distance
  const dz = Math.cos(yaw + orbitOffset) * distance

  // Create camera position manually to avoid Vec3 method dependencies
  const cameraPosition = {
    x: smoothedTargetPosition.x + dx,
    y: smoothedTargetPosition.y + heightOffset,
    z: smoothedTargetPosition.z + dz
  } as Vec3
  const cameraYaw = yaw + orbitOffset // Follow the target's rotation with slight offset
  const cameraPitch = DRONE_PITCH // Fixed drone-like pitch

  return {
    position: cameraPosition,
    yaw: cameraYaw,
    pitch: cameraPitch
  }
}

// Smooth interpolation with easing for drone-like movement
function smoothLerp(start: number, end: number, factor: number): number {
  // Use smoothstep function for more natural drone movement
  const smoothFactor = factor * factor * (3 - 2 * factor) // Smoothstep
  return start + (end - start) * smoothFactor
}

// Simple linear interpolation
function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor
}

// Update camera position smoothly
function updateCameraSmoothing() {
  if (!isSmoothingActive || !targetCameraPos) return

  // Initialize current position if not set
  if (!currentCameraPos) {
    currentCameraPos = { x: targetCameraPos.x, y: targetCameraPos.y, z: targetCameraPos.z } as Vec3
    currentYaw = targetYaw
    currentPitch = targetPitch
    return
  }

  // Interpolate position with smooth curves
  currentCameraPos.x = smoothLerp(currentCameraPos.x, targetCameraPos.x, POSITION_SMOOTHING_SPEED)
  currentCameraPos.y = smoothLerp(currentCameraPos.y, targetCameraPos.y, POSITION_SMOOTHING_SPEED)
  currentCameraPos.z = smoothLerp(currentCameraPos.z, targetCameraPos.z, POSITION_SMOOTHING_SPEED)

  // Interpolate rotation (handle yaw wrapping) - very smooth for drone
  let yawDiff = targetYaw - currentYaw
  if (yawDiff > Math.PI) yawDiff -= 2 * Math.PI
  if (yawDiff < -Math.PI) yawDiff += 2 * Math.PI
  currentYaw += yawDiff * ROTATION_SMOOTHING_SPEED

  currentPitch = smoothLerp(currentPitch, targetPitch, ROTATION_SMOOTHING_SPEED)

  // Update camera
  appViewer.backend?.updateCamera(currentCameraPos, currentYaw, currentPitch)
}

export function setThirdPersonCamera (directionOnly = false) {
  // TODO: we can also be smarter about the camera to avoid obstacles coming in between.
  // and also handling special situations like water, lava, ladders, etc.

  // if the bot itself is being followed, just use first person camera normally
  if (following === bot) {
    const { position, yaw, pitch } = bot.entity
    appViewer.backend?.updateCamera(directionOnly ? null : position, yaw, pitch)
    return
  }

  // if the followed entity position cannot be found, just return. This will get retried later
  if (!following?.entity?.position) {
    console.warn('Cannot set third person camera. The followed entity position could not be found')
    return
  }

  // update the third person camera
  const { position, yaw, pitch } = getThirdPersonCameraPosition()
  
  // Set target for smoothing
  targetCameraPos = position
  targetYaw = yaw
  targetPitch = pitch
  isSmoothingActive = true
  
  // Fallback to direct update if smoothing is not available
  if (!currentCameraPos) {
    appViewer.backend?.updateCamera(directionOnly ? null : position, yaw, pitch)
  }
}

export function trackFollowerMovement () {
  bot.on('move', () => handleMovement())
  bot.on('forcedMove', () => handleMovement())

  // Handle Entity Changes
  bot.on('entityElytraFlew', () => handleMovement())
  bot.on('entityAttributes', () => handleMovement())
  bot.on('entitySpawn', () => handleMovement())
  bot.on('entityGone', () => handleMovement())
  bot.on('entityMoved', () => handleMovement())
  bot.on('entityUpdate', () => handleMovement())

  // Simple continuous camera smoothing update loop
  const smoothUpdateLoop = () => {
    updateCameraSmoothing()
    requestAnimationFrame(smoothUpdateLoop)
  }
  
  // Start the smooth update loop
  requestAnimationFrame(smoothUpdateLoop)

  handleMovement()
}

export async function setFollowingPlayer (username?: string) {
  if (username && bot.players[username]) {
    // start following player
    console.log(`Following player '${username}'`)

    // tell the watcher to keep us in range of the target player
    // via teleporting to the target player
    bot.whisper('watcher', `follow ${username}`)


    let target = bot.players[username]

    // check if the player exists, and wait sec if it doesn't
    if (!target) {
      await new Promise(resolve => { setTimeout(resolve, 1000) })
      target = bot.players[username]
    }

    // if there's still no target, give up
    if (!target) {
      // It still hasn't loaded, give up on following
      console.error(`Failed to follow player '${username}' - player not found`)
      return
    }

    // check if the target entity position is loaded, otherwise wait a bit
    if (!target?.entity?.position) {
      await new Promise(resolve => { setTimeout(resolve, 1000) })
    }

    // if there's still no target, give up
    if (!target?.entity?.position) {
      // It still hasn't loaded, give up on following
      console.error(`Failed to follow player '${username}' - could not find entity position`)
      return
    }

    // set the following player
    window.following = target

    // Reset camera smoothing for new target
    currentCameraPos = null
    isSmoothingActive = false
    lastTargetPosition = null // Reset inertia for new target

    // disable keyboard control of bot
    controMax.enabled = false

    // notify any listeners
    customEvents.emit('followingPlayer', username)
  } else {
    // stop following
    console.log(`Following self (main bot)`)

    // tell the watcher to stop following
    if (following !== bot && following?.entity?.position) {
      // unfollow and move to current camera position
      const { position, yaw, pitch } = getThirdPersonCameraPosition()
      bot.whisper('watcher', `unfollow ${position.x} ${position.y} ${position.z}`)
      // wait a bit so the teleport is complete before switching the camera
      await new Promise(resolve => { setTimeout(resolve, 500) })
      bot.look(yaw, pitch).catch(() => { }) // maintain camera position
    } else {
      // simply unfollow
      bot.whisper('watcher', 'unfollow')
    }

    // set the following player to the main bot
    window.following = bot

    // Reset camera smoothing for bot following
    currentCameraPos = null
    isSmoothingActive = false
    lastTargetPosition = null // Reset inertia for new target

    // enable keyboard control of bot
    controMax.enabled = true

    // notify any listeners
    customEvents.emit('followingPlayer', undefined)
  }
}

// Handle Kradle Custom Events
customEvents.on('kradle:followPlayer', async (data) => {
  const { username } = data

  console.log(`Follow player '${username}' requested`)

  // undefined means following self
  if (!username) {
    await setFollowingPlayer()
    return
  }

  // Follow the player
  await setFollowingPlayer(username)
})
