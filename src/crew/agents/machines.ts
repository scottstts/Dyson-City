/**
 * The field's machines at work (docs/crew.md, "Behaviour"):
 *
 *  - a Rigger walks its precinct's beat; at each post it turns to the rack, raises its boom and
 *    slides the head out to within half a metre of the line, holds it there, stows and walks on;
 *  - a Dray drives its precinct's lanes from socket to socket on a route rounded to its turning
 *    circle, rolls in along the lane over each socket, lowers its coupling probe into it, holds,
 *    lifts and drives on;
 *  - a Linewalker crawls its stretch of the square main's supply line, out and back, stopping now
 *    and then to pan its head over the line and the plant below.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { QuadMotion } from '../motion/quad';
import { Pose, solveFK, segmentIndex, type RigDef } from '../rig';
import { PathFollower } from './follow';
import type { P2 } from '../nav';
import type { Beat } from '../plan/field';
import { CLEARANCE } from '../plan/field';
export { drayLegs, rounded, DRAY_TURN } from '../plan/field';
import type { Line, Stretch } from '../plan/lines';
import { DRAY, WHEELS } from '../models/dray';
import { LINEWALKER, guideAxis } from '../models/linewalker';
import type { Surroundings } from './hand';
import { rng } from '../../field/kit/parts';
import { wrap } from '../motion/biped';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

export class RiggerAgent {
  readonly motion: QuadMotion;
  readonly follow: PathFollower;
  private readonly beat: Beat;
  private readonly ground: (x: number, z: number) => number;
  private readonly rand: () => number;
  private phase: 'walk' | 'face' | 'work' | 'stow' = 'walk';
  private step = 0;
  private until = 0;
  private time = 0;
  private readonly target = new Vector3();

  constructor(rig: RigDef, beat: Beat, ground: (x: number, z: number) => number, seed: number) {
    this.beat = beat;
    this.ground = ground;
    this.rand = rng(seed);
    const a = beat.legs[0][0];
    const b = beat.legs[0][1];
    const h = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.motion = new QuadMotion(rig, a[0], a[1], h, ground);
    this.follow = new PathFollower(a[0], a[1], h, { accel: 0.3, decel: 0.4, turn: 0.28, ahead: 1.6, corner: 0.6 });
    this.follow.set(beat.legs[0]);
  }

  get x(): number {
    return this.follow.root.x;
  }
  get z(): number {
    return this.follow.root.z;
  }

  update(dt: number, world: Surroundings): void {
    this.time += dt;
    const f = this.follow;
    const r = f.root;
    const post = this.beat.posts[(this.step + 1) % this.beat.posts.length];
    let target: Vector3 | null = null;
    if (this.phase === 'walk') {
      f.step(dt, 0.45, world.blocked(this, r.x, r.z, r.heading, CLEARANCE.rigger));
      if (f.done) this.phase = 'face';
    } else if (this.phase === 'face') {
      if (f.face(dt, post.face) && this.motion.settled) {
        this.phase = 'work';
        this.until = this.time + post.dwell[0] + (post.dwell[1] - post.dwell[0]) * this.rand();
      }
    } else if (this.phase === 'work') {
      f.face(dt, r.heading);
      target = this.target.fromArray(post.look);
      if (this.time >= this.until) this.phase = 'stow';
    } else {
      f.face(dt, r.heading);
      const b = this.motion.boom;
      if (Math.abs(b.ext) < 0.01 && Math.abs(b.pitch) < 0.01 && Math.abs(b.yaw) < 0.01) {
        this.step++;
        this.follow.set(this.beat.legs[this.step % this.beat.legs.length]);
        this.phase = 'walk';
      }
    }
    this.motion.update(dt, { x: r.x, z: r.z, heading: r.heading, speed: r.speed, turnRate: r.turnRate, boomTarget: target, standOff: 0.45, ground: this.ground });
  }
}

export class DrayAgent {
  readonly rig: RigDef;
  readonly pose: Pose;
  readonly root = new Matrix4();
  readonly world: Matrix4[];
  readonly follow: PathFollower;
  private readonly beat: Beat;
  private readonly legs: P2[][];
  private readonly ground: (x: number, z: number) => number;
  private readonly rand: () => number;
  private phase: 'drive' | 'lower' | 'dock' | 'raise' = 'drive';
  /** Whether the probe is travelling (its actuator runs). */
  get probing(): boolean {
    return this.phase === 'lower' || this.phase === 'raise';
  }
  private step = 0;
  private until = 0;
  private time = 0;
  /** The probe's travel (0 up … 1 down), the wheels' rolled distance and steer. */
  probe = 0;
  /** Times the probe has seated in a socket (its latch's sound counts them). */
  docks = 0;
  rolled = 0;
  steer = 0;
  private readonly i: Record<string, number> = {};
  private lastHeading: number;

  constructor(rig: RigDef, beat: Beat, legs: P2[][], ground: (x: number, z: number) => number, seed: number) {
    this.rig = rig;
    this.pose = new Pose(rig.segments.length);
    this.world = rig.segments.map(() => new Matrix4());
    for (const s of rig.segments) this.i[s.name] = segmentIndex(rig, s.name);
    this.beat = beat;
    this.legs = legs;
    this.ground = ground;
    this.rand = rng(seed);
    const p = beat.posts[0];
    this.follow = new PathFollower(p.x, p.z, p.face, { accel: 0.45, decel: 0.7, turn: 10, ahead: 0.05, corner: 10 });
    this.follow.set(legs[0]);
    this.lastHeading = p.face;
  }

  get x(): number {
    return this.follow.root.x;
  }
  get z(): number {
    return this.follow.root.z;
  }

  private readonly q: P2 = [0, 0];

  update(dt: number, world: Surroundings): void {
    this.time += dt;
    const f = this.follow;
    const r = f.root;
    if (this.phase === 'drive') {
      // It rides the rounded route; its heading is the route's tangent there.
      const blocked = world.blocked(this, r.x, r.z, r.heading, CLEARANCE.dray);
      f.step(dt, 1.6, blocked);
      const a = f.at(f.s - 0.6, this.q);
      const ax = a[0];
      const az = a[1];
      const b = f.at(f.s + 0.6, this.q);
      if (Math.hypot(b[0] - ax, b[1] - az) > 0.1) r.heading = Math.atan2(b[0] - ax, b[1] - az);
      if (f.done) {
        this.phase = 'lower';
        r.speed = 0;
      }
    } else if (this.phase === 'lower') {
      this.probe = Math.min(1, this.probe + dt / 2.2);
      if (this.probe >= 1) {
        this.phase = 'dock';
        this.docks++;
        const p = this.beat.posts[(this.step + 1) % this.beat.posts.length];
        this.until = this.time + p.dwell[0] + (p.dwell[1] - p.dwell[0]) * this.rand();
      }
    } else if (this.phase === 'dock') {
      if (this.time >= this.until) this.phase = 'raise';
    } else {
      this.probe = Math.max(0, this.probe - dt / 2.2);
      if (this.probe <= 0) {
        this.step++;
        this.follow.set(this.legs[this.step % this.legs.length]);
        this.phase = 'drive';
      }
    }
    // Steering from the heading's turn per metre (curvature), front and rear opposite (all-wheel steer).
    const turn = wrap(r.heading - this.lastHeading);
    this.lastHeading = r.heading;
    const ds = r.speed * dt;
    this.rolled += ds;
    const k = ds > 1e-4 ? turn / ds : 0;
    const want = Math.max(-DRAY.lock, Math.min(DRAY.lock, Math.atan(k * DRAY.wheel.z)));
    this.steer += (want - this.steer) * (1 - Math.exp(-dt / 0.25));
    this.pose3D();
  }

  private pose3D(): void {
    const r = this.follow.root;
    this.root.makeRotationY(r.heading).setPosition(r.x, this.ground(r.x, r.z), r.z);
    for (const n of WHEELS) {
      const front = n.startsWith('F');
      this.pose.q[this.i[`knuckle${n}`]].setFromAxisAngle(Y, front ? this.steer : -this.steer);
      this.pose.q[this.i[`wheel${n}`]].setFromAxisAngle(X, this.rolled / DRAY.wheel.r);
    }
    this.pose.t[this.i.probe].set(0, -DRAY.probe.travel * smoothstep(this.probe), 0);
    solveFK(this.rig, this.root, this.pose, this.world);
  }
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

