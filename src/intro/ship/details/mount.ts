/**
 * Mounting fittings on the ship's facets: a fitting is modelled in its own frame (x along u, y along
 * v, z out of the facet along w) with its base a centimetre under the skin, and carried onto the
 * facet by its basis. Every mount records its footprint (parts.ts) so the tests can check it lies on
 * its facet.
 */
import { convexSolid, planeAt, withBevels, type HalfSpace } from '../../../geometry/convex';
import { box, extrudeBevel, type Basis } from '../../../geometry/solids';
import { roundedRect } from '../../../geometry/sweep';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import type { ShipParts } from '../parts';

/** How deep a fitting's base sits under the skin it is mounted on (m). */
export const SINK = 0.01;

/** A frame on a facet: its origin `at` projected onto the plane, u along `hint` in the plane. */
export function facetFrame(pl: HalfSpace, at: Vec3, hint: Vec3): Basis {
  const n = pl.n;
  const o = v3.sub(at, v3.scale(n, v3.dot(n, at) - pl.d));
  const u = v3.norm(v3.sub(hint, v3.scale(n, v3.dot(n, hint))));
  return { o, u, v: v3.cross(n, u), w: n };
}

/** A point of a frame. */
export function frameAt(b: Basis, x: number, y: number, z: number): Vec3 {
  return v3.add(b.o, v3.add(v3.add(v3.scale(b.u, x), v3.scale(b.v, y)), v3.scale(b.w, z)));
}

/** A sub-frame: origin moved (in the frame), axes kept, or turned to new ones given in the frame. */
export function subFrame(b: Basis, o: Vec3, u: Vec3 = [1, 0, 0], v: Vec3 = [0, 1, 0], w: Vec3 = [0, 0, 1]): Basis {
  const dir = (d: Vec3): Vec3 => v3.add(v3.add(v3.scale(b.u, d[0]), v3.scale(b.v, d[1])), v3.scale(b.w, d[2]));
  return { o: frameAt(b, o[0], o[1], o[2]), u: dir(u), v: dir(v), w: dir(w) };
}

/** A convex solid modelled in a frame's local coordinates, carried onto it. */
export function localSolid(b: Basis, planes: HalfSpace[], bevel: (i: number, j: number) => number, slot: number): PolyMesh {
  return convexSolid(withBevels(planes, bevel), () => slot).transform((p) => frameAt(b, p[0], p[1], p[2]));
}

/** A half-space in a frame's (x, z) plane: the side of the line a→b that holds `inside`. */
export function sideXZ(a: Vec2, b: Vec2, inside: Vec2): HalfSpace {
  let n: Vec3 = v3.norm([b[1] - a[1], 0, -(b[0] - a[0])]);
  if (n[0] * (inside[0] - a[0]) + n[2] * (inside[1] - a[1]) > 0) n = v3.scale(n, -1);
  return planeAt(n, [a[0], 0, a[1]]);
}

/** A box's planes in local coordinates: x ±hx, y ±hy, z from z0 to z1. */
export function boxPlanes(hx: number, hy: number, z0: number, z1: number): HalfSpace[] {
  return [
    { n: [0, 0, -1], d: -z0 },
    { n: [0, 0, 1], d: z1 },
    { n: [1, 0, 0], d: hx },
    { n: [-1, 0, 0], d: hx },
    { n: [0, 1, 0], d: hy },
    { n: [0, -1, 0], d: hy },
  ];
}

/** Records a mount's rectangular footprint (±hx, ±hy about its frame's origin). */
export function footprint(parts: ShipParts, name: string, body: 'hull' | 'nacelle', plane: number, b: Basis, hx: number, hy: number): void {
  parts.footprints.push({ name, body, plane, corners: [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => frameAt(b, x, y, 0)) });
}

/**
 * A louvred panel on a frame: a doubler plate, slats across it at 45° along u (air out of what is
 * behind, a straight look in kept out).
 */
export function louvres(b: Basis, hx: number, hy: number, pitch: number, plateSlot: number, slatSlot: number): { plate: PolyMesh; slats: PolyMesh } {
  const plate = extrudeBevel(roundedRect(hx, hy, 0.04, 4), b, -SINK, 0.015, 0.004, plateSlot);
  const slats = new PolyMesh(40);
  const k = Math.SQRT1_2;
  const n = Math.floor((2 * hx - 0.08) / pitch);
  for (let i = 0; i < n; i++) {
    const x = -hx + 0.04 + pitch * (i + 0.5);
    slats.append(box(subFrame(b, [x, 0, 0.027], [k, 0, k], [0, 1, 0], [-k, 0, k]), 0.005, hy - 0.05, 0.025, 0.002, slatSlot));
  }
  return { plate, slats };
}

/**
 * A flat ring between two loops with matching points (inner and outer, counter-clockwise about
 * −w), offset `stand` along w and `thick` deep: one closed solid.
 */
export function planarRing(inner: Vec3[], outer: Vec3[], w: Vec3, stand: number, thick: number, slot: number): PolyMesh {
  if (inner.length !== outer.length) throw new Error('planarRing: loops differ in length');
  const m = new PolyMesh(40);
  const n = inner.length;
  const at = (p: Vec3, d: number) => m.vert(v3.add(p, v3.scale(w, d)));
  const i0 = inner.map((p) => at(p, stand));
  const o0 = outer.map((p) => at(p, stand));
  const i1 = inner.map((p) => at(p, stand + thick));
  const o1 = outer.map((p) => at(p, stand + thick));
  const uv: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    m.face([o0[k], o0[k1], i0[k1], i0[k]], slot, uv);
    m.face([o1[k], i1[k], i1[k1], o1[k1]], slot, uv);
    m.face([o0[k1], o0[k], o1[k], o1[k1]], slot, uv);
    m.face([i0[k], i0[k1], i1[k1], i1[k]], slot, uv);
  }
  return orient(m);
}

function orient(m: PolyMesh): PolyMesh {
  let vol = 0;
  for (const f of m.faces) {
    const a = m.verts[f[0]];
    for (let i = 1; i + 1 < f.length; i++) vol += v3.dot(a, v3.cross(m.verts[f[i]], m.verts[f[i + 1]]));
  }
  if (vol < 0) m.faces = m.faces.map((f) => [...f].reverse());
  return m;
}

