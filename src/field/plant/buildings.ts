/**
 * The secondary plant's buildings (docs/field.md, "Secondary plant"): one builder per kind, each a
 * small assembly of named parts in its lot's frame (u along the long side, v across, up). Bodies
 * are profile sweeps (sections with their clerestory bands, eaves, parapets and roofs cut in, the
 * gable rims bevelled by an inset end section) or lathes; the fittings that make their scale legible
 * (frame ribs, doors, vents, stacks, ladders, headers, bushings) are seated into them and declared.
 *
 * Materials follow the zone (zoneTrim): the walls are ceramic everywhere; roofs and trims take the
 * precinct's metal so each precinct reads as one works.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, sweep, type Profile } from '../../geometry/sweep';
import { box, insetPolygon, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { rng, type Parts } from '../kit/parts';
import { ladder, rod } from '../kit/access';
import { pipeRun } from '../kit/pipe';
import { FIELD_Y, type Zone } from '../layout';
import type { Lot } from './lots';

const C = FIELD_SLOT.ceramic;
const K = FIELD_SLOT.black;
const BZ = FIELD_SLOT.bronze;
const ST = FIELD_SLOT.steel;
/** Bed depth of a fitting into what carries it (declared seats). */
const SEAT = 0.03;

/** The precinct's metal: roofs, trims, tanks. */
export function zoneTrim(zone: Zone): { roof: number; tank: number } {
  switch (zone) {
    case 'craft':
      return { roof: FIELD_SLOT.satin, tank: FIELD_SLOT.alloy };
    case 'instruments':
      return { roof: C, tank: FIELD_SLOT.chrome };
    case 'power':
      return { roof: BZ, tank: FIELD_SLOT.alloy };
    case 'cryo':
      return { roof: FIELD_SLOT.alloy, tank: FIELD_SLOT.foil };
    case 'science':
      return { roof: C, tank: FIELD_SLOT.chrome };
    case 'works':
      return { roof: FIELD_SLOT.satin, tank: FIELD_SLOT.alloy };
    case 'heat':
      return { roof: FIELD_SLOT.alloy, tank: FIELD_SLOT.alloy };
  }
}

/** A lot's frame: centre on the platform, u along the long side, v across, w up. */
interface Frame {
  c: Vec3;
  u: Vec3;
  v: Vec3;
}

function frameOf(l: Lot): Frame {
  const u: Vec3 = l.axis === 0 ? [1, 0, 0] : [0, 0, 1];
  return { c: [l.x, FIELD_Y, l.z], u, v: [-u[2], 0, u[0]] };
}

const P = (f: Frame, u: number, v: number, h: number): Vec3 => [f.c[0] + f.u[0] * u + f.v[0] * v, f.c[1] + h, f.c[2] + f.u[2] * u + f.v[2] * v];

/** A section (across, up) with a slot per edge, swept along u from u0 to u1; its two end rims bevelled. */
function sweepSection(f: Frame, section: [Vec2, number][], u0: number, u1: number, bevel = 0.06, capSlot = C): PolyMesh {
  // The sweep's b axis is up × u = −v: a section drawn with x along +v is mirrored into it.
  const pts = section.map(([p]): Vec2 => [-p[0], p[1]]);
  const slots = section.map(([, s]) => s);
  const inset = insetPolygon(ccwLoop(pts), bevel);
  const ccw = isCcw(pts);
  const base: Profile = { pts: ccw ? pts : [...pts].reverse(), slots: ccw ? slots : reorderSlots(slots) };
  const small: Profile = { pts: ccw ? inset : [...inset], slots: base.slots };
  const us = [u0, u0 + bevel, u1 - bevel, u1];
  // Frames: t along u, n up; the profile's b axis is n × t = up × u = −v.
  const centres = us.map((u) => P(f, u, 0, 0));
  const frames = framesFrom(centres, centres.map((): Vec3 => [0, 1, 0]));
  return orientOutward(sweep(frames, (_fr, i) => (i === 0 || i === 3 ? small : base), { capSlot, crease: 32 }));
}

function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
const isCcw = (pts: Vec2[]) => signedArea(pts) > 0;
const ccwLoop = (pts: Vec2[]) => (isCcw(pts) ? pts : [...pts].reverse());
/** Edge slots of a reversed loop: edge i of the reverse is edge (n − 2 − i) of the original. */
function reorderSlots(s: number[]): number[] {
  const n = s.length;
  return Array.from({ length: n }, (_, i) => s[(2 * n - 2 - i) % n]);
}

