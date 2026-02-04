/* eslint-disable guard-for-in */
import { EventEmitter } from 'events'
import { Vec3 } from 'vec3'
import * as THREE from 'three'
import mcDataRaw from 'minecraft-data/data.js' // note: using alias
import TypedEmitter from 'typed-emitter'
import { ItemsRenderer } from 'mc-assets/dist/itemsRenderer'
import { WorldBlockProvider } from 'mc-assets/dist/worldBlockProvider'
import { generateSpiralMatrix } from 'flying-squid/dist/utils'
import { dynamicMcDataFiles } from '../../buildMesherConfig.mjs'
import { toMajorVersion } from '../../../src/utils'
import { ResourcesManager } from '../../../src/resourcesManager'
import { DisplayWorldOptions, RendererReactiveState } from '../../../src/appViewer'
import { SoundSystem } from '../three/threeJsSound'
import { buildCleanupDecorator } from './cleanupDecorator'
import { HighestBlockInfo, MesherGeometryOutput, CustomBlockModels, BlockStateModelInfo, getBlockAssetsCacheKey, MesherConfig } from './mesher/shared'
import { chunkPos } from './simpleUtils'
import { removeStat, updateStatText } from './ui/newStats'
import { WorldDataEmitter } from './worldDataEmitter'
import { IPlayerState } from './basePlayerState'

function mod (x, n) {
  return ((x % n) + n) % n
}

export const worldCleanup = buildCleanupDecorator('resetWorld')

export const defaultWorldRendererConfig = {
  showChunkBorders: false,
  mesherWorkers: 4,
  isPlayground: false,
  renderEars: true,
  // game renderer setting actually
  showHand: false,
  viewBobbing: false,
  extraBlockRenderers: true,
  clipWorldBelowY: undefined as number | undefined,
  smoothLighting: true,
  enableLighting: true,
  starfield: true,
  addChunksBatchWaitTime: 200,
  vrSupport: true,
  renderEntities: true,
  fov: 75,
  fetchPlayerSkins: true,
  highlightBlockColor: 'blue',
  foreground: true,
  _experimentalSmoothChunkLoading: true,
  _renderByChunks: false
}

export type WorldRendererConfig = typeof defaultWorldRendererConfig

export abstract class WorldRendererCommon<WorkerSend = any, WorkerReceive = any> {
  displayStats = false
  worldSizeParams = { minY: 0, worldHeight: 256 }

  active = false

  // #region CHUNK & SECTIONS TRACKING
  @worldCleanup()
  loadedChunks = {} as Record<string, boolean> // data is added for these chunks and they might be still processing

  @worldCleanup()
  finishedChunks = {} as Record<string, boolean> // these chunks are fully loaded into the world (scene)

  @worldCleanup()
  finishedSections = {} as Record<string, boolean> // these sections are fully loaded into the world (scene)

  @worldCleanup()
  // loading sections (chunks)
  sectionsWaiting = new Map<string, number>()

  @worldCleanup()
  queuedChunks = new Set<string>()
  queuedFunctions = [] as Array<() => void>
  // #endregion

  renderUpdateEmitter = new EventEmitter() as unknown as TypedEmitter<{
    dirty (pos: Vec3, value: boolean): void
    update (/* pos: Vec3, value: boolean */): void
    chunkFinished (key: string): void
  }>
  customTexturesDataUrl = undefined as string | undefined
  workers: any[] = []
  viewerPosition?: Vec3
  lastCamUpdate = 0
  droppedFpsPercentage = 0
  initialChunkLoadWasStartedIn: number | undefined
  initialChunksLoad = true
  enableChunksLoadDelay = false
  texturesVersion?: string
  viewDistance = -1
  chunksLength = 0
  allChunksFinished = false
  messageQueue: any[] = []
  isProcessingQueue = false
  ONMESSAGE_TIME_LIMIT = 30 // ms

  handleResize = () => { }
  camera: THREE.PerspectiveCamera
  highestBlocksByChunks = {} as Record<string, { [chunkKey: string]: HighestBlockInfo }>
  highestBlocksBySections = {} as Record<string, { [sectionKey: string]: HighestBlockInfo }>
  blockEntities = {}

