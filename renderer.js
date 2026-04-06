const INITIAL_VIEW = {
  latitude: 25.2854,
  longitude: 55.3126,
  zoom: 11
}

const DEFAULT_UDP_SETTINGS = {
  client: {
    ip: 'localhost',
    port: '9200'
  },
  server: {
    ip: '0.0.0.0',
    port: '9200'
  }
}

const SIMULATION_STEP_MS = 250
const mapElement = document.getElementById('map')
const contextMenuElement = document.getElementById('map-context-menu')
const vesselModalElement = document.getElementById('vessel-modal')
const vesselFormElement = document.getElementById('vessel-form')
const vesselCancelButton = document.getElementById('vessel-cancel')
const vesselIdInput = document.getElementById('vessel-id')
const vesselNameInput = document.getElementById('vessel-name')
const vesselMmsiInput = document.getElementById('vessel-mmsi')
const vesselDestinationInput = document.getElementById('vessel-destination')
const vesselLatitudeInput = document.getElementById('vessel-latitude')
const vesselLongitudeInput = document.getElementById('vessel-longitude')
const vesselSogInput = document.getElementById('vessel-sog')
const vesselMessageRateInput = document.getElementById('vessel-message-rate')
const vesselCogInput = document.getElementById('vessel-cog')
const vesselHeadingInput = document.getElementById('vessel-heading')
const udpIpInput = document.getElementById('udp-ip')
const udpPortInput = document.getElementById('udp-port')
const udpToggleButton = document.getElementById('udp-toggle')
const udpModeButtons = Array.from(document.querySelectorAll('.udp-mode-button'))

if (
  !mapElement ||
  !contextMenuElement ||
  !vesselModalElement ||
  !vesselFormElement ||
  !vesselCancelButton ||
  !vesselIdInput ||
  !vesselNameInput ||
  !vesselMmsiInput ||
  !vesselDestinationInput ||
  !vesselLatitudeInput ||
  !vesselLongitudeInput ||
  !vesselSogInput ||
  !vesselMessageRateInput ||
  !vesselCogInput ||
  !vesselHeadingInput
) {
  throw new Error('Map container, modal, or context menu was not found.')
}

if (!udpIpInput || !udpPortInput || !udpToggleButton || udpModeButtons.length !== 2) {
  throw new Error('UDP connection controls were not found.')
}

if (typeof window.L === 'undefined') {
  throw new Error('Leaflet failed to load before renderer initialization.')
}

if (typeof window.Vessel === 'undefined') {
  throw new Error('Vessel model is not available in the renderer.')
}

if (typeof window.AisEncoder === 'undefined') {
  throw new Error('AIS encoder is not available in the renderer.')
}

if (!window.udpTransport) {
  throw new Error('UDP transport bridge is not available.')
}

const vesselMarkers = new Map()
const vessels = new Map()
const draggingVesselIds = new Set()
const lastAisTransmitAt = new Map()
const pendingAisTransmitIds = new Set()

let contextMenuState = null
let currentUdpStatus = {
  active: false,
  host: null,
  lastError: null,
  localPort: null,
  mode: null,
  port: null
}
let selectedUdpMode = 'client'

const map = window.L.map(mapElement, {
  zoomControl: false,
  scrollWheelZoom: false,
  smoothWheelZoom: true,
  smoothSensitivity: 1
}).setView([INITIAL_VIEW.latitude, INITIAL_VIEW.longitude], INITIAL_VIEW.zoom)

window.addEventListener('resize', () => {
  window.requestAnimationFrame(() => {
    map.invalidateSize()
  })
})

window.L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>',
  referrerPolicy: 'strict-origin-when-cross-origin'
}).addTo(map)

const vesselIcon = window.L.divIcon({
  className: 'vessel-marker-icon',
  html: '<div class="vessel-marker-shell"><img src="./assets/icons/target.png" alt=""></div>',
  iconAnchor: [18, 18],
  iconSize: [36, 36]
})

function applyUdpDefaults(mode) {
  const defaults = DEFAULT_UDP_SETTINGS[mode]
  udpIpInput.value = defaults.ip
  udpPortInput.value = defaults.port
}

