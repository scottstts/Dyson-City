import { describe, expect, it } from 'vitest';
import { buildHalo, portalAngles, archSoffit, RING_MAIN, lineCentreY } from '../src/field/halo';
import { FIELD_SLOTS } from '../src/field/materials/materials';
import { HALO_CROSSINGS, ROAD, CORRIDOR } from '../src/field/layout';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';
import { HALO_ALLOW } from './helpers/fieldAllow';

describe('the Halo', () => {
  const { parts } = buildHalo();

  it('every part is a closed outward solid (sets: one per component)', () => {
    const single = topologyFailures(parts.list.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.list.filter((p) => p.name.includes(':set:')), { maxComponents: 10_000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('piers stand clear of every road crossing and keep the road clear height', () => {
    for (const a of portalAngles()) {
      for (const c of HALO_CROSSINGS) {
        const d = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) * 110;
        expect(d).toBeGreaterThan(ROAD.half + 4);
      }
    }
    // The road (10 m either side of the arch's axis) has at least 8 m under the arch.
    for (let x = -ROAD.half; x <= ROAD.half; x += 0.5) expect(archSoffit(x), `x ${x}`).toBeGreaterThan(8);
  });

  it('stays under the craft corridor ceiling', () => {
    for (const l of RING_MAIN) {
      const top = lineCentreY(l) + (l.kind === 'pipe' ? l.R * 1.12 + 0.05 : l.hh);
      expect(top, l.name).toBeLessThanOrEqual(CORRIDOR.ceiling);
    }
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 300_000 }, () => {
    const report = assemblyAuditTiled(parts.list, FIELD_SLOTS, HALO_ALLOW);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
