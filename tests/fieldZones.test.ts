import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { buildFieldZones } from '../src/field/field';
import { FIELD_SLOTS } from '../src/field/materials/materials';
import { PolyMesh } from '../src/geometry/polyMesh';
import type { Part } from '../src/field/kit/parts';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';
import { FIELD_ALLOW, HALO_ALLOW } from './helpers/fieldAllow';
import { CORRIDOR, FIELD_Y, GLASS_CLEARANCE, glassHeightAt, inEstate } from '../src/field/layout';

/** Movers posed into the world at time t (the audit sees them where they stand). */
export function posedParts(zone: ReturnType<typeof buildFieldZones>[number], t: number): Part[] {
  const out: Part[] = [...zone.parts];
  const m = new Matrix4();
  const v = new Vector3();
  for (const mv of zone.movers) {
    mv.pose(t, m);
    for (const p of mv.parts) {
      const q = new PolyMesh(p.mesh.crease).append(p.mesh);
      q.verts = q.verts.map((x) => {
        v.set(x[0], x[1], x[2]).applyMatrix4(m);
        return [v.x, v.y, v.z];
      });
      out.push({ name: p.name, mesh: q });
    }
  }
  return out;
}

const zones = buildFieldZones();

describe.each(zones.filter((z) => z.name !== 'halo').map((z) => [z.name, z] as const))('field zone %s', (_name, zone) => {
  const parts = posedParts(zone, 0);

  it('every part is a closed outward solid (sets: one per component)', () => {
    const single = topologyFailures(parts.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.filter((p) => p.name.includes(':set:')), { maxComponents: 10_000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 600_000 }, () => {
    for (const t of [0, 1800]) {
      const report = assemblyAuditTiled(posedParts(zone, t), FIELD_SLOTS, FIELD_ALLOW[zone.name] ?? []);
      expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
      expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
      expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
    }
  });
});

describe('the field under the Dome', () => {
  it('stays 30 m under the glass, under the corridor ceiling, and off the estate', () => {
    const bad: string[] = [];
    for (const z of zones) {
      for (const t of [0, 2400]) {
        for (const p of posedParts(z, t)) {
          for (const v of p.mesh.verts) {
            const h = v[1] - FIELD_Y;
            const r = Math.hypot(v[0], v[2]);
            if (h > glassHeightAt(r) - GLASS_CLEARANCE + 1e-6) bad.push(`${p.name}: ${h.toFixed(1)} m at r ${r.toFixed(0)}`);
            if (v[0] > CORRIDOR.x0 && v[0] < CORRIDOR.x1 && Math.abs(v[2]) < CORRIDOR.half && h > CORRIDOR.ceiling) bad.push(`${p.name}: in the corridor at ${h.toFixed(1)} m`);
            if (inEstate(v[0], v[2])) bad.push(`${p.name}: on the estate`);
            if (bad.length > 8) break;
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('the field as one assembly', () => {
  it('no zone overlaps or clashes another (branches seat into the ring main)', { timeout: 1_800_000 }, () => {
    const all = zones.flatMap((z) => posedParts(z, 0));
    const allow: [string, string][] = [...Object.values(FIELD_ALLOW).flat(), ...HALO_ALLOW, ['net:', 'halo:line:']];
    const report = assemblyAuditTiled(all, FIELD_SLOTS, allow, 200);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
