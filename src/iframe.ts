// Setup iframe comms with kradle frontend

import { getThreeJsRendererMethods } from 'renderer/viewer/three/threeJsMethods'
import { options } from './optionsStorage'
import { musicSystem } from './sounds/musicSystem'
import { reestablishFollowing } from './interactiveControls'
import { toggleMic, toggleCamera, toggleRecording } from './controls'
import { audioTrackScheduler } from './sounds/audioTrackScheduler'
import { appQueryParams } from './appParams'
import { packetsReplayState } from './react/state/packetsReplayState'

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

type IFrameSendablePayload =
  | {
    source: 'minecraft-web-client'; // Used to filter messages on the parent side
    action: 'gameLoaded'; // indicates the action to perform
  }
  | {
    source: 'minecraft-web-client';
    action: 'cameraState';
    mode: string;
    target: string | null;
  }
  | {
    source: 'minecraft-web-client';
    action: 'replayStatus';
    currentTime: string; // e.g. "00:01:37"
    progress: number; // 0.0 to 1.0
    percentage: number; // 0 to 100
    recordingName?: string; // e.g. "2025-07-04--00-41-17"
    isRecording: boolean;
    isPaused: boolean;
    isMicEnabled: boolean;
    isCameraEnabled: boolean;
  }
  | {
    source: 'minecraft-web-client';
    action: 'connectionStatus';
    status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'kicked';
    message: string; // Human-readable status message
    errorDetails?: string; // Additional error information when applicable
    canReconnect: boolean; // Whether reconnection is possible
  }
  | {
    source: 'minecraft-web-client';
    action: 'pointerLockReleased';
  }
  | {
    source: 'minecraft-web-client';
    action: 'followingPlayerLost';
  }
  | {
    source: 'minecraft-web-client';
    action: 'screenshotData';
    imageData: string; // Base64 data URL string (JPEG)
  }
  | {
    source: 'minecraft-web-client';
    action: 'recordingData';
    blob: Blob; // Video recording blob (WebM)
    filename: string; // Suggested filename
  }
  | {
    source: 'minecraft-web-client';
    action: 'chatMessages';
    messages: Array<{ parts: Array<{ text: string; color?: string; bold?: boolean; italic?: boolean }>; id: number }>;
  }
  | {
    source: 'minecraft-web-client';
    action: 'unauthorized';
    feature: 'recording' | 'camera' | 'voice';
  }

type ReceivableActions = 'command' | 'reconnect' | 'setAgentSkins' | 'releasePointerLock' | 'takeScreenshot' | 'setCamera' | 'sendRecordingMessageList'

let playerPaused = false

// Recording state - shared between replayProgress and recordingUpdate handlers
let storedIsRecording = false
let storedIsMicEnabled = false
let storedIsCameraEnabled = false

// Guard to prevent duplicate event listeners on hot-reload
let iframeCommsSetup = false

export function isGamePaused (): boolean {
  return playerPaused
}

function pausePlayback () {
  if (playerPaused) return
  bot.chat('/replay view pause')
  packetsReplayState.isPlaying = false
  void (async () => {
    const renderer = getThreeJsRendererMethods()
    if (!renderer) return

    playerPaused = true
    audioTrackScheduler.setPlaying(false)

    const playerObjects = await Promise.all(
      Object.values(bot.entities).map(entity => renderer.getPlayerObject(entity.id))
    )

    for (const playerObject of playerObjects) {
      if (playerObject?.animation) {
        playerObject.animation.paused = true
      }
    }
  })()
}

function unpausePlayback () {
  if (!playerPaused) return
  bot.chat('/replay view unpause')
  packetsReplayState.isPlaying = true
  void (async () => {
    const renderer = getThreeJsRendererMethods()
    if (!renderer) return

    playerPaused = false
    audioTrackScheduler.setPlaying(true)

    const playerObjects = await Promise.all(
      Object.values(bot.entities).map(entity => renderer.getPlayerObject(entity.id))
    )

    for (const playerObject of playerObjects) {
      if (playerObject?.animation) {
        playerObject.animation.paused = false
      }
    }
  })()
}

export function registerPauseHotkey () {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return

    // "J" key to jump back 10 seconds, pause at start
    if (e.code === 'KeyJ' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      const targetMs = Math.max(0, packetsReplayState.currentTimeMs - 10_000)
      audioTrackScheduler.setSeekTarget(targetMs)
      packetsReplayState.seekTargetMs = targetMs
    }

    // "L" key to leap forward 10 seconds, pause at end
    if (e.code === 'KeyL' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      const rawTarget = packetsReplayState.currentTimeMs + 10_000
      const targetMs = Math.min(packetsReplayState.totalDurationMs, rawTarget)
      audioTrackScheduler.setSeekTarget(targetMs)
      packetsReplayState.seekTargetMs = targetMs
      if (rawTarget >= packetsReplayState.totalDurationMs) pausePlayback()
    }

    // "K" key to toggle pause/unpause
    if (e.code === 'KeyK' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      if (playerPaused) {
        unpausePlayback()
      } else {
        pausePlayback()
      }
    }
  }

  window.addEventListener('keydown', onKeyDown)

  // return cleanup/unregister function
  return () => {
    window.removeEventListener('keydown', onKeyDown)
  }
}

