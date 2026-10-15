/**
 * The Field's master plan (docs/city_plan.md §3, docs/field.md): one walled compound laid out on
 * the Dome's own grid. Single source of truth, in world metres (+X east, +Z south, platform top at
 * FIELD_Y): the builders, the flush paving, the walls, the sound, the tests and tools/site-plan
 * read these numbers; nothing re-derives them.
 *
 *  - The ground repeats the Dome: avenues run under its rib lines (x, z = ±192, two coffers out);
 *    the Axis Road (west) and the Meridian (north, south) run from the Halo's ring to the edge.
 *  - The compound is walled: an arcaded cordon round it, a perimeter road inside the cordon, the
 *    main portal on the Axis Road. The estate's own wall bounds it on the west.
 *  - Precincts: each block between avenues has a zone (craft, instruments, power, cryogen,
 *    science, works, heat), its own paving, its hero and secondary plant filling it.
 *  - Viaducts: a square main runs just outside the avenues' ring of blocks, fed from the Halo by
 *    trunks along the Axis Road and the Meridian; valve pavilions draw from it into each precinct.
 */
import { PAD_HEIGHT } from '../ground/site';

/** The platform top: every field structure stands on it. */
export const FIELD_Y = PAD_HEIGHT;

type P2 = [number, number];

/** Roads are dark polished basalt set flush into the limestone, edged in bronze. */
export const ROAD = {
  half: 10,
  /** Bronze edge inlay width. */
  edge: 0.18,
} as const;

/** The landing pad on the datum: dark heat-resistant ceramic tiles flush in the limestone. */
export const LANDING_PAD = { r: 45 } as const;

/** The Halo: the ring main round the pad on arches straddling the ring road. */
export const HALO = {
  r: 110,
  /** Clear height under the arches (roads pass under). */
  clear: 14,
} as const;

/** The ring road runs under the Halo. */
export const RING_ROAD = { r0: HALO.r - ROAD.half, r1: HALO.r + ROAD.half } as const;

/** Paved forecourt inside the West Gate (limestone, bronze-bordered); the estate gateway opens north of it. */
export const GATE_COURT = { x0: -470, x1: -410, z0: -28, z1: 28 } as const;
/** Gap in the estate's wall the court's stub leads to (built with the estate). */
export const ESTATE_GATEWAY = { x0: -437, x1: -423, z: -40 } as const;

/** The estate's terrace (reserved; built in step 2): kept free of field structure. */
export const ESTATE = { south: -40, north: -170, east: -290, backR: 470 } as const;

/** Craft fly this along the Spinward axis: nothing over `ceiling` within it, nothing on its ground. */
export const CORRIDOR = { x0: 120, x1: 470, half: 30, ceiling: 20 } as const;

/** Least clearance from any structure to the Dome's glass. */
export const GLASS_CLEARANCE = 30;

/** The grid: avenues on the Dome's rib lines two coffers out; the square main just outside them. */
export const GRID = { avenue: 192, main: 208 } as const;

/**
 * The cordon: an arcaded wall-gallery round the compound (cordon.ts), its centreline radius and
 * half-thickness, the perimeter road inside it, and the west front where it meets the estate and
 * the Gate Court (the main portal spans the Axis Road there).
 */
export const CORDON = {
  r: 440,
  half: 5,
  height: 13,
  frontX: -405,
  road: { r0: 409, r1: 427 },
} as const;


/** A pylon of the cordon: plan centre, outward direction, half-sizes (outward, along the wall), shaft height and crown. */
export interface CordonPylon {
  name: string;
  kind: 'gate' | 'meridian' | 'craft' | 'portal' | 'corner' | 'end';
  x: number;
  z: number;
  /** Outward unit vector in plan. */
  ox: number;
  oz: number;
  hr: number;
  ht: number;
  height: number;
  crown: number;
}

/** A run of the cordon between two pylons: a walled arcade, or a bridge over a gate (the gallery deck alone). */
export interface CordonRun {
  name: string;
  /** Arc runs: plan angles (increasing); line runs: end points. */
  arc?: [number, number];
  line?: [P2, P2];
  bridge: boolean;
  from: number;
  to: number;
}

