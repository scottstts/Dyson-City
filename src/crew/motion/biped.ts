/**
 * The Hand's motion (docs/crew.md, "Motion"): a procedural walker driven by its root (where the
 * agent puts it, its heading and speed) that steps as a person does, and an upper body that holds
 * what its task asks.
 *
 *  - Feet are planted: a planted foot never slides. A gait phase steps them in turn (cadence from
 *    speed; 38 % of a cycle in swing), each step aimed at where the body will be when it lands, half
 *    a stance ahead. Standing or turning on the spot, the phase steps only while a foot is out of
 *    place, and stops with both feet down. The body turns with its feet: it never twists its hips
 *    past what the actuators allow while the feet catch up.
 *  - A step rolls: the heel lifts off the toe in late stance, the swing carries the toe up, the heel
 *    strikes and the foot rolls flat about it.
 *  - The pelvis rides an inverted pendulum (highest at mid-stance), sways over the stance foot and
 *    turns with the stride; the waist counters the turn, so the shoulders stay square; the arms
 *    swing opposite the legs; the head holds its gaze.
 *  - Every joint is driven as the actuators it is made of (models/hand.ts): legs are two-bone IK
 *    whose knee hinge is set by the foot (so the ankle needs only its pitch and roll), and the hip's
 *    rotation is split into its yaw, roll and pitch drums; the shoulder's into pitch, roll and yaw.
 *  - Crouch: the pelvis drops and sits back over planted feet, the torso leans over the knees.
 *
 * Every frame's pose stays inside the actuators' limits (HAND_LIMITS; tests/crewHand.test.ts walks,
 * turns, crouches and stops it and checks every frame).
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { FOREARM_AXIS, HAND_PIVOT, FOOT, FINGERS } from '../models/hand';
import { Pose, solveFK, segmentIndex, type RigDef } from '../rig';
import { alignFrames, angleAbout, localOf, solveHinge } from './ik';

const P = HAND_PIVOT;
const TAU = Math.PI * 2;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
/** The forearms' twist axes (the right's is the left's mirrored). */
const TWIST_L = new Vector3(...FOREARM_AXIS);
const TWIST_R = new Vector3(-FOREARM_AXIS[0], FOREARM_AXIS[1], FOREARM_AXIS[2]);

/** Gait constants. */
export const GAIT = {
  /** Fraction of a cycle a foot is in the air. */
  swing: 0.38,
  /** Cadence (steps/s) at rest and its rise per m/s; stepping round on the spot. */
  cadence0: 1.7,
  cadencePerSpeed: 0.45,
  cadenceTurn: 2.1,
  /** Lateral half-spacing of the feet, and their toe-out (rad). */
  track: 0.095,
  toeOut: 0.05,
  /** Swing clearance (m) and the most the heel rises off the toe (rad), the toe's lift at strike. */
  clearance: 0.075,
  heelRise: 0.32,
  strike: 0.14,
  /** A foot farther than this from its place (m, or rad of yaw) needs a step. */
  slack: 0.045,
  slackYaw: 0.2,
  /** The most the body turns ahead of its feet, and a stepping foot ahead of the body (rad). */
  bodyLead: 0.15,
  footLead: 0.25,
  /** The fastest the body turns on the spot (rad/s): agents keep their turns to it. */
  turnRate: 0.6,
  /** Pelvis: drop while walking (m), bob, sway, turn, roll. */
  drop: 0.022,
  bob: 0.011,
  sway: 0.016,
  turn: 0.06,
  roll: 0.03,
  /** Arm swing (rad) at walking pace. */
  armSwing: 0.24,
} as const;

export type ArmHold =
  | { kind: 'swing' }
  /** Hands to world targets (props' grips), elbows toward a pole; palms to world orientations. */
  | { kind: 'grip'; left: Vector3 | null; right: Vector3 | null; leftPalm?: Quaternion; rightPalm?: Quaternion }
  /** A posed hold: the slate held up to read (read = 1) or carried low (0). */
  | { kind: 'slate'; read: number };

