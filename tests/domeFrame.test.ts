import { describe, expect, it } from 'vitest';
import { buildFrameParts, frameBolts, frameLayout } from '../src/city/dome/frame';
import { bayTable, buildSill, drumVerticals } from '../src/city/dome/glazing';
import { arcTable } from '../src/geometry/sweep';
import { v3 } from '../src/geometry/polyMesh';
import { DOME, JOINT, LAYER, MEMBER } from '../src/city/dome/spec';
import { assemblyAuditTiled, describeTopology, topologyFailures } from './geometryGate';
import { domeClashAllow } from './helpers/domeAllow';

describe('dome frame geometry', () => {
  const layout = frameLayout();
  const parts = [...buildFrameParts(layout), ...buildSill().map((mesh, i) => ({ name: `sill${i}`, mesh }))];

  it('has the designed members and junctions', () => {
    const nodes = (prefix: string) => layout.nodes.filter((n) => n.name.startsWith(prefix));
    expect(nodes('node:crown').length).toBe(4);
    expect(nodes('node:eave').length).toBe(24);
    expect(nodes('node:collar').length).toBe(16);
    // Eave nodes: the post, the ring either side and one or two ribs.
    expect(new Set(nodes('node:eave').map((n) => n.arms.length))).toEqual(new Set([4, 5]));
    // Coffer crossings and crown: four arms; band nodes: the rail either side, a rib and a tie.
    for (const n of [...nodes('node:coffer'), ...nodes('node:crown'), ...nodes('node:spinward'), ...nodes('node:meridian')]) expect(n.arms.length).toBe(4);
    expect(parts.filter((p) => p.name.startsWith('member:post')).length).toBeGreaterThanOrEqual(24);
    // 4 cardinals × (2 legs + 2 rails) + 24 posts.
    expect(drumVerticals(layout).length).toBe(40);
  });

  it('every part is one closed, outward-wound solid (stiffener sets: one per plate)', { timeout: 120_000 }, () => {
    const single = topologyFailures(parts.filter((p) => !p.name.startsWith('stiffeners:')));
    const sets = topologyFailures(parts.filter((p) => p.name.startsWith('stiffeners:')), { maxComponents: 10_000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('nodes sit between the glass and the members they join', () => {
    expect(LAYER.nodeT0).toBeGreaterThan(0);
    expect(LAYER.nodeT0).toBeLessThan(LAYER.armT0);
    expect(LAYER.armT0).toBeLessThan(LAYER.memberT0);
    for (const n of layout.nodes) expect(n.tTop).toBeGreaterThan(MEMBER.rib.t1);
  });

  it('every arm leaves its body and runs clear before its splice', () => {
    for (const n of layout.nodes) {
      n.arms.forEach((_, i) => {
        expect(n.exit[i], n.name).toBeGreaterThan(0.5);
        // Arms start inside the body but outside its underside pocket.
        expect(n.start[i], n.name).toBeLessThan(n.exit[i] - 0.3);
        expect(n.spliceS[i] - JOINT.plateHalf - n.exit[i], n.name).toBeGreaterThanOrEqual(JOINT.stub - 1e-6);
      });
    }
  });

  it('every shop length is a real length and no longer than the longest', () => {
    for (const m of layout.members) {
      const L = arcTable(m.curve, m.u0, m.u1, 512).length;
      expect(L, m.name).toBeGreaterThan(4);
      expect(L, m.name).toBeLessThan(JOINT.fieldSpan + 1);
    }
  });

  it('bolts stand on their seats, pointing out of them', () => {
    const bolts = frameBolts(layout);
    expect(bolts.length).toBeGreaterThan(20_000);
    for (const b of bolts) expect(Math.abs(v3.len(b.axis) - 1)).toBeLessThan(1e-6);
  });

  it('the drum bay table indexes every bay between verticals', () => {
    const t = bayTable(layout, 4096);
    expect(new Set(Array.from(t)).size).toBe(drumVerticals(layout).length);
    expect(DOME.module).toBe(96);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 900_000 }, () => {
    const report = assemblyAuditTiled(parts, 3, domeClashAllow(layout));
    expect(report.truncated).toBe(false);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