const PYLON_KIND = {
  gate: { hr: 7.5, ht: 4.5, height: 24, crown: 13 },
  meridian: { hr: 8, ht: 5.5, height: 32, crown: 19 },
  craft: { hr: 7.5, ht: 5, height: 30, crown: 17 },
  portal: { hr: 8, ht: 6, height: 36, crown: 22 },
  corner: { hr: 8, ht: 8, height: 18, crown: 18 },
  end: { hr: 7.5, ht: 3, height: 15, crown: 10 },
} as const;

/** Clear half-widths of the gates between their pylons' faces. */
export const CORDON_GATE = { avenue: 9, meridian: 12 } as const;

/** How far a run reaches into a pylon (a fraction of the pylon's half-size along the wall): built into it. */
export const CORDON_EMBED = 0.55;

/**
 * The cordon in plan: pylons round the arc (gates where the avenues and the Meridian end, the
 * craft gate where the corridor leaves, corner bastions where the arc meets the estate's strip and
 * the west front), the west front with the main portal on the Axis Road, and the runs between.
 */
export const CORDON_PLAN = (() => {
  const R = CORDON.r;
  const pylons: CordonPylon[] = [];
  const runs: CordonRun[] = [];
  const onArc = (name: string, kind: keyof typeof PYLON_KIND, a: number) => {
    pylons.push({ name, kind, x: Math.cos(a) * R, z: Math.sin(a) * R, ox: Math.cos(a), oz: Math.sin(a), ...PYLON_KIND[kind] });
    return a;
  };
  const reach = Math.sqrt(R * R - GRID.avenue ** 2);
  const aNW = Math.atan2(-GRID.avenue, -reach);
  const aSW = Math.atan2(Math.sqrt(R * R - CORDON.frontX ** 2), CORDON.frontX);
  // Stations round the arc, in increasing angle: [name, kind, angle, clear half-width (gates)].
  const gates: [string, 'gate' | 'meridian' | 'craft', number, number][] = [
    ['avenue-w-n', 'gate', Math.atan2(-reach, -GRID.avenue), CORDON_GATE.avenue],
    ['north', 'meridian', -Math.PI / 2, CORDON_GATE.meridian],
    ['avenue-e-n', 'gate', Math.atan2(-reach, GRID.avenue), CORDON_GATE.avenue],
    ['avenue-n-e', 'gate', Math.atan2(-GRID.avenue, reach), CORDON_GATE.avenue],
    ['craft', 'craft', 0, CORRIDOR.half + 2],
    ['avenue-s-e', 'gate', Math.atan2(GRID.avenue, reach), CORDON_GATE.avenue],
    ['avenue-e-s', 'gate', Math.atan2(reach, GRID.avenue), CORDON_GATE.avenue],
    ['south', 'meridian', Math.PI / 2, CORDON_GATE.meridian],
    ['avenue-w-s', 'gate', Math.atan2(reach, -GRID.avenue), CORDON_GATE.avenue],
  ];
  const embed = (k: number) => (pylons[k].ht * CORDON_EMBED) / R;
  let prev = pylons.length;
  onArc('nw', 'corner', aNW);
  for (const [name, kind, a, half] of gates) {
    // The craft gate is measured as a chord (the corridor is straight); the others along the arc.
    const off = kind === 'craft' ? Math.asin((half + PYLON_KIND.craft.ht) / R) : (half + PYLON_KIND[kind].ht) / R;
    const k0 = pylons.length;
    onArc(`${name}-a`, kind, a - off);
    runs.push({ name: `wall-${pylons[prev].name}`, arc: [arcAngle(pylons[prev]) + embed(prev), a - off - embed(k0)], bridge: false, from: prev, to: k0 });
    onArc(`${name}-b`, kind, a + off);
    if (kind !== 'craft') runs.push({ name: `bridge-${name}`, arc: [a - off + embed(k0), a + off - embed(k0 + 1)], bridge: true, from: k0, to: k0 + 1 });
    prev = k0 + 1;
  }
  const kSW = pylons.length;
  onArc('sw', 'corner', aSW);
  // The south-west bastion turns the corner: it faces out between the arc and the front.
  {
    const p = pylons[kSW];
    const bx = p.ox - 1;
    const bz = p.oz;
    const l = Math.hypot(bx, bz);
    p.ox = bx / l;
    p.oz = bz / l;
  }
  runs.push({ name: `wall-${pylons[prev].name}`, arc: [arcAngle(pylons[prev]) + embed(prev), aSW - embed(kSW)], bridge: false, from: prev, to: kSW });
  // The west front: the main portal's pylons astride the Axis Road, an end pylon where the estate's wall will meet it.
  const front = (name: string, kind: keyof typeof PYLON_KIND, z: number) => {
    pylons.push({ name, kind, x: CORDON.frontX, z, ox: -1, oz: 0, ...PYLON_KIND[kind] });
    return pylons.length - 1;
  };
  const portalZ = ROAD.half + 3 + PYLON_KIND.portal.ht;
  const kPS = front('portal-s', 'portal', portalZ);
  const kPN = front('portal-n', 'portal', -portalZ);
  const kEnd = front('estate', 'end', ESTATE.south + 2 + PYLON_KIND.end.ht);
  const x = CORDON.frontX;
  const swZ = pylons[kSW].z;
  runs.push({ name: 'wall-front-s', line: [[x, swZ - pylons[kSW].ht * CORDON_EMBED], [x, portalZ + PYLON_KIND.portal.ht * CORDON_EMBED]], bridge: false, from: kSW, to: kPS });
  runs.push({ name: 'wall-front-n', line: [[x, -portalZ - PYLON_KIND.portal.ht * CORDON_EMBED], [x, pylons[kEnd].z + PYLON_KIND.end.ht * CORDON_EMBED]], bridge: false, from: kPN, to: kEnd });
  return { pylons, runs, portal: { south: kPS, north: kPN } };
})();

