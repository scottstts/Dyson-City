/**
 * Shrubs, perennials and vegetables as clusters of sprig cards (docs/estate.md "Planting"), in the
 * same card layout as the trees' leaves (one foliage material for all):
 *
 *  - mounds (hydrangea, laurel, rose, lavender, hosta, fern): cards scattered through an ellipsoid,
 *    biased to its surface, each crossed pair turned outward and up; flower heads on the surface
 *    for hydrangeas;
 *  - spires (delphinium, foxglove, daisy clumps): crossed upright cards from the ground;
 *  - vegetables: a cabbage is a low rosette of cards.
 */
import { Vector3 } from 'three';
import { tileUV, type LeafKind } from './atlas';

export interface CardGeometry {
  position: number[];
  normal: number[];
  uv: number[];
  root: number[];
  shade: number[];
  index: number[];
}

export function emptyCards(): CardGeometry {
  return { position: [], normal: [], uv: [], root: [], shade: [], index: [] };
}

export type ShrubKind = 'hydrangea' | 'laurel' | 'rose' | 'lavender' | 'hosta' | 'fern' | 'delphinium' | 'foxglove' | 'daisy' | 'cabbage' | 'lettuce';

/** Spread (radius) and height of each kind, for planting. */
export const SHRUB_SIZE: Record<ShrubKind, { r: number; h: number }> = {
  hydrangea: { r: 0.75, h: 1.25 },
  laurel: { r: 1.5, h: 2.6 },
  rose: { r: 0.55, h: 1.15 },
  lavender: { r: 0.38, h: 0.6 },
  hosta: { r: 0.42, h: 0.45 },
  fern: { r: 0.45, h: 0.7 },
  delphinium: { r: 0.3, h: 1.7 },
  foxglove: { r: 0.28, h: 1.35 },
  daisy: { r: 0.32, h: 0.75 },
  cabbage: { r: 0.28, h: 0.3 },
  lettuce: { r: 0.18, h: 0.18 },
};

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

const UP = new Vector3(0, 1, 0);

/** Appends one crossed card pair (or a single card) rooted at `root`, its long axis `axis`, its face toward `face`. */
function card(out: CardGeometry, kind: LeafKind, root: Vector3, axis: Vector3, face: Vector3, size: number, shade: number, normal: Vector3, cross = true): void {
  const [u0, v0, u1, v1] = tileUV(kind);
  const y = axis.clone().normalize();
  const z = face.clone().sub(y.clone().multiplyScalar(face.dot(y))).normalize();
  const x = new Vector3().crossVectors(y, z);
  const planes = cross ? [x, z] : [x];
  for (const side of planes) {
    const base = out.position.length / 3;
    const corners: [number, number, number, number][] = [
      [-0.5, 1, u0, v0],
      [-0.5, 0, u0, v1],
      [0.5, 0, u1, v1],
      [0.5, 1, u1, v0],
    ];
    for (const [a, b, u, v] of corners) {
      const p = root.clone().addScaledVector(side, a * size).addScaledVector(y, b * size);
      out.position.push(p.x, p.y, p.z);
      out.normal.push(normal.x, normal.y, normal.z);
      out.uv.push(u, v);
      out.root.push(root.x, root.y, root.z);
      out.shade.push(shade);
    }
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** One plant at (x, y, z) (its foot), turned by `turn`, scaled by `scale`. */
export function plant(out: CardGeometry, kind: ShrubKind, x: number, y: number, z: number, seed: number, scale = 1): void {
  const r = random(seed);
  const size = SHRUB_SIZE[kind];
  const R = size.r * scale;
  const Hh = size.h * scale;
  const centre = new Vector3(x, y + Hh * 0.5, z);
  const tmp = new Vector3();
  const mound = (leaf: LeafKind, count: number, cardSize: number, flower?: { kind: LeafKind; count: number; size: number }) => {
    for (let i = 0; i < count; i++) {
      // A point in the ellipsoid, biased toward its surface; never below the ground.
      const a = r() * Math.PI * 2;
      const cy = r() * 2 - 1;
      const sy = Math.sqrt(1 - cy * cy);
      const d = Math.pow(r(), 0.35);
      tmp.set(Math.cos(a) * sy * R * d, Math.max(cy * Hh * 0.5 * d, -Hh * 0.45), Math.sin(a) * sy * R * d);
      const p = centre.clone().add(tmp);
      const out1 = tmp.clone().normalize();
      const axis = out1.clone().add(UP).normalize();
      const face = new Vector3(r() - 0.5, r() * 0.4, r() - 0.5).normalize();
      const depth = 1 - d;
      const shade = (1 - 0.65 * depth) * (0.6 + 0.4 * ((tmp.y / (Hh * 0.5) + 1) / 2));
      card(out, leaf, p.clone().addScaledVector(axis, -cardSize * 0.3), axis, face, cardSize * (0.8 + r() * 0.4), shade, out1.clone().add(UP.clone().multiplyScalar(0.3)).normalize());
    }
    if (flower) {
      for (let i = 0; i < flower.count; i++) {
        const a = r() * Math.PI * 2;
        const cy = 0.15 + r() * 0.8;
        const sy = Math.sqrt(1 - cy * cy);
        tmp.set(Math.cos(a) * sy * R * 0.92, cy * Hh * 0.46, Math.sin(a) * sy * R * 0.92);
        const p = centre.clone().add(tmp);
        const n = tmp.clone().normalize();
        // A flower head: a ball of florets, three cards round its centre.
        const s = flower.size * (0.85 + r() * 0.3);
        for (let k = 0; k < 3; k++) {
          const ax = new Vector3(Math.cos((k * Math.PI) / 3), 0.25, Math.sin((k * Math.PI) / 3)).normalize();
          card(out, flower.kind, p.clone().addScaledVector(UP, -s / 2), UP, ax, s, 0.95, n.clone().add(UP).normalize(), false);
        }
      }
    }
  };
  const spires = (leaf: LeafKind, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * R * 0.6;
      const p = new Vector3(x + Math.cos(a) * d, y, z + Math.sin(a) * d);
      const lean = new Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
      const face = new Vector3(Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28));
      card(out, leaf, p, lean, face, Hh * (0.8 + r() * 0.3), 0.9, new Vector3(Math.cos(a), 0.6, Math.sin(a)).normalize());
    }
  };
  switch (kind) {
    case 'hydrangea':
      mound('hydrangeaLeaf', 26, 0.42 * scale, { kind: 'hydrangeaFlower', count: 11, size: 0.3 * scale });
      break;
    case 'laurel':
      mound('laurel', 70, 0.75 * scale);
      break;
    case 'rose':
      mound('rose', 22, 0.45 * scale);
      break;
    case 'lavender':
      spires('lavender', 6);
      break;
    case 'hosta':
      mound('hosta', 7, 0.42 * scale);
      break;
    case 'fern':
      spires('fern', 5);
      break;
    case 'delphinium':
      spires('delphinium', 3);
      break;
    case 'foxglove':
      spires('foxglove', 3);
      break;
    case 'daisy':
      spires('daisy', 4);
      break;
    case 'cabbage':
    case 'lettuce': {
      // A rosette: cards splayed outward round the heart.
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r();
        const axis = new Vector3(Math.cos(a), 0.9, Math.sin(a)).normalize();
        card(out, 'cabbage', new Vector3(x, y, z), axis, new Vector3(-Math.sin(a), 0.2, Math.cos(a)), R * 1.5, 0.95, new Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize(), false);
      }
      break;
    }
  }
}