  workersProcessAverageTime = 0
  workersProcessAverageTimeCount = 0
  maxWorkersProcessTime = 0
  geometryReceiveCount = {}
  allLoadedIn: undefined | number

  edgeChunks = {} as Record<string, boolean>
  lastAddChunk = null as null | {
    timeout: any
    x: number
    z: number
  }
  neighborChunkUpdates = true
  lastChunkDistance = 0
  debugStopGeometryUpdate = false

  @worldCleanup()
  itemsRenderer: ItemsRenderer | undefined

  protocolCustomBlocks = new Map<string, CustomBlockModels>()

  @worldCleanup()
  blockStateModelInfo = new Map<string, BlockStateModelInfo>()

  abstract outputFormat: 'threeJs' | 'webgpu'
  worldBlockProvider: WorldBlockProvider
  soundSystem: SoundSystem | undefined

  abstract changeBackgroundColor (color: [number, number, number]): void

  worldRendererConfig: WorldRendererConfig
  playerState: IPlayerState
  reactiveState: RendererReactiveState

  abortController = new AbortController()
  lastRendered = 0
  renderingActive = true

  constructor (public readonly resourcesManager: ResourcesManager, public displayOptions: DisplayWorldOptions, public version: string) {
    // this.initWorkers(1) // preload script on page load
    this.snapshotInitialValues()
    this.worldRendererConfig = displayOptions.inWorldRenderingConfig
    this.playerState = displayOptions.playerState
    this.reactiveState = displayOptions.rendererState

    this.renderUpdateEmitter.on('update', () => {
      const loadedChunks = Object.keys(this.finishedChunks).length
      updateStatText('loaded-chunks', `${loadedChunks}/${this.chunksLength} chunks (${this.lastChunkDistance}/${this.viewDistance})`)
    })

    this.connect(this.displayOptions.worldView)
  }

  init () {
    if (this.active) throw new Error('WorldRendererCommon is already initialized')
    void this.setVersion(this.version).then(() => {
      this.resourcesManager.on('assetsTexturesUpdated', () => {
        if (!this.active) return
        void this.updateAssetsData()
      })
      if (this.resourcesManager.currentResources) {
        void this.updateAssetsData()
      }
    })
  }

  snapshotInitialValues () { }

  wasChunkSentToWorker (chunkKey: string) {
    return this.loadedChunks[chunkKey]
  }

  async getHighestBlocks (chunkKey: string) {
    return this.highestBlocksByChunks[chunkKey]
  }

  updateCustomBlock (chunkKey: string, blockPos: string, model: string) {
    this.protocolCustomBlocks.set(chunkKey, {
      ...this.protocolCustomBlocks.get(chunkKey),
      [blockPos]: model
    })
    if (this.wasChunkSentToWorker(chunkKey)) {
      const [x, y, z] = blockPos.split(',').map(Number)
      this.setBlockStateId(new Vec3(x, y, z), undefined)
    }
  }

  async getBlockInfo (blockPos: { x: number, y: number, z: number }, stateId: number) {
    const chunkKey = `${Math.floor(blockPos.x / 16) * 16},${Math.floor(blockPos.z / 16) * 16}`
    const customBlockName = this.protocolCustomBlocks.get(chunkKey)?.[`${blockPos.x},${blockPos.y},${blockPos.z}`]
    const cacheKey = getBlockAssetsCacheKey(stateId, customBlockName)
    const modelInfo = this.blockStateModelInfo.get(cacheKey)
    return {
      customBlockName,
      modelInfo
    }
  }

