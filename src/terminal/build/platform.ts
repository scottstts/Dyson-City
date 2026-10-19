/**
 * The Stand's built form (docs/terminal.md): the drum and its deck, the black plinth it floats on,
 * the bronze coping round its rim, the ramp between its ceramic cheeks, the stair, the bronze joint
 * strips and nosings, and the balustrade (bronze posts and rail, steel infill rods) that runs round
 * the rim and down both flights. Every part is a closed solid (field/kit/parts.ts), named for the
 * audits; parts meeting another solid on a plane meet inside it (the ramp's and the stair's ends
 * against the drum's chords), and anything resting on a surface is sunk a few millimetres into it.
 */
import { at, box, ccw, extrudeBevel, insetPolygon, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { newell, PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { sweep, framesFrom, type Profile } from '../../geometry/sweep';
import { Parts } from '../../field/kit/parts';
import { FIELD_Y } from '../../field/layout';
import { STAND_SLOT } from '../materials';
import {
  DECK_Y, RAIL, RAIL_R, RAMP, RAMP_FOOT, RAMP_LENGTH, RAMP_OUTER, RAMP_RAIL_Q, RAMP_TOP, STAIR, STAIR_FOOT, STAIR_OUTER, STAIR_RAIL_Q, STAIR_TOP, STAND,
  dir, rampRise, railRuns, standOutline, stairTread, type RailEnd,
} from '../layout';

const S = STAND_SLOT;

/** Plan outlines (x, z) map to (u, v) = (x, −z) in this basis, extruded up along w. */
const PLAN: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };

/** A notch's frame: u forward (out from the centre along it), v up, w lateral (forward turned +90°). */
function notchBasis(angle: number): Basis {
  const [fx, fz] = dir(angle);
  return { o: [STAND.cx, 0, STAND.cz], u: [fx, 0, fz], v: [0, 1, 0], w: [-fz, 0, fx] };
}

/** Re-slots faces by their normal (e.g. a solid's treads and risers). */
function reslot(m: PolyMesh, slotOf: (n: Vec3, current: number) => number): PolyMesh {
  m.faces.forEach((f, i) => {
    m.faceMat[i] = slotOf(v3.norm(newell(m.verts, f)), m.faceMat[i]);
  });
  return m;
}

/** A box in a notch's frame from (f0, y0, l0) to (f1, y1, l1). */
function notchBox(angle: number, f0: number, f1: number, y0: number, y1: number, l0: number, l1: number, bevel: number, slot: number): PolyMesh {
  const b = notchBasis(angle);
  const o = at(b, (f0 + f1) / 2, (y0 + y1) / 2, (l0 + l1) / 2);
  return box({ ...b, o }, (f1 - f0) / 2, (y1 - y0) / 2, (l1 - l0) / 2, bevel, slot);
}

// --- the drum, its plinth and coping ---------------------------------------------------------------

function drum(parts: Parts): void {
  const outline = ccw(standOutline().map(([x, z]) => [x, -z] as Vec2));
  const body = extrudeBevel(outline, PLAN, FIELD_Y + STAND.plinth.h, DECK_Y, 0.01, S.ceramic, S.deck);
  // The underside's ring past the plinth is ceramic, not deck.
  parts.add('drum', reslot(body, (n, s) => (n[1] < -0.9 ? S.ceramic : s)));
  const plinth = insetPolygon(outline, STAND.plinth.inset);
  parts.add('plinth', extrudeBevel(plinth, PLAN, FIELD_Y - STAND.sink, FIELD_Y + STAND.plinth.h + 0.01, 0.004, S.black));
}

/** The rim's arcs between the notches (increasing angle, radians). */
function rimArcs(): [number, number][] {
  const br = Math.asin(RAMP_OUTER / STAND.R);
  const bs = Math.asin(STAIR_OUTER / STAND.R);
  const up = (a: number, base: number) => {
    let x = a;
    while (x < base) x += 2 * Math.PI;
    return x;
  };
  const r1 = RAMP.angle + br;
  return [
    [r1, up(STAIR.angle - bs, r1)],
    [up(STAIR.angle + bs, r1), up(RAMP.angle - br, r1)],
  ];
}

/** Points on a horizontal arc about the Stand's centre. */
function arcPoints(r: number, a0: number, a1: number, y: number, ds: number): Vec3[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / ds));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([STAND.cx + r * Math.cos(a), y, STAND.cz + r * Math.sin(a)]);
  }
  return out;
}

