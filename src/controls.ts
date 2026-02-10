//@ts-check

import { Vec3 } from 'vec3'
import { proxy, subscribe } from 'valtio'

import { ControMax } from 'contro-max/build/controMax'
import { CommandEventArgument, SchemaCommandInput } from 'contro-max/build/types'
import { stringStartsWith } from 'contro-max/build/stringUtils'
import { GameMode } from 'mineflayer'
import { isGameActive, showModal, gameAdditionalState, activeModalStack, hideCurrentModal, miscUiState, hideModal, hideAllModals } from './globalState'
import { getSpectatorCameraPosition, setSpectatorCameraPosition } from './interactiveControls'
import { appViewer } from './appViewer'
import { goFullscreen, isInRealGameSession, pointerLock, reloadChunks } from './utils'
import { options } from './optionsStorage'
import { openPlayerInventory } from './inventoryWindows'
import { chatInputValueGlobal } from './react/Chat'
import { fsState } from './loadSave'
import { customCommandsConfig } from './customCommands'
import type { CustomCommand } from './react/KeybindingsCustom'
import { showOptionsModal } from './react/SelectOption'
import widgets from './react/widgets'
import { getItemFromBlock } from './chatUtils'
import { gamepadUiCursorState, moveGamepadCursorByPx } from './react/GamepadUiCursor'
import { completeResourcepackPackInstall, copyServerResourcePackToRegular, resourcePackState } from './resourcePack'
import { showNotification } from './react/NotificationProvider'
import { lastConnectOptions } from './react/AppStatusProvider'
import { onCameraMove, onControInit } from './cameraRotationControls'
import { createNotificationProgressReporter } from './core/progressReporter'
import { appStorage } from './react/appStorageProvider'
import { switchGameMode } from './packetsReplay/replayPackets'
import { packetsReplayState } from './react/state/packetsReplayState'
import { appQueryParams } from './appParams'


export const customKeymaps = proxy(appStorage.keybindings)
subscribe(customKeymaps, () => {
  appStorage.keybindings = customKeymaps
})

const controlOptions = {
  preventDefault: true
}

const isDev = process.env.NODE_ENV === 'development'
export const contro = new ControMax({
  commands: {
    general: {
      jump: ['Space', 'A'],
      inventory: [null],
      drop: [null],
      sneak: ['ShiftLeft'],
      toggleSneakOrDown: [null],
      sprint: ['ControlLeft'],
      nextHotbarSlot: [null],
      prevHotbarSlot: [null],
      attackDestroy: [null],
      interactPlace: [null],
      // disable chat and commands in prod
      chat: isDev ? ['Enter'] : [null],
      command: isDev ? ['Slash'] : [null],
      swapHands: [null],
      zoom: [null],
      selectItem: [null], // default will be removed
      rotateCameraLeft: [null],
      rotateCameraRight: [null],
      rotateCameraUp: [null],
      rotateCameraDown: [null],
      viewerConsole: isDev ? ['Backquote'] : [null]
    },
    ui: {
      toggleFullscreen: ['F11'],
      back: [null/* 'Escape' */, 'B'],
      toggleMap: [null], // 'KeyM'
      leftClick: [null, 'A'],
      rightClick: [null, 'Y'],
      speedupCursor: [null, 'Left Stick'],
      pauseMenu: [null, 'Start']
    },
    advanced: {
      lockUrl: ['KeyY'],
    },
    custom: {} as Record<string, SchemaCommandInput & { type: string, input: any[] }>,
    // waila: {
    //   showLookingBlockRecipe: ['Numpad3'],
    //   showLookingBlockUsages: ['Numpad4']
    // }
  } satisfies Record<string, Record<string, SchemaCommandInput>>,
  movementKeymap: 'WASD',
  movementVector: '2d',
  groupedCommands: {
    general: {
      switchSlot: ['Digits', []]
    }
  },
}, {
  defaultControlOptions: controlOptions,
  target: document,
  captureEvents () {
    return true
  },
  storeProvider: {
    load: () => customKeymaps,
    save () { },
  },
  gamepadPollingInterval: 10
})
window.controMax = contro
export type Command = CommandEventArgument<typeof contro['_commandsRaw']>['command']

onControInit()

updateBinds(customKeymaps)


const updateDoPreventDefault = () => {
  controlOptions.preventDefault = miscUiState.gameLoaded && !activeModalStack.length
}

subscribe(miscUiState, updateDoPreventDefault)
subscribe(activeModalStack, updateDoPreventDefault)
updateDoPreventDefault()

const setSprinting = (state: boolean) => {
  bot.setControlState('sprint', state)
  gameAdditionalState.isSprinting = state
}

// Track which WASD keys are currently pressed for spectator mode
const wasdPressed = {
  forward: false,
  back: false,
  left: false,
  right: false
}

contro.on('movementUpdate', ({ vector, soleVector, gamepadIndex }) => {
  if (gamepadIndex !== undefined && gamepadUiCursorState.display) {
    const deadzone = 0.1 // TODO make deadzone configurable
    if (Math.abs(soleVector.x) < deadzone && Math.abs(soleVector.z) < deadzone) {
      return
    }
    moveGamepadCursorByPx(soleVector.x, true)
    moveGamepadCursorByPx(soleVector.z, false)
    emitMousemove()
  }
  miscUiState.usingGamepadInput = gamepadIndex !== undefined
  if (!bot || !isGameActive(false)) {
    if ((vector.x !== undefined && Math.abs(vector.x) > 0.1)
      || (vector.z !== undefined && Math.abs(vector.z) > 0.1)) {
      console.log('[WASD Debug] Movement blocked - bot:', !!bot, 'gameActive:', isGameActive(false))
    }
    return
  }

  // if (viewer.world.freeFlyMode) {
  //   // Create movement vector from input
  //   const direction = new THREE.Vector3(0, 0, 0)
  //   if (vector.z !== undefined) direction.z = vector.z
  //   if (vector.x !== undefined) direction.x = vector.x

  //   // Apply camera rotation to movement direction
  //   direction.applyQuaternion(viewer.camera.quaternion)

  //   // Update freeFlyState position with normalized direction
  //   const moveSpeed = 1
  //   direction.multiplyScalar(moveSpeed)
  //   viewer.world.freeFlyState.position.add(new Vec3(direction.x, direction.y, direction.z))
  //   return
  // }

  // gamepadIndex will be used for splitscreen in future
  const coordToAction = [
    ['z', -1, 'forward'],
    ['z', 1, 'back'],
    ['x', -1, 'left'],
    ['x', 1, 'right'],
  ] as const

  const newState: Partial<typeof bot.controlState> = {}
  for (const [coord, v] of Object.entries(vector)) {
    if (v === undefined || Math.abs(v) < 0.3) continue
    // todo use raw values eg for slow movement
    const mappedValue = v < 0 ? -1 : 1
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const foundAction = coordToAction.find(([c, mapV]) => c === coord && mapV === mappedValue)?.[2]!
    newState[foundAction] = true
  }

  for (const key of ['forward', 'back', 'left', 'right'] as const) {
    if (newState[key] === bot.controlState[key]) continue
    const action = !!newState[key]
    if (action && !isGameActive(true)) continue
    // Hijack WASD for spectator camera movement
    if (getSpectatorCameraPosition() && isFlying()) {
      // Just track key state - movement will be calculated in fly loop
      wasdPressed[key] = action
      // Skip the normal bot.setControlState call
      continue
    }

    // Normal movement for non-spectator mode
    bot.setControlState(key, action)

    if (key === 'forward') {
      // todo workaround: need to refactor
      if (action) {
        void contro.emit('trigger', { command: 'general.forward' } as any)
      } else {
        setSprinting(false)
      }
    }
  }
})

