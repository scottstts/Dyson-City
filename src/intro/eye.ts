/**
 * The Guardian's eye (docs/intro-film.md): where the camera is and where it looks at every moment
 * of the intro. There is no body in the scene; the camera is the head and its eyes.
 *
 *  - Where it looks is a person's attention (gaze.ts): someone arriving at a wonder for the first
 *    time looks about a great deal, from one thing to the next, with small looks about each thing
 *    they hold; not a camera panning and settling.
 *  - Seated (scenes 1 and 2): in the pilot's seat, in the ship's frame. The head turns about the
 *    neck, so the eye swings as it does in a person, and the ship carries it. Breathing moves it.
 *  - On foot (scene 3): to the door, waiting inside it while it opens and the stair comes down,
 *    down the stair, a couple of steps toward the gate, round to face the ship and backing slowly
 *    away from it while it leaves, watching it go, then round to the gate. The head moves with the
 *    gait (player/headMotion.ts) and the feet strike the floor (foot events for sound). The last
 *    frame is exactly the game's first view.
 *
 * Gaze convention as the player's (player/controller.ts): yaw about +y with yaw 0 looking north
 * (−z) and −π/2 east, pitch up positive, roll; Euler order YXZ. Seated gazes are given relative to
 * the ship's nose: yaw + to port, so −π/2 is added to face +x of the ship's frame.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { HeadMotion } from '../player/headMotion';
import { EYE_HEIGHT } from '../world/constants';
import type { FootEvent } from '../player/controller';
import { VIEWPOINTS } from '../debug/viewpoints';
import { EYE, FLOOR_Y, STAIR, DOOR } from './ship/spec';
import { HINGE, STAIR_PITCH, TREADS, stairPose, stairState, treadCentre } from './ship/stair';
import { doorOffset, DOOR_TIME } from './ship/door';
import { LANDING } from './flight';
import { Gaze, type Angles, type Fixation, type Target } from './gaze';
import type { Timeline } from './timeline';

const rad = (d: number) => (d * Math.PI) / 180;
/** Seated gaze relative to the ship's nose (degrees: yaw + to port, pitch up). */
const look = (yaw: number, pitch: number, roll = 0): Angles => ({ yaw: rad(yaw), pitch: rad(pitch), roll: rad(roll) });

const minJerk = (u: number) => {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Distance along a move of `T` s at time τ, as a share: eased in and out over `ramp` s, steady between. */
function trapezoid(tau: number, T: number, ramp: number): number {
  const r = Math.min(ramp, T / 2);
  const v = 1 / (T - r);
  if (tau <= 0) return 0;
  if (tau >= T) return 1;
  if (tau < r) return (v * tau * tau) / (2 * r);
  if (tau > T - r) return 1 - (v * (T - tau) * (T - tau)) / (2 * r);
  return v * (tau - r / 2);
}

/** The seated head's pivot (the neck) relative to the eye, in the head's frame (right, up, back). */
const NECK = new Vector3(0, -0.12, 0.085);
const ONE = new Vector3(1, 1, 1);

/** Where the game begins: the West Gate viewpoint (debug/viewpoints.ts), the intro's last frame. */
export const HOME = VIEWPOINTS.gate;

/** Ship frame → world, standing on its gear at the landing spot. */
const LANDED = new Matrix4().makeTranslation(LANDING.x, 0, LANDING.z);
const toWorld = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(LANDED);

/** Scene 3's route (world, at floor level): the cabin, the door, the stair, the apron. */
const FIRST_TREAD = treadCentre(0);
const LAST_TREAD = treadCentre(TREADS.length - 1);
const FOOT_Z = HINGE.out - STAIR.length * Math.cos(STAIR_PITCH) - 0.3;
const ROUTE = (() => {
  const stairFoot = toWorld(DOOR.x, 0, FOOT_Z);
  const home = new Vector3(HOME.position[0], 0, HOME.position[1]);
  // A couple of steps from the stair's foot toward where the game begins.
  const forward = stairFoot.clone().add(home.clone().sub(stairFoot).setLength(1.5));
  return {
    start: toWorld(6.05, FLOOR_Y, -0.35),
    aisle: toWorld(4.6, FLOOR_Y, -1.2),
    /** Inside the door, a pace back from it, while it opens and the stair comes down. */
    wait: toWorld(DOOR.x + 0.1, FLOOR_Y, -1.7),
    threshold: toWorld(DOOR.x, FLOOR_Y, -2.72),
    stairTop: toWorld(FIRST_TREAD[0], FIRST_TREAD[1], FIRST_TREAD[2]),
    lastTread: toWorld(LAST_TREAD[0], LAST_TREAD[1], LAST_TREAD[2]),
    stairFoot,
    forward,
    home,
  };
})();

/** Standing eye height: the player's, so the handoff is exact. */
const STAND = EYE_HEIGHT;

/** A world point as a gaze target (yaw, pitch from the eye). */
function at(p: Vector3 | ((t: number) => Vector3)): Target {
  return (t, eye) => {
    const q = typeof p === 'function' ? p(t) : p;
    const dx = q.x - eye.x;
    const dy = q.y - eye.y;
    const dz = q.z - eye.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), roll: 0 };
  };
}

