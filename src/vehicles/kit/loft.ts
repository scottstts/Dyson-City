/**
 * The vehicle refs' modelling kit (refs/car.html, refs/spacecraft.html), ported unchanged so the
 * models come out exactly as authored: monotone cubic tracks, closed ring lofts with audited
 * outward winding, parallel-transport rails and crowned panels. Every function returns a
 * BufferGeometry (position + index, normals computed per part as the refs do); `PartSink` collects
 * them by material slot and merges them into one geometry with one group per slot.
 */
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;

/**
 * Tessellation level while a model is built (1: the ref's own counts). A distance LOD builds the
 * same model again at a lower level: every authored count is scaled, never below its minimum.
 */
let detail = 1;

/** An authored tessellation count at the current level. */
export function d(n: number, min: number): number {
  return Math.max(Math.min(n, min), Math.round(n * detail));
}

/** [f(0, n), …, f(n − 1, n)]. */
export function seq<T>(n: number, f: (i: number, n: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => f(i, n));
}

/** Builds at a tessellation level. */
export function withDetail<T>(level: number, build: () => T): T {
  const prev = detail;
  detail = level;
  try {
    return build();
  } finally {
    detail = prev;
  }
}
export const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Overshoot-free cubic scalar track through (x, y) knots (refs/car.html `track`). */
export function track(knots: readonly (readonly [number, number])[]): (x: number) => number {
  const n = knots.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = (knots[i + 1][1] - knots[i][1]) / (knots[i + 1][0] - knots[i][0]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    let r = a * a + b * b;
    if (r > 9) {
      r = 3 / Math.sqrt(r);
      m[i] = r * a * d[i];
      m[i + 1] = r * b * d[i];
    }
  }
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1];
    if (x >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (knots[i + 1][0] < x) i++;
    const h = knots[i + 1][0] - knots[i][0];
    const t = (x - knots[i][0]) / h;
    return (2 * t * t * t - 3 * t * t + 1) * knots[i][1] + (t * t * t - 2 * t * t + t) * h * m[i] + (-2 * t * t * t + 3 * t * t) * knots[i + 1][1] + (t * t * t - t * t) * h * m[i + 1];
  };
}

/** Builds an indexed geometry from flat positions and triangle indices, normals computed. */
export function geometry(p: number[], idx: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Signed volume (×6) of an indexed triangle soup. */
function volume(p: number[], idx: number[]): number {
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return vol;
}

/**
 * Closes a planar ring (vertex indices, in order) with triangles facing along its Newell normal,
 * or against it with `flip`. A ring that is star-shaped about its centroid takes the refs' fan from
 * the centroid; any other (a section with a dip, like the car's aft casting) is ear-clipped in its
 * plane, since a fan across a concave ring folds over itself (coplanar overlap: flicker).
 */
export function capRing(p: number[], idx: number[], ring: readonly number[], flip: boolean): void {
  const n = ring.length;
  const c = V(0, 0, 0);
  const at = (i: number) => V(p[ring[i] * 3], p[ring[i] * 3 + 1], p[ring[i] * 3 + 2]);
  const pts = ring.map((_, i) => at(i));
  for (const q of pts) c.add(q);
  c.divideScalar(n);
  const N = V(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    N.x += (a.y - b.y) * (a.z + b.z);
    N.y += (a.z - b.z) * (a.x + b.x);
    N.z += (a.x - b.x) * (a.y + b.y);
  }
  if (N.lengthSq() < 1e-24) return;
  N.normalize();
  const e1 = new Vector3();
  const e2 = new Vector3();
  let star = true;
  for (let i = 0; i < n && star; i++) {
    e1.subVectors(pts[i], c);
    e2.subVectors(pts[(i + 1) % n], c);
    if (e1.cross(e2).dot(N) <= 0) star = false;
  }
  const tri = (a: number, b: number, d: number) => (flip ? idx.push(a, d, b) : idx.push(a, b, d));
  if (star) {
    const ci = p.length / 3;
    p.push(c.x, c.y, c.z);
    for (let k = 0; k < n; k++) tri(ci, ring[k], ring[(k + 1) % n]);
    return;
  }
  const u = new Vector3().subVectors(pts[0], c).normalize();
  const w = new Vector3().crossVectors(N, u);
  const contour = pts.map((q) => new Vector2(e1.subVectors(q, c).dot(u), e1.dot(w)));
  // The contour runs counter-clockwise about N in (u, w); ear-clipping keeps its orientation.
  for (const [a, b, d] of ShapeUtils.triangulateShape(contour, [])) {
    const ab = new Vector2().subVectors(contour[b], contour[a]);
    const ad = new Vector2().subVectors(contour[d], contour[a]);
    if (ab.cross(ad) >= 0) tri(ring[a], ring[b], ring[d]);
    else tri(ring[a], ring[d], ring[b]);
  }
}

/**
 * Welds coincident vertices and drops the triangles that collapse: a ring the profile shrinks to a
 * point (a fairing's tip) becomes one apex with a proper normal instead of a fan of zero-area
 * triangles with no normal at all.
 */
export function weld(p: number[], idx: number[]): void {
  const key = (i: number) => `${Math.round(p[i * 3] * 1e7)},${Math.round(p[i * 3 + 1] * 1e7)},${Math.round(p[i * 3 + 2] * 1e7)}`;
  const first = new Map<string, number>();
  const map = new Int32Array(p.length / 3);
  for (let i = 0; i < map.length; i++) {
    const k = key(i);
    const f = first.get(k);
    if (f === undefined) {
      first.set(k, i);
      map[i] = i;
    } else map[i] = f;
  }
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]];
    const b = map[idx[t + 1]];
    const c = map[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-24) continue;
    idx[o++] = a;
    idx[o++] = b;
    idx[o++] = c;
  }
  idx.length = o;
}

