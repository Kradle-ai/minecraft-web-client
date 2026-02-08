//@ts-check
import EventEmitter from 'events'
import { UnionToIntersection } from 'type-fest'
import nbt from 'prismarine-nbt'
import * as TWEEN from '@tweenjs/tween.js'
import * as THREE from 'three'
import { PlayerObject, PlayerAnimation } from 'skinview3d'
import { loadSkinToCanvas, loadEarsToCanvasFromSkin, inferModelType, loadCapeToCanvas, loadImage } from 'skinview-utils'
// todo replace with url
import { degreesToRadians } from '@nxg-org/mineflayer-tracker/lib/mathUtils'
import { NameTagObject } from 'skinview3d/libs/nametag'
import { flat, fromFormattedString } from '@xmcl/text-component'
import mojangson from 'mojangson'
import { snakeCase } from 'change-case'
import { Item } from 'prismarine-item'
import { BlockModel } from 'mc-assets'
import { isEntityAttackable } from 'mineflayer-mouse/dist/attackableEntity'
import { Vec3 } from 'vec3'
import { EntityMetadataVersions } from '../../../src/mcDataTypes'
import { ItemSpecificContextProperties } from '../lib/basePlayerState'
import { loadSkinImage, getLookupUrl, stevePngUrl, steveTexture } from '../lib/utils/skins'
import { loadTexture } from '../lib/utils'
import { getBlockMeshFromModel } from './holdingBlock'
import * as Entity from './entity/EntityMesh'
import { getMesh } from './entity/EntityMesh'
import { WalkingGeneralSwing } from './entity/animations'
import { disposeObject } from './threeJsUtils'
import { armorModel, armorTextures } from './entity/armorModels'
import { WorldRendererThree } from './worldrendererThree'

export const TWEEN_DURATION = 120

type PlayerObjectType = PlayerObject & { animation?: PlayerAnimation }

function convert2sComplementToHex (complement: number) {
  if (complement < 0) {
    complement = (0xFF_FF_FF_FF + complement + 1) >>> 0
  }
  return complement.toString(16)
}

function toRgba (color: string | undefined) {
  if (color === undefined) {
    return undefined
  }
  if (parseInt(color, 10) === 0) {
    return 'rgba(0, 0, 0, 0)'
  }
  const hex = convert2sComplementToHex(parseInt(color, 10))
  if (hex.length === 8) {
    return `#${hex.slice(2, 8)}${hex.slice(0, 2)}`
  } else {
    return `#${hex}`
  }
}

function toQuaternion (quaternion: any, defaultValue?: THREE.Quaternion) {
  if (quaternion === undefined) {
    return defaultValue
  }
  if (quaternion instanceof THREE.Quaternion) {
    return quaternion
  }
  if (Array.isArray(quaternion)) {
    return new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  }
  return new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
}

function poseToEuler (pose: any, defaultValue?: THREE.Euler) {
  if (pose === undefined) {
    return defaultValue ?? new THREE.Euler()
  }
  if (pose instanceof THREE.Euler) {
    return pose
  }
  if (pose['yaw'] !== undefined && pose['pitch'] !== undefined && pose['roll'] !== undefined) {
    // Convert Minecraft pitch, yaw, roll definitions to our angle system
    return new THREE.Euler(-degreesToRadians(pose.pitch), -degreesToRadians(pose.yaw), degreesToRadians(pose.roll), 'ZYX')
  }
  if (pose['x'] !== undefined && pose['y'] !== undefined && pose['z'] !== undefined) {
    return new THREE.Euler(pose.z, pose.y, pose.x, 'ZYX')
  }
  if (Array.isArray(pose)) {
    return new THREE.Euler(pose[0], pose[1], pose[2])
  }
  return defaultValue ?? new THREE.Euler()
}

function getUsernameTexture ({
  username,
  nameTagBackgroundColor = 'rgba(0, 0, 0, 0.3)',
  nameTagTextOpacity = 255
}: any, { fontFamily = 'sans-serif' }: any) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2d context')

  const fontSize = 48
  const padding = 5
  ctx.font = `${fontSize}px ${fontFamily}`

  const lines = String(username).split('\n')

  let textWidth = 0
  for (const line of lines) {
    const width = ctx.measureText(line).width + padding * 2
    if (width > textWidth) textWidth = width
  }

  canvas.width = textWidth
  canvas.height = (fontSize + padding) * lines.length

  ctx.fillStyle = nameTagBackgroundColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.font = `${fontSize}px ${fontFamily}`
  ctx.fillStyle = `rgba(255, 255, 255, ${nameTagTextOpacity / 255})`
  let i = 0
  for (const line of lines) {
    i++
    ctx.fillText(line, (textWidth - ctx.measureText(line).width) / 2, -padding + fontSize * i)
  }

  return canvas
}

const addNametag = (entity, options, mesh) => {
  if (entity.username !== undefined) {
    if (mesh.children.some(c => c.name === 'nametag')) return // todo update
    const canvas = getUsernameTexture(entity, options)
    const tex = new THREE.Texture(canvas)
    tex.needsUpdate = true
    let nameTag
    if (entity.nameTagFixed) {
      const geometry = new THREE.PlaneGeometry()
      const material = new THREE.MeshBasicMaterial({ map: tex })
      material.transparent = true
      nameTag = new THREE.Mesh(geometry, material)
      nameTag.rotation.set(entity.pitch, THREE.MathUtils.degToRad(entity.yaw + 180), 0)
      nameTag.position.y += entity.height + 0.3
    } else {
      const spriteMat = new THREE.SpriteMaterial({ map: tex })
      nameTag = new THREE.Sprite(spriteMat)
      nameTag.position.y += entity.height + 0.6
    }
    nameTag.renderOrder = 1000
    nameTag.scale.set(canvas.width * 0.005, canvas.height * 0.005, 1)
    if (entity.nameTagRotationRight) {
      nameTag.applyQuaternion(entity.nameTagRotationRight)
    }
    if (entity.nameTagScale) {
      nameTag.scale.multiply(entity.nameTagScale)
    }
    if (entity.nameTagRotationLeft) {
      nameTag.applyQuaternion(entity.nameTagRotationLeft)
    }
    if (entity.nameTagTranslation) {
      nameTag.position.add(entity.nameTagTranslation)
    }
    nameTag.name = 'nametag'

    mesh.add(nameTag)
  }
}

// todo cleanup
const nametags = {}

