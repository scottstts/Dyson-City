/**
 * Cast nodes: where frame members meet. Every junction is resolved the same way, so no two members
 * ever share a face or run through each other:
 *
 *  - a node is a bronze boss, a parallelogram in S's tangent plane with sides parallel to the two
 *    member directions it joins (d1, d2), proud of every member on every side;
 *  - a member continuous through the junction passes inside it;
 *  - a member that ends is trimmed on a plane parallel to the other direction, 350 mm clear of the
 *    other member's side, so its end sits hidden inside the boss.
 *
 * The boss's extents are measured from the actual footprints of the members it receives, so a rib
 * arriving obliquely (at the Eave Ring) still ends inside it.
 */
import { v3, type Vec3 } from '../../geometry/polyMesh';
import { loftRings, type Plane } from '../../geometry/sweep';
import { LAYER } from './spec';
import { normalAt } from './surface';

/** Clearance between an ending member's trimmed end and the other member's side (covers the curvature of both members and the tilt of S's normal across the junction, at the members' full depth). */
const END_CLEAR = 0.35;
/** How far a member enters the boss beyond its trim plane. */
const ENTRY = 0.35;
/** Boss margin around the footprint of a member it receives. */
const MARGIN = 0.3;
/** Boss height above the tallest member it receives. */
const PROUD = 0.4;

export interface NodeMember {
  /** Unit direction of the member at the node, pointing away from it along the member. */
  dir: Vec3;
  halfWidth: number;
  t1: number;
  /** 1: runs along d1; 2: crosses d1 (enters through the faces parallel to d1). */
  family: 1 | 2;
  /** True if the member passes through (it is not trimmed). */
  continuous: boolean;
}

export class Node {
  readonly name: string;
  readonly p: Vec3;
  readonly n: Vec3;
  readonly d1: Vec3;
  readonly d2: Vec3;
  /** Unit vectors perpendicular to d1 and d2 in the tangent plane. */
  readonly n1: Vec3;
  readonly n2: Vec3;
  readonly sin: number;
  /** Half-widths of the governing members along d1 and d2. */
  readonly w1: number;
  readonly w2: number;
  h1 = 0;
  h2 = 0;
  tTop = 0;
  /**
   * Distance from the other axis at which an ending member of each family is trimmed, per side
   * (−, +). Normally the other member's half-width plus END_CLEAR; further out where two members
   * of one family leave the same side together (two ribs landing on one eave node) and only
   * separate some way from the axis.
   */
  private readonly trimAt: Record<1 | 2, [number, number]> = { 1: [0, 0], 2: [0, 0] };

  constructor(name: string, p: Vec3, d1: Vec3, d2: Vec3, w1: number, w2: number) {
    this.name = name;
    this.p = p;
    this.n = normalAt(p);
    const proj = (d: Vec3) => v3.norm(v3.sub(d, v3.scale(this.n, v3.dot(d, this.n))));
    this.d1 = proj(d1);
    this.d2 = proj(d2);
    this.n1 = v3.norm(v3.cross(this.n, this.d1));
    this.n2 = v3.norm(v3.cross(this.n, this.d2));
    this.sin = Math.abs(v3.dot(this.d1, this.n2));
    this.w1 = w1;
    this.w2 = w2;
  }

  /**
   * Plane on which a member of the given family ends, on the side of `toward` (a point along the
   * member, away from the node).
   */
  trim(family: 1 | 2, toward: Vec3): Plane {
    const axisN = family === 1 ? this.n2 : this.n1;
    const w = family === 1 ? this.w2 : this.w1;
    const side = Math.sign(v3.dot(v3.sub(toward, this.p), axisN)) || 1;
    const d = this.trimAt[family][side < 0 ? 0 : 1] || w + END_CLEAR;
    return { point: v3.add(this.p, v3.scale(axisN, side * d)), normal: axisN };
  }

  /** Oblique coordinates (α, β) of a tangent-plane point: x − p = α·d1 + β·d2. */
  private coords(x: Vec3): [number, number] {
    const d = v3.sub(x, this.p);
    const a11 = 1;
    const a12 = v3.dot(this.d1, this.d2);
    const r1 = v3.dot(d, this.d1);
    const r2 = v3.dot(d, this.d2);
    const det = a11 * 1 - a12 * a12;
    return [(r1 - a12 * r2) / det, (r2 - a12 * r1) / det];
  }

