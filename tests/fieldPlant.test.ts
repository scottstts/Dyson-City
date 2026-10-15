import { describe, expect, it } from 'vitest';
import { buildPlant, PLANT_ZONES, plantAllow } from '../src/field/plant/plant';
import { plantBlocked, plantCoverage, plantLots } from '../src/field/plant/lots';
import { FIELD_SLOTS } from '../src/field/materials/materials';
import { FIELD_Y, GLASS_CLEARANCE, glassHeightAt, inEstate } from '../src/field/layout';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';

describe('the secondary plant: lots', () => {
  const lots = plantLots();

  it('fills the precincts that have room (a working plant, not an empty lot)', () => {
    const cov = plantCoverage();
    // Every precinct with free ground is built on; the plant as a whole is dense.
    const built = Object.values(cov).filter((c) => c > 0);
    expect(built.length).toBeGreaterThanOrEqual(13);
    expect(lots.length).toBeGreaterThan(80);
  });

  it('keeps clear of keep-outs and of each other', () => {
    const bad: string[] = [];
    for (const l of lots) {
      const hx = (l.axis === 0 ? l.L : l.W) / 2;
      const hz = (l.axis === 0 ? l.W : l.L) / 2;
      for (const [px, pz] of [[l.x - hx, l.z - hz], [l.x + hx, l.z - hz], [l.x - hx, l.z + hz], [l.x + hx, l.z + hz], [l.x, l.z]]) if (plantBlocked(px, pz, 0)) bad.push(`${l.name} on a keep-out`);
      for (const m of lots) {
        if (m === l) continue;
        const mx = (m.axis === 0 ? m.L : m.W) / 2;
        const mz = (m.axis === 0 ? m.W : m.L) / 2;
        if (Math.abs(l.x - m.x) < hx + mx + 5 && Math.abs(l.z - m.z) < hz + mz + 5) bad.push(`${l.name} crowds ${m.name}`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe.each(PLANT_ZONES.map((z) => [z] as const))('the secondary plant: %s', (zone) => {
  const parts = buildPlant(zone).list;

  it('every part is a closed outward solid', () => {
    const single = topologyFailures(parts.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.filter((p) => p.name.includes(':set:')), { maxComponents: 10_000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 600_000 }, () => {
    const report = assemblyAuditTiled(parts, FIELD_SLOTS, plantAllow(zone));
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });

  it('stays under the glass and off the estate', () => {
    const bad: string[] = [];
    for (const p of parts) for (const v of p.mesh.verts) {
      if (v[1] - FIELD_Y > glassHeightAt(Math.hypot(v[0], v[2])) - GLASS_CLEARANCE) bad.push(`${p.name} too high`);
      if (inEstate(v[0], v[2])) bad.push(`${p.name} on the estate`);
      if (bad.length > 4) break;
    }
    expect(bad.slice(0, 4)).toEqual([]);
  });
});
