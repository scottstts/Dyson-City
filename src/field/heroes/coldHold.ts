/**
 * The Cold Hold (city_plan.md §5.2): the craft's propellant and the compound's cryogen store. A
 * cluster of foil-wrapped spherical tanks of power-law sizes on ceramic columns, linked by
 * foil-wrapped pipe runs. Relief stacks on their crowns breathe vapour now and then. The nearest
 * gold to the house: the house's reflection lives in its spheres.
 *
 * Each tank is built as such spheres are (Horton spheres):
 *  - the shell is wrapped in multi-layer insulation, its gores running pole to pole (UV u is
 *    longitude × equatorial radius, so gore seams converge at the poles);
 *  - columns stand round the equator, tangent to the shell, each bearing on a black glazed pad
 *    welded to it; tie rods brace each bay of columns in an X;
 *  - a manway and the relief stack on the crown, the outlet nozzle at the bottom;
 *  - the larger tanks carry a crown platform reached by a caged ladder up a column and a ladder
 *    curving up the shell.
 * Outlets run to the nearest larger tank at low level, on sleepers.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { basisAlong, box, lathe, orientOutward, tube } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { Parts, rng } from '../kit/parts';
import { guardRail, rod } from '../kit/access';
import { pipeRun } from '../kit/pipe';
import { COLD_HOLD, FIELD_Y, distToViaduct, onRoad } from '../layout';

export interface Tank {
  name: string;
  x: number;
  z: number;
  R: number;
  /** Equator height above the platform. */
  eq: number;
  legs: number;
  /** Column centres' plan radius about the tank's axis, and the column radius. */
  colR: number;
  colAt: number;
}

/** A sphere with metric gore UVs: u = longitude × R (seams converge at the poles), v = arc from the bottom. */
export function globe(c: Vec3, R: number, segU: number, segV: number, slot: number): PolyMesh {
  const m = new PolyMesh(55);
  const bottom = m.vert([c[0], c[1] - R, c[2]]);
  const top = m.vert([c[0], c[1] + R, c[2]]);
  const rows: number[][] = [];
  for (let j = 1; j < segV; j++) {
    const lat = -Math.PI / 2 + (Math.PI * j) / segV;
    const row: number[] = [];
    for (let i = 0; i < segU; i++) {
      const lon = (2 * Math.PI * i) / segU;
      row.push(m.vert([c[0] + Math.cos(lat) * Math.cos(lon) * R, c[1] + Math.sin(lat) * R, c[2] + Math.cos(lat) * Math.sin(lon) * R]));
    }
    rows.push(row);
  }
  const u = (i: number) => ((2 * Math.PI * i) / segU) * R;
  const v = (j: number) => (Math.PI * j * R) / segV;
  for (let i = 0; i < segU; i++) {
    const i1 = (i + 1) % segU;
    m.face([bottom, rows[0][i1], rows[0][i]], slot, [[u(i) + (u(i + 1) - u(i)) / 2, 0], [u(i + 1), v(1)], [u(i), v(1)]]);
    for (let j = 0; j + 1 < rows.length; j++) {
      m.face([rows[j][i], rows[j][i1], rows[j + 1][i1], rows[j + 1][i]], slot, [[u(i), v(j + 1)], [u(i + 1), v(j + 1)], [u(i + 1), v(j + 2)], [u(i), v(j + 2)]]);
    }
    const last = rows.length - 1;
    m.face([rows[last][i], rows[last][i1], top], slot, [[u(i), v(segV - 1)], [u(i + 1), v(segV - 1)], [u(i) + (u(i + 1) - u(i)) / 2, v(segV)]]);
  }
  return orientOutward(m);
}

