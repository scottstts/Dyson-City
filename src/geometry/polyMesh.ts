/**
 * Polygon-first mesh kernel (Y-up, metres).
 *
 * Parts are modelled as quads and n-gons with a material slot and per-corner UVs per face, and
 * triangulated only at emission. Normals are smooth-by-angle per corner: a corner averages only the
 * adjacent faces of its own slot whose normals lie within the part's crease angle, so chamfers stay
 * crisp and curved sweeps stay smooth. One PolyMesh is one semantic part; parts are merged by slot
 * only after they have been audited (`emitParts`).
 *
 * The verts/faces/faceMat/uvs layout matches the geometry-quality kit's MeshData, so its topology
 * audit (tools/geometry-kit) reads a PolyMesh directly.
 */
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export class PolyMesh {
  verts: Vec3[] = [];
  faces: number[][] = [];
  /** Material slot per face (index into the slot list given at emission). */
  faceMat: number[] = [];
  /** Per-corner UVs per face. */
  uvs: Vec2[][] = [];
  /** Crease angle (degrees) for smooth-by-angle normals. */
  crease = 30;

  constructor(crease = 30) {
    this.crease = crease;
  }

  vert(p: Vec3): number {
    this.verts.push([p[0], p[1], p[2]]);
    return this.verts.length - 1;
  }

  face(idx: number[], slot = 0, uv?: Vec2[]): void {
    this.faces.push(idx);
    this.faceMat.push(slot);
    this.uvs.push(uv ?? idx.map(() => [0, 0] as Vec2));
  }

  /** Appends another mesh (no welding: parts stay topologically separate). */
  append(m: PolyMesh): this {
    const base = this.verts.length;
    for (const v of m.verts) this.verts.push([v[0], v[1], v[2]]);
    m.faces.forEach((f, i) => {
      this.faces.push(f.map((k) => k + base));
      this.faceMat.push(m.faceMat[i]);
      this.uvs.push(m.uvs[i].map((u) => [u[0], u[1]] as Vec2));
    });
    return this;
  }

  transform(fn: (p: Vec3) => Vec3): this {
    this.verts = this.verts.map(fn);
    return this;
  }

  get triangleCount(): number {
    let n = 0;
    for (const f of this.faces) n += f.length - 2;
    return n;
  }
}

// --- vector helpers ------------------------------------------------------------------------------

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  /** a + b·s + c·t */
  madd: (a: Vec3, b: Vec3, s: number, c: Vec3, t: number): Vec3 => [a[0] + b[0] * s + c[0] * t, a[1] + b[1] * s + c[1] * t, a[2] + b[2] * s + c[2] * t],
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

