/**
 * The third-person camera behind the car (docs/vehicles.md, "Camera").
 *
 *  - It rides behind the car, its heading a critically damped spring on the car's (so it swings
 *    a little wide into a turn and settles), drawn back a little with speed and by acceleration
 *    (the car pulls away from it under power, closes on it under braking).
 *  - The mouse orbits it round the car. As soon as the mouse is still, it eases back behind.
 *  - Walls between the car and it pull it in (fast), and it lets out again slowly; it never goes
 *    below a head's height over the pad.
 */
import { MathUtils, Quaternion, Vector3, type Camera, Matrix4 } from 'three/webgpu';
import { PAD_HEIGHT } from '../../ground/site';
import type { CollisionWorld } from '../../player/collision';
import type { CarState } from './dynamics';
import { CAR_PHYSICS } from './dynamics';

export const CHASE = {
  /** Distance behind the car's centre (m) at rest and added at top speed. */
  distance: 9.2,
  distanceAtSpeed: 2.4,
  /** Height of the point it looks over (m above the pad), and its default elevation (rad). */
  pivotY: 1.45,
  pitch: 0.16,
  /** Pitch limits under the mouse (rad). */
  pitchMin: -0.05,
  pitchMax: 1.1,
  /** Heading spring's natural frequency (rad/s). */
  follow: 4.2,
  /** Mouse radians per pixel. */
  look: 0.0032,
  /** Stillness (s) before it returns behind, and its time constant (s). */
  idle: 0.25,
  recentre: 0.45,
  /** Lag (m) per m/s² of acceleration, and its time constant (s). */
  lag: 0.07,
  lagTc: 0.35,
  /** Closest it is pulled in to (m), and its in/out time constants (s). */
  minDistance: 2.6,
  pullIn: 0.05,
  letOut: 0.5,
} as const;

/** Wraps an angle to (−π, π]. */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

export class ChaseCamera {
  private heading = 0;
  private headingRate = 0;
  private orbitYaw = 0;
  private orbitPitch: number = CHASE.pitch;
  private still = 1;
  private lag = 0;
  private reach: number = CHASE.distance;
  private readonly seen = new Set<object>();
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  private readonly target = new Vector3();
  private readonly ahead = new Vector3();
  private readonly m = new Matrix4();
  private readonly up = new Vector3(0, 1, 0);

  /** Puts it straight behind the car. */
  reset(s: CarState): void {
    this.heading = s.yaw;
    this.headingRate = 0;
    this.orbitYaw = 0;
    this.orbitPitch = CHASE.pitch;
    this.lag = 0;
    this.reach = CHASE.distance;
  }

  /** Mouse movement this frame (px), the car, and the walls the camera keeps out of. */
  update(dt: number, look: [number, number], s: CarState, walls: readonly CollisionWorld[]): void {
    const [dx, dy] = look;
    const moved = dx !== 0 || dy !== 0;
    if (moved) {
      this.orbitYaw = wrap(this.orbitYaw - dx * CHASE.look);
      this.orbitPitch = MathUtils.clamp(this.orbitPitch + dy * CHASE.look, CHASE.pitchMin, CHASE.pitchMax);
      this.still = 0;
    } else this.still += dt;
    if (this.still > CHASE.idle) {
      const k = 1 - Math.exp(-dt / CHASE.recentre);
      this.orbitYaw += (0 - this.orbitYaw) * k;
      this.orbitPitch += (CHASE.pitch - this.orbitPitch) * k;
    }
    // Heading: a critically damped spring on the car's.
    const w = CHASE.follow;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const err = wrap(s.yaw - this.heading);
      this.headingRate += (w * w * err - 2 * w * this.headingRate) * h;
      this.heading = wrap(this.heading + this.headingRate * h);
    }
    this.lag += (MathUtils.clamp(s.ax * CHASE.lag, -0.8, 0.8) - this.lag) * (1 - Math.exp(-dt / CHASE.lagTc));

    const speed = Math.min(1, Math.abs(s.u) / CAR_PHYSICS.topSpeed);
    const want = CHASE.distance + CHASE.distanceAtSpeed * speed + this.lag;
    const yaw = this.heading + this.orbitYaw;
    const cp = Math.cos(this.orbitPitch);
    const sp = Math.sin(this.orbitPitch);
    const bx = -Math.sin(yaw) * cp;
    const bz = -Math.cos(yaw) * cp;
    this.target.set(s.x, PAD_HEIGHT + CHASE.pivotY, s.z);
    // Walls between the car and the camera.
    let t = 1;
    for (const wl of walls) t = Math.min(t, wl.raycast(s.x, s.z, s.x + bx * want, s.z + bz * want, this.seen));
    const clear = Math.max(CHASE.minDistance, t * want - 0.6);
    const tc = clear < this.reach ? CHASE.pullIn : CHASE.letOut;
    this.reach += (Math.min(want, clear) - this.reach) * (1 - Math.exp(-dt / tc));
    const d = this.reach;
    this.position.set(s.x + bx * d, Math.max(PAD_HEIGHT + 0.7, this.target.y + sp * d), s.z + bz * d);
    // Look over the car, a little ahead of it.
    const ahead = this.ahead.copy(this.target);
    ahead.x += Math.sin(this.heading) * 1.5;
    ahead.z += Math.cos(this.heading) * 1.5;
    ahead.y -= 0.25;
    this.m.lookAt(this.position, ahead, this.up);
    this.quaternion.setFromRotationMatrix(this.m);
  }

  /** Copies the pose onto a camera. */
  apply(camera: Camera): void {
    camera.position.copy(this.position);
    camera.quaternion.copy(this.quaternion);
  }

  /** The camera's bearing (yaw of its view), for placing the walker on leaving the car. */
  get yaw(): number {
    return this.heading + this.orbitYaw + Math.PI;
  }
}