/** The bronze coping: an angle wrapped over the rim's arris, 4 mm proud of the deck, 6 mm off the fascia. */
function coping(parts: Parts): void {
  const profile: Profile = {
    pts: [
      [-0.014, -0.065],
      [0.006, -0.065],
      [0.006, 0],
      [0.002, 0.004],
      [-0.014, 0.004],
    ],
  };
  rimArcs().forEach(([a0, a1], i) => {
    const pts = arcPoints(STAND.R, a0, a1, DECK_Y, 0.15);
    const frames = framesFrom(pts, pts.map(() => [0, 1, 0] as Vec3));
    const m = sweep(frames, { ...profile, slots: profile.pts.map(() => S.bronze) }, { capSlot: S.bronze, crease: 40 });
    parts.add(`coping${i}`, m);
  });
}

// --- the ramp ----------------------------------------------------------------------------------------

/** Samples of the ramp's surface from its foot (s = 0) to the chord, finer through the transitions. */
function rampSamples(): number[] {
  const out: number[] = [];
  const L = RAMP_LENGTH;
  const t = RAMP.transition;
  for (let s = 0.011; s < t - 0.05; s += 0.12) out.push(s);
  out.push(t);
  // The straight run needs only its ends (points along it would be collinear: sliver triangles).
  if (L - t > t + 0.01) out.push(L - t);
  for (let s = L - t + 0.12; s < L - 0.05; s += 0.12) out.push(s);
  out.push(L);
  return out;
}

function ramp(parts: Parts): void {
  // Hidden bottoms below the pad, at different depths so no two of them share a plane.
  const bottom = FIELD_Y - STAND.sink - 0.005;
  const cheekBottom = FIELD_Y - STAND.sink - 0.015;
  // The running surface, in (forward, y): its foot's lip bevelled down to the pad.
  const poly: Vec2[] = [
    [RAMP_FOOT, bottom],
    [RAMP_FOOT, FIELD_Y + 0.004],
    ...rampSamples().map((s) => [RAMP_FOOT - s, FIELD_Y + rampRise(s)] as Vec2),
    [RAMP_TOP, bottom],
  ];
  const b = notchBasis(RAMP.angle);
  parts.add('ramp', extrudeBevel(poly, b, -RAMP.half - 0.02, RAMP.half + 0.02, 0, S.ramp, S.ramp));
  // The cheeks: kerbs 15 cm over the surface, carried 0.3 m onto the deck for the newels.
  for (const side of [-1, 1]) {
    const top: Vec2[] = [
      [RAMP_FOOT + 0.02, FIELD_Y + rampRise(0) + RAMP.kerb],
      ...rampSamples().map((s) => [RAMP_FOOT - s, FIELD_Y + rampRise(s) + RAMP.kerb] as Vec2),
      [RAMP_TOP - 0.3, DECK_Y + RAMP.kerb],
    ];
    const cheek: Vec2[] = [[RAMP_FOOT + 0.02, cheekBottom], ...top, [RAMP_TOP - 0.3, cheekBottom]];
    const l0 = side < 0 ? -RAMP_OUTER : RAMP.half;
    const l1 = side < 0 ? -RAMP.half : RAMP_OUTER;
    parts.add(`ramp-cheek${side < 0 ? 'L' : 'R'}`, extrudeBevel(cheek, b, l0, l1, 0.01, S.ceramic));
  }
  // The expansion joint at the top: a bronze strip across the running surface, into both cheeks.
  parts.add('ramp-joint', notchBox(RAMP.angle, RAMP_TOP - 0.035, RAMP_TOP + 0.035, DECK_Y - 0.006, DECK_Y + 0.003, -RAMP.half - 0.01, RAMP.half + 0.01, 0.002, S.bronze));
  // The foot: a bronze threshold plate over the lip, its leading edge bevelled to the pad.
  const plate: Vec2[] = [
    [RAMP_FOOT + 0.05, FIELD_Y - 0.002],
    [RAMP_FOOT + 0.05, FIELD_Y + 0.001],
    [RAMP_FOOT + 0.02, FIELD_Y + 0.006],
    [RAMP_FOOT - 0.06, FIELD_Y + rampRise(0.06) + 0.004],
    [RAMP_FOOT - 0.06, FIELD_Y + rampRise(0.06) - 0.006],
    [RAMP_FOOT - 0.0, FIELD_Y - 0.002],
  ];
  parts.add('ramp-foot', extrudeBevel(plate, b, -RAMP.half - 0.01, RAMP.half + 0.01, 0, S.bronze));
}

