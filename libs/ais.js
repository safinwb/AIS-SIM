class BitBuilder {
  constructor() {
    this.bits = ''
  }

  pushUnsigned(value, width) {
    const normalized = Math.max(0, Math.trunc(value))
    this.bits += normalized.toString(2).padStart(width, '0').slice(-width)
  }

  pushSigned(value, width) {
    const maxValue = 2 ** width
    const normalized = value < 0 ? maxValue + Math.trunc(value) : Math.trunc(value)
    this.bits += normalized.toString(2).padStart(width, '0').slice(-width)
  }

  toBitString() {
    return this.bits
  }
}

class AisEncoder {
  static encodePositionReport(vessel, options = {}) {
    const channel = options.channel || 'A'
    const builder = new BitBuilder()
    const timestampSecond = new Date().getUTCSeconds()

    builder.pushUnsigned(1, 6)
    builder.pushUnsigned(0, 2)
    builder.pushUnsigned(Number.parseInt(vessel.mmsi, 10), 30)
    builder.pushUnsigned(AisEncoder.clamp(vessel.navStatus ?? 0, 0, 15), 4)
    builder.pushSigned(AisEncoder.encodeRateOfTurn(vessel.rot ?? 0), 8)
    builder.pushUnsigned(AisEncoder.encodeSog(vessel.sog), 10)
    builder.pushUnsigned(vessel.positionAccuracy ? 1 : 0, 1)
    builder.pushSigned(AisEncoder.encodeLongitude(vessel.longitude), 28)
    builder.pushSigned(AisEncoder.encodeLatitude(vessel.latitude), 27)
    builder.pushUnsigned(AisEncoder.encodeCog(vessel.cog), 12)
    builder.pushUnsigned(AisEncoder.encodeHeading(vessel.heading), 9)
    builder.pushUnsigned(timestampSecond, 6)
    builder.pushUnsigned(0, 2)
    builder.pushUnsigned(0, 3)
    builder.pushUnsigned(0, 1)
    builder.pushUnsigned(0, 19)

    const payloadInfo = AisEncoder.armorPayload(builder.toBitString())
    return AisEncoder.wrapAivdm(payloadInfo.payload, payloadInfo.fillBits, channel)
  }

  static wrapAivdm(payload, fillBits, channel) {
    const fragmentSize = 60
    const fragments = payload.match(new RegExp(`.{1,${fragmentSize}}`, 'g')) || ['']
    const sequentialMessageId = fragments.length > 1
      ? String(Math.floor(Math.random() * 9) + 1)
      : ''

    return fragments.map((fragment, index) => {
      const fragmentNumber = index + 1
      const fragmentFillBits = fragmentNumber === fragments.length ? fillBits : 0
      const body = `!AIVDM,${fragments.length},${fragmentNumber},${sequentialMessageId},${channel},${fragment},${fragmentFillBits}`
      return `${body}*${AisEncoder.computeChecksum(body)}`
    })
  }

  static armorPayload(bitString) {
    const remainder = bitString.length % 6
    const fillBits = remainder === 0 ? 0 : 6 - remainder
    const paddedBits = bitString.padEnd(bitString.length + fillBits, '0')

    let payload = ''

    for (let index = 0; index < paddedBits.length; index += 6) {
      const chunk = paddedBits.slice(index, index + 6)
      const value = Number.parseInt(chunk, 2)
      payload += AisEncoder.toSixBitCharacter(value)
    }

    return {
      fillBits,
      payload
    }
  }

  static toSixBitCharacter(value) {
    return String.fromCharCode(value < 40 ? value + 48 : value + 56)
  }

  static computeChecksum(sentence) {
    let checksum = 0

    for (let index = 1; index < sentence.length; index += 1) {
      checksum ^= sentence.charCodeAt(index)
    }

    return checksum.toString(16).toUpperCase().padStart(2, '0')
  }

  static encodeRateOfTurn(value) {
    if (!Number.isFinite(value)) {
      return 0
    }

    return AisEncoder.clamp(Math.round(value), -126, 126)
  }

  static encodeSog(value) {
    if (!Number.isFinite(value) || value < 0) {
      return 1023
    }

    return AisEncoder.clamp(Math.round(value * 10), 0, 1022)
  }

  static encodeLongitude(value) {
    if (!Number.isFinite(value)) {
      return 0x6791AC0
    }

    return Math.round(value * 600000)
  }

  static encodeLatitude(value) {
    if (!Number.isFinite(value)) {
      return 0x3412140
    }

    return Math.round(value * 600000)
  }

  static encodeCog(value) {
    if (!Number.isFinite(value)) {
      return 3600
    }

    const normalized = ((value % 360) + 360) % 360
    return Math.round(normalized * 10)
  }

  static encodeHeading(value) {
    if (!Number.isFinite(value)) {
      return 511
    }

    const normalized = ((value % 360) + 360) % 360
    return Math.round(normalized)
  }

  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }
}

window.AisEncoder = AisEncoder
