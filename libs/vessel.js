class Vessel {
  constructor({
    aisClass = 'A',
    callsign = '',
    cog,
    destination = '',
    dimensionToBow = 35,
    dimensionToPort = 5,
    dimensionToStarboard = 5,
    dimensionToStern = 12,
    draft = 4.5,
    eta = null,
    heading,
    id,
    imo = 0,
    latitude,
    longitude,
    messageRateHz = 1,
    mmsi,
    name,
    navStatus = 0,
    positionAccuracy = 1,
    rot = 0,
    shipType = 36,
    sog
  }) {
    this.id = id
    this.mmsi = mmsi
    this.name = name
    this.aisClass = aisClass
    this.latitude = latitude
    this.longitude = longitude
    this.sog = sog
    this.cog = cog
    this.heading = heading
    this.messageRateHz = messageRateHz
    this.callsign = callsign
    this.imo = imo
    this.navStatus = navStatus
    this.rot = rot
    this.shipType = shipType
    this.positionAccuracy = positionAccuracy
    this.destination = destination
    this.dimensionToBow = dimensionToBow
    this.dimensionToStern = dimensionToStern
    this.dimensionToPort = dimensionToPort
    this.dimensionToStarboard = dimensionToStarboard
    this.draft = draft
    this.eta = eta
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  static createRandom({ latitude, longitude }) {
    const heading = Vessel.randomNumber(0, 359.9, 1)
    const speed = Vessel.randomNumber(4, 18, 1)
    const id = `vessel-${Date.now()}-${Math.floor(Math.random() * 100000)}`
    const name = `${Vessel.randomChoice(Vessel.NAME_PREFIXES)} ${Vessel.randomChoice(Vessel.NAME_SUFFIXES)}`
    const mmsi = Vessel.generateMmsi()

    return new Vessel({
      cog: heading,
      callsign: Vessel.generateCallsign(),
      destination: Vessel.randomChoice(Vessel.DESTINATIONS),
      draft: Vessel.randomNumber(3.2, 7.8, 1),
      eta: null,
      heading,
      id,
      imo: Vessel.generateImo(),
      latitude,
      longitude,
      messageRateHz: 1,
      mmsi,
      name,
      sog: speed
    })
  }

  updatePosition(elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || this.sog <= 0) {
      return
    }

    const distanceMeters = this.sog * 0.514444 * elapsedSeconds
    const earthRadiusMeters = 6371000
    const bearingRadians = Vessel.degreesToRadians(this.cog)
    const latitudeRadians = Vessel.degreesToRadians(this.latitude)
    const longitudeRadians = Vessel.degreesToRadians(this.longitude)
    const angularDistance = distanceMeters / earthRadiusMeters

    const nextLatitudeRadians = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians)
    )

    const nextLongitudeRadians = longitudeRadians + Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitudeRadians)
    )

    this.latitude = Vessel.radiansToDegrees(nextLatitudeRadians)
    this.longitude = Vessel.normalizeLongitude(Vessel.radiansToDegrees(nextLongitudeRadians))
    this.updatedAt = Date.now()
  }

  applyUpdates(updates = {}) {
    const allowedFields = [
      'cog',
      'destination',
      'draft',
      'heading',
      'latitude',
      'longitude',
      'messageRateHz',
      'mmsi',
      'name',
      'sog'
    ]

    for (const field of allowedFields) {
      if (Object.hasOwn(updates, field)) {
        this[field] = updates[field]
      }
    }

    this.updatedAt = Date.now()
  }

  getLatLng() {
    return [this.latitude, this.longitude]
  }

  toSummary() {
    return {
      aisClass: this.aisClass,
      cog: this.cog,
      heading: this.heading,
      id: this.id,
      latitude: this.latitude,
      longitude: this.longitude,
      messageRateHz: this.messageRateHz,
      mmsi: this.mmsi,
      name: this.name,
      navStatus: this.navStatus,
      destination: this.destination,
      draft: this.draft,
      shipType: this.shipType,
      sog: this.sog
    }
  }

  static generateMmsi() {
    const prefix = 338
    const suffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    return `${prefix}${suffix}`
  }

  static generateImo() {
    return Number(`9${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`)
  }

  static generateCallsign() {
    const prefix = Vessel.randomChoice(['A6', 'D5', 'V7', '9H', 'C6'])
    const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    return `${prefix}${suffix}`
  }

  static randomChoice(values) {
    return values[Math.floor(Math.random() * values.length)]
  }

  static randomNumber(min, max, fractionDigits = 0) {
    const value = min + Math.random() * (max - min)
    return Number(value.toFixed(fractionDigits))
  }

  static degreesToRadians(value) {
    return value * (Math.PI / 180)
  }

  static radiansToDegrees(value) {
    return value * (180 / Math.PI)
  }

  static normalizeLongitude(value) {
    if (value > 180) {
      return value - 360
    }

    if (value < -180) {
      return value + 360
    }

    return value
  }
}

Vessel.NAME_PREFIXES = [
  'Blue',
  'Silver',
  'North',
  'Sea',
  'Golden',
  'Ocean',
  'Desert',
  'Wind',
  'Red',
  'Pearl',
  'Royal',
  'Coral',
  'Moon',
  'Sun',
  'Emirates',
  'Arabian',
  'Dubai',
  'Abu Dhabi',
  'Fujairah',
  'Muscat',
  'Doha',
  'Jumeirah',
  'Al Bahr',
  'Al Noor',
  'Al Amal',
  'Al Safina',
  'Al Dana',
  'Al Yas',
  'Al Thuraya',
  'Nour',
  'Layal',
  'Yas',
  'Najm',
  'Sahra'
]
Vessel.NAME_SUFFIXES = [
  'Marlin',
  'Falcon',
  'Star',
  'Runner',
  'Spirit',
  'Tide',
  'Voyager',
  'Beacon',
  'Wave',
  'Dhow',
  'Navigator',
  'Horizon',
  'Current',
  'Harbor',
  'Pearl',
  'Sands',
  'Sirocco',
  'Breeze',
  'Gulf',
  'Trader',
  'Explorer',
  'Nomad',
  'Zayed',
  'Rashid',
  'Noor',
  'Dana',
  'Lulu',
  'Najm',
  'Sahil',
  'Amwaj'
]
Vessel.DESTINATIONS = ['Jebel Ali', 'Port Rashid', 'Fujairah', 'Abu Dhabi', 'Doha', 'Muscat', 'Anchorage']

window.Vessel = Vessel