/**
 * Mirrors a right half into a closed section loop (counter-clockwise). `right` runs from the bottom
 * centre (0, 0) out and up to the apex on the axis (0, top); each entry's slot is that of the edge
 * leaving it. The left half's edges take the slots of the right edges they mirror.
 */
function mirrored(right: [Vec2, number][]): [Vec2, number][] {
  const m = right.length - 1;
  const out: [Vec2, number][] = right.slice(0, m).map(([p, s]) => [p, s]);
  out.push([right[m][0], right[m - 1][1]]);
  for (let j = 1; j <= m - 1; j++) {
    const [p] = right[m - j];
    out.push([[-p[0], p[1]], right[m - j - 1][1]]);
  }
  return out;
}

/** Superellipse quarter from (x0, y0) to (0, y1): exponent k (2: an ellipse). */
function vaultCurve(x0: number, y0: number, y1: number, k: number, n: number): Vec2[] {
  const e = 2 / k;
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = ((Math.PI / 2) * i) / n;
    out.push([x0 * Math.cos(t) ** e, y0 + (y1 - y0) * Math.sin(t) ** e]);
  }
  out[out.length - 1] = [0, y1];
  return out;
}

/** The vaulted hall's section: walls with a clerestory band, a flared eave, the vault. */
function hallSection(W: number, He: number, H: number, roof: number, k: number): [Vec2, number][] {
  const a = W / 2;
  const hb = He - 2.4;
  const right: [Vec2, number][] = [
    [[0, 0], C],
    [[a, 0], C],
    [[a, hb], K],
    [[a - 0.3, hb + 0.12], K],
    [[a - 0.3, He - 0.62], K],
    [[a, He - 0.5], C],
    [[a, He], BZ],
    [[a + 0.5, He + 0.18], BZ],
    [[a + 0.5, He + 0.42], roof],
  ];
  const vault = vaultCurve(a + 0.5, He + 0.42, H, k, 16);
  for (const p of vault) right.push([p, roof]);
  return mirrored(right);
}

/** Height of the hall's vault at |x| (outer surface). */
function vaultAt(x: number, a: number, He: number, H: number, k: number): number {
  const x0 = a + 0.5;
  const y0 = He + 0.42;
  const c = Math.min(1, Math.abs(x) / x0);
  // x = x0 cosᵉt → cos t = c^(1/e)
  const e = 2 / k;
  const t = Math.acos(Math.pow(c, 1 / e));
  return y0 + (H - y0) * Math.sin(t) ** e;
}

/** Frame ribs over a vault: a band following the vault, and a pilaster down each wall, every ~8 m. */
function hallRibs(f: Frame, L: number, W: number, He: number, H: number, k: number, slot: number): PolyMesh {
  const a = W / 2;
  const m = new PolyMesh(36);
  const n = Math.max(1, Math.round((L - 6) / 8));
  for (let i = 0; i <= n; i++) {
    const u = -L / 2 + 3 + ((L - 6) * i) / n;
    // The band: the vault's curve, its section 0.4 along u and 0.3 thick, bedded 0.08 in.
    const half = vaultCurve(a + 0.5, He + 0.42, H, k, 16);
    const curve: Vec2[] = [[a + 0.5, He + 0.42], ...half, ...[...half].reverse().slice(1).map(([x, y]): Vec2 => [-x, y]), [-(a + 0.5), He + 0.42]];
    const pts = curve.map(([x, y]) => P(f, u, x, y));
    const normals = curve.map(([x, y], j) => {
      const p0 = curve[Math.max(0, j - 1)];
      const p1 = curve[Math.min(curve.length - 1, j + 1)];
      const tx = p1[0] - p0[0];
      const ty = p1[1] - p0[1];
      const l = Math.hypot(tx, ty) || 1;
      // Outward normal of a curve running from +x over to −x: (ty, −tx) rotated: (−ty, tx)·(−1).
      const nx = ty / l;
      const ny = -tx / l;
      void x;
      void y;
      return v3.add(v3.scale(f.v, nx), [0, ny, 0]);
    });
    const frames = framesFrom(pts, normals);
    const prof: Vec2[] = [
      [-0.2, -0.08],
      [0.2, -0.08],
      [0.2, 0.18],
      [0.16, 0.22],
      [-0.16, 0.22],
      [-0.2, 0.18],
    ];
    m.append(orientOutward(sweep(frames, { pts: prof, slots: prof.map(() => slot) }, { capSlot: slot, crease: 32 })));
    for (const s of [-1, 1]) {
      const o = P(f, u, s * (a + 0.08), (He + 0.14 - SEAT) / 2);
      m.append(box({ o, u: f.v, v: f.u, w: [0, 1, 0] }, 0.2, 0.22, (He + 0.14 + SEAT) / 2, 0.03, slot));
    }
  }
  return m;
}

