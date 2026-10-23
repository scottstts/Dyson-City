/**
 * The ship's flight on the band (docs/intro-film.md): its pose in the world at any moment of
 * scenes 2 and 3, in closed form, so the intro can jump to any time (skipping, review) and
 * nothing depends on the frame rate.
 *
 *  - Scene 2: the approach from the west, 1.9 km out and 440 m up, decelerating along a gentle S
 *    onto the Spinward axis, descending; a hover 40 m over the landing spot; a vertical descent
 *    slowing to a soft contact; the gear taking the weight (a damped settle).
 *  - Scene 3: on the ground; the lift (vertical, the gear coming up), the about-turn while rising,
 *    then the climb out on the main engines, up into the star's glare, where it is lost.
 *
 * The ship's frame: x forward, y up, z to starboard (ship/spec.ts). Yaw is about +y, 0 with the
 * nose east (+x), positive turning the nose north (−z).
 */
import { Matrix4, Quaternion, Vector3, Euler } from 'three/webgpu';
import type { Timeline } from './timeline';

/** Where the ship stands, just west of the West Gate's apron, nose to the gate (world, m). */
export const LANDING = { x: -566, z: 4.0, yaw: 0 } as const;

/** The approach's start: behind and above, a little north of the axis. */
const APPROACH = { back: 1900, height: 440, north: 140 } as const;
/** The hover's height over the spot, and the climb-out's acceleration (m/s²) and its pitch up. */
const HOVER = 40;
const CLIMB_ACCEL = 26;
const CLIMB_PITCH = 0.95;
/** Sink rate at contact (m/s): the gear takes it with a thud. */
export const CONTACT_SPEED = 0.8;
/** The lift's height before the climb-out begins (m). */
const LIFT_HEIGHT = 28;

export interface ShipPose {
  position: Vector3;
  /** Yaw, pitch (nose up +), roll (starboard down +), radians. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Gear: 1 down, 0 stowed. Strut compression under load (m). */
  gear: number;
  compression: number;
  /** Thrust: the lift engines and the main engines (0..1). */
  lift: number;
  main: number;
}

const smooth = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};
const smoother = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/**
 * Fraction of the approach flown at τ (0…1): already under way at the scene's start (she has been
 * flying), slowing all the way into the hover, so the Dome lies below and ahead for most of it
 * and comes up only at the end.
 */
function approachDistance(tau: number): number {
  const x = clamp01(tau);
  // A cubic from rate 1.6 (relative to the mean) to rest at the hover.
  return 1.6 * x - 0.2 * x * x - 0.4 * x * x * x;
}

/** The approach's ground track: a cubic from the start onto the axis, its tangent east at both ends. */
function track(s: number): { x: number; z: number; dx: number; dz: number } {
  const x0 = LANDING.x - APPROACH.back;
  const z0 = LANDING.z - APPROACH.north;
  const x1 = LANDING.x;
  const z1 = LANDING.z;
  // Hermite in z over x (the track only drifts sideways), x linear in s.
  const x = x0 + (x1 - x0) * s;
  const h = smoother(s);
  const z = z0 + (z1 - z0) * h;
  const dh = 30 * s * s * (s - 1) * (s - 1);
  return { x, z, dx: x1 - x0, dz: (z1 - z0) * dh };
}

