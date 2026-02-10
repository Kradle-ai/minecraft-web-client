/* eslint-disable import/order */
import './importsWorkaround'
import './styles.css'
import './testCrasher'
import './globals'
import './devtools'
import './entities'
import './customChannels'
import './globalDomListeners'
import './mineflayer/maps'
import './mineflayer/cameraShake'
import './shims/patchShims'
import './mineflayer/java-tester/index'
import './external'
import './appConfig'
import './mineflayer/timers'
import { getServerInfo } from './mineflayer/mc-protocol'
import { onGameLoad } from './inventoryWindows'
import initCollisionShapes from './getCollisionInteractionShapes'
import protocolMicrosoftAuth from 'minecraft-protocol/src/client/microsoftAuth'
import microsoftAuthflow from './microsoftAuthflow'
import { Duplex } from 'stream'

import './scaleInterface'

import { options } from './optionsStorage'
import './reactUi'
import { lockUrl, onBotCreate } from './controls'
import './dragndrop'
import { possiblyCleanHandle, resetStateAfterDisconnect } from './browserfs'
import { watchOptionsAfterViewerInit, watchOptionsAfterWorldViewInit } from './watchOptions'
import downloadAndOpenFile from './downloadAndOpenFile'

import fs from 'fs'
import net from 'net'
import mineflayer from 'mineflayer'

import debug from 'debug'
import { defaultsDeep } from 'lodash-es'
import initializePacketsReplay from './packetsReplay/packetsReplayLegacy'

import {
  activeModalStack,
  activeModalStacks,
  hideModal,
  insertActiveModalStack,
  isGameActive,
  miscUiState,
  showModal,
  gameAdditionalState,
} from './globalState'

import { parseServerAddress } from './parseServerAddress'
import { setLoadingScreenStatus } from './appStatus'
import { isCypress } from './standaloneUtils'

import { startLocalServer, unsupportedLocalServerFeatures } from './createLocalServer'
import defaultServerOptions from './defaultLocalServerOptions'
import dayCycle from './dayCycle'

import { onAppLoad, resourcepackReload, resourcePackState } from './resourcePack'
import { ConnectPeerOptions, connectToPeer } from './localServerMultiplayer'
import CustomChannelClient from './customClient'
import { registerServiceWorker } from './serviceWorker'
import { appStatusState, lastConnectOptions } from './react/AppStatusProvider'

import { fsState } from './loadSave'
import { watchFov } from './rendererUtils'
import { loadInMemorySave } from './react/SingleplayerProvider'

import { possiblyHandleStateVariable } from './googledrive'
import flyingSquidEvents from './flyingSquidEvents'
import { showNotification } from './react/NotificationProvider'
import { saveToBrowserMemory } from './react/PauseScreen'
import './devReload'
import './water'
import { ConnectOptions, loadMinecraftData, getVersionAutoSelect, downloadOtherGameData, downloadAllMinecraftData } from './connect'
import { ref, subscribe } from 'valtio'
import { signInMessageState } from './react/SignInMessageProvider'
import { updateAuthenticatedAccountData, updateLoadedServerData, updateServerConnectionHistory } from './react/serversStorage'
import packetsPatcher from './mineflayer/plugins/packetsPatcher'
import { mainMenuState } from './react/MainMenuRenderApp'
import './mobileShim'
import { parseFormattedMessagePacket } from './botUtils'
import { getViewerVersionData, getWsProtocolStream, handleCustomChannel } from './viewerConnector'
import { getWebsocketStream } from './mineflayer/websocket-core'
import { appQueryParams, appQueryParamsArray } from './appParams'
import { playerState } from './mineflayer/playerState'
import { states } from 'minecraft-protocol'
import { initMotionTracking } from './react/uiMotion'
import { UserError } from './mineflayer/userError'
import ping from './mineflayer/plugins/ping'
import mouse from './mineflayer/plugins/mouse'
import { startLocalReplayServer } from './packetsReplay/replayPackets'
import { localRelayServerPlugin } from './mineflayer/plugins/packetsRecording'
import { createConsoleLogProgressReporter, createFullScreenProgressReporter, ProgressReporter } from './core/progressReporter'
import { appViewer } from './appViewer'
import createGraphicsBackend from 'renderer/viewer/three/graphicsBackend'
import { subscribeKey } from 'valtio/utils'
import { setupIframeComms } from './iframe'
import { trackCameraMovement } from './interactiveControls'
import { renderChatOnCanvas } from './canvasChatRenderer'

window.debug = debug
window.beforeRenderFrame = []

// Add canvas chat rendering (disabled via ?chat=false)
beforeRenderFrame.push(renderChatOnCanvas)

// ACTUAL CODE

setupIframeComms()
void registerServiceWorker().then(() => {
  mainMenuState.serviceWorkerLoaded = true
})
watchFov()
initCollisionShapes()
initializePacketsReplay()
packetsPatcher()
onAppLoad()

if (appQueryParams.testCrashApp === '2') throw new Error('test')

