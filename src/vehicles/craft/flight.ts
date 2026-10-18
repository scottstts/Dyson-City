/**
 * The craft's visits (docs/vehicles.md, "The craft"; city_plan §6). Pure logic: a pose, a burn
 * and requests to the East Lock's airlock; the scene and the sound read them.
 *
 * One visit, in the Spinward axis's vertical plane (z = 0):
 *
 *  1. approach: in level along the band, from far out on the deck, slowing to a hold just
 *     outside the outer leaf's hood; the lock vents and opens its outer gate meanwhile;
 *  2. enter: into the chamber; the lock shuts the outer gate, fills and opens the inner;
 *  3. inbound: out of the chamber, a climb over the Cordon's craft-gate bridge, along the corridor
 *     high enough that its ventral foil clears the corridor's 20 m ceiling, down over the Halo,
 *     settling over the pad;
 *  4. hover: levitating with its ventral foil's tip just clear of the pad (it has no flat
 *     underside to rest on), turning about to face the lock, while the inner gate opens again;
 *  5. outbound: the same way back into the chamber; the lock shuts, vents and opens outward;
 *  6. depart: out across the deck, accelerating away; then a short gap and the next arrival.
 *
 * Inside the Dome a visit lasts ~30 s (inbound, hover, outbound). Each leg is jerk-limited
 * (quintic in time along a smooth path), so the craft never jolts. The burn follows the thrust
 * the engines give: acceleration along the nose and holding speed against the air; slowing is
 * the levitation's work and leaves the engines at idle.
 */
import { CatmullRomCurve3, Vector3 } from 'three/webgpu';
import { PAD_HEIGHT } from '../../ground/site';
import { LOCK } from '../../city/eastLock/spec';
import { CRAFT_BOUNDS, CRAFT_SCALE } from './model';
import type { LockSide } from '../../city/eastLock/airlock';

/** The craft's half-height below its origin, in world metres (the ventral foil's tip). */
export const CRAFT_UNDER = -CRAFT_BOUNDS.bottom * CRAFT_SCALE;
/** Its half-length toward the nose and the tail, and its half-span (world metres). */
export const CRAFT_NOSE = -CRAFT_BOUNDS.nose * CRAFT_SCALE;
export const CRAFT_TAIL = CRAFT_BOUNDS.tail * CRAFT_SCALE;
export const CRAFT_HALF_SPAN = CRAFT_BOUNDS.halfSpan * CRAFT_SCALE;

/** Heights (world y of the craft's origin) and stations along the axis (world x). */
export const FLIGHT = {
  /** Centred in the lock's 30 m clear height (3.5 m above and below). */
  lockY: LOCK.floor + (LOCK.clearTop - LOCK.floor) / 2,
  /** Along the corridor: the ventral foil ~10 m over its 20 m ceiling. */
  cruiseY: PAD_HEIGHT + 41,
  /** Over the pad: the foil's tip this far above it. */
  hoverClear: 1.5,
  /** Raised clearance when something stands under it (the car, a walker). */
  hoverClearOver: 3.2,
  /** The chamber's centre, the hold outside the outer hood, the far end of the approach. */
  chamberX: (-LOCK.outerLipX - LOCK.innerLipX) / 2,
  holdX: 600,
  farX: 7000,
  /** The craft is clear of the inner gate's sweep (it may shut) west of this, and of the outer east of departX. */
  innerClearX: 440,
  departClearX: 600,
} as const;

/** Leg durations (s). */
export const LEGS = { approach: 24, enter: 6, inbound: 12, hover: 6, turn: 4, outbound: 12, depart: 24, gap: 8 } as const;

export type FlightPhase = 'approach' | 'hold' | 'enter' | 'wait-in' | 'inbound' | 'hover' | 'outbound' | 'wait-out' | 'depart' | 'gap';

/** What the flight asks of the lock and reads from it. */
export interface LockControl {
  request(side: LockSide): void;
  isOpen(side: 'outer' | 'inner'): boolean;
}

/** Quintic smoothstep (minimum jerk) and its derivative. */
function minJerk(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (10 - 15 * u + 6 * u * u);
}

/** Starts from rest with no jerk, ends at speed (s = 2u³ − u⁴: v(1) = 2). */
function launch(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 2 * u * u * u - u * u * u * u;
}

/** Arrives at rest from speed (the launch reversed). */
function arrive(t: number): number {
  return 1 - launch(1 - t);
}

/** A path with an arc-length table. */
class Path {
  private readonly curve: CatmullRomCurve3;
  private readonly lengths: number[];
  readonly length: number;

