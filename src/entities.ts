import { Entity } from 'prismarine-entity'
import { versionToNumber } from 'renderer/viewer/common/utils'
import { getThreeJsRendererMethods } from 'renderer/viewer/three/threeJsMethods'

customEvents.on('gameLoaded', () => {
  const entityData = (e: Entity) => {
    if (!e.username) return
    window.debugEntityMetadata ??= {}
    window.debugEntityMetadata[e.username] = e
  }

  bot.on('entitySwingArm', (e) => {
    getThreeJsRendererMethods()?.playEntityAnimation(e.id, 'oneSwing')
  })

  bot._client.on('damage_event', (data) => {
    const { entityId, sourceTypeId: damage } = data
    getThreeJsRendererMethods()?.damageEntity(entityId, damage)
  })

  bot._client.on('entity_status', (data) => {
    if (versionToNumber(bot.version) >= versionToNumber('1.19.4')) return
    const { entityId, entityStatus } = data
    if (entityStatus === 2) {
      getThreeJsRendererMethods()?.damageEntity(entityId, entityStatus)
    }
  })

  bot.on('entityMoved', (e) => {
    entityData(e)
  })

  for (const entity of Object.values(bot.entities)) {
    if (entity !== bot.entity) {
      entityData(entity)
    }
  }

  bot.on('entitySpawn', entityData)
  bot.on('entityUpdate', entityData)
  bot.on('entityEquip', (entity) => {
    entityData(entity)
    getThreeJsRendererMethods()?.updateEntityEquipment(entity.id)
  })

  // Texture override from packet properties
  bot._client.on('player_info', (packet) => {
    for (const playerEntry of packet.data) {
      if (!playerEntry.player && !playerEntry.properties) continue
      let textureProperty = playerEntry.properties?.find(prop => prop?.name === 'textures')
      if (!textureProperty) {
        textureProperty = playerEntry.player?.properties?.find(prop => prop?.key === 'textures')
      }
      if (textureProperty) {
        try {
          const textureData = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString())
          const skinUrl = textureData.textures?.SKIN?.url
          const capeUrl = textureData.textures?.CAPE?.url

          // Find entity with matching UUID and update skin
          let entityId = ''
          for (const [entId, entity] of Object.entries(bot.entities)) {
            if (entity.uuid === playerEntry.uuid) {
              entityId = entId
              break
            }
          }
          // even if not found, still record to cache
          getThreeJsRendererMethods()?.updatePlayerSkin(entityId, playerEntry.player?.name, playerEntry.uuid, skinUrl, capeUrl)
        } catch (err) {
          console.error('Error decoding player texture:', err)
        }
      }
    }

  })
})