/** The tanks' layout: power-law diameters, packed into the inner north-west block (the cryogen precinct), clear of the core, the roads and the viaducts. */
export function tankLayout(): Tank[] {
  const rand = rng(7);
  const diam: number[] = [];
  for (let i = 0; i < COLD_HOLD.count; i++) diam.push(Math.min(COLD_HOLD.dMax, COLD_HOLD.dMin * Math.pow(1 - rand() * 0.985, -1 / 1.5)));
  diam.sort((a, b) => b - a);
  diam[0] = COLD_HOLD.dMax;
  diam[1] = 30;
  const out: Tank[] = [];
  for (const d of diam) {
    const R = d / 2;
    const legs = Math.max(4, Math.min(10, Math.round(d / 3.1)));
    const colAt = 0.18 + d * 0.012;
    for (let tries = 0; tries < 6000; tries++) {
      const reach = R + colAt + 1.5;
      const x = COLD_HOLD.x0 + reach + rand() * (COLD_HOLD.x1 - COLD_HOLD.x0 - 2 * reach);
      const z = COLD_HOLD.z0 + reach + rand() * (COLD_HOLD.z1 - COLD_HOLD.z0 - 2 * reach);
      if (Math.hypot(x, z) < COLD_HOLD.coreClear + reach) continue;
      if (onRoad(x, z, reach + 4)) continue;
      if (distToViaduct(x, z) < reach + 5) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < s.R + s.colAt + reach + 6)) continue;
      // Outlet runs go to the nearest earlier (larger) tank: keep this tank's columns off the runs
      // already implied, and its own run off the other tanks' columns.
      const nearest = (px: number, pz: number, upto: number) => {
        let best = 0;
        for (let j = 1; j < upto; j++) if (Math.hypot(out[j].x - px, out[j].z - pz) < Math.hypot(out[best].x - px, out[best].z - pz)) best = j;
        return out[best];
      };
      if (out.some((s, i) => i > 0 && segDist(x, z, [s.x, s.z], [nearest(s.x, s.z, i).x, nearest(s.x, s.z, i).z]) < reach + 1.5)) continue;
      if (out.length > 0) {
        const p = nearest(x, z, out.length);
        if (out.some((s) => s !== p && segDist(s.x, s.z, [x, z], [p.x, p.z]) < s.R + s.colAt + 1.5)) continue;
      }
      const clear = Math.max(4.4, 2.2 + d * 0.17);
      out.push({ name: `t${out.length}`, x, z, R, eq: clear + R, legs, colR: R + colAt * 0.35, colAt });
      break;
    }
  }
  return out;
}