export class LinewalkerAgent {
  readonly rig: RigDef;
  readonly pose: Pose;
  readonly root = new Matrix4();
  readonly world: Matrix4[];
  private readonly line: Line;
  private readonly stretch: Stretch;
  private readonly rand: () => number;
  s: number;
  private dir = 1;
  /** Crawling speed (m/s, ≥ 0) and the most it goes. */
  speed = 0;
  static readonly VMAX = 0.22;
  private pauseAt: number;
  private until = 0;
  private time = 0;
  private pan = 0;
  private tilt = 0;
  private panGoal = 0;
  private tiltGoal = 0;
  rolled = 0;
  private readonly i: Record<string, number> = {};
  private readonly axes: Record<string, Vector3> = {};

  constructor(rig: RigDef, line: Line, stretch: Stretch, seed: number) {
    for (const g of ['FL', 'FR', 'RL', 'RR']) this.axes[`guide${g}`] = new Vector3(...guideAxis(g.endsWith('L') ? 1 : -1));
    this.rig = rig;
    this.pose = new Pose(rig.segments.length);
    this.world = rig.segments.map(() => new Matrix4());
    for (const s of rig.segments) this.i[s.name] = segmentIndex(rig, s.name);
    this.line = line;
    this.stretch = stretch;
    this.rand = rng(seed);
    this.s = stretch.s0 + (stretch.s1 - stretch.s0) * this.rand();
    this.pauseAt = this.nextPause();
  }