export interface BipedCommand {
  /** The root: on the ground, between the feet (world x, z), facing `heading` (yaw about +y; 0 faces +z). */
  x: number;
  z: number;
  heading: number;
  /** Speed along the heading (m/s) and the heading's rate (rad/s), for the gait's prediction. */
  speed: number;
  turnRate: number;
  /** World point the head looks at, or null (ahead). */
  look: Vector3 | null;
  /** Crouch, 0 (standing) … 1 (deep). Eased by the walker. */
  crouch: number;
  /** Torso lean forward (rad), added to the crouch's. */
  lean: number;
  arms: ArmHold;
  /** Ground height under a plan point. */
  ground(x: number, z: number): number;
}

interface FootState {
  side: 1 | -1;
  /** Where the foot is placed: the ground point under its ankle, and its yaw. */
  place: Vector3;
  yaw: number;
  swinging: boolean;
  from: Vector3;
  fromYaw: number;
  fromPitch: number;
  to: Vector3;
  toYaw: number;
  /** Swing start (s) and length. */
  t0: number;
  dur: number;
  /** When it last landed (s). */
  landed: number;
  /** Strike angle it landed with (toe up). */
  strike: number;
  /** How hard it lands (0 … ~1.2: the step's speed), for its sound. */
  force: number;
  /** The heel's rise about the toe it last stood with (rad): the swing starts from it. */
  rise: number;
}

/** Minimum-jerk easing. */
const mj = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (10 - 15 * t + 6 * t * t);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const ANKLE = new Vector3(...P.ankle);
/** Toe and heel contact points relative to the ankle (rest). */
const TOE = new Vector3(0, -P.ankle[1], FOOT.toe - P.ankle[2]);
const HEEL = new Vector3(0, -P.ankle[1], FOOT.heel - P.ankle[2]);

const SEGMENTS = ['pelvis', 'waistYaw', 'torso', 'neckYaw', 'head'] as const;
const SIDED = ['shoulderPitch', 'shoulderRoll', 'upperArm', 'forearm', 'wrist', 'palm', 'thumb', 'hipYaw', 'hipRoll', 'thigh', 'shin', 'ankle', 'foot'] as const;

export class BipedMotion {
  readonly rig: RigDef;
  readonly pose: Pose;
  readonly root = new Matrix4();
  readonly world: Matrix4[];
  /** Seconds of motion so far. */
  time = 0;
  /** Gait phase (cycles) and whether it is stepping. */
  phase = 0;
  stepping = false;
  /** The body's facing (rad): the root's heading, held within reach of the feet. */
  facing: number;
  /** Smoothed walking share (0 standing … 1 walking pace). */
  private walk = 0;
  private crouchNow = 0;
  private leanNow = 0;
  private readonly feet: [FootState, FootState];
  private readonly i: Record<string, number>;
  private readonly limb = { l1: 0, l2: 0 };
  private readonly arm = { l1: 0, l2: 0 };
  private readonly restThigh = new Vector3();
  private readonly restShin = new Vector3();
  private readonly restUpper = new Vector3();
  private readonly restFore = [new Vector3(), new Vector3()];
  /** The head's look, eased (yaw, pitch relative to the torso). */
  private lookYaw = 0;
  private lookPitch = 0;
  private grip = 0;

  constructor(rig: RigDef, x: number, z: number, heading: number, ground: (x: number, z: number) => number) {
    this.rig = rig;
    this.pose = new Pose(rig.segments.length);
    this.world = rig.segments.map(() => new Matrix4());
    this.i = {};
    for (const n of SEGMENTS) this.i[n] = segmentIndex(rig, n);
    for (const n of SIDED) for (const s of ['L', 'R']) this.i[`${n}${s}`] = segmentIndex(rig, `${n}${s}`);
    for (const f of FINGERS) for (const s of ['L', 'R']) this.i[`${f.name}${s}`] = segmentIndex(rig, `${f.name}${s}`);
    const H = new Vector3(...P.hip);
    const K = new Vector3(...P.knee);
    this.limb.l1 = H.distanceTo(K);
    this.limb.l2 = K.distanceTo(ANKLE);
    this.restThigh.subVectors(K, H).normalize();
    this.restShin.subVectors(ANKLE, K).normalize();
    const S = new Vector3(...P.shoulder);
    const E = new Vector3(...P.elbow);
    const W = new Vector3(...P.wrist);
    this.arm.l1 = S.distanceTo(E);
    this.arm.l2 = E.distanceTo(W);
    this.restUpper.subVectors(E, S).normalize();
    this.restFore[0].subVectors(W, E).normalize();
    this.restFore[1].copy(this.restFore[0]).setX(-this.restFore[0].x);
    const mk = (side: 1 | -1): FootState => {
      const place = this.home(x, z, heading, side, ground, 0, new Vector3());
      return { side, place, yaw: heading + side * GAIT.toeOut, swinging: false, from: place.clone(), fromYaw: heading, fromPitch: 0, to: place.clone(), toYaw: heading, t0: 0, dur: 0.4, landed: -10, strike: 0, force: 0, rise: 0 };
    };
    this.feet = [mk(1), mk(-1)];
    this.facing = heading;
  }

