/**
 * The Halo (city_plan.md §5.3, docs/field.md): the compound's ring main round the pad, carried on
 * white ceramic arches that straddle the ring road, so roads pass under it.
 *
 *  - Piers: sculpted ceramic arches straddling the ring road, one per station, each on two plinths
 *    through black bed joints; the lines stand on tapered stems branching from the arch's back.
 *    Spacing is irregular (17–26 m, no countable rhythm); where a road crosses under, the portals
 *    stand clear of the road and its pipe racks and the ring main spans the gap.
 *  - The ring main, on the beams: cryogen supply and return (vacuum-jacketed, foil-wrapped, flanged
 *    every 9–15 m with bellows on long runs), the power bus (a polished gold duct) and the data
 *    line (polished gold), each seated in a stem's cup and held by clamp straps at every pier.
 *  - Branches drop from the ring main at each road crossing to the pipe racks (network.ts).
 */
import { PolyMesh, v3, type Vec3 } from '../geometry/polyMesh';
import { sweep, framesFrom, girderProfile } from '../geometry/sweep';
import { basisAlong, box, lathe, orientOutward, tube, type Basis, type TubeRing } from '../geometry/solids';
import { FIELD_SLOT } from './materials/materials';
import { Parts, rng } from './kit/parts';
import { FIELD_Y, HALO, HALO_CROSSINGS } from './layout';

/** The line seat: the ring main's lines stand on stems to this height above the platform, plus their shoe. */
export const BEAM_TOP = 16.5;

/** The ring main's lines (radius about the datum, section, slot). Shoes raise each off the beam. */
export const RING_MAIN = [
  { name: 'supply', r: 102.9, kind: 'pipe', R: 1.3, shoe: 0.55, slot: FIELD_SLOT.foil },
  { name: 'power', r: 107.3, kind: 'duct', hw: 0.8, hh: 0.9, shoe: 0.45, slot: FIELD_SLOT.gold },
  { name: 'return', r: 111.3, kind: 'pipe', R: 0.95, shoe: 0.55, slot: FIELD_SLOT.foil },
  { name: 'data', r: 114.6, kind: 'pipe', R: 0.5, shoe: 0.5, slot: FIELD_SLOT.gold },
] as const;

export type RingLine = (typeof RING_MAIN)[number];

/** Centre height of a ring-main line above the platform. */
export function lineCentreY(l: RingLine): number {
  return BEAM_TOP + l.shoe + (l.kind === 'pipe' ? l.R : l.hh);
}

/** Half-angle about each crossing kept clear of portal legs: the road, its racks and clearance. */
export const CROSSING_CLEAR = 18.2;

/** Portal angles: irregular, clear of every crossing. */
export function portalAngles(): number[] {
  const rand = rng(1101);
  const ex = CROSSING_CLEAR / HALO.r;
  const cross = [...HALO_CROSSINGS].map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < cross.length; i++) {
    const a0 = cross[i] + ex;
    const a1 = (i + 1 < cross.length ? cross[i + 1] : cross[0] + 2 * Math.PI) - ex;
    const arc = (a1 - a0) * HALO.r;
    if (arc < 0) continue;
    const n = Math.max(1, Math.round(arc / 21));
    const w = Array.from({ length: n }, () => 0.75 + rand() * 0.5);
    const sum = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    out.push(a0);
    for (let k = 0; k < n; k++) {
      acc += w[k];
      out.push(a0 + ((a1 - a0) * acc) / sum);
    }
  }
  return out.map((a) => Math.atan2(Math.sin(a), Math.cos(a)));
}

const Y = FIELD_Y;

/** Local frame at plan angle φ: (radial, up, tangential). */
function portalBasis(phi: number, r: number, y: number): Basis {
  const e: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
  const t: Vec3 = [-Math.sin(phi), 0, Math.cos(phi)];
  return { o: [e[0] * r, y, e[2] * r], u: e, v: t, w: [0, 1, 0] };
}