/** The ship's pose at intro time t (scenes 2 and 3; before scene 2 it holds the approach's start). */
export function shipPose(tl: Timeline, t: number, out: ShipPose): ShipPose {
  const s2 = tl.scene2;
  const s3 = tl.scene3;
  out.gear = 1;
  out.compression = 0;
  out.lift = 0;
  out.main = 0;
  out.roll = 0;
  out.pitch = 0;
  if (t < s2.hover) {
    // The approach, from the scene's start (held before it) to the hover.
    const tau = clamp01((t - s2.start) / (s2.hover - s2.start));
    const s = approachDistance(tau);
    const p = track(s);
    const alt = HOVER + (APPROACH.height - HOVER) * (1 - smooth(Math.pow(s, 0.85)));
    out.position.set(p.x, alt, p.z);
    out.yaw = -Math.atan2(p.dz, p.dx);
    // Nose a little down while descending fast, coming up as she slows into the hover (the flare).
    out.pitch = -0.05 * (1 - tau) + 0.09 * smooth((tau - 0.62) / 0.38) * (1 - smooth((tau - 0.93) / 0.07));
    // Banking with the turn onto the axis: the track's curvature × speed².
    const sCurve = 30 * s * s * (s - 1) * (s - 1);
    out.roll = 0.14 * Math.sin(Math.PI * s) * (sCurve > 0 ? 1 : 0) * (1 - tau);
    out.gear = smooth((tau - 0.55) / 0.2);
    out.lift = 0.25 + 0.6 * smooth((tau - 0.5) / 0.4);
    out.main = 0.45 * (1 - smooth(tau / 0.7));
    return out;
  }
  if (t < s2.touchdown) {
    // The hover and the descent: 40 m to contact, slowing; a slight sway as the lift engines hold her.
    const u = (t - s2.hover) / (s2.touchdown - s2.hover);
    // A cubic from rest at the hover to contact at CONTACT_SPEED.
    const m1 = (CONTACT_SPEED * (s2.touchdown - s2.hover)) / HOVER;
    const h = HOVER * (1 - (3 * u * u - 2 * u * u * u + m1 * (u * u * u - u * u)));
    // The sway grows in from the still hover over a couple of seconds and dies away at contact;
    // started at full it lifted the cockpit 0.2 m in one frame.
    const grow = smooth(Math.min((t - s2.hover) / 2.2, 1));
    const sway = (1 - u) * 0.25 * grow;
    out.position.set(LANDING.x + Math.sin(t * 1.1) * sway, h, LANDING.z + Math.sin(t * 0.83 + 1) * sway * 0.7);
    out.yaw = LANDING.yaw + Math.sin(t * 0.7) * 0.012 * (1 - u) * grow;
    out.pitch = (0.02 + Math.sin(t * 0.9) * 0.006) * (1 - u) * grow;
    out.roll = Math.sin(t * 1.3 + 0.5) * 0.008 * (1 - u) * grow;
    out.lift = 0.82 - 0.06 * u;
    return out;
  }
  // On the ground: the gear takes her weight as a damped spring, then she rests.
  out.position.set(LANDING.x, 0, LANDING.z);
  out.yaw = LANDING.yaw;
  if (t < s3.liftoff) {
    const since = t - s2.touchdown;
    out.compression = 0.07 - 0.07 * Math.exp(-since * 3.2) * Math.cos(since * 11);
    out.pitch = -0.006 * Math.exp(-since * 3) * Math.sin(since * 9);
    out.roll = 0.004 * Math.exp(-since * 3.5) * Math.sin(since * 10);
    // The lift engines run down after contact; in scene 3 they spool up before the lift.
    out.lift = 0.76 * Math.exp(-since * 1.6) + (t > s3.spool ? 0.55 * smooth((t - s3.spool) / (s3.liftoff - s3.spool)) : 0);
    return out;
  }
  if (t < s3.depart) {
    // The lift: straight up to LIFT_HEIGHT, turning about through the second half.
    const u = (t - s3.liftoff) / (s3.depart - s3.liftoff);
    out.position.y = LIFT_HEIGHT * smooth(u);
    out.compression = 0.07 * (1 - smooth(u / 0.08));
    out.yaw = LANDING.yaw + Math.PI * smoother((u - 0.3) / 0.7);
    out.gear = 1 - smooth((u - 0.25) / 0.45);
    out.lift = 0.85;
    out.main = 0.15 * smooth((u - 0.8) / 0.2);
    out.pitch = 0.03 * Math.sin(Math.PI * u);
    return out;
  }
  // The climb-out: west and up, pitching up into the sky; it accelerates hard and is gone.
  const d = t - s3.depart;
  const pitch = CLIMB_PITCH * smooth(d / 3.5);
  out.pitch = pitch;
  out.yaw = LANDING.yaw + Math.PI;
  out.gear = 0;
  out.lift = 0.85 * (1 - smooth(d / 2.5));
  out.main = 0.3 + 0.7 * smooth(d / 1.2);
  // Distance along the climb: accelerating; its direction turns up with the pitch (integrated by the mean angle).
  const s = 0.5 * CLIMB_ACCEL * d * d;
  const mean = pitch * 0.62;
  out.position.set(LANDING.x - s * Math.cos(mean), LIFT_HEIGHT + s * Math.sin(mean), LANDING.z);
  return out;
}

export function newShipPose(): ShipPose {
  return { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, gear: 1, compression: 0, lift: 0, main: 0 };
}

const euler = new Euler();
const quat = new Quaternion();
const one = new Vector3(1, 1, 1);

/** The ship's frame as a world matrix (yaw about y, then pitch about the ship's z, then roll about x). */
export function shipMatrix(p: ShipPose, out: Matrix4): Matrix4 {
  euler.set(p.roll, p.yaw, p.pitch, 'YZX');
  quat.setFromEuler(euler);
  return out.compose(p.position, quat, one);
}
