/**
 * The Rigger's motion (docs/crew.md, "Motion"): a wave gait for a heavy four-legged machine, and
 * its boom.
 *
 *  - One leg swings at a time (front left, rear right, front right, rear left), so three pads are
 *    always down: slow, stable, never a hop. A leg steps when its pad has fallen behind its place
 *    under the body (or turned out of it), aimed at where that place will be as it lands.
 *  - Each leg is IK through its actuators: the coxa's yaw drum turns the leg's plane toward the
 *    pad, the femur's and knee's pitch drums solve the plane's two-bone reach (knee up, as an
 *    insect's), the ankle's drum keeps the pad level.
 *  - The boom aims its head at a target: yaw drum, pitch drum, the inner stage sliding out to
 *    reach, the wrist drum holding the head on the target.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { LEGS, RIGGER, legFrame, legPoint, type LegName } from '../models/rigger';
import { Pose, solveFK, segmentIndex, type RigDef } from '../rig';
import type { Vec3 } from '../../geometry/polyMesh';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const R = RIGGER;

export const QUAD = {
  /** Swing time per leg (s), pad lift (m), the error (m, rad) that calls a step. */
  swing: 0.55,
  lift: 0.12,
  slack: 0.14,
  slackYaw: 0.18,
  /** The wave's order. */
  order: ['FL', 'RR', 'FR', 'RL'] as LegName[],
  /** Body height bob as weight shifts (m). */
  bob: 0.012,
  /** The slowest the inner stage slides (m/s) and the boom turns (rad/s). */
  boomSpeed: 0.35,
  boomTurn: 0.35,
} as const;

interface Leg {
  name: LegName;
  /** The pad's place (ground point under its ankle). */
  place: Vector3;
  swinging: boolean;
  from: Vector3;
  to: Vector3;
  t0: number;
}

const mj = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (10 - 15 * t + 6 * t * t);
};

export interface QuadCommand {
  x: number;
  z: number;
  heading: number;
  speed: number;
  turnRate: number;
  /** World point the boom's head should reach toward (stopping short by `standOff`), or null (stowed). */
  boomTarget: Vector3 | null;
  standOff: number;
  ground(x: number, z: number): number;
}

export class QuadMotion {
  readonly rig: RigDef;
  readonly pose: Pose;
  readonly root = new Matrix4();
  readonly world: Matrix4[];
  time = 0;
  private readonly legs: Leg[];
  private next = 0;
  private readonly i: Record<string, number> = {};
  /** Per leg: rest yaw axis, femur pivot, knee and ankle in the leg's plane, link lengths, rest angles. */
  private readonly geo: Record<string, { hip: Vector3; outAngle: number; F: [number, number]; l1: number; l2: number; a0: number; b0: number; ankleY: number; axis: Vector3; ankle: Vec3 }> = {};
  /** The boom's current state: yaw, pitch, extension, wrist. */
  boom = { yaw: 0, pitch: 0, ext: 0, wrist: 0 };
  /** How hard the boom's drums and stage are working (0 still … 1 at their pace), for its sound. */
  boomWork = 0;
  /** Called as each pad lands (its ground point, and how hard: 0 … 1), for its sound. */
  onStep: ((x: number, y: number, z: number, force: number) => void) | null = null;
  private readonly bodyPivot: Vector3;

  constructor(rig: RigDef, x: number, z: number, heading: number, ground: (x: number, z: number) => number) {
    this.rig = rig;
    this.pose = new Pose(rig.segments.length);
    this.world = rig.segments.map(() => new Matrix4());
    for (const s of rig.segments) this.i[s.name] = segmentIndex(rig, s.name);
    for (const n of LEGS) {
      const f = legFrame(n);
      const K = R.knee;
      const A = R.ankle;
      const F = R.femur;
      this.geo[n] = {
        hip: new Vector3(...f.hip),
        outAngle: Math.atan2(f.out[2], f.out[0]),
        F: [F[0], F[1]],
        l1: Math.hypot(K[0] - F[0], K[1] - F[1]),
        l2: Math.hypot(A[0] - K[0], A[1] - K[1]),
        a0: Math.atan2(K[1] - F[1], K[0] - F[0]),
        b0: Math.atan2(A[1] - K[1], A[0] - K[0]),
        ankleY: f.hip[1] + A[1],
        // Pitch about the leg's axis (cross(y, out)): a positive turn takes `out` down.
        axis: new Vector3(...f.out).cross(Y).negate(),
        ankle: legPoint(n, R.ankle),
      };
    }
    this.bodyPivot = new Vector3(...rig.segments[this.i.body].pivot);
    this.legs = LEGS.map((n) => {
      const p = this.home(n, x, z, heading, ground, 0, new Vector3());
      return { name: n, place: p, swinging: false, from: p.clone(), to: p.clone(), t0: 0 };
    });
  }

