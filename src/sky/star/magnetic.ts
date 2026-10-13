/**
 * The star's prominences, eruptions and jets: the large events that stand off the limb. (The loop
 * forest along the limb is limbLoops.ts; the corona and chromosphere, corona.ts.)
 *
 * Kinematic plasma, not a simulation: every structure is a closed-form magnetic shape (so its
 * geometry is right) filled with noise advected along it (so it moves like gas). Real solar images
 * are optically thin glow summed along the line of sight, so everything is drawn as volumetric
 * emission and its look comes from projection: folded plasma sheets seen edge-on make the thin
 * bright loops (the "coronal veil").
 *
 *  - Prominences: twisted flux ropes, thick lacy bodies of dense cool plasma held up along one
 *    arched field line of a buried dipole (r = L·sin²θ), churning and draining down their legs;
 *    they glow against space and darken what lies behind them.
 *    Every so often one erupts: it lifts, swells and unwinds, and a coronal-mass-ejection front
 *    races ahead of it.
 *  - Jets and surges: plasma fired up open field from a footpoint like a flamethrower, widening,
 *    cooling and breaking up as it rises, then falling back.
 *
 * Time is real time, and the scale is true, but the caged star is energetic: its flows run at
 * hundreds to a few thousand km/s (the Sun's fast end), so at 700,000 km activity visibly moves —
 * a jet climbs several degrees a minute, an eruption leaves the limb in a few minutes. (The Sun in
 * space-telescope movies looks violent because those play ~360× fast; time-lapsing the star would
 * make it read as small.)
 *
 * Catalogue: unit vectors in the star frame; sizes in star radii; times in seconds of star time.
 */
import { Vector4 } from 'three/webgpu';
import { vec4Array, type Vec4Array } from '../../render/tsl/helpers';
import { mulberry32, subObserverAt, type V3 } from './features';

/** One kilometre in star radii. */
export const KM = 1 / 696_000;

export interface Rope {
  centre: V3;
  axis: V3;
  depth: number;
  /** Field-line label of the rope's axis, and the tube radius (star radii). */
  label: number;
  tube: number;
  brightness: number;
  seed: number;
  /** Eruption cycle (s). */
  period: number;
  phase: number;
}

export interface Jet {
  site: V3;
  /** Unit direction of the open field it rides up. */
  dir: V3;
  start: number;
  /** Launch speed (star radii/s), deceleration (star radii/s²), base width and spread. */
  speed: number;
  decel: number;
  width: number;
  spread: number;
  brightness: number;
  seed: number;
}

export const ROPE_COUNT = 48;
export const ROPE_SLOTS = 6;
export const JET_SLOTS = 8;

/** Eruption: lift ½·a·t² with a ≈ 8 km/s² (1,600 km/s after 200 s); gone ~0.35 R up, after ~4 min. */
export const ERUPTION_ACCELERATION = 8 * KM;
export const ERUPTION_DURATION = 260;
/** A rope reforms over this long after erupting (s). */
export const ROPE_REFORM = 1200;
/** The CME front leads the rope: its radius grows this much faster than the rope's lift. */
export const CME_FRONT_LEAD = 1.5;
/** A new jet starts somewhere on the visible limb every JET_INTERVAL seconds on average. */
export const JET_INTERVAL = 45;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix3 = (a: V3, b: V3, ca: number, cb: number): V3 => [a[0] * ca + b[0] * cb, a[1] * ca + b[1] * cb, a[2] * ca + b[2] * cb];

/** A unit tangent at `c`, `slant` radians from heliographic east (rotation axis Z). */
function tangent(c: V3, slant: number): V3 {
  const east = norm(cross([0, 0, 1], c));
  const north = norm(cross(c, east));
  return norm(mix3(east, north, Math.cos(slant), Math.sin(slant)));
}