function setUdpInputsDisabled(isDisabled) {
  udpIpInput.disabled = isDisabled
  udpPortInput.disabled = isDisabled

  for (const button of udpModeButtons) {
    button.disabled = isDisabled
  }
}

function resetUdpValidationState() {
  udpIpInput.removeAttribute('aria-invalid')
  udpPortInput.removeAttribute('aria-invalid')
}

function markUdpFieldInvalid(input, message) {
  input.setAttribute('aria-invalid', 'true')
  input.focus()
  udpToggleButton.title = message
}

function updateUdpButtonState(status) {
  currentUdpStatus = {
    ...currentUdpStatus,
    ...status
  }

  const isActive = Boolean(status.active)
  udpToggleButton.classList.toggle('is-active', isActive)
  udpToggleButton.setAttribute('aria-pressed', String(isActive))
  setUdpInputsDisabled(isActive)

  if (status.lastError) {
    udpToggleButton.title = status.lastError
    return
  }

  if (isActive) {
    udpToggleButton.title = `UDP ${status.mode || selectedUdpMode} active: ${status.host}:${status.port}`
    return
  }

  if (!isActive) {
    for (const vesselId of vessels.keys()) {
      lastAisTransmitAt.set(vesselId, 0)
    }
  }

  udpToggleButton.title = 'Activate UDP connection'
}

function setUdpMode(mode, { applyDefaults = false } = {}) {
  selectedUdpMode = mode === 'server' ? 'server' : 'client'

  for (const button of udpModeButtons) {
    const isSelected = button.dataset.mode === selectedUdpMode
    button.classList.toggle('is-selected', isSelected)
    button.setAttribute('aria-pressed', String(isSelected))
  }

  if (applyDefaults) {
    applyUdpDefaults(selectedUdpMode)
  }
}

function getUdpConfigFromInputs() {
  const host = udpIpInput.value.trim()
  const port = udpPortInput.value.trim()

  resetUdpValidationState()

  if (!host) {
    markUdpFieldInvalid(udpIpInput, 'IP address is required.')
    return null
  }

  if (!/^\d+$/.test(port)) {
    markUdpFieldInvalid(udpPortInput, 'Port must be numeric.')
    return null
  }

  return {
    host,
    mode: selectedUdpMode,
    port
  }
}

function createContextMenuButton(label, onClick, tone = 'default') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `map-context-menu-item${tone === 'danger' ? ' is-danger' : ''}`
  button.textContent = label
  button.addEventListener('click', () => {
    onClick()
    hideContextMenu()
  })
  return button
}

function hideContextMenu() {
  contextMenuElement.innerHTML = ''
  contextMenuElement.classList.remove('is-visible')
  contextMenuElement.setAttribute('aria-hidden', 'true')
  contextMenuState = null
}

function showContextMenu({ latlng, point, vesselId = null }) {
  contextMenuElement.innerHTML = ''
  contextMenuState = { latlng, vesselId }

  if (vesselId) {
    const vessel = vessels.get(vesselId)
    if (vessel) {
      contextMenuElement.appendChild(createContextMenuButton(`Edit ${vessel.name}`, () => {
        openVesselModal(vesselId)
      }))
      contextMenuElement.appendChild(createContextMenuButton(`Delete ${vessel.name}`, () => {
        removeVessel(vesselId)
      }, 'danger'))
    }
  } else {
    contextMenuElement.appendChild(createContextMenuButton('Add Vessel', () => {
      addRandomVessel(latlng)
    }))
  }

  contextMenuElement.style.left = `${point.x}px`
  contextMenuElement.style.top = `${point.y}px`
  contextMenuElement.classList.add('is-visible')
  contextMenuElement.setAttribute('aria-hidden', 'false')
}

function isModalOpen() {
  return vesselModalElement.classList.contains('is-visible')
}

function closeVesselModal() {
  vesselModalElement.classList.remove('is-visible')
  vesselModalElement.setAttribute('aria-hidden', 'true')
  vesselFormElement.reset()
  vesselIdInput.value = ''
}

