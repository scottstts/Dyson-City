/**
 * The Cordon (docs/field.md, "The compound"): the arcaded wall-gallery that walls the compound.
 *
 *  - Section (one profile swept along every run): a battered outer wall, the gallery's roof slab
 *    with a walkable deck between two coped parapets, a satin-gold fascia band facing into the
 *    compound and a gold cornice line facing out. Under the slab, the gallery: a covered walk
 *    behind an arcade of split arches. Each pier flares into elliptical haunches that stop 0.9 m
 *    short of their neighbour's, so every arch is open at its crown in a slot to the soffit.
 *  - Everything stands on a ceramic stylobate, 0.45 m high, the gallery's floor.
 *  - Pylons where the avenues and the Meridian end (gates bridged by the gallery deck), the craft
 *    gate where the corridor leaves (open to the sky: nothing stands on its ground), bastions at the
 *    corners, the main portal on the Axis Road (a sculpted satin-gold arch between the two tallest).
 *    Pylons are lofted squircles with a splayed foot, a black shadow band and a swept gold crown.
 *  - On the deck, the compound's header pipes (a foil-jacketed cryogen header and a gold power
 *    line) on saddles along the outer parapet; the walk keeps the inner 7.5 m.
 *
 * Runs end built into their pylons (declared seats); half piers engage the pylon faces so every bay
 * is a whole arch.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { framesFrom, girderProfile, loftRings, sweep, type Profile } from '../geometry/sweep';
import { box, extrudeBevel, orientOutward, tube, type Basis, type TubeRing } from '../geometry/solids';
import { FIELD_SLOT } from './materials/materials';
import { Parts } from './kit/parts';
import { CORDON, CORDON_PLAN, FIELD_Y, type CordonPylon, type CordonRun } from './layout';

/** The section, across the run (b: outward from the centreline) and up from the platform top. */
export const CORDON_SECTION = {
  plinth: { b0: -5.6, b1: 5.6, top: 0.45 },
  wall: { inner: 3.0, outer: 5.0 },
  slab: { under: 11.8, deck: 12.6, inner: -5.5, outer: 5.4 },
  parapet: { top: 13.7, thick: 0.4 },
  pier: { b0: -5.0, b1: -2.6, half: 0.65, foot: 0.85, spring: 6.2, slot: 0.45 },
  bay: 10.5,
} as const;

const S = CORDON_SECTION;
/** Piers and saddles bed 20 mm into what bears them (declared seats). */
const SEAT = 0.02;
const Y = FIELD_Y;

/** A run's centreline: position, tangent and outward direction at arc length s. */
interface RunPath {
  length: number;
  at(s: number): { p: Vec3; t: Vec3; o: Vec3 };
}

function runPath(run: CordonRun): RunPath {
  if (run.arc) {
    const [a0, a1] = run.arc;
    const R = CORDON.r;
    return {
      length: (a1 - a0) * R,
      at(s) {
        const a = a0 + s / R;
        const c = Math.cos(a);
        const n = Math.sin(a);
        return { p: [c * R, Y, n * R], t: [-n, 0, c], o: [c, 0, n] };
      },
    };
  }
  const [p0, p1] = run.line!;
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const t: Vec3 = [(p1[0] - p0[0]) / L, 0, (p1[1] - p0[1]) / L];
  const o: Vec3 = [t[2], 0, -t[0]];
  return { length: L, at: (s) => ({ p: [p0[0] + t[0] * s, Y, p0[1] + t[2] * s], t, o }) };
}

/** Samples along a run at most ds apart (both ends included). */
function stations(path: RunPath, ds: number): number[] {
  const n = Math.max(1, Math.ceil(path.length / ds));
  return Array.from({ length: n + 1 }, (_, i) => (path.length * i) / n);
}

/** The swept section of a run: frames along it with up as the section's t axis. */
function sweepRun(path: RunPath, profile: Profile, ds = 4, capSlot: number = FIELD_SLOT.ceramic): PolyMesh {
  const ss = stations(path, ds);
  const pts = ss.map((s) => path.at(s).p);
  const frames = framesFrom(pts, pts.map((): Vec3 => [0, 1, 0]));
  return orientOutward(sweep(frames, profile, { capSlot, crease: 30 }));
}

