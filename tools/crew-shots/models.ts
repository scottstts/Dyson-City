/**
 * The models and poses the review tool knows (tools/crew-shots/shots.mjs): the rest pose, or a
 * pose from the robot's own motion run t seconds into a named action.
 */
import { CylinderGeometry, Mesh, MeshStandardMaterial } from 'three/webgpu';
import { Pose, type RigDef } from '../../src/crew/rig';
import { buildHandRig } from '../../src/crew/models/hand';
import { buildLinewalkerRig, LINE_R } from '../../src/crew/models/linewalker';
import { buildRiggerRig } from '../../src/crew/models/rigger';
import { buildDrayRig } from '../../src/crew/models/dray';
import { buildFerryRig, buildSpotterRig } from '../../src/crew/models/drones';
import { buildMower, buildSlate, buildTrimmer } from '../../src/crew/models/props';
import { BipedMotion, type ArmHold } from '../../src/crew/motion/biped';

export const REVIEW_MODELS: Record<string, () => RigDef> = {
  hand: buildHandRig,
  linewalker: buildLinewalkerRig,
  rigger: buildRiggerRig,
  dray: buildDrayRig,
  spotter: buildSpotterRig,
  ferry: buildFerryRig,
  slate: buildSlate,
  mower: buildMower,
  trimmer: buildTrimmer,
};

/** What a model stands on or rides, for its review: the Linewalker's pipe. */
export function reviewContext(model: string): Mesh[] {
  if (model !== 'linewalker') return [];
  const pipe = new Mesh(new CylinderGeometry(LINE_R, LINE_R, 4, 64).rotateX(Math.PI / 2), new MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.4 }));
  return [pipe];
}

const ACTIONS: Record<string, { speed: number; turn: number; crouch: number; arms: ArmHold }> = {
  walk: { speed: 1.0, turn: 0, crouch: 0, arms: { kind: 'swing' } },
  crouch: { speed: 0, turn: 0, crouch: 1, arms: { kind: 'swing' } },
  read: { speed: 0, turn: 0, crouch: 0, arms: { kind: 'slate', read: 1 } },
  carry: { speed: 0.8, turn: 0, crouch: 0, arms: { kind: 'slate', read: 0 } },
  turn: { speed: 0, turn: 0.6, crouch: 0, arms: { kind: 'swing' } },
};

/** A pose by name at time t: the rest pose, or the motion's (root kept at the origin, facing +z). */
export function reviewPose(model: string, rig: RigDef, name: string, t: number): { pose: Pose } {
  const a = ACTIONS[name];
  if (model !== 'hand' || !a) return { pose: new Pose(rig.segments.length) };
  const ground = () => 0;
  const m = new BipedMotion(rig, 0, 0, 0, ground);
  let x = 0;
  let z = 0;
  let heading = 0;
  let speed = 0;
  const dt = 1 / 60;
  for (let s = 0; s < t; s += dt) {
    speed += Math.max(-1.2 * dt, Math.min(0.9 * dt, a.speed - speed));
    heading += a.turn * dt;
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    m.update(dt, { x, z, heading, speed, turnRate: a.turn, look: null, crouch: a.crouch, lean: 0, arms: a.arms, ground });
  }
  return { pose: m.pose };
}
