/**
 * The Gyre (city_plan.md §5.2): the compound's inertial reference, a gyroscope that holds its
 * orientation to the stars. Three nested gold gimbal rings round a gold rotor sphere, carried on
 * bearings in a white ceramic yoke.
 *
 * The band turns under the stars about the north–south axis (sky/structure/spin.ts), so a rotor
 * that holds still against the stars rolls slowly about that axis in the city's frame: the outer
 * gimbal turns about z at the frame's rate (3°/min), and the world's spin is visible in one object.
 * The middle and inner gimbals sit at fixed offsets, trimmed by a few degrees over minutes (the
 * servo loop correcting drift).
 *
 * Construction (local frame: origin at the gimbal centre, axes as the world's):
 *  - plinth: a stepped ceramic slab;
 *  - yoke: one U of dressed ceramic (a base beam and two bearing towers, filleted), its towers'
 *    inner faces clear of the outer ring's swept sphere; torque motors and bearing housings on the
 *    towers, ladders and a platform at each bearing;
 *  - outer ring (R 44) in the y–z plane, pivoting about z on trunnion pins into the towers;
 *  - middle ring (R 36.5) pivoting about y on the outer ring; inner ring (R 29.5) about x on the
 *    middle ring; the rotor (R 17) on spindles along the inner ring's z.
 * Every ring is built in shop segments joined by black glazed splice collars.
 */
import { Matrix4 } from 'three';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, girderProfile, sweep } from '../../geometry/sweep';
import { basisAlong, box, extrudeBevel, lathe, orientOutward, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { Parts, type Mover } from '../kit/parts';
import { ringBody, spliceCollar, bearingHousing, type RingSpec } from '../kit/rings';
import { guardRail, gratingDeck, ladder } from '../kit/access';
import { pipeRun } from '../kit/pipe';
import { FIELD_Y, GYRE } from '../layout';
import { frameAngle } from '../../sky/structure/spin';

/** Ring dimensions: centreline radius, radial and axial half-sections. */
export const GIMBAL = {
  outer: { R: 44, hr: 1.3, ha: 1.05 },
  middle: { R: 36.5, hr: 1.1, ha: 0.9 },
  inner: { R: 29.5, hr: 0.9, ha: 0.75 },
  rotor: 17,
  /** Fixed offsets of the middle (about y) and inner (about x) gimbals. */
  middleAngle: (28 * Math.PI) / 180,
  innerAngle: (40 * Math.PI) / 180,
  /** Outer ring's phase at t = 0. */
  outerPhase: (-32 * Math.PI) / 180,
} as const;

/** The yoke (heights above the platform top; z about the gimbal centre). */
export const YOKE = {
  towerIn: 49.5,
  towerOut: 57.5,
  baseTop: 10,
  top: GYRE.centreY + 5.5,
  plinthTop: 2.0,
} as const;

/** Radius of the sphere swept by the outer ring (its section's far corner) about the centre. */
export const OUTER_SWEEP = Math.hypot(GIMBAL.outer.R + GIMBAL.outer.hr, GIMBAL.outer.ha);

const C: Vec3 = [GYRE.x, FIELD_Y + GYRE.centreY, GYRE.z];
const toWorld = (p: Vec3): Vec3 => v3.add(C, p);

/** Rounded corner of an outline: points along an arc from angle a0 to a1 about (cx, cy). */
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): Vec2[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Vec2;
  });
}

/** The yoke's centreline in (z, height above platform): down one tower, along the base, up the other. */
export const YOKE_PATH = { towerZ: 53.5, baseY: 5.98, bend: 11, depthHalf: 4 } as const;

/** Half-width of the yoke across x at a height: broad at the base, tapering up the towers. */
export function yokeHalfX(h: number): number {
  const lo = YOKE_PATH.baseY + YOKE_PATH.bend;
  const t = Math.min(1, Math.max(0, (h - lo) / (YOKE.top - lo)));
  return 6.5 - 2.25 * t * t * (3 - 2 * t);
}

/** Where the tower's outer face stands (z) at a height: vertical above the bend, curving in below it. */
export function yokeOuterZ(h: number): number {
  const { towerZ, baseY, bend, depthHalf } = YOKE_PATH;
  const cy = baseY + bend;
  if (h >= cy) return towerZ + depthHalf;
  const R = bend + depthHalf;
  return towerZ - bend + Math.sqrt(Math.max(0, R * R - (cy - h) ** 2));
}

/**
 * The yoke as one sweep: a dressed section (deep cast channels on both broad faces, chamfered
 * arrises) along the U centreline, tapering across x up the towers.
 */