/** Newell normal (unnormalised; length = 2 × area). */
export function newell(verts: Vec3[], face: number[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < face.length; i++) {
    const a = verts[face[i]];
    const b = verts[face[(i + 1) % face.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/** Triangulates one polygon (local corner indices). Convex quads split on the short diagonal. */
export function triangulate(verts: Vec3[], face: number[]): [number, number, number][] {
  const n = face.length;
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) {
    const d02 = v3.dist(verts[face[0]], verts[face[2]]);
    const d13 = v3.dist(verts[face[1]], verts[face[3]]);
    return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
  }
  const nrm = v3.norm(newell(verts, face));
  let u: Vec3 = Math.abs(nrm[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const w = v3.norm(v3.cross(nrm, u));
  u = v3.norm(v3.cross(w, nrm));
  const pts = face.map((k) => new Vector2(v3.dot(verts[k], u), v3.dot(verts[k], w)));
  // ShapeUtils expects a clockwise-agnostic contour; it returns triangles in input winding order.
  const tris = ShapeUtils.triangulateShape(pts, []) as [number, number, number][];
  if (tris.length !== n - 2) {
    const out: [number, number, number][] = [];
    for (let i = 1; i < n - 1; i++) out.push([0, i, i + 1]);
    return out;
  }
  // Keep each triangle wound like the polygon.
  return tris.map((t) => {
    const tn = v3.cross(v3.sub(verts[face[t[1]]], verts[face[t[0]]]), v3.sub(verts[face[t[2]]], verts[face[t[0]]]));
    return v3.dot(tn, nrm) >= 0 ? t : ([t[0], t[2], t[1]] as [number, number, number]);
  });
}

// --- emission ------------------------------------------------------------------------------------

export interface EmitOptions {
  /** Number of material slots (geometry groups are emitted in slot order). */
  slots: number;
  /** Extra per-corner attributes (a corner shares an emitted vertex only with corners of equal values). */
  corners?: CornerAttributes;
}

/** Per-corner values beyond position, normal and UV (e.g. a lightmap's UVs and baked light). */
export interface CornerAttributes {
  attributes: readonly { name: string; size: number }[];
  /** The values of corner `corner` of face `face` of part `part` (all attributes, flattened). */
  values(part: number, face: number, corner: number): ArrayLike<number>;
}

interface SlotBuffer {
  pos: number[];
  nrm: number[];
  uv: number[];
  extra: number[];
  idx: number[];
}

/**
 * Smooth-by-angle normals per face corner: a corner averages the adjacent faces of its own slot
 * whose normals lie within the part's crease angle (area-weighted).
 */
export function cornerNormals(part: PolyMesh): Vec3[][] {
  const fn = part.faces.map((f) => newell(part.verts, f));
  const unit = fn.map((n) => v3.norm(n));
  const around: number[][] = part.verts.map(() => []);
  part.faces.forEach((f, fi) => {
    for (const k of f) around[k].push(fi);
  });
  const cosCrease = Math.cos((part.crease * Math.PI) / 180);
  return part.faces.map((f, fi) => {
    const slot = part.faceMat[fi];
    return f.map((k) => {
      let n: Vec3 = [0, 0, 0];
      for (const g of around[k]) {
        if (part.faceMat[g] !== slot) continue;
        if (v3.dot(unit[g], unit[fi]) < cosCrease) continue;
        n = v3.add(n, fn[g]);
      }
      const l = v3.len(n);
      return l > 0 ? v3.scale(n, 1 / l) : unit[fi];
    });
  });
}

/**
 * Emits parts as one indexed BufferGeometry with one group per material slot. Corners share an
 * emitted vertex only when they share a part vertex, slot, normal, UV and extra values, so
 * smooth-by-angle normals and per-face UV seams survive.
 */
export function emitParts(parts: PolyMesh[], opts: EmitOptions): BufferGeometry {
  const perSlot: SlotBuffer[] = Array.from({ length: opts.slots }, () => ({ pos: [], nrm: [], uv: [], extra: [], idx: [] }));
  const corners = opts.corners;
  const E = corners ? corners.attributes.reduce((n, a) => n + a.size, 0) : 0;
  parts.forEach((part, pi) => {
    const normals = cornerNormals(part);
    // Emitted vertices already made for each part vertex: [slot, nx, ny, nz, u, v, index, ...extra].
    const made: number[][][] = part.verts.map(() => []);
    part.faces.forEach((f, fi) => {
      const slot = part.faceMat[fi];
      const out = perSlot[slot];
      if (!out) throw new Error(`face slot ${slot} out of range`);
      const ids = f.map((k, c) => {
        const n = normals[fi][c];
        const u = part.uvs[fi][c];
        const x = corners ? corners.values(pi, fi, c) : null;
        search: for (const m of made[k]) {
          if (!(m[0] === slot && Math.abs(m[1] - n[0]) < 1e-5 && Math.abs(m[2] - n[1]) < 1e-5 && Math.abs(m[3] - n[2]) < 1e-5 && Math.abs(m[4] - u[0]) < 1e-6 && Math.abs(m[5] - u[1]) < 1e-6)) continue;
          for (let e = 0; e < E; e++) if (m[7 + e] !== x![e]) continue search;
          return m[6];
        }
        const p = part.verts[k];
        const id = out.pos.length / 3;
        out.pos.push(p[0], p[1], p[2]);
        out.nrm.push(n[0], n[1], n[2]);
        out.uv.push(u[0], u[1]);
        const rec = [slot, n[0], n[1], n[2], u[0], u[1], id];
        for (let e = 0; e < E; e++) {
          out.extra.push(x![e]);
          rec.push(x![e]);
        }
        made[k].push(rec);
        return id;
      });
      for (const t of triangulate(part.verts, f)) out.idx.push(ids[t[0]], ids[t[1]], ids[t[2]]);
    });
  });
  const vertexCount = perSlot.reduce((n, s) => n + s.pos.length / 3, 0);
  const indexCount = perSlot.reduce((n, s) => n + s.idx.length, 0);
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const extra = corners ? corners.attributes.map((a) => new Float32Array(vertexCount * a.size)) : [];
  const idx = new Uint32Array(indexCount);
  const g = new BufferGeometry();
  let vBase = 0;
  let iBase = 0;
  perSlot.forEach((s, slot) => {
    pos.set(s.pos, vBase * 3);
    nrm.set(s.nrm, vBase * 3);
    uv.set(s.uv, vBase * 2);
    if (corners) {
      const count = s.pos.length / 3;
      let o = 0;
      for (let v = 0; v < count; v++) {
        corners.attributes.forEach((a, ai) => {
          for (let c = 0; c < a.size; c++) extra[ai][(vBase + v) * a.size + c] = s.extra[o++];
        });
      }
    }
    for (let i = 0; i < s.idx.length; i++) idx[iBase + i] = s.idx[i] + vBase;
    if (s.idx.length > 0) g.addGroup(iBase, s.idx.length, slot);
    vBase += s.pos.length / 3;
    iBase += s.idx.length;
  });
  // The arrays above are this geometry's own: adopted, not copied again.
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  corners?.attributes.forEach((a, ai) => g.setAttribute(a.name, new BufferAttribute(extra[ai], a.size)));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