function door(f: Frame, u: number, v: number, normal: Vec3, w: number, h: number, slot: number = BZ): PolyMesh {
  // It stands 50 mm clear of the platform (no coplanar bottoms with the wall it is bedded in).
  const o = v3.add(P(f, u, v, 0.05 + h / 2), v3.scale(normal, 0.06 - SEAT));
  const side: Vec3 = [-normal[2], 0, normal[0]];
  return box({ o, u: side, v: [0, 1, 0], w: normal }, w / 2, h / 2, 0.06, 0.02, slot);
}

/** A rooftop cowl ventilator standing in a roof at height y (its base bedded below y). */
function cowl(f: Frame, u: number, v: number, y: number, r: number, slot: number): PolyMesh {
  const b: Basis = { o: P(f, u, v, y), u: f.u, v: f.v, w: [0, 1, 0] };
  return lathe([[0, -0.4], [r, -0.4], [r, 1.0], [r + 0.35, 1.2], [r + 0.35, 1.38], [r * 0.6, 1.62], [0, 1.66]], 24, b, [slot, slot, ST, ST, slot, slot]);
}

// --- builders ------------------------------------------------------------------------------------

function hall(parts: Parts, l: Lot, hangar: boolean): void {
  const f = frameOf(l);
  const rand = rng(l.seed);
  const trim = zoneTrim(l.zone);
  const roof = hangar ? FIELD_SLOT.satin : trim.roof;
  const k = hangar ? 2.6 : 2.2;
  const rise = hangar ? l.W * 0.24 : Math.min(l.W * 0.2, l.H * 0.38);
  const He = Math.max(6, l.H - rise);
  const n = `${l.name}`;
  parts.add(`${n}:body`, sweepSection(f, hallSection(l.W, He, l.H, roof, k), -l.L / 2, l.L / 2));
  parts.addSet(`${n}:ribs`, hallRibs(f, l.L, l.W, He, l.H, k, hangar ? FIELD_SLOT.satin : ST));
  // Doors on the gable(s): a hangar's whole front toward the corridor; a hall's loading door.
  const a = l.W / 2;
  if (hangar) {
    // The hangar's front is the gable at the corridor end (lot.face along the long axis, here u).
    const s = l.face;
    const dw = l.W * 0.78;
    const dh = Math.min(He - 0.6 + (vaultAt(dw / 2, a, He, l.H, k) - He) * 0.75, l.H - 1.5);
    parts.add(`${n}:door`, door(f, s * (l.L / 2), 0, v3.scale(f.u, s), dw, dh, FIELD_SLOT.satin));
  } else {
    const s = rand() < 0.5 ? -1 : 1;
    parts.add(`${n}:door`, door(f, s * (l.L / 2), 0, v3.scale(f.u, s), Math.min(0.42 * l.W, 10), Math.min(He - 1.2, 8)));
  }
  // Ventilators along the ridge.
  if (!hangar) {
    const vents = new PolyMesh(36);
    // In every other bay between the ribs.
    const nr = Math.max(1, Math.round((l.L - 6) / 8));
    for (let i = 0; i < nr; i += 2) vents.append(cowl(f, -l.L / 2 + 3 + ((l.L - 6) * (i + 0.5)) / nr, 0, l.H, 0.75, ST));
    parts.addSet(`${n}:vents`, vents);
  }
}