const C = FIELD_SLOT.ceramic;
const G = FIELD_SLOT.satin;
const B = FIELD_SLOT.bronze;

/** The deck and its parapets (with the fascia and the cornice), and below it either the wall or the bridge soffit. */
function shellProfile(bridge: boolean): Profile {
  const { slab, parapet, wall } = S;
  const pt = parapet.top;
  const c = 0.08;
  const top: [Vec2, number][] = [
    [[slab.outer, slab.under + (bridge ? 0 : -0.2)], C],
    [[slab.outer, pt - c], B],
    [[slab.outer - c, pt], B],
    [[slab.outer - parapet.thick * 1.75 + c, pt], B],
    [[slab.outer - parapet.thick * 1.75, pt - c], C],
    [[slab.outer - parapet.thick * 1.75, slab.deck], C],
    [[slab.inner + parapet.thick, slab.deck], C],
    [[slab.inner + parapet.thick, pt - c], B],
    [[slab.inner + parapet.thick - c, pt], B],
    [[slab.inner + c, pt], B],
    [[slab.inner, pt - c], G],
    [[slab.inner, slab.under + 0.15], G],
    [[slab.inner + 0.15, slab.under], bridge ? G : C],
  ];
  const below: [Vec2, number][] = bridge
    ? []
    : [
        [[wall.inner, slab.under], C],
        [[wall.inner, S.plinth.top], C],
        [[wall.outer, S.plinth.top], C],
        [[wall.outer - 0.15, slab.under - 0.5], G],
      ];
  // Counter-clockwise in (b, t): up the outside, back along the top, down the inside, out along the bottom.
  const loop = bridge ? top : [...below.slice(2), ...top, ...below.slice(0, 2)];
  // Edge i runs from loop[i] to loop[i + 1]; its slot is that of loop[i].
  return { pts: loop.map(([p]) => p), slots: loop.map(([, s]) => s) };
}

function plinthProfile(): Profile {
  const { b0, b1, top } = S.plinth;
  const c = 0.06;
  const pts: Vec2[] = [
    [b0, 0],
    [b1, 0],
    [b1, top - c],
    [b1 - c, top],
    [b0 + c, top],
    [b0, top - c],
  ];
  return { pts, slots: pts.map(() => C) };
}

/**
 * A pier's outline in (u along the run, v up from the stylobate): the shaft with its foot, and on
 * each side either an elliptical haunch rising to the slot under the soffit (half-bay `bh`), or a
 * flat back reaching `back` into a pylon.
 */
function pierOutline(left: { bh: number } | { back: number }, right: { bh: number } | { back: number }): Vec2[] {
  const { half, foot, spring, slot } = S.pier;
  const top = S.slab.under - S.plinth.top;
  const side = (sd: { bh: number } | { back: number }): Vec2[] => {
    if ('back' in sd) return [[sd.back, -SEAT], [sd.back, top + SEAT]];
    const a = sd.bh - half;
    const tMax = Math.acos(Math.min(1, slot / a));
    // The haunch keeps a 0.4 m nose at the slot (never a knife edge).
    const b = (top - 0.4 - spring) / Math.sin(tMax);
    const out: Vec2[] = [[foot, -SEAT], [foot, 0.3], [half, 0.5], [half, spring]];
    const n = 12;
    for (let i = 1; i <= n; i++) {
      const th = (tMax * i) / n;
      out.push([sd.bh - a * Math.cos(th), spring + b * Math.sin(th)]);
    }
    out.push([sd.bh - slot, top + SEAT]);
    return out;
  };
  const r = side(right);
  const l = side(left).map(([u, v]): Vec2 => [-u, v]);
  // Counter-clockwise: right side going up, then the left side coming down.
  return [...r, ...l.reverse()];
}

function pierBasis(path: RunPath, s: number): Basis {
  const f = path.at(s);
  return { o: v3.add(f.p, [0, S.plinth.top, 0]), u: f.t, v: [0, 1, 0], w: f.o };
}