function openVesselModal(vesselId) {
  const vessel = vessels.get(vesselId)

  if (!vessel) {
    return
  }

  const summary = vessel.toSummary()
  vesselIdInput.value = vessel.id
  vesselNameInput.value = summary.name
  vesselMmsiInput.value = summary.mmsi
  vesselDestinationInput.value = summary.destination || ''
  vesselLatitudeInput.value = summary.latitude.toFixed(6)
  vesselLongitudeInput.value = summary.longitude.toFixed(6)
  vesselSogInput.value = summary.sog.toFixed(1)
  vesselMessageRateInput.value = summary.messageRateHz.toFixed(1)
  vesselCogInput.value = summary.cog.toFixed(1)
  vesselHeadingInput.value = summary.heading.toFixed(1)
  vesselModalElement.classList.add('is-visible')
  vesselModalElement.setAttribute('aria-hidden', 'false')
  vesselNameInput.focus()
  vesselNameInput.select()
}

function syncActiveVesselModal(vessel) {
  if (vesselIdInput.value !== vessel.id) {
    return
  }

  vesselLatitudeInput.value = vessel.latitude.toFixed(6)
  vesselLongitudeInput.value = vessel.longitude.toFixed(6)
  vesselSogInput.value = vessel.sog.toFixed(1)
  vesselMessageRateInput.value = vessel.messageRateHz.toFixed(1)
  vesselCogInput.value = vessel.cog.toFixed(1)
  vesselHeadingInput.value = vessel.heading.toFixed(1)
}

function updateMarkerHeading(marker, heading) {
  const element = marker.getElement()
  if (!element) {
    return
  }

  const shell = element.querySelector('.vessel-marker-shell')
  if (shell) {
    shell.style.setProperty('--vessel-heading', `${heading}deg`)
  }
}

function formatVesselPopup(vessel) {
  const summary = vessel.toSummary()

  return [
    `<strong>${summary.name}</strong>`,
    `MMSI ${summary.mmsi}`,
    `Destination ${summary.destination || 'N/A'}`,
    `SOG ${summary.sog.toFixed(1)} kn`,
    `Rate ${summary.messageRateHz.toFixed(1)} Hz`,
    `HDG ${Math.round(summary.heading)}°`,
    `COG ${Math.round(summary.cog)}°`
  ].join('<br>')
}

function addRandomVessel(latlng) {
  const vessel = window.Vessel.createRandom({
    latitude: latlng.lat,
    longitude: latlng.lng
  })

  const marker = window.L.marker(vessel.getLatLng(), {
    draggable: true,
    icon: vesselIcon
  }).addTo(map)

  marker.bindPopup(formatVesselPopup(vessel), {
    offset: [0, -12]
  })
  marker.on('click', () => {
    hideContextMenu()
  })
  marker.on('dragstart', () => {
    draggingVesselIds.add(vessel.id)
    hideContextMenu()
  })
  marker.on('dragend', () => {
    const nextLatLng = marker.getLatLng()

    vessel.applyUpdates({
      latitude: Number(nextLatLng.lat.toFixed(6)),
      longitude: Number(nextLatLng.lng.toFixed(6))
    })

    marker.setPopupContent(formatVesselPopup(vessel))
    syncActiveVesselModal(vessel)
    draggingVesselIds.delete(vessel.id)
  })
  marker.on('contextmenu', (event) => {
    if (event.originalEvent) {
      window.L.DomEvent.stop(event.originalEvent)
    }

    showContextMenu({
      latlng: event.latlng,
      point: event.containerPoint,
      vesselId: vessel.id
    })
  })

  vessels.set(vessel.id, vessel)
  vesselMarkers.set(vessel.id, marker)
  lastAisTransmitAt.set(vessel.id, 0)
  updateMarkerHeading(marker, vessel.heading)
}

function removeVessel(vesselId) {
  if (vesselIdInput.value === vesselId) {
    closeVesselModal()
  }

  const marker = vesselMarkers.get(vesselId)

  if (marker) {
    marker.remove()
  }

  vesselMarkers.delete(vesselId)
  vessels.delete(vesselId)
  lastAisTransmitAt.delete(vesselId)
}