  /** A pad's place under the body (its ankle's rest point dropped to the ground). */
  private home(n: LegName, x: number, z: number, heading: number, ground: (x: number, z: number) => number, ahead: number, out: Vector3): Vector3 {
    const a = this.geo[n].ankle;
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    const px = x + c * a[0] + s * (a[2] + ahead);
    const pz = z - s * a[0] + c * (a[2] + ahead);
    return out.set(px, ground(px, pz), pz);
  }

  get settled(): boolean {
    return !this.legs.some((l) => l.swinging);
  }

  update(dt: number, cmd: QuadCommand): void {
    this.time += dt;
    const t = this.time;
    // Land a swinging leg.
    for (const l of this.legs) {
      if (l.swinging && t >= l.t0 + QUAD.swing) {
        l.swinging = false;
        l.place.copy(l.to);
        this.onStep?.(l.place.x, l.place.y, l.place.z, 0.6 + 0.4 * Math.min(1, cmd.speed / 0.45));
      }
    }
    // The next leg in the wave steps when it (or any leg) is out of place, one at a time.
    if (!this.legs.some((l) => l.swinging)) {
      const moving = cmd.speed > 0.03 || Math.abs(cmd.turnRate) > 0.03;
      let worst = 0;
      for (const l of this.legs) {
        const h = this.home(l.name, cmd.x, cmd.z, cmd.heading, cmd.ground, 0, this.h);
        worst = Math.max(worst, Math.hypot(h.x - l.place.x, h.z - l.place.z) / QUAD.slack);
      }
      if (worst > 1 || (moving && worst > 0.35)) {
        const l = this.legs.find((q) => q.name === QUAD.order[this.next])!;
        this.next = (this.next + 1) % 4;
        // Aimed at its place when it lands, plus a little lead for the steps of the others.
        const T = QUAD.swing;
        const hx = cmd.x + Math.sin(cmd.heading) * cmd.speed * T;
        const hz = cmd.z + Math.cos(cmd.heading) * cmd.speed * T;
        l.from.copy(l.place);
        this.home(l.name, hx, hz, cmd.heading + cmd.turnRate * T * 2, cmd.ground, cmd.speed * T * 1.6, l.to);
        l.t0 = t;
        l.swinging = true;
      }
    }
    // Body: carried level, dipping a touch toward the swinging leg's corner.
    const sw = this.legs.find((l) => l.swinging);
    const u = sw ? (t - sw.t0) / QUAD.swing : 0;
    const dip = sw ? QUAD.bob * Math.sin(Math.PI * Math.min(1, u)) : 0;
    const gy = cmd.ground(cmd.x, cmd.z);
    this.root.makeRotationY(cmd.heading).setPosition(cmd.x, gy, cmd.z);
    this.pose.t[this.i.body].set(0, -dip, 0);
    this.pose.q[this.i.body].identity();
    solveFK(this.rig, this.root, this.pose, this.world);
    for (const l of this.legs) this.poseLeg(l, t);
    this.poseBoom(dt, cmd);
    solveFK(this.rig, this.root, this.pose, this.world);
  }

  private readonly inv = new Matrix4();
  private readonly v = new Vector3();
  private readonly h = new Vector3();
  private readonly q = new Vector3();