function arcAngle(p: CordonPylon): number {
  return Math.atan2(p.z, p.x);
}

/** The compound's usable ground stops here (inside the perimeter road). */
export const COMPOUND_R = CORDON.road.r0 - 4;

export const GYRE = {
  x: 96,
  z: -288,
  /** Gimbal centre above the platform top. */
  centreY: 57,
  /** Plinth (rounded rectangle, long along the N–S pivot axis). */
  plinth: { hx: 40, hz: 72 },
} as const;

export const RESONATOR = {
  x: -97,
  z: 290,
  ringR: 50,
  /** Ring centre above the platform top. */
  centreY: 62,
  /** Pylon centres from the ring's centre, along the ring's plane. */
  pylonOff: 74,
  /** Top of the portal frame above the platform top. */
  top: 130,
  /** Plinth margins: beyond the pylons along the ring's plane, and its half-width across it. */
  plinthEnd: 1.5,
  plinthHalf: 19,
} as const;

/** Where the house stands: the Resonator's ring faces it, which it reflects. */
export const HOUSE_SITE: P2 = [-372, -112];

export const LOOM = {
  x0: 30,
  x1: 312,
  /** Rail lines. */
  zA: 132,
  zB: 162,
  /** Rail top above the platform. */
  railTop: 35,
  /** Spool axis (along z) and diameter. */
  spool: { x: 334, z0: 125, z1: 169, d: 45, centreY: 24 },
  /** No leg stands within these x ranges (the avenue and the square main pass under the gantry). */
  legKeepout: [[GRID.avenue - ROAD.half - 3, GRID.main + 5]] as readonly [number, number][],
} as const;

export const COLD_HOLD = {
  /** The tanks fill the inner north-west block (tanks.ts): its rectangle and the core it keeps out of. */
  x0: -180,
  x1: -18,
  z0: -180,
  z1: -24,
  coreClear: 150,
  /** Centre of the cluster (for sound and the probe). */
  x: -110,
  z: -110,
  count: 26,
  dMin: 8,
  dMax: 30,
} as const;