  /** Where a foot belongs under a root (its ground point under the ankle). */
  private home(x: number, z: number, heading: number, side: 1 | -1, ground: (x: number, z: number) => number, ahead: number, out: Vector3): Vector3 {
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    // Root frame: +x left (side +1), +z forward.
    const lx = side * GAIT.track;
    const px = x + c * lx + s * (ahead + P.ankle[2]);
    const pz = z - s * lx + c * (ahead + P.ankle[2]);
    return out.set(px, ground(px, pz), pz);
  }

  /** The feet's world places (ground points under the ankles), for walls and shade. */
  footPlace(k: 0 | 1): Vector3 {
    return this.feet[k].place;
  }

  /** How far into a crouch it is (0 … 1). */
  get crouched(): number {
    return this.crouchNow;
  }

  /** Whether both feet are down and the walker stands. */
  get settled(): boolean {
    return !this.stepping && !this.feet[0].swinging && !this.feet[1].swinging;
  }

  /** The feet's mean yaw (the swinging one's as it turns). */
  private feetYaw(): number {
    let sx = 0;
    let sz = 0;
    for (const f of this.feet) {
      let y = f.yaw - f.side * GAIT.toeOut;
      if (f.swinging) {
        const m = mj((this.time - f.t0) / f.dur);
        y = f.fromYaw + wrap(f.toYaw - f.fromYaw) * m - f.side * GAIT.toeOut;
      }
      sx += Math.sin(y);
      sz += Math.cos(y);
    }
    return Math.atan2(sx, sz);
  }

