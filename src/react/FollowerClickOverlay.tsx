import { type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import { cameraState, getBirdsEyeCameraPosition, getThirdPersonCameraPosition, setSpectatorCameraPosition, reportCameraState } from '../interactiveControls'
import { pointerLock } from '../utils'
import { toggleFly } from '../controls'

function focusCanvas () {
  const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
  if (canvas) {
    if (!canvas.hasAttribute('tabindex')) {
      canvas.setAttribute('tabindex', '-1')
    }
    canvas.focus()
  } else {
    document.documentElement.focus()
  }
}

function getCameraPositionForCurrentMode (mode: string) {
  if (mode === 'birdsEye') return getBirdsEyeCameraPosition()
  if (mode === 'thirdPerson') return getThirdPersonCameraPosition()
  return null
}

export default function FollowerClickOverlay () {
  const camera = useSnapshot(cameraState)
  const [isHovered, setIsHovered] = useState(false)

  const showOverlay = camera.mode === 'thirdPerson' || camera.mode === 'birdsEye'

  if (!showOverlay) return null

  function onPointerDownCapture (e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
  }

  function onClick (e: ReactMouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    const cameraPosition = getCameraPositionForCurrentMode(camera.mode)

    // Set spectator camera position and direction to match current camera
    if (cameraPosition?.position) {
      const { position, yaw, pitch } = cameraPosition
      setSpectatorCameraPosition(position, yaw, pitch)
      toggleFly(true)
    }

    // Enter freeRoam via setCamera would reset spectator position,
    // so we set it up manually above and just update state
    window.following = bot
    cameraState.mode = 'freeRoam'
    cameraState.target = null
    controMax.enabled = true
    reportCameraState()
    void pointerLock.requestPointerLock()

    setTimeout(focusCanvas, 100)
  }

  const displayText = camera.mode === 'birdsEye'
    ? 'You are in bird\'s eye view mode'
    : `You are following ${camera.target}`

  return (
    <div
      onPointerDownCapture={onPointerDownCapture}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        opacity: isHovered ? 1 : 0,
        cursor: 'pointer',
        transition: 'opacity 0.3s ease',
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <div style={{ textAlign: 'center', color: 'white', pointerEvents: 'none', fontSize: 10 }}>
        <div>{displayText}</div>
        <div>Click to enter spectator mode and control camera</div>
      </div>
    </div>
  )
}