function segDist(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Where a tank's relief stack stands on its crown (its foot on the shell), and its height. */
function stackAt(t: Tank): { sx: number; sy: number; sz: number; sh: number } {
  const sx = t.x - t.R * 0.22;
  const sz = t.z + t.R * 0.12;
  const sy = FIELD_Y + t.eq + Math.sqrt(Math.max(0, t.R * t.R - (t.R * 0.22) ** 2 - (t.R * 0.12) ** 2));
  return { sx, sy, sz, sh: 1.6 + t.R * 0.12 };
}

/** The relief stacks' vent tips (cheap: from the layout alone). */
export function reliefStacks(): Vent[] {
  return tankLayout().map((t) => {
    const { sx, sy, sz, sh } = stackAt(t);
    return { p: [sx, sy + sh + 0.3, sz] as Vec3, size: t.R / 17 };
  });
}

/** Crown relief stacks: where vapour vents (sound and VFX read these). */
export interface Vent {
  p: Vec3;
  /** Relative size (scales the plume). */
  size: number;
}

export interface ColdHoldBuild {
  parts: Parts;
  tanks: Tank[];
  vents: Vent[];
}

export function buildColdHold(): ColdHoldBuild {
  const parts = new Parts('hold');
  const tanks = tankLayout();
  const vents: Vent[] = [];
  const Y: Vec3 = [0, 1, 0];
  // The outlet tree: each tank's run goes to the nearest larger tank (see the outlets below).
  const parent: number[] = tanks.map(() => -1);
  const level: number[] = tanks.map(() => FIELD_Y + 0.9);
  const children: number[] = tanks.map(() => 0);
  tanks.forEach((t, i) => {
    if (i === 0) return;
    // The nearest larger tank whose run passes clear of every other tank's ring of columns
    // (the nearest of all if none does).
    const clear = (j: number) =>
      tanks.every((k, ki) => ki === i || ki === j || segDist(k.x, k.z, [t.x, t.z], [tanks[j].x, tanks[j].z]) > k.colR + k.colAt + 1.5);
    let bd = Infinity;
    for (let pass = 0; pass < 2 && parent[i] < 0; pass++) for (let j = 0; j < i; j++) {
      if (pass === 0 && !clear(j)) continue;
      const d = Math.hypot(tanks[j].x - t.x, tanks[j].z - t.z);
      if (d < bd) {
        bd = d;
        parent[i] = j;
      }
    }
    const p = parent[i];
    level[i] = FIELD_Y + 0.9 + 0.48 * children[p] + (i % 3) * 0.16;
    children[p]++;
  });
  // Levels: runs that cross in plan or meet at one riser must pass at different heights, a pipe
  // apart; greedy over the runs, lowest level first.
  {
    const rr = (i: number) => 0.15 + tanks[i].R * 0.012;
    const seg = (i: number): [[number, number], [number, number]] => [[tanks[i].x, tanks[i].z], [tanks[parent[i]].x, tanks[parent[i]].z]];
    const segSeg = (a: [[number, number], [number, number]], b: [[number, number], [number, number]]) =>
      Math.min(segDist(a[0][0], a[0][1], b[0], b[1]), segDist(a[1][0], a[1][1], b[0], b[1]), segDist(b[0][0], b[0][1], a[0], a[1]), segDist(b[1][0], b[1][1], a[0], a[1]), crosses(a, b) ? 0 : Infinity);
    const done: number[] = [];
    for (let i = 1; i < tanks.length; i++) {
      for (let k = 0; ; k++) {
        const y = FIELD_Y + 0.9 + 0.82 * k;
        const ok = done.every((j) => {
          const near = parent[j] === parent[i] || parent[j] === i || parent[i] === j || segSeg(seg(i), seg(j)) < rr(i) + rr(j) + 0.3;
          return !near || Math.abs(level[j] - y) > rr(i) + rr(j) + 0.12;
        });
        if (ok) {
          level[i] = y;
          break;
        }
      }
      done.push(i);
    }
  }
  const runSegs: [[number, number], [number, number]][] = tanks.flatMap((t, i) => (i === 0 ? [] : [[[t.x, t.z], [tanks[parent[i]].x, tanks[parent[i]].z]] as [[number, number], [number, number]]]));
  /** Column phase per tank: the bays between columns face every pipe run (and the ladder). */
  const phaseOf = (i: number): number => {
    const t = tanks[i];
    const dirs: number[] = [];
    if (parent[i] >= 0) dirs.push(Math.atan2(tanks[parent[i]].z - t.z, tanks[parent[i]].x - t.x));
    tanks.forEach((c, k) => {
      if (parent[k] === i) dirs.push(Math.atan2(c.z - t.z, c.x - t.x));
    });
    const step = (2 * Math.PI) / t.legs;
    let best = 0;
    let bestScore = -1;
    for (let s = 0; s < 96; s++) {
      const ph = (step * s) / 96;
      let score = Infinity;
      for (let k = 0; k < t.legs; k++) for (const d of dirs) score = Math.min(score, Math.abs(Math.atan2(Math.sin(ph + step * k - d), Math.cos(ph + step * k - d))));
      // The ladder rises in the bay at phase + step / 2: keep it off the runs too.
      for (const d of dirs) score = Math.min(score, Math.abs(Math.atan2(Math.sin(ph + step / 2 - d), Math.cos(ph + step / 2 - d))) * 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = ph;
      }
    }
    return best;
  };
  // Every column's foot and plinth radius (sleepers keep off them).
  const columns: { p: Vec3; r: number }[] = [];
  tanks.forEach((t, ti) => {
    const c: Vec3 = [t.x, FIELD_Y + t.eq, t.z];
    const segU = Math.max(48, Math.round(t.R * 5.5));
    const segV = Math.max(24, Math.round(t.R * 2.8));
    parts.add(`${t.name}:shell`, globe(c, t.R, segU, segV, FIELD_SLOT.foil));
    // Columns: tangent to the shell at the equator, each on a plinth, bearing on a black pad.
    const phase = phaseOf(ti);
    const cols: Vec3[] = [];
    for (let k = 0; k < t.legs; k++) {
      const a = phase + (2 * Math.PI * k) / t.legs;
      const p: Vec3 = [t.x + Math.cos(a) * t.colR, FIELD_Y, t.z + Math.sin(a) * t.colR];
      cols.push(p);
      columns.push({ p, r: t.colAt + 0.42 });
      const r = t.colAt;
      const h = t.eq;
      const prof: Vec2[] = [[0, -0.02], [r + 0.42, -0.02], [r + 0.42, 0.42], [r + 0.3, 0.55], [r + 0.08, 0.6], [r, 0.75], [r * 0.88, h - 1.1], [r * 1.25, h - 0.55], [r * 1.25, h - 0.22], [0, h - 0.22]];
      parts.add(`${t.name}:col${k}`, lathe(prof, 28, basisAlong(p, Y), FIELD_SLOT.ceramic, 34));
      // The pad: a black glazed block between the column head and the shell, seated in both.
      const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const tan: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
      const padC: Vec3 = [p[0] - out[0] * 0.1, FIELD_Y + h - 0.05, p[2] - out[2] * 0.1];
      parts.add(`${t.name}:pad${k}`, box({ o: padC, u: out, v: tan, w: Y }, r * 1.4, r * 1.35, 0.32, 0.04, FIELD_SLOT.black));
    }
    // X-bracing in each bay: tie rods between neighbouring columns, low and mid height.
    const rodR = 0.035 + t.R * 0.003;
    for (let k = 0; k < cols.length; k++) {
      const a = cols[k];
      const b = cols[(k + 1) % cols.length];
      // A bay a pipe run passes through stays open.
      const chord: [[number, number], [number, number]] = [[a[0], a[2]], [b[0], b[2]]];
      if (runSegs.some((s) => crosses(s, chord) || segDist(s[0][0], s[0][1], chord[0], chord[1]) < 0.8 || segDist(s[1][0], s[1][1], chord[0], chord[1]) < 0.8)) continue;
      const y0 = 1.3;
      const y1 = t.eq - t.R * 0.62 - 0.8;
      if (y1 - y0 < 1.5) continue;
      const along = v3.norm(v3.sub(b, a));
      const inset = t.colAt * 0.9;
      const A0: Vec3 = v3.add(a, v3.add(v3.scale(along, inset), [0, y0, 0]));
      const A1: Vec3 = v3.add(a, v3.add(v3.scale(along, inset), [0, y1, 0]));
      const B0: Vec3 = v3.add(b, v3.add(v3.scale(along, -inset), [0, y0, 0]));
      const B1: Vec3 = v3.add(b, v3.add(v3.scale(along, -inset), [0, y1, 0]));
      // The two rods of an X pass 2 rod-diameters apart (one inboard, one outboard).
      const n = v3.norm(v3.cross(along, Y));
      const d = rodR * 2.2;
      parts.add(`${t.name}:brace${k}a`, rod(v3.add(A0, v3.scale(n, d)), v3.add(B1, v3.scale(n, d)), rodR, FIELD_SLOT.steel, 8));
      parts.add(`${t.name}:brace${k}b`, rod(v3.add(A1, v3.scale(n, -d)), v3.add(B0, v3.scale(n, -d)), rodR, FIELD_SLOT.steel, 8));
    }
    // Crown: manway, and the relief stack (riser, valve body, vent tip).
    const top: Vec3 = [t.x, FIELD_Y + t.eq + t.R, t.z];
    const mr = 0.45 + t.R * 0.02;
    parts.add(`${t.name}:manway`, lathe([[0, -0.4], [mr, -0.4], [mr, 0.35], [mr + 0.18, 0.35], [mr + 0.18, 0.52], [0, 0.52]], 32, basisAlong(top, Y), FIELD_SLOT.steel));
    const { sx, sy, sz, sh } = stackAt(t);
    const sr = 0.16 + t.R * 0.008;
    parts.add(`${t.name}:stack`, lathe([[0, -0.4], [sr, -0.4], [sr, sh * 0.45], [sr * 2.0, sh * 0.5], [sr * 2.0, sh * 0.68], [sr, sh * 0.72], [sr, sh], [sr * 1.35, sh + 0.05], [sr * 1.35, sh + 0.3], [0, sh + 0.3]], 20, basisAlong([sx, sy, sz], Y), [FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.bronze, FIELD_SLOT.bronze, FIELD_SLOT.bronze, FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.chrome, FIELD_SLOT.chrome], 34));
    vents.push({ p: [sx, sy + sh + 0.3, sz], size: t.R / 17 });
    // Outlet nozzle at the bottom.
    const bot: Vec3 = [t.x, FIELD_Y + t.eq - t.R, t.z];
    const nr = 0.22 + t.R * 0.012;
    parts.add(`${t.name}:nozzle`, lathe([[0, 0.3], [nr, 0.3], [nr, -0.25], [nr + 0.12, -0.25], [nr + 0.12, -0.42], [0, -0.42]], 24, basisAlong(bot, Y), FIELD_SLOT.steel));
    // Crown platform, ladders (the four largest tanks).
    if (ti < 4) {
      const pr0 = mr + 0.9;
      const pr1 = pr0 + 1.6;
      const ringY = top[1] - t.R * (1 - Math.cos(Math.asin(Math.min(0.95, pr1 / t.R)))) + 0.55;
      const segs = 40;
      const outline: Vec2[] = Array.from({ length: segs }, (_, k) => [t.x + Math.cos((2 * Math.PI * k) / segs) * pr1, t.z + Math.sin((2 * Math.PI * k) / segs) * pr1] as Vec2);
      // An annular deck: the outline as a ring with an inner hole is two lathes; use a lathe ring.
      parts.add(`${t.name}:crown`, lathe([[pr0, ringY - 0.14], [pr1, ringY - 0.14], [pr1, ringY], [pr0, ringY]], segs, { o: [t.x, 0, t.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, [FIELD_SLOT.steel, FIELD_SLOT.steel, FIELD_SLOT.grating, FIELD_SLOT.steel]));
      parts.addSet(`${t.name}:crownrail`, guardRail(outline.map(([x, z]) => [x, ringY, z] as Vec3), true));
      // Crown deck posts down to the shell (the deck stands on short legs).
      for (let k = 0; k < 8; k++) {
        const a = (2 * Math.PI * (k + 0.5)) / 8;
        const pr = (pr0 + pr1) / 2;
        const px = t.x + Math.cos(a) * pr;
        const pz = t.z + Math.sin(a) * pr;
        const shellY = FIELD_Y + t.eq + Math.sqrt(t.R * t.R - pr * pr);
        parts.add(`${t.name}:crownleg${k}`, rod([px, shellY - 0.08, pz], [px, ringY - 0.1, pz], 0.06, FIELD_SLOT.steel, 8));
      }
      // Ladder up between two columns to the equator (tied to them), then curving up the shell to the crown.
      parts.addSet(`${t.name}:ladder`, curvedLadder(t, phase + Math.PI / t.legs, ringY - FIELD_Y));
    }
  });
  // Outlets: each tank drops a riser from its bottom nozzle; its run goes to the nearest larger
  // tank's riser and tees into it, each child of a riser at its own level, on sleepers.
  const riserR = (t: Tank) => 0.24 + t.R * 0.02;
  const runR = (t: Tank) => 0.15 + t.R * 0.012;
  tanks.forEach((t, i) => {
    const bottom = FIELD_Y + t.eq - t.R - 0.38;
    const low = Math.min(level[i], ...tanks.map((_, k) => (parent[k] === i ? level[k] : Infinity))) - runR(t) - 0.35;
    parts.add(`riser:${t.name}`, pipeRun([[t.x, bottom, t.z], [t.x, Math.max(FIELD_Y + 0.5, low), t.z]], { r: riserR(t), bareEnds: true }));
    // The riser's foot: a ceramic pier block it stands on.
    const footTop = Math.max(FIELD_Y + 0.5, low);
    parts.add(`foot:${t.name}`, box({ o: [t.x, (FIELD_Y - 0.02 + footTop + 0.04) / 2, t.z], u: [1, 0, 0], v: [0, 0, 1], w: Y }, riserR(t) + 0.3, riserR(t) + 0.3, (footTop + 0.06 - FIELD_Y) / 2, 0.04, FIELD_SLOT.ceramic));
    if (i === 0) return;
    const b = tanks[parent[i]];
    const r = runR(t);
    const y = level[i];
    parts.add(`run:${t.name}`, pipeRun([[t.x, y, t.z], [b.x, y, b.z]], { r, bareEnds: true }));
    // Sleepers: ceramic blocks under the run every ~7 m between the tanks' columns.
    const h0: Vec3 = [t.x, 0, t.z];
    const h1: Vec3 = [b.x, 0, b.z];
    const len = v3.dist(h0, h1);
    const dir = v3.norm(v3.sub(h1, h0));
    const span = len - t.colR - b.colR - 3;
    const n = Math.floor(span / 7);
    for (let k = 1; k <= n; k++) {
      const s = t.colR + 1.5 + (span * k) / (n + 1);
      const p = v3.add(h0, v3.scale(dir, s));
      // A run passing another tank's column gets no sleeper there.
      if (columns.some((c) => Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) < c.r + r + 1.2)) continue;
      const lo = FIELD_Y - 0.02;
      const hi = y - r + 0.03;
      parts.add(`sleeper:${t.name}:${k}`, box({ o: [p[0], (lo + hi) / 2, p[2]], u: dir, v: v3.cross(Y, dir), w: Y }, 0.3, r + 0.22, (hi - lo) / 2, 0.03, FIELD_SLOT.ceramic));
    }
  });
  return { parts, tanks, vents };
}

/** A caged ladder up the outside of a column bay to the equator, continuing up the shell to the crown. */
function curvedLadder(t: Tank, a: number, crownY: number): PolyMesh {
  const eqY = t.eq;
  const m = new PolyMesh(40);
  const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const stand = 0.45;
  // Centreline: vertical from the ground at the equator's plan radius + standoff, then along the
  // shell's meridian (offset by the standoff) to the crown platform's edge.
  const rEq = t.R + stand;
  const pts: Vec3[] = [];
  for (let y = 0; y < eqY; y += 1.5) pts.push([t.x + out[0] * rEq, FIELD_Y + y, t.z + out[2] * rEq]);
  const latTop = Math.asin(Math.min(0.999, (crownY - t.eq) / rEq));
  const steps = Math.max(8, Math.ceil(((latTop * rEq) / 1.0)));
  for (let k = 0; k <= steps; k++) {
    const lat = (latTop * k) / steps;
    const rr = Math.cos(lat) * rEq;
    pts.push([t.x + out[0] * rr, FIELD_Y + t.eq + Math.sin(lat) * rEq, t.z + out[2] * rr]);
  }
  const hw = 0.23;
  for (const s of [-1, 1]) m.append(tube(pts.map((p) => ({ p: v3.add(p, v3.scale(side, s * hw)), r: 0.03 })), 6, FIELD_SLOT.steel));
  // Rungs every 0.3 m of path.
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = v3.dist(pts[i], pts[i - 1]);
    for (let s = 0.3 - acc; s < seg; s += 0.3) {
      const p = v3.lerp(pts[i - 1], pts[i], s / seg);
      m.append(rod(v3.add(p, v3.scale(side, -hw + 0.02)), v3.add(p, v3.scale(side, hw - 0.02)), 0.014, FIELD_SLOT.steel, 6));
    }
    acc = (acc + seg) % 0.3;
  }
  // Brackets back to the shell every ~2.5 m along the curved part, and to a column below.
  for (let i = 0; i < pts.length; i += 3) {
    const p = pts[i];
    const back = p[1] - FIELD_Y >= t.eq ? v3.norm(v3.sub([t.x, FIELD_Y + t.eq, t.z], p)) : ([-out[0], 0, -out[2]] as Vec3);
    const reach = p[1] - FIELD_Y >= t.eq ? stand + 0.06 : stand - 0.2;
    if (p[1] - FIELD_Y < t.eq - t.R * 0.1) continue;
    for (const s of [-1, 1]) m.append(rod(v3.add(p, v3.scale(side, s * hw)), v3.add(v3.add(p, v3.scale(side, s * hw)), v3.scale(back, reach)), 0.025, FIELD_SLOT.steel, 6));
  }
  // Below the equator the shell curves away: the ladder is tied back to the columns either side.
  for (let y = 3; y < eqY - 1.5; y += 4) {
    for (const s of [-1, 1]) {
      const ca = a + (s * Math.PI) / t.legs;
      const col: Vec3 = [t.x + Math.cos(ca) * t.colR, FIELD_Y + y, t.z + Math.sin(ca) * t.colR];
      const stile = v3.add([t.x + out[0] * rEq, FIELD_Y + y, t.z + out[2] * rEq], v3.scale(side, s * hw));
      m.append(rod(stile, col, 0.03, FIELD_SLOT.steel, 6));
    }
  }
  return m;
}

/** Do two plan segments properly cross? */
function crosses(a: [[number, number], [number, number]], b: [[number, number], [number, number]]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a[0], a[1], b[0]) * o(a[0], a[1], b[1]) < 0 && o(b[0], b[1], a[0]) * o(b[0], b[1], a[1]) < 0;
}
