/**
 * The craft in the scene (docs/vehicles.md): the ref's model at CRAFT_SCALE, posed from its
 * flight (flight.ts), its engine cores and burn (plume.ts) following the thrust. Three levels of
 * detail: the craft is seen from beside the pad and as a speck far out on the deck.
 */
import { Group, LOD, Mesh } from 'three/webgpu';
import { BELL_LENGTH, buildCraftModel, CRAFT_ENGINES, CRAFT_SCALE } from './model';
import { createCraftMaterials, type CraftMaterials } from './materials';
import { createPlumes, type Plumes } from './plume';
import { CraftFlight, CRAFT_HALF_SPAN, CRAFT_NOSE, CRAFT_TAIL, CRAFT_UNDER, type LockControl } from './flight';
import type { VehicleLook } from '../materials';
import type { ShadeBox } from '../shade';
import { PAD_HEIGHT } from '../../ground/site';

/** Detail levels: tessellation and the distance (m) from which each is drawn. */
const LEVELS = [
  [1, 0],
  [0.3, 160],
  [0.1, 700],
] as const;

export class Craft {
  readonly group = new Group();
  readonly flight = new CraftFlight();
  readonly materials: CraftMaterials;
  private readonly ship = new Group();
  private readonly plumes: Plumes;
  readonly triangles: number;

  constructor() {
    this.group.name = 'Craft';
    this.materials = createCraftMaterials();
    const lod = new LOD();
    lod.name = 'Craft.hull';
    let tris = 0;
    for (const [level, distance] of LEVELS) {
      const m = buildCraftModel(level);
      if (level === 1) tris = m.triangles;
      const mesh = new Mesh(m.geometry, this.materials.list);
      mesh.name = `Craft.hull.${level}`;
      lod.addLevel(mesh, distance);
    }
    this.triangles = tris;
    this.ship.name = 'Craft.ship';
    this.ship.scale.setScalar(CRAFT_SCALE);
    this.ship.add(lod);
    this.plumes = createPlumes(CRAFT_SCALE);
    this.ship.add(this.plumes.group);
    this.group.add(this.ship);
    this.group.visible = false;
  }

  setLook(look: VehicleLook): void {
    this.materials.setLook(look);
  }

  /** Per frame: flies, poses, burns. `under` is what stands below the hover (flight.ts). */
  update(dt: number, time: number, lock: LockControl, under: (x: number, z: number, r: number) => number): void {
    const f = this.flight;
    f.update(dt, lock, under);
    this.group.visible = f.visible;
    if (!f.visible) return;
    this.group.position.copy(f.position);
    this.group.rotation.set(f.pitch, f.yaw, f.roll, 'YXZ');
    this.group.updateMatrixWorld();
    this.materials.burn.value = f.burn;
    this.plumes.update(f.burn, time);
  }

  /** The craft's shade on the pad (shade.ts): its fuselage and tail, its wings, its halo. */
  shadeBoxes(): ShadeBox[] {
    const f = this.flight;
    if (!f.visible) return [];
    const h = f.position.y - PAD_HEIGHT;
    // Heading of the craft's long axis (the nose's bearing: yaw π/2 faces −x).
    const yaw = f.yaw + Math.PI;
    const S = CRAFT_SCALE;
    const mid = (CRAFT_TAIL - CRAFT_NOSE) / 2;
    const cx = f.position.x - Math.sin(f.yaw) * -mid;
    const cz = f.position.z - Math.cos(f.yaw) * -mid;
    return [
      { x: cx, z: cz, yaw, a: 0.85 * S, b: (CRAFT_NOSE + CRAFT_TAIL) / 2, h: h - 0.6 * S, opacity: 1 },
      { x: f.position.x, z: f.position.z, yaw, a: 2.6 * S, b: 0.75 * S, h: h - 0.1 * S, opacity: 0.85 },
      { x: f.position.x, z: f.position.z, yaw, a: CRAFT_HALF_SPAN, b: 0.25 * S, h: h - 0.2 * S, opacity: 0.3 },
    ];
  }

  /** What the sound hears (audio/sounds/vehicles.ts). */
  readonly audio = {
    craft: this as Craft,
    get visible() {
      return this.craft.flight.visible;
    },
    get burn() {
      return this.craft.flight.burn;
    },
    nozzle(out: [number, number, number], axis: [number, number, number]) {
      const g = this.craft.group;
      // The main nozzle's exit, and the exhaust's way (the ship's +z).
      const e = g.matrixWorld.elements;
      const z = (CRAFT_ENGINES[0].z + BELL_LENGTH) * CRAFT_SCALE;
      out[0] = e[12] + e[8] * z;
      out[1] = e[13] + e[9] * z;
      out[2] = e[14] + e[10] * z;
      axis[0] = e[8];
      axis[1] = e[9];
      axis[2] = e[10];
    },
  };

  /** The foil tip's height over the pad (m), for tests and review. */
  get clearance(): number {
    return this.flight.position.y - CRAFT_UNDER - PAD_HEIGHT;
  }
}
