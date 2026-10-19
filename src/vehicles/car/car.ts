/**
 * The car in the scene (docs/vehicles.md): its body on a sprung pivot, four wheels that roll and
 * steer, lamps that wake when it is driven, and its physics (dynamics.ts) against the walls
 * (collision.ts).
 *
 * The body is a sprung mass on the wheels: it pitches under braking and power, rolls in corners
 * (a damped spring, ~1.5 Hz, about a point near the ground), and the wheels stay on the pad. Each
 * wheel is an annular rotor spinning round its hub motor; the hub steers and carries the
 * suspension's carriers, which meet it on the steering axis. Two levels of detail switch at
 * LOD_DISTANCE.
 */
import { Group, LOD, Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from 'three/webgpu';
import { PAD_HEIGHT } from '../../ground/site';
import { GRAVITY } from '../../world/constants';
import { armMatrix, bodyMatrix, buildCarModel, CAR, DRAWN_IN_CLEAR, hubAt, TRACK_WIDEN, type CarArm } from './model';
import { createCarMaterials, CAR_LAMP, type CarMaterials } from './materials';
import { CarState, NO_INPUT, stepCar, type DriveInput } from './dynamics';
import { CarCollider, CAR_FOOTPRINT, type Contact } from './collision';
import type { CollisionWorld } from '../../player/collision';
import type { VehicleLook } from '../materials';
import type { ShadeBox } from '../shade';

/** Beyond this distance (m) the car draws its lighter tessellation. */
export const LOD_DISTANCE = 40;
/** Body motion: pitch and roll per m/s² of acceleration (rad), spring frequency (Hz) and damping. */
const SPRING = { pitch: 0.0024, roll: 0.0039, heave: 0.0025, hz: 1.5, zeta: 0.5 } as const;
/** The lamps wake and sleep over this time (s). */
const LAMP_TC = 0.35;
/** The wheels deploy or draw in over this time (s), eased. */
export const DEPLOY_TIME = 1.3;

class Spring {
  x = 0;
  v = 0;
  step(target: number, dt: number): void {
    const w = 2 * Math.PI * SPRING.hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-(w * w) * (this.x - target) - 2 * SPRING.zeta * w * this.v) * h;
      this.x += this.v * h;
    }
  }
}

export class Car {
  readonly group = new Group();
  readonly state = new CarState();
  readonly materials: CarMaterials;
  /** The sprung body (its pose set as a matrix: model.ts bodyMatrix). */
  private readonly body = new Group();
  /** The swing arms, each posed to keep its end on its hub. */
  private readonly arms: { arm: CarArm; node: Group; wheel: number }[] = [];
  private readonly bodyM = new Matrix4();
  private readonly wheels: { spin: Group; steer: Group; front: boolean; left: boolean; hub: Vector3 }[] = [];
  /** The wheels' deployment: travel (linear in time) and its eased value, 0 drawn in … 1 out. */
  private travel = 0;
  deploy = 0;
  private readonly tmpHub = new Vector3();
  private readonly collider: CarCollider;
  private readonly carry = { t: 0 };
  private readonly pitch = new Spring();
  private readonly roll = new Spring();
  private readonly heave = new Spring();
  private power = 0;
  /** Is someone driving it (lamps lit, motors live). */
  driven = false;
  /** Triangles drawn at full detail (for the log). */
  readonly triangles: number;
  /** The body's height over the ground (m). */
  readonly height: number;

  /** The ground a wheel meets at a plan point (world y): the pad, or the Stand's ramp and deck. */
  private readonly ground: (x: number, z: number) => number;
  /** The ground's height under the car's centre (the plane through its wheels' contacts there). */
  groundY = PAD_HEIGHT;
  /** Each wheel's contact height off that plane (m): the suspension takes it. */
  private readonly residual = [0, 0, 0, 0];

