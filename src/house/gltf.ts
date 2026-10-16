/**
 * A minimal reader for the house's glTF parts (blender/build/export.py): non-sparse accessors in
 * one buffer, node TRS hierarchies, extras carrying the engine contract. Pure (no DOM, no three),
 * so the part worker and the tests share it.
 */

export interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  normalized?: boolean;
  min?: number[];
  max?: number[];
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  extras?: Record<string, unknown>;
}

export interface GltfTextureInfo {
  index: number;
  texCoord?: number;
  scale?: number;
  extensions?: { KHR_texture_transform?: { offset?: [number, number]; scale?: [number, number]; rotation?: number; texCoord?: number } };
}

export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: GltfTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GltfTextureInfo;
  };
  normalTexture?: GltfTextureInfo;
  occlusionTexture?: GltfTextureInfo;
  emissiveFactor?: [number, number, number];
  emissiveTexture?: GltfTextureInfo;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: {
    KHR_materials_transmission?: { transmissionFactor?: number; transmissionTexture?: GltfTextureInfo };
    KHR_materials_ior?: { ior?: number };
  };
}

export interface GltfDocument {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { name?: string; primitives: GltfPrimitive[] }[];
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  buffers: { uri: string; byteLength: number }[];
  materials: GltfMaterial[];
  textures?: { source: number; sampler?: number }[];
  images?: { uri: string; mimeType?: string }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;

/** Reads an accessor as a packed Float32Array (or Uint32Array for indices). */
export function readAccessor(doc: GltfDocument, bin: ArrayBuffer, index: number): Float32Array | Uint32Array {
  const a = doc.accessors[index];
  const view = doc.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  if (!size) throw new Error(`glTF: component type ${a.componentType}`);
  const stride = view.byteStride ?? n * size;
  // Tightly packed 32-bit data (all the exporter writes): a straight copy.
  if (stride === n * size && base % 4 === 0) {
    if (a.componentType === 5126) return new Float32Array(bin, base, a.count * n).slice();
    if (a.componentType === 5125 && n === 1) return new Uint32Array(bin, base, a.count).slice();
  }
  const dv = new DataView(bin);
  const integer = a.componentType !== 5126;
  const out = integer && n === 1 && !a.normalized ? new Uint32Array(a.count) : new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    for (let c = 0; c < n; c++) {
      const p = o + c * size;
      let v: number;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(p, true); break;
        case 5125: v = dv.getUint32(p, true); break;
        case 5123: v = dv.getUint16(p, true); if (a.normalized) v /= 65535; break;
        case 5122: v = dv.getInt16(p, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
        case 5121: v = dv.getUint8(p); if (a.normalized) v /= 255; break;
        default: v = dv.getInt8(p); if (a.normalized) v = Math.max(v / 127, -1); break;
      }
      out[i * n + c] = v;
    }
  }
  return out;
}

/** Column-major 4×4. */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function compose(t: readonly number[] = [0, 0, 0], q: readonly number[] = [0, 0, 0, 1], s: readonly number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0];
  m[1] = (xy + wz) * s[0];
  m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1];
  m[5] = (1 - (xx + zz)) * s[1];
  m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2];
  m[9] = (yz - wx) * s[2];
  m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function nodeMatrix(n: GltfNode): Mat4 {
  if (n.matrix) return Float64Array.from(n.matrix);
  return compose(n.translation, n.rotation, n.scale);
}

/** Inverse-transpose of the upper 3×3 (normal matrix), row-major 3×3. */
export function normalMatrix(m: Mat4): Float64Array {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  // (M^-1)^T, row-major.
  return Float64Array.from([
    A * inv, B * inv, C * inv,
    -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv,
    (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv,
  ]);
}

export interface NodeVisit {
  index: number;
  node: GltfNode;
  /** Node-to-part (house frame) matrix. */
  world: Mat4;
  parent: number;
}

/** Depth-first visit of the default scene with accumulated matrices. */
export function visitNodes(doc: GltfDocument, fn: (v: NodeVisit) => void): void {
  const scene = doc.scenes[doc.scene ?? 0];
  const stack: { i: number; m: Mat4; parent: number }[] = scene.nodes.map((i) => ({ i, m: identity(), parent: -1 }));
  while (stack.length) {
    const { i, m, parent } = stack.pop()!;
    const node = doc.nodes[i];
    const world = multiply(m, nodeMatrix(node));
    fn({ index: i, node, world, parent });
    for (const c of node.children ?? []) stack.push({ i: c, m: world, parent: i });
  }
}
