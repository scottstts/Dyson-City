/**
 * Named parts: every field part is one PolyMesh with a stable name (audited by tests/ for topology,
 * coplanar overlap and clashes), merged by material slot only at emission. A name prefix `set:`
 * marks a part made of several closed components (a ladder's rungs and stiles, a rail run's posts):
 * each component is closed and outward, and they may seat into one another.
 */
import type { PolyMesh } from '../../geometry/polyMesh';

export interface Part {
  name: string;
  mesh: PolyMesh;
}

export class Parts {
  readonly list: Part[] = [];
  private readonly names = new Set<string>();

  readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  add(name: string, mesh: PolyMesh): PolyMesh {
    const full = `${this.prefix}:${name}`;
    if (this.names.has(full)) throw new Error(`duplicate part name ${full}`);
    this.names.add(full);
    this.list.push({ name: full, mesh });
    return mesh;
  }

  /** A part of several closed components (see the module note). */
  addSet(name: string, mesh: PolyMesh): PolyMesh {
    return this.add(`set:${name}`, mesh);
  }

  get triangles(): number {
    return this.list.reduce((n, p) => n + p.mesh.triangleCount, 0);
  }
}

/** Deterministic PRNG (mulberry32) so every build of the field is identical. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uneven spacings that sum to `length`: no countable rhythm (city_plan §5.1). */
export function unevenSpacing(length: number, mean: number, spread: number, rand: () => number): number[] {
  const n = Math.max(1, Math.round(length / mean));
  const w = Array.from({ length: n }, () => 1 + (rand() * 2 - 1) * spread);
  const sum = w.reduce((a, b) => a + b, 0);
  const out = [0];
  for (const x of w) out.push(out[out.length - 1] + (x / sum) * length);
  return out;
}

/**
 * A moving assembly: parts modelled in their own frame, emitted as one mesh whose matrix `pose`
 * sets each frame from game time.
 */
export interface Mover {
  name: string;
  parts: Part[];
  pose(gameTime: number, out: import('three').Matrix4): import('three').Matrix4;
}