export interface EyeFrame {
  /** Camera world matrix. */
  matrix: Matrix4;
  /** The feet (world), for the sound of the steps and what stands where. */
  feet: Vector3;
  /** Inside the ship's cabin (sealed or not, the door decides). */
  aboard: boolean;
}

export class Eye {
  private readonly tl: Timeline;
  private readonly head = new HeadMotion();
  private readonly g: Angles = { yaw: 0, pitch: 0, roll: 0 };
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly q = new Quaternion();
  private readonly local = new Matrix4();
  private readonly pos = new Vector3();
  private readonly neck = new Vector3();
  private readonly eyeAt = new Vector3();
  private readonly seatedEye = (): Vector3 => this.eyeAt;
  /** The standing eye at any moment of scene 3 (its route is a function of time; the gait's sway aside). */
  private readonly standingEye = (t: number): Vector3 => this.route(t, this.eyeAt).setY(this.eyeAt.y + STAND);
  private readonly lastFeet = new Vector3();
  private readonly lastVelocity: [number, number] = [0, 0];
  /** The ship's frame this frame (the scene-3 targets on it follow it). */
  private readonly ship = new Matrix4();
  private stairStep = -1;
  /** Where the walk ends: the spawn's point on the game's ground. */
  private readonly home: Vector3;
  readonly frame: EyeFrame = { matrix: new Matrix4(), feet: new Vector3(), aboard: true };
  /** Foot events since the last update. */
  readonly feetEvents: FootEvent[] = [];
  private readonly seated1: Gaze;
  private readonly seated2: Gaze;
  private readonly standing: Gaze;

