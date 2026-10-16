/**
 * The house's baked SH probe grid (blender/docs/house.md §6): SH L2 radiance at 1 m lattice points
 * inside rooms, three heights per floor, in Blender's house frame (Z up). Diffuse light for
 * everything without a lightmap is looked up here: trilinear between the lattice points that are
 * valid, on the same floor and in the same room as the shaded point (partition walls are thinner
 * than the 1 m spacing, so a neighbouring room's probe must never bleed through), renormalised.
 *
 * Pure: the part worker uses it per vertex, the house uses it per door leaf.
 */

/** A room's reflection-capture box (house frame, Blender axes): the room it bounds and its floor. */
export interface RoomBox {
  name: string;
  level: number;
  /** x0, y0, z0, x1, y1, z1. */
  box: [number, number, number, number, number, number];
  /** Capture point. */
  position: [number, number, number];
}

export interface ProbeData {
  /** count × 9 × RGB, float32 radiance on the real SH basis (three's SphericalHarmonics3 order). */
  coefficients: Float32Array;
  /** x, y, z (Blender house frame), level, valid. */
  points: [number, number, number, number, number][];
  rooms: string[];
  boxes: RoomBox[];
}

/** Floors' finished levels (house frame, m) and the probe heights above each. */
export const FLOORS = [1.05, 5.25, 9.15] as const;
const LAYERS = [0.5, 1.4, 2.4] as const;
const X0 = -12.5;
const Y0 = -2.5;

export class ProbeGrid {
  private readonly data: ProbeData;
  private readonly nx: number;
  private readonly ny: number;
  /** Lattice (ix, iy, layer) → probe index or −1. */
  private readonly cells: Int32Array;
  private readonly roomId: Int32Array;
  private readonly roomNames: string[];
  private readonly byRoom: number[][];
  private readonly byLevel: number[][];

  constructor(data: ProbeData) {
    this.data = data;
    let maxX = 0;
    let maxY = 0;
    for (const p of data.points) {
      maxX = Math.max(maxX, Math.round(p[0] - X0));
      maxY = Math.max(maxY, Math.round(p[1] - Y0));
    }
    this.nx = maxX + 1;
    this.ny = maxY + 1;
    this.cells = new Int32Array(this.nx * this.ny * 9).fill(-1);
    this.roomNames = [...new Set([...data.rooms, ...data.boxes.map((b) => b.name)])];
    const id = new Map(this.roomNames.map((n, i) => [n, i]));
    this.roomId = Int32Array.from(data.rooms.map((r) => id.get(r)!));
    this.byRoom = this.roomNames.map(() => []);
    this.byLevel = [[], [], []];
    data.points.forEach((p, i) => {
      const level = p[3];
      const layer = nearestLayer(p[2] - FLOORS[level]);
      const ix = Math.round(p[0] - X0);
      const iy = Math.round(p[1] - Y0);
      this.cells[(level * 3 + layer) * this.nx * this.ny + iy * this.nx + ix] = i;
      if (p[4]) {
        this.byRoom[this.roomId[i]].push(i);
        this.byLevel[level].push(i);
      }
    });
  }

  /** The room a point (Blender house frame) lies in, or the nearest room box; −1 if none. */
  roomAt(x: number, y: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    const boxes = this.data.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i].box;
      const d = Math.max(b[0] - x, x - b[3], b[1] - y, y - b[4], b[2] - z, z - b[5]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? -1 : this.roomNames.indexOf(boxes[best].name);
  }

