/**
 * Cast nodes: every junction of the frame is one (docs/dome.md). A node is a turned hub: a drum on
 * S's normal with a bevelled crown, a bronze bearing cap and bolt circle on top, and its underside
 * pocketed round a bronze bearing boss (what the city sees through the glass). One straight cast arm
 * leaves the drum along each member that meets it, and every arm ends at the same radius on a bolted
 * splice (splice.ts) where the member's own end plate meets it. No member passes through a node and
 * no two members touch: every load path is hub → arm → splice → member.
 *
 * Sizing is measured, not tabulated: each arm is traced along its member's actual curve in the
 * node's tangent plane, the drum grows until every arm is clear of its neighbours where it leaves
 * the drum, and the splice radius until every plate clears the drum and every other arm.
 */
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, loftRings, revolve, sweep, type Frame, type Profile } from '../../geometry/sweep';
import type { Bolt } from './bolts';
import { memberT1, type Kind } from './girder';
import { JOINT, LAYER, MEMBER } from './spec';
import { SLOT } from './slots';
import { spliceFace, spliceSite, type SpliceSite } from './splice';
import { dropToS, normalAt, tangent, type Curve } from './surface';

/** Arm trace: sample spacing and reach (m along the member from the node). */
const STEP = 0.05;
const REACH = 24;
/** Drum facets round its axis. */
const SEGMENTS = 64;
/** The underside pocket: radius as a fraction of the drum's, and its depth. */
const POCKET = { scale: 0.5, depth: 0.3 } as const;

export interface Arm {
  kind: Kind;
  curve: Curve;
  /** Parameter of the node on the curve. */
  u: number;
  /** Direction of increasing distance from the node along u. */
  sign: 1 | -1;
}

interface Trace {
  s: Float64Array;
  u: Float64Array;
  x: Float64Array;
  y: Float64Array;
}

export interface NodePart {
  name: string;
  mesh: PolyMesh;
}

export class Node {
  readonly name: string;
  readonly p: Vec3;
  readonly n: Vec3;
  readonly arms: Arm[] = [];
  /** Tangent-plane axes: (e1, e2, n) right-handed. */
  e1: Vec3 = [1, 0, 0];
  e2: Vec3 = [0, 0, 1];
  /** Drum radius. */
  radius = 0;
  /** Per arm, arc length from the node: where it leaves the drum, where its sweep starts, its splice centre. */
  exit: number[] = [];
  start: number[] = [];
  spliceS: number[] = [];
  /** Height of the drum's crown above the tangent plane. */
  tTop = 0;
  private traces: Trace[] = [];

  constructor(name: string, p: Vec3) {
    this.name = name;
    this.p = p;
    this.n = normalAt(p);
  }

  addArm(kind: Kind, curve: Curve, u: number, sign: 1 | -1): number {
    this.arms.push({ kind, curve, u, sign });
    return this.arms.length - 1;
  }

  private trace(a: Arm): Trace {
    const h = 1e-5;
    const speed = v3.dist(a.curve(a.u + h), a.curve(a.u - h)) / (2 * h);
    const du = (a.sign * STEP) / speed;
    const count = Math.ceil(REACH / STEP) + 1;
    const t: Trace = { s: new Float64Array(count), u: new Float64Array(count), x: new Float64Array(count), y: new Float64Array(count) };
    let u = a.u;
    let q = a.curve(u);
    let s = 0;
    for (let k = 0; k < count; k++) {
      const rel = v3.sub(q, this.p);
      t.s[k] = s;
      t.u[k] = u;
      t.x[k] = v3.dot(rel, this.e1);
      t.y[k] = v3.dot(rel, this.e2);
      u += du;
      const q1 = a.curve(u);
      s += v3.dist(q1, q);
      q = q1;
    }
    return t;
  }