  /**
   * `ground` is the game's walkable ground (city/walk.ts): where the walk ends the feet stand on
   * it, as the player's will (the apron's slab there is 1.5 cm over the deck).
   */
  constructor(tl: Timeline, ground: (x: number, z: number) => number = () => 0) {
    this.tl = tl;
    this.home = ROUTE.home.clone().setY(ground(ROUTE.home.x, ROUTE.home.z));
    const s1 = tl.scene1;
    const s2 = tl.scene2;
    const s3 = tl.scene3;
    const W = s1.wake;
    const L = tl.lines;
    const f = (atT: number, target: Target, pace?: number, busy?: boolean): Fixation => ({ at: atT, target, pace, busy });

    // Scene 1. Slumped asleep; lifting the head, slow and heavy; a first look round the cockpit as
    // it comes to them where they are; out at the sphere. Aurelia's voice turns them up to the
    // speaker a moment, then their eyes wander over the sphere as she talks; their own line is awe,
    // the gaze going wide and slow across it; then down to the monitor, reading, and up again.
    this.seated1 = new Gaze([
      f(0, look(7, -24, 8), 1, false),
      f(W + 0.8, look(3, -10, 3), 0.35, false),
      f(W + 2.2, look(-6, -3, 0.5), 0.5),
      f(W + 3.4, look(38, 3), 0.8),
      f(W + 4.3, look(20, 20), 0.9),
      f(W + 5.1, look(-6, 9), 0.9),
      f(W + 5.9, look(-40, -1), 0.8),
      f(W + 7.0, look(-12, -5), 0.8),
      f(L[0] + 0.35, look(4, 27), 1.1),
      f(L[0] + 1.7, look(-10, -4)),
      f(L[0] + 4.2, look(-18, -9)),
      f(L[0] + 6.4, look(-5, 5)),
      f(L[0] + 8.8, look(-22, -12)),
      f(L[0] + 10.9, look(3, -2)),
      f(L[0] + 13.0, look(-13, 2)),
      f(L[1] + 0.3, look(-8, 7), 0.7),
      f(L[1] + 2.6, look(-26, -6), 0.6),
      f(L[1] + 5.4, look(-3, -10), 0.7),
      f(L[1] + 7.6, look(12, 4), 0.7),
      f(L[1] + 9.9, look(-16, 10), 0.6),
      f(L[1] + 12.2, look(-6, -4), 0.8),
      // Reading the monitor: the head settles on it and eases across its two diagrams.
      f(s1.monitor, look(-56, -21), 0.9, false),
      f(s1.monitor + 2.4, look(-60, -23), 0.45, false),
      f(s1.monitor + 4.6, look(-55, -22), 0.45, false),
      f(s1.monitorEnd - 0.3, look(-22, -6), 0.8),
    ], 11);

    // Scene 2. Low over the band: down at the Dome ahead, round the city under it, the band's
    // horizon, the arcs overhead; up to the speaker as Aurelia starts; the dash's readouts when
    // they answer; out either side as she brings the ship down; after touchdown, ahead to the gate,
    // and to her speaker when they talk to her.
    const H = s2.hover;
    const D = s2.touchdown;
    this.seated2 = new Gaze([
      f(0, look(2, -13)),
      f(s2.start + 0.9, look(-9, -18), 0.8),
      f(L[2] + 0.3, look(5, 25), 1.1),
      f(L[2] + 1.5, look(0, -15)),
      f(L[2] + 3.8, look(17, -9)),
      f(L[2] + 6.0, look(10, 22), 0.8),
      f(L[2] + 8.4, look(-4, -17)),
      f(L[2] + 10.6, look(-26, -5)),
      f(L[3] + 0.2, look(-5, -14)),
      f(L[3] + 1.8, look(1, -31), 1.2),
      f(L[3] + 3.1, look(-3, -15)),
      f(L[4], look(4, 21), 1.2),
      f(L[4] + 1.2, look(-6, -18)),
      f(H - 2.5, look(25, -24), 0.8),
      f(H + 0.6, look(-21, -27), 0.8),
      f(H + 2.9, look(9, -30)),
      f(D - 1.6, look(2, -9), 0.9),
      f(D + 0.9, look(-7, -3)),
      f(D + 1.8, look(19, 1)),
      f(L[5] + 0.3, look(4, 24), 1.1),
      f(L[5] + 1.8, look(0, -1)),
      f(L[5] + 4.6, look(-14, 5)),
      f(L[5] + 7.2, look(6, 11)),
      f(L[6] + 0.4, look(7, 22), 1.1),
      f(L[6] + 2.8, look(-3, -1)),
      f(L[6] + 5.9, look(12, -4)),
      f(L[7] + 0.5, look(-2, 9)),
      f(L[7] + 3.9, look(-11, -3)),
      f(L[7] + 7.2, look(3, -1)),
      f(L[8] + 0.1, look(1, 19), 1.1),
      f(L[8] + 1.9, look(-2, -3)),
    ], 23);

    // Scene 3 (world gaze). To the door; at the leaf as it slides; out through the opening; the
    // stair running out and swinging down; down the treads, a look up at the Dome on the way;
    // ahead to the gate and up its arch; round to the ship, then its door and stair closing up, the
    // engines spooling, the lift (a glance down at the wash), the climb and the turn away, following
    // it out; and round to the gate.
    const ship = this.ship;
    const onShip = (x: number, y: number, z: number) => (): Vector3 => SHIP_POINT.set(x, y, z).applyMatrix4(ship);
    const leaf = (t: number) => {
      const o = doorOffset(Math.min(Math.max(t - s3.doorOpen, 0), DOOR_TIME)).offset;
      return SHIP_POINT.set(DOOR.x + o[0], 3.4, -2.95 + o[2]).applyMatrix4(LANDED);
    };
    const stairEnd = (t: number) => {
      const st = stairState(Math.max(t - s3.stairOut, 0));
      return SHIP_POINT.set(0, STAIR.length, 0).applyMatrix4(stairPose(st.run, st.pitch, STAIR_M)).applyMatrix4(LANDED);
    };
    const gate = new Vector3(-503, 9, 1);
    // The ground ahead past where the feet will go (a look at a point the feet walk over would spin
    // round as they pass it).
    const beyondFoot = ROUTE.stairFoot.clone().add(new Vector3(0, 0, ROUTE.stairFoot.z - ROUTE.lastTread.z).setLength(2.2));
    const ahead = ROUTE.forward.clone().add(ROUTE.forward.clone().sub(ROUTE.stairFoot).setLength(2.5));
    this.standing = new Gaze([
      f(0, at(ROUTE.aisle.clone().setY(FLOOR_Y + 1.1))),
      f(s3.walk + 0.25, at(ROUTE.aisle.clone().setY(FLOOR_Y)), 1.2),
      f(s3.walk + 0.9, at(toWorld(DOOR.x, 3.4, -2.95))),
      f(s3.doorOpen + 0.5, at(leaf), 0.9),
      f(s3.doorOpen + 2.4, at(toWorld(DOOR.x - 1.5, 1.6, -14))),
      f(s3.stairOut + 0.4, at(stairEnd)),
      f(s3.stairOut + 2.2, at(stairEnd), 1, false),
      f(s3.stepOut - 0.3, at(beyondFoot), 1.1),
      f(s3.descend + 0.3, at(beyondFoot), 1, false),
      f(s3.descend + 1.5, at(new Vector3(-480, 28, -30)), 0.9),
      f(s3.descend + 2.4, at(ahead), 1.1, false),
      f(s3.ground + 0.1, at(gate), 0.9),
      f(s3.ground + 1.2, at(new Vector3(-470, 95, -25)), 0.8),
      f(s3.stop - 0.1, at(onShip(1, 3.6, 0)), 0.55),
      f(s3.turnBack + 1.6, at(onShip(DOOR.x, 2.6, -3.2))),
      f(s3.stairIn + 0.7, at(onShip(DOOR.x, 1.0, -4.8))),
      f(s3.doorClose + 0.4, at(onShip(DOOR.x, 3.3, -3.0))),
      f(s3.spool + 0.2, at(onShip(-9.5, 3.8, -5))),
      f(s3.spool + 1.6, at(onShip(2, 3.0, 0))),
      f(s3.liftoff + 2.2, at(onShip(2, -1.5, 0)), 1.2),
      f(s3.liftoff + 3.0, at(onShip(0, 3.0, 0))),
      f(s3.depart + 4.5, at(onShip(-2, 3.0, 0)), 1, false),
      // Round to the gate: settled exactly by the last frame (the spring's residue there is ~0.01°).
      f(s3.turnHome, { yaw: HOME.yaw, pitch: HOME.pitch, roll: 0 }, 0.9, false),
    ], 37, s3.end - 0.9);
  }

