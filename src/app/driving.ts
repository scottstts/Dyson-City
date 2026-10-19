/**
 * Getting in, driving and getting out of the car (docs/vehicles.md, "Driving"). Game owns the
 * loop; this owns the switch between walking and driving:
 *
 *  - On foot within reach of the car, E gets in. The view moves from the eye to the chase camera
 *    behind the car (an eased arc over TRANSITION seconds), and the controls drive.
 *  - Driving: W accelerate, S brake (held at rest: reverse), A/D steer, Space handbrake; the
 *    mouse orbits the camera. The keys are pedals with travel: they ramp rather than snap.
 *  - Nearly stopped, E gets out on the side that is clear. The view moves back to the eye.
 *  - The parked car is a wall to the walker.
 */
import { Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Input } from '../player/input';
import type { PlayerController } from '../player/controller';
import type { CollisionWorld } from '../player/collision';
import type { CityWalk } from '../city/walk';
import { ChaseCamera } from '../vehicles/car/chaseCamera';
import { CAR_FOOTPRINT } from '../vehicles/car/collision';
import type { Car } from '../vehicles/car/car';
import type { DriveInput } from '../vehicles/car/dynamics';

/** Reach (m) from the walker's feet to the car's footprint to get in. */
export const REACH = 1.6;
/** Getting out: below this speed (m/s). */
export const EXIT_SPEED = 1.2;
/** The view's move between the eye and the chase camera (s). */
export const TRANSITION = 1.1;
/** Pedal travel time (s, full press) and release. */
const PEDAL = { press: 0.12, release: 0.08 } as const;

type Mode = 'walking' | 'entering' | 'driving' | 'leaving';

export class Driving {
  private mode: Mode = 'walking';
  private t = 0;
  private readonly chase = new ChaseCamera();
  private readonly fromPos = new Vector3();
  private readonly fromQuat = new Quaternion();
  private readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private readonly car: Car;
  private readonly keys: Input;
  private readonly player: PlayerController;
  private readonly camera: PerspectiveCamera;
  private readonly walk: CityWalk;
  private readonly cameraWalls: CollisionWorld[];
  /** What E would do now (the prompt), or null. */
  prompt: string | null = null;

  constructor(car: Car, keys: Input, player: PlayerController, camera: PerspectiveCamera, walk: CityWalk, carWalls: CollisionWorld) {
    this.car = car;
    this.keys = keys;
    this.player = player;
    this.camera = camera;
    this.walk = walk;
    this.cameraWalls = [walk.walls, carWalls];
    this.wallCar();
  }

  /** Review (?drive): starts seated, the camera already behind the car. */
  startInCar(): void {
    this.mode = 'driving';
    this.car.driven = true;
    this.walk.walls.setDynamic('car', null);
    this.chase.reset(this.car.state);
    this.chase.update(0, [0, 0], this.car.state, this.cameraWalls, this.car.groundY);
    this.chase.apply(this.camera);
  }

  /** The player is in the car (or getting in or out): the walker does not move. */
  get inCar(): boolean {
    return this.mode !== 'walking';
  }

