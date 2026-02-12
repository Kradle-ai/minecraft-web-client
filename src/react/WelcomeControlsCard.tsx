import { useState, useEffect } from 'react'
import { appQueryParams } from '../appParams'
import { ArrowUp, ArrowDown, hintFontFamily } from './controlHintStyles'

interface Props {
  isFreeRoam: boolean
  onDismiss: (dontShowAgain: boolean) => void
}

const cardKeyStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  borderRadius: 6,
  border: '1px solid rgba(156, 163, 175, 0.5)',
  background: 'rgba(255, 255, 255, 0.08)',
  padding: '4px 10px',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12,
  minWidth: 32,
  letterSpacing: '0.02em',
}

const ControlRow = ({ keys, label }: { keys: React.ReactNode, label: string }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
  }}>
    <div style={{
      display: 'flex',
      gap: 4,
      minWidth: 120,
      justifyContent: 'flex-end',
    }}>
      {keys}
    </div>
    <div style={{
      color: 'rgba(255, 255, 255, 0.7)',
      fontSize: 13,
      fontWeight: 400,
    }}>
      {label}
    </div>
  </div>
)

export default function WelcomeControlsCard ({ isFreeRoam, onDismiss }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [isHoveringButton, setIsHoveringButton] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10_000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        fontFamily: hintFontFamily,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'rgba(15, 15, 20, 0.75)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          padding: '28px 36px',
          maxWidth: 420,
          width: '90vw',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
          color: '#fff',
        }}
      >
        {/* Title */}
        <div style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 4,
          letterSpacing: '-0.01em',
        }}>
          Camera Controls
        </div>
        <div style={{
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.45)',
          marginBottom: 20,
        }}>
          {isFreeRoam ? 'Free roam mode — fly around and explore' : 'Camera control is active'}
        </div>

        {/* Divider */}
        <div style={{
          height: 1,
          background: 'rgba(255, 255, 255, 0.08)',
          marginBottom: 12,
        }} />

        {/* Controls list */}
        <div style={{ marginBottom: 16 }}>
          <ControlRow
            keys={<span style={{ ...cardKeyStyle, borderColor: 'rgba(255, 255, 255, 0.5)' }}>ESC</span>}
            label="Exit camera control"
          />

          {isFreeRoam && (
            <>
              <ControlRow
                keys={<span style={{ ...cardKeyStyle, padding: '4px 8px' }}>Mouse / Trackpad</span>}
                label="Look around"
              />
              <ControlRow
                keys={<>
                  <span style={cardKeyStyle}>W</span>
                  <span style={cardKeyStyle}>A</span>
                  <span style={cardKeyStyle}>S</span>
                  <span style={cardKeyStyle}>D</span>
                </>}
                label="Move around"
              />
              <ControlRow
                keys={
                  <span style={{ ...cardKeyStyle, gap: 3 }}>Space <ArrowUp /></span>
                }
                label="Fly up"
              />
              <ControlRow
                keys={
                  <span style={{ ...cardKeyStyle, gap: 3 }}>Shift <ArrowDown /></span>
                }
                label="Fly down"
              />
              {appQueryParams.allowRecording === 'true' && (
                <ControlRow
                  keys={<span style={cardKeyStyle}>R</span>}
                  label="Record highlight"
                />
              )}
              <ControlRow
                keys={<span style={cardKeyStyle}>H</span>}
                label="Toggle help hints"
              />
            </>
          )}
        </div>

        {/* Divider */}
        <div style={{
          height: 1,
          background: 'rgba(255, 255, 255, 0.08)',
          marginBottom: 16,
        }} />

        {/* Bottom row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}>
          {/* Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              fontSize: 12,
              color: 'rgba(255, 255, 255, 0.5)',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              style={{
                width: 14,
                height: 14,
                cursor: 'pointer',
                accentColor: '#6366f1',
              }}
            />{' '}
            Don&apos;t show this again
          </label>

          {/* Got it button */}
          <button
            onClick={() => onDismiss(dontShowAgain)}
            onMouseEnter={() => setIsHoveringButton(true)}
            onMouseLeave={() => setIsHoveringButton(false)}
            style={{
              background: isHoveringButton ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 8,
              padding: '8px 24px',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              fontFamily: hintFontFamily,
              letterSpacing: '0.01em',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
