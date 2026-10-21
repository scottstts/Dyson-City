/**
 * Inverse kinematics for the crew's limbs (docs/crew.md, "Motion"). A limb is two rigid links on a
 * hinge (a knee, an elbow) hung from a ball joint (a hip, a shoulder): the hinge's place comes from
 * the triangle of the two link lengths and the reach, bent toward a pole; each link's orientation
 * is then fixed by two directions, its axis and the hinge's axis, so the hinge turns about its own
 * axis only (as the clevis allows) and nothing twists along a link.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _m0 = new Matrix4();
const _m1 = new Matrix4();

/**
 * The rotation taking a rest frame (rest axis, rest hinge) onto a world frame (axis, hinge): both
 * pairs are orthonormalised (hinge ⟂ axis) and completed to right-handed bases.
 */
export function alignFrames(restAxis: Vector3, restHinge: Vector3, axis: Vector3, hinge: Vector3, out: Quaternion): Quaternion {
  basis(restAxis, restHinge, _m0);
  basis(axis, hinge, _m1);
  // R = B · B0ᵀ (B0 orthonormal: its inverse is its transpose).
  _m0.transpose();
  _m1.multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

/** Columns (hinge', axis, hinge' × axis) with hinge' the hinge made ⟂ axis. */
function basis(axis: Vector3, hinge: Vector3, out: Matrix4): Matrix4 {
  _a.copy(axis).normalize();
  _b.copy(hinge).addScaledVector(_a, -hinge.dot(_a)).normalize();
  _c.crossVectors(_b, _a);
  return out.makeBasis(_b, _a, _c);
}

export interface TwoBone {
  /** Upper and lower link lengths. */
  l1: number;
  l2: number;
}

/**
 * The hinge's position for a limb from `root` reaching `target`, bent toward `pole` (a direction):
 * the reach is clamped just short of straight (a fully straight limb has no defined bend) and no
 * shorter than the links allow. Returns how far the target was out of reach (0 when reached).
 */
export function solveHinge(limb: TwoBone, root: Vector3, target: Vector3, pole: Vector3, outHinge: Vector3, outEnd: Vector3): number {
  const d = _a.subVectors(target, root);
  const dist = d.length();
  const max = (limb.l1 + limb.l2) * 0.9995;
  const min = Math.abs(limb.l1 - limb.l2) + 1e-4;
  const r = Math.min(max, Math.max(min, dist));
  const dir = d.multiplyScalar(1 / Math.max(dist, 1e-9));
  // The bend's direction: the pole made ⟂ the reach.
  const bend = _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
  bend.normalize();
  // Law of cosines: the hinge sits a along the reach and h off it.
  const a = (limb.l1 * limb.l1 - limb.l2 * limb.l2 + r * r) / (2 * r);
  const h = Math.sqrt(Math.max(0, limb.l1 * limb.l1 - a * a));
  outHinge.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
  outEnd.copy(root).addScaledVector(dir, r);
  return Math.max(0, dist - r);
}

/** The local rotation of a child given its world rotation and its parent's (q = parent⁻¹ · world). */
export function localOf(parentWorld: Quaternion, world: Quaternion, out: Quaternion): Quaternion {
  return out.copy(parentWorld).invert().multiply(world);
}

/** The signed angle (radians) from a to b about an axis (all unit; a, b taken ⟂ axis). */
export function angleAbout(a: Vector3, b: Vector3, axis: Vector3): number {
  const pa = _a.copy(a).addScaledVector(axis, -a.dot(axis));
  const pb = _b.copy(b).addScaledVector(axis, -b.dot(axis));
  return Math.atan2(_c.crossVectors(pa, pb).dot(axis), pa.dot(pb));
}
