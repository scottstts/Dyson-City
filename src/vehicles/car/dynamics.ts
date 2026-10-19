/**
 * The car's driving physics (docs/vehicles.md, "Driving"): a light, agile electric GT (1.35 t).
 *
 * A planar rigid body (the Dome's pad is flat) on two tyre axles, integrated in fixed 1/240 s
 * steps so the feel is the same at any frame rate:
 *
 *  - Tyres: a magic-formula lateral curve on each axle's slip angle, peaking near 9.5°, with load
 *    sensitivity; drive and brake share the grip through a friction ellipse, so braking or full
 *    power in a corner costs side grip and a car pushed past the limit slides gently.
 *  - Load transfer from the last step's acceleration: braking loads the nose and sharpens turn-in,
 *    power loads the tail.
 *  - Four hub motors (45/55 front/rear): full torque from rest, then constant power, with a governor
 *    at the top speed. Lifting off regenerates gently (one-pedal), and the car holds at rest.
 *  - Brakes stop at the tyres' limit (no lock-up: anti-lock). The handbrake locks the rear axle:
 *    its side grip collapses and the tail steps out.
 *  - Assistance, as a modern GT has it, never an arcade cheat: steering is speed-sensitive and
 *    held within the front tyres' useful slip (keyboard steering cannot overdrive the front), and
 *    a stability control trims the yaw and the drive once the body's slip angle grows past ~7°.
 *    The handbrake turns it off for that moment.
 *  - Four-wheel steering: the rears counter-steer at low speed for a tight turn, fading out by
 *    ~85 km/h.
 *
 * Frame: the car's nose is its +z, its left +x, up +y; yaw ψ turns the nose from +z toward +x.
 * Pure (no scene): `step` advances the state from the inputs.
 */
import { GRAVITY } from '../../world/constants';
import { CAR } from './model';

export const CAR_PHYSICS = {
  /** Mass (kg), yaw inertia (kg m²: ~0.9 m·a·b for the 4.3 m wheelbase), centre of mass height (m). */
  mass: 1350,
  inertia: 5600,
  cgHeight: 0.62,
  /** Centre of mass to the front and rear axles (m). */
  a: CAR.frontZ,
  b: -CAR.rearZ,
  /** Peak tyre-road friction: performance tyres on dry polished basalt and limestone. */
  mu: 1.2,
  /** The rear tyres' grip over the front's (wider rears): the car settles into mild understeer. */
  rearGrip: 1.1,
  /** Load sensitivity: grip falls by this share per unit of load over the static load. */
  loadSensitivity: 0.1,
  /** Magic-formula shape (B, C, E): peak near 9.5° of slip. */
  tyre: { B: 11, C: 1.35, E: -0.6 },
  /** Motors: peak tractive force (N), power (W), top speed (m/s, 140 km/h), reverse limit. */
  force: 13_000,
  power: 300_000,
  topSpeed: 38.9,
  reverseSpeed: 9,
  /** Front share of drive torque. Braking follows the axles' loads (EBD). */
  driveFront: 0.45,
  /** Full brake pedal's deceleration demand (m/s²); anti-lock holds each axle under its limit. */
  brakeDecel: 11.5,
  /**
   * Combined slip: braking or drive at the limit may take at most this share of an axle's grip
   * while it is cornering (anti-lock and traction control keep the slip ratio short of the peak,
   * so a cornering tyre always keeps side grip).
   */
  sideReserve: 0.45,
  /** Deceleration from regeneration with the throttle lifted (m/s²). */
  regen: 1.6,
  /** Aerodynamic drag area (m²) and rolling resistance. */
  dragArea: 0.75,
  rolling: 0.011,
  /**
   * Steering: lock at rest (rad), the speed (m/s) where it has halved, and the time (s) the wheel
   * takes from centre to lock, at rest and at top speed (a key press winds the wheel on, it does
   * not snap to lock: fine corrections at speed). It returns to centre faster (self-aligning).
   */
  steerLock: (28 * Math.PI) / 180,
  steerHalfSpeed: 18,
  steerTime: [0.14, 0.32] as const,
  steerReturn: 0.55,
  /**
   * Rear-wheel steering: the rears counter-steer this share of the front angle at low speed (a
   * tighter turn: the turning radius falls from ~8 m to ~5.5 m), fading out between the two speeds
   * (m/s) so the car stays planted fast; at most rearLock.
   */
  rearShare: 0.4,
  rearFade: [8, 24] as const,
  rearLock: (11 * Math.PI) / 180,
  /** The front's steering is held within this multiple of the tyres' peak slip. */
  slipWindow: 1.0,
  /**
   * Stability control, as a modern one works: its yaw-rate reference is the steering's neutral rate,
   * held to what the grip can turn (escRate · μg / u). It acts when the yaw rate runs past that, or
   * once the body's slip passes escSlip (rad), with this gain and at most escMoment of μ·W·half-track
   * (it brakes single wheels, so it is bounded by the tyres' grip like everything else).
   */
  escSlip: 0.1,
  escRate: 1.05,
  escGain: 8,
  escMoment: 0.35,
  /**
   * Torque vectoring: the four hub motors drive the outside wheels harder than the inside ones
   * when the car turns less than the steering asks (power understeer), toward the same reference
   * as the stability control: a yaw-rate gain, and at most this share of μ·W·half-track. Off under
   * braking and with the handbrake.
   */
  tvGain: 6,
  tvMoment: 0.3,
  /**
   * Cornering traction management: the drive is held back by this share of itself at the full
   * cornering limit (by the square of the lateral acceleration's share of μg), so W held through a
   * corner keeps the car on its line instead of speeding it up off it.
   */
  cornerTrim: 0.8,
} as const;

