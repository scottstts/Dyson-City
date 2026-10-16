/**
 * The house's materials, built from the exported glTF materials (blender/docs/house.md §7) for each
 * lighting kind (compile.ts):
 *
 *  - `exterior`: physical PBR lit like everything outdoors (the image-based light, the estate's
 *    probe and the star-shade, set by `HouseLook`);
 *  - `lightmap` / `probe`: baked (bakedLight.ts); unlit node materials whose output is the baked
 *    radiance;
 *  - `mixed`: physical PBR whose image-based light is switched off on faces looking into a room,
 *    where the baked radiance is emitted instead;
 *  - door leaves: baked, their diffuse light from SH at the leaf (it swings between rooms).
 *
 * Glass is a thin pane (a window, a jar, a lantern): no refraction offset. It is drawn in two
 * passes over the same geometry: a multiply by its transmittance (per channel, so tinted and
 * stained glass colour what is behind) and an add of its Fresnel reflection. Neither pass touches
 * the normal or velocity targets.
 */
import { AddEquation, CustomBlending, DoubleSide, FrontSide, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, NormalBlending, OneFactor, SrcColorFactor, ZeroFactor, type Material, type Node, type Texture } from 'three/webgpu';
import { attribute, float, vec2, vec3, vec4, uv, texture, normalMap, normalWorld, mrt, uniformArray, positionWorld, cameraPosition, normalize, dot, pow, clamp, mix, max, reflect, pmremTexture } from 'three/tsl';
import { Vector3 } from 'three/webgpu';
import type { GltfDocument, GltfMaterial, GltfTextureInfo } from './gltf';
import type { HouseTextures } from './textures';
import type { BakedLight } from './bakedLight';
import type { LightKind } from './compile';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** How the outdoors lights the exterior: an environment (the estate's probe) and the star-shade. */
export interface HouseLook {
  env?: Node;
  /** Environment texture for glass reflections outdoors (a cube capture, prefiltered here). */
  envTexture?: Texture;
  shade?: () => F;
}

export interface MaterialContext {
  /** Glass reflection lookups of the outdoors: re-pointed when the outdoor capture changes. */
  glassEnvs: { value: Texture | null }[];
  doc: GltfDocument;
  textures: HouseTextures;
  baked: BakedLight;
  look: HouseLook;
  lightmaps: Map<string, Texture>;
}

export type GlassPass = 'multiply' | 'reflect';

/**
 * Lit lamps (the lamps are on: the re-bake lights the rooms with them, docs/house.md): a fabric
 * shade glows at ~3,000 cd/m², a lantern's glass round its flame at ~12,000 cd/m², on the game's
 * scale (a sunlit white wall, ~31,800 cd/m², is 2.0). Warm, as incandescent light through cloth.
 */
export const LAMP_GLOW: Record<string, { radiance: number; colour: [number, number, number] }> = {
  lampshade: { radiance: 0.19, colour: [1.0, 0.72, 0.42] },
  lamp_glass: { radiance: 0.75, colour: [1.0, 0.78, 0.5] },
};

function glowOf(name: string | undefined): V3 | null {
  for (const [k, g] of Object.entries(LAMP_GLOW)) if (name?.startsWith(k)) return vec3(...g.colour).mul(g.radiance) as V3;
  return null;
}

interface Surface {
  albedo: V3;
  alpha: F;
  roughness: F;
  metalness: F;
  normal: V3 | null;
  /** Transmission (KHR_materials_transmission): glass. */
  transmission: number;
  transmissionMap: F | null;
  ior: number;
  doubleSided: boolean;
  blend: boolean;
}

async function sampled(ctx: MaterialContext, info: GltfTextureInfo, colour: boolean): Promise<Node<'vec4'>> {
  const doc = ctx.doc;
  const tex = doc.textures![info.index];
  const img = doc.images![tex.source];
  const t = await ctx.textures.get(img.uri, colour);
  const tr = info.extensions?.KHR_texture_transform;
  let st: Node<'vec2'> = uv(tr?.texCoord ?? info.texCoord ?? 0);
  if (tr) {
    // glTF: uv' = offset + rotate(rotation) · (scale ⊙ uv).
    if (tr.scale) st = st.mul(vec2(tr.scale[0], tr.scale[1]));
    if (tr.rotation) {
      const c = Math.cos(tr.rotation);
      const s = Math.sin(tr.rotation);
      st = vec2(st.x.mul(c).add(st.y.mul(s)), st.y.mul(c).sub(st.x.mul(s)));
    }
    if (tr.offset) st = st.add(vec2(tr.offset[0], tr.offset[1]));
  }
  return texture(t, st) as unknown as Node<'vec4'>;
}

async function surface(ctx: MaterialContext, m: GltfMaterial): Promise<Surface> {
  const pbr = m.pbrMetallicRoughness ?? {};
  const bc = pbr.baseColorFactor ?? [1, 1, 1, 1];
  let albedo: V3 = vec3(bc[0], bc[1], bc[2]);
  let alpha: F = float(bc[3]);
  if (pbr.baseColorTexture) {
    const t = await sampled(ctx, pbr.baseColorTexture, true);
    albedo = albedo.mul(t.rgb) as V3;
    alpha = alpha.mul(t.a) as F;
  }
  let roughness: F = float(pbr.roughnessFactor ?? 1);
  let metalness: F = float(pbr.metallicFactor ?? 1);
  if (pbr.metallicRoughnessTexture) {
    const t = await sampled(ctx, pbr.metallicRoughnessTexture, false);
    roughness = roughness.mul(t.g) as F;
    metalness = metalness.mul(t.b) as F;
  }
  let normal: V3 | null = null;
  if (m.normalTexture) {
    const t = await sampled(ctx, m.normalTexture, false);
    const s = m.normalTexture.scale ?? 1;
    normal = normalMap(t.rgb, vec2(s, s)) as unknown as V3;
  }
  const tr = m.extensions?.KHR_materials_transmission;
  let transmissionMap: F | null = null;
  if (tr?.transmissionTexture) transmissionMap = (await sampled(ctx, tr.transmissionTexture, false)).r as F;
  return {
    albedo,
    alpha,
    roughness,
    metalness,
    normal,
    transmission: tr?.transmissionFactor ?? 0,
    transmissionMap,
    ior: m.extensions?.KHR_materials_ior?.ior ?? 1.5,
    doubleSided: !!m.doubleSided,
    blend: m.alphaMode === 'BLEND',
  };
}

/** Is this glTF material glass (drawn as a thin pane in two passes)? */
export function isGlass(m: GltfMaterial): boolean {
  return (m.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0) > 0;
}

/** SH L2 diffuse (white-Lambertian radiance) for a house-frame glTF normal; c: 9 RGB coefficients (Blender frame). */
function shDiffuseNode(c: { element(i: number): V3 }, n: V3): V3 {
  // glTF → Blender axes.
  const x = n.x;
  const y = n.z.negate();
  const z = n.y;
  const k = 2 * 0.429043;
  const terms: [number, F | number][] = [
    [0, 0.886227],
    [1, y.mul(2 * 0.511664) as F],
    [2, z.mul(2 * 0.511664) as F],
    [3, x.mul(2 * 0.511664) as F],
    [4, x.mul(y).mul(k) as F],
    [5, y.mul(z).mul(k) as F],
    [6, z.mul(z).mul(0.743125).sub(0.247708) as F],
    [7, x.mul(z).mul(k) as F],
    [8, x.mul(x).sub(y.mul(y)).mul(0.429043) as F],
  ];
  let e: V3 = vec3(0);
  for (const [i, w] of terms) e = e.add(c.element(i).mul(w)) as V3;
  return max(e, vec3(0)).div(Math.PI) as V3;
}

/** Diffuse light of a baked surface for its kind. */
function diffuseLight(ctx: MaterialContext, kind: LightKind, lightmap: string | null, sh: Float32Array | null): V3 {
  if (sh) {
    const arr = uniformArray(Array.from({ length: 9 }, (_, i) => new Vector3(sh[i * 3], sh[i * 3 + 1], sh[i * 3 + 2])), 'vec3') as unknown as { element(i: number): V3 };
    const nH = normalize(ctx.baked.worldToHouse.mul(vec4(normalWorld, 0)).xyz);
    return shDiffuseNode(arr, nH);
  }
  if (kind === 'lightmap') {
    const lm = ctx.lightmaps.get(lightmap ?? '');
    if (!lm) throw new Error(`house: missing lightmap ${lightmap}`);
    return texture(lm, uv(1)).rgb as V3;
  }
  return attribute('bakedLight', 'vec3') as unknown as V3;
}

export interface BuiltMaterial {
  material: Material;
  /** Glass: the second pass (its Fresnel reflection), drawn over the first (transmittance). */
  reflect?: Material;
}

/**
 * Builds the material for one glTF material in one lighting kind. `sh` (door leaves): SH at the
 * leaf, used in place of per-vertex probe light.
 */
export async function buildMaterial(ctx: MaterialContext, index: number, kind: LightKind, lightmap: string | null, sh: Float32Array | null = null): Promise<BuiltMaterial> {
  const gm = ctx.doc.materials[index];
  const s = await surface(ctx, gm);
  const name = `House.${gm.name ?? index}.${kind}`;
  const side = s.doubleSided ? DoubleSide : FrontSide;

  if (s.transmission > 0) return glass(ctx, s, kind, name, side, sh, glowOf(gm.name));

  if (kind === 'exterior' || kind === 'mixed') {
    const mat = new MeshPhysicalNodeMaterial();
    const glowX = glowOf(gm.name);
    mat.name = name;
    mat.colorNode = s.albedo;
    mat.roughnessNode = s.roughness;
    mat.metalnessNode = s.metalness;
    if (s.normal) mat.normalNode = s.normal;
    mat.side = side;
    applyLook(mat, ctx.look, kind === 'mixed' ? (attribute('indoor', 'float') as unknown as F) : null);
    if (kind === 'mixed') {
      const indoor = attribute('indoor', 'float') as unknown as F;
      const d = sh ? diffuseLight(ctx, 'probe', null, sh) : (attribute('bakedLight', 'vec3') as unknown as V3);
      mat.emissiveNode = ctx.baked.radiance(s.albedo, s.roughness, s.metalness, d, normalWorld as unknown as V3).mul(indoor);
    }
    if (glowX) mat.emissiveNode = mat.emissiveNode ? (mat.emissiveNode as V3).add(glowX) : glowX;
    return { material: mat };
  }

  const mat = new MeshBasicNodeMaterial();
  mat.name = name;
  mat.lights = false;
  mat.side = side;
  if (s.normal) mat.normalNode = s.normal;
  const lit = ctx.baked.radiance(s.albedo, s.roughness, s.metalness, diffuseLight(ctx, kind, lightmap, sh), normalWorld as unknown as V3);
  const glow = glowOf(gm.name);
  const radiance = glow ? lit.add(glow) : lit;
  if (s.blend) {
    // The lace sheers: alpha-blended over the room behind.
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = NormalBlending;
    mat.outputNode = vec4(radiance, s.alpha);
  } else {
    mat.outputNode = vec4(radiance, 1);
  }
  return { material: mat };
}

/** Sets an exterior material's environment and its star-shade; `indoor` switches both off indoors. */
export function applyLook(mat: MeshPhysicalNodeMaterial, look: HouseLook, indoor: F | null): void {
  if (look.env) mat.envNode = look.env;
  let ao: F | null = look.shade ? look.shade() : null;
  if (indoor) ao = (ao ?? float(1)).mul(float(1).sub(indoor)) as F;
  mat.aoNode = ao;
  mat.needsUpdate = true;
}

/** Schlick Fresnel of a dielectric at the view angle. */
function fresnel(ior: number, n: V3): F {
  const f0 = ((ior - 1) / (ior + 1)) ** 2;
  const v = normalize(cameraPosition.sub(positionWorld));
  const c = clamp(dot(normalize(n), v).abs(), 0, 1);
  return float(f0).add(float(1 - f0).mul(pow(float(1).sub(c), 5))) as F;
}

function glass(ctx: MaterialContext, s: Surface, kind: LightKind, name: string, side: typeof FrontSide | typeof DoubleSide, sh: Float32Array | null, glow: V3 | null): BuiltMaterial {
  const n = normalWorld as unknown as V3;
  const F = fresnel(s.ior, n);
  // One face of a pane: what it does not reflect it passes, coloured by the glass (the transmission
  // map lets the stained glass's leading block it).
  const passes = s.transmissionMap ? s.transmissionMap.mul(s.transmission) : float(s.transmission);
  const tint = mix(vec3(1), s.albedo, passes);
  const T = tint.mul(float(1).sub(F)).mul(passes).add(vec3(1).sub(vec3(passes)).mul(0));
  const multiply = new MeshBasicNodeMaterial();
  multiply.name = `${name}.transmit`;
  multiply.lights = false;
  multiply.transparent = true;
  multiply.depthWrite = false;
  multiply.side = side;
  multiply.blending = CustomBlending;
  multiply.blendEquation = AddEquation;
  multiply.blendSrc = ZeroFactor;
  multiply.blendDst = SrcColorFactor;
  multiply.blendSrcAlpha = ZeroFactor;
  multiply.blendDstAlpha = OneFactor;
  multiply.outputNode = vec4(T, 1);
  multiply.mrtNode = mrt({ normal: vec4(1), velocity: vec4(1) });

  // Reflection: outdoors the estate's environment, indoors the room's capture.
  const rough = s.roughness;
  const v = normalize(cameraPosition.sub(positionWorld));
  const r = reflect(v.negate(), normalize(n));
  let outdoorEnv: V3 = vec3(0);
  if (ctx.look.envTexture) {
    const env = pmremTexture(ctx.look.envTexture, r, rough);
    ctx.glassEnvs.push(env as unknown as { value: Texture | null });
    outdoorEnv = env as unknown as V3;
  }
  const d = sh ? diffuseLight(ctx, 'probe', null, sh) : kind === 'probe' || kind === 'mixed' ? (attribute('bakedLight', 'vec3') as unknown as V3) : vec3(0);
  // The baked capture's specular term is the reflection (no diffuse: albedo 0, F0 from the IOR).
  const indoorEnv = ctx.baked.radiance(vec3(0), rough, float(0), d, n);
  const indoorWeight: F = kind === 'mixed' ? (attribute('indoor', 'float') as unknown as F) : kind === 'exterior' ? float(0) : float(1);
  const reflected0 = mix(outdoorEnv.mul(F), indoorEnv, indoorWeight);
  // A lit lantern's glass glows with the flame behind it.
  const reflected = glow ? reflected0.add(glow) : reflected0;
  const add = new MeshBasicNodeMaterial();
  add.name = `${name}.reflect`;
  add.lights = false;
  add.transparent = true;
  add.depthWrite = false;
  add.side = side;
  add.blending = CustomBlending;
  add.blendEquation = AddEquation;
  add.blendSrc = OneFactor;
  add.blendDst = OneFactor;
  add.blendSrcAlpha = ZeroFactor;
  add.blendDstAlpha = OneFactor;
  add.outputNode = vec4(reflected, 1);
  add.mrtNode = mrt({ normal: vec4(0), velocity: vec4(0) });
  return { material: multiply, reflect: add };
}