let lastCommandTrigger = null as { command: string, time: number } | null

const secondActionActivationTimeout = 300
const secondActionCommands = {
  'general.jump' () {
    if (bot.game.gameMode === 'spectator') return
    toggleFly()
  },
  'general.forward' () {
    setSprinting(true)
  }
}

// detect pause open, as ANY keyup event is not fired when you exit pointer lock (esc)
subscribe(activeModalStack, () => {
  if (activeModalStack.length) {
    // iterate over pressedKeys
    for (const key of contro.pressedKeys) {
      contro.pressedKeyOrButtonChanged({ code: key }, false)
    }
  }
})

const emitMousemove = () => {
  const { x, y } = gamepadUiCursorState
  const xAbs = x / 100 * window.innerWidth
  const yAbs = y / 100 * window.innerHeight
  const element = document.elementFromPoint(xAbs, yAbs) as HTMLElement | null
  if (!element) return
  element.dispatchEvent(new MouseEvent('mousemove', {
    clientX: xAbs,
    clientY: yAbs
  }))
}

let lastClickedEl = null as HTMLElement | null
let lastClickedElTimeout: ReturnType<typeof setTimeout> | undefined
const inModalCommand = (command: Command, pressed: boolean) => {
  if (pressed && !gamepadUiCursorState.display) return

  if (pressed) {
    if (command === 'ui.back') {
      hideCurrentModal()
    }
    if (command === 'ui.leftClick' || command === 'ui.rightClick') {
      // in percent
      const { x, y } = gamepadUiCursorState
      const xAbs = x / 100 * window.innerWidth
      const yAbs = y / 100 * window.innerHeight
      const el = document.elementFromPoint(xAbs, yAbs) as HTMLElement
      if (el) {
        if (el === lastClickedEl && command === 'ui.leftClick') {
          el.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            clientX: xAbs,
            clientY: yAbs
          }))
          return
        }
        el.dispatchEvent(new MouseEvent('mousedown', {
          button: command === 'ui.leftClick' ? 0 : 2,
          bubbles: true,
          clientX: xAbs,
          clientY: yAbs
        }))
        el.dispatchEvent(new MouseEvent(command === 'ui.leftClick' ? 'click' : 'contextmenu', {
          bubbles: true,
          clientX: xAbs,
          clientY: yAbs
        }))
        el.dispatchEvent(new MouseEvent('mouseup', {
          button: command === 'ui.leftClick' ? 0 : 2,
          bubbles: true,
          clientX: xAbs,
          clientY: yAbs
        }))
        el.focus()
        lastClickedEl = el
        if (lastClickedElTimeout) clearTimeout(lastClickedElTimeout)
        lastClickedElTimeout = setTimeout(() => {
          lastClickedEl = null
        }, 500)
      }
    }
  }

  if (command === 'ui.speedupCursor') {
    gamepadUiCursorState.multiply = pressed ? 2 : 1
  }
}

// Camera rotation controls
const cameraRotationControls = {
  activeDirections: new Set<'left' | 'right' | 'up' | 'down'>(),
  interval: null as ReturnType<typeof setInterval> | null,
  config: {
    speed: 1, // movement per interval
    interval: 5 // ms between movements
  },
  movements: {
    left: { movementX: -0.5, movementY: 0 },
    right: { movementX: 0.5, movementY: 0 },
    up: { movementX: 0, movementY: -0.5 },
    down: { movementX: 0, movementY: 0.5 }
  },
  updateMovement () {
    if (cameraRotationControls.activeDirections.size === 0) {
      if (cameraRotationControls.interval) {
        clearInterval(cameraRotationControls.interval)
        cameraRotationControls.interval = null
      }
      return
    }

    if (!cameraRotationControls.interval) {
      cameraRotationControls.interval = setInterval(() => {
        // Combine all active movements
        const movement = { movementX: 0, movementY: 0 }
        for (const direction of cameraRotationControls.activeDirections) {
          movement.movementX += cameraRotationControls.movements[direction].movementX
          movement.movementY += cameraRotationControls.movements[direction].movementY
        }

        onCameraMove({
          ...movement,
          type: 'keyboardRotation',
          stopPropagation () {}
        })
      }, cameraRotationControls.config.interval)
    }
  },
  start (direction: 'left' | 'right' | 'up' | 'down') {
    cameraRotationControls.activeDirections.add(direction)
    cameraRotationControls.updateMovement()
  },
  stop (direction: 'left' | 'right' | 'up' | 'down') {
    cameraRotationControls.activeDirections.delete(direction)
    cameraRotationControls.updateMovement()
  },
  handleCommand (command: string, pressed: boolean) {
    const directionMap = {
      'general.rotateCameraLeft': 'left',
      'general.rotateCameraRight': 'right',
      'general.rotateCameraUp': 'up',
      'general.rotateCameraDown': 'down'
    } as const

    const direction = directionMap[command]
    if (direction) {
      if (pressed) cameraRotationControls.start(direction)
      else cameraRotationControls.stop(direction)
      return true
    }
    return false
  }
}
window.cameraRotationControls = cameraRotationControls

const setSneaking = (state: boolean) => {
  gameAdditionalState.isSneaking = state
  bot.setControlState('sneak', state)
}

const onTriggerOrReleased = (command: Command, pressed: boolean) => {
  // always allow release!
  if (!bot || !isGameActive(false)) return
  if (stringStartsWith(command, 'general')) {
    // handle general commands
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (command) {
      case 'general.jump':
        // if (viewer.world.freeFlyMode) {
        //   const moveSpeed = 0.5
        //   viewer.world.freeFlyState.position.add(new Vec3(0, pressed ? moveSpeed : 0, 0))
        // } else {
        bot.setControlState('jump', pressed)
        // }
        break
      case 'general.sneak':
        // if (viewer.world.freeFlyMode) {
        //   const moveSpeed = 0.5
        //   viewer.world.freeFlyState.position.add(new Vec3(0, pressed ? -moveSpeed : 0, 0))
        // } else {
        setSneaking(pressed)
        // }
        break
      case 'general.sprint':
        // todo add setting to change behavior
        if (pressed) {
          setSprinting(pressed)
        }
        break
      case 'general.toggleSneakOrDown':
        if (gameAdditionalState.isFlying) {
          setSneaking(pressed)
        } else if (pressed) {
          setSneaking(!gameAdditionalState.isSneaking)
        }
        break
      case 'general.attackDestroy':
        document.dispatchEvent(new MouseEvent(pressed ? 'mousedown' : 'mouseup', { button: 0 }))
        break
      case 'general.interactPlace':
        document.dispatchEvent(new MouseEvent(pressed ? 'mousedown' : 'mouseup', { button: 2 }))
        break
      case 'general.zoom':
        gameAdditionalState.isZooming = pressed
        break
      case 'general.rotateCameraLeft':
      case 'general.rotateCameraRight':
      case 'general.rotateCameraUp':
      case 'general.rotateCameraDown':
        cameraRotationControls.handleCommand(command, pressed)
        break
    }
  }
}