/** A flat-roofed body: walls with a clerestory band, a parapet round a roof set 0.3 m below it. */
function blockSection(W: number, h: number, band: boolean, roof: number): [Vec2, number][] {
  const a = W / 2;
  const right: [Vec2, number][] = [[[0, 0], C], [[a, 0], band ? K : C]];
  if (band) {
    const hb = Math.max(1.2, h - 2.6);
    right.push([[a, hb], K], [[a - 0.25, hb + 0.1], K], [[a - 0.25, h - 0.9], K], [[a, h - 0.8], C]);
    right[1][1] = C;
    right[2][1] = K;
  }
  right.push([[a, h], BZ], [[a - 0.4, h], C], [[a - 0.4, h - 0.3], roof], [[0, h - 0.3], roof]);
  return mirrored(right);
}

function chiller(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const h = Math.min(l.H, 11);
  parts.add(`${n}:body`, sweepSection(f, blockSection(l.W, h, true, FIELD_SLOT.alloy), -l.L / 2, l.L / 2));
  // Fan decks on the roof: steel plinths, each with two fan shrouds (black throats, bronze rims).
  const fans = new PolyMesh(36);
  const units = Math.max(1, Math.floor((l.L - 6) / 9));
  const roofY = h - 0.3;
  for (let i = 0; i < units; i++) {
    const u = -l.L / 2 + 3 + ((l.L - 6) * (i + 0.5)) / units;
    const hw = Math.min(l.W / 2 - 2.2, 4.2);
    fans.append(box({ o: P(f, u, 0, roofY + 0.9 - SEAT / 2), u: f.u, v: f.v, w: [0, 1, 0] }, 3.4, hw, 0.9 + SEAT / 2, 0.06, ST));
    for (const s of [-1, 1]) {
      const b: Basis = { o: P(f, u, s * hw * 0.5, roofY + 0.9), u: f.u, v: f.v, w: [0, 1, 0] };
      fans.append(lathe([[1.15, -SEAT], [1.55, -SEAT], [1.55, 0.95], [1.45, 1.05], [1.15, 1.05]], 32, b, [BZ, BZ, BZ, K, K]));
    }
  }
  parts.addSet(`${n}:fans`, fans);
  parts.add(`${n}:door`, door(f, 0, l.face * (l.W / 2), v3.scale(f.v, l.face), 6, Math.min(h - 3.2, 5)));
}

function store(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const trim = zoneTrim(l.zone);
  const a = l.W / 2;
  const He = Math.max(5, l.H - 2.4);
  const teeth = Math.max(2, Math.round(l.W / 7));
  const p = l.W / teeth;
  // A north-light sawtooth: glazed uprights (black), sloped roofs (the zone's metal).
  const sec: [Vec2, number][] = [[[-a, 0], C], [[a, 0], C], [[a, He], K]];
  for (let i = 0; i < teeth; i++) {
    const x = a - p * i;
    sec.push([[x, He + 2.4], trim.roof]);
    sec.push([[x - p, He], i === teeth - 1 ? C : K]);
  }
  // The last slope lands on the far wall's top (−a, He); close down that wall.
  const loop = sec.slice(0, -1).concat([[[-a, He], C]]);
  parts.add(`${n}:body`, sweepSection(f, loop, -l.L / 2, l.L / 2));
  // Loading doors on the lane side.
  const doors = new PolyMesh(36);
  const nd = Math.max(1, Math.floor(l.L / 18));
  for (let i = 0; i < nd; i++) doors.append(door(f, -l.L / 2 + (l.L * (i + 0.5)) / nd, l.face * a, v3.scale(f.v, l.face), 5.5, Math.min(He - 1, 5.5)));
  parts.addSet(`${n}:doors`, doors);
}

