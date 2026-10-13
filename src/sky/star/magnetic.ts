/**
 * The star's quiescent prominences: the calm, lacy clouds that stand off the limb. (The loop
 * arcades are activeLayer.ts; the corona and chromosphere, corona.ts; the erupting gas, gas/.)
 *
 * Kinematic plasma, not a simulation: every prominence is a closed-form magnetic shape (so its
 * geometry is right) filled with noise advected along it (so it moves like gas). Real solar images
 * are optically thin glow summed along the line of sight, so everything is drawn as volumetric
 * emission and its look comes from projection.
 *
 * A prominence is a twisted flux rope: a thick, lacy body of dense cool plasma held up along one
 * arched field line of a buried dipole (r = L·sin²θ), churning and draining down its legs; it
 * glows against space and darkens what lies behind it.
 *
 * Catalogue: unit vectors in the star frame; sizes in star radii.
 */
import { Vector4 } from 'three/webgpu';
import { vec4Array, type Vec4Array } from '../../render/tsl/helpers';
import { mulberry32, type V3 } from './features';

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
}

export const ROPE_COUNT = 48;
export const ROPE_SLOTS = 6;

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
    });
    // Two draws that once timed eruptions: kept so the catalogue stays where it was.
    rnd();
    rnd();
  }
  return out;
}

/** Angular distance (radians) of a footprint from the limb band where a structure of height h shows. */
function limbDistance(centre: V3, sub: V3, h: number): number {
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(centre, sub))));
  const limb = Math.PI / 4;
  // Seen above the limb from up to ~√(2h) behind it; in front, within its own size of the limb.
  return Math.max(theta - limb - Math.sqrt(2 * h), limb - theta - h - 0.12);
}

/**
 * GPU state for the prominences: the ones nearest the limb, three vec4s per slot:
 *   (centre, depth) (axis, label) (tube, brightness, seed, 0)
 * An empty slot is all zero (brightness 0).
 */
export class MagneticState {
  readonly ropeList: Rope[];
  readonly ropes: Vec4Array;

  private readonly vecs: Vector4[];
  private readonly order: { i: number; d: number }[];

  constructor() {
    this.ropeList = buildRopes();
    this.vecs = Array.from({ length: ROPE_SLOTS * 3 }, () => new Vector4(0, 0, 0, 0));
    this.ropes = vec4Array(this.vecs);
    this.order = this.ropeList.map((_, i) => ({ i, d: 0 }));
  }

  /** `sub`: sub-observer point (star frame). Slots are filled nearest the limb first. */
  update(sub: V3): void {
    for (const o of this.order) {
      const r = this.ropeList[o.i];
      o.d = limbDistance(r.centre, sub, r.label);
    }
    this.order.sort((a, b) => a.d - b.d);
    for (let k = 0; k < ROPE_SLOTS; k++) {
      const v = this.vecs;
      const b = k * 3;
      for (let s = 0; s < 3; s++) v[b + s].set(0, 0, 0, 0);
      const o = this.order[k];
      if (!o || o.d > 0) continue;
      const r = this.ropeList[o.i];
      v[b].set(r.centre[0], r.centre[1], r.centre[2], r.depth);
      v[b + 1].set(r.axis[0], r.axis[1], r.axis[2], r.label);
      v[b + 2].set(r.tube, r.brightness, r.seed, 0);
    }
  }
}