/** Pylon section half-sizes at height h (a splayed foot, the taper, a black shadow band below the crown). */
function pylonRings(p: CordonPylon): { h: number; k: number; inset: number; n: number; slot: number }[] {
  const H = p.height;
  const taper = 0.16;
  const s = (h: number) => 1 - (taper * h) / H;
  const rings: { h: number; k: number; inset: number; n: number; slot: number }[] = [
    { h: -0.03, k: 1.05, inset: 0, n: 5, slot: C },
    { h: 0.5, k: 1.05, inset: 0, n: 5, slot: C },
    { h: 0.8, k: s(0.8), inset: 0, n: 5, slot: C },
    // The flutes emerge over 0.8 m and die out again under the shadow band (pylon()).
    { h: 1.6, k: s(1.6), inset: 0, n: 5, slot: C },
    { h: H - 3.4, k: s(H - 3.4), inset: 0, n: 5, slot: C },
    { h: H - 2.6, k: s(H - 2.6), inset: 0, n: 5, slot: C },
    { h: H - 2.45, k: s(H - 2.45), inset: 0.14, n: 5, slot: FIELD_SLOT.black },
    { h: H - 1.75, k: s(H - 1.75), inset: 0.14, n: 5, slot: C },
    { h: H - 1.6, k: s(H - 1.6), inset: 0, n: 5, slot: G },
  ];
  // The crown: a slender needle, its flanks slightly full (never a tent or an onion), rounding
  // from squircle to circle as it rises to a fine blunt tip.
  const K = 16;
  for (let i = 0; i <= K; i++) {
    const f = i / K;
    rings.push({ h: H + p.crown * f, k: s(H) * Math.max(0.02, (1 - f) * (1 + 0.3 * f)), inset: 0, n: 5 - 3 * Math.min(1, f * 1.5), slot: G });
  }
  return rings;
}

/** Pylon shafts are fluted: 22 shallow flutes between the foot and the shadow band. */
const FLUTES = { count: 22, depth: 0.022 } as const;

function pylon(p: CordonPylon): PolyMesh {
  const N = FLUTES.count * 4;
  const tx = -p.oz;
  const tz = p.ox;
  const rings = pylonRings(p).map(({ h, k, inset, n }) =>
    Array.from({ length: N }, (_, j): Vec3 => {
      const a = (2 * Math.PI * j) / N;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const fluted = h > 1.0 && h < p.height - 2.7;
      const fl = fluted ? 1 - FLUTES.depth * (0.5 + 0.5 * Math.cos(FLUTES.count * a)) : 1;
      const x = (p.hr * k - inset) * fl * Math.sign(c) * Math.abs(c) ** (2 / n);
      const y = (p.ht * k - inset) * fl * Math.sign(sn) * Math.abs(sn) ** (2 / n);
      return [p.x + p.ox * x + tx * y, Y + h, p.z + p.oz * x + tz * y];
    }),
  );
  const slots = pylonRings(p).map((r) => r.slot);
  return orientOutward(loftRings(rings, slots.slice(0, -1), 32));
}

/** The main portal's arch, between the portal pylons over the Axis Road, in the front's plane. */
export const PORTAL_ARCH = { spring: 16, crown: 28, k: 2.4, depth: [1.05, 0.72], width: [1.6, 1.1] } as const;

function portalArch(): PolyMesh {
  const south = CORDON_PLAN.pylons[CORDON_PLAN.portal.south];
  const north = CORDON_PLAN.pylons[CORDON_PLAN.portal.north];
  const x = CORDON.frontX;
  const zc = (south.z + north.z) / 2;
  // Ends built a metre into the pylons' faces (which lean in with the taper).
  const face = south.z - zc - south.ht * (1 - (0.16 * PORTAL_ARCH.spring) / south.height);
  const half = face + 1;
  const e = 2 / PORTAL_ARCH.k;
  const n = 48;
  const ths = Array.from({ length: n + 1 }, (_, i) => Math.PI - (Math.PI * i) / n);
  const pt = (th: number): Vec3 => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [x, Y + PORTAL_ARCH.spring + (PORTAL_ARCH.crown - PORTAL_ARCH.spring) * Math.abs(s) ** e, zc + half * Math.sign(c) * Math.abs(c) ** e];
  };
  const pts = ths.map(pt);
  const normals = pts.map((_p, i) => {
    const t = v3.norm(v3.sub(pts[Math.min(n, i + 1)], pts[Math.max(0, i - 1)]));
    return v3.cross(t, [1, 0, 0]);
  });
  const prof = (_f: unknown, i: number) => {
    const w = Math.sin(ths[i]) ** 2;
    const d = PORTAL_ARCH.depth[0] + (PORTAL_ARCH.depth[1] - PORTAL_ARCH.depth[0]) * w;
    const hw = PORTAL_ARCH.width[0] + (PORTAL_ARCH.width[1] - PORTAL_ARCH.width[0]) * w;
    const g = girderProfile({ halfWidth: hw, t0: -d, t1: d, chamferBottom: 0.12, chamferTop: 0.12, grooves: [[-d * 0.4, d * 0.4, 0.08]] });
    return { pts: g.pts, slots: g.pts.map(() => G) };
  };
  return orientOutward(sweep(framesFrom(pts, normals), prof, { crease: 30, capSlot: G }));
}