/** Prominences of the activity belts and the polar crowns. */
export function buildRopes(seed = 5151): Rope[] {
  const rnd = mulberry32(seed);
  const out: Rope[] = [];
  for (let i = 0; i < ROPE_COUNT; i++) {
    const polar = rnd() < 0.25;
    const hemi = rnd() < 0.5 ? -1 : 1;
    const lat = hemi * (polar ? 0.95 + rnd() * 0.35 : 0.2 + rnd() * 0.55);
    const lon = ((i + rnd() * 0.7) / ROPE_COUNT) * Math.PI * 2 + 0.3;
    const centre = norm([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
    const label = 0.07 + rnd() * 0.12;
    out.push({
      centre,
      // Polar-crown filaments run east–west; belt filaments lie at a slant.
      axis: tangent(centre, polar ? (rnd() - 0.5) * 0.4 : (rnd() - 0.5) * 1.6),
      depth: label * (0.3 + rnd() * 0.15),
      label,
      tube: label * (0.22 + rnd() * 0.12),
      brightness: 0.4 + rnd() * 0.3,
      seed: rnd() * 97,
      period: 1800 + rnd() * 1800,
      phase: rnd() * 3600,
    });
  }
  return out;
}

/** Jet k: fired from a point near the limb (as seen at its start), straight up its open field. */
export function jetEvent(k: number, seed = 9091): Jet {
  const rnd = mulberry32(seed + k * 7919);
  const start = (k + (rnd() - 0.5) * 0.8) * JET_INTERVAL;
  const sub = subObserverAt(start);
  const u1 = norm(cross(sub, [0, 0, 1]));
  const u2 = cross(sub, u1);
  // Within ~10° of the limb, in front of or behind it (a jet behind the limb rises over it).
  const theta = Math.PI / 4 + (rnd() - 0.4) * 0.35;
  const psi = rnd() * Math.PI * 2;
  const site = norm(mix3(sub, mix3(u1, u2, Math.cos(psi), Math.sin(psi)), Math.cos(theta), Math.sin(theta)));
  const tilt = tangent(site, rnd() * Math.PI * 2);
  const lean = (rnd() - 0.5) * 0.6;
  return {
    site,
    dir: norm(mix3(site, tilt, Math.cos(lean), Math.sin(lean))),
    start,
    speed: (500 + rnd() * 900) * KM,
    decel: (5 + rnd() * 5) * KM,
    width: (2500 + rnd() * 3500) * KM,
    spread: 0.12 + rnd() * 0.15,
    brightness: 0.6 + rnd() * 0.6,
    seed: rnd() * 97,
  };
}

/** A jet's life (s): it climbs while v > 0, falls back, and drains for a while after. */
export function jetLifetime(j: Jet): number {
  return (2 * j.speed) / j.decel + 90;
}

/** Height of a jet's head (star radii) at age a: ballistic under the field's tension. */
export function jetHead(j: Jet, a: number): number {
  return Math.max(0, j.speed * a - 0.5 * j.decel * a * a);
}

/** Lift of an erupting rope (star radii) at eruption age a (s). */
export function eruptionLift(a: number): number {
  return a < 0 ? 0 : 0.5 * ERUPTION_ACCELERATION * a * a;
}

/** Packs the nearest-to-limb members of a list into GPU slots of `stride` vec4s each. */
class SlotPool<T> {
  readonly slots: Vec4Array;
  readonly vecs: Vector4[];
  private readonly members: readonly T[];
  private readonly count: number;
  private readonly stride: number;
  private readonly order: { i: number; d: number }[];

  constructor(members: readonly T[], count: number, stride: number) {
    this.members = members;
    this.count = count;
    this.stride = stride;
    this.vecs = Array.from({ length: count * stride }, () => new Vector4(0, 0, 0, 0));
    this.slots = vec4Array(this.vecs);
    this.order = members.map((_, i) => ({ i, d: 0 }));
  }

  /** `limbDistance(m)` ≤ 0 means visible; slots are filled nearest first, empty ones zeroed. */
  fill(limbDistance: (m: T) => number, write: (m: T, v: Vector4[], base: number) => void): void {
    for (const o of this.order) o.d = limbDistance(this.members[o.i]);
    this.order.sort((a, b) => a.d - b.d);
    for (let k = 0; k < this.count; k++) {
      for (let s = 0; s < this.stride; s++) this.vecs[k * this.stride + s].set(0, 0, 0, 0);
      const o = this.order[k];
      if (o && o.d <= 0) write(this.members[o.i], this.vecs, k * this.stride);
    }
  }
}

/** Angular distance (radians) of a footprint from the limb band where a structure of height h shows. */
function limbDistance(centre: V3, sub: V3, h: number): number {
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(centre, sub))));
  const limb = Math.PI / 4;
  // Seen above the limb from up to ~√(2h) behind it; in front, within its own size of the limb.
  return Math.max(theta - limb - Math.sqrt(2 * h), limb - theta - h - 0.12);
}

/**
 * GPU state for the magnetic atmosphere. Slot layouts (vec4s per slot):
 *
 *   rope   (4): (centre, depth) (axis, label) (tube, brightness, seed, eruption age | −1) (presence 0..1, 0, 0, 0)
 *   jet    (4): (site, width) (dir, speed) (decel, age, seed, brightness) (spread, 0, 0, 0)
 *
 * An empty slot is all zero (brightness 0).
 */
export class MagneticState {
  readonly ropeList: Rope[];
  readonly ropes: SlotPool<Rope>;
  readonly jets: { slots: Vec4Array; vecs: Vector4[] };

  constructor() {
    this.ropeList = buildRopes();
    this.ropes = new SlotPool(this.ropeList, ROPE_SLOTS, 4);
    const vecs = Array.from({ length: JET_SLOTS * 4 }, () => new Vector4(0, 0, 0, 0));
    this.jets = { vecs, slots: vec4Array(vecs) };
  }

  /** `sub`: sub-observer point (star frame). */
  update(t: number, sub: V3): void {
    this.ropes.fill(
      (r) => limbDistance(r.centre, sub, r.label),
      (r, v, b) => {
        const local = (((t + r.phase) % r.period) + r.period) % r.period;
        const age = local < ERUPTION_DURATION ? local : -1;
        // After an eruption the rope is gone, then condenses again.
        const reform = Math.min(1, Math.max(0, (local - ERUPTION_DURATION) / ROPE_REFORM));
        v[b].set(r.centre[0], r.centre[1], r.centre[2], r.depth);
        v[b + 1].set(r.axis[0], r.axis[1], r.axis[2], r.label);
        v[b + 2].set(r.tube, r.brightness, r.seed, age);
        v[b + 3].set(age >= 0 ? 1 : reform * reform * (3 - 2 * reform), 0, 0, 0);
      },
    );
    // Jets alive now: the last few started (lifetimes of a few minutes, ~45 s apart).
    let slot = 0;
    for (const v of this.jets.vecs) v.set(0, 0, 0, 0);
    const kNow = Math.floor(t / JET_INTERVAL) + 1;
    for (let k = kNow; k >= Math.max(0, kNow - 16) && slot < JET_SLOTS; k--) {
      const j = jetEvent(k);
      const age = t - j.start;
      if (age < 0 || age > jetLifetime(j)) continue;
      const b = slot * 4;
      this.jets.vecs[b].set(j.site[0], j.site[1], j.site[2], j.width);
      this.jets.vecs[b + 1].set(j.dir[0], j.dir[1], j.dir[2], j.speed);
      this.jets.vecs[b + 2].set(j.decel, age, j.seed, j.brightness);
      this.jets.vecs[b + 3].set(j.spread, 0, 0, 0);
      slot++;
    }
  }
}