const DT = 1 / 240;
/** Standing still this long (s) with the other pedal held changes direction. */
const SHIFT_DELAY = 0.25;
const AIR_DENSITY = 1.2;
/** Below this speed a tyre's slip is measured against it (slip angles are singular at rest). */
const SLIP_FLOOR = 2.0;

export interface DriveInput {
  /** Accelerator 0..1 (W). */
  throttle: number;
  /** Brake, or reverse from rest, 0..1 (S). */
  brake: number;
  /** Steer −1 (right) … 1 (left). */
  steer: number;
  handbrake: boolean;
}

export const NO_INPUT: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export class CarState {
  x = 0;
  z = 0;
  /** Heading: the nose points along (sin ψ, 0, cos ψ). */
  yaw = 0;
  /** Body-frame velocity: forward, left (m/s); yaw rate (rad/s, left positive). */
  u = 0;
  v = 0;
  r = 0;
  /** Front and rear wheels' steer angles (rad, left positive). */
  steer = 0;
  rearSteer = 0;
  /** 1 forward, −1 reverse. */
  gear: 1 | -1 = 1;
  /** Time (s) the car has stood with a pedal asking for the other direction. */
  private shift = 0;
  /** Body-frame acceleration (m/s²) over the last step: forward, left. */
  ax = 0;
  ay = 0;
  /** Wheel spin rates (rad/s): front axle, rear axle. */
  spinFront = 0;
  spinRear = 0;
  /** Drive force share in use (−1 regen/brake … 1 full power) and the tyres' work at the limit (0..1+). */
  load = 0;
  scrub = 0;
  /** Brake applied (0..1), for the tail lamps. */
  braking = 0;
  /** The handbrake is on (the rear wheels are locked). */
  handbrake = false;

  /** Changes direction after standing still with the other pedal held for SHIFT_DELAY. */
  selectGear(input: DriveInput, dt: number): void {
    const wants = input.throttle > 0.1 && input.brake < 0.1 ? 1 : input.brake > 0.1 && input.throttle < 0.1 ? -1 : 0;
    const asking = wants !== 0 && wants !== this.gear && Math.abs(this.u) < 0.4;
    this.shift = asking ? this.shift + dt : 0;
    if (asking && this.shift >= SHIFT_DELAY) {
      this.gear = wants as 1 | -1;
      this.shift = 0;
    }
  }

  /** World velocity. */
  get vx(): number {
    return Math.sin(this.yaw) * this.u + Math.cos(this.yaw) * this.v;
  }
  get vz(): number {
    return Math.cos(this.yaw) * this.u - Math.sin(this.yaw) * this.v;
  }
  get speed(): number {
    return Math.hypot(this.u, this.v);
  }

  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.u = this.v = this.r = 0;
    this.steer = 0;
    this.rearSteer = 0;
    this.ax = this.ay = 0;
    this.gear = 1;
  }

  /** Sets the world velocity (after a collision). */
  setWorldVelocity(vx: number, vz: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.u = s * vx + c * vz;
    this.v = c * vx - s * vz;
  }
}

