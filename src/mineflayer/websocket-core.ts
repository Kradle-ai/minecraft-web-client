import { Duplex } from 'stream'
import { UserError } from './userError'

class CustomDuplex extends Duplex {
  constructor (options, public writeAction) {
    super(options)
  }

  override _read () {}

  override _write (chunk, encoding, callback) {
    this.writeAction(chunk)
    callback()
  }
}

export const getWebsocketStream = async (host: string) => {
  const baseProtocol = location.protocol === 'https:' ? 'wss' : host.startsWith('ws://') ? 'ws' : 'wss'
  const hostClean = host.replace('ws://', '').replace('wss://', '')
  const ws = new WebSocket(`${baseProtocol}://${hostClean}`)
  ws.binaryType = 'arraybuffer'
  const clientDuplex = new CustomDuplex(undefined, data => {
    ws.send(data)
  })

  // Preserve exact WS frame ordering before feeding minecraft-protocol.
  // Async Blob conversion can otherwise reorder chunks under load.
  let messageQueue = Promise.resolve()
  ws.addEventListener('message', message => {
    messageQueue = messageQueue.then(async () => {
      let { data } = message
      if (data instanceof Blob) {
        data = await data.arrayBuffer()
      }
      const chunk = typeof data === 'string'
        ? Buffer.from(data)
        : Buffer.from(new Uint8Array(data))
      clientDuplex.push(chunk)
    }).catch((err) => {
      console.error('ws message processing error', err)
    })
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
