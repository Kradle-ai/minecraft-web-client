import { useState, useEffect, useRef } from 'react'
import { cameraState } from '../interactiveControls'
import { appQueryParams } from '../appParams'

const ArrowUp = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
)

const ArrowDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
)

const keyStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: 4,
  border: '1px solid rgba(156, 163, 175, 0.4)',
  background: 'rgba(0, 0, 0, 0.35)',
  padding: '2px 6px',
  color: '#fff',
  fontWeight: 600,
  fontSize: 10,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#fff',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 500,
  letterSpacing: '0.025em',
  color: 'rgba(255, 255, 255, 0.8)',
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: 'rgba(255, 255, 255, 0.2)',
  margin: '0 4px',
}

const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '6px 12px',
  borderRadius: 9999,
}

export default function InteractiveControlsHint () {
  const [hasPointerLock, setHasPointerLock] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isFading, setIsFading] = useState(false)
  const [isFreeRoam, setIsFreeRoam] = useState(false)
  const timerRef = useRef<number | null>(null)
  const fadeStartedRef = useRef(false)
  const helpModeRef = useRef(false)

  useEffect(() => {
    const startFadeTimer = () => {
      if (fadeStartedRef.current) return
      fadeStartedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setIsFading(true)
        timerRef.current = window.setTimeout(() => {
          setIsVisible(false)
        }, 500)
      }, 3000)
    }

    const fadeOutNow = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setIsFading(true)
      timerRef.current = window.setTimeout(() => {
        setIsVisible(false)
      }, 500)
    }

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement !== null

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      if (locked) {
        setHasPointerLock(true)
        setIsVisible(true)
        setIsFading(false)
        setIsFreeRoam(cameraState.mode === 'freeRoam')
        fadeStartedRef.current = false
        helpModeRef.current = false
      } else {
        setIsFading(true)
        fadeStartedRef.current = false
        helpModeRef.current = false
        timerRef.current = window.setTimeout(() => {
          setHasPointerLock(false)
          setIsVisible(false)
        }, 500)
      }
    }

    const handleInput = (e: Event) => {
      if (!document.pointerLockElement) return
      // H key toggles help mode (only in freeRoam)
      if (e instanceof KeyboardEvent && e.code === 'KeyH' && !e.repeat && cameraState.mode === 'freeRoam') {
        if (helpModeRef.current) {
          helpModeRef.current = false
          fadeOutNow()
        } else {
          helpModeRef.current = true
          fadeStartedRef.current = false
          if (timerRef.current) clearTimeout(timerRef.current)
          setIsVisible(true)
          setIsFading(false)
          setIsFreeRoam(true)
        }
        return
      }
      // Any other input while help mode is active — dismiss immediately
      if (helpModeRef.current) {
        helpModeRef.current = false
        fadeOutNow()
        return
      }
      startFadeTimer()
    }

    document.addEventListener('pointerlockchange', handlePointerLockChange)
    document.addEventListener('keydown', handleInput, true)
    window.addEventListener('mousemove', handleInput, true)
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      document.removeEventListener('keydown', handleInput, true)
      window.removeEventListener('mousemove', handleInput, true)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  if (!hasPointerLock || !isVisible) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        opacity: isFading ? 0 : 1,
        transition: 'opacity 0.5s ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* ESC hint */}
      <div style={pillStyle}>
        <div style={rowStyle}>
          <span style={{ ...keyStyle, color: '#fff', borderColor: 'rgba(255, 255, 255, 0.5)' }}>ESC</span>
          <span style={{ ...labelStyle, color: '#fff' }}>Exit Camera Control</span>
        </div>
      </div>

      {isFreeRoam && (
        <>
          {/* Move / Fly */}
          <div style={pillStyle}>
            <div style={rowStyle}>
              <span style={keyStyle}>W</span>
              <span style={keyStyle}>A</span>
              <span style={keyStyle}>S</span>
              <span style={keyStyle}>D</span>
              <span style={labelStyle}>Move</span>
            </div>
            <div style={separatorStyle} />
            <div style={rowStyle}>
              <span style={{ ...keyStyle, gap: 3 }}>Space <ArrowUp /></span>
              <span style={{ ...keyStyle, gap: 3 }}>Shift <ArrowDown /></span>
              <span style={labelStyle}>Fly</span>
            </div>
          </div>

          {/* Record / Media / Help */}
          <div style={pillStyle}>
            {appQueryParams.allowRecording === 'true' && (
              <>
                <div style={rowStyle}>
                  <span style={keyStyle}>R</span>
                  <span style={labelStyle}>Record Highlight</span>
                </div>
                <div style={separatorStyle} />
              </>
            )}
            <div style={rowStyle}>
              <span style={keyStyle}>H</span>
              <span style={labelStyle}>Help</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
