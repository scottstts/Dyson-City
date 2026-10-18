/**
 * The craft's materials by slot (craft/model.ts CRAFT_SLOT), from refs/spacecraft.html: its
 * clearcoated ivory, golds, dark metal, glazing and seams, with the ref's fine machining ripple in
 * roughness along the hull. The engine cores glow at their temperature (Planck, on the star's
 * radiance scale: sky/structure/thermal.ts), which follows the burn.
 */
import { DoubleSide, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { color, float, mix, positionLocal, sin, uniform } from 'three/tsl';
import { glowNode } from '../../sky/structure/thermal';
import { CRAFT_SLOT, CRAFT_SLOTS } from './model';
import { applyLook, vehicleLamp, type VehicleLook } from '../materials';

/** Engine core temperature (K): idling and at full burn. */
export const CORE_TEMPERATURE = { idle: 2300, full: 4700 } as const;
/** The halo channel and nose filament (scene units). */
const TRIM_RADIANCE = 2.4;

export interface CraftMaterials {
  readonly list: Material[];
  /** The burn, 0 (idle) … 1 (full): sets the core's temperature. */
  readonly burn: { value: number };
  setLook(look: VehicleLook): void;
}

function physical(name: string, hex: string, metalness: number, rough: number): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ metalness, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.17 });
  m.name = name;
  m.colorNode = color(hex);
  m.roughnessNode = float(rough).add(sin(positionLocal.z.mul(65)).mul(0.008));
  return m;
}

export function createCraftMaterials(): CraftMaterials {
  const S = CRAFT_SLOT;
  const list: Material[] = new Array(CRAFT_SLOTS);
  list[S.ivory] = physical('Craft.ivory', '#eee6d5', 0.33, 0.25);
  list[S.gold] = physical('Craft.gold', '#c99a4b', 0.92, 0.21);
  list[S.paleGold] = physical('Craft.paleGold', '#e6bd73', 0.82, 0.19);
  const dark = physical('Craft.dark', '#201e19', 0.7, 0.31);
  list[S.dark] = dark;
  const glass = physical('Craft.glass', '#17212a', 0.68, 0.13);
  // The ref lightens the glazing toward up- and down-facing normals (a painted light): its mean.
  glass.colorNode = mix(color('#101a23'), color('#56616b'), 0.17);
  list[S.glass] = glass;
  list[S.seam] = physical('Craft.seam', '#8c795b', 0.65, 0.37);
  list[S.glow] = vehicleLamp('Craft.glow', '#ffd796', '#ffcc72', TRIM_RADIANCE).material;
  const burn = uniform(0);
  const core = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.4 });
  core.name = 'Craft.core';
  core.colorNode = color('#fff3ce');
  core.emissiveNode = glowNode(mix(float(CORE_TEMPERATURE.idle), float(CORE_TEMPERATURE.full), burn));
  list[S.core] = core;
  const throat = physical('Craft.throat', '#201e19', 0.7, 0.31);
  throat.side = DoubleSide;
  list[S.throat] = throat;
  return {
    list,
    burn: burn as unknown as { value: number },
    setLook: (look) => applyLook(list as MeshStandardNodeMaterial[], look),
  };
}
