/**
 * Where the Guardian looks (docs/intro-film.md, "The eye"): a person's head, turning from one
 * thing to the next, smoothly.
 *
 *  - **Fixations.** Attention goes from one thing to the next: authored targets (angles, or points
 *    in the world that may move: the ship as it climbs away), each held for as long as it holds them.
 *  - **The head follows**, as a body does: the target is eased (a first-order lag) and the head is a
 *    critically damped spring toward it. So every turn starts gently, carries on smoothly through a
 *    change of mind, and settles without overshoot in a second and a half or so (a big turn moves
 *    faster through its middle than a small one); a groggy or idle one is slower (`pace`). A moving
 *    target is tracked with a small lag, as a head follows.
 *  - **Never frozen.** While a fixation is held the head drifts slowly about it (a slow change of
 *    a degree or so every few seconds) and breathes.
 *
 * *Rejected:* eye-like shifts (quick, a fraction of a second, with small fast secondary looks):
 * on screen they read abrupt, and the small ones as a camera rig's jitter.
 *
 * Seekable and cheap: the head is integrated at a fixed 120 Hz from the start, carried forward
 * from the last call while the film runs on, replayed from the start after a jump back. Angles in
 * radians: yaw, pitch (up +), roll. Yaw differences are taken the short way round.
 */
import type { Vector3 } from 'three/webgpu';

export interface Angles {
  yaw: number;
  pitch: number;
  roll?: number;
}

/** A target: fixed angles, or angles from the eye's position at time t (a point in the world). */
export type Target = Angles | ((t: number, eye: Vector3) => Angles);

/** Where the eye is at time t (world): each moment's targets are seen from where the eye was then. */
export type EyeAt = (t: number) => Vector3;

export interface Fixation {
  /** When attention moves to it (s). */
  at: number;
  target: Target;
  /** Pace of the turn: 1 normal, below 1 slower (groggy, idle), above quicker. */
  pace?: number;
  /** Slow drift about it while held (default on). */
  busy?: boolean;
}

/** The head's spring (rad/s at pace 1) and the target's easing (s at pace 1). */
const OMEGA = 3.6;
const EASE = 0.35;
/** Integration step (s). */
const STEP = 1 / 120;

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Look {
  at: number;
  target: Target;
  pace: number;
  /** A slow drift: its offset from the fixation it belongs to. */
  offset: [number, number] | null;
}

/** The head's state: its angles and rates, and the eased target. */
interface State {
  t: number;
  /** Index of the look in force. */
  i: number;
  x: [number, number, number];
  v: [number, number, number];
  e: [number, number, number];
}

const resolve = (target: Target, t: number, eye: EyeAt): Angles => (typeof target === 'function' ? target(t, eye(t)) : target);

export class Gaze {
  private readonly looks: Look[] = [];
  /** No drift after this (the last frame must be exact). */
  private readonly still: number;
  private state: State | null = null;

  constructor(fixations: readonly Fixation[], seed: number, still = Infinity) {
    const r = mulberry(seed);
    this.still = still;
    fixations.forEach((f, i) => {
      this.looks.push({ at: f.at, target: f.target, pace: f.pace ?? 1, offset: null });
      // A slow drift while it is held: every 2.2–4 s, a degree or so about it.
      if (f.busy === false) return;
      const end = Math.min(i + 1 < fixations.length ? fixations[i + 1].at : f.at + 8, still);
      let t = f.at + 2.0 + r() * 1.0;
      while (t < end - 1.2) {
        const a = r() * Math.PI * 2;
        const m = ((0.5 + r() * 1.1) * Math.PI) / 180;
        this.looks.push({ at: t, target: f.target, pace: 0.55, offset: [Math.cos(a) * m, Math.sin(a) * m * 0.7] });
        t += 2.2 + r() * 1.8;
      }
    });
    this.looks.sort((a, b) => a.at - b.at);
  }

  /** The gaze at t, the eye where `eye` says at each moment (only point targets use it). */
  at(t: number, eye: EyeAt, out: Angles): Angles {
    let s = this.state;
    if (!s || t < s.t - 1e-9 || t > s.t + 2) s = this.state = this.start(eye);
    // Whole steps up to t, then the rest of the way without keeping it.
    while (s.t + STEP <= t) this.advance(s, STEP, eye);
    const rest = t - s.t;
    if (rest > 1e-9) {
      const peek: State = { t: s.t, i: s.i, x: [...s.x], v: [...s.v], e: [...s.e] };
      this.advance(peek, rest, eye);
      s = peek;
    }
    out.yaw = s.x[0];
    out.pitch = s.x[1];
    out.roll = s.x[2];
    return out;
  }

  private start(eye: EyeAt): State {
    const a = this.angles(this.looks[0], 0, eye);
    const x: [number, number, number] = [a.yaw, a.pitch, a.roll ?? 0];
    return { t: 0, i: 0, x, v: [0, 0, 0], e: [...x] };
  }

  /** One step: the look in force, its target eased, the head sprung toward it. */
  private advance(s: State, dt: number, eye: EyeAt): void {
    const L = this.looks;
    while (s.i + 1 < L.length && L[s.i + 1].at <= s.t + dt) s.i++;
    const look = L[s.i];
    const a = this.angles(look, s.t + dt, eye);
    const goal = [s.e[0] + wrap(a.yaw - s.e[0]), a.pitch, a.roll ?? 0];
    const k = 1 - Math.exp(-dt / (EASE / look.pace));
    const w = OMEGA * look.pace;
    for (let c = 0; c < 3; c++) {
      s.e[c] += (goal[c] - s.e[c]) * k;
      // Critically damped: x'' = w²(e − x) − 2w x', integrated semi-implicitly.
      const acc = w * w * (s.e[c] - s.x[c]) - 2 * w * s.v[c];
      s.v[c] += acc * dt;
      s.x[c] += s.v[c] * dt;
    }
    s.t += dt;
  }

  private angles(l: Look, t: number, eye: EyeAt): Angles {
    const a = resolve(l.target, t, eye);
    if (!l.offset || t > this.still) return a;
    return { yaw: a.yaw + l.offset[0], pitch: a.pitch + l.offset[1], roll: a.roll };
  }
}