const P = (b: Basis, x: number, y: number, z: number): Vec3 => v3.add(b.o, v3.add(v3.add(v3.scale(b.u, x), v3.scale(b.v, y)), v3.scale(b.w, z)));

/**
 * The pier: one sculpted arch straddling the ring road, in the radial plane. Its centreline is a
 * superellipse (steep legs, a full crown); its section is dressed, with a cast channel down both
 * faces, and thins from the feet to the crown. It stands on a plinth at each foot through a black
 * bed joint. The ring main's lines sit on tapered stems branching up from the arch's back.
 */
export const ARCH = {
  /** Plan radius of the arch's axis and its half-span (feet at 97.6 and 122.4: the road runs 100–120). */
  rc: HALO.r,
  half: 12.4,
  /** Springing (top of the plinths) and the centreline's crown, above the platform. */
  spring: 1.2,
  crown: 13.4,
  /** Superellipse exponent: 2 is an ellipse; higher is steeper legs and a fuller crown. */
  k: 2.4,
  /** Section: in-plane depth and across-width (half-sizes) at the feet and at the crown. */
  depth: [1.0, 0.62] as const,
  width: [1.3, 0.85] as const,
} as const;

/** The arch centreline at parameter θ ∈ [0, π] (0: outer foot, π: inner foot) as (x along the radius from rc, h). */
export function archPoint(theta: number): [number, number] {
  const e = 2 / ARCH.k;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [ARCH.half * Math.sign(c) * Math.abs(c) ** e, ARCH.spring + (ARCH.crown - ARCH.spring) * Math.abs(s) ** e];
}

/** Section half-sizes at θ (thick at the feet, thin at the crown). */
function archSection(theta: number): [number, number] {
  const t = Math.sin(theta) ** 2;
  return [ARCH.depth[0] + (ARCH.depth[1] - ARCH.depth[0]) * t, ARCH.width[0] + (ARCH.width[1] - ARCH.width[0]) * t];
}

/** Height of the arch's extrados (its back) at radial offset x from the axis (near the crown). */
export function archTop(x: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  const target = Math.abs(x);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (archPoint(m)[0] > target) lo = m;
    else hi = m;
  }
  const th = (lo + hi) / 2;
  return archPoint(th)[1] + archSection(th)[0];
}

/** Underside of the arch (soffit) at radial offset x: the road's clear height. */
export function archSoffit(x: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (archPoint(m)[0] > Math.abs(x)) lo = m;
    else hi = m;
  }
  const th = (lo + hi) / 2;
  return archPoint(th)[1] - archSection(th)[0];
}

function archPier(phi: number): PolyMesh {
  const b = portalBasis(phi, ARCH.rc, Y);
  const n = 56;
  const thetas: number[] = [];
  for (let i = 0; i <= n; i++) thetas.push(Math.PI - (Math.PI * i) / n);
  // Feet sink 20 mm into the plinths.
  const pts = thetas.map((th) => {
    const [x, h] = archPoint(th);
    return P(b, x, 0, h - (th === 0 || th === Math.PI ? 0.02 : 0));
  });
  const normals = thetas.map((_th, i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    const t = v3.norm(v3.sub(c, a));
    return v3.cross(t, b.v);
  });
  const frames = framesFrom(pts, normals);
  const prof = (_f: unknown, i: number) => {
    const [d, w] = archSection(thetas[i]);
    return girderProfile({ halfWidth: w, t0: -d, t1: d, chamferBottom: 0.1, chamferTop: 0.1, grooves: [[-d * 0.45, d * 0.45, 0.07]] });
  };
  return orientOutward(sweep(frames, prof, { crease: 30, capSlot: FIELD_SLOT.ceramic }));
}

function archPlinth(phi: number, x: number): PolyMesh {
  const b = portalBasis(phi, ARCH.rc + x, Y);
  const [d, w] = archSection(0);
  return box({ o: P(b, 0, 0, (ARCH.spring - 0.02) / 2), u: b.u, v: b.v, w: b.w }, d + 0.45, w + 0.45, (ARCH.spring + 0.02) / 2, 0.06, FIELD_SLOT.ceramic);
}

