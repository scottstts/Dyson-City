/**
 * The ship's openings to the outside as analytic outlines (docs/intro-ship.md, "Light"): the three
 * cockpit panes and the door. Each is a rounded convex polygon on a hull plane, in the ship's
 * frame: the polygon's core and a corner radius (the outline is every point within the radius of
 * the core). They are what the cabin's light comes through (cabinLight.ts), what its glossy
 * surfaces see outside, and the glass itself (canopy.ts).
 *
 * The cabin is convex (the hull's inner skin), so a ray from inside leaves through exactly one
 * point of it: whether that point is in an opening decides what the ray sees.
 */
import { Fn, If, dot, float, max, min, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { planeBasis } from '../../geometry/convex';
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { PANES, GLASS_INSET, doorAperture, HULL_BEVELLED } from './hull';
import { HULL_T } from './spec';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

export interface Opening {
  name: string;
  /** Plane (n·x = d) the outline lies in, its in-plane basis and origin. */
  n: Vec3;
  d: number;
  u: Vec3;
  v: Vec3;
  o: Vec3;
  /** The core polygon in (u, v), counter-clockwise, and the rounding radius. */
  core: Vec2[];
  r: number;
}

function opening(name: string, n: Vec3, d: number, core3: Vec3[], r: number): Opening {
  const { u, v } = planeBasis(n);
  const o = core3[0];
  const to2 = (p: Vec3): Vec2 => [v3.dot(v3.sub(p, o), u), v3.dot(v3.sub(p, o), v)];
  let core = core3.map(to2);
  // Counter-clockwise in (u, v).
  let a = 0;
  for (let i = 0; i < core.length; i++) a += core[i][0] * core[(i + 1) % core.length][1] - core[(i + 1) % core.length][0] * core[i][1];
  if (a < 0) core = [...core].reverse();
  return { name, n, d, u, v, o, core, r };
}

/** The panes, at the glass's own plane (GLASS_INSET in from the outer skin). */
export const WINDOWS: readonly Opening[] = PANES.map((p) => {
  const pl = HULL_BEVELLED[p.plane];
  const core = p.core.map((q) => v3.sub(q, v3.scale(pl.n, GLASS_INSET)));
  return opening(p.name, pl.n, pl.d - GLASS_INSET, core, p.r);
});

/** The door's opening, at the inner skin. */
export const DOOR_OPENING: Opening = (() => {
  const a = doorAperture() as { plane: number; centre: Vec3; u: Vec3; hw: number; hh: number; r: number };
  const pl = HULL_BEVELLED[a.plane];
  const n = pl.n;
  const d = pl.d - HULL_T;
  const u = v3.norm(v3.sub(a.u, v3.scale(n, v3.dot(a.u, n))));
  const v = v3.cross(n, u);
  const c = v3.sub(a.centre, v3.scale(n, v3.dot(n, a.centre) - d));
  const hw = a.hw - a.r;
  const hh = a.hh - a.r;
  const corner = (x: number, y: number) => v3.add(c, v3.add(v3.scale(u, x), v3.scale(v, y)));
  return opening('door', n, d, [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)], a.r);
})();

/** Distance (≥ 0) from a point to a convex polygon in 2D (0 inside). */
function polyDistance(core: Vec2[], p: Vec2): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < core.length; i++) {
    const a = core[i];
    const b = core[(i + 1) % core.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    // Outward normal of a CCW edge: (ey, −ex).
    if ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex > 0) inside = false;
    const t = Math.min(Math.max(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey), 0), 1);
    best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t));
  }
  return inside ? 0 : best;
}

/** CPU: the distance along a ray (ship frame) to where it crosses an opening, or −1. */
export function openingHitCPU(op: Opening, o: Vec3, d: Vec3): number {
  const den = v3.dot(op.n, d);
  if (Math.abs(den) < 1e-9) return -1;
  const t = (op.d - v3.dot(op.n, o)) / den;
  if (t <= 0) return -1;
  const q = v3.add(o, v3.scale(d, t));
  const rel = v3.sub(q, op.o);
  return polyDistance(op.core, [v3.dot(rel, op.u), v3.dot(rel, op.v)]) <= op.r ? t : -1;
}

/** Shader: the distance along a ray (ship frame) to where it crosses an opening, or −1. */
export function openingHit(op: Opening, o: V3, d: V3): F {
  return openingFns.get(op)!(o, d);
}

const openingFns = new Map<Opening, (o: V3, d: V3) => F>();
for (const op of [...WINDOWS, DOOR_OPENING]) {
  const fn = Fn(([o, d]: [V3, V3]) => {
    const n = vec3(...op.n);
    const den = dot(n, d);
    const safe = den.abs().lessThan(1e-6).select(float(1e-6), den);
    const t = float(op.d).sub(dot(n, o)).div(safe);
    const q = o.add(d.mul(t)).sub(vec3(...op.o));
    const p = vec2(dot(q, vec3(...op.u)), dot(q, vec3(...op.v)));
    // Outside the core's edges by at most the radius: the rounded outline.
    let outside: F = float(-1e9);
    let dist: F = float(1e9);
    for (let i = 0; i < op.core.length; i++) {
      const a = op.core[i];
      const b = op.core[(i + 1) % op.core.length];
      const e = vec2(b[0] - a[0], b[1] - a[1]);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const len = Math.sqrt(len2);
      const pa = p.sub(vec2(a[0], a[1]));
      outside = max(outside, pa.x.mul(e.y).sub(pa.y.mul(e.x)).div(len)) as unknown as F;
      const h = pa.dot(e).div(len2).clamp(0, 1);
      dist = min(dist, pa.sub(e.mul(h)).length()) as unknown as F;
    }
    const inside = outside.lessThanEqual(0.0).or(dist.lessThanEqual(op.r));
    const out = float(-1).toVar();
    If(t.greaterThan(0.0).and(inside), () => {
      out.assign(t);
    });
    return out;
  }).setLayout({ name: `introOpening_${op.name.replace(/[^a-z]/g, '')}`, type: 'float', inputs: [{ name: 'o', type: 'vec3' }, { name: 'd', type: 'vec3' }] }) as unknown as (o: V3, d: V3) => F;
  openingFns.set(op, fn);
}

