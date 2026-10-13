/**
 * Prominences: sheets and arcades of cooler, denser plasma held up in the star's magnetic field,
 * 40,000–140,000 km tall — the features eclipse photographs make familiar as the living edge of
 * the Sun. Seen in broadband they are physically far too faint next to the photosphere; they are
 * drawn here because they read as real and carry scale (a deliberate departure, see docs/sky.md).
 *
 * Everything else about them is kept true: their sizes, their pink (Balmer and helium line emission),
 * their place on the star (they rotate with it and rise over the limb from behind), and their
 * speeds — threads stream at ~20 km/s (a slow drift at 700,000 km), and eruptions climb to several
 * hundred km/s over tens of minutes (a few degrees a minute).
 *
 * Catalogue: unit vectors in the star frame; heights and lengths in star radii.
 */
import { Vector4 } from 'three/webgpu';
import { vec4Array, type Vec4Array } from '../../render/tsl/helpers';
import { mulberry32, slerpOffset, type V3 } from './features';

export interface Prominence {
  /** Centre of the footprint on the star and the unit tangent along its length. */
  centre: V3;
  axis: V3;
  /** Half-length along the surface (radians) and height (star radii). */
  halfLength: number;
  height: number;
  /** 0 = hedgerow sheet, 1 = loop arcade. */
  kind: number;
  seed: number;
  /** Eruption cycle: period (s) and phase (s). */
  period: number;
  phase: number;
}

export const PROMINENCE_COUNT = 40;
export const PROMINENCE_SLOTS = 8;
/** An eruption lasts this long (s) before the prominence reforms. */
export const ERUPTION_DURATION = 2400;
/** Eruption lift: ½·a·t² with a (star radii / s²) reaching ~350 km/s after ~25 min. */
export const ERUPTION_ACCELERATION = 3.4e-7;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Prominences of the activity belts and the polar crowns, spread around the star. */
export function buildProminences(seed = 4242): Prominence[] {
  const rnd = mulberry32(seed);
  const out: Prominence[] = [];
  for (let i = 0; i < PROMINENCE_COUNT; i++) {
    const polar = rnd() < 0.25;
    const hemi = rnd() < 0.5 ? -1 : 1;
    const lat = hemi * (polar ? 0.95 + rnd() * 0.35 : 0.2 + rnd() * 0.55);
    const lon = ((i + rnd() * 0.7) / PROMINENCE_COUNT) * Math.PI * 2;
    // Star frame: rotation about Z; latitude from the XY plane.
    const centre: V3 = norm([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
    const east = norm(cross([0, 0, 1], centre));
    const north = norm(cross(centre, east));
    // Polar-crown filaments run east–west; belt filaments lie at a slant.
    const slant = polar ? (rnd() - 0.5) * 0.4 : (rnd() - 0.5) * 1.6;
    const axis = norm([
      east[0] * Math.cos(slant) + north[0] * Math.sin(slant),
      east[1] * Math.cos(slant) + north[1] * Math.sin(slant),
      east[2] * Math.cos(slant) + north[2] * Math.sin(slant),
    ]);
    const kind = rnd() < 0.35 ? 1 : 0;
    out.push({
      centre,
      axis,
      halfLength: kind === 1 ? 0.05 + rnd() * 0.07 : 0.07 + rnd() * 0.15,
      height: kind === 1 ? 0.07 + rnd() * 0.1 : 0.06 + rnd() * 0.14,
      kind,
      seed: rnd() * 97,
      period: 9000 + rnd() * 9000,
      phase: rnd() * 18000,
    });
  }
  return out;
}

/** Age (s) of the current eruption of a prominence at star time t, or −1 when quiescent. */
export function eruptionAge(p: Prominence, t: number): number {
  const local = (((t + p.phase) % p.period) + p.period) % p.period;
  return local < ERUPTION_DURATION ? local : -1;
}

/**
 * GPU slots for the prominences nearest the limb. Per slot three vec4s (slot·3 + k):
 *   0: (centre.xyz, halfLength)   1: (axis.xyz, height)   2: (seed, kind, eruption age or −1, active)
 */
export class ProminenceState {
  readonly catalogue: Prominence[];
  readonly slots: Vec4Array;
  private readonly vecs: Vector4[];
  private readonly order: { i: number; d: number }[];

  constructor(seed?: number) {
    this.catalogue = buildProminences(seed);
    this.vecs = Array.from({ length: PROMINENCE_SLOTS * 3 }, () => new Vector4(0, 0, 0, 0));
    this.slots = vec4Array(this.vecs);
    this.order = this.catalogue.map((_, i) => ({ i, d: 0 }));
  }

  /** `sub`: sub-observer point (star frame). The limb is 45° from it; features behind it rise over it. */
  update(t: number, sub: V3): void {
    const limb = Math.PI / 4;
    for (const o of this.order) {
      const p = this.catalogue[o.i];
      const theta = Math.acos(Math.max(-1, Math.min(1, dot(p.centre, sub))));
      // Distance from the limb, allowing for the prominence's own length.
      o.d = Math.max(0, Math.abs(theta - limb) - p.halfLength * 0.6);
    }
    this.order.sort((a, b) => a.d - b.d);
    for (let k = 0; k < PROMINENCE_SLOTS; k++) {
      const o = this.order[k];
      const p = this.catalogue[o.i];
      const visible = o.d < 0.45;
      this.vecs[k * 3].set(p.centre[0], p.centre[1], p.centre[2], p.halfLength);
      this.vecs[k * 3 + 1].set(p.axis[0], p.axis[1], p.axis[2], p.height);
      this.vecs[k * 3 + 2].set(p.seed, p.kind, eruptionAge(p, t), visible ? 1 : 0);
    }
  }
}

/** A point on the prominence's footprint (for tests and diagnostics). */
export function footprintPoint(p: Prominence, u: number): V3 {
  return slerpOffset(p.centre, p.axis, u * p.halfLength);
}