export const MAST = { x: 150, z: -72, top: 150, legR: 20 } as const;

/** The tower clusters (towers.ts). */
export const STILLS = { x: -97, z: -290, podiumR: 58, podiumTop: 2.4 } as const;
export const CONVERTER = { x: 296, z: -124, podiumR: 50, podiumTop: 2.2 } as const;
export const RECKONER = { x: -128, z: 128, podiumR: 52, podiumTop: 2.2 } as const;

/** The radiator forest fills the heat precinct (spires.ts). */
export const PLANT = {
  regions: [
    // The cold plant's halls take the strip by the south gate (plant.ts).
    { x0: 18, x1: 176, z0: 214, z1: 330 },
    { x0: 218, x1: 400, z0: 218, z1: 400 },
  ],
  /** Fins stay inside this plan radius. */
  rMax: COMPOUND_R - 6,
} as const;

/** Angle in plan (atan2(z, x)) of a point. */
export const planAngle = (x: number, z: number) => Math.atan2(z, x);

export interface RoadSegment {
  name: string;
  a: P2;
  b: P2;
  half: number;
}

const avenueReach = Math.sqrt(CORDON.road.r0 ** 2 - GRID.avenue ** 2);

/** Straight roads: the Axis Road, the Meridian, and the four rib avenues (the ring roads are separate). */
export const ROADS: readonly RoadSegment[] = [
  { name: 'axis', a: [CORDON.frontX, 0], b: [-RING_ROAD.r1 + 2, 0], half: ROAD.half },
  { name: 'meridian-n', a: [0, -RING_ROAD.r1 + 2], b: [0, -CORDON.road.r0 - 2], half: ROAD.half },
  { name: 'meridian-s', a: [0, RING_ROAD.r1 - 2], b: [0, CORDON.road.r0 + 2], half: ROAD.half },
  { name: 'avenue-e', a: [GRID.avenue, -avenueReach - 2], b: [GRID.avenue, avenueReach + 2], half: ROAD.half },
  { name: 'avenue-w', a: [-GRID.avenue, -avenueReach - 2], b: [-GRID.avenue, avenueReach + 2], half: ROAD.half },
  { name: 'avenue-n', a: [-avenueReach - 2, -GRID.avenue], b: [avenueReach + 2, -GRID.avenue], half: ROAD.half },
  { name: 'avenue-s', a: [-avenueReach - 2, GRID.avenue], b: [avenueReach + 2, GRID.avenue], half: ROAD.half },
];

/** The perimeter road inside the cordon: an arc that stops short of the estate and the west front. */
export const PERIMETER = (() => {
  const rc = (CORDON.road.r0 + CORDON.road.r1) / 2;
  // North-west end: where the arc meets the strip north of the estate; south-west end: the front.
  const a0 = Math.atan2(ESTATE.north - 12, -Math.sqrt(rc * rc - (ESTATE.north - 12) ** 2));
  const a1 = Math.atan2(Math.sqrt(rc * rc - (CORDON.frontX + 15) ** 2), CORDON.frontX + 15);
  return { r0: CORDON.road.r0, r1: CORDON.road.r1, a0, a1 };
})();

/** Is an angle on the perimeter road's arc (clockwise in plan, i.e. increasing atan2, from a0 round to a1)? */
export function onPerimeterArc(a: number): boolean {
  let d = a - PERIMETER.a0;
  while (d < 0) d += 2 * Math.PI;
  let span = PERIMETER.a1 - PERIMETER.a0;
  while (span < 0) span += 2 * Math.PI;
  return d <= span;
}

/** A viaduct's line in plan (its piers straddle it), as a polyline; `close` loops it. */
export interface RackLine {
  name: string;
  pts: P2[];
  close?: boolean;
  /** Spine height above the platform at each end (the trunks swoop down to the main). */
  y0: number;
  y1: number;
}

