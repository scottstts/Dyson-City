/**
 * Walkable triangles in 3D (docs/player.md): where the world has storeys, overhangs and stairs (the
 * house, the estate), the walker is not on a height field. Triangles are split once by slope:
 *
 *  - floors (normal y ≥ FLOOR_NY): what the feet stand on. `height(x, z, yMax)` is the highest floor
 *    over a plan point at or below `yMax` (the feet plus a step), so the floor under the walker is
 *    the one it is on, not the storey above. A sole is not a point: a floor within SOLE (plan) of
 *    the point holds the feet, so a crack between two proxies (the porch deck and its top step left
 *    2 cm) never opens a hole the walker drops through;
 *  - walls (steep): resolved against the body's circle within the body's own height band only.
 *    Each wall triangle is clipped to the band [feet + STEP, feet + head] at query time and the
 *    circle pushed off the clipped polygon's plan outline, so a lintel over a door, a window's sill
 *    wall, a stair's flank or the next storey's walls each block exactly where they stand;
 *  - ceilings (facing down) are ignored.
 *
 * Triangles live in plan cells; a few dynamic triangle sets (door leaves) are tested directly.
 */

const CELL = 1;
/** Slope split: floors face up within ~57° of vertical. */
const FLOOR_NY = 0.55;
/** A floor this close in plan (m) still holds the feet: proxies' cracks are narrower. */
const SOLE = 0.03;

interface Store {
  /** 9 floats per triangle (a, b, c). */
  tri: number[];
  /** Plan bbox and y range per triangle: x0, z0, x1, z1, y0, y1. */
  box: number[];
}

function key(i: number, j: number): number {
  return (i + 32768) * 65536 + (j + 32768);
}

export class WalkMesh {
  private readonly floors: Store = { tri: [], box: [] };
  private readonly walls: Store = { tri: [], box: [] };
  private readonly floorCells = new Map<number, number[]>();
  private readonly wallCells = new Map<number, number[]>();
  private readonly dynamic = new Map<string, Float32Array>();
  private readonly tags = new Map<string, { floors: number[]; walls: number[] }>();
  private readonly disabled = new Set<number>();
  private readonly ownerOfWall: number[] = [];
  private readonly ownerOfFloor: number[] = [];
  private readonly tagIds = new Map<string, number>();

  /**
   * Adds triangles (world space, indexed). A tag lets the set be switched off later (a placeholder
   * replaced by the real geometry).
   */
  add(position: ArrayLike<number>, index: ArrayLike<number>, opts: { floors?: boolean; walls?: boolean; tag?: string } = {}): void {
    const wantFloors = opts.floors ?? true;
    const wantWalls = opts.walls ?? true;
    const tagId = opts.tag ? this.tagId(opts.tag) : -1;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ax = position[a], ay = position[a + 1], az = position[a + 2];
      const bx = position[b], by = position[b + 1], bz = position[b + 2];
      const cx = position[c], cy = position[c + 1], cz = position[c + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      const k = ny / l;
      if (k >= FLOOR_NY) {
        if (wantFloors) this.store(this.floors, this.floorCells, this.ownerOfFloor, tagId, SOLE, ax, ay, az, bx, by, bz, cx, cy, cz);
      } else if (k > -FLOOR_NY) {
        if (wantWalls) this.store(this.walls, this.wallCells, this.ownerOfWall, tagId, 0, ax, ay, az, bx, by, bz, cx, cy, cz);
      }
    }
  }

  private tagId(tag: string): number {
    let id = this.tagIds.get(tag);
    if (id === undefined) {
      id = this.tagIds.size;
      this.tagIds.set(tag, id);
      this.tags.set(tag, { floors: [], walls: [] });
    }
    return id;
  }