function drum(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const rand = rng(l.seed);
  const R = l.W / 2 - 3.2;
  const H = Math.min(l.H, l.cap - 2);
  const hb = H - 2.6;
  const dome = R * 0.16;
  const b: Basis = { o: f.c, u: f.u, v: f.v, w: [0, 1, 0] };
  parts.add(
    `${n}:body`,
    lathe(
      [
        [0, 0],
        [R + 0.45, 0],
        [R + 0.45, 0.45],
        [R, 0.65],
        [R, hb],
        [R - 0.28, hb + 0.12],
        [R - 0.28, H - 0.62],
        [R, H - 0.5],
        [R, H],
        [R + 0.45, H + 0.2],
        [R + 0.45, H + 0.42],
        ...Array.from({ length: 10 }, (_, i): Vec2 => {
          const t = ((i + 1) / 10) * (Math.PI / 2);
          return [(R + 0.45) * Math.cos(t), H + 0.42 + dome * Math.sin(t)];
        }).map((p, i, arr): Vec2 => (i === arr.length - 1 ? [0, p[1]] : p)),
      ],
      72,
      b,
      [C, C, C, C, K, K, K, C, BZ, BZ, ...Array(10).fill(zoneTrim(l.zone).roof)],
    ),
  );
  const top = H + 0.42 + dome;
  parts.add(`${n}:lantern`, lathe([[0, -0.3], [1.4, -0.3], [1.4, 1.1], [1.8, 1.25], [1.8, 1.45], [0, 1.65]], 32, { ...b, o: v3.add(f.c, [0, top - 0.05, 0]) }, [ST, K, BZ, BZ, BZ]));
  // Exhaust stacks in the lot's corners, each tied to the drum by a duct.
  const stacks = 1 + Math.floor(rand() * 2);
  const sTop = Math.min(H + 7 + rand() * 4, l.cap);
  for (let i = 0; i < stacks; i++) {
    const ang = Math.PI / 4 + (i === 0 ? 0 : Math.PI) + (l.face > 0 ? Math.PI / 2 : 0);
    const d = R + 2.1;
    const sx = Math.cos(ang) * d;
    const sz = Math.sin(ang) * d;
    const base = P(f, sx, sz, 0);
    const r = 0.75;
    parts.add(`${n}:stack${i}`, tube([
      { p: v3.add(base, [0, -SEAT, 0]), r: r + 0.25 },
      { p: v3.add(base, [0, 0.6, 0]), r: r + 0.25 },
      { p: v3.add(base, [0, 0.75, 0]), r },
      { p: v3.add(base, [0, sTop - 1.2, 0]), r },
      { p: v3.add(base, [0, sTop - 1.0, 0]), r: r + 0.12 },
      { p: v3.add(base, [0, sTop, 0]), r: r + 0.12 },
    ], 20, (j) => (j === 0 ? C : j === 3 || j === 4 ? BZ : ST)));
    const y = Math.min(hb - 0.6, H * 0.55);
    parts.add(`${n}:duct${i}`, pipeRun([P(f, Math.cos(ang) * (R - 0.2), Math.sin(ang) * (R - 0.2), y), P(f, sx * (1 - 0.6 / d), sz * (1 - 0.6 / d), y)], { r: 0.42, slot: ST, bareEnds: true }));
  }
}

