/**
 * The West Gate's moving parts as pure kinematics (shared by the scene and the motion tests):
 * leaves rotating about their trunnion axes, telescoping hoists between a fixed pivot under the
 * hood or vault and a lug on each leaf's upper strut, and floor bolts rising into the lip keepers.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { revolve } from '../../geometry/sweep';
import { GATE, leafAngle } from './spec';
import { lugPin } from './leaf';
import { BOLT, boltX, hoistPivotA } from './gatehouse';

export const MECH_SLOT = { steel: 0, bronze: 1, chrome: 2 } as const;

/** Hoist cylinder: barrel (from the fixed pivot) and rod (from the leaf's lug). */
export const HOIST = { barrelLength: 9.6, barrelR: 0.3, rodLength: 10.0, rodR: 0.14 } as const;

/** A rigid transform: rotation (3×3, row-major) then translation. */
export interface Pose {
  r: number[];
  t: Vec3;
}

export function apply(p: Pose, v: Vec3): Vec3 {
  const r = p.r;
  return [r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + p.t[0], r[3] * v[0] + r[4] * v[1] + r[5] * v[2] + p.t[1], r[6] * v[0] + r[7] * v[1] + r[8] * v[2] + p.t[2]];
}

/** A leaf's pose: rotation about z through its trunnion at openness s. */
export function leafPose(trunnionX: number, s: number): Pose {
  const a = leafAngle(s);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return { r: [c, -sn, 0, sn, c, 0, 0, 0, 1], t: [trunnionX, GATE.trunnionY, 0] };
}

/** Pose taking local +y (the hoist parts' axis) onto the direction from `from` toward `to`. */
function aim(from: Vec3, to: Vec3): Pose {
  const y = v3.norm(v3.sub(to, from));
  const z0: Vec3 = [0, 0, 1];
  const x = v3.norm(v3.cross(y, z0));
  const z = v3.cross(x, y);
  return { r: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], t: from };
}

export function hoistPoses(trunnionX: number, side: -1 | 1, s: number): { barrel: Pose; rod: Pose; length: number } {
  const A = hoistPivotA(trunnionX, side);
  const B = apply(leafPose(trunnionX, s), lugPin(side));
  return { barrel: aim(A, B), rod: aim(B, A), length: v3.dist(A, B) };
}

/** Floor bolt pose: translation up by its travel when engaged (e = 1). */
export function boltPose(lipX: number, z: number, e: number): Pose {
  return { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [boltX(lipX), GATE.seal - 0.01 + BOLT.rise * e, z] };
}

const axisY = (x: number, y: number, h: number): Vec3 => [x, h, -y];

export function buildHoistBarrel(): PolyMesh {
  const L = HOIST.barrelLength;
  const R = HOIST.barrelR;
  const prof: Vec2[] = [[0, -0.22], [0.16, -0.22], [0.22, -0.16], [0.22, 0.05], [R - 0.03, 0.12], [R, 0.16], [R, L - 0.42], [R + 0.06, L - 0.36], [R + 0.06, L - 0.06], [R + 0.03, L], [0, L]];
  return revolve(prof, 32, axisY, [1, 1, 1, 0, 0, 0, 0, 0, 0, 0].map(() => MECH_SLOT.steel), 35);
}

export function buildHoistRod(): PolyMesh {
  const L = HOIST.rodLength;
  const r = HOIST.rodR;
  const prof: Vec2[] = [[0, -0.2], [0.14, -0.2], [0.2, -0.13], [0.2, 0.13], [r + 0.02, 0.19], [r, 0.23], [r, L], [0, L]];
  return revolve(prof, 24, axisY, MECH_SLOT.chrome, 35);
}

/** Floor bolt in its own frame: axis +y, its top at the origin (retracted, it sits inside the sill). */
export function buildBolt(): PolyMesh {
  const r = BOLT.radius;
  const h = BOLT.rise + 0.06;
  const prof: Vec2[] = [[0, -h], [r, -h], [r, -0.012], [r - 0.012, 0], [0, 0]];
  return revolve(prof, 20, (x, y, hh) => [x, hh, -y], MECH_SLOT.chrome, 35);
}

/** Transforms a mesh copy by a pose (tests and pose-baked audits). */
export function posed(m: PolyMesh, p: Pose): PolyMesh {
  const out = new PolyMesh(m.crease).append(m);
  out.verts = out.verts.map((v) => apply(p, v));
  return out;
}