  constructor(points: [number, number][]) {
    this.curve = new CatmullRomCurve3(points.map(([x, y]) => new Vector3(x, y, 0)), false, 'centripetal');
    this.lengths = this.curve.getLengths(400);
    this.length = this.lengths[this.lengths.length - 1];
  }

  /** The point at a distance s along the path. */
  at(s: number, out: Vector3): Vector3 {
    const L = this.lengths;
    const d = Math.min(this.length, Math.max(0, s));
    let lo = 0;
    let hi = L.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] < d) lo = mid;
      else hi = mid;
    }
    const f = L[hi] > L[lo] ? (d - L[lo]) / (L[hi] - L[lo]) : 0;
    return this.curve.getPoint((lo + f) / (L.length - 1), out);
  }
}

/** Hover height (world y of the origin) for a clearance over the pad. */
export function hoverY(clear: number): number {
  return PAD_HEIGHT + CRAFT_UNDER + clear;
}

/** The corridor between the chamber and the pad, from the chamber (the outbound flies it reversed). */
export function corridorPoints(padY: number): [number, number][] {
  const F = FLIGHT;
  return [
    [F.chamberX, F.lockY],
    [462, F.lockY],
    [420, F.lockY + 13],
    [362, F.cruiseY],
    [150, F.cruiseY],
    [72, F.cruiseY - 6],
    [20, padY + 6],
    [0, padY],
  ];
}

export class CraftFlight {
  phase: FlightPhase = 'gap';
  /** Time in the current phase (s). */
  private t = 0;
  readonly position = new Vector3(FLIGHT.farX, FLIGHT.lockY, 0);
  readonly velocity = new Vector3();
  /** Heading: the nose's bearing (rad; π/2 faces −x, toward the city). */
  yaw = Math.PI / 2;
  /** Nose-up pitch and roll (rad). */
  pitch = 0;
  roll = 0;
  /** The engines' burn, 0 (idle) … 1, and whether the craft exists (between visits it does not). */
  burn = 0;
  visible = false;
  private corridor: Path | null = null;
  private progress = 0;
  private padY = hoverY(FLIGHT.hoverClear);
  private readonly prev = new Vector3();
  private readonly prevVel = new Vector3();
  private readonly tmp = new Vector3();
  private time = 0;
  /** The first visit starts this far into its gap (s): soon after the game starts. */
  constructor(firstGap = LEGS.gap - 2) {
    this.t = LEGS.gap - firstGap;
  }

  /**
   * Advances the flight. `under(x, z, r)` is the top (world y) of anything standing within r of a
   * plan point (the car, a walker), or −∞: the hover rises over it.
   */
  update(dt: number, lock: LockControl, under: (x: number, z: number, r: number) => number): void {
    this.time += dt;
    this.t += dt;
    this.prev.copy(this.position);
    const F = FLIGHT;
    const p = this.position;
    switch (this.phase) {
      case 'gap':
        this.visible = false;
        if (this.t >= LEGS.gap) this.next('approach');
        break;
      case 'approach': {
        lock.request('outer');
        this.visible = true;
        const s = arrive(this.t / LEGS.approach);
        p.set(F.farX + (F.holdX - F.farX) * s, F.lockY, 0);
        this.yaw = Math.PI / 2;
        if (this.t >= LEGS.approach) this.next('hold');
        break;
      }
      case 'hold':
        p.set(F.holdX, F.lockY, 0);
        if (lock.isOpen('outer')) this.next('enter');
        break;
      case 'enter': {
        const s = minJerk(this.t / LEGS.enter);
        p.set(F.holdX + (F.chamberX - F.holdX) * s, F.lockY, 0);
        if (this.t >= LEGS.enter) {
          lock.request('inner');
          this.next('wait-in');
        }
        break;
      }
      case 'wait-in':
        p.set(F.chamberX, F.lockY, 0);
        if (lock.isOpen('inner')) {
          this.padY = this.hoverHeight(under);
          this.corridor = new Path(corridorPoints(this.padY));
          this.progress = 0;
          this.next('inbound');
        }
        break;
      case 'inbound': {
        const path = this.corridor!;
        this.progress = minJerk(this.t / LEGS.inbound) * path.length;
        path.at(this.progress, p);
        if (p.x < F.innerClearX) lock.request('closed');
        if (this.t >= LEGS.inbound) {
          lock.request('closed');
          this.next('hover');
        }
        break;
      }
      case 'hover': {
        // The inner gate opens again for the way out (the chamber is still at the city's pressure).
        if (this.t > 0.5) lock.request('inner');
        const target = this.hoverHeight(under);
        this.padY += (target - this.padY) * (1 - Math.exp(-dt / 0.8));
        const bob = 0.12 * Math.sin(this.time * 2 * Math.PI * 0.21);
        p.set(0, this.padY + bob, 0);
        // Turns about to face the lock, in the middle of the hover.
        const turn = minJerk((this.t - (LEGS.hover - LEGS.turn) / 2) / LEGS.turn);
        this.yaw = Math.PI / 2 + Math.PI * turn;
        if (this.t >= LEGS.hover) {
          this.corridor = new Path(corridorPoints(this.padY).reverse());
          this.progress = 0;
          this.next('outbound');
        }
        break;
      }
      case 'outbound': {
        const path = this.corridor!;
        const s = minJerk(this.t / LEGS.outbound) * path.length;
        path.at(s, this.tmp);
        // Never fly into a gate that is not open: hold short of the lock until it is.
        if (this.tmp.x > F.innerClearX - 20 && !lock.isOpen('inner')) this.t -= dt;
        else p.copy(this.tmp);
        if (this.t >= LEGS.outbound) {
          lock.request('outer');
          this.next('wait-out');
        }
        break;
      }
      case 'wait-out':
        p.set(F.chamberX, F.lockY, 0);
        if (lock.isOpen('outer')) this.next('depart');
        break;
      case 'depart': {
        const s = launch(this.t / LEGS.depart);
        p.set(F.chamberX + (F.farX - F.chamberX) * s, F.lockY + 8 * s, 0);
        if (p.x > F.departClearX + CRAFT_TAIL) lock.request('closed');
        if (this.t >= LEGS.depart) {
          lock.request('closed');
          this.visible = false;
          this.next('gap');
        }
        break;
      }
    }
    this.attitude(dt);
  }