  update(dt: number, cmd: BipedCommand): void {
    this.time += dt;
    const t = this.time;
    const v = Math.max(0, cmd.speed);
    // Walking share, eased (the pelvis and arms follow it, not the raw speed).
    this.walk += (Math.min(1, v / 1.0) - this.walk) * (1 - Math.exp(-dt / 0.35));
    this.crouchNow += (cmd.crouch - this.crouchNow) * (1 - Math.exp(-dt / 0.45));
    this.leanNow += (cmd.lean - this.leanNow) * (1 - Math.exp(-dt / 0.5));
    const turning = Math.abs(cmd.turnRate) > 0.05 && v < 0.3;
    const cadence = Math.max(GAIT.cadence0 + GAIT.cadencePerSpeed * Math.min(v, 1.6), turning ? GAIT.cadenceTurn : 0);
    const cycle = 2 / cadence;
    const swingDur = GAIT.swing * cycle;
    // Does a foot need a step? Moving, or a foot out of place for where the root is now.
    const err = (f: FootState) => {
      const h = this.home(cmd.x, cmd.z, cmd.heading, f.side, cmd.ground, 0, this.homeV);
      return Math.max(Math.hypot(h.x - f.place.x, h.z - f.place.z) / GAIT.slack, Math.abs(wrap(cmd.heading + f.side * GAIT.toeOut - f.yaw)) / GAIT.slackYaw);
    };
    const need = v > 0.04 || Math.abs(cmd.turnRate) > 0.05 || err(this.feet[0]) > 1 || err(this.feet[1]) > 1;
    // Crouched, the feet stay where they are.
    const canStep = this.crouchNow < 0.05;
    const prev = this.phase;
    if ((need && canStep) || this.feet[0].swinging || this.feet[1].swinging) {
      this.stepping = true;
      // A planted foot left far behind (the body sped up under it) hurries the next step.
      let behind = 0;
      for (const f of this.feet) if (!f.swinging) behind = Math.max(behind, -((f.place.x - cmd.x) * Math.sin(cmd.heading) + (f.place.z - cmd.z) * Math.cos(cmd.heading)));
      const hurry = 1 + Math.min(0.6, Math.max(0, behind - 0.3) * 4);
      this.phase += (dt / cycle) * hurry;
    } else this.stepping = false;
    // Swing starts: the left foot at phase 0, the right at 0.5 (mod 1).
    for (const f of this.feet) {
      const start = f.side > 0 ? 0 : 0.5;
      const crossed = Math.floor(prev - start) !== Math.floor(this.phase - start);
      if (crossed && !f.swinging && need && canStep) this.lift(f, t, swingDur, cycle, v, cmd);
    }
    // Swing ends.
    for (const f of this.feet) {
      if (f.swinging && t >= f.t0 + f.dur) {
        f.swinging = false;
        f.place.copy(f.to);
        f.yaw = f.toYaw;
        f.landed = t;
        this.onStep?.(f.place.x, f.place.y, f.place.z, f.force);
      }
    }
    // Neither foot needs to step and both are down: hold the phase at the next boundary.
    if (!need && !this.feet[0].swinging && !this.feet[1].swinging) this.phase = Math.round(this.phase * 2) / 2;
    // The body faces the root's heading, but never further than its feet allow.
    const fy = this.feetYaw();
    this.facing = fy + Math.max(-GAIT.bodyLead, Math.min(GAIT.bodyLead, wrap(cmd.heading - fy)));
    this.posePelvis(cmd);
    this.poseLegs();
    this.poseUpper(dt, cmd);
  }

  private lift(f: FootState, t: number, dur: number, cycle: number, v: number, cmd: BipedCommand): void {
    // Where the body will be when the foot lands, and half a stance ahead of it.
    const lead = v * (1 - GAIT.swing) * cycle * 0.5;
    // Turning, the foot is set a little ahead of the turn, so the body need not wait for it, but
    // never further round than the hip's yaw allows from where the body faces now.
    const ahead = wrap(cmd.heading + cmd.turnRate * dur * 1.6 - this.facing);
    const headingL = this.facing + Math.max(-GAIT.footLead, Math.min(GAIT.footLead, ahead));
    // Where the root will be as it lands: along the arc it is turning on (in a turn a straight-line
    // guess sets the inside foot under the body); the stance set square to its heading at mid-stance.
    const w = cmd.turnRate;
    const h0 = cmd.heading;
    let xL = cmd.x + Math.sin(h0) * v * dur;
    let zL = cmd.z + Math.cos(h0) * v * dur;
    if (Math.abs(w) > 1e-3) {
      xL = cmd.x + (v / w) * (Math.cos(h0) - Math.cos(h0 + w * dur));
      zL = cmd.z + (v / w) * (Math.sin(h0 + w * dur) - Math.sin(h0));
    }
    const hMid = h0 + w * (dur + (1 - GAIT.swing) * cycle * 0.5);
    f.from.copy(f.place);
    f.fromYaw = f.yaw;
    // (As it last stood: the phase has just wrapped past its lift, where the rise reads zero.)
    f.fromPitch = f.rise;
    this.home(xL, zL, hMid, f.side, cmd.ground, lead, f.to);
    f.toYaw = headingL + f.side * GAIT.toeOut;
    f.t0 = t;
    f.dur = dur;
    f.strike = GAIT.strike * Math.min(1, v / 0.9);
    // A step's force follows its speed (the walk at 1 m/s is 1); a foot set down turning or settling is light.
    f.force = Math.max(0.35, Math.pow(Math.min(v, 1.3), 0.7));
    f.swinging = true;
  }

