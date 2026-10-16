/**
 * Building the planting (docs/estate.md "Planting"): every tree grown from its own seed and placed
 * (turned at random about its trunk), every bed filled, the clipped yews turned. All foliage (trees
 * and beds) is merged into one card mesh with one material; the wood into one mesh per species
 * (its bark); the yews join the clipped hedges.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { lathe } from '../../geometry/solids';
import { Parts } from '../../field/kit/parts';
import { upright } from '../kit';
import { TERRACE_Y } from '../layout';
import type { Region } from '../regions';
import { growTree } from './tree';
import { SPECIES } from './species';
import { emptyCards, plant, type CardGeometry } from './shrub';
import { shrubPlan, topiaryPlan, treePlan, type TreePlace } from './planting';

export interface WoodGeometry {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
}

export interface Planting {
  /** Every leaf, petal and sprig card. */
  foliage: CardGeometry;
  /** The trees' leaves alone (the star-shade raster: a canopy shades the lawn, a bed does not). */
  canopy: CardGeometry;
  wood: Record<string, WoodGeometry>;
  topiary: Parts;
  /** Trunks for the walker. */
  trunks: PolyMesh[];
  trees: TreePlace[];
  /** Each tree's crown (world): where its leaves rustle from (docs/audio.md "The estate"). */
  crowns: Crown[];
}

export interface Crown {
  centre: [number, number, number];
  /** Mean half-spread of the leaves (m). */
  radius: number;
}

/** A clipped Irish yew: a slender column swelling a little above its foot, rounded to a blunt point. */
export function topiaryMesh(x: number, y: number, z: number, height: number, seed: number): PolyMesh {
  const prof: Vec2[] = [[0, -0.08]];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = 0.28 + 0.22 * Math.sin(Math.PI * Math.min(t * 1.25, 1) * 0.92) - 0.12 * Math.pow(t, 3);
    prof.push([Math.max(r * (t > 0.85 ? Math.sqrt((1 - t) / 0.15) : 1), 0.03), t * height]);
  }
  prof.push([0, height + 0.05]);
  const m = lathe(prof, 24, upright([x, y, z]), 0, 80);
  // Clipped foliage's bulges and fuzz, outward from the axis.
  m.verts = m.verts.map(([vx, vy, vz]) => {
    const dx = vx - x;
    const dz = vz - z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-4 || vy < y + 0.05) return [vx, vy, vz] as Vec3;
    const k = 1 + (Math.sin(vy * 3.1 + seed) * Math.cos(Math.atan2(dz, dx) * 3 + seed * 1.7) * 0.06 + Math.sin(vy * 11 + Math.atan2(dz, dx) * 7 + seed) * 0.025);
    return [x + dx * k, vy, z + dz * k] as Vec3;
  });
  return m;
}

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Appends every value of `src` to `dst` (no spread: a crown's arrays outgrow the argument limit). */
function append(dst: number[], src: ArrayLike<number>): void {
  for (let i = 0; i < src.length; i++) dst.push(src[i]);
}

/** Appends `src` (local) to `dst`, turned by `yaw`, scaled by `s`, placed at (x, y, z). */
function place<T extends { position: number[]; normal: number[]; index: number[] }>(dst: T, src: T, x: number, y: number, z: number, yaw: number, s: number, extra: (src: T, dst: T) => void): void {
  const base = dst.position.length / 3;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (let i = 0; i < src.position.length; i += 3) {
    const px = src.position[i] * s, py = src.position[i + 1] * s, pz = src.position[i + 2] * s;
    dst.position.push(x + px * c + pz * sn, y + py, z - px * sn + pz * c);
    const nx = src.normal[i], ny = src.normal[i + 1], nz = src.normal[i + 2];
    dst.normal.push(nx * c + nz * sn, ny, -nx * sn + nz * c);
  }
  for (const k of src.index) dst.index.push(k + base);
  extra(src, dst);
}

export function buildPlanting(beds: Region[]): Planting {
  const foliage = emptyCards();
  const canopy = emptyCards();
  const wood: Record<string, WoodGeometry> = {};
  const trunks: PolyMesh[] = [];
  const trees = treePlan();
  const crowns: Crown[] = [];
  for (const t of trees) {
    const g = growTree(SPECIES[t.species], t.seed);
    const r = random(t.seed * 31);
    const yaw = r() * Math.PI * 2;
    const y = TERRACE_Y - 0.08;
    const cr = g.crown.radius;
    crowns.push({ centre: [t.x, y + g.crown.centre[1] * t.scale, t.z], radius: ((cr[0] + cr[1] + cr[2]) / 3) * t.scale });
    const w = (wood[t.species] ??= { position: [], normal: [], uv: [], index: [] });
    place(w, g.wood, t.x, y, t.z, yaw, t.scale, (src, dst) => append(dst.uv, src.uv));
    for (const dst of [foliage, canopy]) {
      place(dst, g.leaves, t.x, y, t.z, yaw, t.scale, (src, d) => {
        append(d.uv, src.uv);
        append(d.shade, src.shade);
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (let i = 0; i < src.root.length; i += 3) {
          const px = src.root[i] * t.scale, py = src.root[i + 1] * t.scale, pz = src.root[i + 2] * t.scale;
          d.root.push(t.x + px * c + pz * sn, y + py, t.z - px * sn + pz * c);
        }
      });
    }
    // The trunk for the walker: an octagonal prism to head height.
    const tr = g.trunk * t.scale + 0.04;
    const prism = new PolyMesh();
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      lo.push(prism.vert([t.x + Math.cos(a) * tr, TERRACE_Y - 0.1, t.z + Math.sin(a) * tr]));
      hi.push(prism.vert([t.x + Math.cos(a) * tr, TERRACE_Y + 2.2, t.z + Math.sin(a) * tr]));
    }
    for (let k = 0; k < 8; k++) prism.face([lo[k], lo[(k + 1) % 8], hi[(k + 1) % 8], hi[k]], 0);
    trunks.push(prism);
  }
  for (const s of shrubPlan(beds)) plant(foliage, s.kind, s.x, s.y, s.z, s.seed, s.scale);
  const topiary = new Parts('estate:hedge');
  topiaryPlan().forEach((p, i) => topiary.add(`topiary:${i}`, topiaryMesh(p.x, TERRACE_Y + 0.02, p.z, p.height, 17 + i * 5)));
  return { foliage, canopy, wood, topiary, trunks, trees, crowns };
}
