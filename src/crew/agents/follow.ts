/**
 * Following a route (docs/crew.md, "Behaviour"): a robot's root moves along a polyline at a pace,
 * easing in and out of it; its heading turns toward a point a little ahead, so it rounds gentle
 * bends while walking; at a sharp corner it slows to a stop and turns on the spot first (as a
 * person does), at the turning rate its gait allows. Anything in its way within a stopping
 * distance holds it.
 */
import { wrap } from '../motion/biped';
import type { P2 } from '../nav';

export interface Root {
  x: number;
  z: number;
  heading: number;
  speed: number;
  turnRate: number;
}

export class PathFollower {
  pts: P2[] = [];
  private seg: number[] = [];
  s = 0;
  length = 0;
  readonly root: Root;
  private readonly opts: { accel: number; decel: number; turn: number; ahead: number; corner: number };

  /** Acceleration and deceleration (m/s²), turning rate (rad/s), lookahead (m), the corner angle (rad) past which it stops to turn. */
  constructor(x: number, z: number, heading: number, opts: { accel: number; decel: number; turn: number; ahead: number; corner: number }) {
    this.root = { x, z, heading, speed: 0, turnRate: 0 };
    this.opts = opts;
  }

  set(pts: P2[]): void {
    this.pts = pts;
    this.seg = [0];
    for (let i = 1; i < pts.length; i++) this.seg.push(this.seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.seg[this.seg.length - 1] ?? 0;
    this.s = 0;
  }

  /** The point at arc length s along the route. */
  at(s: number, out: P2 = [0, 0]): P2 {
    const p = this.pts;
    if (!p.length) return out;
    const u = Math.min(Math.max(s, 0), this.length);
    let i = 1;
    while (i < p.length - 1 && this.seg[i] < u) i++;
    const t = (u - this.seg[i - 1]) / Math.max(1e-9, this.seg[i] - this.seg[i - 1]);
    out[0] = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
    out[1] = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
    return out;
  }

  get done(): boolean {
    return this.s >= this.length - 1e-3;
  }

  private readonly q: P2 = [0, 0];

  /** Turns the root toward a heading on the spot (returns true when it faces it). */
  face(dt: number, heading: number): boolean {
    const r = this.root;
    const e = wrap(heading - r.heading);
    const step = Math.max(-this.opts.turn * dt, Math.min(this.opts.turn * dt, e));
    r.heading += step;
    r.turnRate = dt > 0 ? step / dt : 0;
    r.speed = Math.max(0, r.speed - this.opts.decel * dt);
    return Math.abs(e) < 0.03;
  }

  /**
   * One step along the route at up to `vmax`, held if `blocked` (a distance to what is in the way,
   * or Infinity).
   */
  step(dt: number, vmax: number, blocked: number): void {
    const r = this.root;
    if (!this.pts.length) return;
    // Where it heads: a point a little ahead along the route.
    const ahead = this.at(this.s + this.opts.ahead, this.q);
    const want = Math.hypot(ahead[0] - r.x, ahead[1] - r.z) > 0.05 ? Math.atan2(ahead[0] - r.x, ahead[1] - r.z) : r.heading;
    const err = wrap(want - r.heading);
    // A sharp turn: stop and turn first; a gentle one: turn as it walks.
    const remaining = this.length - this.s;
    let v = vmax;
    // Into a bend it slows, more the sharper it is (a gait turns only so far a step).
    if (Math.abs(err) > this.opts.corner) v = 0;
    else v *= Math.max(0.2, (1 - Math.abs(err) / this.opts.corner) ** 2);
    // Ease to a stop at the route's end and before whatever is in the way.
    v = Math.min(v, Math.sqrt(2 * this.opts.decel * Math.max(0, remaining)), Math.sqrt(2 * this.opts.decel * Math.max(0, blocked - 1.2)));
    const dv = v - r.speed;
    r.speed += Math.max(-this.opts.decel * dt, Math.min(this.opts.accel * dt, dv));
    // Turning while it walks: the faster, the gentler (full rate up to 0.4 m/s, 60 % of it at 1 m/s).
    const rate = this.opts.turn * Math.min(1, 1 - 0.65 * (r.speed - 0.4));
    const turn = Math.max(-rate * dt, Math.min(rate * dt, err));
    r.heading += turn;
    r.turnRate = dt > 0 ? turn / dt : 0;
    // Advance along the route (the root rides it: it never cuts a corner the path keeps clear of).
    this.s = Math.min(this.length, this.s + r.speed * dt);
    const p = this.at(this.s, this.q);
    r.x = p[0];
    r.z = p[1];
  }
}
