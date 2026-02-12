import type React from 'react'

export const ArrowUp = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
)

export const ArrowDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
)

export const keyStyle: React.CSSProperties = {
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

export const labelStyle: React.CSSProperties = {
  fontWeight: 500,
  letterSpacing: '0.025em',
  color: 'rgba(255, 255, 255, 0.8)',
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
}

export const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#fff',
}

export const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: 'rgba(255, 255, 255, 0.2)',
  margin: '0 4px',
}

export const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  padding: '6px 12px',
  borderRadius: 9999,
}

export const hintFontFamily = 'system-ui, -apple-system, sans-serif'