const isFirstUpperCase = (str) => str.charAt(0) === str.charAt(0).toUpperCase()

function getEntityMesh (entity: import('prismarine-entity').Entity & { delete?: any; pos: any; name: any }, world: WorldRendererThree | undefined, options: { fontFamily: string }, overrides) {
  if (entity.name) {
    try {
      // https://github.com/PrismarineJS/prismarine-viewer/pull/410
      const entityName = (isFirstUpperCase(entity.name) ? snakeCase(entity.name) : entity.name).toLowerCase()
      const e = new Entity.EntityMesh('1.16.4', entityName, world, overrides)

      if (e.mesh) {
        addNametag(entity, options, e.mesh)
        return e.mesh
      }
    } catch (err) {
      reportError?.(err)
    }
  }

  if (!isEntityAttackable(loadedData, entity)) return
  const geometry = new THREE.BoxGeometry(entity.width, entity.height, entity.width)
  geometry.translate(0, entity.height / 2, 0)
  const material = new THREE.MeshBasicMaterial({ color: 0xff_00_ff })
  const cube = new THREE.Mesh(geometry, material)
  const nametagCount = (nametags[entity.name] = (nametags[entity.name] || 0) + 1)
  if (nametagCount < 6) {
    addNametag({
      username: entity.name,
      height: entity.height,
    }, options, cube)
  }
  return cube
}

export type SceneEntity = THREE.Object3D & {
  playerObject?: PlayerObject & {
    animation?: PlayerAnimation
  }
  username?: string
  uuid?: string
  additionalCleanup?: () => void
}

export class Entities {
  entities = {} as Record<string, SceneEntity>
  entitiesOptions = {
    fontFamily: 'mojangles'
  }
  debugMode: string
  onSkinUpdate: () => void
  clock = new THREE.Clock()
  currentlyRendering = true
  cachedMapsImages = {} as Record<number, string>
  itemFrameMaps = {} as Record<number, Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>>>

  get entitiesByName (): Record<string, SceneEntity[]> {
    const byName: Record<string, SceneEntity[]> = {}
    for (const entity of Object.values(this.entities)) {
      if (!entity['realName']) continue
      byName[entity['realName']] = byName[entity['realName']] || []
      byName[entity['realName']].push(entity)
    }
    return byName
  }

  get entitiesRenderingCount (): number {
    return Object.values(this.entities).filter(entity => entity.visible).length
  }

  constructor (public worldRenderer: WorldRendererThree) {
    this.debugMode = 'none'
    this.onSkinUpdate = () => { }

    // Listen for agent skins updates and re-evaluate all player skins
    if (typeof customEvents !== 'undefined') {
      customEvents.on('agentSkinsUpdated', () => {
        // console.log('[Custom Skin Debug] agentSkinsUpdated event received in entities.ts')
        // Small delay to ensure the map is fully populated
        setTimeout(() => {
          this.reEvaluateAllPlayerSkins()
        }, 100)
      })
    }
  }

  clear () {
    for (const mesh of Object.values(this.entities)) {
      this.worldRenderer.scene.remove(mesh)
      disposeObject(mesh)
    }
    this.entities = {}
  }

  setDebugMode (mode: string, entity: THREE.Object3D | null = null) {
    this.debugMode = mode
    for (const mesh of entity ? [entity] : Object.values(this.entities)) {
      const boxHelper = mesh.children.find(c => c.name === 'debug')!
      boxHelper.visible = false
      if (this.debugMode === 'basic') {
        boxHelper.visible = true
      }
      // todo advanced
    }
  }

  setRendering (rendering: boolean, entity: THREE.Object3D | null = null) {
    this.currentlyRendering = rendering
    for (const ent of entity ? [entity] : Object.values(this.entities)) {
      if (rendering) {
        if (!this.worldRenderer.scene.children.includes(ent)) this.worldRenderer.scene.add(ent)
      } else {
        this.worldRenderer.scene.remove(ent)
      }
    }
  }

  render () {
    const renderEntitiesConfig = this.worldRenderer.worldRendererConfig.renderEntities
    if (renderEntitiesConfig !== this.currentlyRendering) {
      this.setRendering(renderEntitiesConfig)
    }

    const dt = this.clock.getDelta()

    for (const entityId of Object.keys(this.entities)) {
      const entity = this.entities[entityId]
      const playerObject = entity.playerObject as PlayerObjectType | undefined

      // Update animations (skip if paused)
      if (playerObject?.animation && !playerObject.animation.paused) {
        playerObject.animation.update(playerObject, dt)
      }

      // Always make entities visible (fixes issue with entities not appearing until interacted with)
      entity.visible = true
    }
  }

  getPlayerObject (entityId: string | number) {
    const playerObject = this.entities[entityId]?.playerObject as PlayerObjectType | undefined
    return playerObject
  }

  uuidPerSkinUrlsCache = {} as Record<string, { skinUrl?: string, capeUrl?: string }>

  private isCanvasBlank (canvas: HTMLCanvasElement): boolean {
    return !canvas.getContext('2d')
      ?.getImageData(0, 0, canvas.width, canvas.height).data
      .some(channel => channel !== 0)
  }

  // eslint-disable-next-line max-params
  updatePlayerSkin (entityId: string | number, username: string | undefined, uuid: string | undefined, skinUrl: string | true, capeUrl: string | true | undefined = undefined) {
    if (username === 'watcher') return

    if (uuid) {
      if (typeof skinUrl === 'string' || typeof capeUrl === 'string') this.uuidPerSkinUrlsCache[uuid] = {}
      if (typeof skinUrl === 'string') this.uuidPerSkinUrlsCache[uuid].skinUrl = skinUrl
      if (typeof capeUrl === 'string') this.uuidPerSkinUrlsCache[uuid].capeUrl = capeUrl
      if (skinUrl === true) {
        skinUrl = this.uuidPerSkinUrlsCache[uuid]?.skinUrl ?? skinUrl
      }
      capeUrl ??= this.uuidPerSkinUrlsCache[uuid]?.capeUrl
    }

    const playerObject = this.getPlayerObject(entityId)
    if (!playerObject) return

    let customSkinUrl: string | null = null
    if (username && window.agentSkinMap?.has(username)) {
      customSkinUrl = window.agentSkinMap.get(username)
      console.log('[Custom Skin Debug] Found custom skin:', { username, customSkinUrl })
      if (customSkinUrl) {
        skinUrl = customSkinUrl
      }
    } else if (skinUrl === true) {
      console.log('[Custom Skin Debug] No custom skin found, using standard lookup for:', username)
      if (!username) {
        return
      }
      // Fall back to standard skin lookup
      skinUrl = getLookupUrl(username, 'skin')
    }

    if (typeof skinUrl !== 'string') throw new Error('Invalid skin url')
    const renderEars = this.worldRenderer.worldRendererConfig.renderEars || username === 'deadmau5'
    void this.loadAndApplySkin(entityId, skinUrl, renderEars).then(() => {
      if (customSkinUrl) {
        return
      }

      if (capeUrl) {
        if (capeUrl === true && username) {
          capeUrl = getLookupUrl(username, 'cape')
        }
        if (typeof capeUrl === 'string') {
          void this.loadAndApplyCape(entityId, capeUrl)
        }
      }
    })


    playerObject.cape.visible = false
    if (!capeUrl) {
      playerObject.backEquipment = null
      playerObject.elytra.map = null
      if (playerObject.cape.map) {
        playerObject.cape.map.dispose()
      }
      playerObject.cape.map = null
    }
  }