function magic(alpha: number): number {
  const { B, C, E } = CAR_PHYSICS.tyre;
  const x = B * alpha;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

/** The slip angle (rad) at which the lateral curve peaks. */
export const PEAK_SLIP = (() => {
  let best = 0;
  let at = 0;
  for (let a = 0; a < 0.5; a += 0.0005) {
    const f = magic(a);
    if (f > best) {
      best = f;
      at = a;
    }
  }
  return at;
})();

/** Steering lock available at a speed (rad). */
export function steerLock(speed: number): number {
  const k = Math.abs(speed) / CAR_PHYSICS.steerHalfSpeed;
  return CAR_PHYSICS.steerLock / (1 + k * k);
}

/** Tractive force the motors can give at forward speed u (N, ≥ 0). */
export function motorForce(u: number, limit: number): number {
  const P = CAR_PHYSICS;
  const s = Math.abs(u);
  const powerLimited = Math.min(P.force, P.power / Math.max(s, 1e-3));
  // The governor fades the drive over the last 3 m/s to the limit.
  const governor = Math.min(1, Math.max(0, (limit - s) / 3));
  return powerLimited * governor;
}

interface Axle {
  /** Forward and left force in the body frame. */
  fx: number;
  fy: number;
  /** Use of the axle's grip (|F| / μFz). */
  use: number;
  /** Lateral slip velocity in the wheel frame (scrub). */
  slip: number;
}

/**
 * Forces of one axle: its wheel heading δ, the body-frame velocity at the axle, its normal load,
 * the longitudinal force wanted along the wheel, and whether it is locked (handbrake).
 */
function axleForces(delta: number, u: number, vAxle: number, fz: number, wantFx: number, locked: boolean, axleMass: number, grip: number, dt: number): Axle {
  const P = CAR_PHYSICS;
  const cd = Math.cos(delta);
  const sd = Math.sin(delta);
  // Velocity in the wheel's frame.
  const vxw = u * cd + vAxle * sd;
  const vyw = -u * sd + vAxle * cd;
  const fz0 = (P.mass * GRAVITY) / 2;
  const mu = grip * P.mu * (1 - P.loadSensitivity * (fz / fz0 - 1));
  const cap = mu * Math.max(fz, 0);
  let fxw: number;
  let fyw: number;
  if (locked) {
    // A locked wheel slides: kinetic friction (a little under the peak) opposes its sliding velocity,
    // so the grip across it is only the sideways share of that slide.
    const sv = Math.max(Math.hypot(vxw, vyw), 1e-3);
    const k = Math.min(cap * 0.85, (axleMass * sv) / dt);
    fxw = (-k * vxw) / sv;
    fyw = (-k * vyw) / sv;
  } else {
    // The side force the slip asks for; the drive or brake takes what is left of the friction
    // ellipse, never less than its reserve, and the side force is then held inside the ellipse.
    const alpha = Math.atan2(vyw, Math.max(Math.abs(vxw), SLIP_FLOOR));
    const sideWant = -cap * magic(alpha);
    const longCap = Math.max(cap * (1 - P.sideReserve), Math.sqrt(Math.max(0, cap * cap - sideWant * sideWant)));
    fxw = Math.max(-longCap, Math.min(longCap, wantFx));
    const side = Math.sqrt(Math.max(0, cap * cap - fxw * fxw));
    fyw = Math.max(-side, Math.min(side, sideWant));
  }
  // Never more than stops the axle's sideways creep in one step (no jitter at rest).
  const still = (axleMass * Math.abs(vyw)) / dt;
  if (Math.abs(fyw) > still) fyw = Math.sign(fyw) * still;
  return {
    fx: fxw * cd - fyw * sd,
    fy: fxw * sd + fyw * cd,
    use: cap > 0 ? Math.hypot(fxw, fyw) / cap : 0,
    slip: Math.abs(vyw),
  };
}

/** Advances the car by dt (s) in fixed steps; `collide` runs after each step (walls). */
export function stepCar(s: CarState, input: DriveInput, dt: number, carry: { t: number }, collide?: (s: CarState, dt: number) => void): void {
  carry.t += dt;
  while (carry.t >= DT) {
    carry.t -= DT;
    stepOnce(s, input);
    collide?.(s, DT);
  }
}

function stepOnce(s: CarState, input: DriveInput): void {
  const P = CAR_PHYSICS;
  const L = P.a + P.b;
  const m = P.mass;
  const speed = s.speed;

  // Gear: holding the brake at rest a moment selects reverse, the accelerator drive (so braking to
  // a stop never runs straight on into reverse).
  s.selectGear(input, DT);
  const drivePedal = s.gear > 0 ? input.throttle : input.brake;
  const brakePedal = s.gear > 0 ? input.brake : input.throttle;

  // Steering: speed-sensitive lock, wound on over a time that grows with speed, held inside the
  // front tyres' useful slip.
  const lock = steerLock(speed);
  let target = input.steer * lock;
  if (Math.abs(s.u) > 4 && !input.handbrake) {
    // The direction the front axle travels (relative to the body), and the peak-grip window round it.
    const travel = Math.atan2(s.v + P.a * s.r, Math.abs(s.u)) * Math.sign(s.u);
    const window = PEAK_SLIP * P.slipWindow;
    target = Math.max(travel - window, Math.min(travel + window, target));
  }
  const ds = target - s.steer;
  const [t0, t1] = P.steerTime;
  const windOn = t0 + (t1 - t0) * Math.min(1, speed / P.topSpeed);
  const centring = Math.abs(target) < Math.abs(s.steer) && Math.sign(ds) !== Math.sign(s.steer) ? P.steerReturn : 1;
  const maxDs = ((Math.max(lock, 0.05) / windOn) * DT) / centring;
  s.steer += Math.max(-maxDs, Math.min(maxDs, ds));
  const [f0, f1] = P.rearFade;
  const fade = 1 - Math.min(1, Math.max(0, (speed - f0) / (f1 - f0)));
  s.rearSteer = Math.max(-P.rearLock, Math.min(P.rearLock, -P.rearShare * fade * s.steer));

  // Loads with transfer from the last step's acceleration.
  const W = m * GRAVITY;
  const fzF = Math.max(0, (W * P.b) / L - (m * s.ax * P.cgHeight) / L);
  const fzR = Math.max(0, (W * P.a) / L + (m * s.ax * P.cgHeight) / L);

  // Longitudinal demand: motors (or regen), brakes, the hold at rest.
  const dir = s.gear;
  const limit = dir > 0 ? P.topSpeed : P.reverseSpeed;
  let drive = drivePedal * motorForce(s.u * dir, limit) * dir;
  // Stability control: engaged by body slip, or by a yaw rate past what the grip can turn; it trims
  // the drive when the car is sliding.
  const beta = Math.abs(s.u) > 3 ? Math.atan2(s.v, Math.abs(s.u)) : 0;
  const rKin = (s.u * (Math.tan(s.steer) - Math.tan(s.rearSteer))) / L;
  const rGrip = (P.escRate * P.mu * GRAVITY) / Math.max(Math.abs(s.u), 3);
  const rRef = Math.max(-rGrip, Math.min(rGrip, rKin));
  const bySlip = Math.abs(beta) > P.escSlip ? Math.min(1, (Math.abs(beta) - P.escSlip) / 0.15) : 0;
  const byRate = Math.abs(s.u) > 3 && Math.abs(s.r) > rGrip ? Math.min(1, (Math.abs(s.r) - rGrip) / (0.15 * rGrip)) : 0;
  const esc = input.handbrake ? 0 : Math.max(bySlip, byRate);
  drive *= 1 - 0.7 * bySlip;
  const lateral = Math.min(1, Math.abs(s.ay) / (P.mu * GRAVITY));
  drive *= 1 - P.cornerTrim * lateral * lateral;
  let brake = 0;
  const rolling = Math.abs(s.u) > 0.05 ? Math.sign(s.u) : 0;
  if (brakePedal > 0) brake = brakePedal * m * P.brakeDecel;
  else if (drivePedal < 0.02) brake = m * P.regen;
  // Brakes oppose the motion, split by the axles' loads; at rest they hold (up to what stops it in
  // one step).
  const brakeF = -rolling * brake;
  const brakeFront = fzF / Math.max(fzF + fzR, 1);
  const hold = Math.abs(s.u) <= 0.05 && drivePedal < 0.02 ? -(s.u * m) / DT : 0;
  const fxF = drive * P.driveFront + brakeF * brakeFront + hold * 0.5;
  const fxR = drive * (1 - P.driveFront) + brakeF * (1 - brakeFront) + hold * 0.5;
  const locked = input.handbrake && Math.abs(s.u) > 0.5;

  const front = axleForces(s.steer, s.u, s.v + P.a * s.r, fzF, fxF, false, (m * P.b) / L, 1, DT);
  const rear = axleForces(s.rearSteer, s.u, s.v - P.b * s.r, fzR, fxR, locked, (m * P.a) / L, P.rearGrip, DT);

  // Resistances.
  const drag = -0.5 * AIR_DENSITY * P.dragArea * s.u * Math.abs(s.u) - P.rolling * W * Math.tanh(s.u / 0.5);
  const Fx = front.fx + rear.fx + drag;
  const Fy = front.fy + rear.fy;
  let Mz = P.a * front.fy - P.b * rear.fy;
  // Stability control: pulls the yaw rate toward its reference.
  if (esc > 0) {
    const most = P.escMoment * P.mu * W * CAR.halfTrack;
    Mz += Math.max(-most, Math.min(most, -P.escGain * esc * (s.r - rRef) * P.inertia));
  }
  // Torque vectoring: only toward the reference, never past it (the stability control's side).
  const short = rRef - s.r;
  if (!input.handbrake && brakePedal < 0.05 && Math.abs(s.u) > 2 && rRef !== 0 && Math.sign(short) === Math.sign(rRef)) {
    const most = P.tvMoment * P.mu * W * CAR.halfTrack;
    Mz += Math.max(-most, Math.min(most, P.tvGain * short * P.inertia));
  }

  const du = Fx / m + s.v * s.r;
  const dv = Fy / m - s.u * s.r;
  s.u += du * DT;
  s.v += dv * DT;
  s.r += (Mz / P.inertia) * DT;
  // At rest the body does not creep or spin.
  if (Math.abs(s.u) < 0.05 && drivePedal < 0.02 && Math.abs(s.v) < 0.05) {
    s.v = 0;
    s.r *= 0.5;
  }
  s.ax = Fx / m;
  s.ay = Fy / m;
  s.yaw += s.r * DT;
  s.x += (Math.sin(s.yaw) * s.u + Math.cos(s.yaw) * s.v) * DT;
  s.z += (Math.cos(s.yaw) * s.u - Math.sin(s.yaw) * s.v) * DT;

  const R = CAR.wheelRadius;
  s.spinFront = (s.u * Math.cos(s.steer) + (s.v + P.a * s.r) * Math.sin(s.steer)) / R;
  s.spinRear = locked ? 0 : (s.u * Math.cos(s.rearSteer) + (s.v - P.b * s.r) * Math.sin(s.rearSteer)) / R;
  s.load = Math.max(-1, Math.min(1, (drive - (brakePedal > 0 ? brake : 0)) / P.force));
  s.scrub = Math.max(front.use, rear.use) * Math.min(1, Math.max(front.slip, rear.slip) / 1.5);
  s.braking = brakePedal;
  s.handbrake = locked;
}
