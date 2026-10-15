/**
 * Where the walker can go in the field (docs/field.md): everything standing within body height
 * (0.05–1.9 m over the platform) is a wall: plinths, legs, columns, podiums, low pipe runs. The
 * field's geometry is sliced at that height into a 0.5 m occupancy grid, and the grid's boundary
 * becomes wall segments (merged along rows and columns). Raised things (the Halo's lines, the
 * viaducts, the gantry) leave the ground open under them.
 *
 * Underfoot: the roads are basalt (for footsteps).
 */
import type { Mesh } from 'three/webgpu';
import type { CollisionWorld } from '../player/collision';
import { FIELD_Y, onRoad } from './layout';

const CELL = 0.5;
const ORIGIN = -512;
const N = 2048;
const SLICE = [0.05, 1.9] as const;

/** Rasterises the meshes' body-height slice into an occupancy grid (row-major, z rows). */
export function occupancy(meshes: readonly Mesh[]): Uint8Array {
  const occ = new Uint8Array(N * N);
  const y0 = FIELD_Y + SLICE[0];
  const y1 = FIELD_Y + SLICE[1];
  const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const mesh of meshes) {
    mesh.updateMatrixWorld();
    const e = mesh.matrixWorld.elements;
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t + k) : t + k;
        const x = pos.getX(v);
        const y = pos.getY(v);
        const z = pos.getZ(v);
        p[k][0] = e[0] * x + e[4] * y + e[8] * z + e[12];
        p[k][1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        p[k][2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        lo = Math.min(lo, p[k][1]);
        hi = Math.max(hi, p[k][1]);
      }
      if (hi < y0 || lo > y1) continue;
      // The triangle's part inside the slice, conservatively: its plan bounding box where it is
      // small; otherwise sample it on a sub-cell lattice and keep the samples inside the slice.
      const ia = (p[0][0] - ORIGIN) / CELL, ib = (p[1][0] - ORIGIN) / CELL, ic = (p[2][0] - ORIGIN) / CELL;
      const ja = (p[0][2] - ORIGIN) / CELL, jb = (p[1][2] - ORIGIN) / CELL, jc = (p[2][2] - ORIGIN) / CELL;
      const i0 = Math.floor(Math.min(ia, ib, ic));
      const i1 = Math.floor(Math.max(ia, ib, ic));
      const j0 = Math.floor(Math.min(ja, jb, jc));
      const j1 = Math.floor(Math.max(ja, jb, jc));
      if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 4) {
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mark(occ, i, j);
        continue;
      }
      const steps = Math.min(400, Math.ceil(Math.max(i1 - i0, j1 - j0) * 2) + 1);
      for (let a = 0; a <= steps; a++) {
        for (let b = 0; a + b <= steps; b++) {
          const u = a / steps;
          const w = b / steps;
          const c = 1 - u - w;
          const y = p[0][1] * c + p[1][1] * u + p[2][1] * w;
          if (y < y0 || y > y1) continue;
          mark(occ, Math.floor(ia * c + ib * u + ic * w), Math.floor(ja * c + jb * u + jc * w));
        }
      }
    }
  }
  return occ;
}

function mark(occ: Uint8Array, i: number, j: number): void {
  if (i >= 0 && j >= 0 && i < N && j < N) occ[j * N + i] = 1;
}

/** Adds the occupancy grid's boundary to the walls (edges merged along rows and columns). */
export function addFieldWalls(walls: CollisionWorld, meshes: readonly Mesh[]): number {
  const occ = occupancy(meshes);
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < N && j < N ? occ[j * N + i] : 0);
  const X = (i: number) => ORIGIN + i * CELL;
  let n = 0;
  // Horizontal edges (between rows j−1 and j), merged along i.
  for (let j = 0; j <= N; j++) {
    let start = -1;
    for (let i = 0; i <= N; i++) {
      const edge = i < N && at(i, j) !== at(i, j - 1);
      if (edge && start < 0) start = i;
      if (!edge && start >= 0) {
        walls.addSegment(X(start), X(j), X(i), X(j));
        n++;
        start = -1;
      }
    }
  }
  // Vertical edges (between columns i−1 and i), merged along j.
  for (let i = 0; i <= N; i++) {
    let start = -1;
    for (let j = 0; j <= N; j++) {
      const edge = j < N && at(i, j) !== at(i - 1, j);
      if (edge && start < 0) start = j;
      if (!edge && start >= 0) {
        walls.addSegment(X(i), X(start), X(i), X(j));
        n++;
        start = -1;
      }
    }
  }
  return n;
}

/** Underfoot in the field: basalt on the roads, or what the site says. */
export function fieldSurface<S extends string>(base: (x: number, z: number) => S, x: number, z: number): S | 'basalt' {
  return onRoad(x, z) ? 'basalt' : base(x, z);
}