/** Flips every triangle when the soup encloses negative volume (outward winding). */
export function outward(p: number[], idx: number[]): void {
  if (volume(p, idx) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
}

/** Ring loft (refs/car.html `loft`): rings of equal size, optionally closed along the loft, capped at fan centres. */
export function loft(rings: Vector3[][], { closed = false, cap = true }: { closed?: boolean; cap?: boolean } = {}): BufferGeometry {
  const p: number[] = [];
  const idx: number[] = [];
  const n = rings[0].length;
  for (const ring of rings) for (const v of ring) p.push(v.x, v.y, v.z);
  const steps = closed ? rings.length : rings.length - 1;
  for (let j = 0; j < steps; j++) {
    for (let k = 0; k < n; k++) {
      const a = j * n + k;
      const b = j * n + ((k + 1) % n);
      const c = ((j + 1) % rings.length) * n + ((k + 1) % n);
      const d = ((j + 1) % rings.length) * n + k;
      idx.push(a, b, d, b, c, d);
    }
  }
  if (!closed && cap) for (const end of [0, rings.length - 1]) capRing(p, idx, Array.from({ length: n }, (_, k) => end * n + k), end === 0);
  weld(p, idx);
  outward(p, idx);
  return geometry(p, idx);
}

/** Centripetal Catmull–Rom through points. */
export function curve(points: readonly (Vector3 | readonly [number, number, number])[], closed = false): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    points.map((q) => (q instanceof Vector3 ? q : V(q[0], q[1], q[2]))),
    closed,
    'centripetal',
  );
}

export interface RailOptions {
  steps?: number;
  sides?: number;
  taper?: number;
}

