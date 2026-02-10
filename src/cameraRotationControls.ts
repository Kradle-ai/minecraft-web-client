import { contro } from './controls'
import { activeModalStack, isGameActive, miscUiState, showModal } from './globalState'
import { options } from './optionsStorage'
import { hideNotification, notificationProxy } from './react/NotificationProvider'
import { pointerLock } from './utils'
import { updateMotion, initMotionTracking } from './react/uiMotion'
import { getSpectatorCameraPosition, getSpectatorCameraDirection, updateSpectatorCameraDirection } from './interactiveControls'

let lastMouseMove: number

export type CameraMoveEvent = {
  movementX: number
  movementY: number
  type: string
  stopPropagation?: () => void
}

export function onCameraMove (e: MouseEvent | CameraMoveEvent) {
  if (!isGameActive(true)) return
  if (e.type === 'mousemove' && !document.pointerLockElement) return
  e.stopPropagation?.()
  const now = performance.now()
  // todo: limit camera movement for now to avoid unexpected jumps
  if (now - lastMouseMove < 4 && !options.preciseMouseInput) return
  lastMouseMove = now
  let { mouseSensX, mouseSensY } = options
  if (mouseSensY === -1) mouseSensY = mouseSensX
  moveCameraRawHandler({
    x: e.movementX * mouseSensX * 0.0001,
    y: e.movementY * mouseSensY * 0.0001
  })
  bot.mouse.update()
  updateMotion()
}


function moveCameraRawHandler ({ x, y }: { x: number; y: number }) {
  const maxPitch = 0.5 * Math.PI
  const minPitch = -0.5 * Math.PI

  appViewer.lastCamUpdate = Date.now()

  if (!bot?.entity) return

  // In freeRoam, update spectator direction independently of bot.entity
  const spectatorDir = getSpectatorCameraDirection()
  if (getSpectatorCameraPosition() && spectatorDir) {
    const newYaw = spectatorDir.yaw - x
    const newPitch = Math.max(minPitch, Math.min(maxPitch, spectatorDir.pitch - y))
    updateSpectatorCameraDirection(newYaw, newPitch)
    appViewer.backend?.updateCamera(null, newYaw, newPitch)
    return
  }

  const newPitch = Math.max(minPitch, Math.min(maxPitch, bot.entity.pitch - y))
  void bot.look(bot.entity.yaw - x, newPitch, true)
  appViewer.backend?.updateCamera(null, bot.entity.yaw, newPitch)
}

window.addEventListener('mousemove', (e: MouseEvent) => {
  if (following === bot) {
    onCameraMove(e)
  } else {
    // TODO: support user camera orbiting when following a player
  }
}, { capture: true })

export const onControInit = () => {
  contro.on('stickMovement', ({ stick, vector }) => {
    if (!isGameActive(true)) return
    if (stick !== 'right') return
    let { x, z } = vector
    if (Math.abs(x) < 0.18) x = 0
    if (Math.abs(z) < 0.18) z = 0
    onCameraMove({
      movementX: x * 10,
      movementY: z * 10,
      type: 'stickMovement',
      stopPropagation () {}
    } as CameraMoveEvent)
    miscUiState.usingGamepadInput = true
  })
}

function pointerLockChangeCallback () {
  if (notificationProxy.id === 'pointerlockchange') {
    hideNotification()
  }
  if (appViewer.rendererState.preventEscapeMenu) return
  if (!pointerLock.hasPointerLock && activeModalStack.length === 0 && miscUiState.gameLoaded) {
    // @pranaygp - disabled pause screen to support auto follow
    // showModal({ reactType: 'pause-screen' })
  }
}

document.addEventListener('pointerlockchange', pointerLockChangeCallback, false)
