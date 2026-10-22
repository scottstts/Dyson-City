/**
 * Indoors the light is baked (blender/docs/house.md §6; city_plan §4): nothing indoors takes the
 * real-time image-based light. A baked surface's outgoing radiance is
 *
 *   diffuse:  albedo × (1 − metal) × D, with D the white-Lambertian radiance from its lightmap
 *             (the static architecture) or from the probe grid (everything else);
 *   specular: its room's reflection capture, looked up box-projected (parallax-corrected against
 *             the room's box) at its roughness, × the split-sum environment BRDF, × its specular
 *             occlusion.
 *
 * The capture sees the room from its middle, unoccluded; a surface in a pocket (under a stair, behind
 * a wardrobe) does not. Its baked diffuse light knows: specular occlusion is the ratio of that light to
 * the diffuse light the capture would give an open surface facing the same way (the capture's roughest
 * level along the normal), clamped to 1. Open surfaces keep their reflections; the cul-de-sac under the
 * top stair, ~1/300 of what the landing's capture gives, no longer glows with the landing's reflection at grazing
 * angles.
 *
 * Which room's capture a fragment uses is decided per fragment (the room box nearest the point just
 * off its surface), so one merged draw can span every room of a floor. The captures live in one
 * array texture (reflections.ts: a roughness chain per layer).
 *
 * Everything is in the game's one radiance scale: no conversion factors.
 */
import { DataArrayTexture, DataTexture, LinearFilter, RGBFormat, UnsignedInt5999Type, ClampToEdgeWrapping, Matrix4, Vector3, type Texture } from 'three/webgpu';
import { float, int, vec2, vec3, vec4, uniform, uniformArray, texture, positionWorld, cameraPosition, normalize, reflect, dot, max, min, clamp, atan, asin, floor, exp2, mix, select, EnvironmentBRDF } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { REFL } from './reflections';
import type { RoomBox } from './probeGrid';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type ArrayNode = { element(i: number | Node<'int'>): V3 };

