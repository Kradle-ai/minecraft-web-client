import { Duplex } from 'stream'
import { recordWsProtocolFrame } from './protocolDebugTrace'

type InboundData = string | ArrayBuffer | Blob

class WebSocketDuplex extends Duplex {
  constructor (public writeAction: (chunk: Buffer) => void) {
    super()
  }

  override _read () {}

  override _write (chunk, encoding, callback) {
    this.writeAction(chunk as Buffer)
    callback()
  }
}

const toBuffer = async (data: InboundData): Promise<Buffer> => {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(new Uint8Array(arrayBuffer))
  }
  return Buffer.from(new Uint8Array(data))
}

export const createOrderedWebSocketDuplex = (
  ws: WebSocket,
  opts?: {
    source?: string
    onMessagePushed?: () => void
    onMessageError?: (err: unknown) => void
  }
) => {
  const duplex = new WebSocketDuplex((data) => {
    ws.send(data)
  })

  let messageQueue = Promise.resolve()
  ws.addEventListener('message', (message: MessageEvent<InboundData>) => {
    messageQueue = messageQueue.then(async () => {
      const chunk = await toBuffer(message.data)
      const source = opts?.source ?? 'unknown'
      if (typeof message.data === 'string') {
        recordWsProtocolFrame(source, 'text', message.data)
      } else {
        recordWsProtocolFrame(source, 'binary', chunk)
      }
      duplex.push(chunk)
      opts?.onMessagePushed?.()
    }).catch((err) => {
      opts?.onMessageError?.(err)
    })
  })

  return duplex
}
