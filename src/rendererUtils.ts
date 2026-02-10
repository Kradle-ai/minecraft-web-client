import { subscribeKey } from 'valtio/utils'
import { gameAdditionalState } from './globalState'
import { options } from './optionsStorage'
import { playerState } from './mineflayer/playerState'
import { updateCameraForCurrentMode } from './interactiveControls'

let currentFov = 0
let targetFov = 0
let lastUpdateTime = 0
const FOV_TRANSITION_DURATION = 200 // milliseconds

// TODO: These should be configured based on your game's settings
const BASE_MOVEMENT_SPEED = 0.1 // Default walking speed in Minecraft
const FOV_EFFECT_SCALE = 1 // Equivalent to Minecraft's FOV Effects slider

const updateFovAnimation = () => {
  if (!bot) return

  // Calculate base FOV modifier
  let fovModifier = 1

  // Flying modifier
  if (gameAdditionalState.isFlying) {
    fovModifier *= 1.05
  }

  // Movement speed modifier
  // TODO: Get actual movement speed attribute value
  const movementSpeedAttr = (bot.entity?.attributes?.['generic.movement_speed'] || bot.entity?.attributes?.['minecraft:movement_speed'] || bot.entity?.attributes?.['movement_speed'] || bot.entity?.attributes?.['minecraft:movementSpeed'])?.value || BASE_MOVEMENT_SPEED
  let currentSpeed = BASE_MOVEMENT_SPEED
  // todo
  if (bot.controlState?.sprint && !bot.controlState?.sneak) {
    currentSpeed *= 1.3
  }
  fovModifier *= (currentSpeed / movementSpeedAttr + 1) / 2

  // Validate fov modifier
  if (Math.abs(BASE_MOVEMENT_SPEED) < Number.EPSILON || isNaN(fovModifier) || !isFinite(fovModifier)) {
    fovModifier = 1
  }

  // Item usage modifier
  if (playerState.getHeldItem()) {
    const heldItem = playerState.getHeldItem()
    if (heldItem?.name === 'bow' && playerState.getItemUsageTicks() > 0) {
      const ticksUsingItem = playerState.getItemUsageTicks()
      let usageProgress = ticksUsingItem / 20
      if (usageProgress > 1) {
        usageProgress = 1
      } else {
        usageProgress *= usageProgress
      }
      fovModifier *= 1 - usageProgress * 0.15
    }
    // TODO: Add spyglass/scope check here if needed
  }

  // Apply FOV effect scale
  fovModifier = 1 + (fovModifier - 1) * FOV_EFFECT_SCALE

  // Calculate target FOV
  const baseFov = gameAdditionalState.isZooming ? 30 : options.fov
  targetFov = baseFov * fovModifier

  // Smooth transition
  const now = performance.now()
  if (currentFov !== targetFov) {
    const elapsed = now - lastUpdateTime
    const progress = Math.min(elapsed / FOV_TRANSITION_DURATION, 1)
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

    currentFov += (targetFov - currentFov) * easeOutCubic(progress)

    if (Math.abs(currentFov - targetFov) < 0.01) {
      currentFov = targetFov
    }

    appViewer.inWorldRenderingConfig.fov = currentFov
  }
  lastUpdateTime = now
}

export const watchFov = () => {
  // Initial FOV setup
  if (!beforeRenderFrame.includes(updateFovAnimation)) {
    beforeRenderFrame.push(updateFovAnimation)
  }

  customEvents.on('gameLoaded', () => {
    updateFovAnimation()
  })

  subscribeKey(gameAdditionalState, 'isSneaking', () => {
    updateCameraForCurrentMode()
  })
}
