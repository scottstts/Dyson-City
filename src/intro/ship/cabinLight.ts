/**
 * The cabin's light (docs/intro-ship.md, "Light"): baked in Cycles under the game's own light
 * (blender/ship/bake.py), like the house's rooms. Nothing inside takes the image-based light: the
 * hull would not be there for it (in scene 1 the whole cockpit glowed white with the star the hull
 * hides).
 *
 *  - Diffuse: white-Lambertian radiance from the bake. A face big enough for a chart reads its
 *    lightmap; a fitting reads the light baked at its corners (bake/cabinMesh.ts sets). The scene's
 *    set (scene 1's outside, or the band's at the landing; both with the lamps and the screens) plus
 *    the open door's, × how far it is open. An object's sets are the layers of one texture (as are
 *    the captures'): a texture binding each, within a fragment stage's sixteen.
 *  - Glossy: along a ray that leaves through a pane or the open door, the live outside (the world
 *    moves past the windows; nothing of it is baked); otherwise the cabin's reflection capture,
 *    box-projected in the nearest capture box. Both × a specular occlusion from a baked short-range
 *    AO (Lagarde's fit), so a pocket under the dash does not mirror the cabin at full.
 *    *Rejected:* the house's (the baked diffuse light against the capture's roughest level): here the
 *    bake holds the star through the windshield, the capture none of the outside, and their ratio
 *    printed the sunlit patches into every reflection.
 *
 * Everything is in the game's one radiance scale.
 */
