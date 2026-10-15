/**
 * The Dome's reference surface S (the glass's outer face) and the curve families every member and
 * glazing bar follows. All members are sections of S by vertical planes (ribs, rails, ties, posts,
 * collar legs), horizontal circles (the Eave Ring, drum transoms) or the collars' arch circles, so
 * every junction is between curves on one surface.
 *
 * Below the platform top (S's equator) S is continued straight down: the vertical tangent there
 * carries members down to the steps with a continuous surface normal.
 */
import { v3, type Vec3 } from '../../geometry/polyMesh';
import { DOME } from './spec';

const { a, c, centreY: Y0 } = DOME;

/** Height of S above plan radius r (r ≤ a). */
export function heightAt(r: number): number {
  const q = 1 - (r / a) ** 2;
  return Y0 + c * Math.sqrt(Math.max(q, 0));
}

/** Plan radius of S at height y (y ≥ Y0). */
export function radiusAt(y: number): number {
  if (y <= Y0) return a;
  const q = 1 - ((y - Y0) / c) ** 2;
  return a * Math.sqrt(Math.max(q, 0));
}

/** Outward unit normal of S at a point on it. */
export function normalAt(p: Vec3): Vec3 {
  const dy = Math.max(p[1] - Y0, 0);
  return v3.norm([p[0] / (a * a), dy / (c * c), p[2] / (a * a)]);
}

/**
 * Where the line through q along direction d (unit) meets S (the upper head), nearest q: drapes a
 * point of a planar layout onto the surface.
 */
export function dropToS(q: Vec3, d: Vec3): Vec3 {
  let p = q;
  for (let i = 0; i < 6; i++) {
    const y = p[1] - Y0;
    const F = (p[0] * p[0] + p[2] * p[2]) / (a * a) + (y * y) / (c * c) - 1;
    const g: Vec3 = [(2 * p[0]) / (a * a), (2 * y) / (c * c), (2 * p[2]) / (a * a)];
    const dF = v3.dot(g, d);
    if (Math.abs(dF) < 1e-12) break;
    p = v3.sub(p, v3.scale(d, F / dF));
  }
  return p;
}

/** A point at offset t outward from the surface point p. */
export function offset(p: Vec3, t: number): Vec3 {
  return v3.add(p, v3.scale(normalAt(p), t));
}

export type Curve = (u: number) => Vec3;

/**
 * Section of S by the vertical plane {x = x0} (axis 'x') or {z = z0} (axis 'z'), parametrised
 * by θ: θ = 0 at the far +side equator, π/2 at the top, π at the −side equator. Values of θ
 * outside [0, π] continue straight down below the equator.
 */
export function planeSection(axis: 'x' | 'z', k: number): Curve {
  const A = Math.sqrt(Math.max(a * a - k * k, 0));
  const C = (c * A) / a;
  return (u) => {
    let w: number;
    let y: number;
    if (u < 0) {
      w = A;
      y = Y0 + C * u;
    } else if (u > Math.PI) {
      w = -A;
      y = Y0 - C * (u - Math.PI);
    } else {
      w = A * Math.cos(u);
      y = Y0 + C * Math.sin(u);
    }
    return axis === 'x' ? [k, y, w] : [w, y, k];
  };
}

/** θ on a plane section where the in-plane coordinate equals w (on the upper half). */
export function planeSectionParam(_axis: 'x' | 'z', k: number, w: number): number {
  const A = Math.sqrt(a * a - k * k);
  return Math.acos(Math.min(Math.max(w / A, -1), 1));
}

/** Section of S by the vertical plane through the axis at azimuth φ (x = r cos φ, z = r sin φ). */
export function meridian(phi: number): Curve {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  // u = elevation parameter: 0 at the equator, π/2 at the top; negative continues down.
  return (u) => {
    const r = u < 0 ? a : a * Math.cos(u);
    const y = u < 0 ? Y0 + c * u : Y0 + c * Math.sin(u);
    return [r * cp, y, r * sp];
  };
}