  setEnabled(tag: string, enabled: boolean): void {
    const id = this.tagIds.get(tag);
    if (id === undefined) return;
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  /** Stores a triangle in every cell its plan bbox (grown by `pad`) overlaps. */
  private store(s: Store, cells: Map<number, number[]>, owner: number[], tag: number, pad: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const id = s.tri.length / 9;
    s.tri.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
    const z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
    s.box.push(x0, z0, x1, z1, Math.min(ay, by, cy), Math.max(ay, by, cy));
    owner.push(tag);
    const i0 = Math.floor((x0 - pad) / CELL), i1 = Math.floor((x1 + pad) / CELL);
    const j0 = Math.floor((z0 - pad) / CELL), j1 = Math.floor((z1 + pad) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(id);
      }
    }
  }

  /** Replaces a dynamic triangle set (world space, 9 floats per triangle; empty to remove). */
  setDynamic(name: string, tris: Float32Array | null): void {
    if (tris && tris.length) this.dynamic.set(name, tris);
    else this.dynamic.delete(name);
  }

  /** Highest floor over (x, z) at or below yMax; −Infinity if none. */
  height(x: number, z: number, yMax: number): number {
    let best = -Infinity;
    const list = this.floorCells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) {
      const T = this.floors.tri;
      const B = this.floors.box;
      for (const id of list) {
        if (B[id * 6 + 4] > yMax) continue;
        if (x < B[id * 6] - SOLE || x > B[id * 6 + 2] + SOLE || z < B[id * 6 + 1] - SOLE || z > B[id * 6 + 3] + SOLE) continue;
        if (this.disabled.size && this.disabled.has(this.ownerOfFloor[id])) continue;
        const y = triHeight(T, id * 9, x, z, SOLE);
        if (y !== null && y <= yMax && y > best) best = y;
      }
    }
    for (const tris of this.dynamic.values()) {
      for (let o = 0; o < tris.length; o += 9) {
        const ny = triNy(tris, o);
        if (ny < FLOOR_NY) continue;
        const y = triHeight(tris, o, x, z, SOLE);
        if (y !== null && y <= yMax && y > best) best = y;
      }
    }
    return best;
  }

  /**
   * Pushes a circle (plan centre x, z, radius r) out of every wall within the vertical band
   * [y0, y1]. Returns the corrected centre.
   */
  resolve(x: number, z: number, r: number, y0: number, y1: number): [number, number] {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const i0 = Math.floor((px - r) / CELL), i1 = Math.floor((px + r) / CELL);
      const j0 = Math.floor((pz - r) / CELL), j1 = Math.floor((pz + r) / CELL);
      const seen = SEEN;
      seen.clear();
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = this.wallCells.get(key(i, j));
          if (!list) continue;
          for (const id of list) {
            if (seen.has(id)) continue;
            seen.add(id);
            const B = this.walls.box;
            const b = id * 6;
            if (B[b + 5] < y0 || B[b + 4] > y1) continue;
            if (B[b] > px + r || B[b + 2] < px - r || B[b + 1] > pz + r || B[b + 3] < pz - r) continue;
            if (this.disabled.size && this.disabled.has(this.ownerOfWall[id])) continue;
            const out = pushOff(this.walls.tri, id * 9, px, pz, r, y0, y1);
            if (out) {
              px = out[0];
              pz = out[1];
              moved = true;
            }
          }
        }
      }
      for (const tris of this.dynamic.values()) {
        for (let o = 0; o < tris.length; o += 9) {
          const ny = triNy(tris, o);
          if (ny >= FLOOR_NY || ny <= -FLOOR_NY) continue;
          const out = pushOff(tris, o, px, pz, r, y0, y1);
          if (out) {
            px = out[0];
            pz = out[1];
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return [px, pz];
  }

  /** Does a circle overlap any dynamic set named `name` within the band (doors check before moving)? */
  overlapsDynamic(name: string, x: number, z: number, r: number, y0: number, y1: number): boolean {
    const tris = this.dynamic.get(name);
    if (!tris) return false;
    for (let o = 0; o < tris.length; o += 9) if (pushOff(tris, o, x, z, r, y0, y1)) return true;
    return false;
  }

  get counts(): { floors: number; walls: number } {
    return { floors: this.floors.tri.length / 9, walls: this.walls.tri.length / 9 };
  }
}

const SEEN = new Set<number>();

function triNy(T: ArrayLike<number>, o: number): number {
  const ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2];
  const vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l > 0 ? ny / l : 0;
}

