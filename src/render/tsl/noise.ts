/**
 * Shared TSL noise primitives. Integer (PCG3D) hashing keeps cell lattices stable at large
 * coordinates, which matters for star granulation and shell panel grids.
 */
import { Fn, float, vec3, uvec3, ivec3, bitXor, shiftRight, floor, fract, dot, mix, min, sqrt, sin, cos } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const U32_TO_UNIT = 1 / 4294967296;

type UV3 = Node<'uvec3'>;
const xorShift16 = (n: UV3): UV3 =>
  (bitXor as unknown as (a: UV3, b: UV3) => UV3)(n, (shiftRight as unknown as (a: UV3, b: UV3) => UV3)(n, uvec3(16, 16, 16) as unknown as UV3));

/** PCG3D hash of an integer lattice point → three uniform floats in [0, 1). */
export const hash33 = Fn(([cell]: [V3]) => {
  const v = uvec3(ivec3(cell)).toVar();
  v.assign(v.mul(1664525).add(1013904223));
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  v.z.addAssign(v.x.mul(v.y));
  v.assign(xorShift16(v));
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  v.z.addAssign(v.x.mul(v.y));
  return vec3(v).mul(U32_TO_UNIT);
}).setLayout({ name: 'dyHash33', type: 'vec3', inputs: [{ name: 'cell', type: 'vec3' }] });

/** Single float hash of a lattice point. */
export const hash31 = Fn(([cell]: [V3]) => hash33(cell).x).setLayout({ name: 'dyHash31', type: 'float', inputs: [{ name: 'cell', type: 'vec3' }] });

/** Smooth 3D value noise in [0, 1]. */
export const valueNoise3 = Fn(([p]: [V3]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3)).toVar();
  const n000 = hash31(i);
  const n100 = hash31(i.add(vec3(1, 0, 0)));
  const n010 = hash31(i.add(vec3(0, 1, 0)));
  const n110 = hash31(i.add(vec3(1, 1, 0)));
  const n001 = hash31(i.add(vec3(0, 0, 1)));
  const n101 = hash31(i.add(vec3(1, 0, 1)));
  const n011 = hash31(i.add(vec3(0, 1, 1)));
  const n111 = hash31(i.add(vec3(1, 1, 1)));
  const x00 = mix(n000, n100, u.x);
  const x10 = mix(n010, n110, u.x);
  const x01 = mix(n001, n101, u.x);
  const x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}).setLayout({ name: 'dyValueNoise3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/**
 * Value-noise fBm with footprint-aware octave fading. `footprint` is the pixel footprint in the
 * same units as p (pre-frequency); octaves whose period falls below ~2 px fade to their mean.
 */
export function fbm3(p: V3, octaves: number, footprint: F, lacunarity = 2.03, gain = 0.5): F {
  let sum: F = float(0);
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const fade = float(1).sub(footprint.mul(freq).mul(1.6).smoothstep(0.35, 1.0));
    const n = valueNoise3(p.mul(freq).add(vec3(o * 17.13, o * 31.7, o * 7.31)));
    sum = sum.add(n.sub(0.5).mul(fade).add(0.5).mul(amp));
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum.div(norm);
}

/**
 * Exact 3×3×3 cellular noise with animated feature points.
 * Returns vec3(F1, F2, cellHash) where cellHash identifies the nearest cell.
 * `motion` (0..~0.35) and `phase` animate each feature point on a small closed orbit.
 */
export const cellular3 = Fn(([p, phase, motion]: [V3, F, F]) => {
  const ip = floor(p).toVar();
  const fp = fract(p).toVar();
  const f1 = float(8).toVar();
  const f2 = float(8).toVar();
  const id = float(0).toVar();
  for (let z = -1; z <= 1; z++) {
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const o = vec3(x, y, z);
        const h = hash33(ip.add(o)).toVar();
        const a = h.x.mul(6.2831853).add(phase.mul(h.y.add(0.5)));
        const orbit = vec3(cos(a), sin(a.mul(1.3)), sin(a.add(h.z.mul(6.28)))).mul(motion);
        const feature = o.add(h.mul(0.9).add(0.05)).add(orbit);
        const d = feature.sub(fp);
        const dist = dot(d, d);
        const isNearest = dist.lessThan(f1);
        f2.assign(isNearest.select(f1, min(f2, dist)));
        id.assign(isNearest.select(h.z, id));
        f1.assign(isNearest.select(dist, f1));
      }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}).setLayout({
  name: 'dyCellular3',
  type: 'vec3',
  inputs: [
    { name: 'p', type: 'vec3' },
    { name: 'phase', type: 'float' },
    { name: 'motion', type: 'float' },
  ],
});

/** 2D hash for screen-space dithering. */
export const hash12 = Fn(([p]: [Node<'vec2'>]) => hash31(vec3(p, 0.0))).setLayout({ name: 'dyHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