function normalizeAngle(value) {
  const angle = Number.parseFloat(value)

  if (!Number.isFinite(angle)) {
    return null
  }

  const normalized = ((angle % 360) + 360) % 360
  return Number(normalized.toFixed(1))
}

function mirrorAngleInputValue(sourceInput, targetInput) {
  targetInput.value = sourceInput.value
}

function syncPairedAngleInputs(sourceInput, targetInput) {
  sourceInput.addEventListener('input', () => {
    mirrorAngleInputValue(sourceInput, targetInput)
  })

  sourceInput.addEventListener('change', () => {
    const normalized = normalizeAngle(sourceInput.value)

    if (normalized === null) {
      mirrorAngleInputValue(sourceInput, targetInput)
      return
    }

    const normalizedValue = normalized.toFixed(1)
    sourceInput.value = normalizedValue
    targetInput.value = normalizedValue
  })
}

function parseVesselFormValues() {
  const name = vesselNameInput.value.trim()
  const mmsi = vesselMmsiInput.value.trim()
  const destination = vesselDestinationInput.value.trim()
  const latitude = Number.parseFloat(vesselLatitudeInput.value)
  const longitude = Number.parseFloat(vesselLongitudeInput.value)
  const sog = Number.parseFloat(vesselSogInput.value)
  const messageRateHz = Number.parseFloat(vesselMessageRateInput.value)
  const cog = normalizeAngle(vesselCogInput.value)
  const heading = normalizeAngle(vesselHeadingInput.value)

  if (!name) {
    throw new Error('Vessel name is required.')
  }

  if (!/^\d{9}$/.test(mmsi)) {
    throw new Error('MMSI must be a 9-digit number.')
  }

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be between -90 and 90.')
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be between -180 and 180.')
  }

  if (!Number.isFinite(sog) || sog < 0) {
    throw new Error('Speed must be 0 or greater.')
  }

  if (!Number.isFinite(messageRateHz) || messageRateHz <= 0) {
    throw new Error('Message rate must be greater than 0 Hz.')
  }

  if (cog === null || heading === null) {
    throw new Error('COG and heading must be valid numbers.')
  }

  return {
    cog,
    destination,
    heading,
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    messageRateHz: Number(messageRateHz.toFixed(1)),
    mmsi,
    name,
    sog: Number(sog.toFixed(1))
  }
}

function applyVesselUpdates(vesselId, updates) {
  const vessel = vessels.get(vesselId)
  const marker = vesselMarkers.get(vesselId)

  if (!vessel || !marker) {
    return
  }

  vessel.applyUpdates(updates)
  marker.setLatLng(vessel.getLatLng())
  updateMarkerHeading(marker, vessel.heading)
  marker.setPopupContent(formatVesselPopup(vessel))
  syncActiveVesselModal(vessel)
  lastAisTransmitAt.set(vesselId, 0)
}

async function transmitAisForVessel(vesselId, vessel) {
  pendingAisTransmitIds.add(vesselId)
  const sentences = window.AisEncoder.encodePositionReport(vessel)
  const payload = sentences.map((sentence) => `${sentence}\r\n`)

  try {
    const result = await window.udpTransport.sendMessages(payload)

    if (result.sent > 0) {
      lastAisTransmitAt.set(vesselId, Date.now())
    }
  } finally {
    pendingAisTransmitIds.delete(vesselId)
  }
}

function shouldTransmitAis(vesselId, currentTimeMs) {
  if (!currentUdpStatus.active) {
    return false
  }

  if (currentUdpStatus.mode === 'server' && (!currentUdpStatus.peerCount || currentUdpStatus.peerCount < 1)) {
    return false
  }

  if (pendingAisTransmitIds.has(vesselId)) {
    return false
  }

  const lastTransmitAt = lastAisTransmitAt.get(vesselId) || 0
  const vessel = vessels.get(vesselId)

  if (!vessel) {
    return false
  }

  const rateHz = Number.isFinite(vessel.messageRateHz) && vessel.messageRateHz > 0
    ? vessel.messageRateHz
    : 1
  const transmitIntervalMs = 1000 / rateHz

  return currentTimeMs - lastTransmitAt >= transmitIntervalMs
}