function archBed(phi: number, x: number): PolyMesh {
  const b = portalBasis(phi, ARCH.rc + x, Y);
  const [d, w] = archSection(0);
  return box({ o: P(b, 0, 0, ARCH.spring + 0.07), u: b.u, v: b.v, w: b.w }, d + 0.1, w + 0.1, 0.1, 0.025, FIELD_SLOT.black);
}

/** A stem from the arch's back up to a line: tapered, flaring into a cup the line sits in. */
function stem(phi: number, line: RingLine): PolyMesh {
  const x = line.r - ARCH.rc;
  const base = archTop(x) - 0.35;
  const under = lineCentreY(line) - (line.kind === 'pipe' ? line.R : line.hh);
  const c = (h: number): Vec3 => [Math.cos(phi) * line.r, Y + h, Math.sin(phi) * line.r];
  const len = under - base;
  const cup = line.kind === 'pipe' ? Math.min(0.75, line.R * 0.7) : line.hw * 0.8;
  const seat = line.kind === 'pipe' ? 0.09 : 0.03;
  return tube([
    { p: c(base), r: 0.42 },
    { p: c(base + len * 0.55), r: 0.3 },
    { p: c(under - 0.45), r: 0.26 },
    { p: c(under - 0.08), r: cup },
    { p: c(under + seat), r: cup },
  ], 20, FIELD_SLOT.ceramic);
}

/** Circle samples at radius r, height y, every ~ds metres (closed loop, no repeated end). */
function circle(r: number, y: number, ds: number, phase = 0): Vec3[] {
  const n = Math.ceil((2 * Math.PI * r) / ds);
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / n;
    return [Math.cos(a) * r, y, Math.sin(a) * r] as Vec3;
  });
}

/**
 * A ring-main pipe: a closed tube round the datum whose section steps out to flange pairs at its
 * joints (every 9–15 m, irregular) and to corrugated bellows on some joints. Joint positions avoid
 * the portals' shoes.
 */
function ringPipe(line: Extract<RingLine, { kind: 'pipe' }>, portals: number[], seed: number): PolyMesh {
  const rand = rng(seed);
  const y = Y + lineCentreY(line);
  const R = line.R;
  const rf = R * 1.12 + 0.05;
  const half = 0.14 + R * 0.05;
  const ch = 0.05;
  const avoid = portals.map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const joints: { a: number; bellows: boolean }[] = [];
  const C = 2 * Math.PI * line.r;
  let s = 3 + rand() * 6;
  while (s < C - 8) {
    const a = s / line.r;
    const near = avoid.some((p) => Math.abs(Math.atan2(Math.sin(a - p), Math.cos(a - p))) * line.r < 3.2);
    if (!near) joints.push({ a, bellows: rand() < 0.16 });
    s += 9 + rand() * 6;
  }
  // Rings: plain samples between joints, a stepped profile at each joint.
  const rings: TubeRing[] = [];
  const slots: number[] = [];
  const ringAt = (a: number, rr: number, slot: number) => {
    rings.push({ p: [Math.cos(a) * line.r, y, Math.sin(a) * line.r], r: rr });
    slots.push(slot);
  };
  const step = 2.2 / line.r;
  let a = 0;
  for (const j of joints) {
    const prof: [number, number, number][] = j.bellows
      ? (() => {
          const out: [number, number, number][] = [[-1.2, R, FIELD_SLOT.steel], [-1.1, R * 1.06, FIELD_SLOT.steel]];
          for (let k = 0; k < 8; k++) {
            const x0 = -1.0 + k * 0.25;
            out.push([x0 + 0.0625, R * 1.11, FIELD_SLOT.steel], [x0 + 0.125, R * 1.06, FIELD_SLOT.steel], [x0 + 0.1875, R * 1.11, FIELD_SLOT.steel], [x0 + 0.25, R * 1.06, FIELD_SLOT.steel]);
          }
          out.push([1.1, R * 1.06, FIELD_SLOT.steel], [1.2, R, line.slot]);
          return out;
        })()
      : [
          [-half - ch * 2, R, FIELD_SLOT.steel],
          [-half - ch, rf - ch, FIELD_SLOT.steel],
          [-half, rf, FIELD_SLOT.steel],
          [-0.006, rf, FIELD_SLOT.steel],
          [-0.006, rf - 0.02, FIELD_SLOT.steel],
          [0.006, rf - 0.02, FIELD_SLOT.steel],
          [0.006, rf, FIELD_SLOT.steel],
          [half, rf, FIELD_SLOT.steel],
          [half + ch, rf - ch, FIELD_SLOT.steel],
          [half + ch * 2, R, line.slot],
        ];
    const start = j.a + prof[0][0] / line.r;
    while (a < start - step * 0.3) {
      ringAt(a, R, line.slot);
      a += step;
    }
    for (const [dx, rr, sl] of prof) ringAt(j.a + dx / line.r, rr, sl);
    a = j.a + prof[prof.length - 1][0] / line.r + step;
  }
  while (a < 2 * Math.PI - step * 0.3) {
    ringAt(a, R, line.slot);
    a += step;
  }
  return tube(rings, R > 1 ? 40 : 28, (k) => slots[k], { closed: true, seed: [0, 1, 0] });
}

