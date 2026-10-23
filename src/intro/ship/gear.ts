/**
 * The landing gear (docs/intro-ship.md, "Gear"): a tricycle of articulated trailing-link legs. The
 * nose leg folds aft into a bay in the belly under the cockpit; the two mains fold aft into bays in
 * the nacelles' floors. Each leg:
 *
 *  - a main strut: a tapered box-section beam hung on trunnion pins that bear in the well's walls;
 *  - at its foot the knee: a pinned hub carrying the trailing arm, twin plates that run aft and
 *    down to the ankle, with a horn for the shock;
 *  - the shock absorber: an oleo from a bracket on the strut's aft face to the arm's horn; the
 *    ship's weight swings the arm up about the knee and closes it (COMPRESSION at rest);
 *  - the foot: a broad ribbed pad on an ankle clevis, free to pivot, so it meets the ground flat and
 *    lies flat in the bay stowed;
 *  - a retraction actuator from the bay's fore end to a lug on the strut's inboard face.
 *
 * Retracting, the doors (two per bay, hinged on its long edges) open, the arm folds in line with
 * the strut and the leg swings aft into its well. Each bay is a well, so the eye never sees into
 * the hollow hull.
 *
 * Leg frame: origin at the hip's pivot, x the ship's, y up the strut (down it is −y), z the pivot's
 * axis. Deployed the strut hangs straight down; stowed it is turned 90° aft.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { box, extrudeBevel, lathe, tube, type Basis } from '../../geometry/solids';
import { PolyMesh, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { roundedRect } from '../../geometry/sweep';
import { convexSolid, facetedShell, planeAt, withBevels, type HalfSpace } from '../../geometry/convex';
import { NACELLE, SECTION, HULL_T } from './spec';
import { SHIP_SLOT as S } from './slots';

export interface LegSpec {
  name: string;
  /** The hip's pivot (ship frame); its bay's skin (the plane the doors close in), the skin's thickness, the ground's height. */
  pivot: Vec3;
  skinY: number;
  wall: number;
  ground: number;
  /** The strut's length (pivot to knee), its section's half-sizes at the hip (x, z); the arm's length. */
  strut: number;
  hx: number;
  hz: number;
  arm: number;
  /** The foot's half-length (x) and half-width (z); the bay's half-width (z) and its extent fore and aft of the pivot. */
  footX: number;
  footZ: number;
  bayHalf: number;
  fore: number;
  aft: number;
}

/** Compression of the legs under the ship's weight on the ground (m: how far the ankle rises). */
export const COMPRESSION = 0.07;

/** The ankle pin's height over the foot's sole. */
const ANKLE = 0.14;

/** A bay's length aft of the pivot: the strut, the arm folded in line, the foot, a margin. */
const bayAft = (strut: number, arm: number, footX: number) => strut + arm + footX + 0.12;

export const LEGS: readonly LegSpec[] = [
  { name: 'nose', pivot: [9.55, SECTION.belly + 0.32, 0], skinY: SECTION.belly, wall: HULL_T, ground: 0.015, strut: 0.85, hx: 0.15, hz: 0.11, arm: 0.85, footX: 0.3, footZ: 0.26, bayHalf: 0.3, fore: 0.66, aft: bayAft(0.85, 0.85, 0.3) },
  ...([1, -1] as const).map((s) => ({
    name: s > 0 ? 'main-s' : 'main-p',
    pivot: [-4.9, NACELLE.y - NACELLE.halfHeight + 0.32, s * NACELLE.z] as Vec3,
    skinY: NACELLE.y - NACELLE.halfHeight,
    wall: NACELLE.wall,
    ground: 0,
    strut: 2.0,
    hx: 0.19,
    hz: 0.15,
    arm: 1.3,
    footX: 0.36,
    footZ: 0.24,
    bayHalf: 0.26,
    fore: 0.7,
    aft: bayAft(2.0, 1.3, 0.36),
  })),
];

/** How far a bay's well reaches in from the skin's inner face (m). */
export const WELL_DEPTH = 0.56;

