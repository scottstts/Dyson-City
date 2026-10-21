/**
 * A Hand at work (docs/crew.md, "Behaviour"). One agent drives one Hand's walker (motion/biped.ts)
 * through its job, a loop that never ends:
 *
 *  - field: its precinct's beat: walk to a post, turn to it, do the post's task (read the slate at
 *    a door, crouch at a rack's foot, stand looking up at the hero), go on to the next;
 *  - deck: up and down a run of the Cordon's deck, or round a gallery ring, stopping to look out;
 *  - mow: the front lawn's stripes behind the mower, turning onto the next stripe at each end;
 *  - hedge: along the yew hedges' faces with the trimmer, sweeping it over the face;
 *  - garden: the kitchen garden's beds (crouched, a hand in the soil) and the orchard's trees.
 *
 * Whatever is in its way (the player, the car, another robot) holds it until it moves; a person in
 * its way also gets a look. Props follow the hands that hold them.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { BipedMotion, type ArmHold, type BipedCommand } from '../motion/biped';
import { PathFollower } from './follow';
import type { RigDef } from '../rig';
import type { P2 } from '../nav';
import type { Beat } from '../plan/field';
import type { Deck } from '../plan/lines';
import type { EstatePlan } from '../plan/estate';
import { MOWER, TRIMMER } from '../models/props';
import { rng } from '../../field/kit/parts';

export type HandJob =
  | { kind: 'field'; beat: Beat }
  | { kind: 'deck'; deck: Deck }
  | { kind: 'mow'; plan: EstatePlan['mow'] }
  | { kind: 'hedge'; runs: EstatePlan['hedge']; links: P2[][] }
  | { kind: 'garden'; posts: EstatePlan['garden']; legs: P2[][] };

/** What a robot sees of the world it shares (crew.ts supplies it each frame). */
export interface Surroundings {
  /** Distance ahead (m) to whatever is in the way of a body of radius r at (x, z) heading h, or Infinity. */
  blocked(self: object, x: number, z: number, h: number, r: number): number;
  /** The player's eye, if near enough to be looked at. */
  person: Vector3 | null;
}

/** How far the mower's grip tilts the fingers down over its bar from level (rad). */
const MOWER_GRIP_TILT = 0.45;

/** Hands' walking pace (m/s): deliberate. */
export const HAND_PACE = { walk: 1.0, mow: 0.65, hedge: 0.32, deck: 0.85 } as const;

type Phase = 'walk' | 'face' | 'work';

const SLATE_IN_PALM = new Matrix4().makeTranslation(-0.0215, -0.074, 0.0);

export class HandAgent {
  readonly motion: BipedMotion;
  readonly follow: PathFollower;
  readonly job: HandJob;
  private readonly ground: (x: number, z: number) => number;
  private readonly rand: () => number;
  private phase: Phase = 'walk';
  private step = 0;
  private until = 0;
  private time = 0;
  /** The props it carries: their world matrices (null: not carried). */
  readonly slate: Matrix4 | null;
  readonly mower: Matrix4 | null;
  readonly trimmer: Matrix4 | null;
  /** The mower's rolled distance (its wheels turn by it). */
  rolled = 0;
  private readonly palmL: number;

  constructor(rig: RigDef, job: HandJob, ground: (x: number, z: number) => number, seed: number) {
    this.job = job;
    this.ground = ground;
    this.rand = rng(seed);
    const start = startOf(job);
    this.motion = new BipedMotion(rig, start[0], start[1], start[2], ground);
    this.follow = new PathFollower(start[0], start[1], start[2], { accel: 0.7, decel: 1.0, turn: 0.6, ahead: 0.7, corner: 0.75 });
    this.slate = job.kind === 'field' || job.kind === 'deck' ? new Matrix4() : null;
    this.mower = job.kind === 'mow' ? new Matrix4() : null;
    this.trimmer = job.kind === 'hedge' ? new Matrix4() : null;
    this.palmL = rig.segments.findIndex((s) => s.name === 'palmL');
    this.beginLeg();
  }

  /** The Hand's place (root), for the crew's spacing and the walls. */
  get x(): number {
    return this.follow.root.x;
  }
  get z(): number {
    return this.follow.root.z;
  }