  initWorkers (numWorkers = this.worldRendererConfig.mesherWorkers) {
    // init workers
    for (let i = 0; i < numWorkers + 1; i++) {
      // Node environment needs an absolute path, but browser needs the url of the file
      const workerName = 'mesher.js'
      // eslint-disable-next-line node/no-path-concat
      const src = typeof window === 'undefined' ? `${__dirname}/${workerName}` : workerName

      let worker: any
      if (process.env.SINGLE_FILE_BUILD) {
        const workerCode = document.getElementById('mesher-worker-code')!.textContent!
        const blob = new Blob([workerCode], { type: 'text/javascript' })
        worker = new Worker(window.URL.createObjectURL(blob))
      } else {
        worker = new Worker(src)
      }

      worker.onmessage = ({ data }) => {
        if (Array.isArray(data)) {
          this.messageQueue.push(...data)
        } else {
          this.messageQueue.push(data)
        }
        void this.processMessageQueue()
      }
      if (worker.on) worker.on('message', (data) => { worker.onmessage({ data }) })
      this.workers.push(worker)
    }
  }

  async processMessageQueue () {
    if (this.isProcessingQueue || this.messageQueue.length === 0) return
    if (this.lastRendered && performance.now() - this.lastRendered > 30 && this.worldRendererConfig._experimentalSmoothChunkLoading && this.renderingActive) {
      await new Promise(resolve => {
        requestAnimationFrame(resolve)
      })
    }
    this.isProcessingQueue = true

    const startTime = performance.now()
    let processedCount = 0

    while (this.messageQueue.length > 0) {
      const data = this.messageQueue.shift()!
      this.handleMessage(data)
      processedCount++

      // Check if we've exceeded the time limit
      if (performance.now() - startTime > this.ONMESSAGE_TIME_LIMIT && this.renderingActive) {
        // If we have more messages and exceeded time limit, schedule next batch
        if (this.messageQueue.length > 0) {
          requestAnimationFrame(async () => {
            this.isProcessingQueue = false
            void this.processMessageQueue()
          })
          return
        }
        break
      }
    }

    this.isProcessingQueue = false
  }

  handleMessage (data) {
    if (!this.active) return
    if (data.type !== 'geometry' || !this.debugStopGeometryUpdate) {
      this.handleWorkerMessage(data)
    }
    if (data.type === 'geometry') {
      this.geometryReceiveCount[data.workerIndex] ??= 0
      this.geometryReceiveCount[data.workerIndex]++
      const geometry = data.geometry as MesherGeometryOutput
      this.highestBlocksBySections[data.key] = geometry.highestBlocks
      const chunkCoords = data.key.split(',').map(Number)
      this.lastChunkDistance = Math.max(...this.getDistance(new Vec3(chunkCoords[0], 0, chunkCoords[2])))
    }
    if (data.type === 'sectionFinished') { // on after load & unload section
      if (!this.sectionsWaiting.has(data.key)) throw new Error(`sectionFinished event for non-outstanding section ${data.key}`)
      this.sectionsWaiting.set(data.key, this.sectionsWaiting.get(data.key)! - 1)
      if (this.sectionsWaiting.get(data.key) === 0) {
        this.sectionsWaiting.delete(data.key)
        this.finishedSections[data.key] = true
      }

      const chunkCoords = data.key.split(',').map(Number)
      const chunkKey = `${chunkCoords[0]},${chunkCoords[2]}`
      if (this.loadedChunks[chunkKey]) { // ensure chunk data was added, not a neighbor chunk update
        let loaded = true
        for (let y = this.worldMinYRender; y < this.worldSizeParams.worldHeight; y += 16) {
          if (!this.finishedSections[`${chunkCoords[0]},${y},${chunkCoords[2]}`]) {
            loaded = false
            break
          }
        }
        if (loaded) {
          // CHUNK FINISHED
          this.finishedChunks[chunkKey] = true
          this.renderUpdateEmitter.emit(`chunkFinished`, `${chunkCoords[0]},${chunkCoords[2]}`)
          this.checkAllFinished()
          // merge highest blocks by sections into highest blocks by chunks
          // for (let y = this.worldMinYRender; y < this.worldSizeParams.worldHeight; y += 16) {
          //   const sectionKey = `${chunkCoords[0]},${y},${chunkCoords[2]}`
          //   for (let x = 0; x < 16; x++) {
          //     for (let z = 0; z < 16; z++) {
          //       const posInsideKey = `${chunkCoords[0] + x},${chunkCoords[2] + z}`
          //       let block = null as HighestBlockInfo | null
          //       const highestBlock = this.highestBlocksBySections[sectionKey]?.[posInsideKey]
          //       if (!highestBlock) continue
          //       if (!block || highestBlock.y > block.y) {
          //         block = highestBlock
          //       }
          //       if (block) {
          //         this.highestBlocksByChunks[chunkKey] ??= {}
          //         this.highestBlocksByChunks[chunkKey][posInsideKey] = block
          //       }
          //     }
          //   }
          //   delete this.highestBlocksBySections[sectionKey]
          // }
        }
      }

      this.renderUpdateEmitter.emit('update')
      if (data.processTime) {
        this.workersProcessAverageTimeCount++
        this.workersProcessAverageTime = ((this.workersProcessAverageTime * (this.workersProcessAverageTimeCount - 1)) + data.processTime) / this.workersProcessAverageTimeCount
        this.maxWorkersProcessTime = Math.max(this.maxWorkersProcessTime, data.processTime)
      }
    }

    if (data.type === 'blockStateModelInfo') {
      for (const [cacheKey, info] of Object.entries(data.info)) {
        this.blockStateModelInfo.set(cacheKey, info)
      }
    }
  }

