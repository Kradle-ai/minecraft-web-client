import { EventEmitter } from 'events'

const oldEmit = EventEmitter.prototype.emit
EventEmitter.prototype.emit = function (...args) {
  if (args[0] === 'error' && !this._events.error) {
    console.log('Unhandled error event', args.slice(1))
    args[1] = { message: String(args[1]) }
  }
  return oldEmit.apply(this, args)
}
