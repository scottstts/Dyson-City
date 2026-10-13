/**
 * Tileable 3D noise volumes, generated once at boot (in a worker) so shaders pay one filtered
 * texture fetch per octave instead of eight lattice hashes.
 *
 *  - value: 64³ RGBA8 (1 MB, cache-friendly), four independent smooth value-noise fields with a
 *    16-cell period (4 texels per lattice cell, so trilinear filtering reconstructs them smoothly).
 *  - cellular: 128³ RGBA8, Worley F1 / F2 / cell id with a 16-cell period (8 texels per cell).
 */

export const VALUE_SIZE = 64;
export const VALUE_PERIOD = 16;
export const CELL_SIZE = 128;
export const CELL_PERIOD = 16;

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const wrap = (i: number, p: number): number => ((i % p) + p) % p;

export function generateValueVolume(): Uint8Array {
  const N = VALUE_SIZE;
  const P = VALUE_PERIOD;
  const out = new Uint8Array(N * N * N * 4);
  const scale = P / N;
  for (let c = 0; c < 4; c++) {
    // Lattice values for this channel.
    const lattice = new Float32Array(P * P * P);
    for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) lattice[(z * P + y) * P + x] = hash3(x, y, z, 11 + c * 97);
    for (let z = 0; z < N; z++) {
      const fz = z * scale;
      const iz = Math.floor(fz);
      const tz = smooth(fz - iz);
      const z0 = wrap(iz, P);
      const z1 = wrap(iz + 1, P);
      for (let y = 0; y < N; y++) {
        const fy = y * scale;
        const iy = Math.floor(fy);
        const ty = smooth(fy - iy);
        const y0 = wrap(iy, P);
        const y1 = wrap(iy + 1, P);
        for (let x = 0; x < N; x++) {
          const fx = x * scale;
          const ix = Math.floor(fx);
          const tx = smooth(fx - ix);
          const x0 = wrap(ix, P);
          const x1 = wrap(ix + 1, P);
          const v = (a: number, b: number, cc: number) => lattice[(cc * P + b) * P + a];
          const c00 = v(x0, y0, z0) * (1 - tx) + v(x1, y0, z0) * tx;
          const c10 = v(x0, y1, z0) * (1 - tx) + v(x1, y1, z0) * tx;
          const c01 = v(x0, y0, z1) * (1 - tx) + v(x1, y0, z1) * tx;
          const c11 = v(x0, y1, z1) * (1 - tx) + v(x1, y1, z1) * tx;
          const val = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
          out[((z * N + y) * N + x) * 4 + c] = Math.round(val * 255);
        }
      }
    }
  }
  return out;
}

export function generateCellularVolume(): Uint8Array {
  const N = CELL_SIZE;
  const P = CELL_PERIOD;
  const out = new Uint8Array(N * N * N * 4);
  // Feature point per lattice cell (periodic).
  const fx = new Float32Array(P * P * P);
  const fy = new Float32Array(P * P * P);
  const fz = new Float32Array(P * P * P);
  const id = new Float32Array(P * P * P);
  for (let z = 0; z < P; z++) {
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const k = (z * P + y) * P + x;
        fx[k] = 0.05 + 0.9 * hash3(x, y, z, 401);
        fy[k] = 0.05 + 0.9 * hash3(x, y, z, 402);
        fz[k] = 0.05 + 0.9 * hash3(x, y, z, 403);
        id[k] = hash3(x, y, z, 404);
      }
    }
  }
  const scale = P / N;
  for (let z = 0; z < N; z++) {
    const pz = (z + 0.5) * scale;
    const cz = Math.floor(pz);
    for (let y = 0; y < N; y++) {
      const py = (y + 0.5) * scale;
      const cy = Math.floor(py);
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) * scale;
        const cx = Math.floor(px);
        let f1 = 9;
        let f2 = 9;
        let best = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const k = (wrap(cz + dz, P) * P + wrap(cy + dy, P)) * P + wrap(cx + dx, P);
              const ddx = cx + dx + fx[k] - px;
              const ddy = cy + dy + fy[k] - py;
              const ddz = cz + dz + fz[k] - pz;
              const d = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d < f1) {
                f2 = f1;
                f1 = d;
                best = id[k];
              } else if (d < f2) {
                f2 = d;
              }
            }
          }
        }
        const o = ((z * N + y) * N + x) * 4;
        out[o] = Math.round(Math.min(1, Math.sqrt(f1)) * 255);
        out[o + 1] = Math.round(Math.min(1, Math.sqrt(f2) / 1.5) * 255);
        out[o + 2] = Math.round(best * 255);
        out[o + 3] = 255;
      }
    }
  }
  return out;
}
