import { options } from './optionsStorage'

//@ts-check
const DEBUG = false
const { EventEmitter } = require('events')
const debug = require('debug')('minecraft-protocol')
const states = require('minecraft-protocol/src/states')

/**
 * Fields that minecraft-protocol's chat.js expects to be BigInt
 * for BigInt arithmetic operations (e.g., `BigInt(Date.now()) - packet.timestamp`)
 */
const BIGINT_REQUIRED_FIELDS = ['timestamp', 'salt'] // eslint-disable-line unicorn/prefer-set-has

/**
 * Convert a [high, low] int64 array (from msgpack) to BigInt
 * msgpack serializes 64-bit integers as [high32, low32] arrays
 */
function int64ArrayToBigInt(arr) {
  if (!Array.isArray(arr) || arr.length !== 2) return null
  const [high, low] = arr
  if (typeof high !== 'number' || typeof low !== 'number') return null
  // Combine high and low 32-bit parts into a 64-bit BigInt
  // high is signed, low is unsigned
  const highBigInt = BigInt(high) << 32n
  const lowBigInt = BigInt(low >>> 0) // >>> 0 converts to unsigned 32-bit
  return highBigInt | lowBigInt
}

/**
 * Recursively process data:
 * 1. Convert BigInt to Number/String for most fields (to avoid "Cannot mix BigInt" errors)
 * 2. BUT ensure timestamp/salt fields are BigInt (minecraft-protocol expects these)
 * 3. Handle msgpack's [high, low] array format for 64-bit integers
 */
function processPacketData(data, key) {
  if (data === null || data === undefined) {
    return data
  }

  // For fields that minecraft-protocol expects as BigInt, ensure they are BigInt
  if (key && BIGINT_REQUIRED_FIELDS.includes(key)) {
    if (typeof data === 'bigint') {
      return data // Already BigInt
    }
    if (typeof data === 'number' || typeof data === 'string') {
      return BigInt(data) // Convert to BigInt
    }
    // Handle msgpack's [high, low] array format for 64-bit integers
    if (Array.isArray(data) && data.length === 2) {
      const bigIntValue = int64ArrayToBigInt(data)
      if (bigIntValue !== null) {
        return bigIntValue
      }
    }
  }

  if (typeof data === 'bigint') {
    // Convert to number if safe, otherwise string
    if (data >= Number.MIN_SAFE_INTEGER && data <= Number.MAX_SAFE_INTEGER) {
      return Number(data)
    }
    return data.toString()
  }
  if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
    return data // Keep buffers as-is
  }
  if (Array.isArray(data)) {
    return data.map(item => processPacketData(item))
  }
  if (typeof data === 'object') {
    const result = {}
    for (const objKey of Object.keys(data)) {
      result[objKey] = processPacketData(data[objKey], objKey)
    }
    return result
  }
  return data
}

window.serverDataChannel ??= {}
export const customCommunication = {
  sendData(data) {
    setTimeout(() => {
      window.serverDataChannel[this.isServer ? 'emitClient' : 'emitServer'](data)
    })
  },
  receiverSetup(processData) {
    window.serverDataChannel[this.isServer ? 'emitServer' : 'emitClient'] = (data) => {
      processData(data)
    }
  }
}

class CustomChannelClient extends EventEmitter {
  constructor(isServer, version) {
    super()
    this.version = version
    this.isServer = !!isServer
    this.state = states.HANDSHAKING
  }

  get state() {
    return this.protocolState
  }

  setSerializer(state) {
    if (DEBUG) console.log('[CustomClient] setSerializer called, isServer:', this.isServer, 'state:', state)
    customCommunication.receiverSetup.call(this, (/** @type {{name, params, state?}} */parsed) => {
      if (DEBUG && parsed.name.includes('chat')) {
        console.log('[CustomClient] RECEIVED packet:', parsed.name, 'isServer:', this.isServer)
        console.log('[CustomClient] params keys:', Object.keys(parsed.params || {}))
        if (parsed.params?.timestamp !== undefined) {
          console.log('[CustomClient] timestamp:', typeof parsed.params.timestamp, parsed.params.timestamp)
        }
        if (parsed.params?.salt !== undefined) {
          console.log('[CustomClient] salt:', typeof parsed.params.salt, parsed.params.salt)
        }
      }

      if (!options.excludeCommunicationDebugEvents.includes(parsed.name)) {
        debug(`receive in ${this.isServer ? 'server' : 'client'}: ${parsed.name}`)
      }

      // Process packet data:
      // 1. Convert most BigInt to Number/String to avoid "Cannot mix BigInt" errors
      // 2. But ensure timestamp/salt are BigInt (minecraft-protocol's chat.js expects these)
      const safeParams = processPacketData(parsed.params)

      if (DEBUG && parsed.name.includes('chat')) {
        console.log('[CustomClient] AFTER processPacketData:', parsed.name)
        if (safeParams?.timestamp !== undefined) {
          console.log('[CustomClient] processed timestamp:', typeof safeParams.timestamp, safeParams.timestamp)
        }
        if (safeParams?.salt !== undefined) {
          console.log('[CustomClient] processed salt:', typeof safeParams.salt, safeParams.salt)
        }
      }

      this.emit(parsed.name, safeParams, { ...parsed, params: safeParams })
      this.emit('packet_name', parsed.name, safeParams, { ...parsed, params: safeParams })
    })
  }

  // eslint-disable-next-line @typescript-eslint/adjacent-overload-signatures, grouped-accessor-pairs
  set state(newProperty) {
    const oldProperty = this.protocolState
    this.protocolState = newProperty

    this.setSerializer(this.protocolState)

    this.emit('state', newProperty, oldProperty)
  }

  end(reason) {
    this._endReason = reason
    this.emit('end', this._endReason) // still emits on server side only, doesn't send anything to our client
  }

  write(name, params) {
    if (!options.excludeCommunicationDebugEvents.includes(name)) {
      debug(`[${this.state}] from ${this.isServer ? 'server' : 'client'}: ` + name)
      debug(params)
    }

    this.emit('writePacket', name, params)
    customCommunication.sendData.call(this, { name, params, state: this.state })
  }

  writeBundle(packets) {
    // no-op
  }

  writeRaw(buffer) {
    // no-op
  }
}

export default CustomChannelClient