/** RGB9E5 texture (rows top first, no flip): the lightmaps. */
export function rgb9e5Texture(data: Uint32Array, width: number, height: number): DataTexture {
  const t = new DataTexture(data, width, height, RGBFormat, UnsignedInt5999Type);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function atlasTexture(data: Uint32Array, layers: number): DataArrayTexture {
  const t = new DataArrayTexture(data, REFL.atlasW, REFL.atlasH, layers);
  t.format = RGBFormat;
  t.type = UnsignedInt5999Type;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const LUMA = vec3(0.2126, 0.7152, 0.0722);
/** Capture level a far window shows (roughness 0.2): one texel of the mirror level per pixel at range. */
const INTERIOR_LEVEL = 1;

/** Blender house frame (x, y, z up) → glTF axes (x, z, −y). */
const toGltf = (p: readonly number[]) => new Vector3(p[0], p[2], -p[1]);

export class BakedLight {
  /** World → house (glTF axes), set when the house is placed. */
  readonly worldToHouse = uniform(new Matrix4());
  /** 1 while the floors are drawn; 0 beyond the interior range, where the window panes show their
   *  rooms' captures (`interiorView`). */
  readonly interiorsDrawn = uniform(1);
  readonly rooms: readonly RoomBox[];
  /** The floors' lightmaps by entry name (LM_G…). */
  readonly lightmaps = new Map<string, Texture>();
  private atlas: DataArrayTexture;
  private readonly atlasNode: ReturnType<typeof texture>;
  private readonly boxMin: ArrayNode;
  private readonly boxMax: ArrayNode;
  private readonly capture: ArrayNode;

  constructor(rooms: readonly RoomBox[]) {
    this.rooms = rooms;
    this.boxMin = uniformArray(rooms.map((r) => toGltf([r.box[0], r.box[4], r.box[2]])), 'vec3') as unknown as ArrayNode;
    this.boxMax = uniformArray(rooms.map((r) => toGltf([r.box[3], r.box[1], r.box[5]])), 'vec3') as unknown as ArrayNode;
    this.capture = uniformArray(rooms.map((r) => toGltf(r.position)), 'vec3') as unknown as ArrayNode;
    // Until the captures are prefiltered: black layers.
    this.atlas = atlasTexture(new Uint32Array(REFL.atlasW * REFL.atlasH * rooms.length), rooms.length);
    this.atlasNode = texture(this.atlas);
  }

  /** Installs the prefiltered captures (one atlas layer per room, in `rooms` order). */
  setAtlas(data: Uint32Array): void {
    const old = this.atlas;
    this.atlas = atlasTexture(data, this.rooms.length);
    (this.atlasNode as unknown as { value: Texture }).value = this.atlas;
    old.dispose();
  }

  dispose(): void {
    this.atlas.dispose();
    for (const t of this.lightmaps.values()) t.dispose();
  }

  /**
   * Outgoing radiance of a baked surface. `diffuseLight` is white-Lambertian radiance (lightmap
   * texel, per-vertex probe light, or SH at the normal); `n` is the shading normal (world).
   */
  radiance(albedo: V3, roughness: F, metalness: F, diffuseLight: V3, n: V3): V3 {
    const m = this.worldToHouse;
    const pos = m.mul(vec4(positionWorld, 1)).xyz;
    const v = normalize(cameraPosition.sub(positionWorld));
    const nW = normalize(n);
    const r = normalize(m.mul(vec4(reflect(v.negate(), nW), 0)).xyz);
    const nH = normalize(m.mul(vec4(nW, 0)).xyz);
    // The room: the box nearest the point just off the surface; the reflected ray box-projected in it.
    const ri = this.roomAt(pos.add(nH.mul(0.1)));
    const [u, tv] = this.projected(pos, r, ri);
    const level = clamp(roughness, 0, 1).mul(REFL.levels - 1);
    const k0 = floor(level);
    const env = mix(this.sampleLevel(u, tv, k0, ri), this.sampleLevel(u, tv, min(k0.add(1), REFL.levels - 1), ri), level.sub(k0));
    // Specular occlusion: the baked diffuse light against what the capture gives an open surface facing nH.
    const open = this.sampleLevel(atan(nH.z, nH.x).div(2 * Math.PI).add(0.5), float(0.5).sub(asin(clamp(nH.y, -1, 1)).div(Math.PI)), float(REFL.levels - 1), ri);
    const occlusion = clamp(dot(diffuseLight, LUMA).div(max(dot(open, LUMA), 1e-7)), 0, 1);
    const dotNV = clamp(dot(nW, v), 1e-4, 1);
    const f0 = mix(vec3(0.04), albedo, metalness);
    const brdf = EnvironmentBRDF({ dotNV, specularColor: f0, specularF90: float(1), roughness: max(roughness, 0.03) }) as unknown as V3;
    return albedo.mul(float(1).sub(metalness)).mul(diffuseLight).add(env.mul(brdf).mul(occlusion)) as V3;
  }

  /**
   * What a window pane shows of its room while the floors are not drawn (beyond the house's interior
   * range): the view ray through the pane, box-projected in the room behind it, looked up in that
   * room's capture. The capture is the baked room in the same light as the floors, so the windows
   * keep their look when the floors come in (a pane over the empty shell showed the sky through the
   * house, then the dark rooms: a jump at the range).
   */
  interiorView(): V3 {
    const m = this.worldToHouse;
    const pos = m.mul(vec4(positionWorld, 1)).xyz;
    const d = normalize(m.mul(vec4(positionWorld.sub(cameraPosition), 0)).xyz);
    const ri = this.roomAt(pos.add(d.mul(0.3)));
    const [u, v] = this.projected(pos, d, ri);
    return this.sampleLevel(u, v, float(INTERIOR_LEVEL), ri);
  }

  /** The room whose box is nearest a point (house frame; inside a box: the most negative distance). */
  private roomAt(q: V3): Node<'int'> {
    let room: F = float(0);
    let best: F = float(1e9);
    for (let i = 0; i < this.rooms.length; i++) {
      const d3 = max(this.boxMin.element(i).sub(q), q.sub(this.boxMax.element(i)));
      const d = max(max(d3.x, d3.y), d3.z);
      const closer = d.lessThan(best);
      room = select(closer, float(i), room) as F;
      best = select(closer, d, best) as F;
    }
    return int(room.add(0.5));
  }

  /** Equirect (u, v) of the capture for a ray from `pos` along `r` (house frame), box-projected:
   *  where the ray leaves the room's box, seen from the capture point. */
  private projected(pos: V3, r: V3, ri: Node<'int'>): [F, F] {
    const safe = (c: F): F => select(c.lessThan(0), min(c, -1e-4), max(c, 1e-4)) as F;
    const rs = vec3(safe(r.x), safe(r.y), safe(r.z));
    const t1 = this.boxMin.element(ri).sub(pos).div(rs);
    const t2 = this.boxMax.element(ri).sub(pos).div(rs);
    const tFar = max(t1, t2);
    const t = max(min(min(tFar.x, tFar.y), tFar.z), 0);
    const dir = normalize(pos.add(r.mul(t)).sub(this.capture.element(ri)));
    // In Blender axes (x, −z, y), Cycles' equirect mapping: u = −atan2(y, x)/2π + 0.5, rows from the top.
    return [atan(dir.z, dir.x).div(2 * Math.PI).add(0.5) as F, float(0.5).sub(asin(clamp(dir.y, -1, 1)).div(Math.PI)) as F];
  }

  /** One roughness level of a room's capture (atlas layout: reflections.ts levelRect). */
  private sampleLevel(u: F, v: F, k: F, layer: Node<'int'>): V3 {
    const w = float(REFL.width).div(exp2(k));
    const h = float(REFL.height).div(exp2(k));
    const x0 = select(k.lessThan(0.5), float(0), float(REFL.width).sub(w.mul(2)));
    const y0 = select(k.lessThan(0.5), float(0), float(REFL.height));
    // Half a texel inside the level's rectangle, so bilinear filtering never reads a neighbour.
    const px = x0.add(clamp(u.mul(w), 0.5, w.sub(0.5)));
    const py = y0.add(clamp(v.mul(h), 0.5, h.sub(0.5)));
    const uv = vec2(px.div(REFL.atlasW), py.div(REFL.atlasH));
    return (this.atlasNode as unknown as { sample(uv: Node<'vec2'>): { depth(d: Node<'int'>): { rgb: V3 } } }).sample(uv).depth(layer).rgb;
  }
}