/** The square main and the three trunks that feed it from the Halo. */
export function rackLines(): RackLine[] {
  const m = GRID.main;
  const r0 = RING_ROAD.r1 + 6;
  return [
    { name: 'main', pts: [[-m, -m], [m, -m], [m, m], [-m, m]], close: true, y0: 10, y1: 10 },
    // Trunks run alongside the Axis Road and the Meridian, 14 m off their centrelines, above the main.
    { name: 'trunk-w', pts: [[-r0, -14], [CORDON.frontX + 22, -14]], y0: 15.5, y1: 15.5 },
    { name: 'trunk-n', pts: [[14, -r0], [14, -m + 3]], y0: 15.5, y1: 10 },
    { name: 'trunk-s', pts: [[-14, r0], [-14, m - 3]], y0: 15.5, y1: 10 },
  ];
}

/** Valve pavilions, standing under the viaducts: where each precinct draws from them (position, the precinct). */
export const PAVILIONS: readonly { x: number; z: number; zone: string }[] = [
  { x: -150, z: -GRID.main, zone: 'cryo' },
  { x: 142, z: -GRID.main, zone: 'instruments' },
  { x: GRID.main, z: -154, zone: 'craft' },
  { x: GRID.main, z: -64, zone: 'power' },
  { x: GRID.main, z: 96, zone: 'works' },
  { x: 148, z: GRID.main, zone: 'heat' },
  { x: -150, z: GRID.main, zone: 'science' },
  { x: -GRID.main, z: 150, zone: 'science' },
  { x: -GRID.main, z: -150, zone: 'cryo' },
  { x: CORDON.frontX + 40, z: -14, zone: 'cryo' },
];

/** Covered service trenches flush in the pad (bronze-edged cover plates), carrying power. */
export const TRENCH_HALF = 0.55;
export function trenchLines(): RoadSegment[] {
  const road = (n: string) => ROADS.find((r) => r.name === n)!;
  const off = (s: RoadSegment, side: number, d: number): RoadSegment => {
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const L = Math.hypot(dx, dz);
    const nx = (-dz / L) * side * d;
    const nz = (dx / L) * side * d;
    return { name: `trench:${s.name}`, a: [s.a[0] + nx, s.a[1] + nz], b: [s.b[0] + nx, s.b[1] + nz], half: TRENCH_HALF };
  };
  // On the side away from each avenue's viaduct.
  return [off(road('axis'), -1, 12.2), off(road('meridian-n'), -1, 12.2), off(road('meridian-s'), -1, 12.2), off(road('avenue-e'), 1, 12.2), off(road('avenue-w'), -1, 12.2), off(road('avenue-n'), -1, 12.2), off(road('avenue-s'), 1, 12.2)];
}

/** The ring trench round the inside of the ring road. */
export const RING_TRENCH_R = 94.6;

/** Where roads cross under the Halo (plan angles): the Axis Road and the Meridian. */
export const HALO_CROSSINGS: readonly number[] = [Math.PI, -Math.PI / 2, Math.PI / 2];

/** Plan radius at which the Dome's glass stands h above the platform top (S: 2:1 ellipsoid). */
export function glassRadiusAt(h: number): number {
  const a = 499.75;
  const c = 250;
  return a * Math.sqrt(Math.max(0, 1 - (h / c) ** 2));
}

/** Height of the glass above the platform top at plan radius r. */
export function glassHeightAt(r: number): number {
  const a = 499.75;
  const c = 250;
  return r >= a ? 0 : c * Math.sqrt(1 - (r / a) ** 2);
}

/** Point in the estate's reserved zone? */
export function inEstate(x: number, z: number, margin = 0): boolean {
  if (z > ESTATE.south + margin || z < ESTATE.north - margin) return false;
  if (x > ESTATE.east + margin) return false;
  return Math.hypot(x, z) < ESTATE.backR + margin;
}

/** Inside the compound's usable ground (inside the perimeter road, east of the west front, off the estate)? */
export function inCompound(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x, z) < COMPOUND_R - margin && x > CORDON.frontX + 6 + margin && !inEstate(x, z, 8 + margin);
}

