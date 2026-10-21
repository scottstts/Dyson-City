/**
 * The crew's fixtures in the field (docs/crew.md, "Fixtures"): every cradle, pad and socket is a
 * clean closed solid; each stands on open paving, its footprint clear of everything the field holds
 * at body height (the occupancy the walker and the crew share, before the fixtures joined it), clear
 * of the others, and off the roads.
 */
import { describe, expect, it } from 'vitest';
import { Crew, FIELD_OCC } from '../src/crew/crew';
import { crewWorld } from './helpers/crewWorld';
import { cradleParts, FIXTURE_R, padParts, socketParts } from '../src/crew/fixtures';
import { onRoad } from '../src/field/layout';
import { RigBuilder } from '../src/crew/rig';
import { audit, topology } from './helpers/crewAudit';
import type { PartDef } from '../src/crew/rig';
import type { Vec3 } from '../src/geometry/polyMesh';

describe('the crew’s fixtures', () => {
  const inputs = crewWorld().inputs;
  const occ = inputs.occupancy.slice();
  const crew = new Crew(inputs);
  const at = crew.fixturesAt;
  const all: { kind: string; p: Vec3; r: number }[] = [
    ...at.cradles.map((p) => ({ kind: 'cradle', p, r: FIXTURE_R.cradle })),
    ...at.pads.map((p) => ({ kind: 'pad', p, r: FIXTURE_R.pad })),
    ...at.sockets.map((p) => ({ kind: 'socket', p, r: FIXTURE_R.socket })),
  ];

  it('are placed for every flier and every Dray post', () => {
    expect(at.cradles.length).toBeGreaterThan(0);
    expect(at.pads.length).toBeGreaterThan(0);
    expect(at.sockets.length).toBeGreaterThanOrEqual(crew.drays.length);
  });

  it('stand on open paving, off the roads, clear of the field and of one another', () => {
    const bad: string[] = [];
    const { origin, cell, n } = FIELD_OCC;
    for (const f of all) {
      const [x, , z] = f.p;
      if (onRoad(x, z)) bad.push(`${f.kind} on a road at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      // Every occupied cell within its footprint (and 0.25 m round it).
      const R = f.r + 0.25;
      let hit = 0;
      for (let j = Math.floor((z - R - origin) / cell); j <= Math.floor((z + R - origin) / cell); j++) {
        for (let i = Math.floor((x - R - origin) / cell); i <= Math.floor((x + R - origin) / cell); i++) {
          const cx = origin + (i + 0.5) * cell;
          const cz = origin + (j + 0.5) * cell;
          if (Math.hypot(cx - x, cz - z) <= R - cell * 0.71 && occ[j * n + i]) hit++;
        }
      }
      if (hit) bad.push(`${f.kind} at ${x.toFixed(1)}, ${z.toFixed(1)} over ${hit} occupied cells`);
    }
    for (let a = 0; a < all.length; a++) {
      for (let b = a + 1; b < all.length; b++) {
        const d = Math.hypot(all[a].p[0] - all[b].p[0], all[a].p[2] - all[b].p[2]);
        if (d < all[a].r + all[b].r + 0.3) bad.push(`${all[a].kind} and ${all[b].kind} ${d.toFixed(2)} m apart`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('are clean solids: closed, outward, no coplanar overlap or clash', () => {
    const rb = new RigBuilder('fixtures');
    rb.segment('cradle', null, [0, 0, 0]);
    rb.segment('pad', null, [0, 0, 0]);
    rb.segment('socket', null, [0, 0, 0]);
    // One of each, as placed.
    const add = (seg: string, parts: PartDef[]) => parts.forEach((p) => rb.add(seg, p.name.split(':')[1], p.mesh));
    add('cradle', cradleParts(at.cradles[0], 0));
    add('pad', padParts(at.pads[0], 0));
    add('socket', socketParts(at.sockets[0], 0));
    expect(topology(rb.def)).toEqual([]);
    const r = audit(rb.def, undefined, []);
    expect(r.zfight).toHaveLength(0);
    expect(r.defects).toHaveLength(0);
  }, 120_000);
});
