/**
 * The estate's built material set by slot (walls, buildings, garden furniture), emitted like the
 * field's: one mesh per group of parts with a geometry group per slot.
 */
import { MeshPhysicalNodeMaterial, type Material, type Node } from 'three/webgpu';
import { float, vec3, positionWorld, fwidth, length, max } from 'three/tsl';
import { fbm3, valueNoise3 } from '../../render/tsl/noise';
import { lodFade } from '../../render/tsl/patterns';
import { createAshlarMaterial, createLimestoneMaterial } from './stone';
import { createBrickWallMaterial, createClapboardMaterial, createSlateMaterial } from './building';

type F = Node<'float'>;

export const ESTATE_SLOT = {
  sandstone: 0,
  limestone: 1,
  /** Wrought and cast iron, painted black. */
  iron: 2,
  brick: 3,
  /** Painted timber (cream, like the house's trim). */
  paint: 4,
  slate: 5,
  lead: 6,
  /** Weathered oak (benches, doors). */
  oak: 7,
  copper: 8,
  /** Painted timber, the house's door colour (the carriage doors). */
  green: 9,
  /** Painted clapboard in the house's pale blue. */
  siding: 10,
} as const;
export const ESTATE_SLOTS = 11;

function painted(name: string, albedo: [number, number, number], rough: number, metal = 0): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const wp = positionWorld;
  const fp = max(length(fwidth(wp)), 1e-5) as F;
  const drift = fbm3(wp.mul(1.7), 3, fp.mul(1.7)).sub(0.5);
  const fine = valueNoise3(wp.mul(120)).sub(0.5).mul(lodFade(fp, 0.01));
  mat.colorNode = vec3(...albedo).mul(float(1).add(drift.mul(0.06)).add(fine.mul(0.03)));
  mat.roughnessNode = float(rough).add(drift.mul(0.08)).add(fine.mul(0.05));
  mat.metalnessNode = float(metal);
  return mat;
}

export interface EstateLook {
  env?: Node;
  /** The environment as a texture (the foliage's light from above). */
  envTexture?: import('three/webgpu').Texture;
  shade?: () => F;
}

export function createEstateMaterials(group: string, look: EstateLook = {}): Material[] {
  const mats: MeshPhysicalNodeMaterial[] = [];
  mats[ESTATE_SLOT.sandstone] = createAshlarMaterial(`Estate.${group}.sandstone`);
  mats[ESTATE_SLOT.limestone] = createLimestoneMaterial(`Estate.${group}.limestone`);
  mats[ESTATE_SLOT.iron] = painted(`Estate.${group}.iron`, [0.022, 0.022, 0.024], 0.42);
  mats[ESTATE_SLOT.brick] = createBrickWallMaterial(`Estate.${group}.brick`);
  mats[ESTATE_SLOT.paint] = painted(`Estate.${group}.paint`, [0.7, 0.65, 0.53], 0.4);
  mats[ESTATE_SLOT.slate] = createSlateMaterial(`Estate.${group}.slate`);
  mats[ESTATE_SLOT.lead] = painted(`Estate.${group}.lead`, [0.2, 0.21, 0.22], 0.55, 0.6);
  mats[ESTATE_SLOT.oak] = painted(`Estate.${group}.oak`, [0.22, 0.17, 0.12], 0.7);
  mats[ESTATE_SLOT.copper] = painted(`Estate.${group}.copper`, [0.26, 0.48, 0.4], 0.6, 0.2);
  mats[ESTATE_SLOT.green] = painted(`Estate.${group}.green`, [0.27, 0.36, 0.44], 0.32);
  mats[ESTATE_SLOT.siding] = createClapboardMaterial(`Estate.${group}.siding`);
  for (const m of mats) {
    if (look.env) m.envNode = look.env;
    if (look.shade) m.aoNode = look.shade();
  }
  return mats;
}
