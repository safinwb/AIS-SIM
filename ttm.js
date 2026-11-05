const ttmBridge = window.ttmOutput
const ttmPanel = document.querySelector('.ttm-panel')
const ttmHost = document.getElementById('ttm-host')
const ttmPort = document.getElementById('ttm-port')
const ttmToggle = document.getElementById('ttm-toggle')
const ttmStatusText = document.getElementById('ttm-status')
const ttmTransportButtons = Array.from(ttmPanel.querySelectorAll('[data-ttm-transport]'))
const ttmModeButtons = Array.from(ttmPanel.querySelectorAll('[data-ttm-mode]'))
let ttmTransport = 'udp'
let ttmMode = 'client'
let ttmActive = false

function setTtmSelection(buttons, selected) {
  for (const button of buttons) {
    const active = button === selected
    button.classList.toggle('is-selected', active)
    button.setAttribute('aria-pressed', String(active))
  }
}

function updateTtmStatus(status) {
  ttmActive = Boolean(status.active)
  ttmToggle.classList.toggle('is-active', ttmActive)
  ttmToggle.setAttribute('aria-pressed', String(ttmActive))
  const description = status.lastError || (ttmActive
    ? `TTM ${status.transport.toUpperCase()} ${status.mode} active: ${status.host}:${status.port}${status.mode === 'server' ? ` (${status.peerCount || 0} peers)` : ''}`
    : 'Activate TTM connection')
  ttmToggle.title = description
  ttmStatusText.textContent = description
  for (const input of [ttmHost, ttmPort, ...ttmTransportButtons, ...ttmModeButtons]) input.disabled = ttmActive
}

for (const button of ttmTransportButtons) {
  button.addEventListener('click', () => {
    if (ttmActive) return
    ttmTransport = button.dataset.ttmTransport
    setTtmSelection(ttmTransportButtons, button)
  })
}
for (const button of ttmModeButtons) {
  button.addEventListener('click', () => {
    if (ttmActive) return
    ttmMode = button.dataset.ttmMode
    setTtmSelection(ttmModeButtons, button)
    ttmHost.value = ttmMode === 'server' ? '0.0.0.0' : 'localhost'
  })
}

ttmToggle.addEventListener('click', async () => {
  ttmToggle.disabled = true
  try {
    if (ttmActive) {
      updateTtmStatus(await ttmBridge.stop())
      return
    }
    const port = ttmPort.value.trim()
    if (!ttmHost.value.trim()) throw new Error('TTM host is required.')
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('TTM port must be between 1 and 65535.')
    updateTtmStatus(await ttmBridge.start({ transport: ttmTransport, mode: ttmMode, host: ttmHost.value.trim(), port }))
  } catch (error) {
    updateTtmStatus({ active: false, lastError: error.message })
  } finally {
    ttmToggle.disabled = false
  }
})
ttmBridge.onStatus(updateTtmStatus)
ttmBridge.getStatus().then(updateTtmStatus).catch((error) => {
  updateTtmStatus({ active: false, lastError: error.message })
})