  /** Review: runs the visit (and the lock with it) forward until it reaches `phase`, plus `extra` seconds. */
  fastForward(phase: FlightPhase, lock: LockControl & { update(dt: number): void }, under: (x: number, z: number, r: number) => number, extra = 1): void {
    const dt = 1 / 30;
    for (let i = 0; i < 9000 && this.phase !== phase; i++) {
      lock.update(dt);
      this.update(dt, lock, under);
    }
    for (let t = 0; t < extra; t += dt) {
      lock.update(dt);
      this.update(dt, lock, under);
    }
  }

  private next(phase: FlightPhase): void {
    this.phase = phase;
    this.t = 0;
  }

  private hoverHeight(under: (x: number, z: number, r: number) => number): number {
    const top = under(0, 0, CRAFT_NOSE);
    const clear = Number.isFinite(top) && top > PAD_HEIGHT + 0.2 ? FLIGHT.hoverClearOver + (top - PAD_HEIGHT) : FLIGHT.hoverClear;
    return hoverY(clear);
  }

  /** Velocity, heading, pitch and the burn from the motion. */
  private attitude(dt: number): void {
    if (dt <= 0) return;
    this.velocity.subVectors(this.position, this.prev).divideScalar(dt);
    const v = this.velocity;
    const h = Math.hypot(v.x, v.z);
    // Heading follows the horizontal motion when it is real (not in the hover's turn).
    if (h > 2 && this.phase !== 'hover') this.yaw = v.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    // Nose along the flight path (gently), and up while slowing hard (the levitation's flare).
    const nx = -Math.sin(this.yaw);
    const nz = -Math.cos(this.yaw);
    const fwd = v.x * nx + v.z * nz;
    const accel = ((v.x - this.prevVel.x) * nx + (v.z - this.prevVel.z) * nz) / dt;
    this.prevVel.copy(v);
    const climb = h > 3 ? Math.atan2(v.y, Math.abs(fwd)) * 0.5 : 0;
    const flare = Math.max(-0.07, Math.min(0.07, -accel * 0.004));
    const target = climb + flare;
    this.pitch += (target - this.pitch) * (1 - Math.exp(-dt / 0.6));
    this.roll = this.phase === 'hover' ? 0.012 * Math.sin(this.time * 2 * Math.PI * 0.13) : 0;
    // Thrust: speeding up along the nose, and holding speed against drag; idle otherwise.
    const drag = (fwd * Math.abs(fwd)) / 9000;
    const thrust = Math.max(0, accel / 16 + drag);
    const idle = this.visible ? (this.phase === 'hover' ? 0.05 : 0.08) : 0;
    const target2 = Math.min(1, Math.max(idle, thrust));
    const tc = target2 > this.burn ? 0.18 : 0.45;
    this.burn += (target2 - this.burn) * (1 - Math.exp(-dt / tc));
  }
}