// --- the stair ---------------------------------------------------------------------------------------

/**
 * Ear clipping that never cuts a zero-area ear. A uniform stair's inner corners all lie on its
 * pitch line, and a general triangulator joins three of them into a sliver.
 */
function earClip(poly: Vec2[]): [number, number, number][] {
  const area = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let total = 0;
  for (let i = 0; i < poly.length; i++) total += area([0, 0], poly[i], poly[(i + 1) % poly.length]);
  const sign = Math.sign(total);
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const s = area(poly[i0], poly[i1], poly[i2]) * sign;
      if (s <= 1e-9) continue;
      const inside = idx.some((j) => {
        if (j === i0 || j === i1 || j === i2) return false;
        const p = poly[j];
        return area(poly[i0], poly[i1], p) * sign >= -1e-12 && area(poly[i1], poly[i2], p) * sign >= -1e-12 && area(poly[i2], poly[i0], p) * sign >= -1e-12;
      });
      if (inside) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) {
      // Only collinear ears left: drop a middle vertex of a straight run (it adds no area).
      const k = idx.findIndex((_, k2) => Math.abs(area(poly[idx[(k2 - 1 + idx.length) % idx.length]], poly[idx[k2]], poly[idx[(k2 + 1) % idx.length]])) <= 1e-9);
      if (k < 0) break;
      idx.splice(k, 1);
    }
  }
  if (idx.length === 3 && Math.abs(area(poly[idx[0]], poly[idx[1]], poly[idx[2]])) > 1e-9) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** A profile (counter-clockwise or not) extruded along a basis's w, its caps triangulated by earClip. */
function prism(poly: Vec2[], b: Basis, l0: number, l1: number, slot: number): PolyMesh {
  const m = new PolyMesh(30);
  const n = poly.length;
  const a = poly.map(([x, y]) => m.vert(at(b, x, y, l0)));
  const c = poly.map(([x, y]) => m.vert(at(b, x, y, l1)));
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const e = Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
    m.face([a[i], a[j], c[j], c[i]], slot, [[u, 0], [u + e, 0], [u + e, l1 - l0], [u, l1 - l0]]);
    u += e;
  }
  for (const [i, j, k] of earClip(poly)) {
    m.face([a[k], a[j], a[i]], slot, [poly[k], poly[j], poly[i]]);
    m.face([c[i], c[j], c[k]], slot, [poly[i], poly[j], poly[k]]);
  }
  return orientOutward(m);
}

function stair(parts: Parts): void {
  const bottom = FIELD_Y - STAND.sink - 0.008;
  const cheekBottom = FIELD_Y - STAND.sink - 0.018;
  const c = 0.008;
  const poly: Vec2[] = [[STAIR_FOOT, bottom]];
  for (let k = 1; k < STAIR.risers; k++) {
    const { y, front } = stairTread(k);
    const next = k + 1 < STAIR.risers ? stairTread(k + 1).front : STAIR_TOP;
    poly.push([front, FIELD_Y + y - c], [front - c, FIELD_Y + y], [next, FIELD_Y + y]);
  }
  poly.push([STAIR_TOP, bottom]);
  const b = notchBasis(STAIR.angle);
  const flight = prism(poly, b, -STAIR.half - 0.02, STAIR.half + 0.02, S.ceramic);
  parts.add('stair', reslot(flight, (n) => (n[1] > 0.9 ? S.tread : S.ceramic)));
  // Cheeks: their tops 15 cm over the nosing line, carried onto the deck.
  const line = (f: number) => FIELD_Y + STAIR.rise + ((STAIR_FOOT - f) / (STAIR_FOOT - STAIR_TOP)) * (STAND.H - STAIR.rise);
  for (const side of [-1, 1]) {
    const cheek: Vec2[] = [
      [STAIR_FOOT + 0.02, cheekBottom],
      [STAIR_FOOT + 0.02, line(STAIR_FOOT) + STAIR.kerb],
      [STAIR_TOP, DECK_Y + STAIR.kerb],
      [STAIR_TOP - 0.3, DECK_Y + STAIR.kerb],
      [STAIR_TOP - 0.3, cheekBottom],
    ];
    const l0 = side < 0 ? -STAIR_OUTER : STAIR.half;
    const l1 = side < 0 ? -STAIR.half : STAIR_OUTER;
    parts.add(`stair-cheek${side < 0 ? 'L' : 'R'}`, extrudeBevel(cheek, b, l0, l1, 0.01, S.ceramic));
  }
  // Bronze nosings on every tread and on the deck's edge.
  const nosing = new PolyMesh();
  for (let k = 1; k <= STAIR.risers; k++) {
    const y = k < STAIR.risers ? FIELD_Y + stairTread(k).y : DECK_Y;
    const front = k < STAIR.risers ? stairTread(k).front : STAIR_TOP;
    nosing.append(notchBox(STAIR.angle, front - 0.05, front - 0.014, y - 0.002, y + 0.003, -STAIR.half + 0.06, STAIR.half - 0.06, 0.0015, S.bronze));
  }
  parts.addSet('stair-nosings', nosing);
}

