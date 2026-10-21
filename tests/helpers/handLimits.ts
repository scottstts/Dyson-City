/**
 * The Hand's joints as angles (docs/crew.md, "Motion"). Every segment below the pelvis is driven by
 * one rotary actuator, so every local rotation must be a turn about that actuator's axis (nothing
 * off it) within its range (HAND_LIMITS). Signs follow the limits' conventions.
 */
import { Quaternion, Vector3 } from 'three';
import { FOREARM_AXIS, HAND_LIMITS } from '../../src/crew/models/hand';
import type { Pose, RigDef } from '../../src/crew/rig';
import { segmentIndex } from '../../src/crew/rig';

type Lim = readonly [number, number];

/** A turn about `axis` (unit): its angle (sign as given) and how far it strays off its axis. */
function hinge(q: Quaternion, axis: Vector3, sign: number): { angle: number; off: number } {
  const v = new Vector3(q.x, q.y, q.z);
  const w = q.w < 0 ? -1 : 1;
  const along = v.dot(axis) * w;
  const angle = 2 * Math.atan2(along, q.w * w) * sign;
  return { angle: Math.atan2(Math.sin(angle), Math.cos(angle)), off: 2 * v.addScaledVector(axis, -v.dot(axis)).length() };
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const TWIST = { L: new Vector3(...FOREARM_AXIS), R: new Vector3(-FOREARM_AXIS[0], FOREARM_AXIS[1], FOREARM_AXIS[2]) };

export interface LimitBreach {
  joint: string;
  value: number;
  range: Lim;
}

const SLACK = 0.02;
const OFF_AXIS = 0.004;

export function handBreaches(rig: RigDef, pose: Pose): LimitBreach[] {
  const out: LimitBreach[] = [];
  const L = HAND_LIMITS;
  const at = (seg: string, axis: Vector3, sign: number, range: Lim, joint = seg) => {
    const h = hinge(pose.q[segmentIndex(rig, seg)], axis, sign);
    if (h.angle < range[0] - SLACK || h.angle > range[1] + SLACK) out.push({ joint, value: h.angle, range });
    if (h.off > OFF_AXIS) out.push({ joint: `${joint}.offAxis`, value: h.off, range: [0, OFF_AXIS] });
  };
  for (const [s, side] of [['L', 1], ['R', -1]] as const) {
    at(`hipYaw${s}`, Y, side, L.hipYaw);
    at(`hipRoll${s}`, Z, side, L.hipRoll);
    at(`thigh${s}`, X, -1, L.hipPitch, `hipPitch${s}`);
    at(`shin${s}`, X, 1, L.knee, `knee${s}`);
    at(`ankle${s}`, X, 1, L.anklePitch, `anklePitch${s}`);
    at(`foot${s}`, Z, side, L.ankleRoll, `ankleRoll${s}`);
    at(`shoulderPitch${s}`, X, -1, L.shoulderPitch);
    at(`shoulderRoll${s}`, Z, side, L.shoulderRoll);
    at(`upperArm${s}`, Y, side, L.shoulderYaw, `shoulderYaw${s}`);
    at(`forearm${s}`, X, -1, L.elbow, `elbow${s}`);
    at(`wrist${s}`, TWIST[s], side, L.wristTwist, `wristTwist${s}`);
    at(`palm${s}`, Z, -side, L.wristFlex, `wristFlex${s}`);
  }
  at('waistYaw', Y, 1, L.waistYaw);
  at('torso', X, 1, L.waistPitch, 'waistPitch');
  at('neckYaw', Y, 1, L.neckYaw);
  at('head', X, 1, L.neckPitch, 'neckPitch');
  return out;
}
