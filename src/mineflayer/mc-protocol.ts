import { Client } from 'minecraft-protocol'
import { appQueryParams } from '../appParams'
import { downloadAllMinecraftData, getVersionAutoSelect } from '../connect'
import { gameAdditionalState } from '../globalState'
import { dumpProtocolDebugTrace, recordProtocolPacket } from '../protocolDebugTrace'
import { pingServerVersion, validatePacket } from './minecraft-protocol-extra'
import { getWebsocketStream } from './websocket-core'

let lastPacketTime = 0
customEvents.on('mineflayerBotCreated', () => {
  // todo move more code here
  if (!appQueryParams.noPacketsValidation) {
    (bot._client as unknown as Client).on('packet', (data, packetMeta, buffer, fullBuffer) => {
      recordProtocolPacket('in', packetMeta.name, fullBuffer?.length)
      validatePacket(packetMeta.name, data, fullBuffer, true)
      lastPacketTime = performance.now()
    });
    (bot._client as unknown as Client).on('writePacket', (name, params) => {
      recordProtocolPacket('out', name)
      validatePacket(name, params, Buffer.alloc(0), false)
    })
  }

  // Always trace protocol decoder errors to correlate with websocket frame history.
  (bot._client as unknown as Client).on('error', (err: any) => {
    const message = String(err?.message ?? err ?? '')
    if (message.includes('VarInt') || message.includes('custom_payload') || message.includes('buffer end')) {
      dumpProtocolDebugTrace('minecraft-protocol parse error', err)
    } else {
      dumpProtocolDebugTrace('minecraft-protocol client error', err)
    }
  })
})

setInterval(() => {
  if (!bot || !lastPacketTime) return
  if (bot.player?.ping > 500) { // TODO: we cant rely on server ping 1. weird calculations 2. available with delays instead patch minecraft-protocol to get latency of keep_alive packet
    gameAdditionalState.poorConnection = true
  } else {
    gameAdditionalState.poorConnection = false
  }
  if (performance.now() - lastPacketTime < 2000) {
    gameAdditionalState.noConnection = false
    return
  }
  gameAdditionalState.noConnection = true
}, 1000)


export const getServerInfo = async (ip: string, port?: number, preferredVersion = getVersionAutoSelect(), ping = false) => {
  await downloadAllMinecraftData()
  const isWebSocket = ip.startsWith('ws://') || ip.startsWith('wss://')
  let stream
  if (isWebSocket) {
    stream = (await getWebsocketStream(ip)).mineflayerStream
  }
  return pingServerVersion(ip, port, {
    ...(stream ? { stream } : {}),
    ...(ping ? { noPongTimeout: 3000 } : {}),
    ...(preferredVersion ? { version: preferredVersion } : {}),
  })
}
