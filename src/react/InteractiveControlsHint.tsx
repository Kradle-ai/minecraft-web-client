import { useState, useEffect, useRef } from 'react'
import { cameraState } from '../interactiveControls'
import { pointerLock } from '../utils'
import { appStorage } from './appStorageProvider'
import WelcomeControlsCard from './WelcomeControlsCard'
import { keyStyle, rowStyle, labelStyle, separatorStyle, pillStyle, hintFontFamily } from './controlHintStyles'

// Allows external code to skip the welcome popup for the next pointer lock
let skipWelcomeOnce = false
export function suppressNextWelcome () {
  skipWelcomeOnce = true
}

export default function InteractiveControlsHint () {
  const [hasPointerLock, setHasPointerLock] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isFading, setIsFading] = useState(false)
  const [isFreeRoam, setIsFreeRoam] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const timerRef = useRef<number | null>(null)
  const fadeStartedRef = useRef(false)
  const welcomeActiveRef = useRef(false)
  // Suppresses welcome for the current pointer lock session (resets on full release)
  const dismissedThisSessionRef = useRef(false)

  const handleWelcomeDismiss = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      appStorage.hideControlsWelcome = true
    }
    welcomeActiveRef.current = false
    dismissedThisSessionRef.current = true
    setShowWelcome(false)
    // Small delay to let browser fully process exitPointerLock before re-requesting
    setTimeout(() => {
      void pointerLock.requestPointerLock()
    }, 50)
  }

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

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement !== null

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      if (locked) {
        const freeRoam = cameraState.mode === 'freeRoam'
        setIsFreeRoam(freeRoam)

        if (skipWelcomeOnce) {
          skipWelcomeOnce = false
        } else if (!appStorage.hideControlsWelcome && !dismissedThisSessionRef.current) {
          welcomeActiveRef.current = true
          fadeStartedRef.current = false
          setShowWelcome(true)
          setHasPointerLock(false)
          document.exitPointerLock?.()
          return
        }

        setHasPointerLock(true)
        setIsVisible(true)
        setIsFading(false)
        fadeStartedRef.current = false
      } else {
        // Ignore pointer lock release caused by welcome modal
        if (welcomeActiveRef.current) return

        dismissedThisSessionRef.current = false
        setIsFading(true)
        fadeStartedRef.current = false
        timerRef.current = window.setTimeout(() => {
          setHasPointerLock(false)
          setIsVisible(false)
        }, 500)
      }
    }

    const handleInput = (e: Event) => {
      if (!(e instanceof KeyboardEvent) || e.code !== 'KeyH' || e.repeat) {
        if (document.pointerLockElement) startFadeTimer()
        return
      }

      // H key toggles welcome card (only in freeRoam)
      if (cameraState.mode !== 'freeRoam') return

      if (welcomeActiveRef.current) {
        // Card is showing — dismiss it
        welcomeActiveRef.current = false
        dismissedThisSessionRef.current = true
        setShowWelcome(false)
        setTimeout(() => {
          void pointerLock.requestPointerLock()
        }, 50)
      } else if (document.pointerLockElement) {
        // Card is not showing — open it
        welcomeActiveRef.current = true
        setIsFreeRoam(true)
        setShowWelcome(true)
        setHasPointerLock(false)
        document.exitPointerLock?.()
      }
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

  if (showWelcome) {
    return <WelcomeControlsCard isFreeRoam={isFreeRoam} onDismiss={handleWelcomeDismiss} />
  }

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
        fontFamily: hintFontFamily,
        opacity: isFading ? 0 : 1,
        transition: 'opacity 0.5s ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={pillStyle}>
        <div style={rowStyle}>
          <span style={{ ...keyStyle, color: '#fff', borderColor: 'rgba(255, 255, 255, 0.5)' }}>ESC</span>
          <span style={{ ...labelStyle, color: '#fff' }}>Exit Camera Control</span>
        </div>
        {isFreeRoam && (
          <>
            <div style={separatorStyle} />
            <div style={rowStyle}>
              <span style={keyStyle}>H</span>
              <span style={labelStyle}>Help</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