registerPauseHotkey()

export function setupIframeComms () {
  // Prevent duplicate setup on hot-reload
  if (iframeCommsSetup) {
    console.log('[iframe-rpc] Iframe comms already setup, skipping')
    return
  }
  iframeCommsSetup = true

  // Handle incoming messages from kradle frontend
  window.addEventListener('message', (event) => {
    const { data } = event
    if (data.source === 'kradle-frontend') {
      console.log('[iframe-rpc] [minecraft-web-client] Received message', data)
      customEvents.emit(`kradle:${data.action as ReceivableActions}`, data)
    }
  })

  // Handle outgoing messages to kradle frontend
  function sendMessageToKradle (
    payload: DistributiveOmit<IFrameSendablePayload, 'source'>
  ) {
    if (window !== window.parent) {
      window.parent.postMessage({
        ...payload,
        source: 'minecraft-web-client'
      }, '*')
    }
  }
  customEvents.on('gameLoaded', () => {
    sendMessageToKradle({
      action: 'gameLoaded'
    })
    // Send initial replay status so parent knows the current playing state
    // Replay starts playing by default (playerPaused = false, packetsReplayState.isPlaying = true)
    sendMessageToKradle({
      action: 'replayStatus',
      currentTime: '00:00:00',
      progress: 0,
      percentage: 0,
      isPaused: playerPaused,
      isRecording: false,
      isMicEnabled: false,
      isCameraEnabled: false,
    })
  })
  // Camera state changes and pointer lock are reported by interactiveControls.ts directly
  // Listen for replay progress updates from serverless packet replay
  customEvents.on('replayProgress', (data) => {
    sendMessageToKradle({
      action: 'replayStatus',
      currentTime: data.currentTime,
      progress: data.progress,
      percentage: data.percentage,
      isPaused: data.isPaused,
      isRecording: storedIsRecording,
      isMicEnabled: storedIsMicEnabled,
      isCameraEnabled: storedIsCameraEnabled,
    })
  })
  customEvents.on('kradle:sendRecordingMessageList', (data) => {
    console.log('[iframe-rpc] Recording message list received from parent', data)
    if (data?.data && Array.isArray(data.data)) {
      void audioTrackScheduler.loadTracks(data.data)
    }
  })

  customEvents.on('kradle:command', (data) => {
    const { command } = data
    if (!command) {
      console.error('No command provided')
      return
    }

    console.log('[packet-monitor] Command received:', command)

    // Check if this is a locally-handled replay command (for serverless replay mode)
    const isLocalReplayCommand =
      command === 'replay view pause' ||
      command === 'replay view unpause' ||
      command === 'replay view resume' ||
      command === 'replay view play' ||
      command === 'replay view restart' ||
      command.startsWith('replay view speed ') ||
      command.startsWith('replay view jump to timestamp ') ||
      command === 'replay recording toggle' ||
      command === 'replay mic toggle' ||
      command === 'replay camera toggle'

    // Only send to server (via bot.chat) if it's NOT a locally-handled command
    // This avoids BigInt errors in serverless replay mode
    if (!isLocalReplayCommand) {
      const formattedCommand = `/${command.replace(/^\//, '')}`
      console.log('[packet-monitor] Sending command to bot:', formattedCommand)
      bot.chat(formattedCommand)
    }

    // Check if this is a seek command and handle for serverless replay
    if (command.includes('replay view jump to timestamp')) {
      // Parse the timestamp from the command (format: "replay view jump to timestamp <seconds>s")
      const match = command.match(/replay view jump to timestamp\s+(\d+)s?/)
      if (match) {
        const targetSeconds = parseInt(match[1], 10)
        const targetMs = targetSeconds * 1000
        audioTrackScheduler.setSeekTarget(targetMs)
        // Set seek target for serverless packet replay
        packetsReplayState.seekTargetMs = targetMs
        console.log('[iframe] Seeking to', targetSeconds, 'seconds (', targetMs, 'ms)')
      }

      // Wait a bit for the seek to complete and entities to spawn
      setTimeout(() => {
        void reestablishFollowing()
      }, 1000)
    }

    if (command === 'replay view pause') {
      // Pause the packet replay and all player animations
      packetsReplayState.isPlaying = false
      void (async () => {

        const renderer = getThreeJsRendererMethods()
        if (!renderer) return

        playerPaused = true
        audioTrackScheduler.setPlaying(false)

        const playerObjects = await Promise.all(
          Object.values(bot.entities).map(entity => renderer.getPlayerObject(entity.id))
        )

        for (const playerObject of playerObjects) {
          if (playerObject?.animation) {
            playerObject.animation.paused = true
          }
        }
      })()
    }

    if (command === 'replay view unpause' || command === 'replay view resume' || command === 'replay view play') {
      // Resume the packet replay and all player animations
      packetsReplayState.isPlaying = true
      void (async () => {

        const renderer = getThreeJsRendererMethods()
        if (!renderer) return

        playerPaused = false
        audioTrackScheduler.setPlaying(true)

        const playerObjects = await Promise.all(
          Object.values(bot.entities).map(entity => renderer.getPlayerObject(entity.id))
        )

        for (const playerObject of playerObjects) {
          if (playerObject?.animation) {
            playerObject.animation.paused = false
          }
        }
      })()
    }

    if (command === 'replay view restart') {
      // Restart the packet replay from the beginning
      packetsReplayState.restartRequested = true
      void (async () => {
        const renderer = getThreeJsRendererMethods()
        if (!renderer) return

        playerPaused = false
        audioTrackScheduler.setPlaying(true)

        const playerObjects = await Promise.all(
          Object.values(bot.entities).map(entity => renderer.getPlayerObject(entity.id))
        )

        for (const playerObject of playerObjects) {
          if (playerObject?.animation) {
            playerObject.animation.paused = false
          }
        }
      })()
    }

    // Handle speed command: "replay view speed X"
    const speedMatch = command.match(/^replay view speed (\d+(?:\.\d+)?)$/)
    if (speedMatch) {
      const speed = parseFloat(speedMatch[1])
      packetsReplayState.speed = speed
      console.log('[iframe] Set replay speed to', speed)
    }

    if (command === 'replay recording toggle') {
      console.log('[iframe] Received replay recording toggle command')
      if (appQueryParams.allowRecording !== 'true') {
        document.exitPointerLock?.()
        sendMessageToKradle({ action: 'unauthorized', feature: 'recording' })
        return
      }
      void toggleRecording()
    }

    if (command === 'replay mic toggle') {
      console.log('[iframe] Received replay mic toggle command')
      if (appQueryParams.allowRecording !== 'true') {
        document.exitPointerLock?.()
        sendMessageToKradle({ action: 'unauthorized', feature: 'voice' })
        return
      }
      void toggleMic()
    }

    if (command === 'replay camera toggle') {
      console.log('[iframe] Received replay camera toggle command')
      if (appQueryParams.allowRecording !== 'true') {
        document.exitPointerLock?.()
        sendMessageToKradle({ action: 'unauthorized', feature: 'camera' })
        return
      }
      void toggleCamera()
    }

  })

  // Handle reconnect command from parent app
  customEvents.on('kradle:reconnect', (data) => {
    console.log('[iframe-rpc] Reconnect command received from parent', data)
    if (window?.lastConnectOptions?.value) {
      // Use existing reconnect functionality
      window.dispatchEvent(
        new window.CustomEvent('connect', {
          detail: window.lastConnectOptions.value,
        })
      )

      // Re-establish following after reconnection
      setTimeout(() => {
        void reestablishFollowing()
      }, 2000) // Wait longer for reconnection to complete
    } else {
      console.error(
        '[iframe-rpc] No connection options available for reconnect'
      )
    }
  })

  // Handle agent skin data from parent app
  customEvents.on('kradle:setAgentSkins', (data) => {
    console.log('[iframe-rpc] Agent skin data received from parent', data)
    // Store agent skin data globally for use by entities
    if (window.agentSkinMap) {
      window.agentSkinMap.clear()
    } else {
      window.agentSkinMap = new Map()
    }

    if (data.agentSkins) {
      for (const agentSkin of data.agentSkins) {
        if (agentSkin.username && agentSkin.skinUrl) {
          // Primary mapping: username -> skinUrl
          window.agentSkinMap.set(agentSkin.username, agentSkin.skinUrl)
        }
      }
    }

    // Emit event to notify that agent skins have been updated
    console.log('[iframe-rpc] Emitting agentSkinsUpdated event, map size:', window.agentSkinMap.size)
    customEvents.emit('agentSkinsUpdated')
  })

  // Handle pointer lock release request from parent app
  customEvents.on('kradle:releasePointerLock', () => {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock()
    }
  })

  // Handle screenshot capture request from parent app
  customEvents.on('kradle:takeScreenshot', () => {
    const gameCanvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
    if (!gameCanvas) {
      console.warn('[iframe-rpc] Screenshot requested but viewer-canvas not found')
      return
    }

    try {
      // Capture canvas as JPEG with 0.8 quality for reasonable file sizes
      const imageData = gameCanvas.toDataURL('image/jpeg', 0.8)

      // Send screenshot data back to parent
      sendMessageToKradle({
        action: 'screenshotData',
        imageData,
      })

      console.log('[iframe-rpc] Screenshot captured and sent to parent')
    } catch (error) {
      console.error('[iframe-rpc] Failed to capture screenshot:', error)
    }
  })

  // Handle connection status reporting
  customEvents.on('connectionStatus', (statusData) => {
    sendMessageToKradle({
      action: 'connectionStatus',
      ...statusData,
    })
  })

  // Handle recording complete - send video blob to parent
  customEvents.on('recordingComplete', (data: { blob: Blob; filename: string }) => {
    console.log('[iframe-rpc] Recording complete, sending blob to parent, size:', data.blob.size)
    sendMessageToKradle({
      action: 'recordingData',
      blob: data.blob,
      filename: data.filename,
    })
  })

  // Setup packet monitoring for replay information
  function setupPacketMonitoring () {
    if (!bot || !bot._client) {
      console.log('[packet-monitor] Bot not ready yet, retrying in 1s')
      setTimeout(setupPacketMonitoring, 1000)
      return
    }

    console.log(
      '[packet-monitor] Setting up packet monitoring for replay data'
    )

    // Monitor boss_bar packets for replay progress and broadcast to parent
    let lastReplayStatus: any = null
    let storedProgress = 0
    let storedPercentage = 0
    let storedCurrentTime = ''
    let storedRecordingName = ''
    // Note: storedIsRecording, storedIsMicEnabled, storedIsCameraEnabled are module-level variables

    customEvents.on('recordingUpdate', (data) => {
      console.log('[packet-monitor] Custom payload received:', data)
      if (data.isRecording !== undefined) {
        storedIsRecording = data.isRecording
      }
      if (data.isMicEnabled !== undefined) {
        storedIsMicEnabled = data.isMicEnabled
      }
      if (data.isCameraEnabled !== undefined) {
        storedIsCameraEnabled = data.isCameraEnabled
      }

      const replayStatus = {
        currentTime: storedCurrentTime || '00:00:00',
        progress: storedProgress,
        percentage: storedPercentage,
        recordingName: storedRecordingName,
        isPaused: playerPaused,
        isRecording: storedIsRecording,
        isMicEnabled: storedIsMicEnabled,
        isCameraEnabled: storedIsCameraEnabled,
      }

      // Always send recording state updates to parent (don't require storedCurrentTime)
      if (window !== window.parent) {
        sendMessageToKradle({
          action: 'replayStatus',
          ...replayStatus,
        })
      }
    })

    bot._client.on('boss_bar', (data) => {
      // Extract progress percentage (action 2)
      if (data.health !== undefined) {
        storedProgress = data.health
        storedPercentage = Math.round(data.health * 100)
      }

      // Extract time and recording name from title (action 3)
      if (
        data.title?.value?.extra?.value?.value
      ) {
        try {
          const extraItems = data.title.value.extra.value.value
          for (const item of extraItems) {
            if (item.text?.value) {
              const text = item.text.value
              if (/\d{2}:\d{2}:\d{2}/.test(text)) {
                storedCurrentTime = text
              } else if (/\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}/.test(text)) {
                storedRecordingName = text
              }
            }
          }
        } catch (e) {
          console.log('[replay-parse-error]', e.message)
        }
      }

      // Update audio track scheduler with current time
      if (storedCurrentTime) {
        audioTrackScheduler.updateCurrentTime(storedCurrentTime)
      }

      // Create status object from stored values
      const replayStatus = {
        currentTime: storedCurrentTime,
        progress: storedProgress,
        percentage: storedPercentage,
        recordingName: storedRecordingName,
        isPaused: playerPaused,
        isRecording: storedIsRecording,
        isMicEnabled: storedIsMicEnabled,
        isCameraEnabled: storedIsCameraEnabled,
      }

      console.log('[boss-monitor] Replay status:', replayStatus)

      // Only send if data has changed and we have minimum required data
      const statusChanged =
        JSON.stringify(replayStatus) !== JSON.stringify(lastReplayStatus)
      if (statusChanged && storedCurrentTime && window !== window.parent) {
        sendMessageToKradle({
          action: 'replayStatus',
          ...replayStatus,
        })

        lastReplayStatus = replayStatus
      }
    })
  }

  // Start monitoring when bot is ready
  if (window?.customEvents) {
    window.customEvents.on('mineflayerBotCreated', () => {
      console.log('[packet-monitor] Bot created, setting up packet monitoring')
      setTimeout(setupPacketMonitoring, 1000) // Give bot time to initialize
    })
  }
}
