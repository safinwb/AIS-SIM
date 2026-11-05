const EARTH_RADIUS_NM = 3440.065

function checksum(body) {
  let value = 0
  for (const character of body.slice(1)) value ^= character.charCodeAt(0)
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function encodeTtm(own, target, number, targetId, now = new Date()) {
  if (!Number.isInteger(number) || number < 1 || number > 999) {
    throw new RangeError('TTM target number must be between 1 and 999.')
  }
  if (typeof targetId !== 'string' || !/^[A-Z0-9]{1,20}$/.test(targetId)) {
    throw new Error('TTM target ID must be 1 to 20 uppercase letters or digits.')
  }

  const lat1 = own.latitude * Math.PI / 180
  const lat2 = target.latitude * Math.PI / 180
  const deltaLat = lat2 - lat1
  const deltaLon = (target.longitude - own.longitude) * Math.PI / 180
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  const distance = 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)))
  const east = Math.sin(deltaLon) * Math.cos(lat2)
  const north = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360
  const radians = bearing * Math.PI / 180
  const position = { east: distance * Math.sin(radians), north: distance * Math.cos(radians) }
  const velocity = (vessel) => ({
    east: vessel.sog * Math.sin(vessel.cog * Math.PI / 180),
    north: vessel.sog * Math.cos(vessel.cog * Math.PI / 180)
  })
  const ownVelocity = velocity(own)
  const targetVelocity = velocity(target)
  const relative = { east: targetVelocity.east - ownVelocity.east, north: targetVelocity.north - ownVelocity.north }
  const speedSquared = relative.east ** 2 + relative.north ** 2
  const hoursToCpa = speedSquared > 1e-10
    ? -(position.east * relative.east + position.north * relative.north) / speedSquared
    : 0
  const cpa = speedSquared > 1e-10
    ? Math.hypot(position.east + relative.east * hoursToCpa, position.north + relative.north * hoursToCpa)
    : distance
  const utc = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}.00`
  const fields = [
    String(number).padStart(2, '0'), distance.toFixed(2), bearing.toFixed(1), 'T',
    target.sog.toFixed(1), target.cog.toFixed(1), 'T', cpa.toFixed(2),
    speedSquared > 1e-10 ? (hoursToCpa * 60).toFixed(1) : '', 'N', targetId, 'T', '', utc, 'R'
  ]
  const body = `$RATTM,${fields.join(',')}`
  if (body.length > 77) throw new Error('TTM sentence exceeds the NMEA length limit.')
  return `${body}*${checksum(body)}\r\n`
}

if (typeof module !== 'undefined' && module.exports) module.exports = { encodeTtm }
if (typeof window !== 'undefined') window.TtmEncoder = { encodeTtm }