  /** Heel rise of a planted foot (rad, toe down about the toe) as its lift nears, while walking. */
  private heelRise(f: FootState): number {
    if (f.swinging) return 0;
    const start = f.side > 0 ? 0 : 0.5;
    const toLift = (((start - this.phase) % 1) + 1) % 1;
    // A foot turned off the body's heading (a step in a turn) pivots on its ball: its heel barely rises.
    const turned = Math.abs(wrap(f.yaw - f.side * GAIT.toeOut - this.facing));
    return GAIT.heelRise * this.walk * Math.pow(1 - smooth(0, 0.16, toLift), 1.5) * (1 - 0.7 * smooth(0.12, 0.35, turned));
  }

  private readonly e = new Euler();
  private readonly pelvisQ = new Quaternion();
  private readonly torsoQ = new Quaternion();
  private readonly rootQ = new Quaternion();

  private posePelvis(cmd: BipedCommand): void {
    const w = this.walk;
    const ph = this.phase;
    const s = GAIT.swing;
    const groundY = cmd.ground(cmd.x, cmd.z);
    this.root.makeRotationY(this.facing).setPosition(cmd.x, groundY, cmd.z);
    this.rootQ.setFromAxisAngle(Y, this.facing);
    const bob = GAIT.bob * w * Math.cos(2 * TAU * (ph - s / 2));
    const sway = -GAIT.sway * w * Math.sin(TAU * (ph - s / 2 + 0.25));
    const c = this.crouchNow;
    // Crouched, the pelvis drops and sits back over the heels.
    this.pose.t[this.i.pelvis].set(sway, -GAIT.drop * w - 0.006 + bob - c * 0.34, -c * 0.13);
    const turn = GAIT.turn * w * Math.sin(TAU * (ph - s));
    const roll = GAIT.roll * w * Math.sin(TAU * (ph - s / 2 + 0.25));
    this.e.set(c * 0.18, -turn, roll, 'YXZ');
    this.pose.q[this.i.pelvis].setFromEuler(this.e);
    this.pelvisQ.copy(this.rootQ).multiply(this.pose.q[this.i.pelvis]);
    // The waist: its yaw drum counters the pelvis's turn; its pitch drum leans with the crouch and the task.
    this.pose.q[this.i.waistYaw].setFromAxisAngle(Y, turn * 0.85);
    this.pose.q[this.i.torso].setFromAxisAngle(X, this.leanNow + c * 0.24);
    this.torsoQ.copy(this.pelvisQ).multiply(this.pose.q[this.i.waistYaw]).multiply(this.pose.q[this.i.torso]);
  }

  private readonly hip = new Vector3();
  private readonly knee = new Vector3();
  private readonly ankle = new Vector3();
  private readonly end = new Vector3();
  private readonly fwdW = new Vector3();
  private readonly bend = new Vector3();
  private readonly reach = new Vector3();
  private readonly hingeW = new Vector3();
  private readonly dirA = new Vector3();
  private readonly dirB = new Vector3();
  private readonly footQ = new Quaternion();
  private readonly thighQ = new Quaternion();
  private readonly shinQ = new Quaternion();
  private readonly relQ = new Quaternion();
  private readonly tmpQ = new Quaternion();
  private readonly a0 = new Vector3();
  private readonly a1 = new Vector3();
  private readonly q0 = new Quaternion();
  private readonly q1 = new Quaternion();
  private readonly cW = new Vector3();
  private readonly homeV = new Vector3();
  /** Called as each foot lands (its ground point, and how hard), for its sound. */
  onStep: ((x: number, y: number, z: number, force: number) => void) | null = null;
  private readonly armS = new Vector3();
  private readonly armE = new Vector3();
  private readonly armW = new Vector3();
  private readonly pole = new Vector3();
  private readonly back = new Vector3();
  private readonly upperDir = new Vector3();
  private readonly foreDir = new Vector3();
  private readonly hinge = new Vector3();
  private readonly upperQ = new Quaternion();
  private readonly foreQ = new Quaternion();