// im still not sure, maybe need to refactor to handle in inventory instead
const alwaysPressedHandledCommand = (command: Command) => {
  inModalCommand(command, true)
  // triggered even outside of the game
  if (command === 'general.inventory') {
    if (activeModalStack.at(-1)?.reactType?.startsWith?.('player_win:')) { // todo?
      hideCurrentModal()
    }
  }
  if (command === 'advanced.lockUrl') {
    lockUrl()
  }
}

export function lockUrl () {
  let newQs = ''
  if (fsState.saveLoaded) {
    const save = localServer!.options.worldFolder.split('/').at(-1)
    newQs = `loadSave=${save}`
  } else if (process.env.NODE_ENV === 'development') {
    newQs = `reconnect=1`
  } else if (lastConnectOptions.value?.server) {
    const qs = new URLSearchParams()
    const { server, botVersion, proxy, username } = lastConnectOptions.value
    qs.set('ip', server)
    if (botVersion) qs.set('version', botVersion)
    if (proxy) qs.set('proxy', proxy)
    if (username) qs.set('username', username)
    newQs = String(qs.toString())
  }

  if (newQs) {
    window.history.replaceState({}, '', `${window.location.pathname}?${newQs}`)
  }
}

function cycleHotbarSlot (dir: 1 | -1) {
  const newHotbarSlot = (bot.quickBarSlot + dir + 9) % 9
  bot.setQuickBarSlot(newHotbarSlot)
}

// custom commands handler
const customCommandsHandler = ({ command }) => {
  const [section, name] = command.split('.')
  if (!isGameActive(true) || section !== 'custom') return

  if (contro.userConfig?.custom) {
    customCommandsConfig[(contro.userConfig.custom[name] as CustomCommand).type].handler((contro.userConfig.custom[name] as CustomCommand).inputs)
  }
}
contro.on('trigger', customCommandsHandler)

contro.on('trigger', ({ command }) => {
  const willContinue = !isGameActive(true)
  alwaysPressedHandledCommand(command)
  if (willContinue) return

  const secondActionCommand = secondActionCommands[command]
  if (secondActionCommand) {
    if (command === lastCommandTrigger?.command && Date.now() - lastCommandTrigger.time < secondActionActivationTimeout) {
      const commandToTrigger = secondActionCommands[lastCommandTrigger.command]
      commandToTrigger()
      lastCommandTrigger = null
    } else {
      lastCommandTrigger = {
        command,
        time: Date.now(),
      }
    }
  }

  onTriggerOrReleased(command, true)

  if (stringStartsWith(command, 'general')) {
    switch (command) {
      case 'general.jump':
      case 'general.sneak':
      case 'general.toggleSneakOrDown':
      case 'general.sprint':
      case 'general.attackDestroy':
      case 'general.rotateCameraLeft':
      case 'general.rotateCameraRight':
      case 'general.rotateCameraUp':
      case 'general.rotateCameraDown':
        // no-op
        break
      case 'general.swapHands': {
        bot._client.write('entity_action', {
          entityId: bot.entity.id,
          actionId: 6,
          jumpBoost: 0
        })
        break
      }
      case 'general.interactPlace':
        // handled in onTriggerOrReleased
        break
      case 'general.inventory':
        document.exitPointerLock?.()
        openPlayerInventory()
        break
      case 'general.drop': {
        // if (bot.heldItem/* && ctrl */) bot.tossStack(bot.heldItem)
        bot._client.write('block_dig', {
          'status': 4,
          'location': {
            'x': 0,
            'z': 0,
            'y': 0
          },
          'face': 0,
          sequence: 0
        })
        const slot = bot.inventory.hotbarStart + bot.quickBarSlot
        const item = bot.inventory.slots[slot]
        if (item) {
          item.count--
          bot.inventory.updateSlot(slot, item.count > 0 ? item : null!)
        }
        break
      }
      case 'general.chat':
        showModal({ reactType: 'chat' })
        break
      case 'general.command':
        chatInputValueGlobal.value = '/'
        showModal({ reactType: 'chat' })
        break
      case 'general.selectItem':
        void selectItem()
        break
      case 'general.nextHotbarSlot':
        cycleHotbarSlot(1)
        break
      case 'general.prevHotbarSlot':
        cycleHotbarSlot(-1)
        break
      case 'general.zoom':
        break
      case 'general.viewerConsole':
        if (lastConnectOptions.value?.viewerWsConnect) {
          showModal({ reactType: 'console' })
        }
        break
    }
  }

  if (command === 'ui.pauseMenu') {
    // @pranaygp disabled pause menu for auto follow
    // showModal({ reactType: 'pause-screen' })
  }

  if (command === 'ui.toggleFullscreen') {
    void goFullscreen(true)
  }
})

// show-hide Fullmap
contro.on('trigger', ({ command }) => {
  if (command !== 'ui.toggleMap') return
  const isActive = isGameActive(true)
  if (activeModalStack.at(-1)?.reactType === 'full-map') {
    miscUiState.displayFullmap = false
    hideModal({ reactType: 'full-map' })
  } else if (isActive && !activeModalStack.length) {
    miscUiState.displayFullmap = true
    showModal({ reactType: 'full-map' })
  }
})

contro.on('release', ({ command }) => {
  inModalCommand(command, false)
  onTriggerOrReleased(command, false)
})

// hard-coded keybindings