  private async loadAndApplySkin (entityId: string | number, skinUrl: string, renderEars: boolean) {
    let playerObject = this.getPlayerObject(entityId)
    if (!playerObject) {
      console.log('[Custom Skin Debug] No player object found for entityId:', entityId)
      return
    }

    try {
      let playerCustomSkinImage: HTMLImageElement | undefined

      playerObject = this.getPlayerObject(entityId)
      if (!playerObject) {
        return
      }

      let skinTexture: THREE.Texture
      let skinCanvas: HTMLCanvasElement
      if (skinUrl === stevePngUrl) {
        skinTexture = await steveTexture
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Failed to get context')
        ctx.drawImage(skinTexture.image, 0, 0)
        skinCanvas = canvas
      } else {
        const { canvas, image } = await loadSkinImage(skinUrl)
        playerCustomSkinImage = image
        skinTexture = new THREE.CanvasTexture(canvas)
        skinCanvas = canvas
      }

      skinTexture.magFilter = THREE.NearestFilter
      skinTexture.minFilter = THREE.NearestFilter
      skinTexture.needsUpdate = true
      playerObject.skin.map = skinTexture as any

      // Check if this is a legacy skin (64x32) - these should always use the default (Steve) model
      const isLegacySkin = playerCustomSkinImage &&
        playerCustomSkinImage.width === 64 &&
        playerCustomSkinImage.height === 32

      let detectedModelType: 'default' | 'slim'
      if (isLegacySkin) {
        // Legacy skins predate the slim arms model, so they're always default
        detectedModelType = 'default'
      } else {
        // For modern skins, use auto-detection
        detectedModelType = inferModelType(skinCanvas)
      }
      playerObject.skin.modelType = detectedModelType

      let earsCanvas: HTMLCanvasElement | undefined
      if (!playerCustomSkinImage) {
        renderEars = false
      } else if (renderEars) {
        earsCanvas = document.createElement('canvas')
        loadEarsToCanvasFromSkin(earsCanvas, playerCustomSkinImage)
        renderEars = !this.isCanvasBlank(earsCanvas)
      }
      if (renderEars) {
        const earsTexture = new THREE.CanvasTexture(earsCanvas!)
        earsTexture.magFilter = THREE.NearestFilter
        earsTexture.minFilter = THREE.NearestFilter
        earsTexture.needsUpdate = true
        //@ts-expect-error
        playerObject.ears.map = earsTexture
        playerObject.ears.visible = true
      } else {
        playerObject.ears.map = null
        playerObject.ears.visible = false
      }
      this.onSkinUpdate?.()
    } catch (error) {
      console.error('[Custom Skin Debug] Error loading skin:', { entityId, skinUrl, error })
    }
  }

  private async loadAndApplyCape (entityId: string | number, capeUrl: string) {
    let playerObject = this.getPlayerObject(entityId)
    if (!playerObject) return

    try {
      const { canvas: capeCanvas, image: capeImage } = await loadSkinImage(capeUrl)

      playerObject = this.getPlayerObject(entityId)
      if (!playerObject) return

      loadCapeToCanvas(capeCanvas, capeImage)
      const capeTexture = new THREE.CanvasTexture(capeCanvas)
      capeTexture.magFilter = THREE.NearestFilter
      capeTexture.minFilter = THREE.NearestFilter
      capeTexture.needsUpdate = true
      //@ts-expect-error
      playerObject.cape.map = capeTexture
      playerObject.cape.visible = true
      //@ts-expect-error
      playerObject.elytra.map = capeTexture
      this.onSkinUpdate?.()

      if (!playerObject.backEquipment) {
        playerObject.backEquipment = 'cape'
      }
    } catch (error) {
      console.error('Error loading cape:', error)
    }
  }

  playAnimation (entityPlayerId, animation: 'walking' | 'running' | 'oneSwing' | 'idle') {
    const playerObject = this.getPlayerObject(entityPlayerId)
    if (!playerObject) return

    if (animation === 'oneSwing') {
      if (!(playerObject.animation instanceof WalkingGeneralSwing)) throw new Error('Expected WalkingGeneralSwing')
      playerObject.animation.swingArm()
      return
    }

    if (playerObject.animation instanceof WalkingGeneralSwing) {
      playerObject.animation.switchAnimationCallback = () => {
        if (!(playerObject.animation instanceof WalkingGeneralSwing)) throw new Error('Expected WalkingGeneralSwing')
        playerObject.animation.isMoving = animation !== 'idle'
        playerObject.animation.isRunning = animation === 'running'
      }
    }

  }

  parseEntityLabel (jsonLike) {
    if (!jsonLike) return
    try {
      if (jsonLike.type === 'string') {
        return jsonLike.value
      }
      const parsed = typeof jsonLike === 'string' ? mojangson.simplify(mojangson.parse(jsonLike)) : nbt.simplify(jsonLike)
      const text = flat(parsed).map(this.textFromComponent)
      return text.join('')
    } catch (err) {
      return jsonLike
    }
  }

  private textFromComponent (component) {
    return typeof component === 'string' ? component : component.text ?? ''
  }