  constructor(walls: CollisionWorld[], ground: (x: number, z: number) => number = () => PAD_HEIGHT) {
    this.ground = ground;
    this.group.name = 'Car';
    this.materials = createCarMaterials();
    const full = buildCarModel(1);
    const lite = buildCarModel(0.3);
    this.triangles = full.triangles;
    this.height = full.body.boundingBox!.max.y;
    const mats = this.materials.list;
    const lod = (name: string, a: BufferGeometry, b: BufferGeometry) => {
      const l = new LOD();
      l.name = name;
      l.addLevel(mesh(`${name}.full`, a, mats), 0);
      l.addLevel(mesh(`${name}.lite`, b, mats), LOD_DISTANCE);
      return l;
    };
    this.body.name = 'Car.body';
    this.body.matrixAutoUpdate = false;
    this.body.add(lod('Car.shell', full.body, lite.body));
    this.group.add(this.body);
    full.arms.forEach((arm, i) => {
      const node = new Group();
      node.name = `Car.arm${i}`;
      node.matrixAutoUpdate = false;
      node.add(lod(`Car.arm${i}`, arm.geometry, lite.arms[i].geometry));
      this.group.add(node);
      // Its wheel: front left, front right, rear left, rear right (left is +x, the nose +z).
      this.arms.push({ arm, node, wheel: (arm.hub.z > 0 ? 0 : 2) + (arm.hub.x > 0 ? 0 : 1) });
    });
    full.hubs.forEach((hub, i) => {
      const steer = new Group();
      steer.position.copy(hub);
      // The hub steers with the knuckle; the rotor spins round it.
      steer.add(lod(`Car.hub${i}`, full.hub, lite.hub));
      const spin = new Group();
      spin.add(lod(`Car.rotor${i}`, full.rotor, lite.rotor));
      steer.add(spin);
      this.group.add(steer);
      this.wheels.push({ spin, steer, front: i < 2, left: hub.x > 0, hub: hub.clone() });
    });
    this.collider = new CarCollider(walls);
  }

  /** Parks the car at a plan point, heading ψ (its nose along (sin ψ, cos ψ)). */
  park(x: number, z: number, yaw: number): void {
    this.state.place(x, z, yaw);
    this.settle();
    this.pose(0);
  }

  setLook(look: VehicleLook): void {
    this.materials.setLook(look);
  }

  /** The wheels are out and the car answers its controls. */
  get ready(): boolean {
    return this.deploy >= 1;
  }

  /** The footprint's half-width now (the wheels' outer faces). */
  get halfWidth(): number {
    return CAR_FOOTPRINT.halfWidth - (TRACK_WIDEN - DRAWN_IN_CLEAR) * (1 - this.deploy);
  }

  /** Per frame: deploys or draws in the wheels, steps the physics (inputs only once deployed) and poses the car. */
  update(dt: number, input: DriveInput | null): void {
    const s = this.state;
    this.travel = Math.min(1, Math.max(0, this.travel + ((this.driven ? 1 : -1) * dt) / DEPLOY_TIME));
    const t = this.travel;
    this.deploy = t * t * (3 - 2 * t);
    this.settle();
    stepCar(s, this.driven && this.ready && input ? input : NO_INPUT, dt, this.carry, (st) => this.collider.resolve(st, this.halfWidth));
    this.pose(dt);
  }

  /**
   * Fits the chassis to the ground under its four wheels: the height at the centre, the pitch from
   * the axles' mean heights and the roll from the sides', and each wheel's residual (taken by its
   * suspension). Sets gravity's share along that plane for the physics.
   */
  private settle(): void {
    const s = this.state;
    const sy = Math.sin(s.yaw);
    const cy = Math.cos(s.yaw);
    const h = this.wheelHeights;
    this.wheels.forEach((w, i) => {
      // Forward (sin ψ, cos ψ), left (cos ψ, −sin ψ).
      const x = s.x + sy * w.hub.z + cy * w.hub.x;
      const z = s.z + cy * w.hub.z - sy * w.hub.x;
      h[i] = this.ground(x, z);
    });
    const front = (h[0] + h[1]) / 2;
    const rear = (h[2] + h[3]) / 2;
    const left = (h[0] + h[2]) / 2;
    const right = (h[1] + h[3]) / 2;
    const base = CAR.frontZ - CAR.rearZ;
    const track = Math.abs(this.wheels[0].hub.x - this.wheels[1].hub.x);
    this.slopeF = (front - rear) / base;
    this.slopeL = (left - right) / track;
    // The plane's height at the centre of mass (between the axles at CAR_PHYSICS' split).
    const k = -CAR.rearZ / base;
    this.groundY = rear + (front - rear) * k;
    const centreZ = CAR.rearZ + (CAR.frontZ - CAR.rearZ) * k;
    this.wheels.forEach((w, i) => {
      const plane = this.groundY + this.slopeF * (w.hub.z - centreZ) + this.slopeL * w.hub.x;
      this.residual[i] = h[i] - plane;
    });
    s.gradeX = (-GRAVITY * this.slopeF) / Math.hypot(1, this.slopeF);
    s.gradeY = (-GRAVITY * this.slopeL) / Math.hypot(1, this.slopeL);
  }

  private readonly wheelHeights = [0, 0, 0, 0];
  /** The ground plane's rise per metre forward and to the left, under the car. */
  private slopeF = 0;
  private slopeL = 0;