/** Elevation parameter of a meridian at height y. */
export function meridianParam(y: number): number {
  return y >= Y0 ? Math.asin(Math.min((y - Y0) / c, 1)) : (y - Y0) / c;
}

/** Horizontal circle on S at plan radius r, parametrised by azimuth φ. */
export function ring(r: number): Curve {
  const y = heightAt(r);
  return (phi) => [r * Math.cos(phi), y, r * Math.sin(phi)];
}

/** Outward horizontal direction and lateral direction of a cardinal point (azimuth φ). */
export interface Cardinal {
  name: 'west' | 'east' | 'north' | 'south';
  /** Azimuth of the outward direction (x = cos φ, z = sin φ). */
  phi: number;
  out: [number, number];
  /** Lateral axis (90° counter-clockwise from out, in plan). */
  lat: [number, number];
}

export const CARDINALS: readonly Cardinal[] = [
  { name: 'east', phi: 0, out: [1, 0], lat: [0, 1] },
  { name: 'south', phi: Math.PI / 2, out: [0, 1], lat: [-1, 0] },
  { name: 'west', phi: Math.PI, out: [-1, 0], lat: [0, -1] },
  { name: 'north', phi: -Math.PI / 2, out: [0, -1], lat: [1, 0] },
];

/** Point on S at lateral offset w and height y on the outward side of a cardinal point. */
export function cardinalPoint(k: Cardinal, w: number, y: number): Vec3 {
  const r = radiusAt(y);
  const along = Math.sqrt(Math.max(r * r - w * w, 0));
  return [k.out[0] * along + k.lat[0] * w, Math.max(y, -1e9), k.out[1] * along + k.lat[1] * w];
}

/**
 * A collar: a semicircular arch (radius R about height yc) on two vertical legs at lateral ±R,
 * as one curve on S. u runs from the −lateral foot (u = 0) up the leg, over the arch, and down the
 * +lateral leg to its foot (u = 1). `footY` is where the legs end.
 */
export function collarCurve(k: Cardinal, footY: number): { curve: Curve; uOfPsi(psi: number): number; uOfLegY(side: -1 | 1, y: number): number } {
  const { radius: R, centreY: yc } = DOME.arch;
  const leg = yc - footY;
  const arc = Math.PI * R;
  const total = 2 * leg + arc;
  const point = (w: number, y: number): Vec3 => {
    if (y >= Y0) return cardinalPoint(k, w, y);
    // Below the equator S continues straight down.
    const p = cardinalPoint(k, w, Y0);
    return [p[0], y, p[2]];
  };
  const curve: Curve = (u) => {
    const s = u * total;
    if (s <= leg) return point(-R, footY + s);
    if (s >= leg + arc) return point(R, yc - (s - leg - arc));
    const psi = -Math.PI / 2 + (s - leg) / R; // −90° at the −lateral spring, +90° at the other
    return point(R * Math.sin(psi), yc + R * Math.cos(psi));
  };
  return {
    curve,
    uOfPsi: (psi) => (leg + (psi + Math.PI / 2) * R) / total,
    uOfLegY: (side, y) => (side < 0 ? (y - footY) / total : (leg + arc + (yc - y)) / total),
  };
}

/** Point on a vertical-plane section continued below the equator, as used by rails and legs. */
export function lateralSection(k: Cardinal, w: number): Curve {
  // Parameter: height y (any value; below Y0 the curve is vertical).
  return (y) => {
    if (y >= Y0) return cardinalPoint(k, w, y);
    const p = cardinalPoint(k, w, Y0);
    return [p[0], y, p[2]];
  };
}

/** Unit tangent of a curve at u (central difference). */
export function tangent(curve: Curve, u: number, du = 1e-5): Vec3 {
  return v3.norm(v3.sub(curve(u + du), curve(u - du)));
}

/** Finds u in [u0, u1] where f(curve(u)) changes sign (bisection; f must bracket a root). */
export function solve(curve: Curve, u0: number, u1: number, f: (p: Vec3) => number): number {
  let lo = u0;
  let hi = u1;
  let flo = f(curve(lo));
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(curve(mid));
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}
