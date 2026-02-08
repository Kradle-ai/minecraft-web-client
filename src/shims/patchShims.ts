import { EventEmitter } from 'events'
import { dumpProtocolDebugTrace, looksLikeProtocolParseError } from '../protocolDebugTrace'

const oldEmit = EventEmitter.prototype.emit
EventEmitter.prototype.emit = function (...args) {
  if (args[0] === 'error') {
    const err = args[1]
    const hasErrorListener = Boolean(this._events?.error)
    if (looksLikeProtocolParseError(err)) {
      dumpProtocolDebugTrace(hasErrorListener ? 'handled emitter parse error' : 'unhandled emitter parse error', err)
    }
    if (!hasErrorListener) {
      console.log('Unhandled error event', args.slice(1))
      args[1] = { message: String(args[1]) }
    }
  }
  return oldEmit.apply(this, args)
}