const loadBackend = () => {
  appViewer.loadBackend(createGraphicsBackend)
}
window.loadBackend = loadBackend
if (process.env.SINGLE_FILE_BUILD_MODE) {
  const unsub = subscribeKey(miscUiState, 'fsReady', () => {
    if (miscUiState.fsReady) {
      // don't do it earlier to load fs and display menu faster
      loadBackend()
      unsub()
    }
  })
} else {
  loadBackend()
}

const animLoop = () => {
  for (const fn of beforeRenderFrame) fn()
  requestAnimationFrame(animLoop)
}
requestAnimationFrame(animLoop)

watchOptionsAfterViewerInit()

function hideCurrentScreens () {
  activeModalStacks['main-menu'] = [...activeModalStack]
  insertActiveModalStack('', [])
}

const loadSingleplayer = (serverOverrides = {}, flattenedServerOverrides = {}) => {
  const serverSettingsQsRaw = appQueryParamsArray.serverSetting ?? []
  // eslint-disable-next-line unicorn/no-array-reduce
  const serverSettingsQs = serverSettingsQsRaw.map(x => x.split(':')).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = JSON.parse(value)
    return acc
  }, {})
  void connect({ singleplayer: true, username: options.localUsername, serverOverrides, serverOverridesFlat: { ...flattenedServerOverrides, ...serverSettingsQs } })
}
function listenGlobalEvents () {
  window.addEventListener('connect', e => {
    const options = (e as CustomEvent).detail
    void connect(options)
  })
  window.addEventListener('singleplayer', (e) => {
    loadSingleplayer((e as CustomEvent).detail)
  })
}