export const f3Keybinds: Array<{
  key?: string,
  action: () => void,
  mobileTitle: string
  enabled?: () => boolean
}> = [
  {
    key: 'KeyA',
    action () {
      //@ts-expect-error
      const loadedChunks = Object.entries(worldView.loadedChunks).filter(([, v]) => v).map(([key]) => key.split(',').map(Number))
      for (const [x, z] of loadedChunks) {
        worldView!.unloadChunk({ x, z })
      }
      // for (const child of viewer.scene.children) {
      //   if (child.name === 'chunk') { // should not happen
      //     viewer.scene.remove(child)
      //     console.warn('forcefully removed chunk from scene')
      //   }
      // }
      if (localServer) {
        //@ts-expect-error not sure why it is private... maybe revisit api?
        localServer.players[0].world.columns = {}
      }
      void reloadChunks()
    },
    mobileTitle: 'Reload chunks',
  },
  {
    key: 'KeyG',
    action () {
      options.showChunkBorders = !options.showChunkBorders
    },
    mobileTitle: 'Toggle chunk borders',
  },
  {
    key: 'KeyY',
    async action () {
      // waypoints
      const widgetNames = widgets.map(widget => widget.name)
      const widget = await showOptionsModal('Open Widget', widgetNames)
      if (!widget) return
      showModal({ reactType: `widget-${widget}` })
    },
    mobileTitle: 'Open Widget'
  },
  {
    key: 'KeyT',
    async action () {
      // TODO!
      if (resourcePackState.resourcePackInstalled || gameAdditionalState.usingServerResourcePack) {
        showNotification('Reloading textures...')
        await completeResourcepackPackInstall('default', 'default', gameAdditionalState.usingServerResourcePack, createNotificationProgressReporter())
      }
    },
    mobileTitle: 'Reload Textures'
  },
  {
    key: 'F4',
    async action () {
      let nextGameMode: GameMode
      switch (bot.game.gameMode) {
        case 'creative': {
          nextGameMode = 'survival'

          break
        }
        case 'survival': {
          nextGameMode = 'adventure'

          break
        }
        case 'adventure': {
          nextGameMode = 'spectator'

          break
        }
        case 'spectator': {
          nextGameMode = 'creative'

          break
        }
      // No default
      }
      if (lastConnectOptions.value?.worldStateFileContents) {
        switchGameMode(nextGameMode)
      } else {
        bot.chat(`/gamemode ${nextGameMode}`)
      }
    },
    mobileTitle: 'Cycle Game Mode'
  },
  {
    key: 'KeyP',
    async action () {
      const { uuid, ping: playerPing, username } = bot.player
      const proxyPing = await bot['pingProxy']()
      void showOptionsModal(`${username}: last known total latency (ping): ${playerPing}. Connected to ${lastConnectOptions.value?.proxy} with current ping ${proxyPing}. Player UUID: ${uuid}`, [])
    },
    mobileTitle: 'Show Player & Ping Details',
    enabled: () => !lastConnectOptions.value?.singleplayer && !!bot.player
  },
  {
    action () {
      void copyServerResourcePackToRegular()
    },
    mobileTitle: 'Copy Server Resource Pack',
    enabled: () => !!gameAdditionalState.usingServerResourcePack
  }
]

const hardcodedPressedKeys = new Set<string>()
document.addEventListener('keydown', (e) => {
  if (!isGameActive(false)) return
  if (hardcodedPressedKeys.has('F3')) {
    const keybind = f3Keybinds.find((v) => v.key === e.code)
    if (keybind && (keybind.enabled?.() ?? true)) {
      keybind.action()
      e.stopPropagation()
    }
    return
  }

  hardcodedPressedKeys.add(e.code)
}, {
  capture: true,
})
document.addEventListener('keyup', (e) => {
  hardcodedPressedKeys.delete(e.code)
})
document.addEventListener('visibilitychange', (e) => {
  if (document.visibilityState === 'hidden') {
    hardcodedPressedKeys.clear()
  }
})

// #region creative fly
// these controls are more like for gamemode 3

const makeInterval = (fn, interval) => {
  const intervalId = setInterval(fn, interval)

  const cleanup = () => {
    clearInterval(intervalId)
    cleanup.active = false
  }
  cleanup.active = true
  return cleanup
}

const isFlying = () => bot.physics.gravity === 0
let endFlyLoop: ReturnType<typeof makeInterval> | undefined

const currentFlyVector = new Vec3(0, 0, 0)
window.currentFlyVector = currentFlyVector

// todo cleanup
const flyingPressedKeys = {
  down: false,
  up: false
}

const startFlyLoop = () => {
  if (!isFlying()) return
  endFlyLoop?.()

  endFlyLoop = makeInterval(() => {
    if (!bot) {
      endFlyLoop?.()
      return
    }

    // If we have a spectator camera position, move that instead of the bot
    const spectatorPos = getSpectatorCameraPosition()
    if (spectatorPos) {
      // Calculate movement based on current yaw and pressed keys
      const { yaw } = bot.entity
      const movement = new Vec3(0, 0, 0)

      // Add movement for each pressed key
      const { forward, back, left, right } = wasdPressed
      if (forward) {
        movement.add(new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw)))
      }
      if (back) {
        movement.add(new Vec3(Math.sin(yaw), 0, Math.cos(yaw)))
      }
      if (left) {
        movement.add(new Vec3(-Math.cos(yaw), 0, Math.sin(yaw)))
      }
      if (right) {
        movement.add(new Vec3(Math.cos(yaw), 0, -Math.sin(yaw)))
      }

      // Also handle up/down from currentFlyVector (for jump/sneak)
      movement.y = currentFlyVector.y

      // Scale and apply movement
      movement.scale(0.5)
      if (movement.x !== 0 || movement.y !== 0 || movement.z !== 0) {
        spectatorPos.add(movement)
        // Update camera to new spectator position
        appViewer.backend?.updateCamera(spectatorPos, bot.entity.yaw, bot.entity.pitch)
        // Update world view for chunk loading at camera position
        void appViewer.worldView?.updatePosition(spectatorPos)
      }
    } else {
      // Normal bot movement
      bot.entity.position.add(currentFlyVector.clone().scaled(0.5))
    }
  }, 50)
}

// todo we will get rid of patching it when refactor controls
let originalSetControlState
const patchedSetControlState = (action, state) => {
  if (!isFlying()) {
    return originalSetControlState(action, state)
  }

  const actionPerFlyVector = {
    jump: new Vec3(0, 1, 0),
    sneak: new Vec3(0, -1, 0)
  }

  const changeVec = actionPerFlyVector[action]
  if (!changeVec) {
    return originalSetControlState(action, state)
  }
  if (flyingPressedKeys[state === 'jump' ? 'up' : 'down'] === state) return
  const toAddVec = changeVec.scaled(state ? 1 : -1)
  for (const coord of ['x', 'y', 'z']) {
    if (toAddVec[coord] === 0) continue
    if (currentFlyVector[coord] === toAddVec[coord]) return
  }
  currentFlyVector.add(toAddVec)
  flyingPressedKeys[state === 'jump' ? 'up' : 'down'] = state
}

const startFlying = (sendAbilities = true) => {
  bot.entity['creativeFly'] = true
  if (sendAbilities) {
    bot._client.write('abilities', {
      flags: 2,
    })
  }
  // window.flyingSpeed will be removed
  bot.physics['airborneAcceleration'] = window.flyingSpeed ?? 0.1 // todo use abilities
  bot.entity.velocity = new Vec3(0, 0, 0)
  bot.creative.startFlying()
  startFlyLoop()
}