/**
 * Height of the triangle's plane over (x, z) if the point lies inside its plan; within `tol` of
 * it, the height at the triangle's nearest point (never extrapolated); else null.
 */
function triHeight(T: ArrayLike<number>, o: number, x: number, z: number, tol = 0): number | null {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
  const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  const w2 = 1 - w0 - w1;
  const e = -1e-6;
  if (w0 >= e && w1 >= e && w2 >= e) return w0 * ay + w1 * by + w2 * cy;
  if (tol <= 0) return null;
  // Nearest point of the plan outline: the closest of the three edges.
  let best = tol * tol;
  let y: number | null = null;
  for (let k = 0; k < 3; k++) {
    const p = o + k * 3;
    const q = o + ((k + 1) % 3) * 3;
    const px = T[p], pz = T[p + 2];
    const ex = T[q] - px, ez = T[q + 2] - pz;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.min(Math.max(((x - px) * ex + (z - pz) * ez) / l2, 0), 1) : 0;
    const d2 = (x - px - ex * t) ** 2 + (z - pz - ez * t) ** 2;
    if (d2 <= best) {
      best = d2;
      y = T[p + 1] + (T[q + 1] - T[p + 1]) * t;
    }
  }
  return y;
}

// Scratch for clipping: up to 5 vertices (x, y, z).
const P = new Float64Array(15);
const Q = new Float64Array(18);

/** Clips the polygon in P (n vertices) to y ≥ lo (sign 1) or y ≤ hi (sign −1); result back in P. */
function clipY(n: number, bound: number, sign: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ya = P[i * 3 + 1], yb = P[j * 3 + 1];
    const ia = (ya - bound) * sign >= 0;
    const ib = (yb - bound) * sign >= 0;
    if (ia) {
      Q[m * 3] = P[i * 3];
      Q[m * 3 + 1] = ya;
      Q[m * 3 + 2] = P[i * 3 + 2];
      m++;
    }
    if (ia !== ib) {
      const t = (bound - ya) / (yb - ya);
      Q[m * 3] = P[i * 3] + (P[j * 3] - P[i * 3]) * t;
      Q[m * 3 + 1] = bound;
      Q[m * 3 + 2] = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * t;
      m++;
    }
  }
  for (let i = 0; i < m * 3; i++) P[i] = Q[i];
  return m;
}

/**
 * The triangle clipped to the band, projected to plan: if the circle overlaps it, the corrected
 * centre (pushed off its nearest edge), else null.
 */
function pushOff(T: ArrayLike<number>, o: number, px: number, pz: number, r: number, y0: number, y1: number): [number, number] | null {
  for (let i = 0; i < 9; i++) P[i] = T[o + i];
  let n = clipY(3, y0, 1);
  if (n < 2) return null;
  n = clipY(n, y1, -1);
  if (n < 2) return null;
  // Nearest point on the plan outline, and whether the centre is inside the outline.
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  let inside = false;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = P[i * 3], az = P[i * 3 + 2];
    const cx = P[j * 3], cz = P[j * 3 + 2];
    area += ax * cz - cx * az;
    if ((az > pz) !== (cz > pz) && px < ((cx - ax) * (pz - az)) / (cz - az) + ax) inside = !inside;
    const ex = cx - ax, ez = cz - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.min(Math.max(((px - ax) * ex + (pz - az) * ez) / len2, 0), 1) : 0;
    const qx = ax + ex * t, qz = az + ez * t;
    const d2 = (px - qx) ** 2 + (pz - qz) ** 2;
    if (d2 < best) {
      best = d2;
      bx = qx;
      bz = qz;
    }
  }
  const d = Math.sqrt(best);
  // A polygon with real plan area (a sloped wall) the centre stands inside: out through the nearest edge.
  if (inside && Math.abs(area) > 1e-4) {
    if (d < 1e-9) return null;
    return [bx + ((bx - px) / d) * r, bz + ((bz - pz) / d) * r];
  }
  if (d >= r || d < 1e-9) return null;
  return [bx + ((px - bx) / d) * r, bz + ((pz - bz) / d) * r];
}
