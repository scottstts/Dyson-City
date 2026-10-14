import { describe, expect, it } from 'vitest';
import { buildFrameParts, frameLayout } from '../src/city/dome/frame';
import { bayTable, buildSill, drumVerticals } from '../src/city/dome/glazing';
import { DOME, LAYER, MEMBER } from '../src/city/dome/spec';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';

describe('dome frame geometry', () => {
  const layout = frameLayout();
  const parts = [...buildFrameParts(layout), { name: 'sill', mesh: buildSill() }];

  it('has the designed members and junctions', () => {
    const count = (prefix: string) => parts.filter((p) => p.name.startsWith(prefix)).length;
    expect(count('node:crown')).toBe(4);
    expect(count('node:eave')).toBe(24);
    expect(count('member:post')).toBe(24);
    expect(count('member:collar')).toBe(4);
    expect(count('node:collar')).toBe(16);
    expect(count('binding:')).toBeGreaterThan(300);
    // 4 cardinals × (2 legs + 2 rails) + 24 posts.
    expect(drumVerticals(layout).length).toBe(40);
  });

  it('every part is one closed, outward-wound solid', { timeout: 120_000 }, () => {
    const failures = topologyFailures(parts);
    expect(failures, describeTopology(failures)).toEqual([]);
  });

  it('nodes sit between the glass and the members they join', () => {
    expect(LAYER.nodeT0).toBeGreaterThan(0);
    expect(LAYER.nodeT0).toBeLessThan(LAYER.memberT0);
    for (const n of layout.nodes) expect(n.tTop).toBeGreaterThan(MEMBER.rib.t1);
  });

  it('the drum bay table indexes every bay between verticals', () => {
    const t = bayTable(layout, 4096);
    expect(new Set(Array.from(t)).size).toBe(drumVerticals(layout).length);
    expect(DOME.module).toBe(96);
  });

  it('no coplanar overlap and no clash beyond declared node/plinth seats', { timeout: 600_000 }, () => {
    const report = assemblyAuditTiled(parts, 3, [
      ['node:', 'member:'],
      ['plinth:', 'member:'],
      // Binding collars are sleeves round their member.
      ['binding:', 'member:'],
    ]);
    expect(report.truncated).toBe(false);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