function tanks(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const trim = zoneTrim(l.zone);
  const R = Math.min((l.W - 7) / 2, 7.5);
  const count = Math.max(1, Math.floor((l.L - 3) / (2 * R + 3)));
  const pitch = (l.L - 3) / count;
  const Ht = Math.min(l.H, l.cap - 1) - R * 0.2;
  // The bund: a low kerb round the farm (a closed sweep on a rounded rectangle).
  const hu = l.L / 2 - 0.4;
  const hv = l.W / 2 - 0.4;
  const rc = 2.5;
  const loop: Vec3[] = [];
  const corners: [number, number, number][] = [[hu - rc, hv - rc, 0], [-hu + rc, hv - rc, Math.PI / 2], [-hu + rc, -hv + rc, Math.PI], [hu - rc, -hv + rc, (3 * Math.PI) / 2]];
  for (const [cu, cv, a0] of corners) for (let i = 0; i <= 6; i++) {
    const a = a0 + (Math.PI / 2) * (i / 6);
    loop.push(P(f, cu + rc * Math.cos(a), cv + rc * Math.sin(a), 0));
  }
  const bundProf: Vec2[] = [[-0.3, 0], [0.3, 0], [0.3, 0.75], [0.22, 0.85], [-0.22, 0.85], [-0.3, 0.75]];
  const frames = framesFrom(loop, loop.map((): Vec3 => [0, 1, 0]), true);
  parts.add(`${n}:bund`, orientOutward(sweep(frames, { pts: bundProf, slots: bundProf.map(() => C) }, { closed: true, crease: 32 })));
  // The tanks: a base course, the shell, a shallow torispherical roof with a bronze rim.
  const us: number[] = [];
  for (let i = 0; i < count; i++) us.push(-l.L / 2 + 1.5 + pitch * (i + 0.5));
  us.forEach((u, i) => {
    const b: Basis = { o: P(f, u, 0.8, 0), u: f.u, v: f.v, w: [0, 1, 0] };
    const roof: Vec2[] = Array.from({ length: 9 }, (_, j): Vec2 => {
      const t = ((j + 1) / 9) * (Math.PI / 2);
      return [R * Math.cos(t), Ht + 0.3 + R * 0.2 * Math.sin(t)];
    });
    roof[roof.length - 1] = [0, roof[roof.length - 1][1]];
    parts.add(`${n}:tank${i}`, lathe([[0, -SEAT], [R + 0.35, -SEAT], [R + 0.35, 0.5], [R, 0.6], [R, Ht], [R + 0.08, Ht + 0.1], [R + 0.08, Ht + 0.3], ...roof], 64, b, [C, C, C, trim.tank, BZ, BZ, BZ, ...Array(9).fill(trim.tank)]));
    if (i === 0) parts.addSet(`${n}:ladder`, ladder(P(f, u - R * Math.sin(0.5), 0.8 - R * Math.cos(0.5), 0), Ht + 0.3, v3.norm(v3.sub(P(f, -Math.sin(0.5), -Math.cos(0.5), 0), P(f, 0, 0, 0))), 0.25));
  });
  // The fill header along the farm's front, a stub into each tank, on posts.
  // The tanks stand 0.8 m back; the header runs 1.6 m in front of their shells.
  const vh = 0.8 - R - 1.6;
  const y = 2.1;
  const pr = 0.32;
  const header = pipeRun([P(f, us[0] - 1.5, vh, y), P(f, us[us.length - 1] + 1.5, vh, y)], { r: pr, slot: ST, bareEnds: false });
  parts.add(`${n}:header`, header);
  const stubs = new PolyMesh(36);
  const posts = new PolyMesh(36);
  for (const u of us) {
    stubs.append(tube([{ p: P(f, u, vh, y), r: 0.18 }, { p: P(f, u, 0.8 - R + 0.2, y), r: 0.18 }], 12, ST));
    posts.append(box({ o: P(f, u + 1.2, vh, (y - pr + SEAT) / 2), u: f.u, v: f.v, w: [0, 1, 0] }, 0.14, 0.14, (y - pr + SEAT) / 2, 0.02, ST));
  }
  parts.addSet(`${n}:stubs`, stubs);
  parts.addSet(`${n}:posts`, posts);
}

function spheres(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const trim = zoneTrim(l.zone);
  const R = Math.min(l.W / 2 - 1.2, 8.5, (l.H - 2.6) / 2);
  const count = Math.max(1, Math.floor((l.L - 2) / (2 * R + 4)));
  const pitch = (l.L - 2) / count;
  const cy = R + 2.4;
  for (let i = 0; i < count; i++) {
    const u = -l.L / 2 + 1 + pitch * (i + 0.5);
    const b: Basis = { o: P(f, u, 0, cy), u: f.u, v: f.v, w: [0, 1, 0] };
    const prof: Vec2[] = Array.from({ length: 25 }, (_, j): Vec2 => {
      const t = -Math.PI / 2 + (Math.PI * j) / 24;
      return [j === 0 || j === 24 ? 0 : R * Math.cos(t), R * Math.sin(t)];
    });
    parts.add(`${n}:sphere${i}`, lathe(prof, 48, b, trim.tank));
    // Eight legs tangent to the equator, bedded in it; a tie ring of rods between them at 2/5 height.
    const legs = new PolyMesh(36);
    const nl = 8;
    const feet: Vec3[] = [];
    for (let k = 0; k < nl; k++) {
      const a = (2 * Math.PI * k) / nl + Math.PI / 8;
      const lr = R - 0.12;
      const top = P(f, u + Math.cos(a) * lr, Math.sin(a) * lr, cy + 0.1);
      const foot = P(f, u + Math.cos(a) * lr, Math.sin(a) * lr, -SEAT);
      feet.push(foot);
      legs.append(tube([{ p: foot, r: 0.55 }, { p: v3.add(foot, [0, 0.5, 0]), r: 0.55 }, { p: v3.add(foot, [0, 0.65, 0]), r: 0.34 }, { p: top, r: 0.34 }], 14, (j) => (j === 0 ? C : ST)));
    }
    parts.addSet(`${n}:legs${i}`, legs);
    const ties = new PolyMesh(36);
    const yt = cy * 0.4;
    for (let k = 0; k < nl; k++) {
      const a = feet[k];
      const c = feet[(k + 1) % nl];
      // Ends 0.1 m short of the leg axes (still inside the legs; no shared vertices between ties).
      const d = v3.norm(v3.sub(c, a));
      ties.append(rod(v3.add(v3.add(a, v3.scale(d, 0.1)), [0, yt, 0]), v3.add(v3.sub(c, v3.scale(d, 0.1)), [0, yt, 0]), 0.1, ST, 8));
    }
    parts.addSet(`${n}:ties${i}`, ties);
  }
}

