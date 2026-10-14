/**
 * The city's structural materials: honed warm-white ceramic composite for the Dome's frame (dressed
 * like stone) and satin bronze for its nodes, glazing bars and fittings.
 *
 * Ceramic. Geometry UVs are metres (u along a member, v around its section), so the members carry
 * real coursing: block joints every ~7.2 m along a member, offset by a fraction per member face so
 * they never line up into rings, as narrow recessed seams. Each block has its own slight tone and
 * honing. Albedo ~0.6: facing the star it burns near white, as intended; the frame reads by its
 * modelling and edges, not its colour. All detail fades to the mean by pixel footprint.
 *
 * Bronze (nodes, sill). A warm satin metal (F0 ≈ 0.8/0.62/0.42) with a faint long-wavelength
 * roughness drift, so large pieces do not read as flat CG metal.
 */
import { MeshPhysicalNodeMaterial, type Node, type Texture } from 'three/webgpu';
import { float, vec3, uv, fwidth, length, max, floor, fract, abs, mix, positionWorld, select, dot, normalWorldGeometry, normalize, clamp, pmremTexture } from 'three/tsl';
import { DOME } from '../dome/spec';
import { hash33, fbm3, valueNoise3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';

/** Honed ceramic body colour (linear). */
export const CERAMIC_ALBEDO = vec3(0.64, 0.61, 0.56);
/** Satin bronze reflectance (linear, metallic). */
export const BRONZE_F0 = vec3(0.8, 0.62, 0.42);

const BLOCK = 7.2;

export function createCeramicMaterial(name = 'City.ceramic'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5).toVar();
  // Blocks along the member; the joint phase steps with the section face (v) so seams stagger.
  const face = floor(st.y.div(0.9));
  const along = st.x.add(fract(face.mul(0.37)).mul(BLOCK));
  const blockId = floor(along.div(BLOCK));
  const local = fract(along.div(BLOCK)).mul(BLOCK);
  const jointDist = max(float(0), abs(local.sub(BLOCK * 0.5)).negate().add(BLOCK * 0.5));
  const joint = band(jointDist, 0.006, fp).mul(select(st.x.greaterThan(0.01), float(1), float(0)));
  const fade = lodFade(fp, 0.6);
  const h = mix(vec3(0.5), hash33(vec3(blockId, face, 7)), fade);
  const wp = positionWorld;
  const grain = valueNoise3(wp.mul(60)).sub(0.5).mul(lodFade(fp, 0.01));
  const cloud = fbm3(wp.mul(0.35), 3, fp.mul(0.35)).sub(0.5);
  const tone = float(0.97).add(h.x.sub(0.5).mul(0.05)).add(cloud.mul(0.05)).add(grain.mul(0.04));
  mat.colorNode = CERAMIC_ALBEDO.mul(tone).mul(float(1).sub(joint.mul(0.45)));
  mat.roughnessNode = float(0.52).add(h.y.sub(0.5).mul(0.08)).add(grain.mul(0.06)).add(joint.mul(0.3));
  mat.metalnessNode = float(0);
  return mat;
}

export function createBronzeMaterial(name = 'City.bronze', f0 = BRONZE_F0, rough = 0.3): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const wp = positionWorld;
  const fp = max(length(fwidth(wp)), 1e-5);
  const drift = fbm3(wp.mul(0.8), 3, fp.mul(0.8)).sub(0.5);
  const fine = valueNoise3(wp.mul(90)).sub(0.5).mul(lodFade(fp, 0.008));
  mat.colorNode = f0.mul(float(0.96).add(drift.mul(0.06)));
  mat.metalnessNode = float(1);
  mat.roughnessNode = float(rough).add(drift.mul(0.08)).add(fine.mul(0.05));
  return mat;
}

/**
 * Environment for parts of the Dome's frame: faces turned out from the glass see the sky outside
 * (and the dark deck below); faces turned in see the interior capture (the pale city below, the sky
 * through the glass). Side faces blend.
 */
export function domeEnvironment(outdoor: Texture, interior: Texture): Node<'vec3'> {
  const n = normalWorldGeometry;
  const p = positionWorld.sub(vec3(0, DOME.centreY, 0));
  const nS = normalize(p.mul(vec3(1 / DOME.a ** 2, 1 / DOME.c ** 2, 1 / DOME.a ** 2)).max(vec3(-1e9, 0, -1e9)));
  const w = clamp(float(0.5).sub(dot(n, nS).mul(0.5)), 0, 1);
  return mix(pmremTexture(outdoor), pmremTexture(interior), w) as unknown as Node<'vec3'>;
}

/**
 * Glazed black ceramic: the frame's linings and binding collars. Near-black body (albedo ~3 %)
 * under a hard glaze, so it reads as deep black against the honed white and takes the sky and the
 * star as a sharp sheen, never as grey paint.
 */
export function createBlackGlazeMaterial(name = 'City.blackGlaze'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const wp = positionWorld;
  const fp = max(length(fwidth(wp)), 1e-5);
  const cloud = fbm3(wp.mul(0.5), 3, fp.mul(0.5)).sub(0.5);
  mat.colorNode = vec3(0.028, 0.027, 0.026).mul(float(1).add(cloud.mul(0.15)));
  mat.roughnessNode = float(0.45);
  mat.metalnessNode = float(0);
  mat.clearcoatNode = float(1);
  mat.clearcoatRoughnessNode = float(0.06).add(cloud.mul(0.03));
  return mat;
}