  checkAllFinished () {
    if (this.sectionsWaiting.size === 0) {
      this.reactiveState.world.mesherWork = false
    }
    // todo check exact surrounding chunks
    const allFinished = Object.keys(this.finishedChunks).length >= this.chunksLength
    if (allFinished) {
      this.allChunksLoaded?.()
      this.allChunksFinished = true
      this.allLoadedIn ??= Date.now() - this.initialChunkLoadWasStartedIn!
    }
    this.updateChunksStats()
  }

  changeHandSwingingState (isAnimationPlaying: boolean, isLeftHand: boolean): void { }

  abstract handleWorkerMessage (data: WorkerReceive): void

  abstract updateCamera (pos: Vec3 | null, yaw: number, pitch: number): void

  abstract render (): void

  /**
   * Optionally update data that are depedendent on the viewer position
   */
  updatePosDataChunk? (key: string): void

  allChunksLoaded? (): void

  timeUpdated? (newTime: number): void

  updateViewerPosition (pos: Vec3) {
    this.viewerPosition = pos
    for (const [key, value] of Object.entries(this.loadedChunks)) {
      if (!value) continue
      this.updatePosDataChunk?.(key)
    }
  }

  sendWorkers (message: WorkerSend) {
    for (const worker of this.workers) {
      worker.postMessage(message)
    }
  }

  getDistance (posAbsolute: Vec3) {
    const [botX, botZ] = chunkPos(this.viewerPosition!)
    const dx = Math.abs(botX - Math.floor(posAbsolute.x / 16))
    const dz = Math.abs(botZ - Math.floor(posAbsolute.z / 16))
    return [dx, dz] as [number, number]
  }

  abstract updateShowChunksBorder (value: boolean): void

  resetWorld () {
    // destroy workers
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers = []
  }

