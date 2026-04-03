const dgram = require('node:dgram')
const EventEmitter = require('node:events')

const DEFAULT_STATE = Object.freeze({
  active: false,
  host: null,
  lastError: null,
  localPort: null,
  mode: null,
  peerCount: 0,
  port: null
})

function onceEvent(target, eventName) {
  return new Promise((resolve) => {
    target.once(eventName, resolve)
  })
}

function safeCloseSocket(socket) {
  try {
    socket.close()
  } catch (error) {
    if (!error || error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
      throw error
    }
  }
}

class UdpTransport extends EventEmitter {
  constructor() {
    super()
    this.socket = null
    this.serverPeers = new Map()
    this.state = { ...DEFAULT_STATE }
  }

  getState() {
    return { ...this.state }
  }

  async start(config) {
    const normalizedConfig = this.normalizeConfig(config)

    if (this.state.active) {
      await this.stop()
    }

    const socket = dgram.createSocket('udp4')
    this.serverPeers.clear()
    this.attachSocketEvents(socket)

    try {
      if (normalizedConfig.mode === 'server') {
        await this.bindSocket(socket, normalizedConfig.port, normalizedConfig.host)
      } else {
        if (normalizedConfig.localPort !== null) {
          await this.bindSocket(socket, normalizedConfig.localPort)
        }

        await this.connectSocket(socket, normalizedConfig.port, normalizedConfig.host)
      }
    } catch (error) {
      safeCloseSocket(socket)
      this.state = {
        ...DEFAULT_STATE,
        lastError: error.message
      }
      this.emitStatus()
      throw error
    }

    this.socket = socket
    this.state = {
      active: true,
      host: normalizedConfig.host,
      lastError: null,
      localPort: normalizedConfig.localPort,
      mode: normalizedConfig.mode,
      peerCount: 0,
      port: normalizedConfig.port
    }
    this.emitStatus()

    return this.getState()
  }

  async stop() {
    if (!this.socket) {
      if (this.state.active) {
        this.state = { ...DEFAULT_STATE }
        this.emitStatus()
      }
      return this.getState()
    }

    const socket = this.socket
    this.socket = null

    const closePromise = onceEvent(socket, 'close')
    safeCloseSocket(socket)
    await closePromise

    this.serverPeers.clear()
    this.state = { ...DEFAULT_STATE }
    this.emitStatus()

    return this.getState()
  }

  send(message, target = {}) {
    if (!this.socket || !this.state.active) {
      throw new Error('UDP transport is not active.')
    }

    const payload = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8')

    if (this.state.mode === 'client') {
      this.socket.send(payload)
      return 1
    }

    const host = target.host || this.state.host
    const port = target.port || this.state.port

    if (target.host || target.port) {
      if (!host || !port) {
        throw new Error('Server mode send requires a target host and port.')
      }

      this.socket.send(payload, port, host)
      return 1
    }

    let sentCount = 0

    for (const peer of this.serverPeers.values()) {
      this.socket.send(payload, peer.port, peer.address)
      sentCount += 1
    }

    return sentCount
  }

  normalizeConfig(config = {}) {
    const mode = config.mode === 'server' ? 'server' : 'client'
    const port = Number.parseInt(String(config.port ?? ''), 10)
    const localPortInput = config.localPort
    const localPort = localPortInput === undefined || localPortInput === null || localPortInput === ''
      ? null
      : Number.parseInt(String(localPortInput), 10)

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('UDP port must be an integer between 1 and 65535.')
    }

    if (localPort !== null && (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)) {
      throw new Error('UDP local port must be an integer between 1 and 65535.')
    }

    if (mode === 'client') {
      const host = String(config.host || '').trim()

      if (!host) {
        throw new Error('UDP host is required in client mode.')
      }

      return {
        host,
        localPort,
        mode,
        port
      }
    }

    return {
      host: String(config.host || '0.0.0.0').trim() || '0.0.0.0',
      localPort,
      mode,
      port
    }
  }

  attachSocketEvents(socket) {
    socket.on('error', (error) => {
      this.state = {
        ...this.state,
        active: false,
        lastError: error.message,
        peerCount: 0
      }
      this.emit('transport-error', error)
      this.emitStatus()

      if (this.socket === socket) {
        this.socket = null
      }

      this.serverPeers.clear()
      safeCloseSocket(socket)
    })

    socket.on('message', (message, remoteInfo) => {
      if (this.state.mode === 'server') {
        const peerKey = `${remoteInfo.address}:${remoteInfo.port}`
        const wasKnownPeer = this.serverPeers.has(peerKey)

        this.serverPeers.set(peerKey, {
          address: remoteInfo.address,
          port: remoteInfo.port
        })

        if (!wasKnownPeer) {
          this.state = {
            ...this.state,
            peerCount: this.serverPeers.size
          }
          this.emitStatus()
        }
      }

      this.emit('message', {
        message: message.toString('utf8'),
        remoteInfo
      })
    })
  }

  bindSocket(socket, port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      socket.bind(port, host, resolve)
      socket.once('error', reject)
      socket.once('listening', () => {
        socket.removeListener('error', reject)
      })
    })
  }

  connectSocket(socket, port, host) {
    return new Promise((resolve, reject) => {
      socket.connect(port, host, (error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  emitStatus() {
    this.emit('status', this.getState())
  }
}

module.exports = UdpTransport
