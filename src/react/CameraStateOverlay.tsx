import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { cameraState, getSpectatorCameraPosition, getSpectatorCameraDirection, getBirdsEyeTrackedPlayers } from '../interactiveControls'

function formatDirection (): string {
  const specDir = getSpectatorCameraDirection()
  if (specDir) {
    return `${specDir.yaw.toFixed(2)} / ${specDir.pitch.toFixed(2)}`
  }
  if (bot?.entity) {
    return `${bot.entity.yaw.toFixed(2)} / ${bot.entity.pitch.toFixed(2)}`
  }
  return '-'
}

function formatSpectatorPos (): string | null {
  const pos = getSpectatorCameraPosition()
  if (!pos) return null
  return `${pos.x.toFixed(1)} / ${pos.y.toFixed(1)} / ${pos.z.toFixed(1)}`
}

function getFollowingDisplay (mode: string, trackedPlayers: string[]): string {
  if (mode === 'birdsEye') {
    return trackedPlayers.length > 0 ? trackedPlayers.join(', ') : 'none'
  }
  return window.following?.username ?? '-'
}

export default function CameraStateOverlay () {
  const camera = useSnapshot(cameraState)
  const [spectatorPos, setSpectatorPos] = useState<string | null>(null)
  const [direction, setDirection] = useState<string>('-')
  const [trackedPlayers, setTrackedPlayers] = useState<string[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      setSpectatorPos(formatSpectatorPos())
      setDirection(formatDirection())
      setTrackedPlayers(getBirdsEyeTrackedPlayers())
    }, 200)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      zIndex: 1,
      padding: '2px 4px',
      background: 'rgba(0, 0, 0, 0.5)',
      color: 'white',
      fontFamily: 'monospace',
      fontSize: '4px',
      lineHeight: 1.4,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <div>cam: {camera.mode}{camera.target ? ` (${camera.target})` : ''}</div>
      <div>following: {getFollowingDisplay(camera.mode, trackedPlayers)}</div>
      <div>dir: {direction}</div>
      {spectatorPos && <div>spec: {spectatorPos}</div>}
    </div>
  )
}
