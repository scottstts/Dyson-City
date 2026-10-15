/**
 * Bolted end-plate splices: where a member meets a cast node's arm, and at field splices between
 * two shop lengths of one member. Each is a pair of plates (one welded to each side) drawn as one
 * solid with the joint between them as a groove round its edge, proud of the member's envelope on
 * the sides and the outer face, bolted through its margin; on a member's side the recess between its
 * flanges leaves the plate exposed, so a bolt column runs up it too.
 */
import { v3, type PolyMesh, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { sweep, type Frame, type Plane, type Profile } from '../../geometry/sweep';
import { pitchAlong, type Bolt } from './bolts';
import { GIRDER, JOINT, LAYER } from './spec';
import { SLOT } from './slots';
import { memberT0, memberT1, sectionDims, type Kind } from './girder';
import { normalAt, tangent, type Curve } from './surface';

export interface SpliceSite {
  /** Centre: on S, on the member's curve. */
  p: Vec3;
  /** Along the member (from side a to side b), S's normal, and across (N × T). */
  T: Vec3;
  N: Vec3;
  B: Vec3;
  kind: Kind;
  t0: number;
  t1: number;
  /** Which faces open onto a member (recess bolt columns): a (−T), b (+T). */
  memberA: boolean;
  memberB: boolean;
}

/** The splice frame at u on a curve, T pointing toward increasing u when sign = 1. */
export function spliceSite(curve: Curve, u: number, sign: 1 | -1, kind: Kind, memberA: boolean, memberB: boolean): SpliceSite {
  const p = curve(u);
  const N = normalAt(p);
  const t = v3.scale(tangent(curve, u), sign);
  const T = v3.norm(v3.sub(t, v3.scale(N, v3.dot(t, N))));
  const B = v3.norm(v3.cross(N, T));
  return { p, T, N, B, kind, t0: memberT0(p[1]), t1: memberT1(kind, p[1]), memberA, memberB };
}

/** The plate's faces as trim planes for what enters them (moved `JOINT.seat` into the plate). */
export function spliceFace(site: SpliceSite, side: 'a' | 'b'): Plane {
  const k = side === 'a' ? -1 : 1;
  return { point: v3.add(site.p, v3.scale(site.T, k * (JOINT.plateHalf - JOINT.seat))), normal: site.T };
}

/** Plate outline (b, t) inset by d: chamfered rectangle round the member's envelope. */
function outline(site: SpliceSite, d: number): Profile {
  const hw = sectionDims(site.kind, site.t0, site.t1).hw;
  const m = JOINT.plateMargin;
  const W = hw + m - d;
  const T0 = site.t0 + LAYER.plateLift + d;
  const T1 = site.t1 + m - d;
  const cb = 0.03;
  const ct = 0.12;
  const pts: Vec2[] = [[-W + cb, T0], [W - cb, T0], [W, T0 + cb], [W, T1 - ct], [W - ct, T1], [-W + ct, T1], [-W, T1 - ct], [-W, T0 + cb]];
  return { pts, slots: pts.map(() => SLOT.black) };
}

/** The plate pair: arrised outer faces and the joint groove between the two plates. */
export function spliceMesh(site: SpliceSite): PolyMesh {
  const h = JOINT.plateHalf;
  const rings: [number, number][] = [[-h, 0.03], [-h + 0.03, 0], [-0.04, 0], [-0.015, 0.05], [0.015, 0.05], [0.04, 0], [h - 0.03, 0], [h, 0.03]];
  const frames: Frame[] = rings.map(([s]) => ({ p: v3.add(site.p, v3.scale(site.T, s)), t: site.T, n: site.N, b: site.B, s: s + h }));
  return sweep(frames, (_f, i) => outline(site, rings[i][1]), { crease: 30, capSlot: SLOT.black });
}

/** Bolts on both plate faces: round the margin, and up the member's recess where a member enters. */
export function spliceBolts(site: SpliceSite, out: Bolt[]): void {
  const d = sectionDims(site.kind, site.t0, site.t1);
  const m = JOINT.plateMargin;
  const Wb = d.hw + m * 0.5;
  const Tb = site.t1 + m * 0.5;
  const tb0 = site.t0 + 0.35;
  const ring = pitchAlong([[Wb, tb0], [Wb, Tb], [-Wb, Tb], [-Wb, tb0]], JOINT.boltPitch);
  const lo = site.t0 + d.fb + GIRDER.fillet + 0.25;
  const hi = site.t1 - d.ft - GIRDER.fillet - 0.25;
  const column: [number, number][] = [];
  for (const [, t] of pitchAlong([[0, lo], [0, hi]], JOINT.boltPitch)) {
    if (d.heavy && Math.abs(t - d.tl) < d.lh + 0.18) continue;
    const bc = d.web + d.recess * 0.5;
    column.push([bc, t], [-bc, t]);
  }
  for (const [side, member] of [[-1, site.memberA], [1, site.memberB]] as const) {
    const face = v3.add(site.p, v3.scale(site.T, side * JOINT.plateHalf));
    const axis = v3.scale(site.T, side);
    for (const [b, t] of member ? [...ring, ...column] : ring) out.push({ p: v3.madd(face, site.B, b, site.N, t), axis, spin: site.N });
  }
}