  /** The foot's world ankle position and orientation from its state (planted, rolling or swinging). */
  private footPose(f: FootState, t: number, outAnkle: Vector3, outQ: Quaternion): void {
    if (f.swinging) {
      // From the toe-off (pitched about the toe) to the strike (toe up, about the heel), along an arc.
      const u = Math.min(1, Math.max(0, (t - f.t0) / f.dur));
      const m = mj(u);
      this.rollAbout(f.from, f.fromYaw, f.fromPitch, TOE, this.a0, this.q0);
      this.rollAbout(f.to, f.toYaw, -f.strike, HEEL, this.a1, this.q1);
      const step = Math.min(1, Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z) / 0.25);
      outAnkle.lerpVectors(this.a0, this.a1, m);
      outAnkle.y += GAIT.clearance * (0.35 + 0.65 * step) * Math.pow(Math.sin(Math.PI * u), 0.85);
      const yaw = f.fromYaw + wrap(f.toYaw - f.fromYaw) * m;
      const pitch = f.fromPitch * (1 - smooth(0, 0.45, u)) - f.strike * smooth(0.45, 1, u);
      outQ.setFromAxisAngle(Y, yaw).multiply(this.tmpQ.setFromAxisAngle(X, pitch));
      return;
    }
    // Planted: the heel strike rolls flat about the heel, then late in stance the heel rises off the toe.
    const settle = f.strike * (1 - smooth(0, 0.11, t - f.landed));
    const rise = this.heelRise(f);
    f.rise = settle > rise ? 0 : rise;
    if (settle > rise) this.rollAbout(f.place, f.yaw, -settle, HEEL, outAnkle, outQ);
    else this.rollAbout(f.place, f.yaw, rise, TOE, outAnkle, outQ);
  }

  /**
   * A foot whose ground point (under its ankle) is `ground`, at a yaw, pitched by `pitch` about a
   * contact point (given relative to the ankle in the rest pose): the contact stays on the ground.
   */
  private rollAbout(ground: Vector3, yaw: number, pitch: number, contact: Vector3, outAnkle: Vector3, outQ: Quaternion): void {
    outQ.setFromAxisAngle(Y, yaw).multiply(this.tmpQ.setFromAxisAngle(X, pitch));
    this.cW.set(contact.x, 0, contact.z).applyAxisAngle(Y, yaw);
    this.cW.x += ground.x;
    this.cW.y = ground.y;
    this.cW.z += ground.z;
    outAnkle.copy(contact).negate().applyQuaternion(outQ).add(this.cW);
  }

  /**
   * The legs: the knee's hinge is set so the ankle's two drums (pitch, then roll about the foot's
   * length) can reach the foot's orientation: it is ⟂ both the foot's length and the reach.
   */
  private poseLegs(): void {
    solveFK(this.rig, this.root, this.pose, this.world);
    const pelvisW = this.world[this.i.pelvis];
    for (const f of this.feet) {
      const s = f.side > 0 ? 'L' : 'R';
      this.hip.set(f.side * P.hip[0] - P.pelvis[0], P.hip[1] - P.pelvis[1], P.hip[2] - P.pelvis[2]).applyMatrix4(pelvisW);
      this.footPose(f, this.time, this.ankle, this.footQ);
      this.fwdW.copy(Z).applyQuaternion(this.footQ);
      this.reach.subVectors(this.ankle, this.hip).normalize();
      this.hingeW.crossVectors(this.fwdW, this.reach).normalize();
      // The knee bends toward the toes.
      this.bend.crossVectors(this.reach, this.hingeW);
      if (this.bend.dot(this.fwdW) < 0) this.bend.negate();
      solveHinge(this.limb, this.hip, this.ankle, this.bend, this.knee, this.end);
      alignFrames(this.restThigh, X, this.dirA.subVectors(this.knee, this.hip).normalize(), this.hingeW, this.thighQ);
      alignFrames(this.restShin, X, this.dirB.subVectors(this.end, this.knee).normalize(), this.hingeW, this.shinQ);
      // The hip: yaw, roll, pitch (R = Ry · Rz · Rx).
      localOf(this.pelvisQ, this.thighQ, this.relQ);
      this.e.setFromQuaternion(this.relQ, 'YZX');
      this.pose.q[this.i[`hipYaw${s}`]].setFromAxisAngle(Y, this.e.y);
      this.pose.q[this.i[`hipRoll${s}`]].setFromAxisAngle(Z, this.e.z);
      this.pose.q[this.i[`thigh${s}`]].setFromAxisAngle(X, this.e.x);
      localOf(this.thighQ, this.shinQ, this.pose.q[this.i[`shin${s}`]]);
      // The ankle: pitch, then roll (R = Rx · Rz).
      localOf(this.shinQ, this.footQ, this.relQ);
      this.e.setFromQuaternion(this.relQ, 'XZY');
      this.pose.q[this.i[`ankle${s}`]].setFromAxisAngle(X, this.e.x);
      this.pose.q[this.i[`foot${s}`]].setFromAxisAngle(Z, this.e.z);
    }
  }

  /** Sets a shoulder's three drums: pitch (forward +), roll (outward +), yaw. */
  private shoulder(side: 1 | -1, pitch: number, roll: number, yaw: number): void {
    const n = side > 0 ? 'L' : 'R';
    this.pose.q[this.i[`shoulderPitch${n}`]].setFromAxisAngle(X, -pitch);
    this.pose.q[this.i[`shoulderRoll${n}`]].setFromAxisAngle(Z, side * roll);
    this.pose.q[this.i[`upperArm${n}`]].setFromAxisAngle(Y, side * yaw);
  }

  /** Sets an elbow (flexion +) and a wrist (twist, flex toward the palm +). */
  private forearm(side: 1 | -1, elbow: number, twist: number, flex: number): void {
    const n = side > 0 ? 'L' : 'R';
    this.pose.q[this.i[`forearm${n}`]].setFromAxisAngle(X, -elbow);
    this.pose.q[this.i[`wrist${n}`]].setFromAxisAngle(side > 0 ? TWIST_L : TWIST_R, side * twist);
    this.pose.q[this.i[`palm${n}`]].setFromAxisAngle(Z, -side * flex);
  }

  private poseUpper(dt: number, cmd: BipedCommand): void {
    const w = this.walk;
    const ph = this.phase;
    const s = GAIT.swing;
    // Arms: opposite the legs. The left leg is furthest forward as it lands (phase s).
    const swing = GAIT.armSwing * w * Math.cos(TAU * (ph - s));
    let gripTarget = 0.18;
    const hold = cmd.arms;
    for (const side of [1, -1] as const) {
      if (hold.kind === 'slate') {
        // Left: the slate held up before the chest (read = 1) or carried low (0); right: a hand on it.
        const r = hold.read;
        if (side > 0) {
          this.shoulder(1, 0.18 + 0.5 * r, 0.05, -0.25 * r);
          this.forearm(1, 0.5 + 1.0 * r, -0.6 * r, 0.15);
        } else {
          this.shoulder(-1, 0.1 + 0.42 * r - swing * 0.5 * (1 - r), 0.05, 0.22 * r);
          this.forearm(-1, 0.3 + 1.05 * r, 0.5 * r, 0.1);
        }
        gripTarget = side > 0 ? 0.95 : 0.25;
      } else if (hold.kind === 'grip' && (side > 0 ? hold.left : hold.right)) {
        this.reachArm(side, (side > 0 ? hold.left : hold.right)!, side > 0 ? hold.leftPalm : hold.rightPalm);
        gripTarget = 1.05;
      } else {
        // Relaxed: swinging opposite the legs, elbows easing as the arm comes forward.
        const a = side > 0 ? -swing : swing;
        const c = this.crouchNow;
        this.shoulder(side, a + c * 0.55, 0.07 + c * 0.05, 0);
        this.forearm(side, 0.2 + Math.max(0, a) * 0.6 + Math.max(0, -a) * 0.15 + c * 0.6, 0, 0);
      }
    }
    // Fingers close on what the hands hold, and relax otherwise.
    this.grip += (gripTarget - this.grip) * (1 - Math.exp(-dt / 0.25));
    for (const f of FINGERS) {
      for (const n of ['L', 'R'] as const) this.pose.q[this.i[`${f.name}${n}`]].setFromAxisAngle(Z, (n === 'L' ? -1 : 1) * this.grip * (f.name === 'little' ? 1.08 : 1));
    }
    for (const n of ['L', 'R'] as const) this.pose.q[this.i[`thumb${n}`]].setFromAxisAngle(Z, (n === 'L' ? -1 : 1) * this.grip * 0.45);
    // Head: toward the look point, eased, within the neck's range; level otherwise.
    let yaw = 0;
    let pitch = this.crouchNow * 0.25;
    if (cmd.look) {
      solveFK(this.rig, this.root, this.pose, this.world);
      const headP = this.hip.setFromMatrixPosition(this.world[this.i.head]);
      const d = this.dirA.subVectors(cmd.look, headP).applyQuaternion(this.tmpQ.copy(this.torsoQ).invert());
      yaw = Math.atan2(d.x, d.z);
      pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    yaw = Math.max(-0.95, Math.min(0.95, yaw));
    pitch = Math.max(-0.5, Math.min(0.55, pitch));
    const k = 1 - Math.exp(-dt / 0.3);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    this.pose.q[this.i.neckYaw].setFromAxisAngle(Y, this.lookYaw);
    this.pose.q[this.i.head].setFromAxisAngle(X, this.lookPitch);
    solveFK(this.rig, this.root, this.pose, this.world);
  }

  /** An arm reaching a world target with its wrist, the elbow out and back; its palm to an orientation. */
  private reachArm(side: 1 | -1, target: Vector3, palm?: Quaternion): void {
    const n = side > 0 ? 'L' : 'R';
    solveFK(this.rig, this.root, this.pose, this.world);
    const S = this.armS.setFromMatrixPosition(this.world[this.i[`shoulderPitch${n}`]]);
    const back = this.back.set(0, 0, -1).applyQuaternion(this.torsoQ);
    const pole = this.pole.set(side, 0, 0).applyQuaternion(this.torsoQ).multiplyScalar(0.6).add(back).addScaledVector(Y, -0.4).normalize();
    const E = this.armE;
    const W = this.armW;
    solveHinge(this.arm, S, target, pole, E, W);
    const upperDir = this.upperDir.subVectors(E, S).normalize();
    const foreDir = this.foreDir.subVectors(W, E).normalize();
    const hinge = this.hinge.crossVectors(foreDir, upperDir);
    // A straight arm has no plane of its own: keep the resting one.
    if (hinge.lengthSq() < 1e-8) hinge.copy(X).applyQuaternion(this.torsoQ);
    hinge.normalize();
    const upperQ = this.upperQ;
    const foreQ = this.foreQ;
    alignFrames(this.restUpper, X, upperDir, hinge, upperQ);
    alignFrames(this.restFore[side > 0 ? 0 : 1], X, foreDir, hinge, foreQ);
    // The shoulder: pitch, roll, yaw (R = Rx · Rz · Ry).
    localOf(this.torsoQ, upperQ, this.relQ);
    this.e.setFromQuaternion(this.relQ, 'XZY');
    this.pose.q[this.i[`shoulderPitch${n}`]].setFromAxisAngle(X, this.e.x);
    this.pose.q[this.i[`shoulderRoll${n}`]].setFromAxisAngle(Z, this.e.z);
    this.pose.q[this.i[`upperArm${n}`]].setFromAxisAngle(Y, this.e.y);
    localOf(upperQ, foreQ, this.pose.q[this.i[`forearm${n}`]]);
    if (!palm) {
      this.pose.q[this.i[`wrist${n}`]].identity();
      this.pose.q[this.i[`palm${n}`]].identity();
      return;
    }
    // The wrist: twist about the forearm, then flex about z (R = R_twist · Rz). The twist is read
    // from where the flex axis must point; the flex is what remains.
    localOf(foreQ, palm, this.relQ);
    const axis = side > 0 ? TWIST_L : TWIST_R;
    const zImg = this.dirA.copy(Z).applyQuaternion(this.relQ);
    const twist = angleAbout(Z, zImg, axis);
    const tq = this.pose.q[this.i[`wrist${n}`]].setFromAxisAngle(axis, twist);
    const rest = this.tmpQ.copy(tq).invert().multiply(this.relQ);
    const xImg = this.dirB.copy(X).applyQuaternion(rest);
    this.pose.q[this.i[`palm${n}`]].setFromAxisAngle(Z, Math.atan2(xImg.y, xImg.x));
  }
}