  /** Clears the walking state (after a jump in time). */
  reset(): void {
    this.head.update(10, { speed: 0, walkSpeed: 2, runSpeed: 5.6, grounded: true, accelForward: 0, accelRight: 0 });
    this.stairStep = -1;
    this.lastVelocity[0] = 0;
    this.lastVelocity[1] = 0;
  }

  /** The eye at time t; `ship` is the ship's world matrix. */
  update(t: number, dt: number, ship: Matrix4): EyeFrame {
    this.feetEvents.length = 0;
    this.ship.copy(ship);
    const tl = this.tl;
    const f = this.frame;
    if (t < tl.scene3.start) {
      // Seated: the neck in the ship's frame, the head turned about it.
      // Seated gazes are angles in the ship's frame: no eye position needed.
      (t < tl.scene2.start ? this.seated1 : this.seated2).at(t, this.seatedEye, this.g);
      // Breathing: a slow nod and sway.
      const breath = Math.sin(t * 2 * Math.PI * 0.23);
      this.euler.set(this.g.pitch + breath * 0.0035, -Math.PI / 2 + this.g.yaw + Math.sin(t * 0.37) * 0.004, (this.g.roll ?? 0) + Math.sin(t * 0.29 + 1) * 0.003);
      this.q.setFromEuler(this.euler);
      // The pivot sits behind and below the eye with the head level and facing the nose.
      this.neck.set(EYE[0] - NECK.z, EYE[1] + breath * 0.002 + NECK.y, EYE[2]);
      this.pos.copy(NECK).negate().applyQuaternion(this.q).add(this.neck);
      this.local.compose(this.pos, this.q, ONE);
      f.matrix.multiplyMatrices(ship, this.local);
      f.feet.set(EYE[0] + 0.45, FLOOR_Y, EYE[2]).applyMatrix4(ship);
      f.aboard = true;
      return f;
    }
    // On foot: along the route, the head moving with the gait.
    const s3 = tl.scene3;
    const feet = this.route(t, f.feet);
    const inv = 1 / Math.max(dt, 1e-4);
    const vx = (feet.x - this.lastFeet.x) * inv;
    const vz = (feet.z - this.lastFeet.z) * inv;
    const speed = dt > 0 ? Math.hypot(vx, vz) : 0;
    const ax = (vx - this.lastVelocity[0]) * inv;
    const az = (vz - this.lastVelocity[1]) * inv;
    this.lastVelocity[0] = vx;
    this.lastVelocity[1] = vz;
    this.lastFeet.copy(feet);
    this.standing.at(t, this.standingEye, this.g);
    const onStair = t >= s3.descend && t < s3.ground;
    const sy = Math.sin(this.g.yaw);
    const cy = Math.cos(this.g.yaw);
    this.head.update(dt, {
      speed: onStair ? 0 : speed,
      walkSpeed: 2.0,
      runSpeed: 5.6,
      grounded: true,
      accelForward: dt > 0 ? -sy * ax - cy * az : 0,
      accelRight: dt > 0 ? cy * ax - sy * az : 0,
    });
    if (this.head.stepped) this.feetEvents.push({ kind: 'step', speed, run: 0, crouch: false });
    let dip = 0;
    if (onStair) {
      // A step down every tread: the eye drops onto each and the foot strikes it.
      const u = (t - s3.descend) / (s3.ground - s3.descend);
      const k = u * (STAIR.treads + 1);
      const step = Math.floor(k);
      if (step !== this.stairStep && step >= 0) {
        this.stairStep = step;
        this.feetEvents.push({ kind: 'step', speed: 1.1, run: 0, crouch: false });
      }
      const within = k - step;
      dip = -0.035 * Math.sin(Math.PI * Math.min(within / 0.45, 1));
    } else if (t >= s3.ground && this.stairStep <= STAIR.treads) {
      this.stairStep = STAIR.treads + 1;
    }
    for (const stop of [s3.stop, s3.backEnd]) if (t >= stop && t < stop + dt * 1.5) this.feetEvents.push({ kind: 'stop' });
    // Settling into the handoff over its last moments: the gait's sway and what is left of the turn
    // ease out, so the last frame is the player's spawn exactly without a step onto it. (Cut on the
    // last frame instead, they jumped the view 0.6°.)
    const b = smoothstep01((t - (s3.end - SETTLE)) / SETTLE);
    const h = this.head;
    const freeYaw = this.g.yaw + h.yaw * (1 - b);
    const yaw = freeYaw + wrapAngle(HOME.yaw - freeYaw) * b;
    const pitch = (this.g.pitch + h.pitch * (1 - b)) * (1 - b) + HOME.pitch * b;
    const roll = ((this.g.roll ?? 0) + h.roll) * (1 - b);
    this.euler.set(pitch, yaw, roll);
    this.q.setFromEuler(this.euler);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const right = h.right * (1 - b);
    this.pos.set(feet.x + rx * right, feet.y + STAND + h.up * (1 - b) + dip, feet.z + rz * right);
    f.matrix.compose(this.pos, this.q, ONE);
    f.aboard = t < s3.descend;
    return f;
  }

