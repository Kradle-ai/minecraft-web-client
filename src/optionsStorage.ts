import { proxy, subscribe } from 'valtio/vanilla'
import { subscribeKey } from 'valtio/utils'
import { omitObj } from '@zardoy/utils'
import { appQueryParamsArray } from './appParams'
import type { AppConfig } from './appConfig'
import { appStorage } from './react/appStorageProvider'

const isDev = process.env.NODE_ENV === 'development'
const initialAppConfig = process.env?.INLINED_APP_CONFIG as AppConfig ?? {}
const defaultOptions = {
  renderDistance: 3,
  keepChunksDistance: 1,
  multiplayerRenderDistance: 3,
  closeConfirmation: false,
  autoFullScreen: false,
  mouseRawInput: true,
  autoExitFullscreen: false,
  localUsername: 'KradleWebViewer',
  mouseSensX: 50,
  mouseSensY: -1,
  chatWidth: 280,
  chatHeight: 90,
  chatScale: 75,
  chatOpacity: 0, // hide chat completely
  chatOpacityOpened: 0, // hide chat even when opened
  messagesLimit: 200,
  volume: 0,
  enableMusic: false,
  // fov: 70,
  fov: 75,
  guiScale: 3,
  autoRequestCompletions: true,
  touchButtonsSize: 40,
  touchButtonsOpacity: 80,
  touchButtonsPosition: 12,
  touchControlsPositions: getDefaultTouchControlsPositions(),
  touchMovementType: 'modern' as 'modern' | 'classic',
  touchInteractionType: 'classic' as 'classic' | 'buttons',
  gpuPreference: 'default' as 'default' | 'high-performance' | 'low-power',
  backgroundRendering: 'full' as 'full' | '20fps' | '5fps',
  /** @unstable */
  disableAssets: false,
  /** @unstable */
  debugLogNotFrequentPackets: false,
  unimplementedContainers: false,
  dayCycleAndLighting: true,
  loadPlayerSkins: true,
  renderEars: true,
  lowMemoryMode: false,
  starfieldRendering: true,
  enabledResourcepack: null as string | null,
  useVersionsTextures: 'latest',
  serverResourcePacks: 'prompt' as 'prompt' | 'always' | 'never',
  showHand: false,
  viewBobbing: true,
  displayRecordButton: true,
  packetsLoggerPreset: 'all' as 'all' | 'no-buffers',
  serversAutoVersionSelect: 'auto' as 'auto' | 'latest' | '1.20.4' | string,
  customChannels: false,
  remoteContentNotSameOrigin: false as boolean | string[],
  packetsReplayAutoStart: false,
  preciseMouseInput: false,
  // todo ui setting, maybe enable by default?
  waitForChunksRender: 'sp-only' as 'sp-only' | boolean,
  jeiEnabled: true as boolean | Array<'creative' | 'survival' | 'adventure' | 'spectator'>,
  preventBackgroundTimeoutKick: false,

  // antiAliasing: false,

  clipWorldBelowY: undefined as undefined | number, // will be removed
  disableSignsMapsSupport: false,
  singleplayerAutoSave: false,
  showChunkBorders: false, // todo rename option
  frameLimit: false as number | false,
  alwaysBackupWorldBeforeLoading: undefined as boolean | undefined | null,
  alwaysShowMobileControls: false,
  excludeCommunicationDebugEvents: [],
  preventDevReloadWhilePlaying: false,
  numWorkers: 4,
  localServerOptions: {
    gameMode: 1
  } as any,
  preferLoadReadonly: false,
  disableLoadPrompts: false,
  guestUsername: 'guest',
  askGuestName: true,
  errorReporting: true,
  /** Actually might be useful */
  showCursorBlockInSpectator: false,
  renderEntities: true,
  smoothLighting: true,
  newVersionsLighting: false,
  chatSelect: true,
  autoJump: 'auto' as 'auto' | 'always' | 'never',
  autoParkour: false,
  vrSupport: true, // doesn't directly affect the VR mode, should only disable the button which is annoying to android users
  renderDebug: (isDev ? 'basic' : 'none') as 'none' | 'advanced' | 'basic',

  // advanced bot options
  autoRespawn: false,
  mutedSounds: [] as string[],
  plugins: [] as Array<{ enabled: boolean, name: string, description: string, script: string }>,
  /** Wether to popup sign editor on server action */
  autoSignEditor: true,
  wysiwygSignEditor: 'auto' as 'auto' | 'always' | 'never',
  showMinimap: 'never' as 'always' | 'singleplayer' | 'never',
  minimapOptimizations: true,
  displayBossBars: false,
  disabledUiParts: ['crosshair'] as string[],
  neighborChunkUpdates: true,
  highlightBlockColor: 'auto' as 'auto' | 'blue' | 'classic',
  rendererOptions: {
    three: {
      _experimentalSmoothChunkLoading: true,
      _renderByChunks: false
    }
  },
  xrayMode: true,
}

