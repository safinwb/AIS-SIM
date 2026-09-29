const net = require('node:net')
const EventEmitter = require('node:events')

class TcpTransport extends EventEmitter {
  constructor() {
    super()
    this.server = null
    this.client = null
    this.peers = new Set()
    this.state = { active: false, host: null, port: null, mode: null, peerCount: 0, lastError: null }
  }

  getState() { return { ...this.state } }

  emitStatus() { this.emit('status', this.getState()) }

  async start(config = {}) {
    await this.stop()
    const mode = config.mode === 'server' ? 'server' : 'client'
    const host = String(config.host || (mode === 'server' ? '0.0.0.0' : '')).trim()
    const port = Number(config.port)
    if (!host) throw new Error('TCP host is required.')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TCP port must be between 1 and 65535.')

    try {
      if (mode === 'server') {
        const server = net.createServer((socket) => {
          this.peers.add(socket)
          this.state.peerCount = this.peers.size
          this.emitStatus()
          socket.on('error', (error) => this.emit('transport-error', error))
          socket.on('close', () => {
            this.peers.delete(socket)
            this.state.peerCount = this.peers.size
            this.emitStatus()
          })
        })
        server.on('error', (error) => this.handleError(error))
        await new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, host, () => { server.removeListener('error', reject); resolve() })
        })
        this.server = server
      } else {
        const socket = net.createConnection({ host, port })
        await new Promise((resolve, reject) => {
          socket.once('error', reject)
          socket.once('connect', () => { socket.removeListener('error', reject); resolve() })
        })
        this.client = socket
        socket.on('error', (error) => this.handleError(error))
        socket.on('close', () => {
          if (this.client === socket) {
            this.client = null
            this.state.active = false
            this.emitStatus()
          }
        })
      }
    } catch (error) {
      this.state.lastError = error.message
      this.emitStatus()
      throw error
    }
    this.state = { active: true, host, port, mode, peerCount: this.peers.size, lastError: null }
    this.emitStatus()
    return this.getState()
  }

  handleError(error) {
    this.state.lastError = error.message
    this.state.active = false
    this.emit('transport-error', error)
    this.emitStatus()
  }

  async stop() {
    if (this.client) { this.client.destroy(); this.client = null }
    for (const socket of this.peers) socket.destroy()
    this.peers.clear()
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise((resolve) => server.close(resolve))
    }
    this.state = { active: false, host: null, port: null, mode: null, peerCount: 0, lastError: null }
    this.emitStatus()
    return this.getState()
  }

  send(message) {
    if (!this.state.active) throw new Error('TCP transport is not active.')
    const payload = String(message)
    if (this.state.mode === 'client') {
      this.client.write(payload)
      return 1
    }
    for (const peer of this.peers) peer.write(payload)
    return this.peers.size
  }
}

module.exports = TcpTransport
