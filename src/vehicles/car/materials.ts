/**
 * The car's materials by slot (car/model.ts CAR_SLOT), from refs/car.html's material set. Its lamps
 * follow the car's state: dark while it stands unpowered, waking when the driver gets in; the tail
 * lamps brighten under braking.
 */
import { FrontSide, MeshPhysicalNodeMaterial, type Material, type MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, uniform } from 'three/tsl';
import { CAR_SLOT, CAR_SLOTS } from './model';
import { applyLook, paneTargets, vehicleLamp, vehicleMetal, vehicleStandard, type VehicleLook } from '../materials';

/** Lamp radiances (scene units): the luminous trim, the white running lamps, the tail lamps lit and braking. */
export const CAR_LAMP = { trim: 2.6, running: 4.0, tail: 2.2, brake: 6.5 } as const;

export interface CarMaterials {
  readonly list: Material[];
  /** Lamp levels: trim and running lamps (0 unpowered … 1), the tail lamps (radiance multiplier). */
  readonly power: { value: number };
  readonly tail: { value: number };
  setLook(look: VehicleLook): void;
}

export function createCarMaterials(): CarMaterials {
  const S = CAR_SLOT;
  const list: Material[] = new Array(CAR_SLOTS);
  list[S.gold] = vehicleMetal('Car.gold', '#dca64d', 0.23);
  list[S.paleGold] = vehicleMetal('Car.paleGold', '#e4be7e', 0.16);
  list[S.darkGold] = vehicleMetal('Car.darkGold', '#71502a', 0.28);
  // The ref tints its porcelain by the normal (#d4cfc3 below to #fffaf0 above): the light does that
  // here, so the glaze takes the tint's mean over the body's faces.
  const porcelain = new MeshPhysicalNodeMaterial({ metalness: 0.23, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12 });
  porcelain.name = 'Car.porcelain';
  porcelain.colorNode = mix(color('#d4cfc3'), color('#fffaf0'), 0.82);
  list[S.porcelain] = porcelain;
  list[S.black] = vehicleStandard('Car.black', '#191b1c', 0.65, 0.32);
  list[S.titanium] = vehicleMetal('Car.titanium', '#878a87', 0.29);
  list[S.rubber] = vehicleStandard('Car.rubber', '#403b32', 0.12, 0.46);
  // Smoked canopy: 12 % through, the ref's dark cast deepening up the glass (one layer: front faces).
  const glass = new MeshPhysicalNodeMaterial({ metalness: 0.45, roughness: 0.13, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.88, side: FrontSide, depthWrite: false });
  glass.name = 'Car.glass';
  glass.colorNode = mix(color('#302c29'), color('#101d22'), 0.5);
  paneTargets(glass);
  list[S.glass] = glass;
  const power = uniform(0);
  const tail = uniform(0);
  list[S.glow] = vehicleLamp('Car.glow', '#ffdf8a', '#ffb92e', CAR_LAMP.trim, power).material;
  list[S.whiteGlow] = vehicleLamp('Car.whiteGlow', '#fff8da', '#ffde8b', CAR_LAMP.running, power).material;
  list[S.tail] = vehicleLamp('Car.tail', '#ffdf8a', '#ff7a2e', 1, tail).material;
  return {
    list,
    power: power as unknown as { value: number },
    tail: tail as unknown as { value: number },
    setLook: (look) => applyLook(list as MeshStandardNodeMaterial[], look),
  };
}