  getItemMesh (item, specificProps: ItemSpecificContextProperties, previousModel?: string) {
    if (!item.nbt && item.nbtData) item.nbt = item.nbtData
    const textureUv = this.worldRenderer.getItemRenderData(item, specificProps)
    if (previousModel && previousModel === textureUv?.modelName) return undefined

    if (textureUv && 'resolvedModel' in textureUv) {
      const mesh = getBlockMeshFromModel(this.worldRenderer.material, textureUv.resolvedModel, textureUv.modelName, this.worldRenderer.resourcesManager.currentResources!.worldBlockProvider)
      let SCALE = 1
      if (specificProps['minecraft:display_context'] === 'ground') {
        SCALE = 0.5
      } else if (specificProps['minecraft:display_context'] === 'thirdperson') {
        SCALE = 6
      }
      mesh.scale.set(SCALE, SCALE, SCALE)
      const outerGroup = new THREE.Group()
      outerGroup.add(mesh)
      return {
        mesh: outerGroup,
        isBlock: true,
        itemsTexture: null,
        itemsTextureFlipped: null,
        modelName: textureUv.modelName,
      }
    }

    // TODO: Render proper model (especially for blocks) instead of flat texture
    if (textureUv) {
      const textureThree = textureUv.renderInfo?.texture === 'blocks' ? this.worldRenderer.material.map! : this.worldRenderer.itemsTexture
      // todo use geometry buffer uv instead!
      const { u, v, su, sv } = textureUv
      const size = undefined
      const itemsTexture = textureThree.clone()
      itemsTexture.flipY = true
      const sizeY = (sv ?? size)!
      const sizeX = (su ?? size)!
      itemsTexture.offset.set(u, 1 - v - sizeY)
      itemsTexture.repeat.set(sizeX, sizeY)
      itemsTexture.needsUpdate = true
      itemsTexture.magFilter = THREE.NearestFilter
      itemsTexture.minFilter = THREE.NearestFilter
      const itemsTextureFlipped = itemsTexture.clone()
      itemsTextureFlipped.repeat.x *= -1
      itemsTextureFlipped.needsUpdate = true
      itemsTextureFlipped.offset.set(u + (sizeX), 1 - v - sizeY)
      const material = new THREE.MeshStandardMaterial({
        map: itemsTexture,
        transparent: true,
        alphaTest: 0.1,
      })
      const materialFlipped = new THREE.MeshStandardMaterial({
        map: itemsTextureFlipped,
        transparent: true,
        alphaTest: 0.1,
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0), [
        // top left and right bottom are black box materials others are transparent
        new THREE.MeshBasicMaterial({ color: 0x00_00_00 }), new THREE.MeshBasicMaterial({ color: 0x00_00_00 }),
        new THREE.MeshBasicMaterial({ color: 0x00_00_00 }), new THREE.MeshBasicMaterial({ color: 0x00_00_00 }),
        material, materialFlipped,
      ])
      let SCALE = 1
      if (specificProps['minecraft:display_context'] === 'ground') {
        SCALE = 0.5
      } else if (specificProps['minecraft:display_context'] === 'thirdperson') {
        SCALE = 6
      }
      mesh.scale.set(SCALE, SCALE, SCALE)
      return {
        mesh,
        isBlock: false,
        itemsTexture,
        itemsTextureFlipped,
        modelName: textureUv.modelName,
      }
    }
  }

  setVisible (mesh: THREE.Object3D, visible: boolean) {
    //mesh.visible = visible
    //TODO: Fix workaround for visibility setting
    if (visible) {
      mesh.scale.set(1, 1, 1)
    } else {
      mesh.scale.set(0, 0, 0)
    }
  }

  update (entity: import('prismarine-entity').Entity & { delete?; pos, name }, overrides) {
    const justAdded = !this.entities[entity.id]

    // Debug logging for mid-game join issues
    if (justAdded) {
      console.log('[Entity Debug] Creating entity:', JSON.stringify({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        pos: { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z },
        hasUsername: !!entity.username
      }))
    }

    const isPlayerModel = entity.name === 'player'
    if (entity.name === 'zombie_villager' || entity.name === 'husk') {
      overrides.texture = `textures/1.16.4/entity/${entity.name === 'zombie_villager' ? 'zombie_villager/zombie_villager.png' : `zombie/${entity.name}.png`}`
    }
    if (entity.name === 'glow_item_frame') {
      if (!overrides.textures) overrides.textures = []
      overrides.textures['background'] = 'block:glow_item_frame'
    }
    // this can be undefined in case where packet entity_destroy was sent twice (so it was already deleted)
    let e = this.entities[entity.id]

    if (entity.delete) {
      if (!e) return
      if (e.additionalCleanup) e.additionalCleanup()
      e.traverse(c => {
        if (c['additionalCleanup']) c['additionalCleanup']()
      })
      this.onRemoveEntity(entity)
      this.worldRenderer.scene.remove(e)
      disposeObject(e)
      // todo dispose textures as well ?
      delete this.entities[entity.id]
      return
    }

    let mesh
    if (e === undefined) {
      const group = new THREE.Group()
      if (entity.name === 'item') {
        const item = entity.metadata?.find((m: any) => typeof m === 'object' && m?.itemCount)
        if (item) {
          const object = this.getItemMesh(item, {
            'minecraft:display_context': 'ground',
          })
          if (object) {
            mesh = object.mesh
            mesh.scale.set(0.5, 0.5, 0.5)
            mesh.position.set(0, 0.2, 0)
            // set faces
            // mesh.position.set(targetPos.x + 0.5 + 2, targetPos.y + 0.5, targetPos.z + 0.5)
            // viewer.scene.add(mesh)
            const clock = new THREE.Clock()
            mesh.onBeforeRender = () => {
              const delta = clock.getDelta()
              mesh.rotation.y += delta
            }
            //@ts-expect-error
            group.additionalCleanup = () => {
              // important: avoid texture memory leak and gpu slowdown
              object.itemsTexture?.dispose()
              object.itemsTextureFlipped?.dispose()
            }
          }
        }
      } else if (isPlayerModel) {
        // CREATE NEW PLAYER ENTITY
        const wrapper = new THREE.Group()
        const playerObject = new PlayerObject() as PlayerObjectType
        playerObject.position.set(0, 16, 0)

        // fix issues with starfield
        playerObject.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
            obj.material.transparent = true
          }
        })
        //@ts-expect-error
        wrapper.add(playerObject)
        const scale = 1 / 16
        wrapper.scale.set(scale, scale, scale)