  /** Arm i at arc length s: plan position, unit direction, curve parameter. */
  private at(i: number, s: number): { x: number; y: number; dx: number; dy: number; u: number } {
    const t = this.traces[i];
    const n = t.s.length;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t.s[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = t.s[hi] > t.s[lo] ? Math.min(Math.max((s - t.s[lo]) / (t.s[hi] - t.s[lo]), 0), 1) : 0;
    const k0 = Math.max(0, lo - 1);
    const k1 = Math.min(n - 1, hi + 1);
    const l = Math.hypot(t.x[k1] - t.x[k0], t.y[k1] - t.y[k0]) || 1;
    return {
      x: t.x[lo] + (t.x[hi] - t.x[lo]) * f,
      y: t.y[lo] + (t.y[hi] - t.y[lo]) * f,
      dx: (t.x[k1] - t.x[k0]) / l,
      dy: (t.y[k1] - t.y[k0]) / l,
      u: t.u[lo] + (t.u[hi] - t.u[lo]) * f,
    };
  }

  /** Distance from a plan point to arm j's centreline (0.5 m polyline). */
  private armDistance(j: number, x: number, y: number): number {
    const t = this.traces[j];
    const stride = 10;
    let best = Infinity;
    for (let k = 0; k + stride < t.s.length; k += stride) {
      const ax = t.x[k];
      const ay = t.y[k];
      const ex = t.x[k + stride] - ax;
      const ey = t.y[k + stride] - ay;
      const f = Math.min(Math.max(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0), 1);
      best = Math.min(best, Math.hypot(x - ax - f * ex, y - ay - f * ey));
    }
    return best;
  }

  private hw(i: number): number {
    return MEMBER[this.arms[i].kind].halfWidth;
  }

  /** Half-width of arm i's cast section. */
  private armHalf(i: number): number {
    return this.hw(i) + JOINT.armGrow;
  }

  /** Arc length beyond which arm i, grown by `pad` each side, is clear of every other arm grown alike. */
  private clearOfArms(i: number, pad: number): number {
    const w = this.hw(i) + pad;
    for (let s = REACH - 2; s > 0; s -= 0.05) {
      const c = this.at(i, s);
      for (const off of [-w, 0, w]) {
        const x = c.x - c.dy * off;
        const y = c.y + c.dx * off;
        for (let j = 0; j < this.arms.length; j++) {
          if (j !== i && this.armDistance(j, x, y) < this.hw(j) + pad) return s + 0.05;
        }
      }
    }
    return 0;
  }

  /** Smallest arc length at which arm i's section, `w` either side, lies wholly outside radius r. */
  private outside(i: number, w: number, r: number): number {
    for (let s = 0; s < REACH - 2; s += 0.02) {
      const c = this.at(i, s);
      if (Math.hypot(c.x - c.dy * w, c.y + c.dx * w) > r && Math.hypot(c.x + c.dy * w, c.y - c.dx * w) > r && Math.hypot(c.x, c.y) > r) return s;
    }
    return REACH;
  }

  /** Largest plan radius reached by arm i's section, `w` either side, at arc length s. */
  private reach(i: number, w: number, s: number): number {
    const c = this.at(i, s);
    return Math.max(Math.hypot(c.x - c.dy * w, c.y + c.dx * w), Math.hypot(c.x + c.dy * w, c.y - c.dx * w));
  }

  /** Sizes the drum, the arms and the splices from the arms registered. */
  fit(): this {
    const a0 = this.arms[0];
    const d = v3.scale(tangent(a0.curve, a0.u), a0.sign);
    this.e1 = v3.norm(v3.sub(d, v3.scale(this.n, v3.dot(d, this.n))));
    this.e2 = v3.cross(this.n, this.e1);
    this.traces = this.arms.map((a) => this.trace(a));
    const idx = this.arms.map((_, i) => i);
    // The drum takes in every point where two arms still touch (with a clearance), and is wide
    // enough that each arm starts outside the pocket yet wholly inside the drum.
    const widest = Math.max(...idx.map((i) => this.armHalf(i)));
    const meet = Math.max(...idx.map((i) => this.reach(i, this.armHalf(i), this.clearOfArms(i, JOINT.armGrow + JOINT.armClear))));
    this.radius = Math.max(meet + 0.1, 1.3 * widest + 0.3);
    const h = JOINT.plateHalf;
    const r = this.radius;
    // One splice radius for every arm: a clear stub past the drum, plates clear of the drum and of
    // every other arm.
    let sP = 0;
    for (const i of idx) {
      this.exit[i] = this.outside(i, this.armHalf(i), r);
      sP = Math.max(sP, this.exit[i] + JOINT.stub + h, this.outside(i, this.hw(i) + JOINT.plateMargin, r + 0.1) + h, this.clearOfArms(i, JOINT.plateMargin + JOINT.plateGap / 2) + h);
    }
    for (const i of idx) {
      this.spliceS[i] = sP;
      this.start[i] = POCKET.scale * r + 0.1;
    }
    this.tTop = Math.max(...this.arms.map((a) => memberT1(a.kind, this.p[1]))) + JOINT.armGrow + JOINT.bodyProud;
    return this;
  }

  /** Arm i's splice (T pointing away from the node: side a is the arm, side b the member). */
  splice(i: number): SpliceSite {
    const a = this.arms[i];
    return spliceSite(a.curve, this.at(i, this.spliceS[i]).u, a.sign, a.kind, false, true);
  }

  /** Curve parameter at the member side of arm i's splice. */
  memberU(i: number): number {
    return this.at(i, this.spliceS[i] + JOINT.plateHalf).u;
  }

  /** A straight cast arm: the member's envelope grown by JOINT.armGrow, from inside the drum to its plate. */
  private armMesh(i: number): PolyMesh {
    const a = this.arms[i];
    const site = this.splice(i);
    const s0 = this.start[i];
    const s1 = this.spliceS[i] - JOINT.plateHalf + JOINT.seat;
    const steps = Math.max(2, Math.ceil((s1 - s0) / 1.5));
    const pts = Array.from({ length: steps + 1 }, (_, k) => a.curve(this.at(i, s0 + ((s1 - s0) * k) / steps).u));
    const frames = framesFrom(pts, pts.map(normalAt));
    const w = this.armHalf(i);
    const section = (f: Frame): Profile => {
      const t0 = LAYER.armT0;
      const t1 = memberT1(a.kind, f.p[1]) + JOINT.armGrow;
      const cb = 0.04;
      const ct = 0.2;
      const p: [number, number][] = [[-w + cb, t0], [w - cb, t0], [w, t0 + cb], [w, t1 - ct], [w - ct, t1], [-w + ct, t1], [-w, t1 - ct], [-w, t0 + cb]];
      return { pts: p, slots: p.map(() => SLOT.ceramic) };
    };
    return sweep(frames, section, { trimEnd: spliceFace(site, 'a'), crease: 28 });
  }

  /** A ring of the drum: radius r about the axis, at height t above S (draped) or above the tangent plane. */
  private ring(r: number, t: number, drape: boolean): Vec3[] {
    return Array.from({ length: SEGMENTS }, (_, k) => {
      const a = (2 * Math.PI * k) / SEGMENTS;
      const q = v3.madd(this.p, this.e1, r * Math.cos(a), this.e2, r * Math.sin(a));
      return v3.add(drape ? dropToS(q, this.n) : q, v3.scale(this.n, t));
    });
  }

  /**
   * The drum, as one loft (a turned profile): the pocket's floor, its wall and chamfered lip, the
   * underside, the arrised foot, the side, the crown's bevel. Underside rings are draped onto S (at
   * a 7 m drum's rim the tangent plane stands 5–10 cm off it); the crown is planar.
   */
  private bodyMesh(): PolyMesh {
    const r = this.radius;
    const rp = POCKET.scale * r;
    const t0 = LAYER.nodeT0;
    const top = this.tTop;
    return loftRings(
      [
        this.ring(rp - 0.05, t0 + POCKET.depth, true),
        this.ring(rp - 0.05, t0 + 0.05, true),
        this.ring(rp, t0, true),
        this.ring(r - 0.04, t0, true),
        this.ring(r, t0 + 0.05, true),
        this.ring(r, top - 0.5, false),
        this.ring(r - 0.18, top - 0.2, false),
        this.ring(r - 0.38, top, false),
      ],
      SLOT.ceramic,
      30,
    );
  }

  /** Radii of the crown's bronze cap and of the bearing boss in the underside's pocket. */
  private capRadius(): number {
    return Math.min(Math.max(0.25 * this.radius, 0.6), 1.3);
  }

  private bossRadius(): number {
    return Math.min(0.22 * this.radius, 1.0);
  }

  private capMesh(): PolyMesh {
    const rc = this.capRadius();
    const c = v3.add(this.p, v3.scale(this.n, this.tTop));
    const prof: [number, number][] = [[0, -0.03], [rc, -0.03], [rc, 0.12], [rc - 0.08, 0.2], [rc * 0.45, 0.2], [rc * 0.38, 0.28], [0, 0.28]];
    return revolve(prof, 48, (x, y, h) => v3.add(v3.madd(c, this.e1, x, this.e2, y), v3.scale(this.n, h)), SLOT.bronze, 35);
  }

  /** The underside boss: a bronze disc in the pocket's floor, axis −n (clear of the glass). */
  private bossMesh(): PolyMesh {
    const rb = this.bossRadius();
    const c = v3.add(this.p, v3.scale(this.n, LAYER.nodeT0 + POCKET.depth));
    const e2 = v3.scale(this.e2, -1);
    const prof: [number, number][] = [[0, -0.03], [rb, -0.03], [rb, 0.07], [rb - 0.05, 0.11], [0, 0.11]];
    return revolve(prof, 48, (x, y, h) => v3.sub(v3.madd(c, this.e1, x, e2, y), v3.scale(this.n, h)), SLOT.bronze, 35);
  }

  /** Bolt circles round the crown cap and round the underside boss (on the pocket floor). */
  bolts(out: Bolt[]): void {
    const circle = (r: number, at: (q: Vec3) => Vec3, axis: Vec3) => {
      const count = Math.max(8, Math.round((2 * Math.PI * r) / 0.55));
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * k) / count;
        const dir = v3.madd([0, 0, 0], this.e1, Math.cos(a), this.e2, Math.sin(a));
        out.push({ p: at(v3.add(this.p, v3.scale(dir, r))), axis, spin: dir });
      }
    };
    circle(this.capRadius() + 0.32, (q) => v3.add(q, v3.scale(this.n, this.tTop)), this.n);
    circle(this.bossRadius() + 0.25, (q) => v3.add(dropToS(q, this.n), v3.scale(this.n, LAYER.nodeT0 + POCKET.depth)), v3.scale(this.n, -1));
  }

  parts(): NodePart[] {
    return [
      { name: this.name, mesh: this.bodyMesh() },
      { name: `${this.name}:cap`, mesh: this.capMesh() },
      { name: `${this.name}:boss`, mesh: this.bossMesh() },
      ...this.arms.map((_, i) => ({ name: `${this.name}:arm${i}`, mesh: this.armMesh(i) })),
    ];
  }
}
