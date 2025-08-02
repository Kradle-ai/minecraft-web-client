import * as THREE from 'three'
import { Vec3 } from 'vec3'
import nbt from 'prismarine-nbt'
import PrismarineChatLoader from 'prismarine-chat'
import * as tweenJs from '@tweenjs/tween.js'
import { subscribeKey } from 'valtio/utils'
import { renderSign } from '../sign-renderer'
import { DisplayWorldOptions, GraphicsInitOptions, RendererReactiveState } from '../../../src/appViewer'
import { chunkPos, sectionPos } from '../lib/simpleUtils'
import { WorldRendererCommon } from '../lib/worldrendererCommon'
import { addNewStat, removeAllStats } from '../lib/ui/newStats'
import { MesherGeometryOutput } from '../lib/mesher/shared'
import { ItemSpecificContextProperties } from '../lib/basePlayerState'
import { getMyHand } from '../lib/hand'
import { setBlockPosition } from '../lib/mesher/standaloneRenderer'
import HoldingBlock from './holdingBlock'
import { getMesh } from './entity/EntityMesh'
import { armorModel } from './entity/armorModels'
import { disposeObject } from './threeJsUtils'
import { CursorBlock } from './world/cursorBlock'
import { getItemUv } from './appShared'
import { initVR } from './world/vr'
import { Entities } from './entities'
import { ThreeJsSound } from './threeJsSound'
import { CameraShake } from './cameraShake'

interface MediaProperties {
  position: { x: number, y: number, z: number }
  size: { width: number, height: number }
  src: string
  rotation?: 0 | 1 | 2 | 3 // 0-3 for 0°, 90°, 180°, 270°
  doubleSide?: boolean
  background?: number // Hexadecimal color (e.g., 0x000000 for black)
  opacity?: number // 0-1 value for transparency
  uvMapping?: { startU: number, endU: number, startV: number, endV: number }
  allowOrigins?: string[] | boolean
  loop?: boolean
  volume?: number
}

type SectionKey = string

