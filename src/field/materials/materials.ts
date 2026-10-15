/**
 * The Field's material set, by slot. Every field part is modelled with these slots and emitted as
 * one mesh per zone with one group per slot (geometry/polyMesh.ts emitParts).
 *
 * A zone's materials share its reflection probe (field/probes.ts): one material set per probe, so
 * a gold flank mirrors what stands around it. The copies drawn into the probes' own captures use a
 * set lit by the Dome's interior capture (one bounce is enough).
 *
 * The star-shade (lighting/starShade.ts) darkens the star's share of the light where the field
 * hides part of the star's 45° cap; it enters as the material's ambient-occlusion term, which
 * scales image-based light only (all light here is image-based).
 */
import { MeshPhysicalNodeMaterial, type Material, type Node } from 'three/webgpu';
import { float, vec3, positionWorld, normalWorldGeometry, fwidth, length, max, abs, fract, mix, smoothstep, uv } from 'three/tsl';
import { createBlackGlazeMaterial, createBronzeMaterial, createCeramicMaterial } from '../../city/materials/ceramic';
import { glowNode } from '../../sky/structure/thermal';
import { fbm3, valueNoise3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';
import { createFoilMaterial, createGoldMaterial, createMirrorMaterial, createSatinGoldMaterial } from './gold';
import { createCladdingMaterial, ZONE_CLADDING } from './cladding';
import type { Zone } from '../layout';

type F = Node<'float'>;

export const FIELD_SLOT = {
  ceramic: 0,
  black: 1,
  bronze: 2,
  gold: 3,
  satin: 4,
  foil: 5,
  steel: 6,
  chrome: 7,
  grating: 8,
  glow: 9,
  alloy: 10,
  mirror: 11,
} as const;
export const FIELD_SLOTS = 12;
export type FieldSlot = (typeof FIELD_SLOT)[keyof typeof FIELD_SLOT];

/** Graphite steel (mechanisms, frames) and chrome (rods, journals): linear F0 and roughness. */
export const STEEL = { f0: vec3(0.34, 0.33, 0.32), rough: 0.36 } as const;
export const CHROME = { f0: vec3(0.72, 0.72, 0.7), rough: 0.1 } as const;

/**
 * Open steel grating (walkways, platforms): 30 mm bars at 40 mm pitch on horizontal faces. Beyond a
 * few metres the bars fade to their mean cover (dark gaps between bright bar tops).
 */
function createGratingMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = positionWorld.xz;
  const fp = max(length(fwidth(p)), 1e-5) as F;
  const top = smoothstep(0.6, 0.8, normalWorldGeometry.y);
  const bars = abs(fract(p.x.div(0.04)).sub(0.5)).mul(0.04);
  const cross = abs(fract(p.y.div(0.1)).sub(0.5)).mul(0.1);
  const gap = float(1).sub(band(bars, 0.0035, fp).max(band(cross, 0.002, fp)));
  const mean = 0.62;
  const open = mix(float(mean), gap, lodFade(fp, 0.03)).mul(top);
  mat.colorNode = mix(STEEL.f0, vec3(0.02), open.mul(0.85));
  mat.roughnessNode = mix(float(0.45), float(0.9), open);
  mat.metalnessNode = float(1).sub(open.mul(0.9));
  return mat;
}

/**
 * Incandescent alloy: the Loom's draw slit and the ribbon leaving it. Temperature falls along u
 * (metres from the slit) from the draw temperature, the glow from Planck's law on the star's
 * radiance scale (sky/structure/thermal.ts): a few percent of the star at the slit.
 */
export const DRAW_TEMPERATURE = 3300;
function createGlowMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const s = uv().x;
  const fp = max(length(fwidth(positionWorld)), 1e-5);
  const flicker = fbm3(positionWorld.mul(2.5), 2, fp.mul(2.5)).sub(0.5).mul(0.03);
  const T = float(DRAW_TEMPERATURE).mul(float(1).add(flicker)).mul(mix(float(1), float(0.5), smoothstep(0, 24, s)));
  mat.colorNode = vec3(0.3, 0.25, 0.2);
  mat.roughnessNode = float(0.35);
  mat.metalnessNode = float(1);
  mat.emissiveNode = glowNode(T);
  return mat;
}

/**
 * The sphere's refractory alloy, drawn as ribbon and wound on the Loom's spool: a dark, warm,
 * polished metal, banded by the wraps (v runs across the coil).
 */
function createAlloyMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5) as F;
  const wrap = valueNoise3(vec3(st.y.mul(9), 0, 7)).sub(0.5).mul(lodFade(fp, 0.12));
  mat.colorNode = vec3(0.3, 0.24, 0.19).mul(float(1).add(wrap.mul(0.25)));
  mat.roughnessNode = float(0.18).add(abs(wrap).mul(0.2));
  mat.metalnessNode = float(1);
  return mat;
}

export interface FieldLook {
  /** Environment for every material of the set (a probe's parallax node), or none (scene.environment). */
  env?: Node;
  /** Star visibility at a world point (0..1) and the star's share of the light: becomes the AO term. */
  shade?: () => F;
}

/** One material per slot, for one zone. */
export function createFieldMaterials(zone: string, look: FieldLook = {}): Material[] {
  const mats: MeshPhysicalNodeMaterial[] = [];
  // The secondary plant is clad in its zone's colour; everything else is the Dome's ceramic.
  const plant = zone.startsWith('plant-') ? (zone.slice(6) as Zone) : null;
  mats[FIELD_SLOT.ceramic] = plant ? createCladdingMaterial(`Field.${zone}.cladding`, ZONE_CLADDING[plant]) : createCeramicMaterial(`Field.${zone}.ceramic`);
  mats[FIELD_SLOT.black] = createBlackGlazeMaterial(`Field.${zone}.black`);
  mats[FIELD_SLOT.bronze] = createBronzeMaterial(`Field.${zone}.bronze`);
  mats[FIELD_SLOT.gold] = createGoldMaterial(`Field.${zone}.gold`);
  mats[FIELD_SLOT.satin] = createSatinGoldMaterial(`Field.${zone}.satin`);
  mats[FIELD_SLOT.foil] = createFoilMaterial(`Field.${zone}.foil`);
  mats[FIELD_SLOT.steel] = createBronzeMaterial(`Field.${zone}.steel`, STEEL.f0, STEEL.rough);
  mats[FIELD_SLOT.chrome] = createBronzeMaterial(`Field.${zone}.chrome`, CHROME.f0, CHROME.rough);
  mats[FIELD_SLOT.grating] = createGratingMaterial(`Field.${zone}.grating`);
  mats[FIELD_SLOT.glow] = createGlowMaterial(`Field.${zone}.glow`);
  mats[FIELD_SLOT.alloy] = createAlloyMaterial(`Field.${zone}.alloy`);
  mats[FIELD_SLOT.mirror] = createMirrorMaterial(`Field.${zone}.mirror`);
  for (const m of mats) {
    if (look.env) m.envNode = look.env;
    if (look.shade) m.aoNode = look.shade();
  }
  return mats;
}
