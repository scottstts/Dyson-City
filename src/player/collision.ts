/**
 * Walls for the walker: vertical barriers as 2D segments in plan (x, z), resolved against the
 * player's circle. The walker moves in short sub-steps and is pushed out of every segment it
 * overlaps, so it slides along walls and cannot tunnel through thin ones.
 *
 * Segments live in a uniform grid; dynamic sets (a gate's leaf) are switched by tag. Segments are
 * walls of unbounded height. Where the world has storeys (the house, the estate), its walls are
 * triangles in 3D (walkMesh.ts), resolved within the body's height band.
 */
import type { WalkMesh } from './walkMesh';

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  tag: string | null;
}

const CELL = 8;

export class CollisionWorld {
  private readonly grid = new Map<string, Segment[]>();
  private readonly disabled = new Set<string>();
  private readonly dynamic = new Map<string, Segment[]>();
  /** 3D walls (and floors) of storeyed places. */
  readonly meshes: WalkMesh[] = [];

  addSegment(ax: number, az: number, bx: number, bz: number, tag: string | null = null): void {
    const s: Segment = { ax, az, bx, bz, tag };
    const x0 = Math.floor(Math.min(ax, bx) / CELL);
    const x1 = Math.floor(Math.max(ax, bx) / CELL);
    const z0 = Math.floor(Math.min(az, bz) / CELL);
    const z1 = Math.floor(Math.max(az, bz) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = `${i},${j}`;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(s);
      }
    }
  }

  /** A closed polygon of segments (a solid's footprint). */
  addPolygon(pts: [number, number][], tag: string | null = null): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.addSegment(a[0], a[1], b[0], b[1], tag);
    }
  }

  addBox(x0: number, z0: number, x1: number, z1: number, tag: string | null = null): void {
    this.addPolygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], tag);
  }

  setEnabled(tag: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(tag);
    else this.disabled.add(tag);
  }

  /**
   * Moves a circle of radius r from (x, z) by (dx, dz), sliding along walls. Returns the new
   * position. `band` is the body's height span (3D walls only block within it).
   */
  move(x: number, z: number, dx: number, dz: number, r: number, band: [number, number] = [-Infinity, Infinity]): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.5)));
    let px = x;
    let pz = z;
    for (let s = 0; s < steps; s++) {
      px += dx / steps;
      pz += dz / steps;
      [px, pz] = this.resolve(px, pz, r);
      for (const m of this.meshes) [px, pz] = m.resolve(px, pz, r, band[0], band[1]);
    }
    return [px, pz];
  }

  /**
   * Visits each enabled segment whose grid cells overlap a plan box once (the car's collision:
   * vehicles/car/collision.ts). `seen` is the caller's scratch set, cleared here. With `dynamic`,
   * the moving outlines near the box too (robots: the car meets them; the chase camera does not).
   */
  forEachNear(x0: number, z0: number, x1: number, z1: number, seen: Set<object>, fn: (ax: number, az: number, bx: number, bz: number) => void, dynamic = false): void {
    seen.clear();
    if (dynamic) {
      for (const list of this.dynamic.values()) {
        for (const d of list) {
          if (Math.max(d.ax, d.bx) < x0 || Math.min(d.ax, d.bx) > x1 || Math.max(d.az, d.bz) < z0 || Math.min(d.az, d.bz) > z1) continue;
          fn(d.ax, d.az, d.bx, d.bz);
        }
      }
    }
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const list = this.grid.get(`${i},${j}`);
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s) || (s.tag && this.disabled.has(s.tag))) continue;
          seen.add(s);
          fn(s.ax, s.az, s.bx, s.bz);
        }
      }
    }
  }

  /**
   * The first wall along a plan ray from (x0, z0) to (x1, z1), as a fraction of it (1: clear).
   * Static segments only (the chase camera: vehicles/car/chaseCamera.ts).
   */
  raycast(x0: number, z0: number, x1: number, z1: number, seen: Set<object>): number {
    let best = 1;
    const dx = x1 - x0;
    const dz = z1 - z0;
    this.forEachNear(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), seen, (ax, az, bx, bz) => {
      const ex = bx - ax;
      const ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) return;
      const t = ((ax - x0) * ez - (az - z0) * ex) / den;
      const u = ((ax - x0) * dz - (az - z0) * dx) / den;
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
    });
    return best;
  }

  /**
   * A moving solid's outline (a parked car), resolved like any wall until it is replaced or
   * cleared (null). Kept out of the grid: it is tested directly.
   */
  setDynamic(tag: string, pts: readonly [number, number][] | null): void {
    if (!pts) {
      this.dynamic.delete(tag);
      return;
    }
    let list = this.dynamic.get(tag);
    if (!list) this.dynamic.set(tag, (list = []));
    // Moved every frame: its segments are rewritten in place.
    list.length = Math.min(list.length, pts.length);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const s = list[i];
      if (s) {
        s.ax = a[0];
        s.az = a[1];
        s.bx = b[0];
        s.bz = b[1];
      } else list.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], tag });
    }
  }

  private readonly out: [number, number] = [0, 0];

  /** A circle at (px, pz) pushed off one segment, into `out`: false if it does not touch it. */
  private push(s: Segment, px: number, pz: number, r: number): boolean {
    const ex = s.bx - s.ax;
    const ez = s.bz - s.az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.min(Math.max(((px - s.ax) * ex + (pz - s.az) * ez) / len2, 0), 1) : 0;
    const cx = s.ax + ex * t;
    const cz = s.az + ez * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d >= r || d <= 1e-9) return false;
    this.out[0] = cx + ((px - cx) / d) * r;
    this.out[1] = cz + ((pz - cz) / d) * r;
    return true;
  }

  /** Pushes a circle out of every segment it overlaps. */
  resolve(x: number, z: number, r: number): [number, number] {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const ci = Math.floor(px / CELL);
      const cj = Math.floor(pz / CELL);
      const seen = new Set<Segment>();
      for (const list of this.dynamic.values()) for (const s of list) if (this.push(s, px, pz, r)) [px, pz, moved] = [this.out[0], this.out[1], true];
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          const list = this.grid.get(`${i},${j}`);
          if (!list) continue;
          for (const s of list) {
            if (seen.has(s) || (s.tag && this.disabled.has(s.tag))) continue;
            seen.add(s);
            const ex = s.bx - s.ax;
            const ez = s.bz - s.az;
            const len2 = ex * ex + ez * ez;
            const t = len2 > 0 ? Math.min(Math.max(((px - s.ax) * ex + (pz - s.az) * ez) / len2, 0), 1) : 0;
            const cx = s.ax + ex * t;
            const cz = s.az + ez * t;
            const d = Math.hypot(px - cx, pz - cz);
            if (d < r && d > 1e-9) {
              px = cx + ((px - cx) / d) * r;
              pz = cz + ((pz - cz) / d) * r;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return [px, pz];
  }
}