function switchyard(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const count = Math.max(1, Math.floor((l.L - 10) / 13));
  const pitch = (l.L - 10) / count;
  const H = Math.min(l.H, l.cap - 1);
  for (let i = 0; i < count; i++) {
    const u = -l.L / 2 + 5 + pitch * (i + 0.5);
    const bh = 4.2;
    // The tank: a dark steel box on a ceramic plinth.
    parts.add(`${n}:plinth${i}`, box({ o: P(f, u, 0, 0.3 - SEAT / 2), u: f.u, v: f.v, w: [0, 1, 0] }, 4.2, 3.2, 0.3 + SEAT / 2, 0.05, C));
    parts.add(`${n}:tx${i}`, box({ o: P(f, u, 0, 0.6 + bh / 2 - SEAT / 2), u: f.u, v: f.v, w: [0, 1, 0] }, 3.2, 2.0, bh / 2 + SEAT / 2, 0.08, K));
    // Radiator banks either side: fins standing off the tank on their headers.
    const fins = new PolyMesh(36);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const fu = u - 2.4 + (4.8 * k) / 8;
        fins.append(box({ o: P(f, fu, s * (2.0 + 0.7 - SEAT / 2), 0.9 + 1.6), u: f.u, v: f.v, w: [0, 1, 0] }, 0.035, 0.7 + SEAT / 2, 1.5, 0.01, ST));
      }
    }
    parts.addSet(`${n}:fins${i}`, fins);
    // Three bushings on the lid: porcelain sheds on a bronze flange.
    const bush = new PolyMesh(36);
    for (const s of [-1, 0, 1]) {
      const b: Basis = { o: P(f, u + 1.0, s * 1.1, 0.6 + bh), u: f.u, v: f.v, w: [0, 1, 0] };
      const prof: Vec2[] = [[0, -SEAT], [0.32, -SEAT], [0.32, 0.25], [0.16, 0.3]];
      for (let k = 0; k < 6; k++) {
        const y = 0.45 + k * 0.32;
        prof.push([0.16, y - 0.1], [0.34, y], [0.34, y + 0.05], [0.16, y + 0.1]);
      }
      prof.push([0.12, 2.5], [0.2, 2.55], [0.2, 2.75], [0, 2.8]);
      bush.append(lathe(prof, 16, b, [BZ, BZ, BZ, ...Array(prof.length).fill(C)]));
    }
    parts.addSet(`${n}:bushings${i}`, bush);
  }
  // Gantries at both ends: two posts and a beam, conductors strung between the beams.
  const gh = H - 0.8;
  const gw = l.W / 2 - 1.5;
  for (const s of [-1, 1]) {
    const u = s * (l.L / 2 - 2);
    const g = new PolyMesh(36);
    for (const t of [-1, 1]) g.append(box({ o: P(f, u, t * gw, gh / 2), u: f.u, v: f.v, w: [0, 1, 0] }, 0.28, 0.28, gh / 2 + SEAT, 0.03, ST));
    parts.addSet(`${n}:gantry${s > 0 ? 'b' : 'a'}`, g);
    parts.add(`${n}:beam${s > 0 ? 'b' : 'a'}`, box({ o: P(f, u, 0, gh + 0.35), u: f.u, v: f.v, w: [0, 1, 0] }, 0.35, gw + 0.6, 0.35, 0.04, ST));
  }
  const wires = new PolyMesh(36);
  for (const t of [-0.55, 0, 0.55]) wires.append(rod(P(f, -(l.L / 2 - 2) + 0.2, t * gw, gh + 0.35), P(f, l.L / 2 - 2 - 0.2, t * gw, gh + 0.35), 0.05, BZ, 8));
  parts.addSet(`${n}:wires`, wires);
}

