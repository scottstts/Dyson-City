/**
 * The crew's models as built (docs/crew.md): every part closed and outward, no coplanar overlap,
 * and no part of one segment in another's but at the declared seats (fingers rooted in the palm).
 */
import { describe, expect, it } from 'vitest';
import { buildHandRig, HAND_HEIGHT } from '../src/crew/models/hand';
import { buildLinewalkerRig } from '../src/crew/models/linewalker';
import { buildRiggerRig } from '../src/crew/models/rigger';
import { buildDrayRig } from '../src/crew/models/dray';
import { buildFerryRig, buildSpotterRig } from '../src/crew/models/drones';
import { buildMower, buildSlate, buildTrimmer } from '../src/crew/models/props';
import { restParts, type RigDef } from '../src/crew/rig';
import { audit, topology } from './helpers/crewAudit';
import { HAND_SEATS } from '../src/crew/models/seats';
import { contactGroups } from './helpers/crewConnect';

const RIGS: [string, () => RigDef, [string, string][]][] = [
  ['Hand', buildHandRig, HAND_SEATS],
  ['Linewalker', buildLinewalkerRig, []],
  ['Rigger', buildRiggerRig, []],
  ['Dray', buildDrayRig, []],
  ['Spotter', buildSpotterRig, []],
  ['Ferry', buildFerryRig, []],
  ['slate', buildSlate, []],
  ['mower', buildMower, []],
  ['trimmer', buildTrimmer, []],
];

describe.each(RIGS)('the %s', (_name, build, seats) => {
  const rig = build();

  it('is clean part by part', () => {
    expect(topology(rig)).toEqual([]);
  });

  it('is one assembly: no piece detached from the rest', () => {
    const groups = contactGroups(rig);
    // Everything but the largest group is detached.
    expect(groups.slice(1)).toEqual([]);
  }, 120_000);

  it('has no coplanar overlap, defect or clash in its rest pose', () => {
    const r = audit(rig, undefined, seats);
    expect(r.zfight, JSON.stringify(r.zfight.slice(0, 6))).toHaveLength(0);
    expect(r.defects, JSON.stringify(r.defects.slice(0, 6))).toHaveLength(0);
    expect(r.clash.map((c) => `${c.a} × ${c.b}`)).toEqual([]);
  }, 120_000);
});

describe('the Hand', () => {
  it('stands its height on the ground', () => {
    let top = -Infinity;
    let bottom = Infinity;
    for (const p of restParts(buildHandRig())) for (const v of p.mesh.verts) {
      top = Math.max(top, v[1]);
      bottom = Math.min(bottom, v[1]);
    }
    expect(top).toBeCloseTo(HAND_HEIGHT, 1);
    expect(bottom).toBeCloseTo(0, 3);
  });
});