/** The header lines on the deck: (b, centre height, radius, slot). */
export const CORDON_HEADERS = [
  { name: 'cryo', b: 3.95, r: 0.34, slot: FIELD_SLOT.foil },
  { name: 'power', b: 3.0, r: 0.2, slot: FIELD_SLOT.gold },
].map((l) => ({ ...l, y: S.slab.deck + 0.3 + l.r }));

/**
 * A header line along a run: one smooth tube following the run (rings every ≤ 6 m), its section
 * stepping out to a flange pair every ≤ 24 m (the spools' joints). The ends are bare (built into
 * the pylons).
 */
function headerLine(path: RunPath, b: number, y: number, r: number, slot: number): PolyMesh {
  const rf = r * 1.32 + 0.03;
  const flange: [number, number][] = [[-0.11, r], [-0.085, rf - 0.025], [-0.06, rf], [0.06, rf], [0.085, rf - 0.025], [0.11, r]];
  const spool = Math.max(1, Math.ceil(path.length / 24));
  const joints = Array.from({ length: spool - 1 }, (_, k) => (path.length * (k + 1)) / spool);
  const plain = stations(path, 6).filter((s) => joints.every((j) => Math.abs(s - j) > 0.3));
  const samples: { s: number; r: number; flange: boolean }[] = plain.map((s) => ({ s, r, flange: false }));
  for (const j of joints) for (const [d, rr] of flange) samples.push({ s: j + d, r: rr, flange: true });
  samples.sort((p, q) => p.s - q.s);
  const rings: TubeRing[] = samples.map(({ s, r: rr }) => {
    const f = path.at(s);
    return { p: v3.add(v3.add(f.p, v3.scale(f.o, b)), [0, y, 0]), r: rr };
  });
  // A segment is flange steel when both its rings belong to a flange.
  const slots = samples.slice(0, -1).map((p, i) => (p.flange && samples[i + 1].flange ? FIELD_SLOT.steel : slot));
  return tube(rings, r > 0.3 ? 16 : 12, (i) => slots[i], { capSlot: FIELD_SLOT.steel, seed: [0, 1, 0] });
}

const SADDLE = { b0: 2.4, b1: 4.45, top: S.slab.deck + 0.32, half: 0.12 };