  private beginLeg(): void {
    const j = this.job;
    this.phase = 'walk';
    if (j.kind === 'field') this.follow.set(j.beat.legs[this.step % j.beat.legs.length]);
    else if (j.kind === 'garden') this.follow.set(j.legs[this.step % j.legs.length]);
    else if (j.kind === 'deck') this.follow.set(deckLeg(j.deck, this.step));
    else if (j.kind === 'mow') {
      // Alternate passes and turns: step 2k is pass k, 2k + 1 the turn after it; then back again.
      const n = j.plan.passes.length;
      const cycle = 2 * (2 * n - 1);
      const k = this.step % cycle;
      const forward = k < 2 * n - 1;
      const kk = forward ? k : k - (2 * n - 1);
      if (kk % 2 === 0) {
        const p = j.plan.passes[forward ? kk / 2 : n - 1 - kk / 2];
        this.follow.set(forward ? [p.a, p.b] : [p.b, p.a]);
      } else {
        const ti = (kk - 1) / 2;
        const t = forward ? j.plan.turns[ti] : [...j.plan.turns[n - 2 - ti]].reverse();
        this.follow.set(t);
      }
    } else if (j.kind === 'hedge') {
      const n = j.runs.length;
      const k = this.step % (2 * n);
      this.follow.set(k % 2 === 0 ? j.runs[k / 2].walk : j.links[(k - 1) / 2]);
    }
  }

  /** At the end of a leg: what the robot does there (face and work, or straight on). */
  private arrive(): void {
    const j = this.job;
    if (j.kind === 'field') {
      const post = j.beat.posts[(this.step + 1) % j.beat.posts.length];
      this.phase = 'face';
      this.target = { face: post.face, look: new Vector3(...post.look), task: post.task as 'read' | 'crouch' | 'survey', dwell: post.dwell };
      return;
    }
    if (j.kind === 'garden') {
      const post = j.posts[(this.step + 1) % j.posts.length];
      this.phase = 'face';
      this.target = { face: post.face, look: new Vector3(...post.look), task: post.crouch ? 'crouch' : 'survey', dwell: post.dwell };
      return;
    }
    if (j.kind === 'deck') {
      const place = deckPlaces(j.deck)[(this.step + 1) % deckPlaces(j.deck).length];
      if (!place.look) {
        // A run's end: turn about and go on.
        this.phase = 'work';
        this.target = null;
        this.until = this.time + 1.5;
        return;
      }
      const r = this.follow.root;
      this.phase = 'face';
      this.target = { face: Math.atan2(place.look[0] - r.x, place.look[2] - r.z), look: new Vector3(...place.look), task: 'survey', dwell: [10, 18] };
      return;
    }
    // The mower and hedger go straight on, with a breath at the end of each pass.
    this.phase = 'work';
    this.target = null;
    this.until = this.time + (this.job.kind === 'mow' && this.step % 2 === 0 ? 1.2 : 0.4);
  }

  private target: { face: number; look: Vector3; task: 'read' | 'crouch' | 'survey'; dwell: [number, number] } | null = null;
  /** The mower's reel and the trimmer's blades run (for their sound). */
  get mowing(): boolean {
    return !!this.mower && this.phase === 'walk' && this.follow.root.speed > 0.05;
  }
  get cutting(): boolean {
    return !!this.trimmer && this.phase === 'walk' && this.step % 2 === 0;
  }

  private readonly lookV = new Vector3();
  private readonly tmpM = new Matrix4();
  // Scratch for the arms' targets and the props' frames (held for the frame's motion update).
  private readonly handL = new Vector3();
  private readonly handR = new Vector3();
  private readonly palmQL = new Quaternion();
  private readonly palmQR = new Quaternion();
  private readonly fwd = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private readonly dir = new Vector3();
  private readonly aim = new Vector3();