  private nextPause(): number {
    return this.dir > 0 ? Math.min(this.stretch.s1, this.s + 6 + this.rand() * 26) : Math.max(this.stretch.s0, this.s - 6 - this.rand() * 26);
  }

  private readonly p: [number, number, number] = [0, 0, 0];
  private readonly t: [number, number, number] = [0, 0, 0];
  private readonly xAxis = new Vector3();
  private readonly zAxis = new Vector3();

  update(dt: number): void {
    this.time += dt;
    const VMAX = LinewalkerAgent.VMAX;
    if (this.time < this.until) {
      this.speed = Math.max(0, this.speed - 0.3 * dt);
      // Looking about: the head pans over the line and the plant below.
      if (Math.abs(this.pan - this.panGoal) < 0.02 && this.rand() < dt * 0.4) {
        this.panGoal = (this.rand() - 0.5) * 2.4 + (this.dir < 0 ? Math.PI : 0);
        this.tiltGoal = -0.15 - this.rand() * 0.45;
      }
    } else {
      const remaining = Math.abs(this.pauseAt - this.s);
      const v = Math.min(VMAX, Math.sqrt(2 * 0.15 * remaining));
      this.speed += Math.max(-0.15 * dt, Math.min(0.15 * dt, v - this.speed));
      this.s += this.dir * this.speed * dt;
      this.rolled += this.dir * this.speed * dt;
      this.panGoal = this.dir < 0 ? Math.PI : 0;
      this.tiltGoal = -0.12;
      if (remaining < 0.01) {
        this.until = this.time + 6 + this.rand() * 16;
        if ((this.dir > 0 && this.s >= this.stretch.s1 - 0.05) || (this.dir < 0 && this.s <= this.stretch.s0 + 0.05)) this.dir = -this.dir;
        this.pauseAt = this.nextPause();
      }
    }
    const k = 1 - Math.exp(-dt / 0.6);
    this.pan += wrap(this.panGoal - this.pan) * k;
    this.tilt += (this.tiltGoal - this.tilt) * k;
    // Frame: on the line, along its tangent, up.
    const p = this.line.at(this.s, this.p);
    const t = this.line.tangent(this.s, this.t);
    const zAxis = this.zAxis.set(t[0], 0, t[2]);
    const xAxis = this.xAxis.crossVectors(Y, zAxis);
    this.root.makeBasis(xAxis, Y, zAxis).setPosition(p[0], p[1], p[2]);
    const roll = this.rolled / LINEWALKER.roller;
    this.pose.q[this.i.rollerF].setFromAxisAngle(X, roll);
    this.pose.q[this.i.rollerR].setFromAxisAngle(X, roll);
    // The guide rollers roll along the pipe on their own axles.
    for (const g of ['guideFL', 'guideFR', 'guideRL', 'guideRR']) this.pose.q[this.i[g]].setFromAxisAngle(this.axes[g], this.rolled / LINEWALKER.guide);
    this.pose.q[this.i.pan].setFromAxisAngle(Y, this.pan);
    this.pose.q[this.i.tilt].setFromAxisAngle(X, -this.tilt);
    solveFK(this.rig, this.root, this.pose, this.world);
  }
}