function yokeSweep(): PolyMesh {
  const { towerZ: tz, baseY: by, bend: rb, depthHalf: dh } = YOKE_PATH;
  const pts: Vec2[] = [];
  const add = (z: number, h: number) => pts.push([z, h]);
  for (let h = YOKE.top; h > by + rb + 0.01; h -= 2.5) add(-tz, h);
  for (let k = 0; k <= 14; k++) {
    const a = Math.PI + (Math.PI / 2) * (k / 14);
    add(-tz + rb + Math.cos(a) * rb, by + rb + Math.sin(a) * rb);
  }
  for (let z = -tz + rb + 3; z < tz - rb - 0.01; z += 3) add(z, by);
  for (let k = 0; k <= 14; k++) {
    const a = (3 * Math.PI) / 2 + (Math.PI / 2) * (k / 14);
    add(tz - rb + Math.cos(a) * rb, by + rb + Math.sin(a) * rb);
  }
  for (let h = by + rb + 2.5; h < YOKE.top - 0.01; h += 2.5) add(tz, h);
  add(tz, YOKE.top);
  const world = pts.map(([z, h]) => [GYRE.x, FIELD_Y + h, GYRE.z + z] as Vec3);
  // In-plane normals (the section's t axis) toward the inside of the U.
  const normals = world.map((_, i) => {
    const a = world[Math.max(0, i - 1)];
    const b = world[Math.min(world.length - 1, i + 1)];
    const t = v3.norm(v3.sub(b, a));
    return v3.cross([1, 0, 0], t);
  });
  const frames = framesFrom(world, normals);
  const prof = (_f: unknown, i: number) =>
    girderProfile({ halfWidth: yokeHalfX(pts[i][1]), t0: -dh, t1: dh, chamferBottom: 0.3, chamferTop: 0.3, grooves: [[-2.4, 2.4, 0.45]] });
  return orientOutward(sweep(frames, prof, { crease: 28, capSlot: FIELD_SLOT.ceramic }));
}

function ringSpec(g: { R: number; hr: number; ha: number }, b: Basis): RingSpec {
  return { R: g.R, hr: g.hr, ha: g.ha, b, ds: 1.0 };
}

/** A ring with splice collars at its shop joints (irregular phase per ring). */
function ring(parts: Parts, name: string, spec: RingSpec, joints: number, phase: number, skip: number[] = []): void {
  parts.add(`${name}:body`, ringBody(spec));
  for (let k = 0; k < joints; k++) {
    const a = phase + (2 * Math.PI * k) / joints;
    if (skip.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < 0.12)) continue;
    parts.add(`${name}:collar${k}`, spliceCollar(spec, a, 0.7, 0.07));
  }
}

/** A trunnion: a chrome pin from one ring out through a housing on the next (along `axis`). */
function trunnion(parts: Parts, name: string, o: Vec3, axis: Vec3, r0: number, r1: number, pinR: number): void {
  const b = basisAlong(v3.add(o, v3.scale(axis, r0 - 0.05)), axis);
  parts.add(`${name}:pin`, lathe([[0, 0], [pinR, 0], [pinR, r1 - r0 + 0.1], [0, r1 - r0 + 0.1]], 32, b, FIELD_SLOT.chrome));
}

export interface GyreBuild {
  parts: Parts;
  movers: Mover[];
}