const endFlying = (sendAbilities = true) => {
  bot.entity['creativeFly'] = false
  if (bot.physics.gravity !== 0) return
  if (sendAbilities) {
    bot._client.write('abilities', {
      flags: 0,
    })
  }
  Object.assign(flyingPressedKeys, {
    up: false,
    down: false
  })
  currentFlyVector.set(0, 0, 0)
  bot.physics['airborneAcceleration'] = standardAirborneAcceleration
  bot.creative.stopFlying()
  endFlyLoop?.()
}

let allowFlying = false

export const onBotCreate = () => {
  let wasSpectatorFlying = false
  bot._client.on('abilities', ({ flags }) => {
    allowFlying = !!(flags & 4)
    if (flags & 2) { // flying
      toggleFly(true, false)
    } else {
      toggleFly(false, false)
    }
  })
  const gamemodeCheck = () => {
    if (bot.game.gameMode === 'spectator') {
      allowFlying = true
      // Only toggle fly if not already flying to avoid position jumps
      if (!isFlying()) {
        console.log('[CameraMode] controls: gamemodeCheck detected spectator mode - enabling flying')
        toggleFly(true, false)
      }
      wasSpectatorFlying = true
    } else if (wasSpectatorFlying) {
      console.log('[CameraMode] controls: gamemodeCheck leaving spectator mode - disabling flying')
      toggleFly(false, false)
      wasSpectatorFlying = false
    }
  }
  bot.on('game', () => {
    gamemodeCheck()
  })
  bot.on('login', () => {
    gamemodeCheck()
  })
}

const standardAirborneAcceleration = 0.02
export const toggleFly = (newState = !isFlying(), sendAbilities?: boolean) => {
  // if (bot.game.gameMode !== 'creative' && bot.game.gameMode !== 'spectator') return
  if (!allowFlying) return
  if (bot.setControlState !== patchedSetControlState) {
    originalSetControlState = bot.setControlState
    bot.setControlState = patchedSetControlState
  }

  if (newState) {
    startFlying(sendAbilities)
  } else {
    endFlying(sendAbilities)
  }
  gameAdditionalState.isFlying = isFlying()
}
// #endregion

const selectItem = async () => {
  const block = bot.blockAtCursor(5)
  if (!block) return
  const itemId = getItemFromBlock(block)?.id
  if (!itemId) return
  const Item = require('prismarine-item')(bot.version)
  const item = new Item(itemId, 1, 0)
  await bot.creative.setInventorySlot(bot.inventory.hotbarStart + bot.quickBarSlot, item)
  bot.updateHeldItem()
}

addEventListener('mousedown', async (e) => {
  if ((e.target as HTMLElement).matches?.('#VRButton')) return
  if (!isInRealGameSession() && !(e.target as HTMLElement).id.includes('ui-root')) return
  void pointerLock.requestPointerLock()
  if (!bot) return
  // wheel click
  // todo support ctrl+wheel (+nbt)
  if (e.button === 1) {
    await selectItem()
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return
  if (activeModalStack.length) {
    const hideAll = e.ctrlKey || e.metaKey
    if (hideAll) {
      hideAllModals()
    } else {
      hideCurrentModal()
    }
    if (activeModalStack.length === 0) {
      pointerLock.justHitEscape = true
    }
  } else if (pointerLock.hasPointerLock) {
    document.exitPointerLock?.()
    if (options.autoExitFullscreen) {
      void document.exitFullscreen()
    }
  } else {
    document.dispatchEvent(new Event('pointerlockchange'))
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F2' || e.repeat || !isGameActive(true)) return
  e.preventDefault()
  const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
  if (!canvas) return
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  const date = new Date()
  link.download = `screenshot ${date.toLocaleString().replaceAll('.', '-').replace(',', '')}.png`
  link.click()
})

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F1' || e.repeat || !isGameActive(true)) return
  e.preventDefault()
  miscUiState.showUI = !miscUiState.showUI
})

// #region Canvas Recording
const RECORDING_WIDTH = 1920
const RECORDING_HEIGHT = 1080
const WEBCAM_SIZE = 200
const WEBCAM_PADDING = 36
const WEBCAM_BORDER_RADIUS = 16

export const recordingState: {
  mediaRecorder: MediaRecorder | null
  chunks: Blob[]
  holdTimeout: ReturnType<typeof setTimeout> | null
  isRecording: boolean
  startTime: number
  timerInterval: ReturnType<typeof setInterval> | null
  indicatorElement: HTMLDivElement | null
  recordingCanvas: HTMLCanvasElement | null
  recordingCtx: CanvasRenderingContext2D | null
  animationFrameId: number | null
  audioContext: AudioContext | null
  audioDestination: MediaStreamAudioDestinationNode | null
  micSourceNode: MediaStreamAudioSourceNode | null
} = {
  mediaRecorder: null,
  chunks: [],
  holdTimeout: null,
  isRecording: false,
  startTime: 0,
  timerInterval: null,
  indicatorElement: null,
  recordingCanvas: null,
  recordingCtx: null,
  animationFrameId: null,
  audioContext: null,
  audioDestination: null,
  micSourceNode: null
}

const createRecordingIndicator = () => {
  const indicator = document.createElement('div')
  indicator.id = 'recording-indicator'
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 10px 15px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 16px;
    z-index: 10000;
    pointer-events: none;
  `

  const redCircle = document.createElement('div')
  redCircle.style.cssText = `
    width: 12px;
    height: 12px;
    background: red;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  `

  const text = document.createElement('span')
  text.textContent = 'Recording'
  text.style.fontWeight = 'bold'

  const time = document.createElement('span')
  time.id = 'recording-time'
  time.textContent = '0:00'
  time.style.marginLeft = '5px'

  indicator.appendChild(redCircle)
  indicator.appendChild(text)
  indicator.appendChild(time)

  // Add CSS animation for pulsing effect
  const style = document.createElement('style')
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `
  document.head.appendChild(style)

  return indicator
}

let micStream: MediaStream | null = null
let webcamStream: MediaStream | null = null
let webcamPreviewElement: HTMLVideoElement | null = null

export const getMicStatus = () => {
  return micStream?.getAudioTracks().some((t) => t.readyState === 'live') ?? false
}

export const getCameraStatus = () => {
  return webcamStream?.getVideoTracks().some((t) => t.readyState === 'live') ?? false
}

export const getRecordingStatus = () => {
  return recordingState.isRecording
}

export const getRecordingAudioDestination = (): { context: AudioContext; destination: MediaStreamAudioDestinationNode } | null => {
  if (recordingState.isRecording && recordingState.audioContext && recordingState.audioDestination) {
    return {
      context: recordingState.audioContext,
      destination: recordingState.audioDestination
    }
  }
  return null
}

export const requestMicPermission = async (): Promise<MediaStream | null> => {
  try {
    // reuse existing stream if we already have one
    if (micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live')) {
      customEvents.emit('recordingUpdate', {
        isMicEnabled: !!micStream,
      })
      return micStream
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48_000 },
        channelCount: { ideal: 2 },
      },
    })

    customEvents.emit('recordingUpdate', {
      isMicEnabled: !!micStream,
    })

    return micStream
  } catch (err) {
    console.warn('Mic permission denied or failed', err)
    micStream = null
    customEvents.emit('recordingUpdate', {
      isMicEnabled: false,
    })
    return null
  }
}