import { DataArrayTexture, Matrix3, Matrix4, Node, RGBFormat, UnsignedInt5999Type, LinearFilter, ClampToEdgeWrapping, type NodeBuilder, type Texture } from 'three/webgpu';
import { asin, atan, attribute, cameraPosition, clamp, dot, exp2, float, floor, int, max, min, mix, normalWorld, normalize, pmremTexture, positionWorld, pow, select, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { CornerAttributes, PolyMesh } from '../../geometry/polyMesh';
import { decodeRGB9E5, levelRect, REFL } from '../../house/reflections';
import { DOOR_OPENING, WINDOWS, openingCover } from './glazing';
import { shipInSpace } from './env';
import { isCabinSlot } from './slots';
import type { BakeObject, CabinBake } from './bake/cabinBake';
import { CABIN_LIGHT, CAPTURE_SETS } from './bake/cabinBake';
import { fingerprint, firstCorner } from './bake/cabinMesh';

type V3 = Node<'vec3'>;
type F = Node<'float'>;
type TexNode = ReturnType<typeof texture>;

/** What the cabin's lighting needs each frame. */
export const cabinState = {
  /** World → ship (the ship's inverse world matrix), and the ship's rotation (ship → world). */
  toShip: uniform(new Matrix4()),
  rotation: uniform(new Matrix3()),
  /** How far the door is open (0..1: the share of its opening uncovered). */
  door: uniform(0),
  /** The lamps' and the screens' own glow, 0..1 (their light in the cabin is baked at full). */
  lamps: uniform(1),
  screens: uniform(1),
};


/** RGB9E5 layers (rows from the first, no flip). */
function arrayTexture(data: Uint32Array, w: number, h: number, layers: number): DataArrayTexture {
  const t = new DataArrayTexture(data, w, h, layers);
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

/** An object's lightmaps: its sets (CABIN_LIGHT order) as layers. */
interface Maps {
  texture: DataArrayTexture;
  node: TexNode;
  door: boolean;
}

/** The scene's layer among the sets (space, band, …). */
const sceneLayer = (): Node<'int'> => int(select(shipInSpace.greaterThan(0.5), float(0), float(1)));

interface EnvContext {
  getUV?: (node: Node, builder: NodeBuilder) => V3;
  getTextureLevel?: (node: Node) => F;
}

export class CabinLight {
  private readonly bake: CabinBake;
  private readonly maps: Record<BakeObject, Maps>;
  /** The captures: per set (CAPTURE_SETS order) a layer per capture. */
  private readonly refl: DataArrayTexture;
  private readonly reflNode: TexNode;

  constructor(bake: CabinBake) {
    this.bake = bake;
    const layers = (sets: readonly string[], get: (set: string) => Uint32Array, size: number) => {
      const data = new Uint32Array(size * sets.length);
      sets.forEach((set, i) => data.set(get(set), i * size));
      return data;
    };
    const maps = (o: BakeObject): Maps => {
      const b = bake.objects[o];
      const t = arrayTexture(layers(b.sets, (s) => b.lm.get(s)!, b.atlas * b.atlas), b.atlas, b.atlas, b.sets.length);
      return { texture: t, node: texture(t), door: b.sets.includes('door') };
    };
    this.maps = { cabin: maps('cabin'), leaf: maps('leaf') };
    const sets = CAPTURE_SETS;
    const size = REFL.atlasW * REFL.atlasH * bake.captures.length;
    this.refl = arrayTexture(layers(sets, (s) => bake.refl.get(s)!, size), REFL.atlasW, REFL.atlasH, sets.length * bake.captures.length);
    this.reflNode = texture(this.refl);
  }

  /** Throws unless the bake was baked on these meshes (the ship changed since: re-run the bake). */
  verify(o: BakeObject, meshes: readonly PolyMesh[]): void {
    const f = fingerprint(meshes, isCabinSlot);
    if (f !== this.bake.fingerprint[o]) throw new Error(`ship cabin bake is stale: the ${o} is ${f}, the bake ${this.bake.fingerprint[o]} (re-run tools/ship-bake)`);
  }

  /**
   * The bake's per-corner values for an object's meshes (emitParts): `cabinUv` (the lightmap UV, or
   * −1 for none) and the corner's own light per set (only where there is no lightmap; zero elsewhere,
   * so lightmapped corners still share vertices).
   */
  corners(o: BakeObject, meshes: readonly PolyMesh[]): CornerAttributes {
    const b = this.bake.objects[o];
    const sets = CABIN_LIGHT[o];
    const size = (s: string) => (s === 'ao' ? 1 : 3);
    const attributes = [{ name: 'cabinUv', size: 2 }, ...sets.map((s) => ({ name: attr(s), size: size(s) }))];
    // Each mesh's faces' first corner in the set (−1: not in it), and their canonical first corner.
    const first = meshes.map((m) => new Int32Array(m.faces.length));
    const start = meshes.map((m) => new Uint16Array(m.faces.length));
    let n = 0;
    meshes.forEach((m, mi) =>
      m.faces.forEach((f, fi) => {
        first[mi][fi] = isCabinSlot(m.faceMat[fi]) ? n : -1;
        start[mi][fi] = firstCorner(m, fi);
        if (first[mi][fi] >= 0) n += f.length;
      }),
    );
    if (n !== b.corners) throw new Error(`ship cabin bake: ${o} has ${n} corners, the bake ${b.corners} (re-run tools/ship-bake)`);
    const out = new Float32Array(attributes.reduce((n, a) => n + a.size, 0));
    const rgb = new Float32Array(3);
    return {
      attributes,
      values(part, face, corner) {
        out.fill(0);
        const k0 = first[part][face];
        if (k0 < 0) {
          out[0] = out[1] = -1;
          return out;
        }
        const len = meshes[part].faces[face].length;
        const k = k0 + ((corner - start[part][face] + len) % len);
        const u = b.uv[k * 2];
        if (u !== 0xffff) {
          out[0] = u / 0xfffe;
          out[1] = b.uv[k * 2 + 1] / 0xfffe;
          return out;
        }
        out[0] = out[1] = -1;
        let o = 2;
        for (const s of sets) {
          decodeRGB9E5(b.vx.get(s)![k], rgb, 0);
          if (s === 'ao') out[o] = rgb[0];
          else out.set(rgb, o);
          o += size(s);
        }
        return out;
      },
    };
  }

  /** 1 where a fragment reads a lightmap (whose bake holds its occlusion): no contact AO there. */
  static lightmapped(): F {
    return attribute('cabinUv', 'vec2').x.greaterThanEqual(0).select(float(1), float(0)) as unknown as F;
  }

  /** A layer of an object's lightmaps at its fragment's lightmap UV. */
  private layer(o: BakeObject, l: Node<'int'>): V3 {
    const m = this.maps[o];
    const uv = attribute('cabinUv', 'vec2');
    return (m.node as unknown as { sample(uv: Node<'vec2'>): { depth(d: Node<'int'>): { rgb: V3 } } }).sample(uv).depth(l).rgb;
  }

  /** The baked diffuse light (white-Lambertian radiance) of an object's fragment. */
  diffuse(o: BakeObject): V3 {
    const m = this.maps[o];
    const lit = attribute('cabinUv', 'vec2').x.greaterThanEqual(0);
    const space = shipInSpace.greaterThan(0.5);
    const corner = select(space, attribute(attr('space'), 'vec3'), attribute(attr('band'), 'vec3'));
    let light = select(lit, this.layer(o, sceneLayer()), corner) as unknown as V3;
    if (m.door) {
      const door = select(lit, this.layer(o, int(CABIN_LIGHT[o].indexOf('door'))), attribute(attr('door'), 'vec3'));
      light = light.add(door.mul(cabinState.door)) as V3;
    }
    return light;
  }

  /** The short-range ambient occlusion baked at an object's fragment. */
  ao(o: BakeObject): F {
    const lit = attribute('cabinUv', 'vec2').x.greaterThanEqual(0);
    return select(lit, this.layer(o, int(CABIN_LIGHT[o].indexOf('ao'))).x, attribute(attr('ao'), 'float')) as unknown as F;
  }

  /** The cabin as its captures see it, from `p` along `d` (ship frame) at roughness level `rough`. */
  reflection(p: V3, d: V3, rough: F): V3 {
    const caps = this.bake.captures;
    // The capture box nearest the point (inside one: the most negative distance).
    let ci: F = float(0);
    let best: F = float(1e9);
    caps.forEach((c, i) => {
      const d3 = max(vec3(...c.min).sub(p), p.sub(vec3(...c.max)));
      const dist = max(max(d3.x, d3.y), d3.z);
      const closer = dist.lessThan(best);
      ci = select(closer, float(i), ci) as F;
      best = select(closer, dist, best) as F;
    });
    const pick = (k: 'min' | 'max' | 'position') => {
      let v = vec3(...caps[0][k]) as unknown as V3;
      for (let i = 1; i < caps.length; i++) v = select(ci.greaterThan(i - 0.5), vec3(...caps[i][k]), v) as unknown as V3;
      return v;
    };
    // Box-projected: where the ray leaves the box, seen from the capture point.
    const safe = (c: F): F => select(c.lessThan(0), min(c, -1e-4), max(c, 1e-4)) as F;
    const rs = vec3(safe(d.x), safe(d.y), safe(d.z));
    const t1 = pick('min').sub(p).div(rs);
    const t2 = pick('max').sub(p).div(rs);
    const tFar = max(t1, t2);
    const t = max(min(min(tFar.x, tFar.y), tFar.z), 0);
    const dir = normalize(p.add(d.mul(t)).sub(pick('position')));
    const n = caps.length;
    const scene = sceneLayer().mul(n).add(int(ci.add(0.5)));
    const door = int(ci.add(0.5)).add(2 * n);
    const level = clamp(rough, 0, 1).mul(REFL.levels - 1);
    const k0 = floor(level);
    const k1 = min(k0.add(1), REFL.levels - 1);
    const at = (k: F) => sampleLevel(this.reflNode, dir, k, scene).add(sampleLevel(this.reflNode, dir, k, door).mul(cabinState.door));
    return mix(at(k0), at(k1), level.sub(k0)) as unknown as V3;
  }

  /** The env node for an object's cabin materials (diffuse from the bake; glossy as the module doc). */
  environment(o: BakeObject, band: Texture, space: Texture): Node {
    return new CabinEnvironmentNode(this, o, band, space);
  }

  /** The cabin's reflection at a world point along a world direction (the canopy's inner faces). */
  reflectionWorld(origin: V3, dir: V3, rough: F): V3 {
    const p = (cabinState.toShip as unknown as Node<'mat4'>).mul(vec4(origin, 1)).xyz as unknown as V3;
    const d = normalize((cabinState.rotation as unknown as Node<'mat3'>).transpose().mul(dir)) as unknown as V3;
    return this.reflection(p, d, rough);
  }

  /**
   * Specular occlusion of an object's fragment from its baked AO (Lagarde & de Rousiers 2014): a
   * rough lobe is occluded about as the hemisphere is, a mirror only at grazing views into a pocket.
   */
  occlusion(o: BakeObject, nDotV: F, roughness: F): F {
    const ao = this.ao(o);
    return clamp(pow(nDotV.add(ao), exp2(roughness.mul(-16).sub(1))).sub(1).add(ao), 0, 1) as unknown as F;
  }

  dispose(): void {
    for (const m of Object.values(this.maps)) m.texture.dispose();
    this.refl.dispose();
  }
}

const attr = (set: string) => `cabin${set[0].toUpperCase()}${set.slice(1)}`;

/** One roughness level of a capture layer (house/reflections.ts atlas layout) toward `dir` (ship frame). */
function sampleLevel(tex: TexNode, dir: V3, k: F, layer: Node<'int'>): V3 {
  // The ship frame is the house's glTF axes: Cycles' equirect u = atan2(z, x)/2π + 0.5, rows from the top.
  const u = atan(dir.z, dir.x).div(2 * Math.PI).add(0.5);
  const v = float(0.5).sub(asin(clamp(dir.y, -1, 1)).div(Math.PI));
  const w = float(REFL.width).div(exp2(k));
  const h = float(REFL.height).div(exp2(k));
  const [, y1] = levelRect(1);
  const x0 = select(k.lessThan(0.5), float(0), float(REFL.width).sub(w.mul(2)));
  const y0 = select(k.lessThan(0.5), float(0), float(y1));
  // Half a texel inside the level's rectangle, so bilinear filtering never reads a neighbour.
  const px = x0.add(clamp(u.mul(w), 0.5, w.sub(0.5)));
  const py = y0.add(clamp(v.mul(h), 0.5, h.sub(0.5)));
  const uv = vec2(px.div(REFL.atlasW), py.div(REFL.atlasH));
  return (tex as unknown as { sample(uv: Node<'vec2'>): { depth(d: Node<'int'>): { rgb: V3 } } }).sample(uv).depth(layer).rgb;
}

class CabinEnvironmentNode extends Node {
  static get type(): string {
    return 'CabinEnvironmentNode';
  }

  private readonly light: CabinLight;
  private readonly object: BakeObject;
  private readonly band: Texture;
  private readonly space: Texture;

  constructor(light: CabinLight, object: BakeObject, band: Texture, space: Texture) {
    super('vec3');
    this.light = light;
    this.object = object;
    this.band = band;
    this.space = space;
  }

  private outside(dir: V3, level: F): V3 {
    const a = pmremTexture(this.band, dir, level) as unknown as V3;
    const b = pmremTexture(this.space, dir, level) as unknown as V3;
    return select(shipInSpace.greaterThan(0.5), b, a) as unknown as V3;
  }

  setup(builder: NodeBuilder): Node {
    const ctx = builder.context as EnvContext;
    const raw = ctx.getUV ? ctx.getUV(this, builder) : (normalWorld as unknown as V3);
    const level = ctx.getTextureLevel ? ctx.getTextureLevel(this) : float(1);
    // Diffuse: the irradiance context asks along the normal itself (three multiplies by π).
    if ((raw as unknown) === (normalWorld as unknown)) return this.light.diffuse(this.object) as unknown as Node;
    const S = cabinState;
    const dir = normalize(raw);
    const p = (S.toShip as unknown as Node<'mat4'>).mul(vec4(positionWorld, 1)).xyz as unknown as V3;
    const rotT = (S.rotation as unknown as Node<'mat3'>).transpose();
    const d = normalize(rotT.mul(dir)) as unknown as V3;
    const n = normalize(rotT.mul(normalWorld)) as unknown as V3;
    // Out through an opening: the live outside; otherwise the cabin's capture. The share of the
    // lobe (its half-width ~ α = roughness²) that leaves through one.
    const spread = max(level.mul(level), 0.01) as unknown as F;
    let out: F = float(0);
    for (const w of WINDOWS) out = out.add(openingCover(w, p, d, spread)) as unknown as F;
    out = min(out.add(openingCover(DOOR_OPENING, p, d, spread).mul(S.door)), 1) as unknown as F;
    const inside = this.light.reflection(p.add(n.mul(0.02)), d, level);
    const seen = mix(inside, this.outside(dir, level), out);
    const nDotV = clamp(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))), 0, 1) as unknown as F;
    return seen.mul(this.light.occlusion(this.object, nDotV, level)) as unknown as Node;
  }
}
