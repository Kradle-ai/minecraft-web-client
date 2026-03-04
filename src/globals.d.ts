/// <reference types="wicg-file-system-access" />

// todo make optional
declare const bot: Omit<import('mineflayer').Bot, 'world' | '_client'> & {
  world: Omit<import('prismarine-world').world.WorldSync, 'getBlock'> & {
    getBlock: (pos: import('vec3').Vec3) => import('prismarine-block').Block | null
  }
  _client: Omit<import('minecraft-protocol').Client, 'on'> & {
    write: typeof import('./generatedClientPackets').clientWrite
    on: typeof import('./generatedServerPackets').clientOn
  }
}
declare const __type_bot: typeof bot
declare const following: typeof bot | import('mineflayer').Player
declare const controMax: ControMax
declare const viewer: import('renderer/viewer/lib/viewer').Viewer
declare const appViewer: import('./appViewer').AppViewer
declare const worldView: import('renderer/viewer/lib/worldDataEmitter').WorldDataEmitter | undefined
declare const addStatPerSec: (name: string) => void
declare const localServer: import('flying-squid/dist/index').FullServer & { options } | undefined
/** all currently loaded mc data */
declare const mcData: Record<string, any>
declare const loadedData: import('minecraft-data').IndexedData & { sounds: Record<string, { id, name }> }
declare const customEvents: import('typed-emitter').default<{
  /** Singleplayer load requested */
  singleplayer (): void
  digStart (): void
  gameLoaded (): void
  pointerLockReleased (): void
  mineflayerBotCreated (): void
  search (q: string): void
  activateItem (item: Item, slot: number, offhand: boolean): void
  hurtAnimation (yaw?: number): void
  'kradle:command' (data: any): void // a command to run as the bot
  'kradle:reconnect' (data: any): void // request from kradle to reconnect
  'kradle:setAgentSkins' (data: any): void // request from kradle to setAgentSkins
  'kradle:releasePointerLock' (data?: any): void // request from kradle to release pointer lock
  'kradle:takeScreenshot' (data?: any): void // request from kradle to capture a screenshot
  'kradle:setCamera' (data: any): void // request from kradle to set camera mode and target
  'kradle:sendRecordingMessageList' (data?: any): void // request from kradle to set recording message list
  'kradle:togglePlayPause' (data?: any): void
  'kradle:pause' (data?: any): void
  'kradle:play' (data?: any): void
  agentSkinsUpdated (): void // emitted when agent skins map is updated
  recordingUpdate (data: any): void // emitted when recording state changes
  recordingComplete (data: { blob: Blob; filename: string }): void // emitted when recording is complete
  connectionStatus (statusData: {
    status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'kicked'
    message: string
    errorDetails?: string
    canReconnect: boolean
  }): void // report connection status to parent app
  replayProgress (data: {
    currentTime: string
    progress: number
    percentage: number
    isPaused: boolean
    totalDuration: number
  }): void // emitted periodically during serverless packet replay
  clearChat (): void // emitted when chat should be cleared (on seek/restart)
  seekComplete (): void // emitted after fast-forward finishes; triggers batch refresh of nametags/outlines
}>
declare const beforeRenderFrame: Array<() => void>

declare interface Document {
  exitPointerLock?(): void
}

declare interface Window extends Record<string, any> { }
