const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('udpTransport', {
  getStatus() {
    return ipcRenderer.invoke('udp:get-status')
  },
  start(config) {
    return ipcRenderer.invoke('udp:start', config)
  },
  stop() {
    return ipcRenderer.invoke('udp:stop')
  },
  sendMessages(messages) {
    return ipcRenderer.invoke('udp:send-messages', messages)
  },
  onError(listener) {
    const wrappedListener = (_event, error) => {
      listener(error)
    }

    ipcRenderer.on('udp:error', wrappedListener)

    return () => {
      ipcRenderer.removeListener('udp:error', wrappedListener)
    }
  },
  onStatusChange(listener) {
    const wrappedListener = (_event, status) => {
      listener(status)
    }

    ipcRenderer.on('udp:status', wrappedListener)

    return () => {
      ipcRenderer.removeListener('udp:status', wrappedListener)
    }
  }
})