export class WorldRendererThree extends WorldRendererCommon {
  outputFormat = 'threeJs' as const
  sectionObjects: Record<string, THREE.Object3D> = {}
  chunkTextures = new Map<string, { [pos: string]: THREE.Texture }>()
  signsCache = new Map<string, any>()
  starField: StarField
  cameraSectionPos: Vec3 = new Vec3(0, 0, 0)
  holdingBlock: HoldingBlock
  holdingBlockLeft: HoldingBlock
  scene = new THREE.Scene()
  ambientLight = new THREE.AmbientLight(0xcc_cc_cc)
  directionalLight = new THREE.DirectionalLight(0xff_ff_ff, 0.5)
  entities = new Entities(this)
  cameraObjectOverride?: THREE.Object3D // for xr
  material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, alphaTest: 0.1 })
  itemsTexture: THREE.Texture
  cursorBlock = new CursorBlock(this)
  onRender: Array<() => void> = []
  customMedia = new Map<string, {
    mesh: THREE.Object3D
    video: HTMLVideoElement | undefined
    texture: THREE.Texture
    updateUVMapping: (config: { startU: number, endU: number, startV: number, endV: number }) => void
  }>()
  cameraShake: CameraShake
  waitingChunksToDisplay = {} as { [chunkKey: string]: SectionKey[] }

  get tilesRendered () {
    return Object.values(this.sectionObjects).reduce((acc, obj) => acc + (obj as any).tilesCount, 0)
  }

  get blocksRendered () {
    return Object.values(this.sectionObjects).reduce((acc, obj) => acc + (obj as any).blocksCount, 0)
  }

  constructor (public renderer: THREE.WebGLRenderer, public initOptions: GraphicsInitOptions, public displayOptions: DisplayWorldOptions) {
    if (!initOptions.resourcesManager) throw new Error('resourcesManager is required')
    super(initOptions.resourcesManager, displayOptions, displayOptions.version)

    displayOptions.rendererState.renderer = WorldRendererThree.getRendererInfo(renderer) ?? '...'
    this.starField = new StarField(this.scene)
    this.holdingBlock = new HoldingBlock(this)
    this.holdingBlockLeft = new HoldingBlock(this, true)

    this.addDebugOverlay()
    this.resetScene()
    this.watchReactivePlayerState()
    this.init()
    void initVR(this)

    this.soundSystem = new ThreeJsSound(this)
    this.cameraShake = new CameraShake(this.camera, this.onRender)

    this.renderUpdateEmitter.on('chunkFinished', (chunkKey: string) => {
      this.finishChunk(chunkKey)
    })
  }

  updateEntity (e, isPosUpdate = false) {
    const overrides = {
      rotation: {
        head: {
          x: e.headPitch ?? e.pitch,
          y: e.headYaw,
          z: 0
        }
      }
    }
    if (isPosUpdate) {
      this.entities.updateEntityPosition(e, false, overrides)
    } else {
      this.entities.update(e, overrides)
    }
  }

  resetScene () {
    this.scene.matrixAutoUpdate = false // for perf
    this.scene.background = new THREE.Color(this.initOptions.config.sceneBackground)
    this.scene.add(this.ambientLight)
    this.directionalLight.position.set(1, 1, 0.5).normalize()
    this.directionalLight.castShadow = true
    this.scene.add(this.directionalLight)

    const size = this.renderer.getSize(new THREE.Vector2())
    this.camera = new THREE.PerspectiveCamera(75, size.x / size.y, 0.1, 1000)
  }

  watchReactivePlayerState () {
    const updateValue = <T extends keyof typeof this.displayOptions.playerState.reactive>(key: T, callback: (value: typeof this.displayOptions.playerState.reactive[T]) => void) => {
      callback(this.displayOptions.playerState.reactive[key])
      subscribeKey(this.displayOptions.playerState.reactive, key, callback)
    }
    updateValue('backgroundColor', (value) => {
      this.changeBackgroundColor(value)
    })
    updateValue('inWater', (value) => {
      this.scene.fog = value ? new THREE.Fog(0x00_00_ff, 0.1, 100) : null
    })
    updateValue('ambientLight', (value) => {
      if (!value) return
      this.ambientLight.intensity = value
    })
    updateValue('directionalLight', (value) => {
      if (!value) return
      this.directionalLight.intensity = value
    })
  }

  changeHandSwingingState (isAnimationPlaying: boolean, isLeft = false) {
    const holdingBlock = isLeft ? this.holdingBlockLeft : this.holdingBlock
    if (isAnimationPlaying) {
      holdingBlock.startSwing()
    } else {
      holdingBlock.stopSwing()
    }
  }

  async updateAssetsData (): Promise<void> {
    const resources = this.resourcesManager.currentResources!

    const oldTexture = this.material.map
    const oldItemsTexture = this.itemsTexture

    const texture = await new THREE.TextureLoader().loadAsync(resources.blocksAtlasParser.latestImage)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.flipY = false
    this.material.map = texture

    const itemsTexture = await new THREE.TextureLoader().loadAsync(resources.itemsAtlasParser.latestImage)
    itemsTexture.magFilter = THREE.NearestFilter
    itemsTexture.minFilter = THREE.NearestFilter
    itemsTexture.flipY = false
    this.itemsTexture = itemsTexture

    if (oldTexture) {
      oldTexture.dispose()
    }
    if (oldItemsTexture) {
      oldItemsTexture.dispose()
    }

    await super.updateAssetsData()
    this.onAllTexturesLoaded()
    if (Object.keys(this.loadedChunks).length > 0) {
      console.log('rerendering chunks because of texture update')
      this.rerenderAllChunks()
    }
  }

  onAllTexturesLoaded () {
    this.holdingBlock.ready = true
    this.holdingBlock.updateItem()
    this.holdingBlockLeft.ready = true
    this.holdingBlockLeft.updateItem()
  }

  changeBackgroundColor (color: [number, number, number]): void {
    this.scene.background = new THREE.Color(color[0], color[1], color[2])
  }

  timeUpdated (newTime: number): void {
    const nightTime = 13_500
    const morningStart = 23_000
    const displayStars = newTime > nightTime && newTime < morningStart
    if (displayStars) {
      this.starField.addToScene()
    } else {
      this.starField.remove()
    }
  }

  getItemRenderData (item: Record<string, any>, specificProps: ItemSpecificContextProperties) {
    return getItemUv(item, specificProps, this.resourcesManager)
  }

  async demoModel () {
    //@ts-expect-error
    const pos = cursorBlockRel(0, 1, 0).position

    const mesh = await getMyHand()
    // mesh.rotation.y = THREE.MathUtils.degToRad(90)
    setBlockPosition(mesh, pos)
    const helper = new THREE.BoxHelper(mesh, 0xff_ff_00)
    mesh.add(helper)
    this.scene.add(mesh)
  }

  demoItem () {
    //@ts-expect-error
    const pos = cursorBlockRel(0, 1, 0).position
    const { mesh } = this.entities.getItemMesh({
      itemId: 541,
    }, {})!
    mesh.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5)
    // mesh.scale.set(0.5, 0.5, 0.5)
    const helper = new THREE.BoxHelper(mesh, 0xff_ff_00)
    mesh.add(helper)
    this.scene.add(mesh)
  }

  debugOverlayAdded = false
  addDebugOverlay () {
    if (this.debugOverlayAdded) return
    this.debugOverlayAdded = true
    const pane = addNewStat('debug-overlay')
    setInterval(() => {
      pane.setVisibility(this.displayStats)
      if (this.displayStats) {
        pane.updateText(`C: ${this.renderer.info.render.calls} TR: ${this.renderer.info.render.triangles} TE: ${this.renderer.info.memory.textures} F: ${this.tilesRendered} B: ${this.blocksRendered}`)
      }
    }, 200)
  }

  /**
   * Optionally update data that are depedendent on the viewer position
   */
  updatePosDataChunk (key: string) {
    const [x, y, z] = key.split(',').map(x => Math.floor(+x / 16))
    // sum of distances: x + y + z
    const chunkDistance = Math.abs(x - this.cameraSectionPos.x) + Math.abs(y - this.cameraSectionPos.y) + Math.abs(z - this.cameraSectionPos.z)
    const section = this.sectionObjects[key].children.find(child => child.name === 'mesh')!
    section.renderOrder = 500 - chunkDistance
  }

  updateViewerPosition (pos: Vec3): void {
    this.viewerPosition = pos
    const cameraPos = this.camera.position.toArray().map(x => Math.floor(x / 16)) as [number, number, number]
    this.cameraSectionPos = new Vec3(...cameraPos)
    // eslint-disable-next-line guard-for-in
    for (const key in this.sectionObjects) {
      const value = this.sectionObjects[key]
      if (!value) continue
      this.updatePosDataChunk(key)
    }
  }

  getDir (current: number, origin: number) {
    if (current === origin) return 0
    return current < origin ? 1 : -1
  }

  finishChunk (chunkKey: string) {
    for (const sectionKey of this.waitingChunksToDisplay[chunkKey] ?? []) {
      this.sectionObjects[sectionKey].visible = true
    }
    delete this.waitingChunksToDisplay[chunkKey]
  }

  // debugRecomputedDeletedObjects = 0
  handleWorkerMessage (data: { geometry: MesherGeometryOutput, key, type }): void {
    if (data.type !== 'geometry') return
    let object: THREE.Object3D = this.sectionObjects[data.key]
    if (object) {
      this.scene.remove(object)
      disposeObject(object)
      delete this.sectionObjects[data.key]
    }

    const chunkCoords = data.key.split(',')
    if (!this.loadedChunks[chunkCoords[0] + ',' + chunkCoords[2]] || !data.geometry.positions.length || !this.active) return

    // if (object) {
    //   this.debugRecomputedDeletedObjects++
    // }

    // if (!this.initialChunksLoad && this.enableChunksLoadDelay) {
    //   const newPromise = new Promise(resolve => {
    //     if (this.droppedFpsPercentage > 0.5) {
    //       setTimeout(resolve, 1000 / 50 * this.droppedFpsPercentage)
    //     } else {
    //       setTimeout(resolve)
    //     }
    //   })
    //   this.promisesQueue.push(newPromise)
    //   for (const promise of this.promisesQueue) {
    //     await promise
    //   }
    // }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.geometry.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.geometry.normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(data.geometry.colors, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.geometry.uvs, 2))
    geometry.setIndex(data.geometry.indices)

    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(data.geometry.sx, data.geometry.sy, data.geometry.sz)
    mesh.name = 'mesh'
    object = new THREE.Group()
    object.add(mesh)
    // mesh with static dimensions: 16x16x16
    const staticChunkMesh = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 16), new THREE.MeshBasicMaterial({ color: 0x00_00_00, transparent: true, opacity: 0 }))
    staticChunkMesh.position.set(data.geometry.sx, data.geometry.sy, data.geometry.sz)
    const boxHelper = new THREE.BoxHelper(staticChunkMesh, 0xff_ff_00)
    boxHelper.name = 'helper'
    object.add(boxHelper)
    object.name = 'chunk';
    (object as any).tilesCount = data.geometry.positions.length / 3 / 4;
    (object as any).blocksCount = data.geometry.blocksCount
    if (!this.displayOptions.inWorldRenderingConfig.showChunkBorders) {
      boxHelper.visible = false
    }
    // should not compute it once
    if (Object.keys(data.geometry.signs).length) {
      for (const [posKey, { isWall, isHanging, rotation }] of Object.entries(data.geometry.signs)) {
        const signBlockEntity = this.blockEntities[posKey]
        if (!signBlockEntity) continue
        const [x, y, z] = posKey.split(',')
        const sign = this.renderSign(new Vec3(+x, +y, +z), rotation, isWall, isHanging, nbt.simplify(signBlockEntity))
        if (!sign) continue
        object.add(sign)
      }
    }
    if (Object.keys(data.geometry.heads).length) {
      for (const [posKey, { isWall, rotation }] of Object.entries(data.geometry.heads)) {
        const headBlockEntity = this.blockEntities[posKey]
        if (!headBlockEntity) continue
        const [x, y, z] = posKey.split(',')
        const head = this.renderHead(new Vec3(+x, +y, +z), rotation, isWall, nbt.simplify(headBlockEntity))
        if (!head) continue
        object.add(head)
      }
    }
    this.sectionObjects[data.key] = object
    if (this.displayOptions.inWorldRenderingConfig._renderByChunks) {
      object.visible = false
      const chunkKey = `${chunkCoords[0]},${chunkCoords[2]}`
      this.waitingChunksToDisplay[chunkKey] ??= []
      this.waitingChunksToDisplay[chunkKey].push(data.key)
      if (this.finishedChunks[chunkKey]) {
        // todo it might happen even when it was not an update
        this.finishChunk(chunkKey)
      }
    }

    this.updatePosDataChunk(data.key)
    object.matrixAutoUpdate = false
    mesh.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
      // mesh.matrixAutoUpdate = false
    }

    this.scene.add(object)
  }

  getSignTexture (position: Vec3, blockEntity, backSide = false) {
    const chunk = chunkPos(position)
    let textures = this.chunkTextures.get(`${chunk[0]},${chunk[1]}`)
    if (!textures) {
      textures = {}
      this.chunkTextures.set(`${chunk[0]},${chunk[1]}`, textures)
    }
    const texturekey = `${position.x},${position.y},${position.z}`
    // todo investigate bug and remove this so don't need to clean in section dirty
    if (textures[texturekey]) return textures[texturekey]

    const PrismarineChat = PrismarineChatLoader(this.version)
    const canvas = renderSign(blockEntity, PrismarineChat)
    if (!canvas) return
    const tex = new THREE.Texture(canvas)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.needsUpdate = true
    textures[texturekey] = tex
    return tex
  }

  tryIntersectMedia () {
    const { camera } = this
    const raycaster = new THREE.Raycaster()

    // Get mouse position at center of screen
    const mouse = new THREE.Vector2(0, 0)

    // Update the raycaster
    raycaster.setFromCamera(mouse, camera)

    let result = null as { id: string, x: number, y: number } | null
    // Check intersection with all video meshes
    for (const [id, videoData] of this.customMedia.entries()) {
      // Get the actual mesh (first child of the group)
      const mesh = videoData.mesh.children[0] as THREE.Mesh
      if (!mesh) continue

      const intersects = raycaster.intersectObject(mesh, false)
      if (intersects.length > 0) {
        const intersection = intersects[0]
        const { uv } = intersection
        if (uv) {
          result = {
            id,
            x: uv.x,
            y: uv.y
          }
          break
        }
      }
    }
    this.reactiveState.world.intersectMedia = result
  }

  setFirstPersonCamera (pos: Vec3 | null, yaw: number, pitch: number) {
    const cam = this.cameraObjectOverride || this.camera
    const yOffset = this.displayOptions.playerState.getEyeHeight()

    this.camera = cam as THREE.PerspectiveCamera
    
    // Handle the case where pos might not be a proper Vec3 instance
    let adjustedPos: Vec3 | null = null
    if (pos) {
      // Create a new Vec3 instance to ensure it has the offset method
      adjustedPos = new Vec3(pos.x, pos.y + yOffset, pos.z)
    }
    
    this.updateCamera(adjustedPos, yaw, pitch)
    this.tryIntersectMedia()
  }

  updateCamera (pos: Vec3 | null, yaw: number, pitch: number): void {
    // Simple, smooth camera movement
    const duration = 100 // ms - smooth but not too slow

    // if (this.freeFlyMode) {
    //   pos = this.freeFlyState.position
    //   pitch = this.freeFlyState.pitch
    //   yaw = this.freeFlyState.yaw
    // }

    // Tween position with simple easing
    if (pos) {
      new tweenJs.Tween(this.camera.position)
        .to({ x: pos.x, y: pos.y, z: pos.z }, duration)
        .easing(tweenJs.Easing.Quadratic.Out) // Simple smooth easing
        .start()
      // this.freeFlyState.position = pos
    }

    // Update camera shake with simple rotation tweening
    this.cameraShake.setBaseRotation(pitch, yaw)
  }

  render (sizeChanged = false) {
    this.lastRendered = performance.now()
    this.cursorBlock.render()

    const sizeOrFovChanged = sizeChanged || this.displayOptions.inWorldRenderingConfig.fov !== this.camera.fov
    if (sizeOrFovChanged) {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.fov = this.displayOptions.inWorldRenderingConfig.fov
      this.camera.updateProjectionMatrix()
    }

    this.entities.render()

    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    const cam = this.camera instanceof THREE.Group ? this.camera.children.find(child => child instanceof THREE.PerspectiveCamera) as THREE.PerspectiveCamera : this.camera
    this.renderer.render(this.scene, cam)

    if (this.displayOptions.inWorldRenderingConfig.showHand && bot.game.gameMode !== 'spectator') {
      this.holdingBlock.render(this.camera, this.renderer, this.ambientLight, this.directionalLight)
      this.holdingBlockLeft.render(this.camera, this.renderer, this.ambientLight, this.directionalLight)
    }

    for (const onRender of this.onRender) {
      onRender()
    }
  }

  renderHead (position: Vec3, rotation: number, isWall: boolean, blockEntity) {
    const textures = blockEntity.SkullOwner?.Properties?.textures[0]
    if (!textures) return

    try {
      const textureData = JSON.parse(Buffer.from(textures.Value, 'base64').toString())
      const skinUrl = textureData.textures?.SKIN?.url

      const mesh = getMesh(this, skinUrl, armorModel.head)
      const group = new THREE.Group()
      if (isWall) {
        mesh.position.set(0, 0.3125, 0.3125)
      }
      // move head model down as armor have a different offset than blocks
      mesh.position.y -= 23 / 16
      group.add(mesh)
      group.position.set(position.x + 0.5, position.y + 0.045, position.z + 0.5)
      group.rotation.set(
        0,
        -THREE.MathUtils.degToRad(rotation * (isWall ? 90 : 45 / 2)),
        0
      )
      group.scale.set(0.8, 0.8, 0.8)
      return group
    } catch (err) {
      console.error('Error decoding player texture:', err)
    }
  }

  renderSign (position: Vec3, rotation: number, isWall: boolean, isHanging: boolean, blockEntity) {
    const tex = this.getSignTexture(position, blockEntity)

    if (!tex) return

    // todo implement
    // const key = JSON.stringify({ position, rotation, isWall })
    // if (this.signsCache.has(key)) {
    //   console.log('cached', key)
    // } else {
    //   this.signsCache.set(key, tex)
    // }

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    mesh.renderOrder = 999

    const lineHeight = 7 / 16
    const scaleFactor = isHanging ? 1.3 : 1
    mesh.scale.set(1 * scaleFactor, lineHeight * scaleFactor, 1 * scaleFactor)

    const thickness = (isHanging ? 2 : 1.5) / 16
    const wallSpacing = 0.25 / 16
    if (isWall && !isHanging) {
      mesh.position.set(0, 0, -0.5 + thickness + wallSpacing + 0.0001)
    } else {
      mesh.position.set(0, 0, thickness / 2 + 0.0001)
    }

    const group = new THREE.Group()
    group.rotation.set(
      0,
      -THREE.MathUtils.degToRad(rotation * (isWall ? 90 : 45 / 2)),
      0
    )
    group.add(mesh)
    const height = (isHanging ? 10 : 8) / 16
    const heightOffset = (isHanging ? 0 : isWall ? 4.333 : 9.333) / 16
    const textPosition = height / 2 + heightOffset
    group.position.set(position.x + 0.5, position.y + textPosition, position.z + 0.5)
    return group
  }

  lightUpdate (chunkX: number, chunkZ: number) {
    // set all sections in the chunk dirty
    for (let y = this.worldSizeParams.minY; y < this.worldSizeParams.worldHeight; y += 16) {
      this.setSectionDirty(new Vec3(chunkX, y, chunkZ))
    }
  }

  rerenderAllChunks () { // todo not clear what to do with loading chunks
    for (const key of Object.keys(this.sectionObjects)) {
      const [x, y, z] = key.split(',').map(Number)
      this.setSectionDirty(new Vec3(x, y, z))
    }
  }

  updateShowChunksBorder (value: boolean) {
    this.displayOptions.inWorldRenderingConfig.showChunkBorders = value
    for (const object of Object.values(this.sectionObjects)) {
      for (const child of object.children) {
        if (child.name === 'helper') {
          child.visible = value
        }
      }
    }
  }

  resetWorld () {
    super.resetWorld()

    for (const mesh of Object.values(this.sectionObjects)) {
      this.scene.remove(mesh)
    }
  }

  getLoadedChunksRelative (pos: Vec3, includeY = false) {
    const [currentX, currentY, currentZ] = sectionPos(pos)
    return Object.fromEntries(Object.entries(this.sectionObjects).map(([key, o]) => {
      const [xRaw, yRaw, zRaw] = key.split(',').map(Number)
      const [x, y, z] = sectionPos({ x: xRaw, y: yRaw, z: zRaw })
      const setKey = includeY ? `${x - currentX},${y - currentY},${z - currentZ}` : `${x - currentX},${z - currentZ}`
      return [setKey, o]
    }))
  }

  cleanChunkTextures (x, z) {
    const textures = this.chunkTextures.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) ?? {}
    for (const key of Object.keys(textures)) {
      textures[key].dispose()
      delete textures[key]
    }
  }

  readdChunks () {
    for (const key of Object.keys(this.sectionObjects)) {
      this.scene.remove(this.sectionObjects[key])
    }
    setTimeout(() => {
      for (const key of Object.keys(this.sectionObjects)) {
        this.scene.add(this.sectionObjects[key])
      }
    }, 500)
  }

  disableUpdates (children = this.scene.children) {
    for (const child of children) {
      child.matrixWorldNeedsUpdate = false
      this.disableUpdates(child.children ?? [])
    }
  }

  removeColumn (x, z) {
    super.removeColumn(x, z)

    this.cleanChunkTextures(x, z)
    for (let y = this.worldSizeParams.minY; y < this.worldSizeParams.worldHeight; y += 16) {
      this.setSectionDirty(new Vec3(x, y, z), false)
      const key = `${x},${y},${z}`
      const mesh = this.sectionObjects[key]
      if (mesh) {
        this.scene.remove(mesh)
        disposeObject(mesh)
      }
      delete this.sectionObjects[key]
    }
  }

  setSectionDirty (...args: Parameters<WorldRendererCommon['setSectionDirty']>) {
    const [pos] = args
    this.cleanChunkTextures(pos.x, pos.z) // todo don't do this!
    super.setSectionDirty(...args)
  }

  static getRendererInfo (renderer: THREE.WebGLRenderer) {
    try {
      const gl = renderer.getContext()
      return `${gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL)}`
    } catch (err) {
      console.warn('Failed to get renderer info', err)
    }
  }

  private createErrorTexture (width: number, height: number, background = 0x00_00_00): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    // Scale up the canvas size for better text quality
    canvas.width = width * 100
    canvas.height = height * 100

    const ctx = canvas.getContext('2d')
    if (!ctx) return new THREE.CanvasTexture(canvas)

    // Clear with transparent background
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Add background color
    ctx.fillStyle = `rgba(${background >> 16 & 255}, ${background >> 8 & 255}, ${background & 255}, 0.5)`
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Add red text
    ctx.fillStyle = '#ff0000'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Failed to load', canvas.width / 2, canvas.height / 2, canvas.width)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
  }

  private createBackgroundTexture (width: number, height: number, color = 0x00_00_00, opacity = 1): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1

    const ctx = canvas.getContext('2d')
    if (!ctx) return new THREE.CanvasTexture(canvas)

    // Convert hex color to rgba
    const r = (color >> 16) & 255
    const g = (color >> 8) & 255
    const b = color & 255

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
    ctx.fillRect(0, 0, 1, 1)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    return texture
  }

  validateOrigin (src: string, allowOrigins: string[] | boolean) {
    if (allowOrigins === true) return true
    if (allowOrigins === false) return false
    const url = new URL(src)
    return allowOrigins.some(origin => url.origin.endsWith(origin))
  }

  addMedia (id: string, props: MediaProperties) {
    this.destroyMedia(id)

    const originSecurityError = props.allowOrigins !== undefined && !this.validateOrigin(props.src, props.allowOrigins)
    if (originSecurityError) {
      console.warn('Remote resource blocked due to security policy', props.src, 'allowed origins:', props.allowOrigins, 'you can control it with `remoteContentNotSameOrigin` option')
      props.src = ''
    }

    const isImage = props.src.endsWith('.png') || props.src.endsWith('.jpg') || props.src.endsWith('.jpeg')

    let video: HTMLVideoElement | undefined
    if (!isImage) {
      video = document.createElement('video')
      video.src = props.src
      video.loop = props.loop ?? true
      video.volume = props.volume ?? 1
      video.muted = !props.volume
      video.playsInline = true
      video.crossOrigin = 'anonymous'
    }

    // Create background texture first
    const backgroundTexture = this.createBackgroundTexture(
      props.size.width,
      props.size.height,
      props.background,
      // props.opacity ?? 1
    )

    const handleError = () => {
      const errorTexture = this.createErrorTexture(props.size.width, props.size.height, props.background)
      material.map = errorTexture
      material.needsUpdate = true
    }

    // Create a plane geometry with configurable UV mapping
    const geometry = new THREE.PlaneGeometry(1, 1)

    // Create material with initial properties using background texture
    const material = new THREE.MeshLambertMaterial({
      map: backgroundTexture,
      transparent: true,
      side: props.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: 0.1
    })

    const texture = video
      ? new THREE.VideoTexture(video)
      : new THREE.TextureLoader().load(props.src, () => {
        if (this.customMedia.get(id)?.texture === texture) {
          material.map = texture
          material.needsUpdate = true
        }
      }, undefined, handleError) // todo cache
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.format = THREE.RGBAFormat
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false

    // Create inner mesh for offsets
    const mesh = new THREE.Mesh(geometry, material)

    const { mesh: panel } = this.positionMeshExact(mesh, THREE.MathUtils.degToRad((props.rotation ?? 0) * 90), props.position, props.size.width, props.size.height)

    this.scene.add(panel)

    if (video) {
      // Start playing the video
      video.play().catch(err => {
        console.error('Failed to play video:', err)
        handleError()
      })

      // Update texture in animation loop
      mesh.onBeforeRender = () => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          if (material.map !== texture) {
            material.map = texture
            material.needsUpdate = true
          }
          texture.needsUpdate = true
        }
      }
    }

    // UV mapping configuration
    const updateUVMapping = (config: { startU: number, endU: number, startV: number, endV: number }) => {
      const uvs = geometry.attributes.uv.array as Float32Array
      uvs[0] = config.startU
      uvs[1] = config.startV
      uvs[2] = config.endU
      uvs[3] = config.startV
      uvs[4] = config.endU
      uvs[5] = config.endV
      uvs[6] = config.startU
      uvs[7] = config.endV
      geometry.attributes.uv.needsUpdate = true
    }

    // Apply initial UV mapping if provided
    if (props.uvMapping) {
      updateUVMapping(props.uvMapping)
    }

    // Store video data
    this.customMedia.set(id, {
      mesh: panel,
      video,
      texture,
      updateUVMapping
    })

    return id
  }

  setVideoPlaying (id: string, playing: boolean) {
    const videoData = this.customMedia.get(id)
    if (videoData?.video) {
      if (playing) {
        videoData.video.play().catch(console.error)
      } else {
        videoData.video.pause()
      }
    }
  }

  setVideoSeeking (id: string, seconds: number) {
    const videoData = this.customMedia.get(id)
    if (videoData?.video) {
      videoData.video.currentTime = seconds
    }
  }

  setVideoVolume (id: string, volume: number) {
    const videoData = this.customMedia.get(id)
    if (videoData?.video) {
      videoData.video.volume = volume
    }
  }

  setVideoSpeed (id: string, speed: number) {
    const videoData = this.customMedia.get(id)
    if (videoData?.video) {
      videoData.video.playbackRate = speed
    }
  }

  destroyMedia (id: string) {
    const media = this.customMedia.get(id)
    if (media) {
      if (media.video) {
        media.video.pause()
        media.video.src = ''
      }
      this.scene.remove(media.mesh)
      media.texture.dispose()

      // Get the inner mesh from the group
      const mesh = media.mesh.children[0] as THREE.Mesh
      if (mesh) {
        mesh.geometry.dispose()
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose()
        }
      }

      this.customMedia.delete(id)
    }
  }

  /**
   * Positions a mesh exactly at startPosition and extends it along the rotation direction
   * with the specified width and height
   *
   * @param mesh The mesh to position
   * @param rotation Rotation in radians (applied to Y axis)
   * @param startPosition The exact starting position (corner) of the mesh
   * @param width Width of the mesh
   * @param height Height of the mesh
   * @param depth Depth of the mesh (default: 1)
   * @returns The positioned mesh for chaining
   */
  positionMeshExact (
    mesh: THREE.Mesh,
    rotation: number,
    startPosition: { x: number, y: number, z: number },
    width: number,
    height: number,
    depth = 1
  ) {
    // avoid z-fighting with the ground plane
    if (rotation === 0) {
      startPosition.z += 0.001
    }
    if (rotation === Math.PI / 2) {
      startPosition.x -= 0.001
    }
    if (rotation === Math.PI) {
      startPosition.z -= 0.001
    }
    if (rotation === 3 * Math.PI / 2) {
      startPosition.x += 0.001
    }

    // rotation normalize coordinates
    if (rotation === 0) {
      startPosition.z += 1
    }
    if (rotation === Math.PI) {
      startPosition.x += 1
    }
    if (rotation === 3 * Math.PI / 2) {
      startPosition.z += 1
      startPosition.x += 1
    }


    // First, clean up any previous transformations
    mesh.matrix.identity()
    mesh.position.set(0, 0, 0)
    mesh.rotation.set(0, 0, 0)
    mesh.scale.set(1, 1, 1)

    // By default, PlaneGeometry creates a plane in the XY plane (facing +Z)
    // We need to set up the proper orientation for our use case
    // Rotate the plane to face the correct direction based on the rotation parameter
    mesh.rotateY(rotation)
    if (rotation === Math.PI / 2 || rotation === 3 * Math.PI / 2) {
      mesh.rotateZ(-Math.PI)
      mesh.rotateX(-Math.PI)
    }

    // Scale it to the desired size
    mesh.scale.set(width, height, depth)

    // For a PlaneGeometry, if we want the corner at the origin, we need to offset
    // by half the dimensions after scaling
    mesh.geometry.translate(0.5, 0.5, 0)
    mesh.geometry.attributes.position.needsUpdate = true

    // Now place the mesh at the start position
    mesh.position.set(startPosition.x, startPosition.y, startPosition.z)

    // Create a group to hold our mesh and markers
    const debugGroup = new THREE.Group()
    debugGroup.add(mesh)

    // Add a marker at the starting position (should be exactly at pos)
    const startMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff_00_00 })
    )
    startMarker.position.copy(new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z))
    debugGroup.add(startMarker)

    // Add a marker at the end position (width units away in the rotated direction)
    const endX = startPosition.x + Math.cos(rotation) * width
    const endZ = startPosition.z + Math.sin(rotation) * width
    const endYMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x00_00_ff })
    )
    endYMarker.position.set(startPosition.x, startPosition.y + height, startPosition.z)
    debugGroup.add(endYMarker)

    // Add a marker at the width endpoint
    const endWidthMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff_ff_00 })
    )
    endWidthMarker.position.set(endX, startPosition.y, endZ)
    debugGroup.add(endWidthMarker)

    // Add a marker at the corner diagonal endpoint (both width and height)
    const endCornerMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff_00_ff })
    )
    endCornerMarker.position.set(endX, startPosition.y + height, endZ)
    debugGroup.add(endCornerMarker)

    // Also add a visual helper to show the rotation direction
    const directionHelper = new THREE.ArrowHelper(
      new THREE.Vector3(Math.cos(rotation), 0, Math.sin(rotation)),
      new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z),
      1,
      0xff_00_00
    )
    debugGroup.add(directionHelper)

    return {
      mesh,
      debugGroup
    }
  }

  createTestCanvasTexture () {
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.font = '10px Arial'
    ctx.fillStyle = 'red'
    ctx.fillText('Hello World', 0, 10) // at
    return new THREE.CanvasTexture(canvas)
  }

  /**
   * Creates a test mesh that demonstrates the exact positioning
   */
  addTestMeshExact (rotationNum: number) {
    const pos = window.cursorBlockRel().position
    console.log('Creating exact positioned test mesh at:', pos)

    // Create a plane mesh with a wireframe to visualize boundaries
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        // side: THREE.DoubleSide,
        map: this.createTestCanvasTexture()
      })
    )

    const width = 2
    const height = 1
    const rotation = THREE.MathUtils.degToRad(rotationNum * 90) // 90 degrees in radians

    // Position the mesh exactly where we want it
    const { debugGroup } = this.positionMeshExact(plane, rotation, pos, width, height)

    this.scene.add(debugGroup)
    console.log('Exact test mesh added with dimensions:', width, height, 'and rotation:', rotation)

  }

  destroy (): void {
    removeAllStats()
    super.destroy()
  }
}