  update(dt: number, world: Surroundings): void {
    this.time += dt;
    const f = this.follow;
    const r = f.root;
    let crouch = 0;
    let lean = 0;
    let look: Vector3 | null = null;
    let arms: ArmHold = { kind: 'swing' };
    const carrying = this.slate ? ({ kind: 'slate', read: 0 } as ArmHold) : arms;
    arms = carrying;
    if (this.phase === 'walk') {
      const pace = this.job.kind === 'mow' ? HAND_PACE.mow : this.job.kind === 'hedge' && this.step % 2 === 0 ? HAND_PACE.hedge : this.job.kind === 'deck' ? HAND_PACE.deck : HAND_PACE.walk;
      const blocked = world.blocked(this, r.x, r.z, r.heading, 0.45);
      f.step(dt, pace, blocked);
      if (blocked < 3 && world.person && world.person.distanceTo(this.lookV.set(r.x, world.person.y, r.z)) < 4) look = world.person;
      if (f.done) this.arrive();
    } else if (this.phase === 'face') {
      const t = this.target!;
      look = t.look;
      if (f.face(dt, t.face) && this.motion.settled) {
        this.phase = 'work';
        this.until = this.time + t.dwell[0] + (t.dwell[1] - t.dwell[0]) * this.rand();
      }
    } else {
      // At work: the task's posture, the look on the work (now and then a glance about).
      f.face(dt, r.heading);
      const t = this.target;
      if (t) {
        look = t.look;
        if (t.task === 'read') {
          arms = { kind: 'slate', read: 1 };
          // Reading the slate, glancing up at the door now and then.
          const glance = Math.sin(this.time * 0.7 + this.step) > 0.6;
          if (!glance) look = this.slateLook();
        } else if (t.task === 'crouch') {
          crouch = 1;
          lean = 0.15;
          // The right hand to the ground ahead, in front of its own shoulder.
          const s = Math.sin(r.heading);
          const c = Math.cos(r.heading);
          const reach = this.handR.set(r.x + s * 0.5 - c * 0.15, this.ground(r.x, r.z) + 0.16, r.z + c * 0.5 + s * 0.15);
          arms = { kind: 'grip', left: null, right: reach };
        }
      }
      // Done: stand up (if crouched) before walking on.
      if (this.time >= this.until) {
        crouch = 0;
        if (t?.task === 'crouch') arms = this.slate ? { kind: 'slate', read: 0 } : { kind: 'swing' };
        if (this.motion.crouched < 0.03 && this.motion.settled) {
          this.step++;
          this.beginLeg();
        }
      }
    }
    // Props: the mower ahead of the body, the trimmer swept over the hedge's face.
    if (this.mower) arms = this.poseMower(dt);
    if (this.trimmer) arms = this.poseTrimmer();
    if (!look && this.phase === 'walk') look = this.lookV.set(r.x + Math.sin(r.heading) * 6, this.ground(r.x, r.z) + 1.4, r.z + Math.cos(r.heading) * 6);
    const cmd: BipedCommand = { x: r.x, z: r.z, heading: r.heading, speed: r.speed, turnRate: r.turnRate, look, crouch, lean, arms, ground: this.ground };
    this.motion.update(dt, cmd);
    // The slate rides on the left palm (in the palm's own frame, about its pivot).
    if (this.slate) this.slate.multiplyMatrices(this.motion.world[this.palmL], SLATE_IN_PALM);
  }

  /** The slate's face (where a reading Hand looks). */
  private slateLook(): Vector3 {
    return this.lookV.setFromMatrixPosition(this.slate!);
  }

  private poseMower(dt: number): ArmHold {
    const r = this.follow.root;
    // Square to the body (its facing), which the grips are held from.
    const h = this.motion.facing;
    const s = Math.sin(h);
    const c = Math.cos(h);
    this.rolled += r.speed * dt;
    const mx = r.x + s * MOWER.reach;
    const mz = r.z + c * MOWER.reach;
    this.mower!.makeRotationY(h).setPosition(mx, this.ground(mx, mz), mz);
    const gl = this.handL.fromArray(MOWER.grip[0]).applyMatrix4(this.mower!);
    const gr = this.handR.fromArray(MOWER.grip[1]).applyMatrix4(this.mower!);
    // Overhand on the cross bar: the backs of the hands up and a little forward, the fingers curling
    // forward and down over the bar (in line with the forearms: the wrists near neutral), thumbs in.
    const tilt = MOWER_GRIP_TILT;
    const k = Math.cos(tilt);
    const q = Math.sin(tilt);
    const backOfHand = this.up.set(s * q, k, c * q);
    const wristward = this.fwd.set(-s * k, q, -c * k);
    const left = this.side.set(c, 0, -s);
    const palmL = this.palmQL.setFromRotationMatrix(this.tmpM.makeBasis(backOfHand, wristward, this.dir.copy(left).negate()));
    const palmR = this.palmQR.setFromRotationMatrix(this.tmpM.makeBasis(this.dir.copy(backOfHand).negate(), wristward, left));
    return { kind: 'grip', left: gl, right: gr, leftPalm: palmL, rightPalm: palmR };
  }

