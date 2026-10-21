/**
 * The estate's three Hands (docs/crew.md, "The estate"). They keep the garden and never leave the
 * terrace (nor go into the house).
 *
 *  - The mower walks the front lawn's mown stripes (estate/grass.ts) behind its cylinder mower,
 *    each pass along its stripe's lie, turning at the ends onto the next.
 *  - The hedger walks the yew hedges with its long-reach trimmer, its blade along the hedge's face.
 *  - The gardener tends the kitchen garden's beds from their brick paths, crouched at the soil,
 *    and walks the orchard looking up into the apples.
 *
 * Their ground is a 0.25 m grid of the terrace: free where the ground is lawn, meadow, gravel,
 * flags or brick and nothing stands at body height (the estate's walls, hedges, trunks and bed
 * fences, from its walk mesh), and clear of the big trees' low crowns.
 */
import { classGrid } from '../../estate/regions';
import { GROUND_ORDER, groundLevel, HOUSE_F, KITCHEN, ORCHARD, ESTATE_BOUNDS, type GroundClass } from '../../estate/layout';
import { TERRACE_Y } from '../../estate/levels';
import { hedgeSpecs } from '../../estate/hedges';
import { treePlan } from '../../estate/plants/planting';
import { LAWN_STRIPE } from '../../estate/materials/ground';
import type { WalkMesh } from '../../player/walkMesh';
import { clearanceAt, findPath, lineClear, nearestFree, navGrid, type NavGrid, type P2 } from '../nav';
import type { Vec3 } from '../../geometry/polyMesh';

const WALKABLE = new Set<GroundClass>(['lawn', 'meadow', 'gravel', 'flag', 'brick']);
const CELL = 0.25;
/** How far round each tree's trunk its crown hangs low enough to keep a Hand out (m). */
const CROWN: Record<string, number> = { cedar: 9.5, copperBeech: 7.5, oak: 7, lime: 3.6, apple: 1.9 };

export function estateNav(walk: WalkMesh): NavGrid {
  const [x0, z0, x1, z1] = [ESTATE_BOUNDS[0], ESTATE_BOUNDS[1], ESTATE_BOUNDS[2], ESTATE_BOUNDS[3]];
  const nx = Math.ceil((x1 - x0) / CELL);
  const nz = Math.ceil((z1 - z0) / CELL);
  const occ = new Uint8Array(nx * nz);
  // The walk mesh's walls in the body's band over the terrace.
  const T = walk.wallTriangles;
  const y0 = TERRACE_Y + 0.05;
  const y1 = TERRACE_Y + 1.9;
  for (let t = 0; t < T.length; t += 9) {
    const lo = Math.min(T[t + 1], T[t + 4], T[t + 7]);
    const hi = Math.max(T[t + 1], T[t + 4], T[t + 7]);
    if (hi < y0 || lo > y1) continue;
    // Sample the triangle on a lattice finer than a cell.
    const ax = T[t], az = T[t + 2], bx = T[t + 3], bz = T[t + 5], cx = T[t + 6], cz = T[t + 8];
    const span = Math.max(Math.abs(bx - ax), Math.abs(bz - az), Math.abs(cx - ax), Math.abs(cz - az), Math.abs(cx - bx), Math.abs(cz - bz));
    // A triangle within a cell or two marks its corners' cells (most of the hedges' many small ones).
    if (span < CELL * 1.5) {
      for (const [px, pz] of [[ax, az], [bx, bz], [cx, cz]]) {
        const i = Math.floor((px - x0) / CELL);
        const j = Math.floor((pz - z0) / CELL);
        if (i >= 0 && j >= 0 && i < nx && j < nz) occ[j * nx + i] = 1;
      }
      continue;
    }
    const steps = Math.min(200, Math.ceil(span / CELL) + 1);
    for (let a = 0; a <= steps; a++) {
      for (let b = 0; a + b <= steps; b++) {
        const u = a / steps;
        const w = b / steps;
        const c = 1 - u - w;
        const y = T[t + 1] * c + T[t + 4] * u + T[t + 7] * w;
        if (y < y0 || y > y1) continue;
        const i = Math.floor((ax * c + bx * u + cx * w - x0) / CELL);
        const j = Math.floor((az * c + bz * u + cz * w - z0) / CELL);
        if (i >= 0 && j >= 0 && i < nx && j < nz) occ[j * nx + i] = 1;
      }
    }
  }
  // Out: anything but walkable ground (the classes exist only on the terrace), and the trees' crowns.
  const g = classGrid();
  const mask = new Uint8Array(nx * nz);
  const walkable = GROUND_ORDER.map((c) => WALKABLE.has(c));
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = Math.round((x0 + (i + 0.5) * CELL - g.x0) / g.step);
      const gj = Math.round((z0 + (j + 0.5) * CELL - g.z0) / g.step);
      const c = gi < 0 || gj < 0 || gi >= g.nx || gj >= g.nz ? 255 : g.cls[gj * g.nx + gi];
      if (c === 255 || !walkable[c]) mask[j * nx + i] = 1;
    }
  }
  for (const tr of treePlan()) {
    const r = CROWN[tr.species];
    for (let j = Math.floor((tr.z - r - z0) / CELL); j <= Math.floor((tr.z + r - z0) / CELL); j++) {
      for (let i = Math.floor((tr.x - r - x0) / CELL); i <= Math.floor((tr.x + r - x0) / CELL); i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (Math.hypot(x0 + (i + 0.5) * CELL - tr.x, z0 + (j + 0.5) * CELL - tr.z) < r) mask[j * nx + i] = 1;
      }
    }
  }
  return navGrid(occ, x0, z0, CELL, nx, nz, mask);
}

