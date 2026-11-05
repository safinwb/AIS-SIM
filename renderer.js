const INITIAL_VIEW = {
  latitude: 25 + 31 / 60 + 16.4 / 3600,
  longitude: 56 + 22 / 60 + 45.1 / 3600,
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

const SIMULATION_STEP_MS = 100
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
const ownshipSpeedInput = document.getElementById('ownship-speed')
const ownshipTargetHeadingInput = document.getElementById('ownship-target-heading')
const ownshipCurrentHeading = document.getElementById('ownship-current-heading')
const ownshipPosition = document.getElementById('ownship-position')
const udpIpInput = document.getElementById('udp-ip')
const udpPortInput = document.getElementById('udp-port')
const udpToggleButton = document.getElementById('udp-toggle')
const udpModeButtons = Array.from(document.querySelectorAll('.udp-mode-button'))
const transportButtons = Array.from(document.querySelectorAll('.transport-button'))
const messageButtons = Array.from(document.querySelectorAll('.message-button'))
const gpsOutputToggle = document.getElementById('gps-output-toggle')
const gpsRateButton = document.getElementById('gps-rate-button')

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

if (typeof window.OwnShip === 'undefined' || !ownshipSpeedInput || !ownshipTargetHeadingInput || !ownshipCurrentHeading || !ownshipPosition) {
  throw new Error('Own ship controls or model are not available in the renderer.')
}

if (typeof window.AisEncoder === 'undefined') {
  throw new Error('AIS encoder is not available in the renderer.')
}

if (!window.TtmEncoder || messageButtons.length !== 2) {
  throw new Error('TTM encoder or message format controls are not available in the renderer.')
}

if (!window.GpsEncoder || !gpsOutputToggle || !gpsRateButton) {
  throw new Error('GPS encoder or output control is not available in the renderer.')
}

if (!window.udpTransport || !window.tcpTransport) {
  throw new Error('UDP transport bridge is not available.')
}

const vesselMarkers = new Map()
const vessels = new Map()
const ownship = new window.OwnShip()
const draggingVesselIds = new Set()
let draggingOwnship = false
const lastTransmitAt = new Map()
const pendingTransmitIds = new Set()
const ttmTargetNumbers = new Map()
const ttmTargetIds = new Map()
let pendingGpsTransmit = false
let gpsRateHz = 10
let gpsTicksUntilSend = 0

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
let selectedTransport = 'udp'
let selectedMessageFormat = 'ais'

function activeTransport() {
  return selectedTransport === 'tcp' ? window.tcpTransport : window.udpTransport
}

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

const ownshipIcon = window.L.divIcon({
  className: 'ownship-marker-icon',
  html: '<div class="ownship-marker-shell"><img src="./assets/icons/ownship.png" alt=""></div>',
  iconAnchor: [29, 29],
  iconSize: [58, 58]
})

const ownshipMarker = window.L.marker(ownship.getLatLng(), {
  draggable: true,
  icon: ownshipIcon,
  zIndexOffset: 1000
}).addTo(map)

function updateOwnshipPositionText(latitude, longitude) {
  ownshipPosition.textContent = `LAT ${latitude.toFixed(6)} · LNG ${longitude.toFixed(6)}`
}

function updateOwnshipDisplay() {
  ownshipMarker.setLatLng(ownship.getLatLng())
  updateMarkerHeading(ownshipMarker, ownship.heading)
  ownshipCurrentHeading.textContent = `${ownship.heading.toFixed(1).padStart(5, '0')}°`
  updateOwnshipPositionText(ownship.latitude, ownship.longitude)
  if (ownshipMarker.isPopupOpen()) {
    ownshipMarker.setPopupContent(formatOwnshipPopup())
  }
}

function formatOwnshipPopup() {
  return `<strong>Own Ship</strong><br>SOG ${ownship.sog.toFixed(1)} kn<br>HDG ${ownship.heading.toFixed(1)}°<br>${ownshipPosition.textContent}`
}

ownshipMarker.bindPopup(formatOwnshipPopup(), { offset: [0, -14] })
ownshipMarker.on('click', hideContextMenu)
ownshipMarker.on('dragstart', () => {
  draggingOwnship = true
  hideContextMenu()
})
ownshipMarker.on('drag', () => {
  const position = ownshipMarker.getLatLng()
  updateOwnshipPositionText(position.lat, position.lng)
})
ownshipMarker.on('dragend', () => {
  const position = ownshipMarker.getLatLng()
  ownship.applyUpdates({
    latitude: position.lat,
    longitude: ((position.lng + 180) % 360 + 360) % 360 - 180
  })
  draggingOwnship = false
  updateOwnshipDisplay()
})
updateOwnshipDisplay()

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
  for (const button of transportButtons) {
    button.disabled = isDisabled || button.dataset.transport === 'serial'
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
    udpToggleButton.title = `${selectedTransport.toUpperCase()} ${status.mode || selectedUdpMode} active: ${status.host}:${status.port}`
    return
  }

  if (!isActive) {
    for (const vesselId of vessels.keys()) {
      lastTransmitAt.set(vesselId, 0)
    }
    gpsTicksUntilSend = 0
  }

  udpToggleButton.title = `Activate ${selectedTransport.toUpperCase()} connection`
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

  const shell = element.querySelector('.vessel-marker-shell, .ownship-marker-shell')
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

function nextTtmTargetNumber() {
  const used = new Set(ttmTargetNumbers.values())
  for (let number = 1; number <= 999; number += 1) {
    if (!used.has(number)) return number
  }
  return null
}

function nextTtmTargetId() {
  const used = new Set(ttmTargetIds.values())
  let number = Math.floor(Math.random() * 1000000)
  for (let attempt = 0; attempt < 1000000; attempt += 1) {
    const id = `T${String(number).padStart(6, '0')}`
    if (!used.has(id)) return id
    number = (number + 1) % 1000000
  }
  throw new Error('No TTM target IDs are available.')
}

function addRandomVessel(latlng) {
  const targetNumber = nextTtmTargetNumber()
  if (targetNumber === null) {
    window.alert('The simulator supports up to 999 tracked targets.')
    return
  }

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
  ttmTargetNumbers.set(vessel.id, targetNumber)
  ttmTargetIds.set(vessel.id, nextTtmTargetId())
  vesselMarkers.set(vessel.id, marker)
  lastTransmitAt.set(vessel.id, 0)
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
  ttmTargetNumbers.delete(vesselId)
  ttmTargetIds.delete(vesselId)
  lastTransmitAt.delete(vesselId)
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
  lastTransmitAt.set(vesselId, 0)
}

async function transmitForVessel(vesselId, vessel) {
  pendingTransmitIds.add(vesselId)
  const format = selectedMessageFormat
  try {
    const payload = format === 'ttm'
      ? [window.TtmEncoder.encodeTtm(ownship, vessel, ttmTargetNumbers.get(vesselId), ttmTargetIds.get(vesselId))]
      : window.AisEncoder.encodePositionReport(vessel).map((sentence) => `${sentence}\r\n`)
    const result = await activeTransport().sendMessages(payload)

    if (result.sent > 0 && format === selectedMessageFormat) {
      lastTransmitAt.set(vesselId, Date.now())
    }
  } finally {
    pendingTransmitIds.delete(vesselId)
  }
}

function shouldTransmit(vesselId, currentTimeMs) {
  if (!currentUdpStatus.active) {
    return false
  }

  if (currentUdpStatus.mode === 'server' && (!currentUdpStatus.peerCount || currentUdpStatus.peerCount < 1)) {
    return false
  }

  if (pendingTransmitIds.has(vesselId)) {
    return false
  }

  const lastSentAt = lastTransmitAt.get(vesselId) || 0
  const vessel = vessels.get(vesselId)

  if (!vessel) {
    return false
  }

  const rateHz = Number.isFinite(vessel.messageRateHz) && vessel.messageRateHz > 0
    ? vessel.messageRateHz
    : 1
  const transmitIntervalMs = 1000 / rateHz

  return currentTimeMs - lastSentAt >= transmitIntervalMs
}

function maybeTransmit(currentTimeMs) {
  for (const [vesselId, vessel] of vessels.entries()) {
    if (!shouldTransmit(vesselId, currentTimeMs)) {
      continue
    }

    transmitForVessel(vesselId, vessel).catch((error) => {
      console.error(`${selectedMessageFormat.toUpperCase()} transmit failed for vessel ${vesselId}:`, error)
      updateUdpButtonState({
        active: currentUdpStatus.active,
        host: currentUdpStatus.host,
        lastError: error.message || 'Message transmit failed.',
        mode: currentUdpStatus.mode,
        port: currentUdpStatus.port
      })
    })
  }
}

async function maybeTransmitGps() {
  if (!gpsOutputToggle.checked || !currentUdpStatus.active) return
  if (currentUdpStatus.mode === 'server' && (!currentUdpStatus.peerCount || currentUdpStatus.peerCount < 1)) return
  if (gpsTicksUntilSend > 0) {
    gpsTicksUntilSend -= 1
    return
  }
  if (pendingGpsTransmit) return

  pendingGpsTransmit = true
  gpsTicksUntilSend = 10 / gpsRateHz - 1
  try {
    await activeTransport().sendMessages(window.GpsEncoder.encodeGps(ownship))
  } catch (error) {
    gpsTicksUntilSend = 0
    console.error('GPS transmit failed:', error)
    updateUdpButtonState({
      active: currentUdpStatus.active,
      lastError: error.message || 'GPS transmit failed.'
    })
  } finally {
    pendingGpsTransmit = false
  }
}

gpsOutputToggle.addEventListener('change', () => {
  gpsTicksUntilSend = 0
})

gpsRateButton.addEventListener('click', () => {
  gpsRateHz = gpsRateHz === 10 ? 1 : gpsRateHz === 1 ? 5 : 10
  gpsRateButton.textContent = `${gpsRateHz} Hz`
  gpsRateButton.setAttribute('aria-label', `GPS transmission rate: ${gpsRateHz} Hz. Click to change.`)
  gpsTicksUntilSend = 0
})

function tickSimulation(deltaSeconds) {
  if (!draggingOwnship) {
    ownship.updatePosition(deltaSeconds)
    updateOwnshipDisplay()
  }

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

  maybeTransmit(Date.now())
  void maybeTransmitGps()
}

for (const button of messageButtons) {
  button.addEventListener('click', () => {
    const format = button.dataset.messageFormat
    if (format === selectedMessageFormat) return
    selectedMessageFormat = format
    for (const item of messageButtons) {
      const selected = item === button
      item.classList.toggle('is-selected', selected)
      item.setAttribute('aria-pressed', String(selected))
    }
    for (const vesselId of vessels.keys()) lastTransmitAt.set(vesselId, 0)
  })
}

for (const button of transportButtons) {
  button.addEventListener('click', () => {
    if (button.disabled || selectedTransport === button.dataset.transport) return
    selectedTransport = button.dataset.transport
    for (const item of transportButtons) {
      const selected = item === button
      item.classList.toggle('is-selected', selected)
      item.setAttribute('aria-pressed', String(selected))
    }
    updateUdpButtonState({ active: false, lastError: null })
  })
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
      const status = await activeTransport().stop()
      updateUdpButtonState(status)
      return
    }

    const config = getUdpConfigFromInputs()

    if (!config) {
      return
    }

    const status = await activeTransport().start(config)
    updateUdpButtonState(status)
  } catch (error) {
    console.error('Connection error:', error)
    updateUdpButtonState({
      active: false,
      lastError: error.message || 'Connection failed.'
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

ownshipSpeedInput.addEventListener('change', () => {
  const speed = Number(ownshipSpeedInput.value)
  if (ownshipSpeedInput.value !== '' && Number.isFinite(speed) && speed >= 0 && speed <= 30) {
    ownship.setSpeed(speed)
    ownshipSpeedInput.value = speed.toFixed(1)
  } else {
    ownshipSpeedInput.value = ownship.sog.toFixed(1)
  }
})

ownshipTargetHeadingInput.addEventListener('change', () => {
  const heading = Number(ownshipTargetHeadingInput.value)
  if (ownshipTargetHeadingInput.value !== '' && Number.isFinite(heading) && heading >= 0 && heading < 360) {
    ownship.setTargetHeading(heading)
    ownshipTargetHeadingInput.value = heading.toFixed(1)
  } else {
    ownshipTargetHeadingInput.value = ownship.targetHeading.toFixed(1)
  }
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

for (const [name, bridge] of [['udp', window.udpTransport], ['tcp', window.tcpTransport]]) {
  bridge.onStatusChange((status) => {
    if (selectedTransport !== name) return
    if (status.mode) setUdpMode(status.mode)
    updateUdpButtonState(status)
  })
  bridge.onError((error) => console.error(`${name.toUpperCase()} transport error:`, error))
}

setUdpMode(selectedUdpMode, { applyDefaults: true })
activeTransport().getStatus().then(updateUdpButtonState).catch((error) => {
  updateUdpButtonState({ active: false, lastError: error.message })
})

setInterval(() => {
  tickSimulation(SIMULATION_STEP_MS / 1000)
}, SIMULATION_STEP_MS)