/** Parallel-transport sweep with an elliptical section and capped ends (refs/car.html `rail`). */
export function rail(points: readonly (Vector3 | readonly [number, number, number])[] | ((t: number) => Vector3), rx: number, ry: number, { steps = 72, sides = 12, taper = 0 }: RailOptions = {}): BufferGeometry {
  steps = d(steps, 2);
  sides = d(sides, 6);
  const c = typeof points === 'function' ? null : curve(points);
  const point = (t: number): Vector3 => (c ? c.getPoint(t) : (points as (t: number) => Vector3)(t));
  const rings: Vector3[][] = [];
  let previous: Vector3 | undefined;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = point(t);
    const tangent = point(Math.min(1, t + 0.001)).sub(point(Math.max(0, t - 0.001))).normalize();
    let u = previous ? previous.clone() : V(0, 1, 0);
    if (Math.abs(tangent.dot(u)) > 0.99) u = V(1, 0, 0);
    u.addScaledVector(tangent, -u.dot(tangent)).normalize();
    const v = new Vector3().crossVectors(tangent, u).normalize();
    previous = u;
    const s = 1 - taper + taper * Math.pow(Math.sin(Math.PI * t), 0.6);
    const r: Vector3[] = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      r.push(p.clone().addScaledVector(u, Math.cos(a) * ry * s).addScaledVector(v, Math.sin(a) * rx * s));
    }
    rings.push(r);
  }
  return loft(rings);
}

export interface PanelOptions {
  crown?: number;
  thickness?: number;
  steps?: number;
  across?: number;
}

/** Crowned solid panel between two curves (refs/car.html `panel`). */
export function panel(inner: (t: number) => Vector3, outer: (t: number) => Vector3, { crown = 0.035, thickness = 0.026, steps = 88, across = 18 }: PanelOptions = {}): BufferGeometry {
  steps = d(steps, 4);
  across = d(across, 8);
  const rings: Vector3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = inner(t);
    const b = outer(t);
    const r: Vector3[] = [];
    const t0 = Math.max(0, t - 0.001);
    const t1 = Math.min(1, t + 0.001);
    const tangent = inner(t1).add(outer(t1)).sub(inner(t0).add(outer(t0)));
    const normal = new Vector3().crossVectors(b.clone().sub(a), tangent).normalize();
    for (let j = 0; j < across; j++) {
      const ang = (j / across) * TAU;
      const u = (1 - Math.cos(ang)) / 2;
      const p = a.clone().lerp(b, u);
      p.y += Math.sin(Math.PI * u) * crown;
      p.addScaledVector(normal, (Math.sin(ang) * thickness) / 2);
      r.push(p);
    }
    rings.push(r);
  }
  return loft(rings);
}

/** A named part in a material slot. */
export interface VehiclePart {
  name: string;
  slot: number;
  geometry: BufferGeometry;
}

/**
 * Collects parts by material slot. Each part is reduced to position + normal, indexed, and placed
 * by its own matrix (baked); `merge` returns one geometry with one group per non-empty slot.
 */
export class PartSink {
  readonly parts: VehiclePart[] = [];
  /** Applied to every part after its own matrix (the ref's assembly-level placement). */
  private readonly base: Matrix4;

  constructor(base: Matrix4 = new Matrix4()) {
    this.base = base;
  }

  add(name: string, slot: number, g: BufferGeometry, local?: Matrix4): BufferGeometry {
    let out = new BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    out.setAttribute('normal', g.getAttribute('normal'));
    if (g.index) out.setIndex(g.index);
    else out.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
    out = out.clone();
    const m = local ? this.base.clone().multiply(local) : this.base;
    out.applyMatrix4(m);
    // A mirroring placement turns the faces inside out: re-wind them.
    if (m.determinant() < 0) {
      const ix = out.index!.array as Uint32Array | Uint16Array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    }
    g.dispose();
    this.parts.push({ name, slot, geometry: out });
    return out;
  }

  /** One geometry, a group per slot (materialIndex = slot). */
  merge(): BufferGeometry {
    const bySlot = new Map<number, BufferGeometry[]>();
    for (const p of this.parts) {
      let list = bySlot.get(p.slot);
      if (!list) bySlot.set(p.slot, (list = []));
      list.push(p.geometry);
    }
    const slots = [...bySlot.keys()].sort((a, b) => a - b);
    const perSlot = slots.map((s) => mergeGeometries(bySlot.get(s)!, false));
    const merged = mergeGeometries(perSlot, true);
    merged.groups.forEach((g, i) => (g.materialIndex = slots[i]));
    for (const g of perSlot) g.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  get triangles(): number {
    return this.parts.reduce((n, p) => n + p.geometry.index!.count / 3, 0);
  }
}