  /**
   * Per frame, after the walker has moved (when walking). `use` is an E press this frame; returns
   * whether it was taken here (so a door does not take it too).
   */
  update(dt: number, playing: boolean, use: boolean): boolean {
    const car = this.car;
    let used = false;
    this.prompt = null;
    switch (this.mode) {
      case 'walking': {
        const f = this.player.feet;
        const near = playing && Math.abs(f.y - car.groundY) < 0.5 && car.distance(f.x, f.z) < REACH;
        if (near) {
          this.prompt = 'Drive';
          if (use) {
            used = true;
            this.begin('entering');
            car.driven = true;
            this.walk.walls.setDynamic('car', null);
            this.chase.reset(car.state);
          }
        }
        car.update(dt, null);
        break;
      }
      case 'entering':
      case 'driving': {
        this.pedals(dt, playing);
        car.update(dt, this.input);
        const look = this.keys.consumeLook();
        this.chase.update(dt, playing ? look : [0, 0], car.state, this.cameraWalls, car.groundY);
        if (this.mode === 'entering') this.blend(dt, this.chase.position, this.chase.quaternion, () => (this.mode = 'driving'));
        else this.chase.apply(this.camera);
        if (this.mode === 'driving' && playing && car.state.speed < EXIT_SPEED) {
          const spot = this.exitSpot();
          if (spot) {
            this.prompt = 'Exit';
            if (use) {
              used = true;
              car.driven = false;
              this.player.spawn({ position: spot, yaw: this.chase.yaw, pitch: -0.05 });
              this.begin('leaving');
            }
          }
        }
        break;
      }
      case 'leaving': {
        this.release();
        car.update(dt, null);
        // The walker stands still while the view returns to the eye.
        this.player.update(0);
        this.blend(dt, this.camera.position.clone(), this.camera.quaternion.clone(), () => {
          this.mode = 'walking';
          this.wallCar();
        });
        break;
      }
    }
    if (this.mode === 'walking') this.wallCar();
    return used;
  }

  private begin(mode: 'entering' | 'leaving'): void {
    this.mode = mode;
    this.t = 0;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
  }

  /** Eases the camera from the saved pose to (pos, quat) along a raised arc; `done` at the end. */
  private blend(dt: number, pos: Vector3, quat: Quaternion, done: () => void): void {
    this.t += dt;
    const u = Math.min(1, this.t / TRANSITION);
    const e = u * u * (3 - 2 * u);
    this.camera.position.lerpVectors(this.fromPos, pos, e);
    this.camera.position.y += Math.sin(Math.PI * e) * 0.9;
    this.camera.quaternion.slerpQuaternions(this.fromQuat, quat, e);
    if (u >= 1) done();
  }

  /** Keyboard pedals with travel. */
  private pedals(dt: number, playing: boolean): void {
    const k = this.keys;
    const on = (a: string, b: string) => playing && (k.down(a) || k.down(b));
    const ramp = (v: number, held: boolean) => (held ? Math.min(1, v + dt / PEDAL.press) : Math.max(0, v - dt / PEDAL.release));
    this.input.throttle = ramp(this.input.throttle, on('KeyW', 'ArrowUp'));
    this.input.brake = ramp(this.input.brake, on('KeyS', 'ArrowDown'));
    this.input.steer = (on('KeyA', 'ArrowLeft') ? 1 : 0) - (on('KeyD', 'ArrowRight') ? 1 : 0);
    this.input.handbrake = on('Space', 'Space');
  }

  private release(): void {
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
  }

  /** A clear standing spot beside the car (left, right, behind, ahead), or null. */
  private exitSpot(): [number, number] | null {
    const s = this.car.state;
    const F = CAR_FOOTPRINT;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const cx = s.x + fx * F.centreZ;
    const cz = s.z + fz * F.centreZ;
    const out = 0.75;
    const options: [number, number][] = [
      [fz * (F.halfWidth + out), -fx * (F.halfWidth + out)],
      [-fz * (F.halfWidth + out), fx * (F.halfWidth + out)],
      [-fx * (F.halfLength + out), -fz * (F.halfLength + out)],
      [fx * (F.halfLength + out), fz * (F.halfLength + out)],
    ];
    for (const [ox, oz] of options) {
      const x = cx + ox;
      const z = cz + oz;
      const [rx, rz] = this.walk.walls.resolve(x, z, 0.35);
      if (Math.hypot(rx - x, rz - z) > 1e-3) continue;
      // Standing on what the car stands on (the pad, or the Stand's deck), not off its edge.
      const y = this.car.groundY;
      if (Math.abs(this.walk.ground(x, z, y + 0.4) - y) > 0.05) continue;
      return [x, z];
    }
    return null;
  }

  /** The parked car stands in the walker's way. */
  private wallCar(): void {
    this.walk.walls.setDynamic('car', this.car.footprint(0.05));
  }
}