export function buildCordon(): Parts {
  const parts = new Parts('cordon');
  const plan = CORDON_PLAN;
  plan.pylons.forEach((p) => parts.add(`pylon:${p.name}`, pylon(p)));
  // A bronze door into each pylon's stair from the compound side, its frame proud of the tapering face.
  const doors = new PolyMesh(40);
  for (const p of plan.pylons) {
    const n: Vec3 = [-p.ox, 0, -p.oz];
    const side: Vec3 = [-n[2], 0, n[0]];
    const taper = (h: number) => p.hr * (1 - (0.16 * h) / p.height);
    const dh = 4.2;
    const outer = taper(0.8) + 0.1;
    const inner = taper(0.8 + dh) - 0.25;
    const o: Vec3 = [p.x + n[0] * (outer + inner) / 2, Y + 0.8 + dh / 2, p.z + n[2] * (outer + inner) / 2];
    doors.append(box({ o, u: side, v: [0, 1, 0], w: n }, Math.min(1.3, p.ht * 0.4), dh / 2, (outer - inner) / 2, 0.03, B));
  }
  parts.addSet('doors', doors);
  for (const run of plan.runs) {
    const path = runPath(run);
    parts.add(`${run.bridge ? 'bridge' : 'wall'}:${run.name}`, sweepRun(path, shellProfile(run.bridge)));
    if (!run.bridge) {
      parts.add(`plinth:${run.name}`, sweepRun(path, plinthProfile(), 8));
      // Piers: whole arches between the pylon faces, half piers engaged in the faces.
      const a = plan.pylons[run.from];
      const b = plan.pylons[run.to];
      const sa = a.ht * (1 - 0.55) + S.pier.half;
      const sb = path.length - (b.ht * (1 - 0.55) + S.pier.half);
      const bays = Math.max(1, Math.round((sb - sa) / S.bay));
      const bh = (sb - sa) / bays / 2;
      const piers = new PolyMesh(40);
      for (let k = 0; k <= bays; k++) {
        const s = sa + (k * (sb - sa)) / bays;
        const back = S.pier.half + 1.4;
        const outline = pierOutline(k === 0 ? { back } : { bh }, k === bays ? { back } : { bh });
        piers.append(extrudeBevel(outline, pierBasis(path, s), S.pier.b0, S.pier.b1, 0.04, C));
      }
      parts.addSet(`piers:${run.name}`, piers);
      // The gallery's back wall answers each whole pier with a pilaster, bedded in the wall and stylobate and under the soffit.
      const backs = new PolyMesh(40);
      for (let k = 1; k < bays; k++) {
        const s = sa + (k * (sb - sa)) / bays;
        const fr = path.at(s);
        const b0 = S.wall.inner - 0.38;
        const b1 = S.wall.inner + SEAT;
        const o = v3.add(v3.add(fr.p, v3.scale(fr.o, (b0 + b1) / 2)), [0, (S.plinth.top - SEAT + S.slab.under + SEAT) / 2, 0]);
        backs.append(box({ o, u: fr.o, v: fr.t, w: [0, 1, 0] }, (b1 - b0) / 2, 0.4, (S.slab.under - S.plinth.top + 2 * SEAT) / 2, 0.03, C));
      }
      if (bays > 1) parts.addSet(`gallery:${run.name}`, backs);
    }
    // The header lines (spools flanged every ≤ 24 m), on saddles every ~6 m.
    for (const h of CORDON_HEADERS) parts.add(`pipe:${run.name}:${h.name}`, headerLine(path, h.b, h.y, h.r, h.slot));
    const saddles = new PolyMesh(40);
    const sad = stations(path, 6);
    for (const s of sad.slice(1, -1)) {
      const f = path.at(s);
      const bc = (SADDLE.b0 + SADDLE.b1) / 2;
      const o = v3.add(v3.add(f.p, v3.scale(f.o, bc)), [0, (S.slab.deck - SEAT + SADDLE.top) / 2, 0]);
      saddles.append(box({ o, u: f.o, v: f.t, w: [0, 1, 0] }, (SADDLE.b1 - SADDLE.b0) / 2, SADDLE.half, (SADDLE.top - S.slab.deck + SEAT) / 2, 0.02, FIELD_SLOT.steel));
    }
    parts.addSet(`saddles:${run.name}`, saddles);
  }
  parts.add('arch:portal', portalArch());
  return parts;
}

/** Declared seats: runs, piers, pipes and the arch built into the pylons; saddles under the lines. */
export const CORDON_ALLOW: [string, string][] = [
  ['cordon:wall:', 'cordon:pylon:'],
  ['cordon:bridge:', 'cordon:pylon:'],
  ['cordon:plinth:', 'cordon:pylon:'],
  ['cordon:set:piers:', 'cordon:pylon:'],
  ['cordon:set:gallery:', 'cordon:wall:'],
  ['cordon:set:gallery:', 'cordon:plinth:'],
  ['cordon:set:doors', 'cordon:pylon:'],
  ['cordon:pipe:', 'cordon:pylon:'],
  ['cordon:set:piers:', 'cordon:wall:'],
  ['cordon:set:piers:', 'cordon:plinth:'],
  ['cordon:set:saddles:', 'cordon:wall:'],
  ['cordon:set:saddles:', 'cordon:bridge:'],
  ['cordon:set:saddles:', 'cordon:pipe:'],
  ['cordon:arch:', 'cordon:pylon:'],
];