export async function connect (connectOptions: ConnectOptions) {
  if (miscUiState.gameLoaded) return

  if (sessionStorage.delayLoadUntilFocus) {
    await new Promise(resolve => {
      if (document.hasFocus()) {
        resolve(undefined)
      } else {
        window.addEventListener('focus', resolve)
      }
    })
  }
  if (sessionStorage.delayLoadUntilClick) {
    await new Promise(resolve => {
      window.addEventListener('click', resolve)
    })
  }

  miscUiState.hasErrors = false
  lastConnectOptions.value = connectOptions

  const { singleplayer } = connectOptions
  const p2pMultiplayer = !!connectOptions.peerId
  miscUiState.singleplayer = singleplayer
  miscUiState.flyingSquid = singleplayer || p2pMultiplayer

  // Track server connection in history
  if (!singleplayer && !p2pMultiplayer && connectOptions.server && connectOptions.saveServerToHistory !== false) {
    const parsedServer = parseServerAddress(connectOptions.server)
    updateServerConnectionHistory(parsedServer.host, connectOptions.botVersion)
  }

  const { renderDistance: renderDistanceSingleplayer, multiplayerRenderDistance } = options

  const parsedServer = parseServerAddress(connectOptions.server)
  const server = { host: parsedServer.host, port: parsedServer.port }
  if (connectOptions.proxy?.startsWith(':')) {
    connectOptions.proxy = `${location.protocol}//${location.hostname}${connectOptions.proxy}`
  }
  if (connectOptions.proxy && location.port !== '80' && location.port !== '443' && !/:\d+$/.test(connectOptions.proxy)) {
    const https = connectOptions.proxy.startsWith('https://') || location.protocol === 'https:'
    connectOptions.proxy = `${connectOptions.proxy}:${https ? 443 : 80}`
  }
  const parsedProxy = parseServerAddress(connectOptions.proxy, false)
  const proxy = { host: parsedProxy.host, port: parsedProxy.port }
  let { username } = connectOptions

  if (connectOptions.server) {
    console.log(`connecting to ${server.host}:${server.port ?? 25_565}`)
  }
  console.log('using player username', username)

  hideCurrentScreens()
  const progress = createFullScreenProgressReporter()
  const loggingInMsg = connectOptions.server ? 'Connecting to server' : 'Logging in'
  progress.beginStage('connect', loggingInMsg)

  // Report connecting status to parent app
  customEvents.emit('connectionStatus', {
    status: 'connecting',
    message: loggingInMsg,
    canReconnect: false // can't reconnect while connecting
  })

  let ended = false
  let bot!: typeof __type_bot
  const destroyAll = () => {
    if (ended) return
    ended = true
    progress.end()
    // dont reset viewer so we can still do debugging
    localServer = window.localServer = window.server = undefined
    gameAdditionalState.viewerConnection = false

    if (bot) {
      bot.end()
      // ensure mineflayer plugins receive this event for cleanup
      bot.emit('end', '')
      bot.removeAllListeners()
      bot._client.removeAllListeners()
      //@ts-expect-error TODO?
      bot._client = undefined
      //@ts-expect-error
      window.bot = bot = undefined
      window.following = undefined
    }
    resetStateAfterDisconnect()
    cleanFs()
  }
  const cleanFs = () => {
    if (singleplayer && !fsState.inMemorySave) {
      possiblyCleanHandle(() => {
        // todo: this is not enough, we need to wait for all async operations to finish
      })
    }
  }
  let lastPacket = undefined as string | undefined
  const onPossibleErrorDisconnect = () => {
    if (lastPacket && bot?._client && bot._client.state !== states.PLAY) {
      appStatusState.descriptionHint = `Last Server Packet: ${lastPacket}`
    }
  }
  const handleError = (err) => {
    console.error(err)
    if (err === 'ResizeObserver loop completed with undelivered notifications.') {
      return
    }
    errorAbortController.abort()
    if (isCypress()) throw err
    miscUiState.hasErrors = true
    if (miscUiState.gameLoaded) return

    setLoadingScreenStatus(`Error encountered. ${err}`, true)
    appStatusState.showReconnect = true
    onPossibleErrorDisconnect()

    // Report error to parent app
    customEvents.emit('connectionStatus', {
      status: 'error',
      message: `Connection error: ${err}`,
      errorDetails: String(err),
      canReconnect: !!lastConnectOptions.value
    })

    destroyAll()
  }

  const errorAbortController = new AbortController()
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason.name === 'ServerPluginLoadFailure') {
      if (confirm(`Failed to load server plugin ${e.reason.pluginName} (invoking ${e.reason.pluginMethod}). Continue?`)) {
        return
      }
    }
    handleError(e.reason)
  }, {
    signal: errorAbortController.signal
  })
  window.addEventListener('error', (e) => {
    handleError(e.message)
  }, {
    signal: errorAbortController.signal
  })

  let clientDataStream: Duplex | undefined

  if (connectOptions.server && !connectOptions.viewerWsConnect && !parsedServer.isWebSocket) {
    console.log(`using proxy ${proxy.host}:${proxy.port || location.port}`)
    net['setProxy']({ hostname: proxy.host, port: proxy.port })
  }

  const renderDistance = singleplayer ? renderDistanceSingleplayer : multiplayerRenderDistance
  let updateDataAfterJoin = () => { }
  let localServer
  let localReplaySession: ReturnType<typeof startLocalReplayServer> | undefined
  try {
    const serverOptions = defaultsDeep({}, connectOptions.serverOverrides ?? {}, options.localServerOptions, defaultServerOptions)
    Object.assign(serverOptions, connectOptions.serverOverridesFlat ?? {})

    await progress.executeWithMessage('Downloading minecraft data', 'download-mcdata', async () => {
      await Promise.all([
        downloadAllMinecraftData(),
        downloadOtherGameData()
      ])
    })

    let dataDownloaded = false
    const downloadMcData = async (version: string) => {
      if (dataDownloaded) return
      dataDownloaded = true
      appViewer.resourcesManager.currentConfig = { version, texturesVersion: options.useVersionsTextures || undefined }

      await progress.executeWithMessage(
        'Loading minecraft data',
        async () => {
          await appViewer.resourcesManager.loadSourceData(version)
        }
      )

      await progress.executeWithMessage(
        'Applying user-installed resource pack',
        async () => {
          try {
            await resourcepackReload(true)
          } catch (err) {
            console.error(err)
            const doContinue = confirm('Failed to apply texture pack. See errors in the console. Continue?')
            if (!doContinue) {
              throw err
            }
          }
        }
      )

      await progress.executeWithMessage(
        'Preparing textures',
        async () => {
          await appViewer.resourcesManager.updateAssetsData({})
        }
      )
    }

    let finalVersion = connectOptions.botVersion || (singleplayer ? serverOptions.version : undefined)

    if (connectOptions.worldStateFileContents || (connectOptions as any).mcprReplayData) {
      try {
        // Check if this is MCPR data (pre-parsed packets)
        const mcprData = (connectOptions as any).mcprReplayData
        if (mcprData) {
          console.log('Starting MCPR replay with pre-parsed data:', mcprData.packets.length, 'packets')
          if (mcprData.worldRegionPaths?.length) {
            console.log('World region files to load:', mcprData.worldRegionPaths.length)
          }
          // Store worldRegionPaths in header for later use
          if (mcprData.worldRegionPaths) {
            mcprData.header.worldRegionPaths = mcprData.worldRegionPaths
          }
          localReplaySession = startLocalReplayServer(mcprData.packets, mcprData.header)
        } else {
          localReplaySession = startLocalReplayServer(connectOptions.worldStateFileContents!)
        }
      } catch (err) {
        console.error(err)
        throw new UserError(`Failed to start local replay server: ${err}`)
      }
      finalVersion = localReplaySession.version
    }

    if (singleplayer) {
      // SINGLEPLAYER EXPLAINER:
      // Note 1: here we have custom sync communication between server Client (flying-squid) and game client (mineflayer)
      // Note 2: custom Server class is used which simplifies communication & Client creation on it's side
      // local server started
      // mineflayer.createBot (see source def)
      // bot._client = bot._client ?? mc.createClient(options) <-- mc-protocol package
      // tcpDns() skipped since we define connect option
      // in setProtocol: we emit 'connect' here below so in that file we send set_protocol and login_start (onLogin handler)
      // Client (class) of flying-squid (in server/login.js of mc-protocol): onLogin handler: skip most logic & go to loginClient() which assigns uuid and sends 'success' back to client (onLogin handler) and emits 'login' on the server (login.js in flying-squid handler)
      // flying-squid: 'login' -> player.login -> now sends 'login' event to the client (handled in many plugins in mineflayer) -> then 'update_health' is sent which emits 'spawn' in mineflayer

      localServer = window.localServer = window.server = startLocalServer(serverOptions)
      // todo need just to call quit if started
      // loadingScreen.maybeRecoverable = false
      // init world, todo: do it for any async plugins
      if (!localServer.pluginsReady) {
        await progress.executeWithMessage(
          'Starting local server',
          async () => {
            await new Promise(resolve => {
              localServer.once('pluginsReady', resolve)
            })
          }
        )
      }

      localServer.on('newPlayer', (player) => {
        player.on('loadingStatus', (newStatus) => {
          progress.setMessage(newStatus)
        })
      })
      flyingSquidEvents()
    }

    if (connectOptions.authenticatedAccount) username = 'you'
    let initialLoadingText: string
    if (singleplayer) {
      initialLoadingText = 'Local server is still starting'
    } else if (p2pMultiplayer) {
      initialLoadingText = 'Connecting to peer'
    } else if (connectOptions.server) {
      if (!finalVersion) {
        const versionAutoSelect = getVersionAutoSelect()
        setLoadingScreenStatus(`Fetching server version. Preffered: ${versionAutoSelect}`)
        const autoVersionSelect = await getServerInfo(server.host, server.port ? Number(server.port) : undefined, versionAutoSelect)
        finalVersion = autoVersionSelect.version
      }
      initialLoadingText = `Connecting to server ${server.host}:${server.port ?? 25_565} with version ${finalVersion}`
    } else if (connectOptions.viewerWsConnect) {
      initialLoadingText = `Connecting to Mineflayer WebSocket server ${connectOptions.viewerWsConnect}`
    } else if (connectOptions.worldStateFileContents) {
      initialLoadingText = `Loading local replay server`
    } else {
      initialLoadingText = 'We have no idea what to do'
    }
    setLoadingScreenStatus(initialLoadingText)

    if (parsedServer.isWebSocket) {
      clientDataStream = (await getWebsocketStream(server.host)).mineflayerStream
    }

    let newTokensCacheResult = null as any
    const cachedTokens = typeof connectOptions.authenticatedAccount === 'object' ? connectOptions.authenticatedAccount.cachedTokens : {}
    const authData = connectOptions.authenticatedAccount ? await microsoftAuthflow({
      tokenCaches: cachedTokens,
      proxyBaseUrl: connectOptions.proxy,
      setProgressText (text) {
        setLoadingScreenStatus(text)
      },
      setCacheResult (result) {
        newTokensCacheResult = result
      },
      connectingServer: server.host
    }) : undefined

    if (p2pMultiplayer) {
      clientDataStream = await connectToPeer(connectOptions.peerId!, connectOptions.peerOptions)
    }
    if (connectOptions.viewerWsConnect) {
      const { version, time, requiresPass } = await getViewerVersionData(connectOptions.viewerWsConnect)
      let password
      if (requiresPass) {
        password = prompt('Enter password')
        if (!password) {
          throw new UserError('Password is required')
        }
      }
      console.log('Latency:', Date.now() - time, 'ms')
      // const version = '1.21.1'
      finalVersion = version
      await downloadMcData(version)
      setLoadingScreenStatus(`Connecting to WebSocket server ${connectOptions.viewerWsConnect}`)
      clientDataStream = (await getWsProtocolStream(connectOptions.viewerWsConnect)).clientDuplex
      if (password) {
        clientDataStream.write(password)
      }
      gameAdditionalState.viewerConnection = true
    }

    if (finalVersion) {
      // ensure data is downloaded
      await downloadMcData(finalVersion)
    }

    const brand = clientDataStream ? 'minecraft-web-client' : undefined
    bot = mineflayer.createBot({
      host: server.host,
      port: server.port ? +server.port : undefined,
      brand,
      version: finalVersion || false,
      ...clientDataStream ? {
        stream: clientDataStream as any,
      } : {},
      ...singleplayer || p2pMultiplayer || localReplaySession ? {
        keepAlive: false,
      } : {},
      ...singleplayer ? {
        version: serverOptions.version,
        connect () { },
        Client: CustomChannelClient as any,
      } : {},
      ...localReplaySession ? {
        connect () { },
        Client: CustomChannelClient as any,
      } : {},
      onMsaCode (data) {
        signInMessageState.code = data.user_code
        signInMessageState.link = data.verification_uri
        signInMessageState.expiresOn = Date.now() + data.expires_in * 1000
      },
      sessionServer: authData?.sessionEndpoint?.toString(),
      auth: connectOptions.authenticatedAccount ? async (client, options) => {
        authData!.setOnMsaCodeCallback(options.onMsaCode)
        authData?.setConnectingVersion(client.version)
        //@ts-expect-error
        client.authflow = authData!.authFlow
        try {
          signInMessageState.abortController = ref(new AbortController())
          await Promise.race([
            protocolMicrosoftAuth.authenticate(client, options),
            new Promise((_r, reject) => {
              signInMessageState.abortController.signal.addEventListener('abort', () => {
                reject(new UserError('Aborted by user'))
              })
            })
          ])
          if (signInMessageState.shouldSaveToken) {
            updateAuthenticatedAccountData(accounts => {
              const existingAccount = accounts.find(a => a.username === client.username)
              if (existingAccount) {
                existingAccount.cachedTokens = { ...existingAccount.cachedTokens, ...newTokensCacheResult }
              } else {
                accounts.push({
                  username: client.username,
                  cachedTokens: { ...cachedTokens, ...newTokensCacheResult }
                })
              }
              return accounts
            })
            updateDataAfterJoin = () => {
              updateLoadedServerData(s => ({ ...s, authenticatedAccountOverride: client.username }), connectOptions.serverIndex)
            }
          } else {
            updateDataAfterJoin = () => {
              updateLoadedServerData(s => ({ ...s, authenticatedAccountOverride: undefined }), connectOptions.serverIndex)
            }
          }
          setLoadingScreenStatus('Authentication successful. Logging in to server')
        } finally {
          signInMessageState.code = ''
        }
      } : undefined,
      username,
      viewDistance: renderDistance,
      checkTimeoutInterval: 240 * 1000,
      // noPongTimeout: 240 * 1000,
      closeTimeout: 240 * 1000,
      respawn: options.autoRespawn,
      maxCatchupTicks: 0,
      'mapDownloader-saveToFile': false,
      // "mapDownloader-saveInternal": false, // do not save into memory, todo must be implemeneted as we do really care of ram
    }) as unknown as typeof __type_bot
    window.bot = bot
    window.following = bot

    // For replay mode: Set up bot.registry and supportFeature BEFORE emitting events
    // This must happen before 'mineflayerBotCreated' event as plugins may need registry
    if (localReplaySession) {
      console.log('Setting up replay mode, finalVersion:', finalVersion)
      if (!bot.registry) {
        // Use the same minecraft-data loading mechanism as the rest of the app
        const mcData = (window as any).allLoadedMcData?.[finalVersion]
        console.log('window.allLoadedMcData exists?', !!(window as any).allLoadedMcData)
        console.log('mcData for version exists?', !!mcData)
        if (mcData) {
          bot.registry = mcData
          console.log('Set bot.registry from allLoadedMcData')
        } else {
          console.warn(`minecraft-data not loaded for version ${finalVersion}, using fallback`)
          try {
            bot.registry = require('minecraft-data')(finalVersion)
            console.log('Set bot.registry from require fallback')
          } catch (err) {
            console.error('Failed to load minecraft-data:', err)
          }
        }
      }
      if (!bot.supportFeature) {
        bot.supportFeature = ((feature) => {
          return bot.registry?.supportFeature?.(feature) ?? false
        }) as typeof bot.supportFeature
      }

      // Initialize dimension data for replay mode
      // The login plugin expects this to exist
      if (bot.registry && !(bot.registry as any).dimensionsByName) {
        console.log('Initializing dimensionsByName for replay mode');
        (bot.registry as any).dimensionsByName = {}
      }

      // Log for debugging
      console.log('Replay mode: bot.registry set?', !!bot.registry)
      if (bot.registry) {
        console.log('bot.registry has biomes?', !!bot.registry.biomes)
        console.log('bot.registry has instruments?', !!bot.registry.instruments)
        console.log('bot.registry has dimensionsByName?', !!(bot.registry as any).dimensionsByName)
      }
    }

    if (connectOptions.viewerWsConnect) {
      void handleCustomChannel()

      // In viewerConnect mode, let the first position packet through (so the client
      // knows where to load chunks), then ignore subsequent ones so the viewer
      // has independent camera control (same as replay mode)
      const VIEWER_IGNORE_PACKETS = new Set(['position', 'synchronize_player_position'])
      let firstPositionReceived = false
      const origEmit = bot._client.emit.bind(bot._client)

      bot.once('end', () => {
        if (bot?._client) {
          bot._client.emit = origEmit
        }
      })

      bot._client.emit = (event: string, ...args: any[]) => {
        if (VIEWER_IGNORE_PACKETS.has(event)) {
          if (!firstPositionReceived) {
            firstPositionReceived = true
            return origEmit(event, ...args)
          }
          return true
        }
        // Force spectator mode so viewer always gets free camera
        if (event === 'login' && args[0]) {
          args[0] = { ...args[0], gameMode: 3 }
        }
        if (event === 'respawn' && args[0]) {
          args[0] = { ...args[0], gameMode: 3 }
        }
        // Block server-initiated gamemode changes (reason 3 = change gamemode)
        if (event === 'game_state_change' && args[0]?.reason === 3) {
          return true
        }
        return origEmit(event, ...args)
      }
    }
    customEvents.emit('mineflayerBotCreated')
    if (singleplayer || p2pMultiplayer || localReplaySession) {
      if (singleplayer || p2pMultiplayer) {
        // in case of p2pMultiplayer there is still flying-squid on the host side
        const _supportFeature = bot.supportFeature
        bot.supportFeature = ((feature) => {
          if (unsupportedLocalServerFeatures.includes(feature)) {
            return false
          }
          return _supportFeature(feature)
        }) as typeof bot.supportFeature
      }

      bot.emit('inject_allowed')
      bot._client.emit('connect')
    } else if (clientDataStream) {
      // bot.emit('inject_allowed')
      bot._client.emit('connect')
    } else {
      const setupConnectHandlers = () => {
        bot._client.socket.on('connect', () => {
          console.log('Proxy WebSocket connection established')
          //@ts-expect-error
          bot._client.socket._ws.addEventListener('close', () => {
            console.log('WebSocket connection closed')
            setTimeout(() => {
              if (bot) {
                bot.emit('end', 'WebSocket connection closed with unknown reason')
              }
            }, 1000)
          })
          bot._client.socket.on('close', () => {
            setTimeout(() => {
              if (bot) {
                bot.emit('end', 'WebSocket connection closed with unknown reason')
              }
            })
          })
        })
      }
      // socket setup actually can be delayed because of dns lookup
      if (bot._client.socket) {
        setupConnectHandlers()
      } else {
        const originalSetSocket = bot._client.setSocket.bind(bot._client)
        bot._client.setSocket = (socket) => {
          if (!bot) return
          originalSetSocket(socket)
          setupConnectHandlers()
        }
      }

    }
  } catch (err) {
    handleError(err)
  }
  if (!bot) return

  if (connectOptions.server) {
    bot.loadPlugin(ping)
  }
  bot.loadPlugin(mouse)
  if (!localReplaySession) {
    bot.loadPlugin(localRelayServerPlugin)
  }

  const p2pConnectTimeout = p2pMultiplayer ? setTimeout(() => { throw new UserError('Spawn timeout. There might be error on the other side, check console.') }, 20_000) : undefined

  // bot.on('inject_allowed', () => {
  //   loadingScreen.maybeRecoverable = false
  // })

  bot.on('error', handleError)

  bot.on('kicked', (kickReason) => {
    console.log('You were kicked!', kickReason)
    const { formatted: kickReasonFormatted, plain: kickReasonString } = parseFormattedMessagePacket(kickReason)
    setLoadingScreenStatus(`The Minecraft server kicked you. Kick reason: ${kickReasonString}`, true, undefined, undefined, kickReasonFormatted)
    appStatusState.showReconnect = true

    // Report kick to parent app
    customEvents.emit('connectionStatus', {
      status: 'kicked',
      message: `Kicked: ${kickReasonString}`,
      errorDetails: kickReasonString,
      canReconnect: !!lastConnectOptions.value
    })

    destroyAll()
  })

  // bot.emit('kicked', '{"translate":"disconnect.genericReason","with":["Internal Exception: io.netty.handler.codec.EncoderException: com.viaversion.viaversion.exception.InformativeException: Please report this on the Via support Discord or open an issue on the relevant GitHub repository\\nPacket Type: SYSTEM_CHAT, Index: 1, Type: TagType, Data: [], Packet ID: 103, Source 0: com.viaversion.viabackwards.protocol.v1_20_3to1_20_2.Protocol1_20_3To1_20_2$$Lambda/0x00007f9930f63080"]}', false)

  const packetBeforePlay = (_, __, ___, fullBuffer) => {
    lastPacket = fullBuffer.toString()
  }
  bot._client.on('packet', packetBeforePlay as any)
  const playStateSwitch = (newState) => {
    if (newState === 'play') {
      bot._client.removeListener('packet', packetBeforePlay)
    }
  }
  bot._client.on('state', playStateSwitch)

  bot.on('end', (endReason) => {
    if (ended) return
    console.log('disconnected for', endReason)
    if (endReason === 'socketClosed') {
      endReason = 'Connection with server lost'
    }
    setLoadingScreenStatus(`You have been disconnected from the server. End reason: ${endReason}`, true)
    appStatusState.showReconnect = true
    onPossibleErrorDisconnect()

    // Report disconnection to parent app
    customEvents.emit('connectionStatus', {
      status: 'disconnected',
      message: `Disconnected: ${endReason}`,
      errorDetails: endReason,
      canReconnect: !!lastConnectOptions.value
    })

    destroyAll()
    if (isCypress()) throw new Error(`disconnected: ${endReason}`)
  })

  onBotCreate()

  bot.once('login', () => {
    setLoadingScreenStatus('Loading world')

    // Report successful connection to parent app
    customEvents.emit('connectionStatus', {
      status: 'connected',
      message: 'Connected to server',
      canReconnect: !!lastConnectOptions.value
    })
  })

  const loadStart = Date.now()
  let worldWasReady = false
  const waitForChunksToLoad = async (progress?: ProgressReporter) => {
    await new Promise<void>(resolve => {
      const unsub = subscribe(appViewer.rendererState, () => {
        if (worldWasReady) return
        if (appViewer.rendererState.world.allChunksLoaded) {
          worldWasReady = true
          resolve()
          unsub()
        } else {
          const perc = Math.round(appViewer.rendererState.world.chunksLoaded.length / appViewer.rendererState.world.chunksTotalNumber * 100)
          progress?.reportProgress('chunks', perc / 100)
        }
      })
    })
  }

  void waitForChunksToLoad().then(() => {
    console.log('All chunks done and ready! Time from renderer connect to ready', (Date.now() - loadStart) / 1000, 's')
    document.dispatchEvent(new Event('cypress-world-ready'))
  })

  const spawnEarlier = !singleplayer && !p2pMultiplayer
  // don't use spawn event, player can be dead
  bot.once(spawnEarlier ? 'forcedMove' : 'health', async () => {
    if (resourcePackState.isServerInstalling) {
      await new Promise<void>(resolve => {
        subscribe(resourcePackState, () => {
          if (!resourcePackState.isServerInstalling) {
            resolve()
          }
        })
      })
    }
    window.focus?.()
    errorAbortController.abort()

    if (p2pConnectTimeout) clearTimeout(p2pConnectTimeout)
    playerState.onlineMode = !!connectOptions.authenticatedAccount

    progress.setMessage('Placing blocks (starting viewer)')
    try {
      if (!connectOptions.worldStateFileContents || connectOptions.worldStateFileContents.length < 3 * 1024 * 1024) {
        localStorage.lastConnectOptions = JSON.stringify(connectOptions)
        if (process.env.NODE_ENV === 'development' && !localStorage.lockUrl && !Object.keys(window.debugQueryParams).length) {
          lockUrl()
        }
      } else {
        localStorage.removeItem('lastConnectOptions')
      }
    } catch (err) {
      console.warn('Failed to save lastConnectOptions (localStorage full):', err)
      // Continue anyway - this is not critical
    }
    connectOptions.onSuccessfulPlay?.()
    updateDataAfterJoin()
    if (connectOptions.autoLoginPassword) {
      bot.chat(`/login ${connectOptions.autoLoginPassword}`)
    }


    console.log('bot spawned - starting viewer')

    // Ensure bot.world exists and has columns for replay mode
    if (bot.world) {
      if (!(bot.world as any).columns) {
        (bot.world as any).columns = {}
      }

      // Patch World prototype methods to handle missing chunks gracefully (affects all code paths)
      const WorldProto = Object.getPrototypeOf(bot.world)
      const patchProtoMethod = (methodName: string, defaultValue: any) => {
        const original = WorldProto[methodName]
        if (typeof original !== 'function' || (WorldProto)[`_${methodName}_patched`]) return
        ;(WorldProto)[`_${methodName}_patched`] = true
        WorldProto[methodName] = function (...args: any[]) {
          try {
            if (!this.columns) return defaultValue
            return original.apply(this, args)
          } catch {
            return defaultValue
          }
        }
      }
      patchProtoMethod('getBlock', null)
      patchProtoMethod('getBlockType', 0)
      patchProtoMethod('getBlockData', 0)
      patchProtoMethod('getBlockLight', 0)
      patchProtoMethod('getSkyLight', 15)
      patchProtoMethod('getBiome', 0)
      patchProtoMethod('getBlockStateId', 0)
    }

    appViewer.startWorld(bot.world, renderDistance)
    appViewer.worldView!.listenToBot(bot)

    initMotionTracking()
    dayCycle()
    trackCameraMovement()

    progress.setMessage('Setting callbacks')

    onGameLoad(() => {})

    if (appStatusState.isError) return

    const waitForChunks = async () => {
      if (appQueryParams.sp === '1') return //todo
      const waitForChunks = options.waitForChunksRender === 'sp-only' ? !!singleplayer : options.waitForChunksRender
      if (!appViewer.backend || appViewer.rendererState.world.allChunksLoaded || !waitForChunks) {
        return
      }

      await progress.executeWithMessage(
        'Loading chunks',
        'chunks',
        async () => {
          await waitForChunksToLoad(progress)
        }
      )
    }

    await waitForChunks()

    setTimeout(() => {
      if (appQueryParams.suggest_save) {
        showNotification('Suggestion', 'Save the world to keep your progress!', false, undefined, async () => {
          const savePath = await saveToBrowserMemory()
          if (!savePath) return
          const saveName = savePath.split('/').pop()
          bot.end()
          // todo hot reload
          location.search = `loadSave=${saveName}`
        })
      }
    }, 600)

    miscUiState.gameLoaded = true
    miscUiState.loadedServerIndex = connectOptions.serverIndex ?? ''
    customEvents.emit('gameLoaded')
    progress.end()
    setLoadingScreenStatus(undefined)
  })

  if (singleplayer && connectOptions.serverOverrides.worldFolder) {
    fsState.saveLoaded = true
  }

  if (!connectOptions.ignoreQs || process.env.NODE_ENV === 'development') {
    // todo cleanup
    customEvents.on('gameLoaded', () => {
      const commands = appQueryParamsArray.command ?? []
      for (let command of commands) {
        if (!command.startsWith('/')) command = `/${command}`
        bot.chat(command)
      }
    })
  }
}

