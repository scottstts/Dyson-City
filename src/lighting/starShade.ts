/**
 * The star-shade (docs/shadows.md, "Outdoors"): how much of the star's 45° cap each point of the
 * platform sees past the field standing round it, baked once at boot.
 *
 *  1. Occluders (CPU, `rasterOccluders`): every static field mesh is rasterised top-down into a
 *     plan map of 1 m texels holding the lowest and the highest surface standing over each texel.
 *     Two values, not one, so anything raised (the Halo's arches and lines, tanks on columns, the
 *     gantry, ring galleries) shades the ground under it instead of filling it in.
 *  2. Visibility (GPU compute, `createStarShade`): from each texel, 24 cosine-weighted directions
 *     over the cap are marched through the map (steps growing with distance: the penumbra is wide)
 *     and the share that clears it is stored.
 *  3. Runtime: one texture read. `starShadeAO` turns it into an ambient-occlusion term on the
 *     star's share of the image-based light only (the bounce and the sky stay): up-facing surfaces
 *     take most of their light from the star, vertical ones about half. It applies at the ground
 *     and fades out within a few metres above it (higher surfaces keep their contact AO only).
 */
import { DataTexture, FloatType, NearestFilter, RGFormat, StorageTexture, LinearFilter, type Mesh, type WebGPURenderer, type Node, type Texture } from 'three/webgpu';
import { Fn, If, Break, float, int, ivec2, vec2, vec4, instanceIndex, textureLoad, textureStore, max, min, clamp, mix, smoothstep, positionWorld, normalWorldGeometry, texture, uniformArray } from 'three/tsl';
import { Vector4 } from 'three/webgpu';
import { capDirections } from '../city/visibility';
import { loop } from '../render/tsl/helpers';

type F = Node<'float'>;

/** The map: N × N texels over [ORIGIN, ORIGIN + EXTENT] in x and z (1 m texels). */
export const SHADE = { N: 1024, origin: -512, extent: 1024, dirs: 24, maxHeight: 240 } as const;

const EMPTY_LO = 1e9;
const EMPTY_HI = -1e9;

/**
 * Rasterises meshes' triangles (world space via their matrixWorld) into the occluder map: per
 * texel, [lowest, highest] surface height (RG, float). Texels with nothing over them hold an
 * empty interval.
 */
export function rasterOccluders(meshes: readonly Mesh[]): Float32Array {
  const { N, origin, extent } = SHADE;
  const cell = extent / N;
  const out = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    out[2 * i] = EMPTY_LO;
    out[2 * i + 1] = EMPTY_HI;
  }
  const put = (i: number, j: number, lo: number, hi: number) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const k = 2 * (j * N + i);
    if (lo < out[k]) out[k] = lo;
    if (hi > out[k + 1]) out[k + 1] = hi;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (const mesh of meshes) {
    mesh.updateMatrixWorld();
    const e = mesh.matrixWorld.elements;
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    const load = (v: number, o: number[]) => {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      o[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      o[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      o[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    for (let t = 0; t < count; t += 3) {
      load(idx ? idx.getX(t) : t, a);
      load(idx ? idx.getX(t + 1) : t + 1, b);
      load(idx ? idx.getX(t + 2) : t + 2, c);
      const ua = (a[0] - origin) / cell, va = (a[2] - origin) / cell;
      const ub = (b[0] - origin) / cell, vb = (b[2] - origin) / cell;
      const uc = (c[0] - origin) / cell, vc = (c[2] - origin) / cell;
      const i0 = Math.floor(Math.min(ua, ub, uc));
      const i1 = Math.floor(Math.max(ua, ub, uc));
      const j0 = Math.floor(Math.min(va, vb, vc));
      const j1 = Math.floor(Math.max(va, vb, vc));
      const lo = Math.min(a[1], b[1], c[1]);
      const hi = Math.max(a[1], b[1], c[1]);
      const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
      // Small or edge-on triangles (walls seen from above): their whole height over their footprint.
      if (Math.abs(area) < 0.5 || (i1 - i0 + 1) * (j1 - j0 + 1) <= 2) {
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) continue;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) put(i, j, lo, hi);
        continue;
      }
      // Otherwise the plane's height at each covered texel centre.
      const inv = 1 / area;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const pu = i + 0.5;
          const pv = j + 0.5;
          const w0 = ((ub - pu) * (vc - pv) - (uc - pu) * (vb - pv)) * inv;
          const w1 = ((uc - pu) * (va - pv) - (ua - pu) * (vc - pv)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
          const y = w0 * a[1] + w1 * b[1] + w2 * c[1];
          put(i, j, y, y);
        }
      }
    }
  }
  return out;
}

