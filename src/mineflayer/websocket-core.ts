import { createOrderedWebSocketDuplex } from '../websocketDuplex'
import { UserError } from './userError'

export const getWebsocketStream = async (host: string) => {
  const baseProtocol = location.protocol === 'https:' ? 'wss' : host.startsWith('ws://') ? 'ws' : 'wss'
  const hostClean = host.replace('ws://', '').replace('wss://', '')
  const ws = new WebSocket(`${baseProtocol}://${hostClean}`)
  ws.binaryType = 'arraybuffer'
  const clientDuplex = createOrderedWebSocketDuplex(ws, {
    onMessageError (err) {
      console.error('ws message processing error', err)
    }
  })

  ws.addEventListener('close', () => {
    console.log('ws closed')
    clientDuplex.end()
  })

  ws.addEventListener('error', err => {
    console.log('ws error', err)
  })

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', err => {
      console.log('ws error', err)
      reject(new UserError('Failed to open websocket connection'))
    })
  })

  return {
    mineflayerStream: clientDuplex,
    ws,
  }
}