  /** The hardest wall contact since the last call (sound). */
  takeContact(): Contact {
    return this.collider.take();
  }

  private pose(dt: number): void {
    const s = this.state;
    // The chassis frame sits on the ground's plane under the wheels (settle): nose up is a negative
    // turn about the car's x, its left side up a positive turn about its z.
    const centreZ = CAR.rearZ + (CAR.frontZ - CAR.rearZ) * (-CAR.rearZ / (CAR.frontZ - CAR.rearZ));
    this.group.position.set(s.x, this.groundY, s.z);
    this.group.rotation.set(-Math.atan(this.slopeF), s.yaw, Math.atan(this.slopeL), 'YXZ');
    // The frame's origin is the car's plan centre; the plane's height was taken at the centre of mass.
    this.group.position.y -= this.slopeF * centreZ;
    // The sprung body: nose down under braking, the outside of a corner down. Drawn in, the
    // suspension sits on its stops (the wheels stand 2 cm off the shoulders there).
    const sprung = this.deploy;
    this.pitch.step(-s.ax * SPRING.pitch * sprung, dt);
    this.roll.step(s.ay * SPRING.roll * sprung, dt);
    this.heave.step(-Math.abs(s.ay) * SPRING.heave * 0.4 * sprung, dt);
    bodyMatrix(this.pitch.x, this.roll.x, this.heave.x, this.bodyM);
    this.body.matrix.copy(this.bodyM);
    // The arms ride the body and turn about their roots onto the hubs (which stay on the ground).
    for (const a of this.arms) {
      const hub = hubAt(a.arm.hub, this.deploy, this.tmpHub);
      hub.y += this.residual[a.wheel];
      armMatrix(a.arm, this.bodyM, hub, a.node.matrix);
    }
    this.wheels.forEach((w, i) => {
      w.steer.position.copy(hubAt(w.hub, this.deploy, this.tmpHub));
      w.steer.position.y += this.residual[i];
      w.steer.rotation.y = w.front ? s.steer : s.rearSteer;
      w.spin.rotation.x = (w.spin.rotation.x + (w.front ? s.spinFront : s.spinRear) * dt) % (2 * Math.PI);
    });
    // Lamps.
    const k = 1 - Math.exp(-dt / LAMP_TC);
    this.power += ((this.driven ? 1 : 0) - this.power) * (dt > 0 ? k : 1);
    this.materials.power.value = this.power;
    this.materials.tail.value = this.power * (CAR_LAMP.tail + s.braking * (CAR_LAMP.brake - CAR_LAMP.tail));
    this.group.updateMatrixWorld();
  }

  /** The car's shade on the pad (shade.ts). */
  shadeBox(): ShadeBox {
    const s = this.state;
    const F = { ...CAR_FOOTPRINT, halfWidth: this.halfWidth };
    return { x: s.x + Math.sin(s.yaw) * F.centreZ, z: s.z + Math.cos(s.yaw) * F.centreZ, yaw: s.yaw, a: F.halfWidth - 0.25, b: F.halfLength - 0.2, h: 0.85, opacity: 1 };
  }

  /** The car's footprint corners (world plan), for the walker's wall. */
  footprint(margin = 0): [number, number][] {
    const s = this.state;
    const F = { ...CAR_FOOTPRINT, halfWidth: this.halfWidth };
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const cx = s.x + fx * F.centreZ;
    const cz = s.z + fz * F.centreZ;
    const hl = F.halfLength + margin;
    const hw = F.halfWidth + margin;
    return [
      [cx + fx * hl + fz * hw, cz + fz * hl - fx * hw],
      [cx + fx * hl - fz * hw, cz + fz * hl + fx * hw],
      [cx - fx * hl - fz * hw, cz - fz * hl + fx * hw],
      [cx - fx * hl + fz * hw, cz - fz * hl - fx * hw],
    ];
  }

  /** Distance (m) from a plan point to the car's footprint (0 inside). */
  distance(x: number, z: number): number {
    const s = this.state;
    const F = { ...CAR_FOOTPRINT, halfWidth: this.halfWidth };
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const dx = x - (s.x + fx * F.centreZ);
    const dz = z - (s.z + fz * F.centreZ);
    const along = Math.abs(dx * fx + dz * fz) - F.halfLength;
    const across = Math.abs(dx * fz - dz * fx) - F.halfWidth;
    return Math.hypot(Math.max(along, 0), Math.max(across, 0));
  }

  /** The roof's height (world y). */
  get top(): number {
    return this.groundY + this.height;
  }
}

function mesh(name: string, g: BufferGeometry, mats: Material[]): Mesh {
  const m = new Mesh(g, mats);
  m.name = name;
  return m;
}
