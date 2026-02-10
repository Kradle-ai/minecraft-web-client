import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { cameraState, getSpectatorCameraPosition } from '../interactiveControls'

export default function CameraStateOverlay () {
  const camera = useSnapshot(cameraState)
  const [spectatorPos, setSpectatorPos] = useState<string | null>(null)
  const [botDir, setBotDir] = useState<string>('-')

  useEffect(() => {
    const interval = setInterval(() => {
      const specPos = getSpectatorCameraPosition()
      if (specPos) {
        setSpectatorPos(`${specPos.x.toFixed(1)} / ${specPos.y.toFixed(1)} / ${specPos.z.toFixed(1)}`)
      } else {
        setSpectatorPos(null)
      }
      if (bot?.entity) {
        setBotDir(`${bot.entity.yaw.toFixed(2)} / ${bot.entity.pitch.toFixed(2)}`)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 1,
      padding: '2px 4px',
      background: 'rgba(0, 0, 0, 0.5)',
      color: 'white',
      fontFamily: 'monospace',
      fontSize: '9px',
      lineHeight: 1.4,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <div>cam: {camera.mode}{camera.target ? ` (${camera.target})` : ''}</div>
      <div>following: {window.following?.username ?? '-'}</div>
      <div>dir: {botDir}</div>
      {spectatorPos && <div>spec: {spectatorPos}</div>}
    </div>
  )
}
