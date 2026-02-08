import { EventEmitter } from 'events'
import { dumpProtocolDebugTrace } from '../protocolDebugTrace'

const oldEmit = EventEmitter.prototype.emit
EventEmitter.prototype.emit = function (...args) {
  if (args[0] === 'error' && !this._events.error) {
    const err = args[1]
    console.log('Unhandled error event', args.slice(1))
    const message = String(err?.message ?? err ?? '')
    if (message.includes('VarInt') || message.includes('custom_payload') || message.includes('buffer end')) {
      dumpProtocolDebugTrace('unhandled emitter parse error', err)
    }
    args[1] = { message: String(args[1]) }
  }
  return oldEmit.apply(this, args)
}
