import { describe, expect, it } from 'vitest';
import { buildCordon, CORDON_ALLOW, CORDON_SECTION } from '../src/field/cordon';
import { FIELD_SLOTS } from '../src/field/materials/materials';
import { CORDON, CORDON_PLAN, CORRIDOR, FIELD_Y, ROAD, inEstate } from '../src/field/layout';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';

const parts = buildCordon().list;

describe('the cordon', () => {
  it('every part is a closed outward solid', () => {
    const single = topologyFailures(parts.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.filter((p) => p.name.includes(':set:')), { maxComponents: 10_000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond its seats', { timeout: 600_000 }, () => {
    const report = assemblyAuditTiled(parts, FIELD_SLOTS, CORDON_ALLOW);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });

  it('leaves the craft corridor, the Axis Road and the gates open on the ground', () => {
    const bad: string[] = [];
    for (const p of parts) {
      if (p.name.startsWith('cordon:bridge:') || p.name.startsWith('cordon:arch:') || p.name.startsWith('cordon:pipe:') || p.name.includes('saddles')) {
        // Raised over the gates: clear headroom under them.
        for (const v of p.mesh.verts) if (v[1] - FIELD_Y < (p.name.includes('arch') ? 15.9 : CORDON_SECTION.slab.under - 0.01)) bad.push(`${p.name} low at ${(v[1] - FIELD_Y).toFixed(2)}`);
        continue;
      }
      for (const v of p.mesh.verts) {
        if (v[0] > CORRIDOR.x0 && Math.abs(v[2]) < CORRIDOR.half) bad.push(`${p.name} in the corridor`);
        if (Math.abs(v[0] - CORDON.frontX) < 12 && Math.abs(v[2]) < ROAD.half + 1) bad.push(`${p.name} on the Axis Road`);
        if (inEstate(v[0], v[2])) bad.push(`${p.name} on the estate`);
      }
      if (bad.length > 8) break;
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('bridges every avenue and Meridian gate, and runs end in pylons', () => {
    expect(CORDON_PLAN.runs.filter((r) => r.bridge)).toHaveLength(8);
    for (const r of CORDON_PLAN.runs) {
      expect(CORDON_PLAN.pylons[r.from]).toBeDefined();
      expect(CORDON_PLAN.pylons[r.to]).toBeDefined();
    }
  });
});