// --- the balustrade ---------------------------------------------------------------------------------

/** A post: a bronze flange sunk 2 mm into what it stands on, and a chamfered square shaft. */
function post(x: number, z: number, y0: number, y1: number, half: number, facing: number, cap: boolean): PolyMesh {
  const m = new PolyMesh();
  const up: Basis = { o: [x, y0 - 0.002, z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  const fr = half * 1.5;
  m.append(lathe([[0, 0], [fr, 0], [fr, 0.006], [fr - 0.008, 0.012], [0, 0.012]], 20, up, S.bronze, 38));
  const [rx, rz] = dir(facing);
  const shaftH = y1 - y0;
  const shaft: Basis = { o: [x, y0 + shaftH / 2 + 0.004, z], u: [rx, 0, rz], v: [rz, 0, -rx], w: [0, 1, 0] };
  m.append(box(shaft, half, half, shaftH / 2, Math.min(0.008, half * 0.25), S.bronze));
  if (cap) {
    // A newel's cap: a turned bronze knop over the rail.
    const top: Basis = { o: [x, y1 - 0.004, z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
    const r = half * 1.2;
    m.append(lathe([[0, 0], [r, 0], [r, 0.012], [r * 0.82, 0.03], [r * 0.45, 0.045], [0, 0.05]], 24, top, S.bronze, 40));
  }
  return m;
}

/** A tube through points (radius r). */
function rod(pts: Vec3[], r: number, slot: number, segments: number): PolyMesh {
  return tube(pts.map((p) => ({ p, r })), segments, slot, { capSlot: slot, crease: 50 });
}

/** One run of the rim's balustrade between two newels. */
function rimRun(parts: Parts, i: number, a0: number, a1: number, base0: number, base1: number): void {
  const m = new PolyMesh();
  const len = (a1 - a0) * RAIL_R;
  const n = Math.max(1, Math.round(len / RAIL.pitch));
  const railTop = DECK_Y + RAIL.height;
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    const end = k === 0 || k === n;
    const [x, z] = [STAND.cx + RAIL_R * Math.cos(a), STAND.cz + RAIL_R * Math.sin(a)];
    const base = k === 0 ? base0 : k === n ? base1 : DECK_Y;
    m.append(post(x, z, base, end ? railTop + 0.05 : railTop, end ? RAIL.newel / 2 : RAIL.post / 2, a, end));
  }
  // Rail and rods end inside the newels.
  const inset = (RAIL.newel * 0.3) / RAIL_R;
  m.append(rod(arcPoints(RAIL_R, a0 + inset, a1 - inset, railTop, 0.12), RAIL.rail, S.bronze, 14));
  for (const h of RAIL.rods) m.append(rod(arcPoints(RAIL_R, a0 + inset, a1 - inset, DECK_Y + h, 0.12), RAIL.rod, S.steel, 8));
  parts.addSet(`rail${i}`, m);
}

/** A flight's side balustrade: a newel at its foot, posts between, rail and rods along `surface` into the rim's newel at its top. */
function flightRun(parts: Parts, name: string, angle: number, q: number, fTop: number, fFoot: number, surface: (f: number) => number, kerb: number, posts: number): void {
  const b = notchBasis(angle);
  const P = (f: number, y: number): Vec3 => at(b, f, y, q);
  const m = new PolyMesh();
  const fs: number[] = [];
  for (let k = 0; k <= posts + 1; k++) fs.push(fTop + ((fFoot - fTop) * k) / (posts + 1));
  fs.forEach((f, k) => {
    if (k === 0) return;
    const end = k === 0 || k === fs.length - 1;
    const [x, , z] = P(f, 0);
    const base = surface(f) + kerb;
    m.append(post(x, z, base, surface(f) + RAIL.height + (end ? 0.05 : 0), end ? RAIL.newel / 2 : RAIL.post / 2, angle, end));
  });
  const line = (h: number) => {
    const pts: Vec3[] = [];
    const n = Math.max(2, Math.ceil(Math.abs(fFoot - fTop) / 0.1));
    for (let i = 0; i <= n; i++) {
      const f = fTop + 0.02 + ((fFoot - 0.02 - (fTop + 0.02)) * i) / n;
      pts.push(P(f, surface(f) + h));
    }
    return pts;
  };
  m.append(rod(line(RAIL.height), RAIL.rail, S.bronze, 14));
  for (const h of RAIL.rods) m.append(rod(line(h), RAIL.rod, S.steel, 8));
  parts.addSet(name, m);
}

function balustrade(parts: Parts): void {
  // A newel at a flight stands on its kerb; one beside the terminal on the deck.
  const base = (e: RailEnd) => (e === 'ramp' ? DECK_Y + RAMP.kerb : e === 'stair' ? DECK_Y + STAIR.kerb : DECK_Y);
  railRuns().forEach((r, i) => rimRun(parts, i, r.a0, r.a1, base(r.from), base(r.to)));
  // The ramp's sides: from the newel on each kerb's end down to its foot.
  const rampSurface = (f: number) => (f <= RAMP_TOP ? DECK_Y : FIELD_Y + rampRise(RAMP_FOOT - f));
  for (const side of [-1, 1]) {
    const q = side * RAMP_RAIL_Q;
    const fTop = Math.sqrt(RAIL_R * RAIL_R - q * q);
    flightRun(parts, `ramp-rail${side < 0 ? 'L' : 'R'}`, RAMP.angle, q, fTop, RAMP_FOOT - 0.35, rampSurface, RAMP.kerb, 7);
  }
  // The stair's: the nosing line, flat on the deck.
  const nosingLine = (f: number) => (f <= STAIR_TOP ? DECK_Y : FIELD_Y + STAIR.rise + ((STAIR_FOOT - f) / (STAIR_FOOT - STAIR_TOP)) * (STAND.H - STAIR.rise));
  for (const side of [-1, 1]) {
    const q = side * STAIR_RAIL_Q;
    const fTop = Math.sqrt(RAIL_R * RAIL_R - q * q);
    flightRun(parts, `stair-rail${side < 0 ? 'L' : 'R'}`, STAIR.angle, q, fTop, STAIR_FOOT - 0.12, nosingLine, STAIR.kerb, 1);
  }
}

export interface StandBuild {
  parts: Parts;
  /** Walker-only proxies: fences along the balustrade's lines. */
  proxies: PolyMesh[];
}

/** An invisible fence along a polyline (thin vertical quads), for the walker only. */
function fence(line: [number, number][], y0: number, y1: number): PolyMesh {
  const m = new PolyMesh();
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    m.face([m.vert([a[0], y0, a[1]]), m.vert([b[0], y0, b[1]]), m.vert([b[0], y1, b[1]]), m.vert([a[0], y1, a[1]])], 0);
  }
  return m;
}

export function buildPlatform(): StandBuild {
  const parts = new Parts('stand');
  drum(parts);
  coping(parts);
  ramp(parts);
  stair(parts);
  balustrade(parts);
  const proxies: PolyMesh[] = [];
  const top = DECK_Y + 1.1;
  for (const { a0, a1 } of railRuns()) proxies.push(fence(arcPoints(RAIL_R, a0, a1, 0, 0.4).map((p) => [p[0], p[2]]), DECK_Y - 0.5, top));
  for (const [angle, q, foot, kerbTop] of [
    [RAMP.angle, RAMP_RAIL_Q, RAMP_FOOT, RAMP.kerb],
    [RAMP.angle, -RAMP_RAIL_Q, RAMP_FOOT, RAMP.kerb],
    [STAIR.angle, STAIR_RAIL_Q, STAIR_FOOT, STAIR.kerb],
    [STAIR.angle, -STAIR_RAIL_Q, STAIR_FOOT, STAIR.kerb],
  ] as const) {
    const b = notchBasis(angle);
    const fTop = Math.sqrt(RAIL_R * RAIL_R - q * q);
    const a = at(b, fTop, 0, q);
    const c = at(b, foot, 0, q);
    proxies.push(fence([[a[0], a[2]], [c[0], c[2]]], FIELD_Y - 0.1, top + kerbTop));
  }
  return { parts, proxies };
}