  // new game load happens here
  async setVersion (version: string) {
    this.version = version
    this.resetWorld()

    // for workers in single file build
    if (document?.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve)
      })
    }

    this.initWorkers()
    this.active = true

    await this.resourcesManager.loadMcData(version)
    this.sendMesherMcData()
    if (!this.resourcesManager.currentResources) {
      await this.resourcesManager.updateAssetsData({ })
    }
  }

  getMesherConfig (): MesherConfig {
    return {
      version: this.version,
      enableLighting: this.worldRendererConfig.enableLighting,
      skyLight: 15,
      smoothLighting: this.worldRendererConfig.smoothLighting,
      aoIntensity: 1.5, // Enhanced AO shadows
      minLight: 1, // Darker caves
      outputFormat: this.outputFormat,
      textureSize: this.resourcesManager.currentResources!.blocksAtlasParser.atlas.latest.width,
      debugModelVariant: undefined,
      clipWorldBelowY: this.worldRendererConfig.clipWorldBelowY,
      disableSignsMapsSupport: !this.worldRendererConfig.extraBlockRenderers
    }
  }

  sendMesherMcData () {
    const allMcData = mcDataRaw.pc[this.version] ?? mcDataRaw.pc[toMajorVersion(this.version)]
    const mcData = {
      version: JSON.parse(JSON.stringify(allMcData.version))
    }
    for (const key of dynamicMcDataFiles) {
      mcData[key] = allMcData[key]
    }

    for (const worker of this.workers) {
      worker.postMessage({ type: 'mcData', mcData, config: this.getMesherConfig() })
    }
  }

  async updateAssetsData () {
    const resources = this.resourcesManager.currentResources!

    if (this.workers.length === 0) throw new Error('workers not initialized yet')
    for (const [i, worker] of this.workers.entries()) {
      const { blockstatesModels } = resources

      worker.postMessage({
        type: 'mesherData',
        workerIndex: i,
        blocksAtlas: {
          latest: resources.blocksAtlasParser.atlas.latest
        },
        blockstatesModels,
        config: this.getMesherConfig(),
      })
    }

    console.log('textures loaded')
  }

  get worldMinYRender () {
    return Math.floor(Math.max(this.worldSizeParams.minY, this.worldRendererConfig.clipWorldBelowY ?? -Infinity) / 16) * 16
  }

  updateChunksStats () {
    const loadedChunks = Object.keys(this.finishedChunks)
    this.displayOptions.nonReactiveState.world.chunksLoaded = loadedChunks
    this.displayOptions.nonReactiveState.world.chunksTotalNumber = this.chunksLength
    this.reactiveState.world.allChunksLoaded = this.allChunksFinished

    updateStatText('downloaded-chunks', `${Object.keys(this.loadedChunks).length}/${this.chunksLength} chunks D (${this.workers.length}:${this.workersProcessAverageTime.toFixed(0)}ms/${this.allLoadedIn?.toFixed(1) ?? '-'}s)`)
  }

  addColumn (x: number, z: number, chunk: any, isLightUpdate: boolean) {
    if (!this.active) return
    if (this.workers.length === 0) throw new Error('workers not initialized yet')
    this.initialChunksLoad = false
    this.initialChunkLoadWasStartedIn ??= Date.now()
    this.loadedChunks[`${x},${z}`] = true
    this.updateChunksStats()

    const chunkKey = `${x},${z}`
    const customBlockModels = this.protocolCustomBlocks.get(chunkKey)

    for (const worker of this.workers) {
      worker.postMessage({
        type: 'chunk',
        x,
        z,
        chunk,
        customBlockModels: customBlockModels || undefined
      })
    }
    for (let y = this.worldMinYRender; y < this.worldSizeParams.worldHeight; y += 16) {
      const loc = new Vec3(x, y, z)
      this.setSectionDirty(loc)
      if (this.neighborChunkUpdates && (!isLightUpdate || this.worldRendererConfig.smoothLighting)) {
        this.setSectionDirty(loc.offset(-16, 0, 0))
        this.setSectionDirty(loc.offset(16, 0, 0))
        this.setSectionDirty(loc.offset(0, 0, -16))
        this.setSectionDirty(loc.offset(0, 0, 16))
      }
    }
  }

  markAsLoaded (x, z) {
    this.loadedChunks[`${x},${z}`] = true
    this.finishedChunks[`${x},${z}`] = true
    this.checkAllFinished()
  }

  removeColumn (x, z) {
    delete this.loadedChunks[`${x},${z}`]
    for (const worker of this.workers) {
      worker.postMessage({ type: 'unloadChunk', x, z })
    }
    delete this.finishedChunks[`${x},${z}`]
    this.allChunksFinished = Object.keys(this.finishedChunks).length === this.chunksLength
    if (!this.allChunksFinished) {
      this.allLoadedIn = undefined
      this.initialChunkLoadWasStartedIn = undefined
    }
    for (let y = this.worldSizeParams.minY; y < this.worldSizeParams.worldHeight; y += 16) {
      this.setSectionDirty(new Vec3(x, y, z), false)
      delete this.finishedSections[`${x},${y},${z}`]
      delete this.highestBlocksBySections[`${x},${y},${z}`]
    }
    delete this.highestBlocksByChunks[`${x},${z}`]

    this.updateChunksStats()
  }

  setBlockStateId (pos: Vec3, stateId: number | undefined) {
    const set = async () => {
      const sectionX = Math.floor(pos.x / 16) * 16
      const sectionZ = Math.floor(pos.z / 16) * 16
      if (this.queuedChunks.has(`${sectionX},${sectionZ}`)) {
        await new Promise<void>(resolve => {
          this.queuedFunctions.push(() => {
            resolve()
          })
        })
      }
      if (!this.loadedChunks[`${sectionX},${sectionZ}`]) {
        // console.debug('[should be unreachable] setBlockStateId called for unloaded chunk', pos)
      }
      this.setBlockStateIdInner(pos, stateId)
    }
    void set()
  }

  updateEntity (e: any, isUpdate = false) { }

  lightUpdate (chunkX: number, chunkZ: number) { }

  connect (worldView: WorldDataEmitter) {
    const worldEmitter = worldView

    worldEmitter.on('entity', (e) => {
      this.updateEntity(e, false)
    })
    worldEmitter.on('entityMoved', (e) => {
      this.updateEntity(e, true)
    })

    let currentLoadChunkBatch = null as {
      timeout
      data
    } | null
    worldEmitter.on('loadChunk', ({ x, z, chunk, worldConfig, isLightUpdate }) => {
      this.worldSizeParams = worldConfig
      this.queuedChunks.add(`${x},${z}`)
      const args = [x, z, chunk, isLightUpdate]
      if (!currentLoadChunkBatch) {
        // add a setting to use debounce instead
        currentLoadChunkBatch = {
          data: [],
          timeout: setTimeout(() => {
            for (const args of currentLoadChunkBatch!.data) {
              this.queuedChunks.delete(`${args[0]},${args[1]}`)
              this.addColumn(...args as Parameters<typeof this.addColumn>)
            }
            for (const fn of this.queuedFunctions) {
              fn()
            }
            this.queuedFunctions = []
            currentLoadChunkBatch = null
          }, this.worldRendererConfig.addChunksBatchWaitTime)
        }
      }
      currentLoadChunkBatch.data.push(args)
    })
    // todo remove and use other architecture instead so data flow is clear
    worldEmitter.on('blockEntities', (blockEntities) => {
      this.blockEntities = blockEntities
    })

    worldEmitter.on('unloadChunk', ({ x, z }) => {
      this.removeColumn(x, z)
    })

    worldEmitter.on('blockUpdate', ({ pos, stateId }) => {
      this.setBlockStateId(new Vec3(pos.x, pos.y, pos.z), stateId)
    })

    worldEmitter.on('chunkPosUpdate', ({ pos }) => {
      this.updateViewerPosition(pos)
    })


    worldEmitter.on('renderDistance', (d) => {
      this.viewDistance = d
      this.chunksLength = d === 0 ? 1 : generateSpiralMatrix(d).length
    })

    worldEmitter.on('renderDistance', (d) => {
      this.viewDistance = d
      this.chunksLength = d === 0 ? 1 : generateSpiralMatrix(d).length
      this.allChunksFinished = Object.keys(this.finishedChunks).length === this.chunksLength
    })

    worldEmitter.on('markAsLoaded', ({ x, z }) => {
      this.markAsLoaded(x, z)
    })

    worldEmitter.on('updateLight', ({ pos }) => {
      this.lightUpdate(pos.x, pos.z)
    })

    worldEmitter.on('time', (timeOfDay) => {
      this.timeUpdated?.(timeOfDay)

      let skyLight = 15
      if (timeOfDay < 0 || timeOfDay > 24_000) {
        throw new Error('Invalid time of day. It should be between 0 and 24000.')
      } else if (timeOfDay <= 6000 || timeOfDay >= 18_000) {
        skyLight = 15
      } else if (timeOfDay > 6000 && timeOfDay < 12_000) {
        skyLight = 15 - ((timeOfDay - 6000) / 6000) * 15
      } else if (timeOfDay >= 12_000 && timeOfDay < 18_000) {
        skyLight = ((timeOfDay - 12_000) / 6000) * 15
      }

      skyLight = Math.floor(skyLight) // todo: remove this after optimization

      // if (this.worldRendererConfig.skyLight === skyLight) return
      // this.worldRendererConfig.skyLight = skyLight
      // if (this instanceof WorldRendererThree) {
      //   (this).rerenderAllChunks?.()
      // }
    })

    worldEmitter.emit('listening')
  }

  setBlockStateIdInner (pos: Vec3, stateId: number | undefined) {
    const needAoRecalculation = true
    const chunkKey = `${Math.floor(pos.x / 16) * 16},${Math.floor(pos.z / 16) * 16}`
    const blockPosKey = `${pos.x},${pos.y},${pos.z}`
    const customBlockModels = this.protocolCustomBlocks.get(chunkKey) || {}

    for (const worker of this.workers) {
      worker.postMessage({
        type: 'blockUpdate',
        pos,
        stateId,
        customBlockModels
      })
    }
    this.setSectionDirty(pos, true, true)
    if (this.neighborChunkUpdates) {
      if ((pos.x & 15) === 0) this.setSectionDirty(pos.offset(-16, 0, 0), true, true)
      if ((pos.x & 15) === 15) this.setSectionDirty(pos.offset(16, 0, 0), true, true)
      if ((pos.y & 15) === 0) this.setSectionDirty(pos.offset(0, -16, 0), true, true)
      if ((pos.y & 15) === 15) this.setSectionDirty(pos.offset(0, 16, 0), true, true)
      if ((pos.z & 15) === 0) this.setSectionDirty(pos.offset(0, 0, -16), true, true)
      if ((pos.z & 15) === 15) this.setSectionDirty(pos.offset(0, 0, 16), true, true)

      if (needAoRecalculation) {
        // top view neighbors
        if ((pos.x & 15) === 0 && (pos.z & 15) === 0) this.setSectionDirty(pos.offset(-16, 0, -16), true, true)
        if ((pos.x & 15) === 15 && (pos.z & 15) === 0) this.setSectionDirty(pos.offset(16, 0, -16), true, true)
        if ((pos.x & 15) === 0 && (pos.z & 15) === 15) this.setSectionDirty(pos.offset(-16, 0, 16), true, true)
        if ((pos.x & 15) === 15 && (pos.z & 15) === 15) this.setSectionDirty(pos.offset(16, 0, 16), true, true)

        // side view neighbors (but ignore updates above)
        // z view neighbors
        if ((pos.x & 15) === 0 && (pos.y & 15) === 0) this.setSectionDirty(pos.offset(-16, -16, 0), true, true)
        if ((pos.x & 15) === 15 && (pos.y & 15) === 0) this.setSectionDirty(pos.offset(16, -16, 0), true, true)

        // x view neighbors
        if ((pos.z & 15) === 0 && (pos.y & 15) === 0) this.setSectionDirty(pos.offset(0, -16, -16), true, true)
        if ((pos.z & 15) === 15 && (pos.y & 15) === 0) this.setSectionDirty(pos.offset(0, -16, 16), true, true)

        // x & z neighbors
        if ((pos.y & 15) === 0 && (pos.x & 15) === 0 && (pos.z & 15) === 0) this.setSectionDirty(pos.offset(-16, -16, -16), true, true)
        if ((pos.y & 15) === 0 && (pos.x & 15) === 15 && (pos.z & 15) === 0) this.setSectionDirty(pos.offset(16, -16, -16), true, true)
        if ((pos.y & 15) === 0 && (pos.x & 15) === 0 && (pos.z & 15) === 15) this.setSectionDirty(pos.offset(-16, -16, 16), true, true)
        if ((pos.y & 15) === 0 && (pos.x & 15) === 15 && (pos.z & 15) === 15) this.setSectionDirty(pos.offset(16, -16, 16), true, true)
      }
    }
  }

  queueAwaited = false
  messagesQueue = {} as { [workerIndex: string]: any[] }

  getWorkerNumber (pos: Vec3, updateAction = false) {
    if (updateAction) {
      const key = `${Math.floor(pos.x / 16) * 16},${Math.floor(pos.y / 16) * 16},${Math.floor(pos.z / 16) * 16}`
      const cantUseChangeWorker = this.sectionsWaiting.get(key) && !this.finishedSections[key]
      if (!cantUseChangeWorker) return 0
    }

    const hash = mod(Math.floor(pos.x / 16) + Math.floor(pos.y / 16) + Math.floor(pos.z / 16), this.workers.length - 1)
    return hash + 1
  }

  setSectionDirty (pos: Vec3, value = true, useChangeWorker = false) { // value false is used for unloading chunks
    if (this.viewDistance === -1) throw new Error('viewDistance not set')
    this.reactiveState.world.mesherWork = true
    const distance = this.getDistance(pos)
    if (!this.workers.length || distance[0] > this.viewDistance || distance[1] > this.viewDistance) return
    const key = `${Math.floor(pos.x / 16) * 16},${Math.floor(pos.y / 16) * 16},${Math.floor(pos.z / 16) * 16}`
    // if (this.sectionsOutstanding.has(key)) return
    this.renderUpdateEmitter.emit('dirty', pos, value)
    // Dispatch sections to workers based on position
    // This guarantees uniformity accross workers and that a given section
    // is always dispatched to the same worker
    const hash = this.getWorkerNumber(pos, useChangeWorker)
    this.sectionsWaiting.set(key, (this.sectionsWaiting.get(key) ?? 0) + 1)
    this.messagesQueue[hash] ??= []
    this.messagesQueue[hash].push({
      // this.workers[hash].postMessage({
      type: 'dirty',
      x: pos.x,
      y: pos.y,
      z: pos.z,
      value,
      config: this.getMesherConfig(),
    })
    this.dispatchMessages()
  }

  dispatchMessages () {
    if (this.queueAwaited) return
    this.queueAwaited = true
    setTimeout(() => {
      // group messages and send as one
      for (const workerIndex in this.messagesQueue) {
        const worker = this.workers[Number(workerIndex)]
        worker.postMessage(this.messagesQueue[workerIndex])
      }
      this.messagesQueue = {}
      this.queueAwaited = false
    })
  }

  // Listen for chunk rendering updates emitted if a worker finished a render and resolve if the number
  // of sections not rendered are 0
  async waitForChunksToRender () {
    return new Promise<void>((resolve, reject) => {
      if ([...this.sectionsWaiting].length === 0) {
        resolve()
        return
      }

      const updateHandler = () => {
        if (this.sectionsWaiting.size === 0) {
          this.renderUpdateEmitter.removeListener('update', updateHandler)
          resolve()
        }
      }
      this.renderUpdateEmitter.on('update', updateHandler)
    })
  }

  async waitForChunkToLoad (pos: Vec3) {
    return new Promise<void>((resolve, reject) => {
      const key = `${Math.floor(pos.x / 16) * 16},${Math.floor(pos.z / 16) * 16}`
      if (this.loadedChunks[key]) {
        resolve()
        return
      }
      const updateHandler = () => {
        if (this.loadedChunks[key]) {
          this.renderUpdateEmitter.removeListener('update', updateHandler)
          resolve()
        }
      }
      this.renderUpdateEmitter.on('update', updateHandler)
    })
  }

  destroy () {
    // Stop all workers
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers = []

    // Stop and destroy sound system
    if (this.soundSystem) {
      this.soundSystem.destroy()
      this.soundSystem = undefined
    }

    this.active = false

    this.renderUpdateEmitter.removeAllListeners()
    this.displayOptions.worldView.removeAllListeners() // todo
    this.abortController.abort()
    removeStat('chunks-loaded')
    removeStat('chunks-read')
  }
}
