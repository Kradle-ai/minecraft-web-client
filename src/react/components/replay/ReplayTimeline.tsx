import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { packetsReplayState } from '../../state/packetsReplayState'
import type { ChatMarker } from '../../state/packetsReplayState'
import { appQueryParams } from '../../../appParams'

const HIDE_DELAY_MS = 2500

const MARKER_COLORS = [
  '#f87171', // red
  '#2dd4bf', // teal
  '#a78bfa', // violet
  '#fb923c', // orange
  '#38bdf8', // sky
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
]

function getPlayerColor (sender: string, senderList: string[]): string {
  const index = senderList.indexOf(sender)
  return MARKER_COLORS[index % MARKER_COLORS.length]
}

function formatTime (ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function ReplayTimeline () {
  const state = useSnapshot(packetsReplayState)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const hideTimeoutRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState<number | null>(null)
  const [hoverProgress, setHoverProgress] = useState<number | null>(null)
  const [isBarHovered, setIsBarHovered] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isPlayHovered, setIsPlayHovered] = useState(false)

  const realProgress = state.totalDurationMs > 0
    ? state.currentTimeMs / state.totalDurationMs
    : 0
  const progress = dragProgress ?? realProgress

  const chatMarkers: ChatMarker[] = Array.isArray(state.chatMarkers) ? [...state.chatMarkers] as ChatMarker[] : []
  const markerCount = chatMarkers.length
  const uniqueSenders = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const m of chatMarkers) {
      if (!seen.has(m.sender)) {
        seen.add(m.sender)
        result.push(m.sender)
      }
    }
    return result
  }, [markerCount])

  // Group markers into clusters (within 3 seconds of each other)
  interface MarkerCluster {
    positionMs: number // average time of the cluster
    markers: ChatMarker[]
  }
  const clusters = useMemo((): MarkerCluster[] => {
    if (markerCount === 0 || state.totalDurationMs === 0) return []
    const sorted = [...chatMarkers].sort((a, b) => a.timeMs - b.timeMs)
    const result: MarkerCluster[] = []
    let current: ChatMarker[] = [sorted[0]]
    let clusterStart = sorted[0].timeMs
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timeMs - clusterStart <= 5000) {
        current.push(sorted[i])
      } else {
        const avg = current.reduce((sum, m) => sum + m.timeMs, 0) / current.length
        result.push({ positionMs: avg, markers: current })
        current = [sorted[i]]
        clusterStart = sorted[i].timeMs
      }
    }
    const avg = current.reduce((sum, m) => sum + m.timeMs, 0) / current.length
    result.push({ positionMs: avg, markers: current })
    return result
  }, [markerCount, state.totalDurationMs])

  // Find the cluster closest to the hover position
  const hoveredCluster = useMemo((): MarkerCluster | null => {
    if (hoverProgress === null || state.totalDurationMs === 0 || clusters.length === 0) return null
    const hoverMs = hoverProgress * state.totalDurationMs
    const thresholdMs = state.totalDurationMs * 0.01
    let closest: MarkerCluster | null = null
    let closestDist = Infinity
    for (const cluster of clusters) {
      const dist = Math.abs(cluster.positionMs - hoverMs)
      if (dist < thresholdMs && dist < closestDist) {
        closestDist = dist
        closest = cluster
      }
    }
    return closest
  }, [hoverProgress, clusters, state.totalDurationMs])

  const showControls = useCallback(() => {
    setIsVisible(true)
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      if (!isDragging) {
        setIsVisible(false)
      }
    }, HIDE_DELAY_MS)
  }, [isDragging])

  const handlePlayPause = () => {
    packetsReplayState.isPlaying = !state.isPlaying
  }

  const calculateProgress = useCallback((clientX: number): number => {
    if (!progressBarRef.current) return 0
    const rect = progressBarRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    return Math.max(0, Math.min(1, x / rect.width))
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragProgress(calculateProgress(e.clientX))
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setDragProgress(calculateProgress(e.clientX))
    }
  }, [isDragging, calculateProgress])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const finalProgress = calculateProgress(e.clientX)
      const newTimeMs = finalProgress * state.totalDurationMs
      packetsReplayState.seekTargetMs = newTimeMs
    }
    setIsDragging(false)
    setDragProgress(null)
  }, [isDragging, calculateProgress, state.totalDurationMs])

  const handleBarMouseMove = (e: React.MouseEvent) => {
    const newProgress = calculateProgress(e.clientX)
    setHoverProgress(newProgress)
  }

  const handleBarMouseLeave = () => {
    setHoverProgress(null)
    setIsBarHovered(false)
  }

  const handleBarMouseEnter = () => {
    setIsBarHovered(true)
  }

  // Global mouse move listener for showing controls
  useEffect(() => {
    const handleGlobalMouseMove = () => {
      showControls()
    }

    document.addEventListener('mousemove', handleGlobalMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [showControls])

  // Drag listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Hide timeline in live mode or when not open
  if (!state.isOpen || state.totalDurationMs === 0 || appQueryParams.live) {
    return null
  }

  const hoverTimeMs = hoverProgress === null ? 0 : hoverProgress * state.totalDurationMs
  const shouldShow = true // Always visible

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 3000,
        background: shouldShow
          ? isBarHovered || isDragging
            ? 'linear-gradient(transparent, rgba(0, 0, 0, 0.15) 20%, rgba(0, 0, 0, 0.6))'
            : 'linear-gradient(transparent, rgba(0, 0, 0, 0.6))'
          : 'none',
        padding: isBarHovered || isDragging ? '40px 10px 14px 10px' : '16px 10px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        pointerEvents: shouldShow ? 'auto' : 'none',
        opacity: shouldShow ? 1 : 0,
        transition: 'opacity 0.2s ease, background 0.3s ease, padding 0.2s ease'
      }}
    >
      {/* Progress bar with invisible hit area — taller on hover to cover dots */}
      <div
        ref={progressBarRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleBarMouseMove}
        onMouseLeave={handleBarMouseLeave}
        onMouseEnter={handleBarMouseEnter}
        style={{
          position: 'relative',
          height: isBarHovered || isDragging ? '48px' : '24px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-end',
          transition: 'height 0.15s ease',
        }}
      >
        {/* Visible bar background */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: isBarHovered || isDragging ? '10px' : '4px',
            background: 'rgba(255, 255, 255, 0.3)',
            transition: 'height 0.1s ease'
          }}
        />

        {/* Progress fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: isBarHovered || isDragging ? '10px' : '4px',
            width: `${progress * 100}%`,
            background: '#ff0000',
            transition: isDragging ? 'none' : 'width 0.1s ease, height 0.1s ease'
          }}
        />

        {/* Scrubber handle */}
        <div
          style={{
            position: 'absolute',
            left: `${progress * 100}%`,
            bottom: isBarHovered || isDragging ? '5px' : '2px',
            transform: 'translate(-50%, 50%)',
            width: isBarHovered || isDragging ? '12px' : '0px',
            height: isBarHovered || isDragging ? '12px' : '0px',
            borderRadius: '50%',
            background: '#ff0000',
            transition: 'width 0.1s ease, height 0.1s ease, bottom 0.1s ease',
            pointerEvents: 'none'
          }}
        />

        {/* Chat marker clusters — stacked dots above the bar on hover */}
        {(isBarHovered || isDragging) && clusters.map((cluster, ci) => {
          const pos = state.totalDurationMs > 0 ? (cluster.positionMs / state.totalDurationMs) * 100 : 0
          // Deduplicate senders within the cluster for stacking
          const seen = new Set<string>()
          const uniqueInCluster: ChatMarker[] = []
          for (const m of cluster.markers) {
            if (!seen.has(m.sender)) {
              seen.add(m.sender)
              uniqueInCluster.push(m)
            }
          }
          return (
            <div
              key={ci}
              style={{
                position: 'absolute',
                left: `${pos}%`,
                bottom: 16,
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column-reverse',
                alignItems: 'center',
                gap: 2,
                pointerEvents: 'none',
                background: 'rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                padding: 3,
              }}
            >
              {uniqueInCluster.map((marker, mi) => (
                <div
                  key={mi}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: getPlayerColor(marker.sender, uniqueSenders),
                    border: '1.5px solid rgba(255, 255, 255, 0.5)',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )
        })}

        {/* Hover scrub line — thin vertical line from bar through dots */}
        {hoverProgress !== null && (isBarHovered || isDragging) && (
          <div
            style={{
              position: 'absolute',
              left: `${hoverProgress * 100}%`,
              bottom: 0,
              height: 32,
              width: 1,
              background: 'linear-gradient(to top, rgba(255,255,255,0.5), rgba(255,255,255,0.15))',
              transform: 'translateX(-0.5px)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Hover tooltip — time + all chat messages from hovered cluster */}
        {hoverProgress !== null && (
          <div
            style={{
              position: 'absolute',
              left: `${hoverProgress * 100}%`,
              bottom: 34,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              pointerEvents: 'none',
            }}
          >
            {hoveredCluster && (() => {
              // Show only the first message per sender in the cluster
              const seenSenders = new Set<string>()
              const deduped: ChatMarker[] = []
              for (const m of hoveredCluster.markers) {
                if (!seenSenders.has(m.sender)) {
                  seenSenders.add(m.sender)
                  deduped.push(m)
                }
              }
              return (
                <div
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(8px)',
                    color: '#fff',
                    fontSize: '14px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    maxWidth: 350,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {deduped.map((marker, mi) => (
                    <div
                      key={mi}
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <span style={{ color: getPlayerColor(marker.sender, uniqueSenders), fontWeight: 600 }}>
                        {marker.sender}
                      </span>
                      {' '}
                      <span style={{ color: 'rgba(255,255,255,0.7)' }}>{marker.message}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div
              style={{
                padding: '3px 8px',
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(8px)',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '14px',
                fontFamily: 'monospace',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(hoverTimeMs)}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#fff'
        }}
      >
        {/* Play/Pause */}
        <div
          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
          onMouseEnter={() => setIsPlayHovered(true)}
          onMouseLeave={() => setIsPlayHovered(false)}
        >
          <button
            onClick={handlePlayPause}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              {state.isPlaying ? (
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              ) : (
                <path d="M8 5v14l11-7z" />
              )}
            </svg>
          </button>
          {isPlayHovered && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '6px 12px',
                borderRadius: 9999,
                fontSize: 10,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                color: '#fff',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 4, border: '1px solid rgba(156,163,175,0.4)', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', fontWeight: 600, fontSize: 10 }}>
                J
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.5 4l-9 8 9 8V4z" /><path d="M21.5 4l-9 8 9 8V4z" /></svg>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 4, border: '1px solid rgba(156,163,175,0.4)', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', fontWeight: 600, fontSize: 10 }}>
                K
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4l10 8-10 8V4z" /><rect x="17" y="4" width="3" height="16" /></svg>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 4, border: '1px solid rgba(156,163,175,0.4)', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', fontWeight: 600, fontSize: 10 }}>
                L
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M11.5 20l9-8-9-8v16z" /><path d="M2.5 20l9-8-9-8v16z" /></svg>
              </span>
              <span style={{ fontWeight: 500, letterSpacing: '0.025em', color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Playback</span>
            </div>
          )}
        </div>

        {/* Time display */}
        <div
          style={{
            fontSize: '13px',
            fontFamily: 'monospace',
            color: '#fff'
          }}
        >
          {formatTime(state.currentTimeMs)} / {formatTime(state.totalDurationMs)}
        </div>

      </div>
    </div>
  )
}