        if (entity.username) {
          // todo proper colors
          const nameTag = new NameTagObject(fromFormattedString(entity.username).text, {
            font: `48px ${this.entitiesOptions.fontFamily}`,
          })
          nameTag.position.y = playerObject.position.y + playerObject.scale.y * 16 + 3
          nameTag.renderOrder = 1000

          //@ts-expect-error
          wrapper.add(nameTag)
        }

        //@ts-expect-error
        group.playerObject = playerObject
        wrapper.rotation.set(0, Math.PI, 0)
        mesh = wrapper
        playerObject.animation = new WalkingGeneralSwing()
        //@ts-expect-error
        playerObject.animation.isMoving = false
      } else {
        mesh = getEntityMesh(entity, this.worldRenderer, this.entitiesOptions, overrides)
      }
      if (!mesh) {
        console.warn('[Entity Debug] Failed to create mesh for entity:', {
          id: entity.id,
          name: entity.name,
          type: entity.type
        })
        return
      }
      mesh.name = 'mesh'
      // set initial position so there are no weird jumps update after
      group.position.set(entity.pos.x, entity.pos.y, entity.pos.z)

      // todo use width and height instead
      const boxHelper = new THREE.BoxHelper(
        mesh,
        entity.type === 'hostile' ? 0xff_00_00 :
          entity.type === 'mob' ? 0x00_ff_00 :
            entity.type === 'player' ? 0x00_00_ff :
              0xff_a5_00,
      )
      boxHelper.name = 'debug'
      group.add(mesh)
      group.add(boxHelper)
      boxHelper.visible = false
      this.worldRenderer.scene.add(group)

      e = group
      e.name = 'entity'
      e['realName'] = entity.name
      this.entities[entity.id] = e

      this.onAddEntity(entity)

      if (isPlayerModel) {
        this.updatePlayerSkin(entity.id, entity.username, entity.uuid, overrides?.texture || stevePngUrl)
      }
      this.setDebugMode(this.debugMode, group)
      this.setRendering(this.currentlyRendering, group)

      // Explicitly set visibility on creation to ensure entities appear when joining mid-game
      group.visible = true

      console.log('[Entity Debug] Entity created successfully:', JSON.stringify({
        id: entity.id,
        name: entity.name,
        position: { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z },
        inScene: this.worldRenderer.scene.children.includes(group),
        visible: group.visible,
        meshChildrenCount: mesh.children?.length ?? 0
      }))
    } else {
      mesh = e.children.find(c => c.name === 'mesh')
    }

    // check if entity has armor
    if (entity.equipment) {
      // Players use arm bones, other entities use bone_*item
      if (entity.type === 'player') {
        this.addPlayerHeldItem(e, 'right', entity.equipment[0])
        this.addPlayerHeldItem(e, 'left', entity.equipment[1])
      } else {
        this.addItemModel(e, 'left', entity.equipment[0])
        this.addItemModel(e, 'right', entity.equipment[1])
      }
      addArmorModel(this.worldRenderer, e, 'feet', entity.equipment[2])
      addArmorModel(this.worldRenderer, e, 'legs', entity.equipment[3], 2)
      addArmorModel(this.worldRenderer, e, 'chest', entity.equipment[4])
      addArmorModel(this.worldRenderer, e, 'head', entity.equipment[5])
    }

    const meta = getGeneralEntitiesMetadata(entity)

    //@ts-expect-error
    // set visibility
    const isInvisible = entity.metadata?.[0] & 0x20
    for (const child of mesh.children ?? []) {
      if (child.name !== 'nametag' && !(child instanceof THREE.SkeletonHelper)) {
        child.visible = !isInvisible
      }
    }

    // Debug: Log mesh children visibility
    if (justAdded) {
      const childrenInfo = mesh?.children?.map(c => `${c.name}:${c.visible}`).join(', ') ?? 'none'
      const metadata0 = entity.metadata?.[0] === undefined ? 'undefined' : JSON.stringify(entity.metadata[0])
      console.log(`[Entity Debug] ID ${entity.id} (${entity.name}) mesh children: [${childrenInfo}], isInvisible=${!!isInvisible}, metadata0=${metadata0}`)
      // Also log if entity group scale is 0 (hidden via scale hack)
      if (e.scale.x === 0 || e.scale.y === 0 || e.scale.z === 0) {
        console.warn(`[Entity Debug] ID ${entity.id} has ZERO SCALE! scale=(${e.scale.x}, ${e.scale.y}, ${e.scale.z})`)
      }
    }
    // ---
    // set baby size
    if (meta.baby) {
      e.scale.set(0.5, 0.5, 0.5)
    } else {
      e.scale.set(1, 1, 1)
    }
    // entity specific meta
    const textDisplayMeta = getSpecificEntityMetadata('text_display', entity)
    const displayTextRaw = textDisplayMeta?.text || meta.custom_name_visible && meta.custom_name
    const displayText = this.parseEntityLabel(displayTextRaw)
    if (entity.name !== 'player' && displayText) {
      const nameTagFixed = textDisplayMeta && (textDisplayMeta.billboard_render_constraints === 'fixed' || !textDisplayMeta.billboard_render_constraints)
      const nameTagBackgroundColor = textDisplayMeta && toRgba(textDisplayMeta.background_color)
      let nameTagTextOpacity: any
      if (textDisplayMeta?.text_opacity) {
        const rawOpacity = parseInt(textDisplayMeta?.text_opacity, 10)
        nameTagTextOpacity = rawOpacity > 0 ? rawOpacity : 256 - rawOpacity
      }
      addNametag(
        { ...entity, username: displayText, nameTagBackgroundColor, nameTagTextOpacity, nameTagFixed,
          nameTagScale: textDisplayMeta?.scale, nameTagTranslation: textDisplayMeta && (textDisplayMeta.translation || new THREE.Vector3(0, 0, 0)),
          nameTagRotationLeft: toQuaternion(textDisplayMeta?.left_rotation), nameTagRotationRight: toQuaternion(textDisplayMeta?.right_rotation) },
        this.entitiesOptions,
        mesh
      )
    }

    const armorStandMeta = getSpecificEntityMetadata('armor_stand', entity)
    if (armorStandMeta) {
      const isSmall = (parseInt(armorStandMeta.client_flags, 10) & 0x01) !== 0
      const hasArms = (parseInt(armorStandMeta.client_flags, 10) & 0x04) !== 0
      const hasBasePlate = (parseInt(armorStandMeta.client_flags, 10) & 0x08) === 0
      const isMarker = (parseInt(armorStandMeta.client_flags, 10) & 0x10) !== 0
      mesh.castShadow = !isMarker
      mesh.receiveShadow = !isMarker
      if (isSmall) {
        e.scale.set(0.5, 0.5, 0.5)
      } else {
        e.scale.set(1, 1, 1)
      }
      e.traverse(c => {
        switch (c.name) {
          case 'bone_baseplate':
            this.setVisible(c, hasBasePlate)
            c.rotation.y = -e.rotation.y
            break
          case 'bone_head':
            if (armorStandMeta.head_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.head_pose))
            }
            break
          case 'bone_body':
            if (armorStandMeta.body_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.body_pose))
            }
            break
          case 'bone_rightarm':
            if (c.parent?.name !== 'bone_armor') {
              this.setVisible(c, hasArms)
            }
            if (armorStandMeta.left_arm_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.left_arm_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ 'yaw': -10, 'pitch': -10, 'roll': 0 }))
            }
            break
          case 'bone_leftarm':
            if (c.parent?.name !== 'bone_armor') {
              this.setVisible(c, hasArms)
            }
            if (armorStandMeta.right_arm_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.right_arm_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ 'yaw': 10, 'pitch': -10, 'roll': 0 }))
            }
            break
          case 'bone_rightleg':
            if (armorStandMeta.left_leg_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.left_leg_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ 'yaw': -1, 'pitch': -1, 'roll': 0 }))
            }
            break
          case 'bone_leftleg':
            if (armorStandMeta.right_leg_pose) {
              c.setRotationFromEuler(poseToEuler(armorStandMeta.right_leg_pose))
            } else {
              c.setRotationFromEuler(poseToEuler({ 'yaw': 1, 'pitch': 1, 'roll': 0 }))
            }
            break
        }
      })
    }

    // todo handle map, map_chunks events
    let itemFrameMeta = getSpecificEntityMetadata('item_frame', entity)
    if (!itemFrameMeta) {
      itemFrameMeta = getSpecificEntityMetadata('glow_item_frame', entity)
    }
    if (itemFrameMeta) {
      // TODO: fix type
      // todo! fix errors in mc-data (no entities data prior 1.18.2)
      const item = (itemFrameMeta?.item ?? entity.metadata?.[8]) as any as { itemId, blockId, components, nbtData: { value: { map: { value: number } } } }
      mesh.scale.set(1, 1, 1)
      e.rotation.x = -entity.pitch
      e.children.find(c => {
        if (c.name.startsWith('map_')) {
          disposeObject(c)
          const existingMapNumber = parseInt(c.name.split('_')[1], 10)
          this.itemFrameMaps[existingMapNumber] = this.itemFrameMaps[existingMapNumber]?.filter(mesh => mesh !== c)
          if (c instanceof THREE.Mesh) {
            c.material?.map?.dispose()
          }
          return true
        } else if (c.name === 'item') {
          disposeObject(c)
          return true
        }
        return false
      })?.removeFromParent()
      if (item && (item.itemId ?? item.blockId ?? 0) !== 0) {
        const rotation = (itemFrameMeta.rotation as any as number) ?? 0
        const mapNumber = item.nbtData?.value?.map?.value ?? item.components?.find(x => x.type === 'map_id')?.data
        if (mapNumber) {
          // TODO: Use proper larger item frame model when a map exists
          mesh.scale.set(16 / 12, 16 / 12, 1)
          this.addMapModel(e, mapNumber, rotation)
        } else {
          const itemMesh = this.getItemMesh(item, {
            'minecraft:display_context': 'fixed',
          })
          if (itemMesh) {
            itemMesh.mesh.position.set(0, 0, 0.43)
            if (itemMesh.isBlock) {
              itemMesh.mesh.scale.set(0.25, 0.25, 0.25)
            } else {
              itemMesh.mesh.scale.set(0.5, 0.5, 0.5)
            }
            itemMesh.mesh.rotateY(Math.PI)
            itemMesh.mesh.rotateZ(-rotation * Math.PI / 4)
            itemMesh.mesh.name = 'item'
            e.add(itemMesh.mesh)
          }
        }
      }
    }

    if (entity.username) {
      e.username = entity.username
    }

    if (entity.type === 'player' && entity.equipment && e.playerObject) {
      const { playerObject } = e
      playerObject.backEquipment = entity.equipment.some((item) => item?.name === 'elytra') ? 'elytra' : 'cape'
      if (playerObject.cape.map === null) {
        playerObject.cape.visible = false
      }
    }

    this.updateEntityPosition(entity, justAdded, overrides)
  }

  updateEntityPosition (entity: import('prismarine-entity').Entity, justAdded: boolean, overrides: { rotation?: { head?: { y: number, x: number } } }) {
    const e = this.entities[entity.id]
    if (!e) return
    const ANIMATION_DURATION = justAdded ? 0 : TWEEN_DURATION
    const entityPos = (entity as any).position ?? (entity as any).pos
    if (entityPos) {
      new TWEEN.Tween(e.position).to({ x: entityPos.x, y: entityPos.y, z: entityPos.z }, ANIMATION_DURATION).start()
    }
    if (entity.yaw) {
      const da = (entity.yaw - e.rotation.y) % (Math.PI * 2)
      const dy = 2 * da % (Math.PI * 2) - da
      new TWEEN.Tween(e.rotation).to({ y: e.rotation.y + dy }, ANIMATION_DURATION).start()
    }

    if (e?.playerObject && overrides?.rotation?.head) {
      const playerObject = e.playerObject as PlayerObjectType
      const headRotationDiff = overrides.rotation.head.y ? overrides.rotation.head.y - entity.yaw : 0
      playerObject.skin.head.rotation.y = -headRotationDiff
      playerObject.skin.head.rotation.x = overrides.rotation.head.x ? - overrides.rotation.head.x : 0
    }

    this.maybeRenderPlayerSkin(entity)
  }

  onAddEntity (entity: import('prismarine-entity').Entity) {
  }

  loadedSkinEntityIds = new Set<number>()
  maybeRenderPlayerSkin (entity: import('prismarine-entity').Entity) {
    const mesh = this.entities[entity.id]
    if (!mesh) return
    if (!mesh.playerObject || !this.worldRenderer.worldRendererConfig.fetchPlayerSkins) return
    const MAX_DISTANCE_SKIN_LOAD = 128
    const cameraPos = this.worldRenderer.camera.position
    const distance = entity.position.distanceTo(new Vec3(cameraPos.x, cameraPos.y, cameraPos.z))
    if (distance < MAX_DISTANCE_SKIN_LOAD && distance < (this.worldRenderer.viewDistance * 16)) {
      if (this.entities[entity.id]) {
        if (this.loadedSkinEntityIds.has(entity.id)) return
        this.loadedSkinEntityIds.add(entity.id)
        this.updatePlayerSkin(entity.id, entity.username, entity.uuid, true, true)
      }
    }
  }

  // Re-evaluate skins for all player entities when agentSkinMap is updated
  reEvaluateAllPlayerSkins () {
    // console.log('[Custom Skin Debug] Re-evaluating all player skins, clearing cache')
    // Clear the cache so skins can be reloaded
    this.loadedSkinEntityIds.clear()

    // Find all player entities and update their skins
    for (const [entityId, mesh] of Object.entries(this.entities)) {
      if (mesh.playerObject) {
        // Get the entity data
        const entity = bot?.entities?.[entityId]
        if (entity?.username) {
          // console.log('[Custom Skin Debug] Re-evaluating skin for:', entity.username)
          // Force update the skin
          this.updatePlayerSkin(entity.id, entity.username, entity.uuid, true, true)
        }
      }
    }
  }

  playerPerAnimation = {} as Record<number, string>
  onRemoveEntity (entity: import('prismarine-entity').Entity) {
    this.loadedSkinEntityIds.delete(entity.id)
  }

  updateMap (mapNumber: string | number, data: string) {
    this.cachedMapsImages[mapNumber] = data
    let itemFrameMeshes = this.itemFrameMaps[mapNumber]
    if (!itemFrameMeshes) return
    itemFrameMeshes = itemFrameMeshes.filter(mesh => mesh.parent)
    this.itemFrameMaps[mapNumber] = itemFrameMeshes
    if (itemFrameMeshes) {
      for (const mesh of itemFrameMeshes) {
        mesh.material.map = this.loadMap(data)
        mesh.material.needsUpdate = true
        mesh.visible = true
      }
    }
  }

  addMapModel (entityMesh: THREE.Object3D, mapNumber: number, rotation: number) {
    const imageData = this.cachedMapsImages?.[mapNumber]
    let texture: THREE.Texture | null = null
    if (imageData) {
      texture = this.loadMap(imageData)
    }
    const parameters = {
      transparent: true,
      alphaTest: 0.1,
    }
    if (texture) {
      parameters['map'] = texture
    }
    const material = new THREE.MeshLambertMaterial(parameters)

    const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)

    mapMesh.rotation.set(0, Math.PI, 0)
    entityMesh.add(mapMesh)
    let isInvisible = true
    entityMesh.traverseVisible(c => {
      if (c.name === 'geometry_frame') {
        isInvisible = false
      }
    })
    if (isInvisible) {
      mapMesh.position.set(0, 0, 0.499)
    } else {
      mapMesh.position.set(0, 0, 0.437)
    }
    mapMesh.rotateZ(Math.PI * 2 - rotation * Math.PI / 2)
    mapMesh.name = `map_${mapNumber}`

    if (!texture) {
      mapMesh.visible = false
    }

    if (!this.itemFrameMaps[mapNumber]) {
      this.itemFrameMaps[mapNumber] = []
    }
    this.itemFrameMaps[mapNumber].push(mapMesh)
  }

  loadMap (data: any) {
    const texture = new THREE.TextureLoader().load(data)
    if (texture) {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.needsUpdate = true
    }
    return texture
  }

  updateEntityEquipment (entityId: string | number) {
    const entityMesh = this.entities[entityId]
    if (!entityMesh) return

    const entity = bot?.entities?.[entityId]
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (!entity || !entity.equipment) return

    // Players use arm bones, other entities use bone_*item
    if (entity.type === 'player') {
      this.addPlayerHeldItem(entityMesh, 'right', entity.equipment[0])
      this.addPlayerHeldItem(entityMesh, 'left', entity.equipment[1])
    } else {
      this.addItemModel(entityMesh, 'left', entity.equipment[0])
      this.addItemModel(entityMesh, 'right', entity.equipment[1])
    }

    // Update armor
    addArmorModel(this.worldRenderer, entityMesh, 'feet', entity.equipment[2])
    addArmorModel(this.worldRenderer, entityMesh, 'legs', entity.equipment[3], 2)
    addArmorModel(this.worldRenderer, entityMesh, 'chest', entity.equipment[4])
    addArmorModel(this.worldRenderer, entityMesh, 'head', entity.equipment[5])

    // Handle elytra vs cape for players
    if (entity.type === 'player' && entityMesh.playerObject) {
      entityMesh.playerObject.backEquipment = entity.equipment.some(item => item?.name === 'elytra') ? 'elytra' : 'cape'
      if (entityMesh.playerObject.cape.map === null) {
        entityMesh.playerObject.cape.visible = false
      }
    }
  }

  addPlayerHeldItem (entityMesh: SceneEntity, hand: 'left' | 'right', item: Item) {
    const armName = `${hand}Arm`

    // remove existing held item from arm (only remove items we've added, marked with isHeldItem)
    entityMesh.traverse(c => {
      if (c.parent?.name === armName && c.userData?.isHeldItem) {
        c.removeFromParent()
        if (c['additionalCleanup']) c['additionalCleanup']()
      }
    })
    if (!item) return

    const itemObject = this.getItemMesh(item, {
      'minecraft:display_context': 'thirdperson',
    })
    if (itemObject?.mesh) {
      entityMesh.traverse(c => {
        if (c.name === armName) {
          const group = new THREE.Object3D()
          group.userData.isHeldItem = true // Mark this as a held item so we can remove it later
          group['additionalCleanup'] = () => {
            itemObject.itemsTexture?.dispose()
            itemObject.itemsTextureFlipped?.dispose()
          }
          const itemMesh = itemObject.mesh

          // Position item at hand (player arms are 12 units, move down by 10 to hand position)
          // Adjust Z to center the handle in the hand grip
          group.position.set(0, -10, 5)

          group.rotation.z = -Math.PI / 16
          if (itemObject.isBlock) {
            group.rotation.y = Math.PI / 4 + Math.PI // Flip 180 degrees
          } else {
            itemMesh.rotation.z = -Math.PI / 4
            group.rotation.y = Math.PI / 2 + Math.PI // Flip 180 degrees
            group.scale.multiplyScalar(2)
          }
          group.add(itemMesh)
          c.add(group)
        }
      })
    }
  }

  addItemModel (entityMesh: SceneEntity, hand: 'left' | 'right', item: Item) {
    const parentName = `bone_${hand}item`
    // remove existing item
    entityMesh.traverse(c => {
      if (c.parent?.name.toLowerCase() === parentName) {
        c.removeFromParent()
        if (c['additionalCleanup']) c['additionalCleanup']()
      }
    })
    if (!item) return

    const itemObject = this.getItemMesh(item, {
      'minecraft:display_context': 'thirdperson',
    })
    if (itemObject?.mesh) {
      entityMesh.traverse(c => {
        if (c.name.toLowerCase() === parentName) {
          const group = new THREE.Object3D()
          group['additionalCleanup'] = () => {
            // important: avoid texture memory leak and gpu slowdown
            itemObject.itemsTexture?.dispose()
            itemObject.itemsTextureFlipped?.dispose()
          }
          const itemMesh = itemObject.mesh
          group.rotation.z = -Math.PI / 16
          if (itemObject.isBlock) {
            group.rotation.y = Math.PI / 4
          } else {
            itemMesh.rotation.z = -Math.PI / 4
            group.rotation.y = Math.PI / 2
            group.scale.multiplyScalar(2)
          }
          group.add(itemMesh)
          c.add(group)
        }
      })
    }
  }

  handleDamageEvent (entityId, damageAmount) {
    const entityMesh = this.entities[entityId]?.children.find(c => c.name === 'mesh')
    if (entityMesh) {
      entityMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const clonedMaterial = child.material.clone()
          clonedMaterial.dispose()
          child.material = child.material.clone()
          const originalColor = child.material.color.clone()
          child.material.color.set(0xff_00_00)
          new TWEEN.Tween(child.material.color)
            .to(originalColor, 500)
            .start()
        }
      })
    }
  }
}