const reconnectOptions = sessionStorage.getItem('reconnectOptions') ? JSON.parse(sessionStorage.getItem('reconnectOptions')!) : undefined

listenGlobalEvents()
const unsubscribe = subscribe(miscUiState, async () => {
  if (miscUiState.fsReady && miscUiState.appConfig) {
    unsubscribe()
    if (reconnectOptions) {
      sessionStorage.removeItem('reconnectOptions')
      if (Date.now() - reconnectOptions.timestamp < 1000 * 60 * 2) {
        void connect(reconnectOptions.value)
      }
    } else {
      if (appQueryParams.singleplayer === '1' || appQueryParams.sp === '1') {
        loadSingleplayer({}, {
          worldFolder: undefined,
          ...appQueryParams.version ? { version: appQueryParams.version } : {}
        })
      }
      if (appQueryParams.loadSave) {
        const savePath = `/data/worlds/${appQueryParams.loadSave}`
        try {
          await fs.promises.stat(savePath)
        } catch (err) {
          alert(`Save ${savePath} not found`)
          return
        }
        await loadInMemorySave(savePath)
      }
    }
  }
})

// #region fire click event on touch as we disable default behaviors
let activeTouch: { touch: Touch, elem: HTMLElement, start: number } | undefined
document.body.addEventListener('touchend', (e) => {
  if (!isGameActive(true)) return
  if (activeTouch?.touch.identifier !== e.changedTouches[0].identifier) return
  if (Date.now() - activeTouch.start > 500) {
    activeTouch.elem.dispatchEvent(new Event('longtouch', { bubbles: true }))
  } else {
    activeTouch.elem.click()
  }
  activeTouch = undefined
})
document.body.addEventListener('touchstart', (e) => {
  const ignoreElem = (e.target as HTMLElement).matches('vercel-live-feedback') || (e.target as HTMLElement).closest('.hotbar')
  if (!isGameActive(true) || ignoreElem) return
  // we always prevent default behavior to disable magnifier on ios, but by doing so we also disable click events
  e.preventDefault()
  let firstClickable // todo remove composedPath and this workaround when lit-element is fully dropped
  const path = e.composedPath() as Array<{ click?: () => void }>
  for (const elem of path) {
    if (elem.click) {
      firstClickable = elem
      break
    }
  }
  if (!firstClickable) return
  activeTouch = {
    touch: e.touches[0],
    elem: firstClickable,
    start: Date.now(),
  }
}, { passive: false })
// #endregion

