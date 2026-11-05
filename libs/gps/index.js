function gpsChecksum(body) {
  let value = 0
  for (const character of body.slice(1)) value ^= character.charCodeAt(0)
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function gpsSentence(type, fields) {
  const body = `$GP${type},${fields.join(',')}`
  const sentence = `${body}*${gpsChecksum(body)}\r\n`
  if (sentence.length > 82) throw new Error(`${type} sentence exceeds the NMEA length limit.`)
  return sentence
}

function gpsCoordinate(value, degreeWidth, positive, negative) {
  let degrees = Math.floor(Math.abs(value))
  let minutes = Math.round((Math.abs(value) - degrees) * 60 * 10000) / 10000
  if (minutes >= 60) {
    degrees += 1
    minutes = 0
  }
  return [
    `${String(degrees).padStart(degreeWidth, '0')}${minutes.toFixed(4).padStart(7, '0')}`,
    value >= 0 ? positive : negative
  ]
}

function encodeGps(own, now = new Date()) {
  if (!Number.isFinite(own.latitude) || Math.abs(own.latitude) > 90 ||
      !Number.isFinite(own.longitude) || Math.abs(own.longitude) > 180 ||
      !Number.isFinite(own.sog) || own.sog < 0 ||
      !Number.isFinite(own.cog) || !Number.isFinite(own.heading)) {
    throw new Error('Own ship position or motion is invalid for GPS output.')
  }

  const utc = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}.${String(Math.floor(now.getUTCMilliseconds() / 10)).padStart(2, '0')}`
  const date = `${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCFullYear() % 100).padStart(2, '0')}`
  const [latitude, northSouth] = gpsCoordinate(own.latitude, 2, 'N', 'S')
  const [longitude, eastWest] = gpsCoordinate(own.longitude, 3, 'E', 'W')
  const speed = own.sog.toFixed(1)
  const course = own.cog.toFixed(1)

  return [
    gpsSentence('GGA', [utc, latitude, northSouth, longitude, eastWest, '8', '08', '0.9', '0.0', 'M', '0.0', 'M', '', '']),
    gpsSentence('RMC', [utc, 'A', latitude, northSouth, longitude, eastWest, speed, course, date, '', '', 'A']),
    gpsSentence('HDT', [own.heading.toFixed(1), 'T']),
    gpsSentence('VTG', [course, 'T', '', 'M', speed, 'N', (own.sog * 1.852).toFixed(1), 'K', 'A'])
  ]
}

if (typeof module !== 'undefined' && module.exports) module.exports = { encodeGps }
if (typeof window !== 'undefined') window.GpsEncoder = { encodeGps }
