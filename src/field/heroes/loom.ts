/**
 * The Loom (city_plan.md §5.2): the materials works. It draws a continuous ribbon of the sphere's
 * refractory alloy from a travelling furnace head and winds it on a spool.
 *
 *  - Gantry: two long ceramic rail girders (gold crane-track caps) on forked legs at irregular
 *    spacing: each a tapered trunk on a plinth, branching into two arms along the rail.
 *  - The furnace carriage: a streamlined gold body riding the rails on four bogies, its draw slit
 *    level with the coil's crown, so the ribbon runs straight onto the top of the spool. Its draw slit glows (field/materials: glow), and the ribbon leaves it
 *    incandescent, cooling over its first tens of metres.
 *  - The spool at the east end: a hub, the wound coil of dark alloy, two great gold flanges,
 *    its axle in bearing pedestals and a drive at one end. It turns as it winds.
 *
 * Motion: the carriage creeps along the gantry (a two-hour traverse each way), the spool turns
 * with the ribbon's draw (0.15 m/s), the cool span of ribbon stretches to the spool.
 */
import { Matrix4 } from 'three';
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, girderProfile, sweep } from '../../geometry/sweep';
import { basisAlong, box, extrudeBevel, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { Parts, rng, unevenSpacing, type Mover } from '../kit/parts';
import { FIELD_Y, LOOM } from '../layout';

export const GANTRY = {
  /** Rail girders: half-width, depth, top (above the platform). */
  railHalf: 1.6,
  railDepth: 4,
  railTop: LOOM.railTop,
  /** Fork height of the legs, and how far their arms reach along the rail. */
  fork: 22,
  arm: 5.5,
} as const;

export const SPOOL = { hubR: 7, coilR: 19, flangeR: LOOM.spool.d / 2, flangeT: 1.0 } as const;

export const CARRIAGE = {
  /** Body length (x), half-width across both rails (z), bottom and top: it rides on the rails. */
  len: 30,
  halfWidth: 16.8,
  bottom: LOOM.railTop + 1.5,
  top: LOOM.railTop + 14.5,
  /** The draw slit, on the body's east nose, level with the coil's crown: the ribbon runs straight onto the spool's top. */
  slitY: LOOM.spool.centreY + SPOOL.coilR,
  /** Traverse: the carriage's centre runs between these x. */
  x0: 60,
  x1: 250,
  speed: (250 - 60) / 7200,
} as const;

export const RIBBON = { halfWidth: 4, thickness: 0.08, speed: 0.15, hot: 30 } as const;

const zc = (LOOM.zA + LOOM.zB) / 2;

/** Carriage centre x at game time t (ping-pong traverse). */
export function carriageX(t: number): number {
  const span = CARRIAGE.x1 - CARRIAGE.x0;
  const d = (t * CARRIAGE.speed + span * 0.35) % (2 * span);
  return CARRIAGE.x0 + (d < span ? d : 2 * span - d);
}

function rails(parts: Parts): void {
  for (const [k, z] of [LOOM.zA, LOOM.zB].entries()) {
    const prof = girderProfile({ halfWidth: GANTRY.railHalf, t0: GANTRY.railTop - GANTRY.railDepth, t1: GANTRY.railTop, chamferBottom: 0.25, chamferTop: 0.15, grooves: [[GANTRY.railTop - 2.9, GANTRY.railTop - 1.1, 0.18]] });
    const a: Vec3 = [LOOM.x0, FIELD_Y, z];
    const b: Vec3 = [LOOM.x1, FIELD_Y, z];
    parts.add(`rail${k}`, orientOutward(sweep(framesFrom([a, b], [[0, 1, 0], [0, 1, 0]]), prof, { crease: 30, capSlot: FIELD_SLOT.ceramic })));
    // The crane track: a gold cap along the girder's top (seated 20 mm).
    parts.add(`track${k}`, box({ o: [(LOOM.x0 + LOOM.x1) / 2, FIELD_Y + GANTRY.railTop + 0.12, z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, (LOOM.x1 - LOOM.x0) / 2 - 0.6, 0.55, 0.14, 0.04, FIELD_SLOT.satin));
  }
}

function legs(parts: Parts): number[] {
  const rand = rng(77);
  // Irregular spacing; no leg where the avenue and the square main pass under the gantry (it spans them).
  const xs = unevenSpacing(LOOM.x1 - LOOM.x0 - 16, 34, 0.3, rand)
    .map((s) => LOOM.x0 + 8 + s)
    .map((x) => {
      for (const [a, b] of LOOM.legKeepout) if (x > a - GANTRY.arm - 2 && x < b + GANTRY.arm + 2) return x - a < b - x ? a - GANTRY.arm - 2 : b + GANTRY.arm + 2;
      return x;
    })
    .filter((x, i, all) => i === 0 || x - all[i - 1] > 2 * GANTRY.arm + 6);
  xs.forEach((x, i) => {
    for (const [k, z] of [LOOM.zA, LOOM.zB].entries()) {
      const foot: Vec3 = [x, FIELD_Y, z];
      parts.add(`plinth${i}:${k}`, box({ o: v3.add(foot, [0, 0.4, 0]), u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, 2.2, 1.9, 0.42, 0.08, FIELD_SLOT.ceramic));
      parts.add(`trunk${i}:${k}`, tube([
        { p: v3.add(foot, [0, 0.75, 0]), r: 1.45 },
        { p: v3.add(foot, [0, GANTRY.fork * 0.55, 0]), r: 1.15 },
        { p: v3.add(foot, [0, GANTRY.fork, 0]), r: 1.05 },
        { p: v3.add(foot, [0, GANTRY.fork + 1.2, 0]), r: 0.95 },
      ], 24, FIELD_SLOT.ceramic));
      const top = GANTRY.railTop - GANTRY.railDepth + 0.25;
      for (const e of [-1, 1]) {
        parts.add(`arm${i}:${k}:${e}`, tube([
          { p: v3.add(foot, [0, GANTRY.fork + 0.3, 0]), r: 0.8 },
          { p: v3.add(foot, [e * GANTRY.arm * 0.45, GANTRY.fork + 3.6, 0]), r: 0.68 },
          { p: v3.add(foot, [e * GANTRY.arm, top - 0.6, 0]), r: 0.6 },
          { p: v3.add(foot, [e * GANTRY.arm, top, 0]), r: 0.62 },
        ], 18, FIELD_SLOT.ceramic));
      }
    }
  });
  return xs;
}

/** The carriage in its own frame (origin: its centre at the slit's height on the gantry's axis). */
function carriage(parts: Parts): void {
  const L = CARRIAGE.len;
  const W = CARRIAGE.halfWidth;
  const y0 = CARRIAGE.bottom - CARRIAGE.slitY;
  const y1 = CARRIAGE.top - CARRIAGE.slitY;
  // Body: a lozenge in plan (rounded ends), a lens in section, swept along x: one streamlined form.
  const n = 40;
  const section = (sx: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      out.push([W * sx * Math.sign(c) * Math.abs(c) ** 0.55, (y0 + y1) / 2 + ((y1 - y0) / 2) * sx ** 0.35 * Math.sign(s) * Math.abs(s) ** 0.7]);
    }
    return out;
  };
  const xs: number[] = [];
  for (let k = 0; k <= 24; k++) xs.push(-L / 2 + (L * k) / 24);
  const shape = (x: number) => {
    const t = Math.abs(x) / (L / 2);
    return Math.max(0.06, Math.sqrt(Math.max(0, 1 - t ** 4)));
  };
  const pts: Vec3[] = xs.map((x) => [x, 0, 0]);
  const frames = framesFrom(pts, pts.map(() => [0, 1, 0] as Vec3));
  const prof = (_f: unknown, i: number) => {
    const sec = section(shape(xs[i]));
    // Section is (z, y); the sweep's b axis is −z for a +x path with +y up.
    const loop = sec.map(([z, y]) => [-z, y] as Vec2);
    return { pts: loop, slots: loop.map(() => FIELD_SLOT.gold) };
  };
  parts.add('body', orientOutward(sweep(frames, prof, { crease: 50, capSlot: FIELD_SLOT.gold })));
  // The draw head: a ceramic collar round the east nose, and the glowing slit in it.
  const nose = L / 2 - 2.6;
  parts.add('head', lathe([[2.2, -0.6], [5.6, -0.6], [5.9, 0.0], [5.9, 2.2], [5.4, 2.8], [2.2, 2.8]], 64, basisAlong([nose, 0, 0], [1, 0, 0]), FIELD_SLOT.ceramic));
  parts.add('slit', box({ o: [nose + 2.6, 0, 0], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] }, RIBBON.halfWidth + 0.5, 0.5, 0.45, 0.05, FIELD_SLOT.black));
  // Bogies on the crane tracks under the body (seated in it), each on two wheels.
  for (const sx of [-1, 1]) {
    for (const [k, z] of [LOOM.zA, LOOM.zB].entries()) {
      const zz = z - zc;
      const track = GANTRY.railTop + 0.26 - CARRIAGE.slitY;
      const b0 = track + 0.25;
      const b1 = y0 + 0.6;
      parts.add(`bogie${sx}:${k}`, box({ o: [sx * 8.5, (b0 + b1) / 2, zz], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, 3.4, 1.0, (b1 - b0) / 2, 0.1, FIELD_SLOT.steel));
      for (const wx of [-2.2, 2.2]) parts.add(`wheel${sx}:${k}:${wx}`, lathe([[0, -0.45], [0.6, -0.45], [0.6, 0.45], [0, 0.45]], 32, basisAlong([sx * 8.5 + wx, track + 0.58, zz], [0, 0, 1]), FIELD_SLOT.chrome));
    }
  }
  // The hot span of ribbon, from inside the slit east (its glow cools along u).
  const r0 = nose + 2.4;
  parts.add('ribbon:hot', ribbon(r0, r0 + RIBBON.hot, FIELD_SLOT.glow));
}

/** A ribbon plate from x0 to x1 (centred on the gantry axis at the slit's height); u is metres from x0. */
function ribbon(x0: number, x1: number, slot: number, halfWidth: number = RIBBON.halfWidth) {
  const b: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  const outline: Vec2[] = [[x0, -halfWidth], [x1, -halfWidth], [x1, halfWidth], [x0, halfWidth]];
  const m = extrudeBevel(outline, b, -RIBBON.thickness / 2, RIBBON.thickness / 2, 0.01, slot);
  // u from x0 in metres (the glow's cooling coordinate).
  m.uvs = m.uvs.map((face, fi) => face.map((_, ci) => [m.verts[m.faces[fi][ci]][0] - x0, m.verts[m.faces[fi][ci]][2]] as Vec2));
  return m;
}

/** The spool in its own frame (origin on its axis, mid-length; axis along z). */
function spool(parts: Parts): void {
  const half = (LOOM.spool.z1 - LOOM.spool.z0) / 2;
  const b: Basis = { o: [0, 0, -half], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
  const F = SPOOL.flangeR;
  const t = SPOOL.flangeT;
  parts.add('coil', lathe([[SPOOL.hubR - 0.2, t - 0.05], [SPOOL.coilR, t - 0.05], [SPOOL.coilR, 2 * half - t + 0.05], [SPOOL.hubR - 0.2, 2 * half - t + 0.05]], 128, b, FIELD_SLOT.alloy));
  parts.add('hub', lathe([[2.2, -1.0], [SPOOL.hubR, -1.0], [SPOOL.hubR, 2 * half + 1.0], [2.2, 2 * half + 1.0]], 96, b, FIELD_SLOT.satin));
  for (const e of [0, 1]) {
    const z0 = e === 0 ? 0 : 2 * half - t;
    // A flange: a gold disc with a raised rim and a ring of lightening ports' bosses.
    parts.add(`flange${e}`, lathe([[SPOOL.hubR - 0.3, z0], [F - 0.35, z0], [F, z0 + 0.25], [F, z0 + t - 0.25], [F - 0.35, z0 + t], [SPOOL.hubR - 0.3, z0 + t]], 160, b, FIELD_SLOT.gold));
    for (let k = 0; k < 9; k++) {
      const a = (2 * Math.PI * k) / 9 + e * 0.17;
      const r = (SPOOL.coilR + F) / 2 + 0.6;
      const c: Vec3 = [Math.cos(a) * r, Math.sin(a) * r, -half + (e === 0 ? -0.08 : 2 * half + 0.08)];
      parts.add(`boss${e}:${k}`, lathe([[0, -0.15], [0.9, -0.15], [0.9, 0.12], [0.7, 0.25], [0, 0.25]], 28, basisAlong(c, [0, 0, e === 0 ? -1 : 1]), FIELD_SLOT.bronze));
    }
  }
  parts.add('axle', lathe([[0, -half - 7.5], [2.0, -half - 7.5], [2.0, half + 7.5], [0, half + 7.5]], 48, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, FIELD_SLOT.chrome));
}

function spoolStand(parts: Parts): void {
  const half = (LOOM.spool.z1 - LOOM.spool.z0) / 2;
  for (const s of [-1, 1]) {
    const z = zc + s * (half + 4.6);
    const outline: Vec2[] = [[-9, -0.02], [9, -0.02], [6.2, LOOM.spool.centreY - 3.6], [4.2, LOOM.spool.centreY + 3.2], [-4.2, LOOM.spool.centreY + 3.2], [-6.2, LOOM.spool.centreY - 3.6]];
    parts.add(`pedestal${s}`, extrudeBevel(outline, { o: [LOOM.spool.x, FIELD_Y, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, -2.4, 2.4, 0.2, FIELD_SLOT.ceramic));
    parts.add(`bearing${s}`, lathe([[0, -0.1], [3.6, -0.1], [3.6, 0.35], [3.2, 0.5], [3.2, 0.85], [0, 0.85]], 48, basisAlong([LOOM.spool.x, FIELD_Y + LOOM.spool.centreY, z - s * 2.45], [0, 0, -s]), FIELD_SLOT.bronze));
  }
  // The drive: a gearbox and motor on the south pedestal's outer face.
  const z = zc + half + 4.6 + 2.4;
  parts.add('gearbox', box({ o: [LOOM.spool.x, FIELD_Y + LOOM.spool.centreY - 1, z + 2.1], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 3.6, 4.4, 2.15, 0.2, FIELD_SLOT.steel));
  parts.add('motor', lathe([[0, -0.1], [2.4, -0.1], [2.4, 4.5], [1.8, 5.0], [0, 5.0]], 40, basisAlong([LOOM.spool.x - 1.2, FIELD_Y + LOOM.spool.centreY - 3.0, z + 4.2], [0, 0, 1]), FIELD_SLOT.steel));
}

export interface LoomBuild {
  parts: Parts;
  movers: Mover[];
}

export function buildLoom(): LoomBuild {
  const parts = new Parts('loom');
  rails(parts);
  legs(parts);
  spoolStand(parts);
  const car = new Parts('loom:carriage');
  carriage(car);
  const cool = new Parts('loom:ribbon');
  // A hair narrower than the hot span it overlaps, so their edges never coincide.
  cool.add('cool', ribbon(0, 1, FIELD_SLOT.alloy, RIBBON.halfWidth - 0.012));
  const sp = new Parts('loom:spool');
  spool(sp);
  const slitX = CARRIAGE.len / 2 - 2.6 + 2.4;
  const m = new Matrix4();
  const tmp = new Matrix4();
  const movers: Mover[] = [
    {
      name: 'carriage',
      parts: car.list,
      pose: (t, out) => out.copy(m.makeTranslation(carriageX(t), FIELD_Y + CARRIAGE.slitY, zc)),
    },
    {
      // The cool span: from the hot span's end to where the ribbon meets the coil.
      name: 'ribbon',
      parts: cool.list,
      pose: (t, out) => {
        const x0 = carriageX(t) + slitX + RIBBON.hot - 0.05;
        // It lands on the coil's crown, resting on it.
        const x1 = LOOM.spool.x + 0.05;
        return out.copy(m.makeTranslation(x0, FIELD_Y + CARRIAGE.slitY + RIBBON.thickness / 2 - 0.01, zc).multiply(tmp.makeScale(Math.max(0.1, x1 - x0), 1, 1)));
      },
    },
    {
      name: 'spool',
      parts: sp.list,
      // Winding over the top from the west: the crown moves east, so it turns clockwise about +z.
      pose: (t, out) => out.copy(m.makeTranslation(LOOM.spool.x, FIELD_Y + LOOM.spool.centreY, zc).multiply(tmp.makeRotationZ((-t * RIBBON.speed) / SPOOL.coilR))),
    },
  ];
  return { parts, movers };
}
