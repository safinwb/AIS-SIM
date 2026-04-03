const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const UdpTransport = require('./libs/udp')

const HOST = '127.0.0.1'
const udpTransport = new UdpTransport()

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'
}

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0])
  const requestPath = decodedPath === '/' ? '/index.html' : decodedPath
  const absolutePath = path.resolve(__dirname, `.${requestPath}`)

  if (!absolutePath.startsWith(__dirname)) {
    return null
  }

  return absolutePath
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const filePath = resolveRequestPath(request.url || '/')

      if (!filePath) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      fs.readFile(filePath, (error, fileBuffer) => {
        if (error) {
          const statusCode = error.code === 'ENOENT' ? 404 : 500
          response.writeHead(statusCode)
          response.end(statusCode === 404 ? 'Not found' : 'Server error')
          return
        }

        response.writeHead(200, {
          'Content-Type': getContentType(filePath),
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        })
        response.end(fileBuffer)
      })
    })

    server.on('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine local server address.'))
        return
      }

      resolve({
        server,
        url: `http://${HOST}:${address.port}/`
      })
    })
  })
}

function createWindow(appUrl) {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadURL(appUrl)

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isReloadShortcut = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')
    const isDevToolsShortcut = input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')

    if (isReloadShortcut) {
      event.preventDefault()
      mainWindow.webContents.reload()
      return
    }

    if (isDevToolsShortcut) {
      event.preventDefault()
      mainWindow.webContents.toggleDevTools()
    }
  })
}

function broadcastUdpStatus(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('udp:status', status)
  }
}

function broadcastUdpError(error) {
  const payload = {
    message: error.message,
    name: error.name,
    stack: error.stack || null
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('udp:error', payload)
  }
}

function registerIpcHandlers() {
  ipcMain.handle('udp:get-status', () => {
    return udpTransport.getState()
  })

  ipcMain.handle('udp:start', async (_event, config) => {
    return udpTransport.start(config)
  })

  ipcMain.handle('udp:stop', async () => {
    return udpTransport.stop()
  })

  ipcMain.handle('udp:send-messages', async (_event, messages) => {
    if (!Array.isArray(messages)) {
      throw new Error('udp:send-messages expects an array of strings.')
    }

    let sent = 0

    for (const message of messages) {
      sent += udpTransport.send(message)
    }

    return {
      sent
    }
  })
}

udpTransport.on('status', (status) => {
  broadcastUdpStatus(status)
})

udpTransport.on('transport-error', (error) => {
  console.error('UDP transport error:', error)
  broadcastUdpError(error)
})

app.whenReady().then(() => {
  return startStaticServer().then(({ server, url }) => {
    Menu.setApplicationMenu(null)
    registerIpcHandlers()

    app.on('before-quit', () => {
      void udpTransport.stop()
      server.close()
    })

    createWindow(url)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url)
    })
  })
}).catch((error) => {
  console.error('Failed to start AIS Simulator:', error)
  app.quit()
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
