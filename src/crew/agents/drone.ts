/**
 * A drone at work (docs/crew.md, "Behaviour"): it rests on its cradle or pad, then flies its sortie
 * (plan/air.ts) leg by leg and comes home.
 *
 *  - Each leg is a minimum-jerk move between stations (no lurch at either end); it holds each
 *    station with a slow hover drift, its camera on the work.
 *  - Its attitude follows its acceleration, as a multirotor's does: it tilts into a start and leans
 *    back to stop, banks into a sideways drift. It turns to face where it flies, or at a station
 *    what it inspects, at a measured rate.
 *  - The pad's Spotters launch only when the craft will not come in before they are home
 *    (`window`: seconds until the craft next enters the Dome).
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { Pose, solveFK, segmentIndex, type RigDef } from '../rig';
import { AIR, type Sortie } from '../plan/air';
import { FERRY, SPOTTER } from '../models/drones';
import { FIELD_Y } from '../../field/layout';
import { rng } from '../../field/kit/parts';
import { wrap } from '../motion/biped';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const G = 9.81;

interface Leg {
  a: Vector3;
  b: Vector3;
  T: number;
  /** Hold at b afterwards (s), and what to look at there. */
  dwell: number;
  look: Vector3 | null;
}

export class DroneAgent {
  readonly rig: RigDef;
  readonly pose: Pose;
  readonly root = new Matrix4();
  readonly world: Matrix4[];
  readonly sortie: Sortie;
  private readonly legs: Leg[];
  private readonly rand: () => number;
  private readonly bottom: number;
  readonly duration: number;
  state: 'rest' | 'fly' = 'rest';
  private leg = 0;
  private t = 0;
  private time = 0;
  private restUntil: number;
  /** World position, heading, and the attitude's tilt (for sound and the shade). */
  readonly pos = new Vector3();
  heading = 0;
  /** How hard its fans work (0 resting … 1 climbing), for its sound. */
  thrust = 0;
  private readonly vel = new Vector3();
  private readonly acc = new Vector3();
  private readonly i: Record<string, number> = {};
  private camYaw = 0;
  private camTilt = 0;