export interface StarShade {
  /** Share of the star's cap seen from the platform at each texel (R). */
  readonly texture: Texture;
  /** The ambient-occlusion term for a material (see the module note). */
  ao(): F;
}

/** Runs the visibility compute over the occluder map and returns the shade. */
export async function createStarShade(renderer: WebGPURenderer, occluders: Float32Array, groundY: number): Promise<StarShade> {
  const { N, origin, extent, dirs, maxHeight } = SHADE;
  const cell = extent / N;
  const heights = new DataTexture(occluders, N, N, RGFormat, FloatType);
  heights.magFilter = NearestFilter;
  heights.minFilter = NearestFilter;
  heights.needsUpdate = true;
  const out = new StorageTexture(N, N);
  out.magFilter = LinearFilter;
  out.minFilter = LinearFilter;
  // Cap directions as (horizontal unit x, z; tan of the zenith angle).
  const dirData = capDirections(dirs).map(([x, y, z]) => {
    const h = Math.hypot(x, z);
    return new Vector4(h > 1e-6 ? x / h : 1, h > 1e-6 ? z / h : 0, Math.max(h / y, 1e-3), 0);
  });
  const dirArr = uniformArray(dirData, 'vec4');
  const kernel = Fn(() => {
    const ix = int(instanceIndex.mod(N));
    const iz = int(instanceIndex.div(N));
    const p = vec2(float(ix).add(0.5).mul(cell).add(origin), float(iz).add(0.5).mul(cell).add(origin)).toVar();
    const y0 = float(groundY + 0.1);
    const seen = float(0).toVar();
    loop('kDir', dirs, (kDir) => {
      const d = (dirArr as unknown as { element(i: Node<'int'>): Node<'vec4'> }).element(kDir);
      const blocked = float(0).toVar();
      const s = float(cell * 0.75).toVar();
      loop('kStep', 64, () => {
        const y = y0.add(s.div(d.z));
        If(y.greaterThan(maxHeight + groundY), () => {
          Break();
        });
        const q = p.add(vec2(d.x, d.y).mul(s));
        const t = q.sub(origin).div(cell);
        If(t.x.lessThan(0).or(t.y.lessThan(0)).or(t.x.greaterThanEqual(N)).or(t.y.greaterThanEqual(N)), () => {
          Break();
        });
        const h = textureLoad(heights, ivec2(int(t.x), int(t.y))).xy;
        If(h.x.lessThanEqual(y).and(y.lessThanEqual(h.y)), () => {
          blocked.assign(1);
          Break();
        });
        s.addAssign(max(float(cell), s.mul(0.07)));
      });
      seen.addAssign(float(1).sub(blocked));
    });
    const v = seen.div(dirs);
    textureStore(out, ivec2(ix, iz), vec4(v, v, v, 1));
  })().compute(N * N).setName('StarShade.visibility');
  await renderer.computeAsync(kernel);
  return {
    texture: out,
    ao: () => {
      const uv = positionWorld.xz.sub(origin).div(extent);
      const v = texture(out, uv).r;
      // The star's share of the light a face receives, and how close the face is to the ground.
      const share = mix(float(0.42), float(0.82), clamp(normalWorldGeometry.y.mul(0.5).add(0.5), 0, 1));
      const near = float(1).sub(smoothstep(groundY + 0.5, groundY + 8, positionWorld.y));
      const inside = smoothstep(0, 0.002, min(min(uv.x, uv.y), min(float(1).sub(uv.x), float(1).sub(uv.y))));
      const vis = mix(float(1), v, near.mul(inside));
      return float(1).sub(share.mul(float(1).sub(vis))) as F;
    },
  };
}