function getDefaultTouchControlsPositions () {
  return {
    action: [
      70,
      76
    ],
    sneak: [
      84,
      76
    ],
    break: [
      70,
      60
    ],
    jump: [
      84,
      60
    ],
  } as Record<string, [number, number]>
}

// const qsOptionsRaw = new URLSearchParams(location.search).getAll('setting')
const qsOptionsRaw = appQueryParamsArray.setting ?? []
export const qsOptions = Object.fromEntries(qsOptionsRaw.map(o => {
  const [key, value] = o.split(':')
  return [key, JSON.parse(value)]
}))

// Track which settings are disabled (controlled by QS or forced by config)
export const disabledSettings = proxy({
  value: new Set<string>(Object.keys(qsOptions))
})

const migrateOptions = (options: Partial<AppOptions & Record<string, any>>) => {
  if (options.highPerformanceGpu) {
    options.gpuPreference = 'high-performance'
    delete options.highPerformanceGpu
  }
  if (Object.keys(options.touchControlsPositions ?? {}).length === 0) {
    options.touchControlsPositions = defaultOptions.touchControlsPositions
  }
  if (options.touchControlsPositions?.jump === undefined) {
    options.touchControlsPositions!.jump = defaultOptions.touchControlsPositions.jump
  }
  if (options.touchControlsType === 'joystick-buttons') {
    options.touchInteractionType = 'buttons'
  }

  return options
}
const migrateOptionsLocalStorage = () => {
  if (Object.keys(appStorage.options).length) {
    for (const key of Object.keys(appStorage.options)) {
      if (!(key in defaultOptions)) continue // drop unknown options
      const defaultValue = defaultOptions[key]
      if (JSON.stringify(defaultValue) !== JSON.stringify(appStorage.options[key])) {
        appStorage.changedSettings[key] = appStorage.options[key]
      }
    }
    appStorage.options = {}
  }
}

export type AppOptions = typeof defaultOptions

const isDeepEqual = (a: any, b: any): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => isDeepEqual(item, b[index]))
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(key => isDeepEqual(a[key], b[key]))
}

export const getChangedSettings = () => {
  return Object.fromEntries(
    Object.entries(appStorage.changedSettings).filter(([key, value]) => !isDeepEqual(defaultOptions[key], value))
  )
}

migrateOptionsLocalStorage()
// Force default volume on load (remove this line if you want to remember user's volume preference)
delete appStorage.changedSettings.volume

export const options: AppOptions = proxy({
  ...defaultOptions,
  ...initialAppConfig.defaultSettings,
  ...migrateOptions(appStorage.changedSettings),
  ...qsOptions
})

window.options = window.settings = options

export const resetOptions = () => {
  Object.assign(options, defaultOptions)
}

Object.defineProperty(window, 'debugChangedOptions', {
  get () {
    return getChangedSettings()
  },
})

subscribe(options, (ops) => {
  for (const op of ops) {
    const [type, path, value] = op
    // let patch
    // let accessor = options
    // for (const part of path) {
    // }
    const key = path[0] as string
    if (disabledSettings.value.has(key)) continue
    appStorage.changedSettings[key] = options[key]
  }
})

type WatchValue = <T extends Record<string, any>>(proxy: T, callback: (p: T, isChanged: boolean) => void) => () => void

export const watchValue: WatchValue = (proxy, callback) => {
  const watchedProps = new Set<string>()
  callback(new Proxy(proxy, {
    get (target, p, receiver) {
      watchedProps.add(p.toString())
      return Reflect.get(target, p, receiver)
    },
  }), false)
  const unsubscribes = [] as Array<() => void>
  for (const prop of watchedProps) {
    unsubscribes.push(
      subscribeKey(proxy, prop, () => {
        callback(proxy, true)
      })
    )
  }

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

watchValue(options, o => {
  globalThis.excludeCommunicationDebugEvents = o.excludeCommunicationDebugEvents
})

watchValue(options, o => {
  document.body.classList.toggle('disable-assets', o.disableAssets)
})
watchValue(options, o => {
  document.body.style.setProperty('--touch-movement-buttons-opacity', (o.touchButtonsOpacity / 100).toString())
})
watchValue(options, o => {
  document.body.style.setProperty('--touch-movement-buttons-position', (o.touchButtonsPosition * 2) + 'px')
})

export const useOptionValue = (setting, valueCallback) => {
  valueCallback(setting)
  subscribe(setting, valueCallback)
}
