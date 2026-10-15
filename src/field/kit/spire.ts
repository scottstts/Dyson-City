/**
 * Spires: the field's soaring vertical language (docs/field.md, "Design language"). A spire is a
 * working tower drawn as one tapering form:
 *
 *  - a fluted core with entasis (it swells slightly, then draws to a point), gold-clad;
 *  - buttress fins of white ceramic flaring from the core to the ground, so it stands on roots
 *    rather than on a box;
 *  - halo rings round it, carried on slender tapered spokes: each is a working part (a coolant
 *    header, a gallery, an antenna ring), never ornament;
 *  - gallery decks with rails where people service it, and a chrome finial.
 *
 * Every dimension is per spire; repeated spires vary in height, girth and ring placement (no
 * countable rhythm).
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, sweep } from '../../geometry/sweep';
import { basisAlong, extrudeBevel, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { ringBody } from './rings';
import { guardRail } from './access';
import type { Parts } from './parts';

export interface SpireRing {
  /** Height of the ring's plane above the spire's foot. */
  h: number;
  /** Ring centreline radius, and its section's half-sizes. */
  R: number;
  hr: number;
  ha: number;
  slot: number;
  /** Number of spokes carrying it. */
  spokes: number;
  /** A grating gallery deck inside the ring (from the core out to the ring) with a rail. */
  gallery?: boolean;
}

export interface SpireSpec {
  name: string;
  /** Foot (on the platform top). */
  x: number;
  z: number;
  y0: number;
  height: number;
  /** Core radius at the foot and at the shoulder below the tip. */
  r0: number;
  r1: number;
  /** Swelling of the core above a straight taper (fraction of r0). */
  entasis?: number;
  flutes: number;
  /** Flute depth (fraction of local radius). */
  fluteDepth?: number;
  slot?: number;
  fins: number;
  /** Fin reach on the ground (from the axis) and the height they climb to. */
  finReach: number;
  finHeight: number;
  finThickness?: number;
  rings: SpireRing[];
  /** Phase of fins and spokes (rad). */
  phase?: number;
}

/** Core radius at height h above the foot (before fluting). */
export function coreRadius(s: SpireSpec, h: number): number {
  const t = Math.min(1, Math.max(0, h / s.height));
  const taper = s.r0 + (s.r1 - s.r0) * t;
  const swell = (s.entasis ?? 0.08) * s.r0 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  // The last 12 % draws in to the finial's root.
  const draw = t > 0.88 ? 1 - ((t - 0.88) / 0.12) ** 1.6 * 0.75 : 1;
  return (taper + swell) * draw;
}

/** The fluted core: a sweep up the axis whose section is a fluted circle of the local radius. */
export function spireCore(s: SpireSpec): PolyMesh {
  const n = s.flutes;
  const per = 6;
  const depth = s.fluteDepth ?? 0.07;
  const hs: number[] = [];
  const dh = Math.max(1.0, s.height / 70);
  for (let h = -0.05; h < s.height; h += dh) hs.push(h);
  hs.push(s.height);
  const pts: Vec3[] = hs.map((h) => [s.x, s.y0 + h, s.z]);
  const frames = framesFrom(pts, pts.map(() => [1, 0, 0] as Vec3));
  const ph = s.phase ?? 0;
  const prof = (_f: unknown, i: number) => {
    const r = coreRadius(s, Math.max(0, hs[i]));
    const loop: Vec2[] = [];
    for (let k = 0; k < n * per; k++) {
      const a = ph + (2 * Math.PI * k) / (n * per);
      const flute = 0.5 * (1 - Math.cos(n * (a - ph)));
      const rr = r * (1 - depth * flute);
      loop.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return { pts: loop, slots: loop.map(() => s.slot ?? FIELD_SLOT.gold) };
  };
  return orientOutward(sweep(frames, prof, { crease: 50, capSlot: s.slot ?? FIELD_SLOT.gold }));
}

/**
 * A buttress fin at angle a: a blade of white ceramic whose outer edge sweeps in a concave curve
 * from the ground at `finReach` up to the core at `finHeight`, seated 0.3 m into the core.
 */
export function spireFin(s: SpireSpec, a: number): PolyMesh {
  const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const b: Basis = { o: [s.x, s.y0, s.z], u: out, v: [0, 1, 0], w: side };
  const outline: Vec2[] = [];
  const H = s.finHeight;
  const n = 16;
  // Inner edge: inside the core from the top of the fin down to the foot.
  outline.push([coreRadius(s, H) - 0.3, H]);
  outline.push([coreRadius(s, 0) - 0.3, -0.02]);
  // Foot along the ground to the reach, then the concave outer edge up to the core.
  outline.push([s.finReach, -0.02]);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    // A long root: it leaves the ground almost flat and rises steeply into the core.
    const h = H * Math.pow(t, 1.7);
    const r = s.finReach + (coreRadius(s, H) + 0.05 - s.finReach) * (1 - Math.pow(1 - t, 2.6));
    outline.push([r, Math.max(h, 0.6 * t)]);
  }
  const th = (s.finThickness ?? 0.32 + s.r0 * 0.07) / 2;
  return extrudeBevel(outline, b, -th, th, Math.min(0.12, th * 0.3), FIELD_SLOT.ceramic);
}