function getGeneralEntitiesMetadata (entity: { name; metadata }): Partial<UnionToIntersection<EntityMetadataVersions[keyof EntityMetadataVersions]>> {
  const entityData = loadedData.entitiesByName[entity.name]
  return new Proxy({}, {
    get (target, p, receiver) {
      if (typeof p !== 'string' || !entityData) return
      const index = entityData.metadataKeys?.indexOf(p)
      return entity.metadata?.[index ?? -1]
    },
  })
}

function getSpecificEntityMetadata<T extends keyof EntityMetadataVersions> (name: T, entity): EntityMetadataVersions[T] | undefined {
  if (entity.name !== name) return
  return getGeneralEntitiesMetadata(entity) as any
}

// eslint-disable-next-line max-params
function addArmorModel (worldRenderer: WorldRendererThree, entityMesh: THREE.Object3D, slotType: string, item: Item, layer = 1, overlay = false) {
  if (!item) {
    removeArmorModel(entityMesh, slotType)
    return
  }
  const itemParts = item.name.split('_')
  let texturePath
  const isPlayerHead = slotType === 'head' && item.name === 'player_head'
  if (isPlayerHead) {
    removeArmorModel(entityMesh, slotType)
    if (item.nbt) {
      const itemNbt = nbt.simplify(item.nbt)
      try {
        let textureData
        if (itemNbt.SkullOwner) {
          textureData = itemNbt.SkullOwner.Properties.textures[0]?.Value
        } else {
          textureData = itemNbt['minecraft:profile']?.Properties?.find(p => p.name === 'textures')?.value
        }
        if (textureData) {
          const decodedData = JSON.parse(Buffer.from(textureData, 'base64').toString())
          texturePath = decodedData.textures?.SKIN?.url
        }
      } catch (err) {
        console.error('Error decoding player head texture:', err)
      }
    } else {
      texturePath = stevePngUrl
    }
  }
  const armorMaterial = itemParts[0]
  if (!texturePath) {
    // TODO: Support mirroring on certain parts of the model
    const armorTextureName = `${armorMaterial}_layer_${layer}${overlay ? '_overlay' : ''}`
    texturePath = worldRenderer.resourcesManager.currentResources!.customTextures.armor?.textures[armorTextureName]?.src ?? armorTextures[armorTextureName]
  }
  if (!texturePath || !armorModel[slotType]) {
    removeArmorModel(entityMesh, slotType)
    return
  }

  const meshName = `geometry_armor_${slotType}${overlay ? '_overlay' : ''}`
  let mesh = entityMesh.children.findLast(c => c.name === meshName) as THREE.Mesh
  let material
  if (mesh) {
    material = mesh.material
    loadTexture(texturePath, texture => {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.flipY = false
      texture.wrapS = THREE.MirroredRepeatWrapping
      texture.wrapT = THREE.MirroredRepeatWrapping
      material.map = texture
    })
  } else {
    mesh = getMesh(worldRenderer, texturePath, armorModel[slotType])
    mesh.name = meshName
    material = mesh.material
    if (!isPlayerHead) {
      material.side = THREE.DoubleSide
    }
  }
  if (armorMaterial === 'leather' && !overlay) {
    const color = (item.nbt?.value as any)?.display?.value?.color?.value
    if (color) {
      const r = color >> 16 & 0xff
      const g = color >> 8 & 0xff
      const b = color & 0xff
      material.color.setRGB(r / 255, g / 255, b / 255)
    } else {
      material.color.setHex(0xB5_6D_51) // default brown color
    }
    addArmorModel(worldRenderer, entityMesh, slotType, item, layer, true)
  } else {
    material.color.setHex(0xFF_FF_FF)
  }
  const group = new THREE.Object3D()
  group.name = `armor_${slotType}${overlay ? '_overlay' : ''}`
  group.add(mesh)

  const skeletonHelper = new THREE.SkeletonHelper(mesh)
  //@ts-expect-error
  skeletonHelper.material.linewidth = 2
  skeletonHelper.visible = false
  group.add(skeletonHelper)

  entityMesh.add(mesh)
}

function removeArmorModel (entityMesh: THREE.Object3D, slotType: string) {
  for (const c of entityMesh.children) {
    if (c.name === `geometry_armor_${slotType}` || c.name === `geometry_armor_${slotType}_overlay`) {
      c.removeFromParent()
    }
  }
}