  constructor(rig: RigDef, sortie: Sortie, seed: number) {
    this.rig = rig;
    this.pose = new Pose(rig.segments.length);
    this.world = rig.segments.map(() => new Matrix4());
    for (const s of rig.segments) this.i[s.name] = segmentIndex(rig, s.name);
    this.sortie = sortie;
    this.rand = rng(seed);
    this.bottom = sortie.kind === 'spotter' ? SPOTTER.bottom : FERRY.bottom;
    const vmax = sortie.kind === 'spotter' ? AIR.spotterSpeed : AIR.ferrySpeed;
    // A station near the ground is a landing: the body stands its legs' height over it.
    const lift = (p: number[]) => new Vector3(p[0], p[1] + (p[1] < FIELD_Y + 8 ? this.bottom : 0), p[2]);
    const pts = [lift(sortie.home), ...sortie.stations.map((s) => lift(s.p))];
    this.legs = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const L = a.distanceTo(b);
      const vertical = Math.abs(b.y - a.y) > 0.8 * L;
      const v = vertical ? AIR.climb : vmax;
      const st = sortie.stations[k];
      this.legs.push({ a, b, T: Math.max(2.5, (1.875 * L) / v), dwell: st.dwell, look: st.look ? new Vector3(...st.look) : null });
    }
    this.duration = this.legs.reduce((t, l) => t + l.T + l.dwell, 0);
    this.pos.copy(pts[0]);
    this.heading = this.rand() * Math.PI * 2;
    this.restUntil = this.rand() * (sortie.rest[1] + 10);
  }

  /** Per frame. `window`: seconds until the craft next enters the Dome (∞ if it will not soon). */
  update(dt: number, window: number): void {
    this.time += dt;
    if (this.state === 'rest') {
      this.vel.set(0, 0, 0);
      this.acc.set(0, 0, 0);
      this.thrust = Math.max(0, this.thrust - dt / 1.5);
      const may = !this.sortie.pad || window > this.duration + 12;
      if (this.time >= this.restUntil && may) {
        this.state = 'fly';
        this.leg = 0;
        this.t = 0;
      }
    } else {
      const l = this.legs[this.leg];
      this.t += dt;
      const u = Math.min(1, this.t / l.T);
      // Minimum-jerk position, velocity and acceleration along the leg.
      const s = u * u * u * (10 - 15 * u + 6 * u * u);
      const ds = (30 * u * u - 60 * u * u * u + 30 * u * u * u * u) / l.T;
      const dds = (60 * u - 180 * u * u + 120 * u * u * u) / (l.T * l.T);
      const d = this.d.subVectors(l.b, l.a);
      this.pos.copy(l.a).addScaledVector(d, s);
      this.vel.copy(d).multiplyScalar(ds);
      this.acc.copy(d).multiplyScalar(dds);
      // Holding a station: a slow drift about it.
      const hold = this.t - l.T;
      if (hold > 0) {
        const k = Math.min(1, hold / 2) * (l.dwell > 0 ? 1 : 0);
        this.pos.x += Math.sin(this.time * 0.37 + this.leg) * 0.18 * k;
        this.pos.y += Math.sin(this.time * 0.53 + 1.3 * this.leg) * 0.1 * k;
        this.pos.z += Math.cos(this.time * 0.31 + 2.1 * this.leg) * 0.18 * k;
      }
      this.thrust = Math.min(1, 0.55 + Math.max(0, this.vel.y) * 0.18 + this.acc.length() * 0.1);
      if (this.t >= l.T + l.dwell) {
        this.leg++;
        this.t = 0;
        if (this.leg >= this.legs.length) {
          this.state = 'rest';
          this.restUntil = this.time + this.sortie.rest[0] + (this.sortie.rest[1] - this.sortie.rest[0]) * this.rand();
        }
      }
    }
    this.poseBody(dt);
  }

  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly d = new Vector3();

  private poseBody(dt: number): void {
    const l = this.legs[Math.min(this.leg, this.legs.length - 1)];
    // Facing: where it flies (level legs), or at a station what it looks at.
    let want = this.heading;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'fly' && hv > 0.6) want = Math.atan2(this.vel.x, this.vel.z);
    else if (this.state === 'fly' && l.look && this.t > l.T * 0.6) want = Math.atan2(l.look.x - this.pos.x, l.look.z - this.pos.z);
    const turn = wrap(want - this.heading);
    this.heading += Math.max(-0.6 * dt, Math.min(0.6 * dt, turn));
    // Tilt with the horizontal acceleration (in the body's frame): forward pitches the nose down.
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const af = this.acc.x * s + this.acc.z * c;
    const as = this.acc.x * c - this.acc.z * s;
    const pitch = Math.atan2(af, G);
    const roll = Math.atan2(as, G);
    this.q.setFromAxisAngle(Y, this.heading).multiply(this.q2.setFromAxisAngle(X, pitch)).multiply(this.q2.setFromAxisAngle(Z, -roll));
    this.root.makeRotationFromQuaternion(this.q).setPosition(this.pos);
    // The Spotter's camera: toward the station's work, or ahead and down in transit.
    if (this.i.gimbalYaw !== undefined) {
      let yaw = 0;
      let tilt = 0.25;
      if (this.state === 'fly' && l.look) {
        const d = this.d.subVectors(l.look, this.pos).applyQuaternion(this.q2.copy(this.q).invert());
        yaw = Math.atan2(d.x, d.z);
        tilt = Math.atan2(-d.y, Math.hypot(d.x, d.z));
      }
      const k = 1 - Math.exp(-dt / 0.5);
      this.camYaw += wrap(yaw - this.camYaw) * k;
      this.camTilt += (Math.max(-0.3, Math.min(1.2, tilt)) - this.camTilt) * k;
      this.pose.q[this.i.gimbalYaw].setFromAxisAngle(Y, this.camYaw);
      this.pose.q[this.i.camera].setFromAxisAngle(X, this.camTilt);
    }
    solveFK(this.rig, this.root, this.pose, this.world);
  }
}