export const requestWebcamPermission = async (): Promise<MediaStream | null> => {
  try {
    // reuse existing stream if we already have one
    if (webcamStream && webcamStream.getVideoTracks().some((t) => t.readyState === 'live')) {
      customEvents.emit('recordingUpdate', {
        isCameraEnabled: !!webcamStream,
      })
      return webcamStream
    }

    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 480 },
        height: { ideal: 480 },
        facingMode: 'user',
      },
    })

    customEvents.emit('recordingUpdate', {
      isCameraEnabled: !!webcamStream,
    })

    return webcamStream
  } catch (err) {
    console.warn('Webcam permission denied or failed', err)
    webcamStream = null
    customEvents.emit('recordingUpdate', {
      isCameraEnabled: false,
    })
    return null
  }
}

const createWebcamPreview = (stream: MediaStream) => {
  const gameCanvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
  if (!gameCanvas) return null

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  // Get actual canvas displayed dimensions
  const canvasRect = gameCanvas.getBoundingClientRect()
  console.log('[recording dims] Canvas rect:', canvasRect.width, canvasRect.height, 'Window:', window.innerWidth, window.innerHeight)

  const scale = canvasRect.width / RECORDING_WIDTH
  const previewSize = Math.round(WEBCAM_SIZE * scale)
  const previewPadding = Math.round(WEBCAM_PADDING * scale)
  const previewBorderRadius = Math.round(WEBCAM_BORDER_RADIUS * scale)

  // Position relative to the canvas element's bottom-right corner
  const bottomPos = (window.innerHeight - canvasRect.bottom) + previewPadding
  const rightPos = (window.innerWidth - canvasRect.right) + previewPadding

  console.log('[recording dims] Preview size:', previewSize, 'padding:', previewPadding, 'bottom:', bottomPos, 'right:', rightPos)

  // Style as visible preview in bottom-right corner of the canvas
  video.style.cssText = `
    position: fixed;
    bottom: ${bottomPos}px;
    right: ${rightPos}px;
    width: ${previewSize}px;
    height: ${previewSize}px;
    object-fit: cover;
    border-radius: ${previewBorderRadius}px;
    z-index: 9999;
    pointer-events: none;
    transform: scaleX(-1);
  `

  return video
}

export const toggleMic = async () => {
  if (micStream) {
    // Deactivate mic
    // Disconnect from audio destination if recording
    if (recordingState.micSourceNode) {
      recordingState.micSourceNode.disconnect()
      recordingState.micSourceNode = null
    }
    // eslint-disable-next-line unicorn/no-array-for-each
    micStream.getTracks()?.forEach((t) => t.stop())
    micStream = null
    customEvents.emit('recordingUpdate', {
      isMicEnabled: false,
    })
    console.log('Mic deactivated')
  } else {
    // Activate mic
    await requestMicPermission()
    // Hot-plug: connect to audio destination if recording is active
    if (micStream && recordingState.audioContext && recordingState.audioDestination) {
      recordingState.micSourceNode = recordingState.audioContext.createMediaStreamSource(micStream)
      recordingState.micSourceNode.connect(recordingState.audioDestination)
      console.log('Mic connected to recording audio destination')
    }
    console.log('Mic activated:', !!micStream)
  }
}

export const toggleCamera = async () => {
  if (webcamStream) {
    // Deactivate camera
    // eslint-disable-next-line unicorn/no-array-for-each
    webcamStream.getTracks()?.forEach((t) => t.stop())
    webcamStream = null
    customEvents.emit('recordingUpdate', {
      isCameraEnabled: false,
    })
    if (webcamPreviewElement) {
      webcamPreviewElement.pause()
      webcamPreviewElement.srcObject = null
      webcamPreviewElement.remove()
      webcamPreviewElement = null
    }
    console.log('Camera deactivated')
  } else {
    // Activate camera
    const webcam = await requestWebcamPermission()
    if (webcam) {
      webcamPreviewElement = createWebcamPreview(webcam)
      if (webcamPreviewElement) {
        document.body.appendChild(webcamPreviewElement)
        await webcamPreviewElement.play()
      }
    }
    console.log('Camera activated:', !!webcamStream)
  }
}

export const toggleRecording = async () => {
  console.log('[recording] toggleRecording called, isRecording:', recordingState.isRecording)
  if (recordingState.isRecording) {
    stopCanvasRecording()
  } else {
    await startCanvasRecording()
  }
}

// Helper to send unauthorized message to parent and release pointer lock
const sendUnauthorizedMessage = (feature: 'recording' | 'camera' | 'voice') => {
  document.exitPointerLock?.()
  if (window !== window.parent) {
    window.parent.postMessage({
      source: 'minecraft-web-client',
      action: 'unauthorized',
      feature
    }, '*')
  }
}

// C key to toggle camera
if (appQueryParams.isPlayback === 'true') {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Don't toggle if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      // Check authorization
      if (appQueryParams.allowRecording !== 'true') {
        sendUnauthorizedMessage('camera')
        return
      }
      void toggleCamera()
    }
  })

  // V key to toggle voice/mic
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      // Don't toggle if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      // Check authorization
      if (appQueryParams.allowRecording !== 'true') {
        sendUnauthorizedMessage('voice')
        return
      }
      void toggleMic()
    }
  })

  // R key to toggle recording
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Don't toggle if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      // Check authorization
      if (appQueryParams.allowRecording !== 'true') {
        sendUnauthorizedMessage('recording')
        return
      }
      void toggleRecording()
    }
  })
}

const MAX_RECORDING_SECONDS = 60