/** The arm's twin plates: their mid-planes' offset either side of the strut, their half-thickness. */
const plateZ = (l: LegSpec) => l.hz + 0.03;
const PLATE_T = 0.0175;
/** The shock's pin on the arm's horn (arm frame: along the arm, below its line). */
const horn = (l: LegSpec): Vec2 => [0.45 * l.arm, -0.18];
/** The shock's pin on the strut's aft bracket (leg frame). */
const shockTop = (l: LegSpec): Vec3 => [-(l.hx + 0.09), -0.55 * l.strut, 0];

const legSwingAngle = (swing: number) => (-Math.PI / 2) * (1 - swing);

/** The arm's angle below the horizontal, deployed, for a compression (its foot on the ground). */
function armDrop(l: LegSpec, compression: number): number {
  const ankle = l.ground + ANKLE - COMPRESSION + compression;
  const s = (l.pivot[1] - l.strut - ankle) / l.arm;
  return Math.asin(Math.min(Math.max(s, -1), 1));
}

/**
 * The arm's direction in the leg frame (angle from +x) at its unfolding (0 folded … 1 out) and a
 * compression: out, it trails aft and down; folded, it lies in line with the strut.
 */
export function armAngle(l: LegSpec, unfold: number, compression: number): number {
  const drop = armDrop(l, compression);
  return Math.PI + drop + (Math.PI / 2 - drop) * (1 - unfold);
}

/** The arm's frame in the leg's (origin at the knee, x along the arm). */
export function armPose(l: LegSpec, unfold: number, compression: number, out = new Matrix4()): Matrix4 {
  return out.makeRotationZ(armAngle(l, unfold, compression)).setPosition(0, -l.strut, 0);
}

/** A point of the arm's frame in the leg frame. */
function onArm(l: LegSpec, unfold: number, compression: number, p: Vec2): Vec3 {
  const a = armAngle(l, unfold, compression);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, -l.strut + p[0] * s + p[1] * c, 0];
}

/** The shock's two pins (leg frame): on the strut's bracket and on the arm's horn. */
export function shockPoints(l: LegSpec, unfold: number, compression: number): { top: Vec3; horn: Vec3 } {
  return { top: shockTop(l), horn: onArm(l, unfold, compression, horn(l)) };
}

/** The foot's frame in the ship's: at the ankle, always level. */
export function footPose(l: LegSpec, swing: number, unfold: number, compression: number, out = new Matrix4()): Matrix4 {
  const ankle = onArm(l, unfold, compression, [l.arm, 0]);
  const p = new Vector3(...ankle).applyMatrix4(new Matrix4().makeRotationZ(legSwingAngle(swing)));
  return out.makeTranslation(l.pivot[0] + p.x, l.pivot[1] + p.y, l.pivot[2] + p.z);
}

/** Pieces of a leg, each in its own frame (poseLeg), and of its bay (ship frame). */
export interface LegParts {
  /** The strut with its hip, trunnions, brackets and lines (leg frame). */
  strut: PolyMesh[];
  /** The trailing arm (arm frame). */
  arm: PolyMesh[];
  /** The foot (its frame, at the ankle). */
  foot: PolyMesh[];
  /** Two body/rod pairs, each along +y from its own pin: the shock, the actuator. */
  shockBody: PolyMesh;
  shockRod: PolyMesh;
  actuatorBody: PolyMesh;
  actuatorRod: PolyMesh;
  /** The doors (each in its hinge's frame: see doorPose). */
  doors: [PolyMesh, PolyMesh];
  /** The bay's well (fixed, ship frame). */
  well: PolyMesh[];
}

/** The actuator's anchor (leg frame: fore of the pivot, up in the bay) and its lug on the strut. */
export function actuatorPoints(l: LegSpec): { anchor: Vec3; onLeg: Vec3 } {
  return { anchor: [l.fore - 0.14, 0.06, 0], onLeg: [0, -0.3 * l.strut, -(l.hz + 0.05)] };
}