/** The estate's ground height at a plan point (its class's level on the terrace). */
export function estateGround(): (x: number, z: number) => number {
  const g = classGrid();
  return (x, z) => {
    const i = Math.round((x - g.x0) / g.step);
    const j = Math.round((z - g.z0) / g.step);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return TERRACE_Y;
    const c = g.cls[j * g.nx + i];
    return c === 255 ? TERRACE_Y : groundLevel(GROUND_ORDER[c], x, z);
  };
}

export interface MowPass {
  a: P2;
  b: P2;
}

export interface EstatePlan {
  /** The mower's passes, in order (each along its stripe's lie), and the turns between them. */
  mow: { passes: MowPass[]; turns: P2[][] };
  /** The hedger's runs along hedge faces: where it walks and the face point it trims toward. */
  hedge: { walk: P2[]; face: P2[]; top: number }[];
  /** The gardener's posts: where it stands, faces, and whether it crouches. */
  garden: { x: number; z: number; face: number; look: Vec3; crouch: boolean; dwell: [number, number] }[];
  gardenLegs: P2[][];
}

const F: P2 = [HOUSE_F[0], HOUSE_F[1]];
const across = (x: number, z: number) => x * -F[1] + z * F[0];

export function estatePlan(nav: NavGrid): EstatePlan {
  // The mower: stripes over the front lawn, before the porch.
  const c0: P2 = [-342, -95];
  const passes: MowPass[] = [];
  const turns: P2[][] = [];
  const mowClear = 1.0;
  const k0 = Math.floor(across(c0[0], c0[1]) / LAWN_STRIPE);
  const stripes: MowPass[] = [];
  for (let k = k0 - 6; k <= k0 + 6; k++) {
    // The stripe's centre line, through c0's along-coordinate, and its lie (blades lean ±F).
    const ac = (k + 0.5) * LAWN_STRIPE;
    const along0 = c0[0] * F[0] + c0[1] * F[1];
    const pt = (t: number): P2 => [F[0] * (along0 + t) + -F[1] * ac, F[1] * (along0 + t) + F[0] * ac];
    // The longest clear run along it within 22 m either side.
    let best: [number, number] | null = null;
    let start: number | null = null;
    for (let t = -22; t <= 22.01; t += 0.5) {
      const p = pt(t);
      const ok = clearanceAt(nav, p[0], p[1]) >= mowClear;
      if (ok && start === null) start = t;
      if ((!ok || t > 22) && start !== null) {
        const end = ok ? t : t - 0.5;
        if (!best || end - start > best[1] - best[0]) best = [start, end];
        start = null;
      }
    }
    if (!best || best[1] - best[0] < 10) continue;
    // Its lie: alternate stripes lean +F and −F (the grass's parity); mow along it.
    const parity = Math.floor(ac / LAWN_STRIPE) % 2 === 0 ? 1 : -1;
    const a = pt(parity > 0 ? best[0] + 1.5 : best[1] - 1.5);
    const b = pt(parity > 0 ? best[1] - 1.5 : best[0] + 1.5);
    stripes.push({ a, b });
  }
  // Consecutive stripes, each pass's end turning onto the next's start (a path round on the lawn).
  for (let i = 0; i < stripes.length; i++) {
    passes.push(stripes[i]);
    if (i + 1 < stripes.length) {
      const t = findPath(nav, stripes[i].b, stripes[i + 1].a, mowClear, [ESTATE_BOUNDS[0], ESTATE_BOUNDS[2], ESTATE_BOUNDS[1], ESTATE_BOUNDS[3]]);
      turns.push(t ?? [stripes[i].b, stripes[i + 1].a]);
    }
  }
  // The hedger: the yew hedges' faces, on the walkable side, 0.95 m out from the face.
  const hedge: EstatePlan['hedge'] = [];
  for (const h of hedgeSpecs()) {
    if (h.kind !== 'yew') continue;
    for (const side of [-1, 1]) {
      let run: P2[] = [];
      let face: P2[] = [];
      const flush = () => {
        if (run.length > 1 && Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1]) > 5) hedge.push({ walk: run, face, top: h.y + h.height });
        run = [];
        face = [];
      };
      for (let i = 0; i < h.path.length; i++) {
        const a = h.path[Math.max(0, i - 1)];
        const b = h.path[Math.min(h.path.length - 1, i + 1)];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n: P2 = [(-(b[1] - a[1]) / d) * side, ((b[0] - a[0]) / d) * side];
        const p = h.path[i];
        const off = h.base / 2 + 0.95;
        const w: P2 = [p[0] + n[0] * off, p[1] + n[1] * off];
        if (clearanceAt(nav, w[0], w[1]) >= 0.45 && (!run.length || lineClear(nav, run[run.length - 1], w, 0.4))) {
          run.push(w);
          face.push([p[0] + n[0] * (h.base / 2), p[1] + n[1] * (h.base / 2)]);
        } else flush();
      }
      flush();
    }
  }
  // The gardener: the kitchen garden's beds from their paths, the orchard's apples.
  const garden: EstatePlan['garden'] = [];
  const k = KITCHEN;
  for (const [x, z] of [[k.x0 + 6, k.z0 + 12], [k.x0 + 14, k.z0 + 20], [k.x1 - 8, k.z0 + 12], [k.x1 - 14, k.z1 - 5]] as P2[]) {
    const f = nearestFree(nav, x, z, 0.45, 3);
    if (!f) continue;
    // Facing the nearest bed (soil): toward the cell it can see within 1.6 m that is not walkable.
    let face = 0;
    let bd = Infinity;
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      for (let r = 0.5; r < 1.8; r += 0.25) {
        const px = f[0] + Math.sin(th) * r;
        const pz = f[1] + Math.cos(th) * r;
        if (clearanceAt(nav, px, pz) <= 0.01) {
          if (r < bd) {
            bd = r;
            face = th;
          }
          break;
        }
      }
    }
    garden.push({ x: f[0], z: f[1], face, look: [f[0] + Math.sin(face) * 0.9, TERRACE_Y + 0.15, f[1] + Math.cos(face) * 0.9], crouch: true, dwell: [16, 28] });
  }
  for (const tr of treePlan().filter((t) => t.species === 'apple').slice(1, 6).filter((_, i) => i % 2 === 0)) {
    const f = nearestFree(nav, tr.x, tr.z + (tr.z < (ORCHARD.z0 + ORCHARD.z1) / 2 ? 2.6 : -2.6), 0.45, 3);
    if (!f) continue;
    garden.push({ x: f[0], z: f[1], face: Math.atan2(tr.x - f[0], tr.z - f[1]), look: [tr.x, TERRACE_Y + 2.6, tr.z], crouch: false, dwell: [10, 18] });
  }
  const legs: P2[][] = [];
  for (let i = 0; i < garden.length; i++) {
    const a = garden[i];
    const b = garden[(i + 1) % garden.length];
    legs.push(findPath(nav, [a.x, a.z], [b.x, b.z], 0.45, [ESTATE_BOUNDS[0], ESTATE_BOUNDS[2], ESTATE_BOUNDS[1], ESTATE_BOUNDS[3]]) ?? [[a.x, a.z], [b.x, b.z]]);
  }
  return { mow: { passes, turns }, hedge, garden, gardenLegs: legs };
}
