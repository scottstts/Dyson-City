/**
 * The car against the walls (docs/vehicles.md, "Driving"): its plan footprint, an oriented box,
 * against the plan wall segments of every collision world it drives in (the city's and field's,
 * and its own: the estate's terrace wall, which the walker meets as 3D walls instead).
 *
 * Each contact is found by separating axes (the box's two axes and the segment's normal), pushed
 * out by the least penetration, and answered with an impulse at the contact point: a little
 * restitution, and friction along the wall. Hitting a wall square on stops the car with a thud;
 * a glancing touch turns it and lets it scrape along.
 */
import type { CollisionWorld } from '../../player/collision';
import { CAR_PHYSICS, type CarState } from './dynamics';

/** The car's footprint in its own frame: half-width (wheels' outer faces, deployed), half-length, centre z offset. */
export const CAR_FOOTPRINT = { halfWidth: 2.51, halfLength: 3.33, centreZ: -0.04 } as const;
/** Restitution and friction of a contact with a wall. */
const RESTITUTION = 0.18;
const FRICTION = 0.35;

export interface Contact {
  /** Normal impulse (N s) of the hardest contact in the last step, for the sound of the hit. */
  impulse: number;
  /** Speed of the contact point along the wall while touching (m/s), for the scrape. */
  scrape: number;
}

export class CarCollider {
  private readonly worlds: CollisionWorld[];
  private readonly seen = new Set<object>();
  /** The hardest contact since it was last read. */
  readonly contact: Contact = { impulse: 0, scrape: 0 };

  constructor(worlds: CollisionWorld[]) {
    this.worlds = worlds;
  }

  /** Resolves the car's box (its half-width now: the wheels deploy) against every wall near it (one physics step). */
  resolve(s: CarState, halfWidth: number = CAR_FOOTPRINT.halfWidth): void {
    const F = { ...CAR_FOOTPRINT, halfWidth };
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    // The box's left axis.
    const lx = fz;
    const lz = -fx;
    const reach = Math.hypot(F.halfWidth, F.halfLength) + 0.5;
    let scrape = 0;
    for (const world of this.worlds) {
      world.forEachNear(s.x - reach, s.z - reach, s.x + reach, s.z + reach, this.seen, (ax, az, bx, bz) => {
        const cx = s.x + fx * F.centreZ;
        const cz = s.z + fz * F.centreZ;
        const hit = boxSegment(cx, cz, fx, fz, lx, lz, F.halfLength, F.halfWidth, ax, az, bx, bz);
        if (!hit) return;
        // Push out.
        s.x += hit.nx * hit.depth;
        s.z += hit.nz * hit.depth;
        // Impulse at the contact point.
        const rx = hit.px - s.x;
        const rz = hit.pz - s.z;
        const vx = s.vx + s.r * rz;
        const vz = s.vz - s.r * rx;
        const vn = vx * hit.nx + vz * hit.nz;
        if (vn >= 0) return;
        const m = CAR_PHYSICS.mass;
        const I = CAR_PHYSICS.inertia;
        const rn = rz * hit.nx - rx * hit.nz;
        const j = (-(1 + RESTITUTION) * vn) / (1 / m + (rn * rn) / I);
        // Friction along the wall, bounded by the normal impulse.
        const tx = -hit.nz;
        const tz = hit.nx;
        const vt = vx * tx + vz * tz;
        const rt = rz * tx - rx * tz;
        const jtMax = FRICTION * j;
        const jt = Math.max(-jtMax, Math.min(jtMax, -vt / (1 / m + (rt * rt) / I)));
        const Jx = hit.nx * j + tx * jt;
        const Jz = hit.nz * j + tz * jt;
        s.setWorldVelocity(s.vx + Jx / m, s.vz + Jz / m);
        s.r += (rz * Jx - rx * Jz) / I;
        if (j > this.contact.impulse) this.contact.impulse = j;
        scrape = Math.max(scrape, Math.abs(vt));
      }, true);
    }
    this.contact.scrape = Math.max(this.contact.scrape, scrape);
  }