  /** Sizes the boss so every member it receives ends (or passes) well inside it. */
  /** Interval along the axis direction covered by a member's section at distance p from the axis. */
  private interval(m: NodeMember, p: number): [number, number] {
    const axisN = m.family === 1 ? this.n2 : this.n1;
    const axisD = m.family === 1 ? this.d2 : this.d1;
    const cosA = Math.max(Math.abs(v3.dot(m.dir, axisN)), 0.2);
    const centre = v3.add(this.p, v3.scale(m.dir, p / cosA));
    const across = v3.norm(v3.cross(this.n, m.dir));
    // The section's chord in the plane parallel to the axis: its ends where ±halfWidth meet it.
    const c = v3.dot(v3.sub(centre, this.p), axisD);
    const half = m.halfWidth / Math.max(Math.abs(v3.dot(across, axisN)) > 1e-6 ? Math.abs(v3.dot(across, axisN)) : 1, 0.2);
    return [c - half, c + half];
  }

  fit(members: NodeMember[]): this {
    for (const fam of [1, 2] as const) {
      const w = fam === 1 ? this.w2 : this.w1;
      const axisN = fam === 1 ? this.n2 : this.n1;
      for (const side of [-1, 1]) {
        const group = members.filter((m) => !m.continuous && m.family === fam && Math.sign(v3.dot(m.dir, axisN)) === side);
        let d = w + END_CLEAR;
        if (group.length > 1) {
          // Step out until every pair's sections are disjoint (with clearance).
          for (let p = d; p < d + 20; p += 0.02) {
            const iv = group.map((m) => this.interval(m, p)).sort((x, y) => x[0] - y[0]);
            let ok = true;
            for (let i = 0; i + 1 < iv.length; i++) if (iv[i][1] + END_CLEAR > iv[i + 1][0]) ok = false;
            if (ok) {
              d = p;
              break;
            }
          }
        }
        this.trimAt[fam][side < 0 ? 0 : 1] = d;
      }
    }
    let D1 = Math.max(...this.trimAt[1]) + ENTRY;
    let D2 = Math.max(...this.trimAt[2]) + ENTRY;
    this.h1 = D1 / this.sin;
    this.h2 = D2 / this.sin;
    for (let pass = 0; pass < 2; pass++) {
      for (const m of members) {
        if (m.continuous) continue;
        const axisN = m.family === 1 ? this.n2 : this.n1;
        const side = Math.sign(v3.dot(m.dir, axisN)) || 1;
        const w0 = this.trimAt[m.family][side < 0 ? 0 : 1];
        const face = m.family === 1 ? D1 : D2;
        const cosA = Math.abs(v3.dot(m.dir, axisN));
        const across = v3.norm(v3.cross(this.n, m.dir));
        for (const dist of [w0, face]) {
          const centre = v3.add(this.p, v3.scale(m.dir, dist / Math.max(cosA, 0.2)));
          for (const s of [-1, 1]) {
            const [al, be] = this.coords(v3.add(centre, v3.scale(across, s * m.halfWidth)));
            if (m.family === 2) this.h1 = Math.max(this.h1, Math.abs(al) + MARGIN / this.sin);
            else this.h2 = Math.max(this.h2, Math.abs(be) + MARGIN / this.sin);
          }
        }
      }
      D1 = this.h1 * this.sin;
      D2 = this.h2 * this.sin;
    }
    this.tTop = Math.max(...members.map((m) => m.t1)) + PROUD;
    return this;
  }

  /** The boss: a chamfered parallelogram lofted from its seat to a bevelled crown. */
  mesh(slot: number) {
    const c = Math.min(0.35, 0.18 * Math.min(this.h1, this.h2));
    const ring = (inset: number, t: number): Vec3[] => {
      const k = inset / this.sin;
      const h1 = this.h1 - k;
      const h2 = this.h2 - k;
      const base = v3.add(this.p, v3.scale(this.n, t));
      const corner = (s1: number, s2: number) => v3.add(base, v3.add(v3.scale(this.d1, s1 * h1), v3.scale(this.d2, s2 * h2)));
      // Each corner is cut back along both edges by c (an octagon in the parallelogram).
      const pts: Vec3[] = [];
      const order: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
      order.forEach(([s1, s2], i) => {
        const [n1, n2] = order[(i + 1) % 4];
        const p0 = corner(s1, s2);
        const prev = order[(i + 3) % 4];
        const pPrev = corner(prev[0], prev[1]);
        const pNext = corner(n1, n2);
        pts.push(v3.add(p0, v3.scale(v3.norm(v3.sub(pPrev, p0)), c)));
        pts.push(v3.add(p0, v3.scale(v3.norm(v3.sub(pNext, p0)), c)));
      });
      // Counter-clockwise seen from +n.
      const nrm = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]));
      return v3.dot(nrm, this.n) >= 0 ? pts : pts.reverse();
    };
    const t0 = LAYER.nodeT0;
    const t1 = this.tTop;
    const rings = [ring(0.05, t0), ring(0, t0 + 0.06), ring(0, t1 - 0.34), ring(0.12, t1 - 0.16), ring(0.3, t1)];
    return loftRings(rings, slot, 25);
  }
}
