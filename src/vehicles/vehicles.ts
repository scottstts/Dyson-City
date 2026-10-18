/**
 * The vehicles (docs/vehicles.md, city_plan §6–7): the car, parked on the Gate Court by the
 * estate's gateway and driven by the player anywhere at pad level under the Dome, and the craft,
 * which comes and goes through the East Lock on its own. Built in the environment stage after the
 * field; lit by the probe over the pad (and outside the glass by the open sky); their shade on the
 * pad joins the platform's.
 */
import { Group, type Texture } from 'three/webgpu';
import { float, mix, pmremTexture, positionWorld, smoothstep, dot, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { CollisionWorld } from '../player/collision';
import { parallaxEnvironment } from '../render/parallaxEnv';
import { DOME } from '../city/dome/spec';
import { GATE } from '../city/gate/spec';
import { TERRACE_OUTLINE } from '../estate/layout';
import { FIELD_Y } from '../field/layout';
import type { EastLock } from '../city/eastLock/lock';
import { Car } from './car/car';
import { Craft } from './craft/craft';
import { createVehicleShade, type VehicleShade } from './shade';
import type { FlightPhase } from './craft/flight';

/** Where the car is parked at the start: the Gate Court's north side, west of the estate's gateway, facing the field. */
export const CAR_PARKING = { x: -452, z: -20, yaw: Math.PI / 2 } as const;

export interface Vehicles {
  readonly group: Group;
  readonly car: Car;
  readonly craft: Craft;
  readonly shade: VehicleShade;
  /** Walls only the car meets: the estate's terrace wall, the West Gate's passage. */
  readonly carWalls: CollisionWorld;
  /** Lights both: the probe over the pad (parallax over the compound) and, outside the glass, the open sky. */
  setLook(look: { central: { texture: Texture; centre: [number, number, number]; radius: number }; outdoor: Texture; ao: () => Node<'float'> }): void;
  /**
   * Per frame (after the car has been stepped): flies the craft through the lock, and sets the
   * vehicles' shade. `standing` is a walker on the ground (feet), or null.
   */
  update(dt: number, time: number, standing: { x: number; y: number; z: number } | null): void;
  /** Review (?craft=leg[:seconds]): runs the craft's visit forward to a leg, and that far into it. */
  fastForward(phase: FlightPhase, extra?: number): void;
}

export function buildVehicles(cityWalls: CollisionWorld, lock: EastLock): Vehicles {
  const group = new Group();
  group.name = 'Vehicles';
  const carWalls = new CollisionWorld();
  // The estate is the garden's: the car keeps off its terrace (the walker meets its walls in 3D).
  carWalls.addPolygon(TERRACE_OUTLINE.map(([x, z]) => [x, z]));
  // The West Gate is for walkers: the car never enters its chamber, open or shut.
  carWalls.addSegment(GATE.eastX + 0.5, -GATE.passageHalf - 1, GATE.eastX + 0.5, GATE.passageHalf + 1);
  const car = new Car([cityWalls, carWalls]);
  car.park(CAR_PARKING.x, CAR_PARKING.z, CAR_PARKING.yaw);
  const craft = new Craft();
  group.add(car.group, craft.group);
  const shade = createVehicleShade();
  console.info(`[Dyson] vehicles: car ${car.triangles} tris, craft ${craft.triangles} tris (full detail)`);

  /** The top (world y) of whatever stands within r of a plan point: the car, a walker. */
  let walker: { x: number; y: number; z: number } | null = null;
  const under = (x: number, z: number, r: number): number => {
    let top = -Infinity;
    if (car.distance(x, z) < r) top = Math.max(top, car.top);
    if (walker && Math.hypot(walker.x - x, walker.z - z) < r) top = Math.max(top, walker.y + 1.9);
    return top;
  };
  const lockControl = {
    request: (side: 'outer' | 'inner' | 'closed') => lock.airlock.request(side),
    isOpen: (side: 'outer' | 'inner') => lock.airlock.isOpen(side),
  };

  return {
    group,
    car,
    craft,
    shade,
    carWalls,
    setLook({ central, outdoor, ao }) {
      const field = parallaxEnvironment(central.texture, { centre: central.centre, radius: central.radius, groundY: FIELD_Y });
      car.setLook({ env: field, ao });
      craft.setLook({ env: insideOut(field, outdoor) });
    },
    fastForward(phase, extra) {
      craft.flight.fastForward(phase, { ...lockControl, update: (dt: number) => lock.update(dt) }, under, extra);
    },
    update(dt, time, standing) {
      walker = standing;
      craft.update(dt, time, lockControl, under);
      shade.set([car.shadeBox(), ...craft.shadeBoxes()]);
    },
  };
}

/** Inside the Dome the field's probe, outside it the open sky (the craft flies through the glass's line). */
function insideOut(inside: Node, outdoor: Texture): Node {
  const p = positionWorld.sub(vec3(0, DOME.centreY, 0));
  const q = p.mul(vec3(1 / DOME.a, 1 / DOME.c, 1 / DOME.a));
  const s = dot(q, q);
  const w = smoothstep(float(1.02), float(0.98), s);
  return mix(pmremTexture(outdoor), inside as unknown as Node<'vec3'>, w) as unknown as Node;
}