  private poseTrimmer(): ArmHold {
    const j = this.job as Extract<HandJob, { kind: 'hedge' }>;
    const r = this.follow.root;
    const cutting = this.cutting;
    const gy = this.ground(r.x, r.z);
    // (The model's +x is the robot's left.)
    const left = this.side.set(Math.cos(r.heading), 0, -Math.sin(r.heading));
    const fwd = this.fwd.set(Math.sin(r.heading), 0, Math.cos(r.heading));
    // Cutting: the rear grip at the hip away from the hedge, the shaft across the body up to its face
    // (swept up and down it, diagonally ahead: the forward arm reaches out, not folded at the
    // shoulder), the hedge's-side hand on the forward grip, so neither
    // arm reaches across the body. Between runs it is carried by its rear grip in the right hand,
    // pointing down ahead along the right side.
    const aim = this.aim;
    let rear = -1;
    if (cutting) {
      const run = j.runs[(this.step / 2) % j.runs.length];
      const k = Math.min(run.face.length - 1, Math.max(0, Math.round((this.follow.s / Math.max(1e-6, this.follow.length)) * (run.face.length - 1))));
      const fp = run.face[k];
      const sweep = Math.sin(this.time * 1.6) * 0.45;
      aim.set(fp[0], Math.min(run.top - 0.25, gy + 1.5 + sweep), fp[1]).addScaledVector(fwd, 1.4);
      rear = (aim.x - r.x) * left.x + (aim.z - r.z) * left.z > 0 ? -1 : 1;
    }
    const grip = this.handR.set(r.x, gy + 0.98, r.z).addScaledVector(left, 0.2 * rear).addScaledVector(fwd, 0.28);
    const dir = this.dir;
    if (cutting) dir.copy(aim).sub(grip).normalize();
    else dir.copy(fwd).multiplyScalar(0.9).addScaledVector(left, -0.1).setY(-0.36).normalize();
    const side = this.side.crossVectors(this.up.set(0, 1, 0), dir).normalize();
    const u = this.up.crossVectors(dir, side);
    this.trimmer!.makeBasis(side, u, dir).setPosition(grip);
    if (!cutting) return { kind: 'grip', left: null, right: grip };
    const front = this.handL.copy(grip).addScaledVector(dir, TRIMMER.front);
    return rear < 0 ? { kind: 'grip', left: front, right: grip } : { kind: 'grip', left: grip, right: front };
  }
}

/** Where a job begins: the first leg's start and heading. */
function startOf(job: HandJob): [number, number, number] {
  let a: P2;
  let b: P2;
  if (job.kind === 'field') [a, b] = [job.beat.legs[0][0], job.beat.legs[0][1]];
  else if (job.kind === 'garden') [a, b] = [job.legs[0][0], job.legs[0][1]];
  else if (job.kind === 'deck') {
    // (A ring's first leg sets out from its first stop, not its first point.)
    const leg = deckLeg(job.deck, 0);
    [a, b] = [leg[0], leg[1]];
  }
  else if (job.kind === 'mow') [a, b] = [job.plan.passes[0].a, job.plan.passes[0].b];
  else [a, b] = [job.runs[0].walk[0], job.runs[0].walk[1]];
  return [a[0], a[1], Math.atan2(b[0] - a[0], b[1] - a[1])];
}

/** The places a deck walk goes to in turn: a run's stops out and back with its ends; a ring's stops round. */
function deckPlaces(deck: Deck): { at: number; look: [number, number, number] | null }[] {
  const stops = deck.stops.map((q) => ({ at: q.at, look: q.look }));
  if (deck.closed) return stops;
  return [{ at: 0, look: null }, ...stops, { at: 1, look: null }, ...[...stops].reverse()];
}

/** The deck leg from place `step` to the next. */
function deckLeg(deck: Deck, step: number): P2[] {
  const places = deckPlaces(deck);
  const n = deck.pts.length;
  const idx = (f: number) => Math.min(n - 1, Math.round(f * (deck.closed ? n : n - 1)) % (deck.closed ? n : n + 1));
  const a = idx(places[step % places.length].at);
  const b = idx(places[(step + 1) % places.length].at);
  const out: P2[] = [];
  if (deck.closed) {
    for (let k = a; ; k = (k + 1) % n) {
      out.push(deck.pts[k]);
      if (k === b) break;
    }
  } else for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) out.push(deck.pts[k]);
  return out.length > 1 ? out : [deck.pts[a], deck.pts[(a + 1) % n]];
}
