import React, { useState } from 'react'
import { useSnapshot } from 'valtio'
import { cameraState, getBirdsEyeCameraPosition, getThirdPersonCameraPosition, setSpectatorCameraPosition, reportCameraState } from '../interactiveControls'
import { pointerLock } from '../utils'
import { toggleFly } from '../controls'

// Helper function to focus the canvas for keyboard input
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

export default function FollowerClickOverlay () {
  const camera = useSnapshot(cameraState)
  const [isHovered, setIsHovered] = useState(false)

  // Show overlay when in thirdPerson or birdsEyeView mode
  const showOverlay = camera.mode === 'thirdPerson' || camera.mode === 'birdsEyeView'

  const onPointerDownCapture = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation?.()
  }

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Get camera position based on current mode for smooth transition
    let cameraPosition: { position: import('vec3').Vec3; yaw: number; pitch: number } | null = null
    if (camera.mode === 'birdsEyeView') {
      cameraPosition = getBirdsEyeCameraPosition()
    } else if (camera.mode === 'thirdPerson') {
      cameraPosition = getThirdPersonCameraPosition()
    }

    // Set spectator camera position to match current camera
    if (cameraPosition?.position) {
      const { position, yaw, pitch } = cameraPosition
      setSpectatorCameraPosition(position)
      toggleFly(true)
      setTimeout(() => {
        bot.look(yaw, pitch).catch(() => {})
      }, 50)
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

  if (!showOverlay) return null

  const displayText = camera.mode === 'birdsEyeView'
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