function lab(parts: Parts, l: Lot): void {
  const f = frameOf(l);
  const n = l.name;
  const rand = rng(l.seed);
  const tiers = l.H > 16 ? 3 : 2;
  let y = 0;
  let L = l.L;
  let W = l.W;
  let off = 0;
  const hs = tiers === 3 ? [0.42, 0.33, 0.25] : [0.58, 0.42];
  for (let i = 0; i < tiers; i++) {
    const h = l.H * hs[i];
    const sec = blockSection(W, h, true, C).map(([p, s]): [Vec2, number] => [[p[0] + off, p[1] + y - (i > 0 ? SEAT : 0)], s]);
    parts.add(`${n}:tier${i}`, sweepSection(f, sec, -L / 2, L / 2));
    y += h - 0.3 - (i > 0 ? SEAT : 0);
    // The next tier steps back from the lane side and the ends.
    L = Math.max(10, L - 4 - rand() * 6);
    const dW = 3 + rand() * 3;
    W = Math.max(8, W - dW);
    // Back from the lane side by dW, from the far side by 0.6 (inside the parapet).
    off += (-l.face * (dW - 1.2)) / 2;
  }
  // Observatories and instrument halls carry a gold dome on the top tier.
  if ((l.zone === 'instruments' || l.zone === 'science') && rand() < 0.55) {
    const r = Math.min(W, L) * 0.32;
    const b: Basis = { o: P(f, 0, off, y), u: f.u, v: f.v, w: [0, 1, 0] };
    const prof: Vec2[] = [[0, -SEAT], [r + 0.3, -SEAT], [r + 0.3, 0.6], [r, 0.7]];
    for (let k = 1; k <= 12; k++) {
      const t = (Math.PI / 2) * (k / 12);
      prof.push([k === 12 ? 0 : r * Math.cos(t), 0.7 + r * Math.sin(t)]);
    }
    parts.add(`${n}:dome`, lathe(prof, 48, b, [C, C, BZ, ...Array(12).fill(FIELD_SLOT.satin)]));
  }
  const hb0 = Math.max(1.2, l.H * hs[0] - 2.6);
  if (hb0 - 0.35 > 2.2) parts.add(`${n}:door`, door(f, 0, l.face * (l.W / 2), v3.scale(f.v, l.face), 4.5, Math.min(3.4, hb0 - 0.35)));
}

/** Builds a lot's building into `parts`. */
export function buildLot(parts: Parts, l: Lot): void {
  switch (l.kind) {
    case 'hall':
      return hall(parts, l, false);
    case 'hangar':
      return hall(parts, l, true);
    case 'chiller':
      return chiller(parts, l);
    case 'store':
      return store(parts, l);
    case 'drum':
      return drum(parts, l);
    case 'tanks':
      return tanks(parts, l);
    case 'spheres':
      return spheres(parts, l);
    case 'switchyard':
      return switchyard(parts, l);
    case 'lab':
      return lab(parts, l);
  }
}

/** Declared seats within a lot (prefix pairs under plant:<lot>:). */
export function lotAllow(l: Lot): [string, string][] {
  const p = `plant:${l.name}:`;
  const s = `plant:set:${l.name}:`;
  const pairs: [string, string][] = [
    [`${s}ribs`, `${p}body`],
    [`${p}door`, `${p}body`],
    [`${p}door`, `${s}ribs`],
    [`${s}vents`, `${p}body`],
    [`${s}fans`, `${p}body`],
    [`${s}doors`, `${p}body`],
    [`${p}lantern`, `${p}body`],
    [`${p}duct`, `${p}body`],
    [`${p}duct`, `${p}stack`],
    [`${s}ladder`, `${p}tank`],
    [`${p}header`, `${s}posts`],
    [`${s}stubs`, `${p}header`],
    [`${s}stubs`, `${p}tank`],
    [`${s}legs`, `${p}sphere`],
    [`${s}ties`, `${s}legs`],
    [`${p}tx`, `${p}plinth`],
    [`${s}fins`, `${p}tx`],
    [`${s}bushings`, `${p}tx`],
    [`${p}beam`, `${s}gantry`],
    [`${s}wires`, `${p}beam`],
    [`${p}tier`, `${p}tier`],
    [`${p}dome`, `${p}tier`],
    [`${p}door`, `${p}tier`],
  ];
  return pairs;
}