// qs open actions
if (!reconnectOptions) {
  downloadAndOpenFile().then((downloadAction) => {
    if (downloadAction) return
    if (appQueryParams.reconnect && process.env.NODE_ENV === 'development') {
      const lastConnect = JSON.parse(localStorage.lastConnectOptions ?? {})
      void connect({
        botVersion: appQueryParams.version ?? undefined,
        ...lastConnect,
        ip: appQueryParams.ip || undefined
      })
      return
    }
    if (appQueryParams.ip || appQueryParams.proxy) {
      const waitAppConfigLoad = !appQueryParams.proxy
      const openServerEditor = () => {
        hideModal()
        showModal({ reactType: 'editServer' })
      }
      showModal({ reactType: 'empty' })
      if (waitAppConfigLoad) {
        const unsubscribe = subscribe(miscUiState, checkCanDisplay)
        checkCanDisplay()
        // eslint-disable-next-line no-inner-declarations
        function checkCanDisplay () {
          if (miscUiState.appConfig) {
            unsubscribe()
            openServerEditor()
            return true
          }
        }
      } else {
        openServerEditor()
      }
    }

    void Promise.resolve().then(() => {
      // try to connect to peer
      const peerId = appQueryParams.connectPeer
      const peerOptions = {} as ConnectPeerOptions
      if (appQueryParams.server) {
        peerOptions.server = appQueryParams.server
      }
      const version = appQueryParams.peerVersion
      if (peerId) {
        let username: string | null = options.guestUsername
        if (options.askGuestName) username = prompt('Enter your username', username)
        if (!username) return
        options.guestUsername = username
        void connect({
          username,
          botVersion: version || undefined,
          peerId,
          peerOptions
        })
      }
    })

    if (appQueryParams.serversList) {
      showModal({ reactType: 'serversList' })
    }

    const viewerWsConnect = appQueryParams.viewerConnect
    if (viewerWsConnect) {
      void connect({
        username: `viewer-${Math.random().toString(36).slice(2, 10)}`,
        viewerWsConnect,
      })
    }

    if (appQueryParams.modal) {
      const modals = appQueryParams.modal.split(',')
      for (const modal of modals) {
        showModal({ reactType: modal })
      }
    }
  }, (err) => {
    console.error(err)
    alert(`Failed to download file: ${err}`)
  })
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const initialLoader = document.querySelector('.initial-loader') as HTMLElement | null
if (initialLoader) {
  initialLoader.style.opacity = '0'
  initialLoader.style.pointerEvents = 'none'
}
window.pageLoaded = true

void possiblyHandleStateVariable()