  /** Reads and clears the contact record. */
  take(): Contact {
    const c = { impulse: this.contact.impulse, scrape: this.contact.scrape };
    this.contact.impulse = 0;
    this.contact.scrape = 0;
    return c;
  }
}

interface Hit {
  /** Push-out direction (unit, plan) and depth. */
  nx: number;
  nz: number;
  depth: number;
  /** Contact point. */
  px: number;
  pz: number;
}

/**
 * An oriented box (centre, forward axis f and half-length hl, left axis l and half-width hw)
 * against a segment: the least push that separates them, or null.
 */
export function boxSegment(cx: number, cz: number, fx: number, fz: number, lx: number, lz: number, hl: number, hw: number, ax: number, az: number, bx: number, bz: number): Hit | null {
  // Segment in the box's frame.
  const a0 = (ax - cx) * fx + (az - cz) * fz;
  const a1 = (ax - cx) * lx + (az - cz) * lz;
  const b0 = (bx - cx) * fx + (bz - cz) * fz;
  const b1 = (bx - cx) * lx + (bz - cz) * lz;
  // Box axes.
  const o0 = Math.min(hl - Math.min(a0, b0), Math.max(a0, b0) + hl);
  if (o0 <= 0) return null;
  const o1 = Math.min(hw - Math.min(a1, b1), Math.max(a1, b1) + hw);
  if (o1 <= 0) return null;
  // The segment's normal (in the box frame).
  const ex = b0 - a0;
  const ey = b1 - a1;
  const el = Math.hypot(ex, ey);
  if (el < 1e-6) return null;
  let n0 = -ey / el;
  let n1 = ex / el;
  const dSeg = a0 * n0 + a1 * n1;
  // Orient the normal from the segment toward the box centre.
  if (dSeg > 0) {
    n0 = -n0;
    n1 = -n1;
  }
  const proj = hl * Math.abs(n0) + hw * Math.abs(n1);
  const o2 = proj - Math.abs(dSeg);
  if (o2 <= 0) return null;
  // Least overlap: the segment's normal, or a box axis (the box meeting the segment's end).
  let nb0: number;
  let nb1: number;
  let depth: number;
  if (o2 <= o0 && o2 <= o1) {
    nb0 = n0;
    nb1 = n1;
    depth = o2;
  } else if (o0 <= o1) {
    const mid = (a0 + b0) / 2;
    nb0 = mid > 0 ? -1 : 1;
    nb1 = 0;
    depth = o0;
  } else {
    const mid = (a1 + b1) / 2;
    nb0 = 0;
    nb1 = mid > 0 ? -1 : 1;
    depth = o1;
  }
  // Contact: the box corner deepest past the segment line, clipped to the segment, or the segment
  // end inside the box.
  let p0: number;
  let p1: number;
  const inside = (q0: number, q1: number) => Math.abs(q0) <= hl && Math.abs(q1) <= hw;
  if (inside(a0, a1) && !inside(b0, b1)) {
    p0 = a0;
    p1 = a1;
  } else if (inside(b0, b1) && !inside(a0, a1)) {
    p0 = b0;
    p1 = b1;
  } else {
    // The corner furthest along −n (into the wall).
    p0 = -Math.sign(nb0 || n0) * hl;
    p1 = -Math.sign(nb1 || n1) * hw;
    if (nb0 === 0) p0 = Math.max(-hl, Math.min(hl, (a0 + b0) / 2));
    if (nb1 === 0) p1 = Math.max(-hw, Math.min(hw, (a1 + b1) / 2));
  }
  return {
    nx: nb0 * fx + nb1 * lx,
    nz: nb0 * fz + nb1 * lz,
    depth,
    px: cx + p0 * fx + p1 * lx,
    pz: cz + p0 * fz + p1 * lz,
  };
}