/** The power bus duct: a rounded rectangular section swept round the ring, polished gold cladding. */
function ringDuct(line: Extract<RingLine, { kind: 'duct' }>): PolyMesh {
  const y = Y + lineCentreY(line);
  const pts = circle(line.r, y, 2.0);
  const frames = framesFrom(pts, pts.map(() => [0, 1, 0] as Vec3), true);
  const prof = girderProfile({ halfWidth: line.hw, t0: -line.hh, t1: line.hh, chamferBottom: 0.08, chamferTop: 0.08, grooves: [[-0.2, 0.2, 0.05]], topSlot: FIELD_SLOT.gold, sideSlot: FIELD_SLOT.gold, bottomSlot: FIELD_SLOT.gold });
  return orientOutward(sweep(frames, prof, { closed: true, crease: 30 }));
}

/** A clamp strap round a pipe at a portal (seated 3 mm into the jacket), bolted down to the shoe. */
function strap(phi: number, line: Extract<RingLine, { kind: 'pipe' }>): PolyMesh {
  const y = Y + lineCentreY(line);
  const c: Vec3 = [Math.cos(phi) * line.r, y, Math.sin(phi) * line.r];
  const t: Vec3 = [-Math.sin(phi), 0, Math.cos(phi)];
  const b = basisAlong(c, t, [0, 1, 0]);
  const r0 = line.R - 0.003;
  const r1 = line.R + 0.035;
  return lathe([[r0, -0.09], [r1, -0.09], [r1 + 0.01, -0.07], [r1 + 0.01, 0.07], [r1, 0.09], [r0, 0.09]], line.R > 1 ? 40 : 28, b, FIELD_SLOT.steel);
}

export interface HaloBuild {
  parts: Parts;
  portals: number[];
}

export function buildHalo(): HaloBuild {
  const parts = new Parts('halo');
  const portals = portalAngles();
  portals.forEach((phi, i) => {
    parts.add(`arch:${i}`, archPier(phi));
    for (const s of [-1, 1]) {
      parts.add(`plinth:${i}:${s}`, archPlinth(phi, s * ARCH.half));
      parts.add(`bed:${i}:${s}`, archBed(phi, s * ARCH.half));
    }
    for (const line of RING_MAIN) {
      parts.add(`stem:${i}:${line.name}`, stem(phi, line));
      if (line.kind === 'pipe') parts.add(`strap:${i}:${line.name}`, strap(phi, line));
    }
  });
  RING_MAIN.forEach((line, k) => {
    parts.add(`line:${line.name}`, line.kind === 'pipe' ? ringPipe(line, portals, 3301 + k) : ringDuct(line));
  });
  return { parts, portals };
}
