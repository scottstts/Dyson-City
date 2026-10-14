/**
 * First-person walker on the analytic site surface. Grounded and slightly unhurried: smooth
 * acceleration, a gentle step-up ease onto the platform treads, real 1 g falls off edges. The eye
 * moves as a walking or running person's head does (headMotion.ts).
 */
import { Euler, MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { GRAVITY, EYE_HEIGHT } from '../world/constants';
import { groundHeight, SITE } from '../ground/site';
import type { Input } from './input';
import type { CollisionWorld } from './collision';
import { HeadMotion } from './headMotion';

const WALK = 2.0;
const RUN = 5.6;
const CROUCH = 1.0;
const ACCEL = 9;
const AIR_ACCEL = 1.5;
const JUMP_SPEED = 3.9;
const STEP_UP = 0.45;
const CROUCH_EYE = 1.05;
const LOOK_RAD_PER_PX = 0.0021;

/** The walkable world: surface height and walls (default: the bare site, no walls). */
export interface Walkable {
  ground(x: number, z: number): number;
  walls?: CollisionWorld;
}

/** Radius of the walker's body for wall collisions. */
const BODY_RADIUS = 0.3;

export interface Spawn {
  position: [number, number];
  yaw: number;
  pitch: number;
}

export class PlayerController {
  readonly feet = new Vector3();
  private readonly velocity = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private eye = EYE_HEIGHT;
  private grounded = true;
  private stepOffset = 0;
  private readonly head = new HeadMotion();
  private readonly prevVelocity = new Vector3();
  sensitivity = 1;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly wish = new Vector3();

  private readonly camera: PerspectiveCamera;
  private readonly input: Input;
  private readonly world: Walkable;

  constructor(camera: PerspectiveCamera, input: Input, world: Walkable = { ground: groundHeight }) {
    this.camera = camera;
    this.input = input;
    this.world = world;
  }

  spawn(s: Spawn): void {
    this.feet.set(s.position[0], 0, s.position[1]);
    this.feet.y = this.world.ground(this.feet.x, this.feet.z);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.velocity.set(0, 0, 0);
    this.prevVelocity.set(0, 0, 0);
    this.apply();
  }

  /** Sets the view direction directly (debug/review tooling). */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  update(dt: number): void {
    const [dx, dy] = this.input.consumeLook();
    const k = LOOK_RAD_PER_PX * this.sensitivity * (this.camera.fov / 60);
    this.yaw -= dx * k;
    this.pitch = MathUtils.clamp(this.pitch - dy * k, -1.52, 1.52);

    const fwd = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const side = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    const crouch = this.input.down('ControlLeft') || this.input.down('KeyC');
    const run = !crouch && (this.input.down('ShiftLeft') || this.input.down('ShiftRight'));
    const speed = crouch ? CROUCH : run ? RUN : WALK;

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.wish.set(-sy * fwd + cy * side, 0, -cy * fwd - sy * side);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(speed);

    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (this.wish.x - this.velocity.x) * blend;
    this.velocity.z += (this.wish.z - this.velocity.z) * blend;

    if (this.grounded && this.input.down('Space')) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    // Horizontal move: slide along walls, then a soft bound.
    let nx = this.feet.x + this.velocity.x * dt;
    let nz = this.feet.z + this.velocity.z * dt;
    if (this.world.walls) [nx, nz] = this.world.walls.move(this.feet.x, this.feet.z, this.velocity.x * dt, this.velocity.z * dt, BODY_RADIUS);
    const r = Math.hypot(nx, nz);
    const limit = SITE.walkRadius;
    const scale = r > limit ? limit / r : 1;
    const tx = nx * scale;
    const tz = nz * scale;
    const target = this.world.ground(tx, tz);

    if (this.grounded) {
      const rise = target - this.feet.y;
      if (rise > STEP_UP) {
        // Blocked by a riser taller than a step: stop horizontal motion.
        this.velocity.x = 0;
        this.velocity.z = 0;
      } else {
        this.feet.x = tx;
        this.feet.z = tz;
        if (rise < -STEP_UP) {
          this.grounded = false; // walked off an edge
        } else {
          // Ease the eye over small steps instead of snapping.
          this.stepOffset -= rise;
          this.feet.y = target;
        }
      }
    } else {
      this.feet.x = tx;
      this.feet.z = tz;
    }

    if (!this.grounded) {
      this.velocity.y -= GRAVITY * dt;
      this.feet.y += this.velocity.y * dt;
      const floor = this.world.ground(this.feet.x, this.feet.z);
      if (this.feet.y <= floor) {
        this.stepOffset += this.feet.y - floor;
        this.feet.y = floor;
        this.head.land(-this.velocity.y);
        this.velocity.y = 0;
        this.grounded = true;
      }
    }

    this.stepOffset *= Math.exp(-14 * dt);
    const eyeTarget = crouch ? CROUCH_EYE : EYE_HEIGHT;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-10 * dt));
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // Horizontal acceleration in the view's frame (forward −Z at yaw 0, right +X).
    const inv = dt > 0 ? 1 / dt : 0;
    const ax = (this.velocity.x - this.prevVelocity.x) * inv;
    const az = (this.velocity.z - this.prevVelocity.z) * inv;
    this.prevVelocity.copy(this.velocity);
    this.head.update(dt, {
      speed: hSpeed,
      walkSpeed: WALK,
      runSpeed: RUN,
      grounded: this.grounded,
      accelForward: -sy * ax - cy * az,
      accelRight: cy * ax - sy * az,
    });
    this.apply();
  }

  private apply(): void {
    const h = this.head;
    // The head's sideways shift is along the view's right, in the horizontal plane.
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.camera.position.set(this.feet.x + rx * h.right, this.feet.y + this.eye + this.stepOffset + h.up, this.feet.z + rz * h.right);
    this.euler.set(MathUtils.clamp(this.pitch + h.pitch, -1.55, 1.55), this.yaw + h.yaw, h.roll);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  get eyeAltitude(): number {
    return this.camera.position.y;
  }
}