export function buildGyre(): GyreBuild {
  const parts = new Parts('gyre');
  const O = GIMBAL.outer;
  const M = GIMBAL.middle;
  const I = GIMBAL.inner;

  // --- Plinth: three stepped tiers of dressed ceramic ---------------------------------------------
  const wb: Basis = { o: [GYRE.x, FIELD_Y, GYRE.z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  const rr = (hx: number, hz: number, r: number): Vec2[] => {
    const out: Vec2[] = [];
    const c: [number, number, number][] = [[hx - r, hz - r, 0], [-hx + r, hz - r, Math.PI / 2], [-hx + r, -hz + r, Math.PI], [hx - r, -hz + r, (3 * Math.PI) / 2]];
    for (const [cx, cz, a0] of c) out.push(...arcPts(cx, cz, r, a0, a0 + Math.PI / 2, 5));
    return out;
  };
  const { hx, hz } = GYRE.plinth;
  parts.add('plinth:0', extrudeBevel(rr(hx, hz, 9), wb, -0.02, 0.8, 0.06, FIELD_SLOT.ceramic));
  parts.add('plinth:1', extrudeBevel(rr(hx - 3, hz - 3, 7), wb, 0.78, 1.5, 0.06, FIELD_SLOT.ceramic));
  parts.add('plinth:2', extrudeBevel(rr(hx - 7, hz - 6, 5), wb, 1.48, YOKE.plinthTop, 0.05, FIELD_SLOT.ceramic));

  // --- Yoke ---------------------------------------------------------------------------------------
  parts.add('yoke', yokeSweep());
  // Glazed black bed joint where the yoke's base bears on the plinth (a band round its foot).
  const bedHalfZ = YOKE_PATH.towerZ - YOKE_PATH.bend + 1.6;
  parts.add('yoke:bed', box({ o: [GYRE.x, FIELD_Y + YOKE.plinthTop + 0.1, GYRE.z], u: [0, 0, 1], v: [-1, 0, 0], w: [0, 1, 0] }, bedHalfZ, yokeHalfX(0) + 0.12, 0.13, 0.03, FIELD_SLOT.black));

  // Bearing housings on the towers' inner faces (axis toward the centre), torque motors outside.
  for (const s of [-1, 1]) {
    const faceIn: Vec3 = toWorld([0, 0, s * YOKE.towerIn]);
    const inward: Vec3 = [0, 0, -s];
    parts.add(`housing:${s}`, bearingHousing(basisAlong(v3.add(faceIn, v3.scale(inward, -0.04)), inward), 2.6, 2.6));
    const faceOut: Vec3 = toWorld([0, 0, s * YOKE.towerOut]);
    const outward: Vec3 = [0, 0, s];
    parts.add(`motor:${s}`, lathe([[0, -0.05], [3.1, -0.05], [3.1, 0.35], [2.7, 0.5], [2.7, 2.6], [2.45, 2.9], [1.2, 2.9], [1.1, 3.3], [0, 3.3]], 48, basisAlong(faceOut, outward), [FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.bronze, FIELD_SLOT.bronze, FIELD_SLOT.bronze]));
    // A capstone on the tower head, the service platform on it with rails, and a caged ladder up
    // the tower's end (its brackets follow the face where it curves in toward the base).
    const hxTop = yokeHalfX(YOKE.top);
    const capTop = YOKE.top + 0.55;
    parts.add(`cap:${s}`, box({ o: [GYRE.x, FIELD_Y + (YOKE.top - 0.02 + capTop) / 2, GYRE.z + s * YOKE_PATH.towerZ], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, hxTop + 0.25, YOKE_PATH.depthHalf + 0.25, (capTop - YOKE.top + 0.02) / 2, 0.08, FIELD_SLOT.ceramic));
    const deckTop = FIELD_Y + capTop + 0.12;
    const z0 = GYRE.z + s * (YOKE.towerIn - 0.6);
    const z1 = GYRE.z + s * (YOKE.towerOut + 0.25);
    const x0 = GYRE.x - hxTop - 1.6;
    const x1 = GYRE.x + hxTop + 1.6;
    const deck: Vec2[] = [[x0, Math.min(z0, z1)], [x1, Math.min(z0, z1)], [x1, Math.max(z0, z1)], [x0, Math.max(z0, z1)]];
    parts.add(`deck:${s}`, gratingDeck(deck, deckTop, 0.14));
    parts.addSet(`rail:${s}`, guardRail(deck.map(([x, z]) => [x, deckTop, z] as Vec3), true));
    const lf: Vec3 = [GYRE.x + hxTop - 0.6, FIELD_Y + YOKE.plinthTop, GYRE.z + s * YOKE.towerOut];
    const inset = (y: number) => (YOKE.plinthTop + y > YOKE.top - 0.6 ? Infinity : YOKE.towerOut - yokeOuterZ(YOKE.plinthTop + y));
    parts.addSet(`ladder:${s}`, ladder(lf, deckTop - FIELD_Y - YOKE.plinthTop, [0, 0, s], 0.5, true, inset));
    // Power and coolant to the motor: a steel conduit up the tower's end, following its curve.
    const off = 0.55;
    const R = YOKE_PATH.bend + YOKE_PATH.depthHalf + off;
    const cy = YOKE_PATH.baseY + YOKE_PATH.bend;
    const a0 = Math.asin((YOKE.plinthTop - 0.05 - cy) / R);
    const route: Vec3[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (0 - a0) * (k / 10);
      route.push([GYRE.x - 2.2, FIELD_Y + cy + Math.sin(a) * R, GYRE.z + s * (YOKE_PATH.towerZ - YOKE_PATH.bend + Math.cos(a) * R)]);
    }
    route.push([GYRE.x - 2.2, FIELD_Y + GYRE.centreY - 3.6, GYRE.z + s * (YOKE.towerOut + off)]);
    route.push([GYRE.x - 2.2, FIELD_Y + GYRE.centreY - 3.6, GYRE.z + s * (YOKE.towerOut + 1.4)]);
    parts.add(`feed:${s}`, pipeRun(route, { r: 0.24, bend: 0.8, bareEnds: true, slot: FIELD_SLOT.steel, flangeSlot: FIELD_SLOT.bronze }));
  }

  // --- Moving assemblies (local coordinates about the centre) -------------------------------------
  const outer = new Parts('gyre:outer');
  const middle = new Parts('gyre:middle');
  const inner = new Parts('gyre:inner');
  const rotor = new Parts('gyre:rotor');
  // Outer ring in the y–z plane (axis x); pivots at ±z.
  const oSpec = ringSpec(O, { o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], w: [-1, 0, 0] });
  ring(outer, 'ring', oSpec, 9, 0.21, [0, Math.PI, Math.PI / 2, -Math.PI / 2]);
  for (const s of [-1, 1]) {
    // Pin from the ring into the tower's housing (it turns in the housing's bore).
    trunnion(outer, `trunnion${s}`, [0, 0, 0], [0, 0, s], O.R + O.hr - 0.1, YOKE.towerIn + 0.3, 1.25);
    // Housings for the middle ring's pins, on the outer ring's inner face at ±y.
    outer.add(`housing${s}`, bearingHousing(basisAlong([0, s * (O.R - O.hr + 0.04), 0], [0, -s, 0]), 1.7, 1.9));
  }
  // Middle ring: in the x–y plane (axis z) before its turn about y; pivots at ±y.
  const mSpec = ringSpec(M, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] });
  ring(middle, 'ring', mSpec, 8, 0.43, [Math.PI / 2, -Math.PI / 2, 0, Math.PI]);
  for (const s of [-1, 1]) {
    trunnion(middle, `trunnion${s}`, [0, 0, 0], [0, s, 0], M.R + M.hr - 0.1, O.R - O.hr - 0.9, 0.85);
    middle.add(`housing${s}`, bearingHousing(basisAlong([s * (M.R - M.hr + 0.04), 0, 0], [-s, 0, 0]), 1.4, 1.6));
  }
  // Inner ring: in the x–z plane (axis y) before its turn about x; pivots at ±x; spindle housings at ±z.
  const iSpec = ringSpec(I, { o: [0, 0, 0], u: [0, 0, 1], v: [1, 0, 0], w: [0, 1, 0] });
  ring(inner, 'ring', iSpec, 7, 0.9, [0, Math.PI, Math.PI / 2, -Math.PI / 2]);
  for (const s of [-1, 1]) {
    trunnion(inner, `trunnion${s}`, [0, 0, 0], [s, 0, 0], I.R + I.hr - 0.1, M.R - M.hr - 0.75, 0.7);
    inner.add(`housing${s}`, bearingHousing(basisAlong([0, 0, s * (I.R - I.hr + 0.04)], [0, 0, -s]), 1.3, 1.6));
  }
  // Rotor: a gold sphere on two chrome spindles along z, with turned journals at its poles.
  const R = GIMBAL.rotor;
  const sph: Vec2[] = [[0, -R]];
  for (let k = 1; k < 48; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 48;
    sph.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  sph.push([0, R]);
  rotor.add('sphere', lathe(sph, 112, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, FIELD_SLOT.mirror, 50));
  for (const s of [-1, 1]) {
    const b = basisAlong([0, 0, s * (R - 0.3)], [0, 0, s]);
    rotor.add(`spindle${s}`, lathe([[0, 0], [1.6, 0], [1.6, 0.8], [1.1, 1.3], [1.1, I.R - I.hr - R + 1.2], [0, I.R - I.hr - R + 1.2]], 40, b, FIELD_SLOT.chrome));
  }

  const mOuter = new Matrix4();
  const mMiddle = new Matrix4();
  const mInner = new Matrix4();
  const tmp = new Matrix4();
  const trim = (t: number, period: number, amp: number) => amp * Math.sin((2 * Math.PI * t) / period);
  const pose = (t: number) => {
    // The outer gimbal follows the stars: a frame-fixed direction is seen rotated by −θ about z.
    const theta = GIMBAL.outerPhase - frameAngle(t);
    mOuter.makeTranslation(C[0], C[1], C[2]).multiply(tmp.makeRotationZ(theta));
    mMiddle.copy(mOuter).multiply(tmp.makeRotationY(GIMBAL.middleAngle + trim(t, 410, 0.035)));
    mInner.copy(mMiddle).multiply(tmp.makeRotationX(GIMBAL.innerAngle + trim(t, 290, 0.05)));
  };
  const movers: Mover[] = [
    { name: 'outer', parts: outer.list, pose: (t, out) => (pose(t), out.copy(mOuter)) },
    { name: 'middle', parts: middle.list, pose: (t, out) => (pose(t), out.copy(mMiddle)) },
    { name: 'inner', parts: inner.list, pose: (t, out) => (pose(t), out.copy(mInner)) },
    { name: 'rotor', parts: rotor.list, pose: (t, out) => (pose(t), out.copy(mInner)) },
  ];
  return { parts, movers };
}
