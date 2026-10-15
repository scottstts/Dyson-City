/**
 * The Cold Hold's relief stacks (docs/field.md): boil-off pressure in the tanks lifts a stack's
 * relief valve now and then; it roars for a few seconds and reseats. Game state only: the sound
 * (audio/sounds/field.ts) and the vapour read it; this knows nothing of either.
 *
 * Each stack lifts at random (on average every ten minutes; with thirty stacks, one somewhere in
 * the Hold every twenty seconds or so), roars for 3–9 s with its flow easing as the pressure
 * falls, and reseats. The schedule is seeded, so a given game time always vents the same way.
 */
import type { Vec3 } from '../geometry/polyMesh';
import { rng } from './kit/parts';

export interface ReliefStack {
  p: Vec3;
  /** Relative size (the tank's radius over the largest's). */
  size: number;
}

export type VentEvent = { stack: number; kind: 'lift' | 'reseat'; t: number };

const MEAN_INTERVAL = 600;
const ATTACK = 0.12;
const RELEASE = 0.25;

export class ReliefVents {
  readonly stacks: readonly ReliefStack[];
  /** Flow through each stack now (0 shut … 1 full lift). */
  readonly flow: Float32Array;
  /** Lifts and reseats since the last `drain`. */
  private events: VentEvent[] = [];
  private readonly next: Float64Array;
  private readonly until: Float64Array;
  private readonly liftAt: Float64Array;
  private readonly random = rng(0xb10f);
  private time = -1;

  constructor(stacks: readonly ReliefStack[]) {
    this.stacks = stacks;
    this.flow = new Float32Array(stacks.length);
    this.next = new Float64Array(stacks.length);
    this.until = new Float64Array(stacks.length).fill(-1);
    this.liftAt = new Float64Array(stacks.length);
    for (let i = 0; i < stacks.length; i++) this.next[i] = this.interval();
  }

  private interval(): number {
    return -Math.log(1 - this.random() * 0.999) * MEAN_INTERVAL;
  }

  update(t: number): void {
    if (this.time < 0) {
      // Joining at an arbitrary game time: schedule from there.
      for (let i = 0; i < this.next.length; i++) this.next[i] += t;
      this.time = t;
    }
    for (let i = 0; i < this.stacks.length; i++) {
      if (this.until[i] < 0 && t >= this.next[i]) {
        this.until[i] = t + 3 + this.random() * 6;
        this.liftAt[i] = t;
        this.events.push({ stack: i, kind: 'lift', t });
      }
      if (this.until[i] >= 0 && t >= this.until[i]) {
        this.events.push({ stack: i, kind: 'reseat', t });
        this.next[i] = t + this.interval();
        this.until[i] = -1;
      }
      // Flow: snaps open, eases as the tank's pressure falls, closes fast on reseat.
      const open = this.until[i] >= 0;
      const target = open ? 0.6 + 0.4 * Math.exp(-(t - this.liftAt[i]) / 6) : 0;
      const dt = Math.max(0, t - this.time);
      const tau = open && this.flow[i] < target ? ATTACK : RELEASE;
      this.flow[i] += (target - this.flow[i]) * (1 - Math.exp(-dt / tau));
    }
    this.time = t;
  }

  /** Lifts a stack now (review: `?vent`). */
  lift(stack: number): void {
    this.next[stack] = this.time < 0 ? 0 : this.time;
  }

  /** Events since the last call. */
  drain(): VentEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