/** A body/rod pair's lengths from the distances it must span: together the longest, the rod alone within the shortest. */
function stroke(reach: number[]): { body: number; rod: number } {
  const far = Math.max(...reach);
  const body = 0.55 * far;
  return { body, rod: far - body + 0.06 };
}

/** The actuator's body and rod lengths, from its reach with the leg down and stowed. */
export function actuatorLengths(l: LegSpec): { body: number; rod: number; reach: number[] } {
  const { anchor, onLeg } = actuatorPoints(l);
  const reach = [1, 0].map((swing) => {
    const p = new Vector3(...onLeg).applyMatrix4(new Matrix4().makeRotationZ(legSwingAngle(swing)));
    return Math.hypot(p.x - anchor[0], p.y - anchor[1], p.z - anchor[2]);
  });
  return { ...stroke(reach), reach };
}

/** The shock's body and rod lengths, from its reach compressed on the ground, extended, and folded. */
export function shockLengths(l: LegSpec): { body: number; rod: number; reach: number[] } {
  const reach = [[1, COMPRESSION], [1, 0], [0, 0]].map(([u, c]) => {
    const { top, horn: h } = shockPoints(l, u, c);
    return Math.hypot(h[0] - top[0], h[1] - top[1]);
  });
  return { ...stroke(reach), reach };
}

/** A hydraulic body from its eye along +y, `len` long. */
function cylinder(len: number, r: number, slot: number): PolyMesh {
  return lathe([[0, -0.02], [r * 0.7, -0.02], [r, 0.03], [r, len - 0.04], [r * 1.12, len - 0.03], [r * 1.12, len], [r * 0.6, len + 0.01], [0, len + 0.01]], 20, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, slot);
}

const unit = (v: Vec3): Vec3 => {
  const k = Math.hypot(...v);
  return [v[0] / k, v[1] / k, v[2] / k];
};