  private poseLeg(l: Leg, t: number): void {
    const g = this.geo[l.name];
    // The pad's ground point, lifted on its arc while swinging.
    const p = this.v.copy(l.place);
    if (l.swinging) {
      const u = (t - l.t0) / QUAD.swing;
      p.lerpVectors(l.from, l.to, mj(u));
      p.y += QUAD.lift * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    }
    // Into the body's frame (model space).
    this.inv.copy(this.world[this.i.body]).invert();
    const q = this.q.copy(p).applyMatrix4(this.inv).add(this.bodyPivot);
    // Coxa yaw: the leg's plane turns toward the pad.
    const want = Math.atan2(q.z - g.hip.z, q.x - g.hip.x);
    let yaw = want - g.outAngle;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.pose.q[this.i[`coxa${l.name}`]].setFromAxisAngle(Y, -yaw);
    // In the leg's plane (u out from the yaw axis, v up from the hip): the ankle stands over the
    // pad's ground point at its resting height.
    const au = Math.hypot(q.x - g.hip.x, q.z - g.hip.z);
    const av = q.y + g.ankleY - g.hip.y;
    const du = au - g.F[0];
    const dv = av - g.F[1];
    const d = Math.min(Math.hypot(du, dv), (g.l1 + g.l2) * 0.999);
    const base = Math.atan2(dv, du);
    // Knee up: the femur rises above the line to the ankle.
    const cosA = (g.l1 * g.l1 + d * d - g.l2 * g.l2) / (2 * g.l1 * d);
    const alpha = base + Math.acos(Math.max(-1, Math.min(1, cosA)));
    const ku = g.F[0] + Math.cos(alpha) * g.l1;
    const kv = g.F[1] + Math.sin(alpha) * g.l1;
    const beta = Math.atan2(dv + g.F[1] - kv, du + g.F[0] - ku);
    const axis = g.axis;
    this.pose.q[this.i[`femur${l.name}`]].setFromAxisAngle(axis, -(alpha - g.a0));
    this.pose.q[this.i[`tibia${l.name}`]].setFromAxisAngle(axis, -(beta - g.b0 - (alpha - g.a0)));
    this.pose.q[this.i[`foot${l.name}`]].setFromAxisAngle(axis, beta - g.b0);
  }

  private poseBoom(dt: number, cmd: QuadCommand): void {
    let yaw = 0;
    let pitch = 0;
    let ext = 0;
    const wrist = 0;
    if (cmd.boomTarget) {
      this.inv.copy(this.world[this.i.body]).invert();
      const q = this.q.copy(cmd.boomTarget).applyMatrix4(this.inv).add(this.bodyPivot);
      const P = R.boomPivot;
      yaw = Math.atan2(q.x - P[0], q.z - P[2]);
      const h = Math.hypot(q.x - P[0], q.z - P[2]);
      const elev = Math.atan2(q.y - P[1], h);
      pitch = elev - R.boomRest;
      const dist = Math.hypot(h, q.y - P[1]);
      // The head's lens stands `standOff` short of the target.
      ext = Math.max(0, Math.min(1.5, dist - cmd.standOff - (R.outer + 0.12 + 0.23)));
    }
    // Drums turn and the stage slides at their own pace.
    const step = (cur: number, want: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, want - cur));
    const before = this.boom;
    const work = (want: number, cur: number, rate: number) => (dt > 0 ? Math.min(1, Math.abs(want - cur) / (rate * dt)) : 0);
    this.boomWork = Math.max(work(yaw, before.yaw, QUAD.boomTurn), work(pitch, before.pitch, QUAD.boomTurn), work(ext, before.ext, QUAD.boomSpeed));
    this.boom.yaw = step(this.boom.yaw, yaw, QUAD.boomTurn);
    this.boom.pitch = step(this.boom.pitch, pitch, QUAD.boomTurn);
    this.boom.ext = step(this.boom.ext, ext, QUAD.boomSpeed);
    this.boom.wrist = step(this.boom.wrist, wrist, QUAD.boomTurn);
    this.pose.q[this.i.boomYaw].setFromAxisAngle(Y, this.boom.yaw);
    this.pose.q[this.i.boom].setFromAxisAngle(X, -this.boom.pitch);
    this.pose.t[this.i.inner].set(0, Math.sin(R.boomRest), Math.cos(R.boomRest)).multiplyScalar(this.boom.ext);
    this.pose.q[this.i.tool].setFromAxisAngle(X, -this.boom.wrist);
  }
}
