import { useState, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { cameraState, setCamera, getTrackedPlayersWithStatus, type PlayerUnavailableReason } from '../interactiveControls'
import { appQueryParams } from '../appParams'
import { gameAdditionalState } from '../globalState'
import { viewerVersionState } from '../viewerConnector'

const font = 'system-ui, -apple-system, sans-serif'
const replayAccentColor = '#f59e0b'
const liveAccentColor = '#ef4444'

const PlayIcon = () => (
  <svg style={{ width: 12, height: 12, color: replayAccentColor }} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const LiveDot = () => (
  <div style={{
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: liveAccentColor,
    boxShadow: `0 0 6px ${liveAccentColor}`,
  }} />
)

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    style={{
      width: 12,
      height: 12,
      color: 'rgba(255,255,255,0.5)',
      transition: 'transform 0.15s ease',
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
)

const EyeIcon = () => (
  <svg style={{ width: 14, height: 14, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

const GlobeIcon = () => (
  <svg style={{ width: 14, height: 14, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const SectionLabel = ({ children }: { children: string }) => (
  <div style={{
    padding: '4px 12px',
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontFamily: font,
  }}>
    {children}
  </div>
)

const MenuItem = ({ icon, label, sublabel, active, disabled, onClick, accentColor }: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  accentColor: string
}) => {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: !disabled && hovered ? 'rgba(255,255,255,0.1)' : 'transparent',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? 'rgba(255, 255, 255, 0.9)' : active ? accentColor : '#fff',
        fontFamily: font,
        fontSize: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3 }}>
        {label}
        {sublabel && (
          <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 11 }}>{sublabel}</span>
        )}
      </span>
    </button>
  )
}

function formatTime (ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function useLiveElapsed (): string | null {
  const { time: startTime } = useSnapshot(viewerVersionState)
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!startTime) return
    const tick = () => setElapsed(formatTime(Date.now() - startTime))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  return startTime ? elapsed : null
}

type DropdownMode = 'replay' | 'live' | null

function useDropdownMode (): DropdownMode {
  const { viewerConnection } = useSnapshot(gameAdditionalState)
  if (viewerConnection) return 'live'
  const isReplay = !!(appQueryParams.replayFileUrl || appQueryParams.replayUrl)
  if (isReplay) return 'replay'
  return null
}

export default function ReplayDropdown () {
  const mode = useDropdownMode()
  const camera = useSnapshot(cameraState)
  const liveElapsed = useLiveElapsed()
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<Array<{ username: string, available: boolean, reason: PlayerUnavailableReason }>>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mode) return
    const update = () => setPlayers(getTrackedPlayersWithStatus())
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [mode])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!mode) return null

  const isLive = mode === 'live'
  const accentColor = isLive ? liveAccentColor : replayAccentColor

  const getActiveLabel = () => {
    if (camera.mode === 'birdsEye') return 'Bird\'s Eye'
    if (camera.mode === 'freeRoam') return 'Free Roam'
    if (camera.mode === 'thirdPerson' && camera.target) return camera.target
    return 'Camera'
  }

  const handleCameraMode = (mode: 'birdsEye' | 'freeRoam') => {
    setCamera({ mode })
    setOpen(false)
  }

  const handleFollowPlayer = (username: string) => {
    setCamera({ mode: 'thirdPerson', target: username })
    setOpen(false)
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 1000,
        fontFamily: font,
      }}
    >
      {/* Pill trigger */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderRadius: 9999,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {isLive ? <LiveDot /> : <PlayIcon />}
        <span style={{ color: accentColor, fontWeight: 600 }}>{isLive ? 'LIVE' : 'INTERACTIVE REPLAY'}</span>
        <div style={{ width: 1, height: 14, background: 'rgba(255, 255, 255, 0.2)' }} />
        {isLive && liveElapsed && <>
          <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{liveElapsed}</span>
          <div style={{ width: 1, height: 14, background: 'rgba(255, 255, 255, 0.2)' }} />
        </>}
        <span style={{ fontWeight: 500 }}>{getActiveLabel()}</span>
        <ChevronIcon open={open} />
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          paddingTop: 4,
        }}>
          <div style={{
            minWidth: 200,
            borderRadius: 12,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            padding: '6px 0',
            fontSize: 12,
            color: '#fff',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
          }}>
            <SectionLabel>Camera</SectionLabel>
            <MenuItem
              icon={<EyeIcon />}
              label="Bird's Eye"
              sublabel="overhead view of action"
              active={camera.mode === 'birdsEye'}
              accentColor={accentColor}
              onClick={() => handleCameraMode('birdsEye')}
            />
            <MenuItem
              icon={<GlobeIcon />}
              label="Free Roam"
              sublabel="click viewport to fly"
              active={camera.mode === 'freeRoam'}
              accentColor={accentColor}
              onClick={() => handleCameraMode('freeRoam')}
            />

            {players.length > 0 && (
              <>
                <div style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  margin: '6px 8px',
                }} />
                <SectionLabel>Follow Agent</SectionLabel>
                {players.map(({ username, available, reason }) => (
                  <MenuItem
                    key={username}
                    icon={<span style={{ fontSize: 14, lineHeight: 1 }}>🤖</span>}
                    label={username}
                    sublabel={!available && reason ? reason : undefined}
                    active={camera.mode === 'thirdPerson' && camera.target === username}
                    disabled={!available}
                    accentColor={accentColor}
                    onClick={() => handleFollowPlayer(username)}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
