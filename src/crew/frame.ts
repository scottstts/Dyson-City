/**
 * What the crew is told of the world each frame (crew.ts, CrewFrame): the walker, the car, when the
 * craft comes in, and the eye.
 */
import type { Vector3 } from 'three/webgpu';
import type { Vehicles } from '../vehicles/vehicles';
import { CAR_FOOTPRINT } from '../vehicles/car/collision';
import type { CrewFrame } from './crew';

/** One frame's record, refilled in place. */
export class CrewFrameSource {
  private readonly frame: CrewFrame;
  private readonly car = { x: 0, z: 0, heading: 0, hl: CAR_FOOTPRINT.halfLength, hw: CAR_FOOTPRINT.halfWidth };

  constructor(eye: Vector3) {
    this.frame = { feet: null, car: null, craftWindow: Infinity, eye };
  }

  /** `feet`: the walker's, or null while they drive (the car is then the one to keep clear of). */
  at(feet: Vector3 | null, vehicles: Vehicles): CrewFrame {
    const f = this.frame;
    const s = vehicles.car.state;
    // The car, parked or driven: its footprint's centre.
    this.car.x = s.x + Math.sin(s.yaw) * CAR_FOOTPRINT.centreZ;
    this.car.z = s.z + Math.cos(s.yaw) * CAR_FOOTPRINT.centreZ;
    this.car.heading = s.yaw;
    f.feet = feet;
    f.car = this.car;
    f.craftWindow = vehicles.craft.flight.untilInside();
    return f;
  }
}
