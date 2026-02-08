type Direction = 'in' | 'out'

type PacketTrace = {
  ts: number
  dir: Direction
  name: string
  byteLength?: number
}

type WsFrameTrace = {
  ts: number
  source: string
  kind: 'text' | 'binary'
  byteLength: number
  preview: string
}

const PACKET_RING_SIZE = 120
const WS_RING_SIZE = 80

const packetRing: PacketTrace[] = []
const wsRing: WsFrameTrace[] = []

const pushRing = <T>(ring: T[], value: T, max: number) => {
  ring.push(value)
  if (ring.length > max) ring.splice(0, ring.length - max)
}

export const recordProtocolPacket = (dir: Direction, name: string, byteLength?: number) => {
  pushRing(packetRing, {
    ts: Date.now(),
    dir,
    name,
    byteLength
  }, PACKET_RING_SIZE)
}

export const recordWsProtocolFrame = (source: string, kind: 'text' | 'binary', data: Buffer | string) => {
  const byteLength = data.length
  const preview = typeof data === 'string'
    ? data.slice(0, 96)
    : data.subarray(0, 24).toString('hex')

  pushRing(wsRing, {
    ts: Date.now(),
    source,
    kind,
    byteLength,
    preview
  }, WS_RING_SIZE)
}

const packetNameLooksRelated = (name: string) => {
  return name.includes('payload') || name.includes('custom') || name.includes('plugin')
}

export const dumpProtocolDebugTrace = (title: string, err?: unknown) => {
  const recentPackets = packetRing.slice(-40)
  const recentWsFrames = wsRing.slice(-30)

  console.group(`[protocol-debug] ${title}`)
  if (err) console.error('[protocol-debug] error:', err)
  if (recentPackets.length > 0) {
    console.log('[protocol-debug] recent packets:', recentPackets)
    const relatedPackets = recentPackets.filter(p => packetNameLooksRelated(p.name))
    if (relatedPackets.length > 0) {
      console.log('[protocol-debug] related packet subset:', relatedPackets)
    }
  } else {
    console.log('[protocol-debug] no recent packets captured')
  }
  if (recentWsFrames.length > 0) {
    console.log('[protocol-debug] recent websocket frames:', recentWsFrames)
    const textFrames = recentWsFrames.filter(frame => frame.kind === 'text')
    if (textFrames.length > 0) {
      console.warn('[protocol-debug] text frames seen on protocol stream:', textFrames)
    }
  } else {
    console.log('[protocol-debug] no recent websocket frames captured')
  }
  console.groupEnd()
}
