/**
 * The craft's body on its levitation (docs/vehicles.md, "The craft", "Levitation"). The flight
 * (flight.ts) moves a carrier along its tested path; the hull rides that carrier as a sprung mass
 * held by the field, so it answers what the carrier does rather than copying it:
 *
 *  - heave: the field gives a little under vertical acceleration (the hull sinks as a descent is
 *    checked, and as a lift-off starts), and recovers with a slight overshoot;
 *  - pitch: toward the flight path's climb and a flare against deceleration, sprung, so it rocks
 *    once and settles when the carrier stops;
 *  - roll: toward a target the flight gives (a bank into the hover's pivot, a drift);
 *  - yaw: follows the commanded heading through a spring, so a turn starts softly, carries a
 *    little past, and settles.
 *
 * Each is a damped spring integrated in fixed 1/240 s steps (stable at any frame rate). Pure.
 */

/** Natural frequency (Hz), damping ratio and travel limit of each axis. */
export const LEVITATION = {
  heave: { hz: 0.55, zeta: 0.5, limit: 0.35 },
  pitch: { hz: 0.45, zeta: 0.6, limit: 0.12 },
  roll: { hz: 0.5, zeta: 0.55, limit: 0.09 },
  yaw: { hz: 0.8, zeta: 0.62, limit: Infinity },
} as const;

const STEP = 1 / 240;

interface Axis {
  readonly hz: number;
  readonly zeta: number;
  readonly limit: number;
}

/** A damped spring toward a target, with an optional base acceleration (the carrier's). */
class Spring {
  x = 0;
  v = 0;
  private readonly w: number;
  private readonly zeta: number;
  private readonly limit: number;

  constructor(axis: Axis) {
    this.w = 2 * Math.PI * axis.hz;
    this.zeta = axis.zeta;
    this.limit = axis.limit;
  }

  step(target: number, base: number, h: number): void {
    const w = this.w;
    this.v += (-(w * w) * (this.x - target) - 2 * this.zeta * w * this.v - base) * h;
    this.x += this.v * h;
    if (Math.abs(this.x) > this.limit) {
      this.x = Math.sign(this.x) * this.limit;
      this.v = 0;
    }
  }

  reset(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

/** Wraps an angle to (−π, π]. */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

export class LevitationBody {
  private readonly heaveS = new Spring(LEVITATION.heave);
  private readonly pitchS = new Spring(LEVITATION.pitch);
  private readonly rollS = new Spring(LEVITATION.roll);
  /** Yaw is tracked as the lag behind the commanded heading. */
  private readonly yawS = new Spring(LEVITATION.yaw);
  private heading = 0;
  private carry = 0;

  /** Vertical offset from the carrier (m). */
  get heave(): number {
    return this.heaveS.x;
  }
  get pitch(): number {
    return this.pitchS.x;
  }
  get roll(): number {
    return this.rollS.x;
  }
  /** The hull's heading (rad). */
  get yaw(): number {
    return this.heading + this.yawS.x;
  }

  /** Puts the hull at rest on its carrier. */
  reset(heading: number, pitch = 0): void {
    this.heading = heading;
    this.heaveS.reset(0);
    this.pitchS.reset(pitch);
    this.rollS.reset(0);
    this.yawS.reset(0);
    this.carry = 0;
  }

  /**
   * Advances by dt: the carrier's vertical acceleration (m/s²), the commanded heading (rad), and
   * the pitch and roll the flight asks for (rad).
   */
  update(dt: number, accelY: number, heading: number, pitch: number, roll: number): void {
    // The commanded heading moves on; the hull keeps its yaw (the lag takes up the change) and the
    // lag's spring then draws it after the heading.
    const turn = wrap(heading - this.heading);
    this.heading = wrap(this.heading + turn);
    this.yawS.x -= turn;
    this.carry += dt;
    const n = Math.floor(this.carry / STEP);
    this.carry -= n * STEP;
    for (let i = 0; i < n; i++) {
      this.yawS.step(0, 0, STEP);
      this.heaveS.step(0, accelY, STEP);
      this.pitchS.step(pitch, 0, STEP);
      this.rollS.step(roll, 0, STEP);
    }
  }
}