function buildStrut(l: LegSpec): PolyMesh[] {
  const out: PolyMesh[] = [];
  const L = l.strut;
  // A box section tapering from the hip to the knee, every edge chamfered.
  const x1 = l.hx * 0.78;
  const z1 = l.hz * 0.85;
  const taper = (n: 1 | -1, a: number, b: number, axis: 'x' | 'z'): HalfSpace => {
    const dir: Vec3 = axis === 'x' ? [n * L, n * (a - b), 0] : [0, n * (a - b), n * L];
    return planeAt(unit(dir), axis === 'x' ? [n * a, 0, 0] : [0, 0, n * a]);
  };
  out.push(convexSolid(withBevels([
    { n: [0, 1, 0], d: l.hx * 1.1 },
    { n: [0, -1, 0], d: L + 0.02 },
    taper(1, l.hx, x1, 'x'),
    taper(-1, l.hx, x1, 'x'),
    taper(1, l.hz, z1, 'z'),
    taper(-1, l.hz, z1, 'z'),
  ], () => 0.022), () => S.titanium));
  // The hip: trunnion pins bearing in the well's walls, their bosses on the strut's cheeks.
  out.push(tube([{ p: [0, 0, -(l.bayHalf + 0.04)], r: 0.05 }, { p: [0, 0, l.bayHalf + 0.04], r: 0.05 }], 18, S.trim));
  for (const z of [-1, 1]) out.push(lathe([[0, -0.01], [0.085, -0.01], [0.085, 0.035], [0.07, 0.05], [0, 0.05]], 24, { o: [0, 0, z * (l.hz - 0.004)], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, z] }, S.titanium));
  // The knee's boss, through which the arm's pin runs.
  out.push(lathe([[0, -z1 - 0.004], [0.095 * (l.hx / 0.13), -z1 - 0.004], [0.095 * (l.hx / 0.13), z1 + 0.004], [0, z1 + 0.004]], 28, { o: [0, -L, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, S.titanium));
  // The shock's bracket on the aft face: two cheeks either side of its eye, the pin through them.
  const st = shockTop(l);
  const face = l.hx + (x1 - l.hx) * 0.55;
  for (const z of [-0.05, 0.05]) out.push(box({ o: [-(face + 0.045), st[1], z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.055, 0.06, 0.012, 0.004, S.titanium));
  out.push(tube([{ p: [st[0], st[1], -0.066], r: 0.022 }, { p: [st[0], st[1], 0.066], r: 0.022 }], 12, S.trim));
  // The actuator's lug on the inboard face.
  const a = actuatorPoints(l).onLeg;
  out.push(box({ o: [a[0], a[1], a[2] + 0.02], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.05, 0.05, 0.035, 0.006, S.titanium));
  // A hydraulic line down the strut's fore face in two clamps.
  const at = (f: number) => l.hx + (x1 - l.hx) * f;
  out.push(tube([{ p: [at(0) + 0.016, 0.02, 0.05], r: 0.011 }, { p: [at(0.05) + 0.02, -0.08, 0.05], r: 0.011 }, { p: [at(0.8) + 0.02, -0.8 * L, 0.05], r: 0.011 }], 12, S.rubber));
  for (const f of [0.25, 0.6]) out.push(box({ o: [at(f) + 0.008, -f * L, 0.05], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.022, 0.012, 0.02, 0.003, S.titanium));
  if (l.name === 'nose') {
    // The taxi light, looking ahead under the line.
    const ty = -0.45 * L;
    const tx = at(0.45);
    out.push(box({ o: [tx + 0.02, ty, -0.035], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.04, 0.04, 0.04, 0.008, S.titanium));
    const b: Basis = { o: [tx + 0.06, ty, -0.035], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] };
    out.push(extrudeBevel(roundedRect(0.03, 0.028, 0.012, 4), b, -0.005, 0.012, 0.003, S.landing));
  }
  return out;
}

function buildArm(l: LegSpec): PolyMesh[] {
  // Twin plates with a horn below, joined by the knee's pin, the horn's and the ankle's.
  const A = l.arm;
  const [hx, hy] = horn(l);
  const k = l.hx / 0.13;
  const outline: Vec2[] = [
    [-0.1 * k, -0.075 * k], [hx - 0.13, -0.085 * k], [hx - 0.06, hy - 0.05], [hx + 0.06, hy - 0.05], [hx + 0.13, -0.08 * k],
    [A + 0.075, -0.06 * k], [A + 0.075, 0.06 * k], [-0.1 * k, 0.075 * k],
  ];
  const out: PolyMesh[] = [];
  const pz = plateZ(l);
  for (const z of [-pz, pz]) out.push(extrudeBevel(outline, { o: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, -PLATE_T, PLATE_T, 0.006, S.titanium));
  const pin = (x: number, y: number, r: number, reach: number) => tube([{ p: [x, y, -reach], r }, { p: [x, y, reach], r }], 18, S.trim);
  out.push(pin(0, 0, 0.05 * k, pz + PLATE_T + 0.02));
  out.push(pin(hx, hy, 0.024, pz + PLATE_T + 0.012));
  out.push(pin(A, 0, 0.04, pz + PLATE_T + 0.016));
  // The knee's nuts on the pin's ends.
  for (const z of [-1, 1]) out.push(lathe([[0, 0], [0.065 * k, 0], [0.065 * k, 0.02], [0.05 * k, 0.03], [0, 0.03]], 6, { o: [0, 0, z * (pz + PLATE_T - 0.004)], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, z] }, S.titanium));
  return out;
}

function buildFoot(l: LegSpec): PolyMesh[] {
  // A broad pad with raked toe and heel, ribbed, a rubber sole; the ankle's clevis on it.
  const out: PolyMesh[] = [];
  const fX = l.footX;
  const fZ = l.footZ;
  const sole = -ANKLE;
  const top = sole + 0.075;
  out.push(convexSolid(withBevels([
    { n: [0, -1, 0], d: -(sole + 0.015) },
    { n: [0, 1, 0], d: top },
    { n: [0, 0, 1], d: fZ },
    { n: [0, 0, -1], d: fZ },
    planeAt(unit([0.5, 1, 0]), [fX - 0.05, top, 0]),
    planeAt(unit([-0.5, 1, 0]), [-fX + 0.05, top, 0]),
    { n: [1, 0, 0], d: fX },
    { n: [-1, 0, 0], d: fX },
  ], () => 0.012), () => S.titanium));
  out.push(extrudeBevel(roundedRect(fX - 0.02, fZ - 0.02, 0.05, 5), { o: [0, sole, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, 0, 0.02, 0.006, S.rubber));
  for (const z of [-0.6, 0.6]) out.push(box({ o: [0, top + 0.02, z * fZ], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, fX * 0.62, 0.025, 0.012, 0.004, S.titanium));
  // The clevis: a base on the pad, two cheeks up either side of the ankle pin, inside the plates.
  const pz = plateZ(l) - PLATE_T - 0.004;
  out.push(box({ o: [0, top + 0.01, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.09, 0.02, pz, 0.005, S.titanium));
  for (const z of [-1, 1]) out.push(extrudeBevel(roundedRect(0.07, 0.07, 0.03, 4), { o: [0, -0.03, z * (pz - 0.014)], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, -0.012, 0.012, 0.004, S.titanium));
  return out;
}

export function buildLeg(l: LegSpec): LegParts {
  const sh = shockLengths(l);
  const act = actuatorLengths(l);
  // The doors: half the bay each, closed flush in the skin's opening.
  const len = l.fore + l.aft;
  const door = (sd: 1 | -1): PolyMesh => extrudeBevel(roundedRect(len / 2 - 0.012, l.bayHalf / 2 - 0.008, 0.02, 4), { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, sd], w: [0, 1, 0] }, 0.0, 0.03, 0.006, S.hull);
  // The well: a tub standing on the skin's inner face, open below round the bay's opening (a
  // little wider than it), its walls and roof one shell.
  const cx = l.pivot[0] + (l.fore - l.aft) / 2;
  const t = 0.03;
  const whx = len / 2 + 0.04;
  const whz = l.bayHalf + 0.04;
  const y0 = l.skinY + l.wall + 0.002;
  const ox = whx + t + 0.032;
  const oz = whz + t + 0.032;
  const well = facetedShell([
    planeAt([1, 0, 0], [cx + ox, 0, 0]),
    planeAt([-1, 0, 0], [cx - ox, 0, 0]),
    planeAt([0, 0, 1], [0, 0, l.pivot[2] + oz]),
    planeAt([0, 0, -1], [0, 0, l.pivot[2] - oz]),
    planeAt([0, -1, 0], [0, y0, 0]),
    planeAt([0, 1, 0], [0, y0 + WELL_DEPTH + t, 0]),
  ], t, { slot: () => S.matte, apertures: [{ plane: 4, centre: [cx, y0, l.pivot[2]], u: [1, 0, 0], hw: whx, hh: whz, r: 0.03, slot: S.matte }], margin: 0.02 });
  return {
    strut: buildStrut(l),
    arm: buildArm(l),
    foot: buildFoot(l),
    shockBody: cylinder(sh.body, 0.045 + 0.1 * l.hz, S.titanium),
    shockRod: tube([{ p: [0, -0.02, 0], r: 0.022 + 0.06 * l.hz }, { p: [0, sh.rod, 0], r: 0.022 + 0.06 * l.hz }], 16, S.trim),
    actuatorBody: cylinder(act.body, 0.06, S.titanium),
    actuatorRod: tube([{ p: [0, -0.02, 0], r: 0.032 }, { p: [0, act.rod, 0], r: 0.032 }], 14, S.trim),
    doors: [door(1), door(-1)],
    well: [well],
  };
}

/** Gear sequence over g (0 stowed … 1 down): the doors open, the leg swings down, the arm unfolds. */
export function gearAngles(g: number): { leg: number; door: number; arm: number } {
  const s = (a: number, b: number) => {
    const x = Math.min(Math.max((g - a) / (b - a), 0), 1);
    return x * x * (3 - 2 * x);
  };
  return { door: s(0, 0.3), leg: s(0.25, 0.9), arm: s(0.45, 1) };
}

/** The leg's frame in the ship's (swing 0 stowed … 1 down). */
export function legPose(l: LegSpec, swing: number, out = new Matrix4()): Matrix4 {
  return out.makeRotationZ(legSwingAngle(swing)).setPosition(l.pivot[0], l.pivot[1], l.pivot[2]);
}

/** A door's frame (side ±1) for its opening angle (0 shut … 1 open, 100° down and out). */
export function doorPose(l: LegSpec, side: 1 | -1, open: number, out = new Matrix4()): Matrix4 {
  const cx = l.pivot[0] + (l.fore - l.aft) / 2;
  const hingeZ = l.pivot[2] + side * l.bayHalf;
  // Down and out: the plate's free (inboard) edge swings down.
  const angle = -side * open * ((100 * Math.PI) / 180);
  // Hinged on the bay's long edge in the skin; its plate lies inboard of the hinge, closed.
  const m = new Matrix4().makeRotationX(angle);
  const toHinge = new Matrix4().makeTranslation(cx, l.skinY + 0.002, hingeZ);
  const fromHinge = new Matrix4().makeTranslation(0, 0, -side * (l.bayHalf / 2));
  return out.multiplyMatrices(toHinge, m).multiply(fromHinge);
}

export interface LegPose {
  strut: Matrix4;
  arm: Matrix4;
  foot: Matrix4;
  shockBody: Matrix4;
  shockRod: Matrix4;
  actuatorBody: Matrix4;
  actuatorRod: Matrix4;
  doors: [Matrix4, Matrix4];
}

/**
 * Every moving piece of a leg posed in the ship frame for a gear state (g: 0 stowed … 1 down) and a
 * compression. The ship, the review tool and the tests all pose the gear through this.
 */
export function poseLeg(l: LegSpec, g: number, compression: number, out?: LegPose): LegPose {
  const p = out ?? { strut: new Matrix4(), arm: new Matrix4(), foot: new Matrix4(), shockBody: new Matrix4(), shockRod: new Matrix4(), actuatorBody: new Matrix4(), actuatorRod: new Matrix4(), doors: [new Matrix4(), new Matrix4()] };
  const a = gearAngles(g);
  legPose(l, a.leg, p.strut);
  p.arm.multiplyMatrices(p.strut, armPose(l, a.arm, compression, M));
  footPose(l, a.leg, a.arm, compression, p.foot);
  const sp = shockPoints(l, a.arm, compression);
  const top = V0.set(...sp.top).applyMatrix4(p.strut);
  const hn = V1.set(...sp.horn).applyMatrix4(p.strut);
  along(top, hn, p.shockBody);
  along(hn, top, p.shockRod);
  const ap = actuatorPoints(l);
  const anchor = V0.set(l.pivot[0] + ap.anchor[0], l.pivot[1] + ap.anchor[1], l.pivot[2] + ap.anchor[2]);
  const lug = V1.set(...ap.onLeg).applyMatrix4(p.strut);
  along(anchor, lug, p.actuatorBody);
  along(lug, anchor, p.actuatorRod);
  doorPose(l, 1, a.door, p.doors[0]);
  doorPose(l, -1, a.door, p.doors[1]);
  return p;
}

const M = new Matrix4();
const V0 = new Vector3();
const V1 = new Vector3();
const AX = new Vector3();
const AY = new Vector3();
const AZ = new Vector3();

/** A frame at `from` whose +y points at `to`, its x across the line in the ship's xy plane. */
function along(from: Vector3, to: Vector3, out: Matrix4): Matrix4 {
  AY.subVectors(to, from).normalize();
  AX.set(0, 0, 1).cross(AY);
  if (AX.lengthSq() < 1e-8) AX.set(1, 0, 0);
  AX.normalize();
  AZ.crossVectors(AX, AY);
  return out.makeBasis(AX, AY, AZ).setPosition(from);
}
