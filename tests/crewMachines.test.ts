/**
 * The machines in motion (docs/crew.md, "Motion"): every articulated pose a machine takes at work
 * keeps its parts clear of one another: the Rigger walking, turning and reaching with its boom; a
 * Dray's wheels at full lock and its probe down; a Linewalker's head panned and tilted through its
 * range; a Spotter's camera gimbal; the mower's wheels turning.
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { buildRiggerRig } from '../src/crew/models/rigger';
import { QuadMotion, type QuadCommand } from '../src/crew/motion/quad';
import { buildDrayRig, DRAY, WHEELS } from '../src/crew/models/dray';
import { buildLinewalkerRig } from '../src/crew/models/linewalker';
import { buildSpotterRig } from '../src/crew/models/drones';
import { buildMower } from '../src/crew/models/props';
import { Pose, segmentIndex, type RigDef } from '../src/crew/rig';
import { auditGeometry } from '../tools/geometry-kit/geometry-audit.js';
import { crewAllow, posed } from './helpers/crewAudit';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

function clashes(rig: RigDef, pose: Pose, root = new Matrix4()): string[] {
  const r = auditGeometry(posed(rig, pose, root), { clashAllow: crewAllow(rig, []), clashDepth: 0.0015, clashCellSize: 0.03, maxTriangles: 2_000_000, top: 10, zfight: false });
  return r.clash.map((c) => `${c.a} × ${c.b}`);
}

describe('the Rigger at work', () => {
  const rig = buildRiggerRig();

  it('walks, turns and reaches with its boom without a part through another', () => {
    const ground = () => 0;
    const m = new QuadMotion(rig, 0, 0, 0, ground);
    const dt = 1 / 30;
    let x = 0;
    let z = 0;
    let heading = 0;
    const found: string[] = [];
    // Walk, turn on the spot, then reach ahead and up, out to the side, and stow.
    const script: [number, number, number, Vector3 | null][] = [
      [6, 0.45, 0, null],
      [10, 0, 0.28, null],
      [18, 0, 0, new Vector3(0, 4.6, 3.2)],
      [26, 0, 0, new Vector3(2.4, 3.2, 1.6)],
      [34, 0, 0, null],
    ];
    let frame = 0;
    for (let t = 0; t < 34; t += dt) {
      const [, speed, turnRate, local] = script.find((s) => t < s[0])!;
      heading += turnRate * dt;
      x += Math.sin(heading) * speed * dt;
      z += Math.cos(heading) * speed * dt;
      const target = local ? local.clone().applyAxisAngle(Y, heading).add(new Vector3(x, 0, z)) : null;
      const cmd: QuadCommand = { x, z, heading, speed, turnRate, boomTarget: target, standOff: 0.45, ground };
      m.update(dt, cmd);
      if (frame++ % 15 === 0) for (const c of clashes(rig, m.pose, m.root)) if (found.length < 12) found.push(`${t.toFixed(1)}s ${c}`);
    }
    // It reached: the stage slid out.
    expect(found).toEqual([]);
  }, 600_000);
});

describe('the Dray at work', () => {
  const rig = buildDrayRig();

  it('steers to full lock and lowers its probe without a part through another', () => {
    const found: string[] = [];
    for (const steer of [-DRAY.lock, 0, DRAY.lock]) {
      for (const probe of [0, 1]) {
        const pose = new Pose(rig.segments.length);
        for (const n of WHEELS) {
          const front = n.startsWith('F');
          pose.q[segmentIndex(rig, `knuckle${n}`)].setFromAxisAngle(Y, front ? steer : -steer);
          pose.q[segmentIndex(rig, `wheel${n}`)].setFromAxisAngle(X, 1.3);
        }
        pose.t[segmentIndex(rig, 'probe')].set(0, -DRAY.probe.travel * probe, 0);
        for (const c of clashes(rig, pose)) found.push(`steer ${steer.toFixed(2)} probe ${probe}: ${c}`);
      }
    }
    expect(found).toEqual([]);
  }, 300_000);
});

describe('the Linewalker on its line', () => {
  const rig = buildLinewalkerRig();

  it('pans and tilts its head through its range, rollers turning, without a part through another', () => {
    const found: string[] = [];
    for (const pan of [0, 1.2, Math.PI, -2.0]) {
      for (const tilt of [-0.12, -0.6]) {
        const pose = new Pose(rig.segments.length);
        pose.q[segmentIndex(rig, 'pan')].setFromAxisAngle(Y, pan);
        pose.q[segmentIndex(rig, 'tilt')].setFromAxisAngle(X, -tilt);
        pose.q[segmentIndex(rig, 'rollerF')].setFromAxisAngle(X, 0.7);
        pose.q[segmentIndex(rig, 'rollerR')].setFromAxisAngle(X, 0.7);
        for (const c of clashes(rig, pose)) found.push(`pan ${pan.toFixed(2)} tilt ${tilt}: ${c}`);
      }
    }
    expect(found).toEqual([]);
  }, 300_000);
});

describe('the Spotter’s camera', () => {
  const rig = buildSpotterRig();

  it('turns and tilts through its range without a part through another', () => {
    const found: string[] = [];
    for (const yaw of [0, 1.5, Math.PI, -2.2]) {
      for (const tilt of [-0.3, 0.25, 1.2]) {
        const pose = new Pose(rig.segments.length);
        pose.q[segmentIndex(rig, 'gimbalYaw')].setFromAxisAngle(Y, yaw);
        pose.q[segmentIndex(rig, 'camera')].setFromAxisAngle(X, tilt);
        for (const c of clashes(rig, pose)) found.push(`yaw ${yaw.toFixed(2)} tilt ${tilt}: ${c}`);
      }
    }
    expect(found).toEqual([]);
  }, 300_000);
});

describe('the mower', () => {
  const rig = buildMower();

  it('rolls its wheels and roller without a part through another', () => {
    const pose = new Pose(rig.segments.length);
    for (const s of rig.segments) if (s.parent >= 0) pose.q[segmentIndex(rig, s.name)].copy(new Quaternion().setFromAxisAngle(X, 2.1));
    expect(clashes(rig, pose)).toEqual([]);
  });
});
