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
let lastDumpFingerprint = ''
let lastDumpAt = 0

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

export const looksLikeProtocolParseError = (err: unknown) => {
  const message = String((err as any)?.message ?? err ?? '')
  return message.includes('VarInt') || message.includes('custom_payload') || message.includes('buffer end')
}

export const dumpProtocolDebugTrace = (title: string, err?: unknown) => {
  const recentPackets = packetRing.slice(-40)
  const recentWsFrames = wsRing.slice(-30)
  const errMessage = String((err as any)?.message ?? err ?? '')
  const fingerprint = `${title}|${errMessage}`
  const now = Date.now()
  // Avoid printing the same dump repeatedly in tight loops.
  if (fingerprint === lastDumpFingerprint && now - lastDumpAt < 1500) return
  lastDumpFingerprint = fingerprint
  lastDumpAt = now

  const prefix = `[protocol-debug] ${title}`
  console.error(`${prefix} BEGIN`)
  if (err) console.error(`${prefix} error:`, err)
  if (recentPackets.length > 0) {
    console.log(`${prefix} recent packets (${recentPackets.length}):`, recentPackets)
    const relatedPackets = recentPackets.filter(p => packetNameLooksRelated(p.name))
    if (relatedPackets.length > 0) {
      console.log(`${prefix} related packet subset (${relatedPackets.length}):`, relatedPackets)
    }
  } else {
    console.log(`${prefix} no recent packets captured`)
  }
  if (recentWsFrames.length > 0) {
    console.log(`${prefix} recent websocket frames (${recentWsFrames.length}):`, recentWsFrames)
    const textFrames = recentWsFrames.filter(frame => frame.kind === 'text')
    if (textFrames.length > 0) {
      console.warn(`${prefix} text frames seen on protocol stream:`, textFrames)
    }
  } else {
    console.log(`${prefix} no recent websocket frames captured`)
  }
  console.error(`${prefix} END`)
}