  /** Capture point of the room box nearest a point (Blender frame). */
  nearestCapture(x: number, y: number, z: number): [number, number, number] {
    let best = this.data.boxes[0];
    let bestD = Infinity;
    for (const r of this.data.boxes) {
      const b = r.box;
      const d = Math.max(b[0] - x, x - b[3], b[1] - y, y - b[4], b[2] - z, z - b[5]);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best.position;
  }

  get rooms(): readonly string[] {
    return this.roomNames;
  }

  /**
   * Interpolated SH coefficients (27 floats) at a point in the given room (Blender frame). With
   * `room` −1 any valid probe of the point's floor contributes.
   */
  shAt(x: number, y: number, z: number, room: number, out = new Float32Array(27)): Float32Array {
    out.fill(0);
    const level = room >= 0 ? this.levelOfRoom(room) : levelAt(z);
    const fz = z - FLOORS[level];
    // Layer coordinate (0..2) between the three heights, clamped.
    let lz: number;
    if (fz <= LAYERS[0]) lz = 0;
    else if (fz >= LAYERS[2]) lz = 2;
    else if (fz < LAYERS[1]) lz = (fz - LAYERS[0]) / (LAYERS[1] - LAYERS[0]);
    else lz = 1 + (fz - LAYERS[1]) / (LAYERS[2] - LAYERS[1]);
    const gx = x - X0;
    const gy = y - Y0;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.min(Math.floor(lz), 1);
    const tx = gx - ix;
    const ty = gy - iy;
    const tz = lz - iz;
    let wsum = 0;
    const c = this.data.coefficients;
    for (let k = 0; k < 8; k++) {
      const cx = ix + (k & 1);
      const cy = iy + ((k >> 1) & 1);
      const cz = iz + ((k >> 2) & 1);
      if (cx < 0 || cy < 0 || cx >= this.nx || cy >= this.ny) continue;
      const p = this.cells[(level * 3 + cz) * this.nx * this.ny + cy * this.nx + cx];
      if (p < 0 || !this.data.points[p][4]) continue;
      if (room >= 0 && this.roomId[p] !== room) continue;
      const w = (k & 1 ? tx : 1 - tx) * ((k >> 1) & 1 ? ty : 1 - ty) * ((k >> 2) & 1 ? tz : 1 - tz);
      if (w <= 0) continue;
      wsum += w;
      for (let j = 0; j < 27; j++) out[j] += c[p * 27 + j] * w;
    }
    if (wsum > 1e-4) {
      for (let j = 0; j < 27; j++) out[j] /= wsum;
      return out;
    }
    // Outside the room's lattice (a point near a wall, a bay, a doorway): its nearest valid probe.
    const pool = room >= 0 && this.byRoom[room].length ? this.byRoom[room] : this.byLevel[level];
    let best = -1;
    let bestD = Infinity;
    for (const p of pool) {
      const q = this.data.points[p];
      const d = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best >= 0) for (let j = 0; j < 27; j++) out[j] = c[best * 27 + j];
    return out;
  }

  private levelOfRoom(room: number): number {
    const name = this.roomNames[room];
    const b = this.data.boxes.find((x) => x.name === name);
    if (b) return b.level;
    const p = this.byRoom[room][0];
    return p !== undefined ? this.data.points[p][3] : 0;
  }
}

function nearestLayer(h: number): number {
  let best = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(LAYERS[i] - h) < Math.abs(LAYERS[best] - h)) best = i;
  return best;
}

export function levelAt(z: number): number {
  return z >= FLOORS[2] - 0.2 ? 2 : z >= FLOORS[1] - 0.2 ? 1 : 0;
}

/**
 * Irradiance from SH L2 radiance coefficients for a unit normal (Blender frame), divided by π: the
 * outgoing radiance of a white Lambertian surface, the lightmaps' unit. Three's
 * SphericalHarmonics3.getIrradianceAt convolution (radiance coefficients, real SH basis).
 */
export function shDiffuse(c: Float32Array, nx: number, ny: number, nz: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const b0 = 0.886227;
  const b1 = 2 * 0.511664;
  const k = 2 * 0.429043;
  const w = [b0, b1 * ny, b1 * nz, b1 * nx, k * nx * ny, k * ny * nz, 0.743125 * nz * nz - 0.247708, k * nx * nz, 0.429043 * (nx * nx - ny * ny)];
  for (let ch = 0; ch < 3; ch++) {
    let e = 0;
    for (let j = 0; j < 9; j++) e += c[j * 3 + ch] * w[j];
    out[ch] = Math.max(e, 0) / Math.PI;
  }
  return out;
}
