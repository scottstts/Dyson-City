/**
 * What is underfoot in the house, for footsteps (docs/audio.md "The house"): the up-facing faces of
 * the floor materials (oak, parquet and pine boards; encaustic tiles and flags; rugs, runners and
 * mats; the porches' boards) rasterised into a plan grid in the house's frame, every surface a cell
 * holds kept with its height, so a rug over boards and the floors of three storeys share one cell.
 *
 * Rasterised in the house worker as each part compiles (compile.ts); the main thread only looks up.
 */
import type { GroundSurface } from '../city/walk';
import type { DrawGroup } from './compile';

/** Plan cell size (m). */
const CELL = 0.1;
/** Cell keys pack (ix, iz) offset by this. */
const BIAS = 2048;
/** Faces this close to horizontal are walked on (cos of the slope). */
const FLAT = 0.85;

/** Surfaces by material (glTF names without Blender's `__gltf` suffix). */
export function floorSurface(material: string): GroundSurface | null {
  const m = material.replace(/__gltf$/, '');
  if (/^(floor_(oak|parquet|pine)|oak_(tread|threshold))$/.test(m)) return 'wood';
  if (/^(rug_|stair_runner|coir)/.test(m)) return 'rug';
  if (/^(floor_(encaustic|flag)|marble_hearth|tile_|sandstone|brick)/.test(m)) return 'stone';
  if (/^porch_floor/.test(m)) return 'boards';
  return null;
}

/** The surfaces a part's floors add: per entry a cell key, the surface's height and its kind. */
export interface FloorCells {
  keys: Int32Array;
  heights: Float32Array;
  surfaces: Uint8Array;
}

/** Surface kinds by index in FloorCells. */
export const FLOOR_KINDS: readonly GroundSurface[] = ['wood', 'rug', 'stone', 'boards'];

const key = (ix: number, iz: number) => (ix + BIAS) * 4096 + (iz + BIAS);

/** Rasterises a part's floor faces (house frame, glTF axes: +Y up). */
export function rasteriseFloors(groups: readonly DrawGroup[], materialName: (index: number) => string): FloorCells {
  const cells = new Map<number, number[]>();
  for (const g of groups) {
    const s = floorSurface(materialName(g.material));
    if (!s) continue;
    const kind = FLOOR_KINDS.indexOf(s);
    const P = g.position;
    const I = g.index;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const bx = P[b], by = P[b + 1], bz = P[b + 2];
      const cx = P[c], cy = P[c + 1], cz = P[c + 2];
      // Face normal's y over its length: up-facing floors only.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9 || ny / len < FLAT) continue;
      // Plan barycentrics (x, z), and the cells whose centres fall inside.
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue;
      const ix0 = Math.floor(Math.min(ax, bx, cx) / CELL), ix1 = Math.floor(Math.max(ax, bx, cx) / CELL);
      const iz0 = Math.floor(Math.min(az, bz, cz) / CELL), iz1 = Math.floor(Math.max(az, bz, cz) / CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (ix + 0.5) * CELL;
        for (let iz = iz0; iz <= iz1; iz++) {
          const z = (iz + 0.5) * CELL;
          const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
          const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const y = l0 * ay + l1 * by + l2 * cy;
          const k = key(ix, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          let dup = false;
          for (let e = 0; e < list.length; e += 2) if (list[e + 1] === kind && Math.abs(list[e] - y) < 0.03) dup = true;
          if (!dup) list.push(y, kind);
        }
      }
    }
  }
  let n = 0;
  for (const list of cells.values()) n += list.length / 2;
  const out: FloorCells = { keys: new Int32Array(n), heights: new Float32Array(n), surfaces: new Uint8Array(n) };
  let o = 0;
  for (const [k, list] of cells)
    for (let e = 0; e < list.length; e += 2) {
      out.keys[o] = k;
      out.heights[o] = list[e];
      out.surfaces[o++] = list[e + 1];
    }
  return out;
}

/** The house's floors as parts arrive; looked up per footstep. */
export class HouseFloors {
  private readonly cells = new Map<number, number[]>();

  add(f: FloorCells): void {
    for (let i = 0; i < f.keys.length; i++) {
      let list = this.cells.get(f.keys[i]);
      if (!list) this.cells.set(f.keys[i], (list = []));
      list.push(f.heights[i], f.surfaces[i]);
    }
  }

  /**
   * The surface under feet at (x, y, z) in the house frame: the highest floor at most 0.3 m above
   * the feet (a stair's ramp runs along the nosings, over the treads) and at most 0.6 m below.
   */
  at(x: number, y: number, z: number): GroundSurface | null {
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = -Infinity;
    let kind = -1;
    for (let e = 0; e < list.length; e += 2) {
      const h = list[e];
      if (h <= y + 0.3 && h >= y - 0.6 && h > best) {
        best = h;
        kind = list[e + 1];
      }
    }
    return kind < 0 ? null : FLOOR_KINDS[kind];
  }
}
