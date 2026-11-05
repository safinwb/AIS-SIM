class OwnShip extends Vessel {
  constructor() {
    super({
      id: 'ownship',
      name: 'Own Ship',
      latitude: 25 + 31 / 60 + 16.4 / 3600,
      longitude: 56 + 22 / 60 + 45.1 / 3600,
      sog: 0,
      cog: 0,
      heading: 0
    })
    this.targetHeading = 0
  }

  setSpeed(speed) {
    if (!Number.isFinite(speed) || speed < 0 || speed > 30) {
      throw new RangeError('Own ship speed must be between 0 and 30 knots.')
    }
    this.sog = speed
  }

  setTargetHeading(heading) {
    if (!Number.isFinite(heading) || heading < 0 || heading >= 360) {
      throw new RangeError('Own ship heading must be between 0 and 359.9 degrees.')
    }
    this.targetHeading = heading
  }

  updatePosition(elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return

    const difference = ((this.targetHeading - this.heading + 540) % 360) - 180
    const turn = Math.max(-15 * elapsedSeconds, Math.min(15 * elapsedSeconds, difference))
    this.heading = (this.heading + turn + 360) % 360
    this.cog = this.heading
    super.updatePosition(elapsedSeconds)
  }
}

window.OwnShip = OwnShip
