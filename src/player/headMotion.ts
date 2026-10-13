/**
 * Head motion of a walking or running person, as the camera sees it.
 *
 * Driven by the gait, not by time: the step phase advances at the cadence that goes with the
 * current speed (≈ 2.1 steps/s at the 2 m/s walk, ≈ 2.9 at the 5.6 m/s run), so speeding up,
 * slowing down and stopping all stay in step. Amplitudes follow speed, so the head settles as the
 * body stops instead of snapping still. Values are those of real gait, kept small: the eyes
 * stabilise the gaze, so a person barely perceives their own head turning.
 *
 *  - Vertical: walking vaults over a stiff leg (inverted pendulum): the head is lowest at heel
 *    strike, highest at mid-stance, ~4.5 cm peak to peak. Running bounces on a sprung leg: lowest
 *    at mid-stance, highest in flight, ~9 cm.
 *  - Lateral: the body shifts over each stance foot, once per stride (two steps).
 *  - Small roll with the lateral shift, a nod with each step, a slight yaw with the hips.
 *  - Each foot strike jolts the head through the leg's compliance: a short damped spring (sharper
 *    when running).
 *  - The body leans into acceleration (pitch for forward, roll for sideways), smoothed.
 *  - Landing from a fall or jump sinks through the knees: a soft spring kicked by the impact speed.
 */

/** Gait character at the walk and at the run; blended by speed between them. */
const WALK = { vertical: 0.022, lateral: 0.014, roll: 0.004, nod: 0.003, yaw: 0.002, strike: 0.06, strikeNod: 0.02 };
const RUN = { vertical: 0.045, lateral: 0.01, roll: 0.008, nod: 0.006, yaw: 0.003, strike: 0.28, strikeNod: 0.09 };

const GAIT_KEYS = Object.keys(WALK) as (keyof typeof WALK)[];

/** Steps per second at speed v (m/s): ~2.1 at 2 m/s, ~2.9 at 5.6 m/s. */
export function cadence(v: number): number {
  return 1.6 + 0.24 * v;
}

/** Damped spring state (one axis), integrated in substeps of at most SUBSTEP. */
class Spring {
  x = 0;
  v = 0;
  private readonly omega: number;
  private readonly zeta: number;
  constructor(hz: number, zeta: number) {
    this.omega = 2 * Math.PI * hz;
    this.zeta = zeta;
  }
  kick(dv: number): void {
    this.v += dv;
  }
  step(dt: number): void {
    const w = this.omega;
    // Semi-implicit Euler is stable for ω·dt < 2; substeps keep it well inside that.
    this.v += (-w * w * this.x - 2 * this.zeta * w * this.v) * dt;
    this.x += this.v * dt;
  }
}

const SUBSTEP = 1 / 240;
const LEAN_PER_ACCEL = 0.0004; // rad per m/s²
const LEAN_MAX = 0.02;
const LEAN_TAU = 0.12;

export interface GaitInput {
  /** Horizontal speed (m/s). */
  speed: number;
  /** Walking speed and running speed of the controller (m/s). */
  walkSpeed: number;
  runSpeed: number;
  grounded: boolean;
  /** Horizontal acceleration in the view's frame (m/s²): forward, right. */
  accelForward: number;
  accelRight: number;
}

/** Offsets to apply to the eye: metres (up, right) and radians (pitch, yaw, roll). */
export class HeadMotion {
  up = 0;
  right = 0;
  pitch = 0;
  yaw = 0;
  roll = 0;

  /** Step phase: integer values are foot strikes; one stride is two steps. */
  private phase = 0;
  private envelope = 0;
  private run = 0;
  private leanPitch = 0;
  private leanRoll = 0;
  private readonly strike = new Spring(7, 0.45);
  private readonly strikeNod = new Spring(6, 0.5);
  private readonly knees = new Spring(2.6, 0.62);
  private readonly P = { ...WALK };

  /** Advances the springs by dt in equal substeps of at most SUBSTEP. */
  private springs(dt: number): void {
    if (dt <= 0) return;
    const n = Math.ceil(dt / SUBSTEP);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.strike.step(h);
      this.strikeNod.step(h);
      this.knees.step(h);
    }
  }

  /** A landing at `impactSpeed` (m/s, downward): the knees take it. */
  land(impactSpeed: number): void {
    this.knees.kick(-0.32 * Math.min(impactSpeed, 8));
    this.strikeNod.kick(-0.04 * Math.min(impactSpeed, 8));
  }

  update(dt: number, g: GaitInput): void {
    const moving = g.grounded ? Math.min(g.speed / g.walkSpeed, 1) ** 0.8 : 0;
    // The gait's own amplitude follows speed with the body's lag; in the air it fades out.
    this.envelope += (moving - this.envelope) * (1 - Math.exp(-dt / 0.12));
    const runTarget = smoothstep(g.walkSpeed, g.runSpeed, g.speed);
    this.run += (runTarget - this.run) * (1 - Math.exp(-dt / 0.25));
    const P = this.P;
    for (const key of GAIT_KEYS) P[key] = WALK[key] + (RUN[key] - WALK[key]) * this.run;

    if (g.grounded && g.speed > 0.05) {
      const rate = cadence(g.speed);
      const next = Math.floor(this.phase) + 1;
      this.phase += rate * dt;
      if (this.phase >= next) {
        // Foot strike, at its own moment within the frame (so the jolt is frame-rate independent).
        const at = Math.min((next - (this.phase - rate * dt)) / rate, dt);
        this.springs(at);
        this.strike.kick(-P.strike * this.envelope);
        this.strikeNod.kick(-P.strikeNod * this.envelope);
        this.springs(dt - at);
      } else this.springs(dt);
    } else this.springs(dt);

    // Lean into acceleration, smoothed.
    const k = 1 - Math.exp(-dt / LEAN_TAU);
    this.leanPitch += (clamp(-g.accelForward * LEAN_PER_ACCEL, LEAN_MAX) - this.leanPitch) * k;
    this.leanRoll += (clamp(-g.accelRight * LEAN_PER_ACCEL, LEAN_MAX) - this.leanRoll) * k;

    const s = this.phase * 2 * Math.PI; // one cycle per step
    const stride = this.phase * Math.PI; // one cycle per stride
    const e = this.envelope;
    // Walking: lowest at the strike (s = 0); running: lowest at mid-stance, highest in flight.
    const walkV = -Math.cos(s);
    const runV = Math.cos(s);
    const vertical = (walkV * (1 - this.run) + runV * this.run) * P.vertical * e;
    this.up = vertical + this.strike.x + this.knees.x;
    this.right = Math.sin(stride) * P.lateral * e;
    this.roll = -Math.sin(stride) * P.roll * e + this.leanRoll;
    this.pitch = Math.sin(s) * P.nod * e + this.strikeNod.x + this.leanPitch;
    this.yaw = Math.sin(stride + 0.5) * P.yaw * e;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp(x: number, m: number): number {
  return Math.max(-m, Math.min(m, x));
}