const updateRecordingTime = () => {
  const elapsed = Math.floor((Date.now() - recordingState.startTime) / 1000)
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeElement = document.getElementById('recording-time')
  if (timeElement) {
    timeElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Auto-stop recording after max duration
  if (elapsed >= MAX_RECORDING_SECONDS) {
    console.log('[recording] Max duration reached, stopping recording')
    stopCanvasRecording()
  }
}

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
// eslint-disable-next-line max-params
) => {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

const showRecordingCountdown = async (): Promise<void> => {
  return new Promise((resolve) => {
    // Create overlay container
    const overlay = document.createElement('div')
    overlay.id = 'recording-countdown-overlay'
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.85) 100%);
      z-index: 10000;
      pointer-events: none;
    `

    // Create content container for proper centering
    const contentBox = document.createElement('div')
    contentBox.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    `

    // Create label text
    const labelEl = document.createElement('div')
    labelEl.style.cssText = `
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 32px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-bottom: 20px;
      transition: opacity 0.3s ease;
    `
    labelEl.textContent = 'Recording starts in'

    // Create countdown number element
    const countdownEl = document.createElement('div')
    countdownEl.style.cssText = `
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 120px;
      font-weight: 700;
      color: white;
      text-shadow:
        0 0 60px rgba(255, 100, 100, 0.9),
        0 0 120px rgba(255, 80, 80, 0.5),
        0 4px 8px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: scale(0.5);
      transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      line-height: 1;
      min-width: 100px;
    `

    contentBox.appendChild(labelEl)
    contentBox.appendChild(countdownEl)
    overlay.appendChild(contentBox)
    document.body.appendChild(overlay)

    const counts = [3, 2, 1]
    let index = 0

    const showNext = () => {
      if (index >= counts.length) {
        // Show "Recording" with animated red dot
        labelEl.style.opacity = '0'
        labelEl.style.height = '0'
        labelEl.style.marginBottom = '0'

        countdownEl.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 16px;">
            <span style="
              display: inline-block;
              width: 20px;
              height: 20px;
              background: #ff4444;
              border-radius: 50%;
              box-shadow: 0 0 20px #ff4444, 0 0 40px rgba(255, 68, 68, 0.5);
              animation: pulse-dot 1s ease-in-out infinite;
            "></span>
            <span style="font-size: 42px; font-weight: 600; letter-spacing: 3px;">RECORDING</span>
          </div>
        `
        countdownEl.style.textShadow = '0 0 30px rgba(255, 68, 68, 0.4)'
        countdownEl.style.opacity = '1'
        countdownEl.style.transform = 'scale(1)'

        // Add keyframe animation for pulsing dot
        const style = document.createElement('style')
        style.textContent = `
          @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(0.85); }
          }
        `
        document.head.appendChild(style)

        setTimeout(() => {
          style.remove()
          overlay.remove()
          resolve()
        }, 600)
        return
      }

      countdownEl.textContent = String(counts[index])
      countdownEl.style.opacity = '0'
      countdownEl.style.transform = 'scale(0.5)'

      // Trigger animation
      requestAnimationFrame(() => {
        countdownEl.style.opacity = '1'
        countdownEl.style.transform = 'scale(1)'
      })

      // Fade out before next number
      setTimeout(() => {
        countdownEl.style.opacity = '0'
        countdownEl.style.transform = 'scale(1.3)'
      }, 650)

      index++
      setTimeout(showNext, 1000)
    }

    showNext()
  })
}

const startCanvasRecording = async () => {
  console.log('[recording] startCanvasRecording called')

  // Prevent double-starting
  if (recordingState.isRecording) {
    console.warn('[recording] Recording already in progress')
    return
  }

  const gameCanvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
  if (!gameCanvas) {
    console.warn('[recording] Canvas not found for recording')
    return
  }
  console.log('[recording] Found viewer-canvas:', gameCanvas.width, 'x', gameCanvas.height)

  // Show countdown before starting
  await showRecordingCountdown()

  try {
    // Create recording canvas at 1920x1080
    const recordingCanvas = document.createElement('canvas')
    recordingCanvas.width = RECORDING_WIDTH
    recordingCanvas.height = RECORDING_HEIGHT
    const ctx = recordingCanvas.getContext('2d')
    if (!ctx) {
      console.warn('Could not get 2d context for recording canvas')
      return
    }
    recordingState.recordingCanvas = recordingCanvas
    recordingState.recordingCtx = ctx

    // Compositing loop - draws game canvas and webcam to recording canvas
    // Uses webcamPreviewElement directly for camera hot-plugging support
    const drawFrame = () => {
      if (!recordingState.isRecording) return

      // Draw the game canvas scaled to fill the recording canvas
      ctx.drawImage(gameCanvas, 0, 0, RECORDING_WIDTH, RECORDING_HEIGHT)

      // Draw chat overlay canvas if it exists (for canvas chat rendering)
      const chatOverlay = document.getElementById('chat-overlay-canvas') as HTMLCanvasElement
      if (chatOverlay) {
        ctx.drawImage(chatOverlay, 0, 0, RECORDING_WIDTH, RECORDING_HEIGHT)
      }

      // Draw webcam if available (square, bottom right, with rounded corners)
      // Uses webcamPreviewElement directly so camera can be hot-plugged
      if (webcamPreviewElement && webcamPreviewElement.readyState >= 2) {
        const webcamX = RECORDING_WIDTH - WEBCAM_SIZE - WEBCAM_PADDING
        const webcamY = RECORDING_HEIGHT - WEBCAM_SIZE - WEBCAM_PADDING

        // Save context state
        ctx.save()

        // Create clipping path for rounded corners
        drawRoundedRect(ctx, webcamX, webcamY, WEBCAM_SIZE, WEBCAM_SIZE, WEBCAM_BORDER_RADIUS)
        ctx.clip()

        // Flip horizontally for mirror effect
        ctx.translate(webcamX + WEBCAM_SIZE, webcamY)
        ctx.scale(-1, 1)

        // Calculate crop to make webcam square (center crop)
        const { videoWidth, videoHeight } = webcamPreviewElement
        const minDim = Math.min(videoWidth, videoHeight)
        const srcX = (videoWidth - minDim) / 2
        const srcY = (videoHeight - minDim) / 2

        // Draw the webcam video cropped to square (at 0,0 since we translated)
        ctx.drawImage(
          webcamPreviewElement,
          srcX,
          srcY,
          minDim,
          minDim,
          0,
          0,
          WEBCAM_SIZE,
          WEBCAM_SIZE
        )

        // Restore context state
        ctx.restore()
      }

      recordingState.animationFrameId = requestAnimationFrame(drawFrame)
    }

    // Start the compositing loop
    recordingState.isRecording = true
    console.log('[recording] Set isRecording = true, emitting recordingUpdate')
    customEvents.emit('recordingUpdate', {
      isRecording: true,
    })
    drawFrame()

    // Capture the recording canvas stream at 60fps
    console.log('[recording] Calling captureStream(60)')
    const recordingStream = recordingCanvas.captureStream(60)
    console.log('[recording] captureStream successful, tracks:', recordingStream.getTracks().length)

    // Set up AudioContext for mic hot-plugging support
    // The audio destination provides a constant audio track that we can connect/disconnect mic to
    // Use high sample rate and playback latency hint for better quality
    console.log('[recording] Creating AudioContext')
    const audioContext = new AudioContext({
      sampleRate: 48_000,
      latencyHint: 'playback'
    })
    console.log('[recording] AudioContext created, state:', audioContext.state)

    // Ensure AudioContext is running (may be suspended on subsequent recordings)
    if (audioContext.state === 'suspended') {
      console.log('[recording] AudioContext suspended, resuming...')
      await audioContext.resume()
      console.log('[recording] AudioContext resumed, state:', audioContext.state)
    }

    const audioDestination = audioContext.createMediaStreamDestination()
    recordingState.audioContext = audioContext
    recordingState.audioDestination = audioDestination

    // Create a silent oscillator to keep the audio graph timing stable
    // Without this, connecting mic mid-recording causes sync issues
    const silentOscillator = audioContext.createOscillator()
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0 // Silent
    silentOscillator.connect(silentGain)
    silentGain.connect(audioDestination)
    silentOscillator.start()

    // Connect mic if it's already active
    if (micStream && micStream.getAudioTracks().some(t => t.readyState === 'live')) {
      recordingState.micSourceNode = audioContext.createMediaStreamSource(micStream)
      recordingState.micSourceNode.connect(audioDestination)
      console.log('Mic connected to audio destination at recording start')
    }

    // Use high quality settings
    console.log('[recording] Setting up MediaRecorder options')
    const recorderOptions = {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 10_000_000 // 10 Mbps for high quality 1080p60
    }

    // Fallback to vp8 if vp9 is not supported
    if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType)) {
      console.log('[recording] vp9 not supported, falling back to vp8')
      recorderOptions.mimeType = 'video/webm;codecs=vp8'
    }
    console.log('[recording] Using mimeType:', recorderOptions.mimeType)

    // Combine video from recording canvas with audio from destination
    // The destination provides a constant audio track - mic can be connected/disconnected dynamically
    const combinedStream = new MediaStream([
      ...recordingStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ])
    console.log('[recording] Combined stream created with', combinedStream.getTracks().length, 'tracks')

    console.log('[recording] Creating MediaRecorder')
    const mediaRecorder = new MediaRecorder(combinedStream, recorderOptions)
    console.log('[recording] MediaRecorder created, state:', mediaRecorder.state)
    recordingState.chunks = []

    mediaRecorder.ondataavailable = (event) => {
      console.log('[recording] ondataavailable, size:', event.data.size)
      if (event.data.size > 0) {
        recordingState.chunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      console.log('[recording] onstop called, chunks:', recordingState.chunks.length)
      // Only stop video tracks from recording stream (not mic - managed by toggle)
      // eslint-disable-next-line unicorn/no-array-for-each
      recordingStream.getVideoTracks()?.forEach((t) => t.stop())

      const blob = new Blob(recordingState.chunks, { type: 'video/webm' })
      console.log('[recording] Blob created, size:', blob.size)
      const date = new Date()
      const filename = `recording ${date.toLocaleString().replaceAll('.', '-').replace(',', '')}.webm`

      // Send recording data to parent via postMessage
      console.log('[recording] Emitting recordingComplete event')
      customEvents.emit('recordingComplete', { blob, filename })

      recordingState.mediaRecorder = null
      recordingState.chunks = []
      console.log('[recording] Recording complete, data sent to parent')
    }

    // Start recording with 1 second timeslice to ensure regular data capture
    console.log('[recording] Starting MediaRecorder')
    mediaRecorder.start(1000)
    recordingState.mediaRecorder = mediaRecorder
    recordingState.startTime = Date.now()
    console.log('[recording] MediaRecorder started, state:', mediaRecorder.state)

    // Create and show indicator
    console.log('[recording] Creating indicator element')
    recordingState.indicatorElement = createRecordingIndicator()
    console.log('[recording] Appending indicator to document.body')
    document.body.appendChild(recordingState.indicatorElement)
    console.log('[recording] Indicator appended successfully')

    // Start timer update
    recordingState.timerInterval = setInterval(updateRecordingTime, 1000)

    console.log('[recording] Canvas recording started (1920x1080 with webcam overlay)')
  } catch (error) {
    console.error('[recording] Failed to start canvas recording:', error)
    // Reset state on error
    recordingState.isRecording = false
    customEvents.emit('recordingUpdate', {
      isRecording: false,
    })
  }
}

const stopCanvasRecording = () => {
  console.log('[recording] stopCanvasRecording called')
  if (recordingState.mediaRecorder && recordingState.isRecording) {
    console.log('[recording] Stopping MediaRecorder')
    recordingState.mediaRecorder.stop()
    recordingState.isRecording = false
    customEvents.emit('recordingUpdate', {
      isRecording: false,
    })

    // Stop animation frame
    if (recordingState.animationFrameId) {
      cancelAnimationFrame(recordingState.animationFrameId)
      recordingState.animationFrameId = null
    }

    // Clean up audio context and nodes
    if (recordingState.micSourceNode) {
      recordingState.micSourceNode.disconnect()
      recordingState.micSourceNode = null
    }
    if (recordingState.audioContext) {
      void recordingState.audioContext.close()
      recordingState.audioContext = null
    }
    recordingState.audioDestination = null

    // Clean up recording canvas
    recordingState.recordingCanvas = null
    recordingState.recordingCtx = null

    // Clear timer and remove indicator
    if (recordingState.timerInterval) {
      clearInterval(recordingState.timerInterval)
      recordingState.timerInterval = null
    }

    if (recordingState.indicatorElement) {
      recordingState.indicatorElement.remove()
      recordingState.indicatorElement = null
    }

    // Release pointer lock so user can interact with UI
    if (document.pointerLockElement) {
      document.exitPointerLock?.()
    }

    // Pause playback
    packetsReplayState.isPlaying = false

    console.log('[recording] Canvas recording stopped')
  } else {
    console.log('[recording] stopCanvasRecording: conditions not met, mediaRecorder:', !!recordingState.mediaRecorder, 'isRecording:', recordingState.isRecording)
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (recordingState.holdTimeout) {
    clearTimeout(recordingState.holdTimeout)
  }
  if (recordingState.timerInterval) {
    clearInterval(recordingState.timerInterval)
  }
  if (recordingState.animationFrameId) {
    cancelAnimationFrame(recordingState.animationFrameId)
  }
  if (recordingState.isRecording) {
    stopCanvasRecording()
  }
})

// Stop recording when pointer lock is released
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && recordingState.isRecording) {
    console.log('[recording] Pointer lock released, stopping recording')
    stopCanvasRecording()
  }
})

// Stop recording when Escape key is pressed (in case pointer lock doesn't catch it)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && recordingState.isRecording) {
    console.log('[recording] Escape pressed, stopping recording')
    stopCanvasRecording()
  }
})
// #endregion

// #region experimental debug things
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    console.clear()
  }
  if (e.code === 'KeyK' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    if (sessionStorage.delayLoadUntilFocus) {
      sessionStorage.removeItem('delayLoadUntilFocus')
    } else {
      sessionStorage.setItem('delayLoadUntilFocus', 'true')
    }
  }
})
// #endregion

export function updateBinds (commands: any) {
  contro.inputSchema.commands.custom = Object.fromEntries(Object.entries(commands?.custom ?? {}).map(([key, value]) => {
    return [key, {
      keys: [],
      gamepad: [],
      type: '',
      inputs: []
    }]
  }))

  for (const [group, actions] of Object.entries(commands)) {
    contro.userConfig![group] = Object.fromEntries(Object.entries(actions).map(([key, value]) => {
      const newValue = {
        keys: value?.keys ?? undefined,
        gamepad: value?.gamepad ?? undefined,
      }

      if (group === 'custom') {
        newValue['type'] = (value).type
        newValue['inputs'] = (value).inputs
      }

      return [key, newValue]
    }))
  }
}
