/**
 * The Hand in motion (docs/crew.md, "Motion"): a scripted run through everything its walker does
 * (start, walk, curve, slow, stop, turn on the spot, crouch, stand, walk reading its slate), checked
 * on every frame at 60 Hz: joints inside their limits and hinges on their axes, soles never through
 * the ground, planted feet never sliding, and on sampled frames no part through another.
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { buildHandRig, FOOT, HAND_PIVOT } from '../src/crew/models/hand';
import { BipedMotion, type BipedCommand, type ArmHold } from '../src/crew/motion/biped';
import { segmentIndex } from '../src/crew/rig';
import { auditGeometry } from '../tools/geometry-kit/geometry-audit.js';
import { crewAllow, posed } from './helpers/crewAudit';
import { handBreaches } from './helpers/handLimits';
import { HAND_SEATS } from '../src/crew/models/seats';

const rig = buildHandRig();
const ground = () => 0;

interface Leg {
  until: number;
  speed: number;
  turnRate: number;
  crouch?: number;
  arms?: ArmHold;
}

/** The script: speeds and turn rates by time (the root integrates them). */
const SCRIPT: Leg[] = [
  { until: 1.0, speed: 0, turnRate: 0 },
  { until: 2.0, speed: 0.6, turnRate: 0 },
  { until: 6.0, speed: 1.1, turnRate: 0 },
  { until: 9.0, speed: 1.1, turnRate: 0.5 },
  { until: 10.0, speed: 0.5, turnRate: 0 },
  { until: 12.0, speed: 0, turnRate: 0 },
  { until: 14.5, speed: 0, turnRate: 0.6 },
  { until: 15.5, speed: 0, turnRate: 0 },
  { until: 19.0, speed: 0, turnRate: 0, crouch: 1 },
  { until: 21.0, speed: 0, turnRate: 0 },
  { until: 26.0, speed: 0.8, turnRate: -0.2, arms: { kind: 'slate', read: 1 } },
  { until: 28.0, speed: 0, turnRate: 0, arms: { kind: 'slate', read: 1 } },
];

function run(visit: (t: number, m: BipedMotion, cmd: BipedCommand) => void): void {
  const dt = 1 / 60;
  let x = 0;
  let z = 0;
  let heading = 0;
  let speed = 0;
  const m = new BipedMotion(rig, x, z, heading, ground);
  const end = SCRIPT[SCRIPT.length - 1].until;
  for (let t = 0; t < end; t += dt) {
    const leg = SCRIPT.find((l) => t < l.until)!;
    // Speed eases like the agents' (no instant starts).
    speed += Math.max(-1.2 * dt, Math.min(0.9 * dt, leg.speed - speed));
    heading += leg.turnRate * dt;
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    const cmd: BipedCommand = { x, z, heading, speed, turnRate: leg.turnRate, look: null, crouch: leg.crouch ?? 0, lean: 0, arms: leg.arms ?? { kind: 'swing' }, ground };
    m.update(dt, cmd);
    visit(t, m, cmd);
  }
}

/** The sole's corners and edge points in the foot's frame (model space, relative to the ankle). */
const SOLE: Vector3[] = (() => {
  const a = HAND_PIVOT.ankle;
  const pts: Vector3[] = [];
  for (const z of [FOOT.heel + 0.004, 0, 0.1, FOOT.toe - 0.004]) for (const x of [-0.04, 0, 0.04]) pts.push(new Vector3(x, -a[1], z - a[2]));
  return pts;
})();

describe('the Hand walking', () => {
  it('keeps every joint in range, every hinge on its axis, every sole on or above the ground', () => {
    const breaches: string[] = [];
    let lowest = Infinity;
    let frames = 0;
    run((t, m) => {
      frames++;
      for (const b of handBreaches(rig, m.pose)) if (breaches.length < 20) breaches.push(`${t.toFixed(2)}s ${b.joint} ${b.value.toFixed(3)} ∉ [${b.range.join(', ')}]`);
      for (const n of ['footL', 'footR']) {
        const w = m.world[segmentIndex(rig, n)];
        for (const p of SOLE) lowest = Math.min(lowest, p.clone().applyMatrix4(w).y);
      }
    });
    expect(frames).toBeGreaterThan(1500);
    expect(breaches).toEqual([]);
    expect(lowest).toBeGreaterThan(-0.004);
  });

  it('never slides a sole on the ground', () => {
    // Every sole point touching the ground in two frames running must stay where it was.
    let worst = 0;
    const last = new Map<string, Vector3[]>();
    run((_t, m) => {
      for (const n of ['footL', 'footR']) {
        const w = m.world[segmentIndex(rig, n)];
        const pts = SOLE.map((p) => p.clone().applyMatrix4(w));
        const prev = last.get(n);
        if (prev) pts.forEach((p, k) => {
          if (p.y < 0.0005 && prev[k].y < 0.0005) worst = Math.max(worst, Math.hypot(p.x - prev[k].x, p.z - prev[k].z));
        });
        last.set(n, pts);
      }
    });
    expect(worst).toBeLessThan(0.001);
  });

  it('never passes a part through another', () => {
    const clashes: string[] = [];
    let k = 0;
    run((t, m) => {
      if (k++ % 20 !== 0) return;
      const g = posed(rig, m.pose, new Matrix4().copy(m.root));
      const r = auditGeometry(g, { clashAllow: crewAllow(rig, HAND_SEATS), clashDepth: 0.0015, clashCellSize: 0.03, maxTriangles: 2_000_000, top: 10, zfight: false });
      for (const c of r.clash) if (clashes.length < 16) clashes.push(`${t.toFixed(2)}s ${c.a} × ${c.b}`);
    });
    expect(clashes).toEqual([]);
  }, 600_000);
});