/** Distance from (x, z) to a road segment's centreline. */
export function distToSegment(x: number, z: number, s: RoadSegment): number {
  const [ax, az] = s.a;
  const [bx, bz] = s.b;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Is (x, z) on any road (straight roads, the ring road, the perimeter road), with an optional margin? */
export function onRoad(x: number, z: number, margin = 0): boolean {
  const r = Math.hypot(x, z);
  if (r > RING_ROAD.r0 - margin && r < RING_ROAD.r1 + margin) return true;
  if (r > PERIMETER.r0 - margin && r < PERIMETER.r1 + margin && onPerimeterArc(Math.atan2(z, x))) return true;
  return ROADS.some((s) => distToSegment(x, z, s) < s.half + margin);
}

/** Distance in plan from (x, z) to the nearest viaduct line. */
export function distToViaduct(x: number, z: number): number {
  let best = Infinity;
  for (const l of rackLines()) {
    const n = l.pts.length;
    const segs = l.close ? n : n - 1;
    for (let i = 0; i < segs; i++) best = Math.min(best, distToSegment(x, z, { name: '', a: l.pts[i], b: l.pts[(i + 1) % n], half: 0 }));
  }
  return best;
}

/** The precincts: blocks between the avenues, by zone (paving and secondary plant read these). */
export type Zone = 'craft' | 'instruments' | 'power' | 'cryo' | 'science' | 'works' | 'heat';
export interface Precinct {
  name: string;
  zone: Zone;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const A0 = 12;
const A1 = GRID.avenue - ROAD.half;
const B0 = GRID.avenue + ROAD.half;
const FAR = 420;

export const PRECINCTS: readonly Precinct[] = [
  { name: 'ne-inner', zone: 'craft', x0: A0, x1: A1, z0: -A1, z1: -CORRIDOR.half - 2 },
  { name: 'ne-north', zone: 'instruments', x0: A0, x1: A1, z0: -FAR, z1: -B0 },
  { name: 'ne-east', zone: 'power', x0: B0, x1: FAR, z0: -A1, z1: -CORRIDOR.half - 2 },
  { name: 'ne-corner', zone: 'power', x0: B0, x1: FAR, z0: -FAR, z1: -B0 },
  { name: 'nw-inner', zone: 'cryo', x0: -A1, x1: -A0, z0: -A1, z1: -A0 },
  { name: 'nw-north', zone: 'cryo', x0: -A1, x1: -A0, z0: -FAR, z1: -B0 },
  { name: 'nw-west', zone: 'cryo', x0: ESTATE.east + 8, x1: -B0, z0: -A1, z1: -A0 },
  { name: 'nw-corner', zone: 'cryo', x0: -FAR, x1: -B0, z0: -FAR, z1: -B0 },
  { name: 'sw-inner', zone: 'science', x0: -A1, x1: -A0, z0: A0, z1: A1 },
  { name: 'sw-south', zone: 'science', x0: -A1, x1: -A0, z0: B0, z1: FAR },
  { name: 'sw-west', zone: 'science', x0: CORDON.frontX + 6, x1: -B0, z0: A0, z1: A1 },
  { name: 'sw-corner', zone: 'science', x0: CORDON.frontX + 6, x1: -B0, z0: B0, z1: FAR },
  { name: 'se-inner', zone: 'works', x0: A0, x1: A1, z0: CORRIDOR.half + 2, z1: A1 },
  { name: 'se-east', zone: 'works', x0: B0, x1: FAR, z0: CORRIDOR.half + 2, z1: A1 },
  { name: 'se-south', zone: 'heat', x0: A0, x1: A1, z0: B0, z1: FAR },
  { name: 'se-corner', zone: 'heat', x0: B0, x1: FAR, z0: B0, z1: FAR },
];

/** The precinct a point lies in (or null: roads, the core, the corridor, outside). */
export function precinctAt(x: number, z: number): Precinct | null {
  if (!inCompound(x, z) || Math.hypot(x, z) < RING_ROAD.r1 + 4) return null;
  return PRECINCTS.find((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) ?? null;
}