function maybeTransmitAis(currentTimeMs) {
  for (const [vesselId, vessel] of vessels.entries()) {
    if (!shouldTransmitAis(vesselId, currentTimeMs)) {
      continue
    }

    transmitAisForVessel(vesselId, vessel).catch((error) => {
      console.error(`AIS transmit failed for vessel ${vesselId}:`, error)
      updateUdpButtonState({
        active: currentUdpStatus.active,
        host: currentUdpStatus.host,
        lastError: error.message || 'AIS transmit failed.',
        mode: currentUdpStatus.mode,
        port: currentUdpStatus.port
      })
    })
  }
}

function tickSimulation(deltaSeconds) {
  for (const [vesselId, vessel] of vessels.entries()) {
    if (draggingVesselIds.has(vesselId)) {
      continue
    }

    vessel.updatePosition(deltaSeconds)
    const marker = vesselMarkers.get(vesselId)

    if (!marker) {
      continue
    }

    marker.setLatLng(vessel.getLatLng())
    updateMarkerHeading(marker, vessel.heading)

    if (marker.isPopupOpen()) {
      marker.setPopupContent(formatVesselPopup(vessel))
    }
  }

  maybeTransmitAis(Date.now())
}

for (const button of udpModeButtons) {
  button.addEventListener('click', () => {
    if (udpToggleButton.classList.contains('is-active')) {
      return
    }

    setUdpMode(button.dataset.mode, { applyDefaults: true })
  })
}

udpToggleButton.addEventListener('click', async () => {
  udpToggleButton.disabled = true

  try {
    if (udpToggleButton.classList.contains('is-active')) {
      const status = await window.udpTransport.stop()
      updateUdpButtonState(status)
      return
    }

    const config = getUdpConfigFromInputs()

    if (!config) {
      return
    }

    const status = await window.udpTransport.start(config)
    updateUdpButtonState(status)
  } catch (error) {
    console.error('UDP connection error:', error)
    updateUdpButtonState({
      active: false,
      lastError: error.message || 'UDP connection failed.'
    })
  } finally {
    udpToggleButton.disabled = false
  }
})

map.on('contextmenu', (event) => {
  showContextMenu({
    latlng: event.latlng,
    point: event.containerPoint
  })
})

map.on('click', () => {
  hideContextMenu()
})

map.on('movestart', () => {
  hideContextMenu()
})

map.on('zoomstart', () => {
  hideContextMenu()
})

document.addEventListener('click', (event) => {
  if (!contextMenuElement.contains(event.target)) {
    hideContextMenu()
  }
})

vesselCancelButton.addEventListener('click', () => {
  closeVesselModal()
})

syncPairedAngleInputs(vesselCogInput, vesselHeadingInput)
syncPairedAngleInputs(vesselHeadingInput, vesselCogInput)

vesselFormElement.addEventListener('submit', (event) => {
  event.preventDefault()

  try {
    const vesselId = vesselIdInput.value
    const updates = parseVesselFormValues()
    applyVesselUpdates(vesselId, updates)
    closeVesselModal()
  } catch (error) {
    window.alert(error.message || 'Unable to update vessel.')
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (isModalOpen()) {
      closeVesselModal()
      return
    }

    hideContextMenu()
  }
})

window.udpTransport.onStatusChange((status) => {
  if (status.mode) {
    setUdpMode(status.mode)
  }

  updateUdpButtonState(status)
})

window.udpTransport.onError((error) => {
  console.error('UDP transport error:', error)
})

setUdpMode(selectedUdpMode, { applyDefaults: true })

window.udpTransport.getStatus().then((status) => {
  if (status.mode) {
    setUdpMode(status.mode)
  }

  updateUdpButtonState(status)
}).catch((error) => {
  console.error('Failed to query UDP status:', error)
  updateUdpButtonState({
    active: false,
    lastError: error.message || 'Failed to query UDP status.'
  })
})

setInterval(() => {
  tickSimulation(SIMULATION_STEP_MS / 1000)
}, SIMULATION_STEP_MS)