class StarField {
  points?: THREE.Points
  private _enabled = true
  get enabled () {
    return this._enabled
  }

  set enabled (value) {
    this._enabled = value
    if (this.points) {
      this.points.visible = value
    }
  }

  constructor (private readonly scene: THREE.Scene) {
  }

  addToScene () {
    if (this.points || !this.enabled) return

    const radius = 80
    const depth = 50
    const count = 7000
    const factor = 7
    const saturation = 10
    const speed = 0.2

    const geometry = new THREE.BufferGeometry()

    const genStar = r => new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, Math.acos(1 - Math.random() * 2), Math.random() * 2 * Math.PI))

    const positions = [] as number[]
    const colors = [] as number[]
    const sizes = Array.from({ length: count }, () => (0.5 + 0.5 * Math.random()) * factor)
    const color = new THREE.Color()
    let r = radius + depth
    const increment = depth / count
    for (let i = 0; i < count; i++) {
      r -= increment * Math.random()
      positions.push(...genStar(r).toArray())
      color.setHSL(i / count, saturation, 0.9)
      colors.push(color.r, color.g, color.b)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))

    // Create a material
    const material = new StarfieldMaterial()
    material.blending = THREE.AdditiveBlending
    material.depthTest = false
    material.transparent = true

    // Create points and add them to the scene
    this.points = new THREE.Points(geometry, material)
    this.scene.add(this.points)

    const clock = new THREE.Clock()
    this.points.onBeforeRender = (renderer, scene, camera) => {
      this.points?.position.copy?.(camera.position)
      material.uniforms.time.value = clock.getElapsedTime() * speed
    }
    this.points.renderOrder = -1
  }

  remove () {
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose()
      this.scene.remove(this.points)

      this.points = undefined
    }
  }
}

const version = parseInt(THREE.REVISION.replaceAll(/\D+/g, ''), 10)
class StarfieldMaterial extends THREE.ShaderMaterial {
  constructor () {
    super({
      uniforms: { time: { value: 0 }, fade: { value: 1 } },
      vertexShader: /* glsl */ `
                uniform float time;
                attribute float size;
                varying vec3 vColor;
                attribute vec3 color;
                void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 0.5);
                gl_PointSize = 0.7 * size * (30.0 / -mvPosition.z) * (3.0 + sin(time + 100.0));
                gl_Position = projectionMatrix * mvPosition;
            }`,
      fragmentShader: /* glsl */ `
                uniform sampler2D pointTexture;
                uniform float fade;
                varying vec3 vColor;
                void main() {
                float opacity = 1.0;
                gl_FragColor = vec4(vColor, 1.0);

                #include <tonemapping_fragment>
                #include <${version >= 154 ? 'colorspace_fragment' : 'encodings_fragment'}>
            }`,
    })
  }
}