/** A halo ring with its spokes (and optionally a gallery deck and rail). */
function spireRing(parts: Parts, s: SpireSpec, k: number, r: SpireRing): void {
  const c: Vec3 = [s.x, s.y0 + r.h, s.z];
  const b: Basis = { o: c, u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
  parts.add(`${s.name}:ring${k}`, ringBody({ R: r.R, hr: r.hr, ha: r.ha, b, slot: r.slot, ds: Math.max(0.8, r.R * 0.06) }));
  const core = coreRadius(s, r.h) * (1 - (s.fluteDepth ?? 0.07));
  // Low rings take one spoke per fin gap (mid-gap, clear of the blades); higher ones are free.
  const low = s.fins > 0 && r.h < s.finHeight + 4;
  const count = low ? s.fins : r.spokes;
  const ph = (s.phase ?? 0) + Math.PI / Math.max(1, s.fins) + (low ? 0 : k * 0.31);
  for (let j = 0; j < count; j++) {
    const a = ph + (2 * Math.PI * j) / count;
    const d: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const p0 = v3.add(c, v3.scale(d, core - 0.25));
    const p1 = v3.add(c, v3.scale(d, r.R - r.hr + 0.08));
    // A tapered spoke: deeper at the core, thinner at the ring; seated in both.
    const t0 = Math.max(0.18, r.ha * 0.9);
    const t1 = Math.max(0.1, r.ha * 0.45);
    parts.add(`${s.name}:ring${k}:spoke${j}`, tube([{ p: p0, r: t0 }, { p: v3.lerp(p0, p1, 0.5), r: (t0 + t1) / 2 }, { p: p1, r: t1 }], 12, FIELD_SLOT.ceramic));
  }
  if (r.gallery) {
    const r0 = coreRadius(s, r.h + r.ha) + 0.06;
    const r1 = r.R - r.hr + 0.1;
    const segs = Math.max(32, Math.round(r.R * 6));
    parts.add(`${s.name}:ring${k}:deck`, lathe([[r0, -0.12], [r1, -0.12], [r1, 0.02], [r0, 0.02]], segs, { o: v3.add(c, [0, r.ha + 0.02, 0]), u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, [FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.grating, FIELD_SLOT.steel]));
    const rail: Vec3[] = Array.from({ length: segs }, (_, j) => {
      const a = (2 * Math.PI * j) / segs;
      return [s.x + Math.cos(a) * (r1 - 0.4), c[1] + r.ha + 0.03, s.z + Math.sin(a) * (r1 - 0.4)] as Vec3;
    });
    parts.addSet(`${s.name}:ring${k}:rail`, guardRail(rail, true));
  }
}

/** A chrome finial on the core's tip: a slender needle with a collar. */
function finial(s: SpireSpec): PolyMesh {
  const r = coreRadius(s, s.height) * 0.9;
  const len = Math.max(3, s.height * 0.06);
  return lathe([[0, -0.6], [r, -0.6], [r * 1.25, 0.15], [r * 0.8, 0.5], [r * 0.35, len * 0.6], [0, len]], 24, basisAlong([s.x, s.y0 + s.height, s.z], [0, 1, 0]), FIELD_SLOT.chrome);
}

/** Builds a spire's parts into `parts` (named `${spec.name}:…`). */
export function buildSpire(parts: Parts, s: SpireSpec): void {
  parts.add(`${s.name}:core`, spireCore(s));
  for (let k = 0; k < s.fins; k++) parts.add(`${s.name}:fin${k}`, spireFin(s, (s.phase ?? 0) + (2 * Math.PI * k) / s.fins));
  s.rings.forEach((r, k) => spireRing(parts, s, k, r));
  parts.add(`${s.name}:finial`, finial(s));
}

/**
 * The seats a spire declares (its name is `name`): fins, spokes and the finial into the core, spokes
 * into their ring, a gallery deck onto its ring and spokes, its rail onto the deck.
 */
export function spireAllow(name: string): [string, string][] {
  return [
    [`${name}:fin`, `${name}:core`],
    [`${name}:finial`, `${name}:core`],
    [`${name}:ring`, `${name}:core`],
    [`${name}:ring`, `${name}:ring`],
  ];
}