  /** The feet along scene 3's route at t (world). */
  private route(t: number, out: Vector3): Vector3 {
    const s3 = this.tl.scene3;
    const R = ROUTE;
    const lerp = (a: Vector3, b: Vector3, u: number) => out.copy(a).lerp(b, Math.min(Math.max(u, 0), 1));
    const legs = (a: Vector3, b: Vector3, c: Vector3, u: number, split: number) => (u < split ? lerp(a, b, u / split) : lerp(b, c, (u - split) / (1 - split)));
    if (t < s3.walk) return out.copy(R.start);
    // To the door as it opens, and a pace back from it.
    const arrive = s3.doorOpen + 0.9;
    if (t < arrive) return legs(R.start, R.aisle, R.wait, minJerk((t - s3.walk) / (arrive - s3.walk)), 0.5);
    // Waiting there until the door is open and the stair is down.
    if (t < s3.stepOut) return out.copy(R.wait);
    // Out through the door onto the stair's head.
    if (t < s3.descend) return legs(R.wait, R.threshold, R.stairTop, minJerk((t - s3.stepOut) / (s3.descend - s3.stepOut)), 0.55);
    if (t < s3.ground) {
      // Tread to tread down the flight, then the step off its foot onto the ground.
      const u = (t - s3.descend) / (s3.ground - s3.descend);
      const k = TREADS.length / (TREADS.length + 1);
      return u < k ? lerp(R.stairTop, R.lastTread, u / k) : lerp(R.lastTread, R.stairFoot, (u - k) / (1 - k));
    }
    // A couple of steps toward the gate.
    if (t < s3.back) return lerp(R.stairFoot, R.forward, minJerk((t - s3.ground) / (s3.stop - s3.ground)));
    // Backing slowly away from the ship to where the game begins: easing in, steady, easing out.
    return lerp(R.forward, this.home, trapezoid(t - s3.back, s3.backEnd - s3.back, 1.4));
  }
}

/** How long the head settles into the handoff (s). */
const SETTLE = 1.6;
const smoothstep01 = (u: number) => {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * (3 - 2 * x);
};
const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** Scratch for the moving targets (each is read at once). */
const SHIP_POINT = new Vector3();
const STAIR_M = new Matrix4();
