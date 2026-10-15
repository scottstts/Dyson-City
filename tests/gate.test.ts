import { describe, expect, it } from 'vitest';
import { buildLeaf } from '../src/city/gate/leaf';
import { buildGatehouse } from '../src/city/gate/gatehouse';
import { boltPose, buildBolt, buildHoistBarrel, buildHoistRod, hoistPoses, HOIST, leafPose, posed } from '../src/city/gate/mechanism';
import { GATE } from '../src/city/gate/spec';
import { assemblyAudit, describeTopology, topologyFailures, type NamedPart } from './geometryGate';

const GATES = [
  { name: 'outer', xt: GATE.outerTrunnionX, lip: GATE.outerLipX },
  { name: 'inner', xt: GATE.innerTrunnionX, lip: GATE.innerLipX },
];

function scene(s: number, e: number): NamedPart[] {
  const parts: NamedPart[] = [...buildGatehouse()];
  const leaf = buildLeaf();
  const barrel = buildHoistBarrel();
  const rod = buildHoistRod();
  const bolt = buildBolt();
  for (const g of GATES) {
    for (const p of leaf) parts.push({ name: `${p.name}@${g.name}`, mesh: posed(p.mesh, leafPose(g.xt, s)) });
    for (const side of [-1, 1] as const) {
      const h = hoistPoses(g.xt, side, s);
      parts.push({ name: `hoist-barrel${side}@${g.name}`, mesh: posed(barrel, h.barrel) });
      parts.push({ name: `hoist-rod${side}@${g.name}`, mesh: posed(rod, h.rod) });
    }
    for (const z of [-4.5, 4.5]) parts.push({ name: `bolt${z}@${g.name}`, mesh: posed(bolt, boltPose(g.lip, z, e)) });
  }
  return parts;
}

// Declared contacts: parts that bear on, sink into or slide inside one another by design.
const ALLOW: [string, string][] = [
  ['leaf:rib', 'leaf:skin'],
  ['leaf:girder', 'leaf:skin'],
  ['leaf:keeper', 'leaf:skin'],
  ['leaf:strut', 'leaf:hub'],
  ['leaf:strut', 'leaf:girder'],
  ['leaf:brace', 'leaf:strut'],
  ['leaf:lug', 'leaf:strut'],
  ['hoist-rod', 'hoist-barrel'],
  ['hoist-rod', 'leaf:lug'],
  ['hoist-barrel', 'gatehouse:bracket'],
  ['bolt', 'gatehouse:sill'],
  ['bolt', 'gatehouse:bezel'],
  ['bolt', 'gatehouse:floor'],
  ['bolt', 'leaf:keeper'],
  ['gatehouse:bracket', 'gatehouse:hood'],
  ['gatehouse:hood', 'gatehouse:head-west'],
  ['gatehouse:hood', 'gatehouse:pier'],
  ['gatehouse:bracket', 'gatehouse:vault'],
  ['gatehouse:housing', 'gatehouse:pier'],
  ['gatehouse:track', 'gatehouse:pier'],
  ['gatehouse:vent', 'gatehouse:pier'],
  ['gatehouse:dial', 'gatehouse:pier'],
  ['gatehouse:stem', 'gatehouse:vault'],
  ['gatehouse:stem', 'gatehouse:luminaire'],
  ['gatehouse:bezel', 'gatehouse:sill'],
  ['gatehouse:sill', 'gatehouse:floor'],
  // Seals bear into what they seal against.
  ['leaf:seal', 'leaf:skin'],
  ['leaf:seal', 'leaf:keeper'],
  ['leaf:seal', 'leaf:seal'],
  ['leaf:seal', 'gatehouse:track'],
  ['leaf:seal-lip', 'gatehouse:sill'],
  ['gatehouse:topseal', 'gatehouse:head'],
  ['gatehouse:topseal', 'gatehouse:vault'],
  ['gatehouse:topseal', 'gatehouse:track'],
  ['gatehouse:topseal', 'leaf:skin'],
  ['gatehouse:topseal', 'leaf:seal'],
  ['gatehouse:walllamp', 'gatehouse:pier'],
];

describe('west gate geometry', () => {
  it('every gatehouse and mechanism part is one closed solid', () => {
    const failures = topologyFailures([...buildGatehouse(), ...buildLeaf(), { name: 'barrel', mesh: buildHoistBarrel() }, { name: 'rod', mesh: buildHoistRod() }, { name: 'bolt', mesh: buildBolt() }]);
    expect(failures, describeTopology(failures)).toEqual([]);
  });

  it('the hoists telescope within their travel over the whole stroke', () => {
    for (const g of GATES) {
      for (let i = 0; i <= 32; i++) {
        const L = hoistPoses(g.xt, 1, i / 32).length;
        expect(L).toBeGreaterThan(HOIST.barrelLength + 0.2);
        expect(L).toBeLessThan(HOIST.barrelLength + HOIST.rodLength - 0.4);
      }
    }
  });

  for (const [label, s, e] of [['closed and bolted', 0, 1], ['part open', 0.35, 0], ['nearly open', 0.7, 0], ['open', 1, 0]] as const) {
    it(`assembles without z-fighting or clashes (${label})`, { timeout: 300_000 }, () => {
      const report = assemblyAudit(scene(s, e), 7, ALLOW);
      expect(report.defects, JSON.stringify(report.defects.slice(0, 4))).toEqual([]);
      expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
      expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
    });
  }
});

describe('west gate in the dome', () => {
  it('the gatehouse meets the frame and sill cleanly (rails land on the piers)', { timeout: 300_000 }, async () => {
    const { buildFrameParts, frameLayout } = await import('../src/city/dome/frame');
    const { domeClashAllow } = await import('./helpers/domeAllow');
    const layout = frameLayout();
    const { buildSill } = await import('../src/city/dome/glazing');
    const near = (m: NamedPart) => m.mesh.verts.some((v) => v[0] < -420 && Math.abs(v[2]) < 80);
    const frame = buildFrameParts(layout).filter(near);
    const parts = [...frame, { name: 'sill', mesh: buildSill() }, ...buildGatehouse()];
    const report = assemblyAudit(parts, 7, [...ALLOW, ...domeClashAllow(layout), ['member:rail:spinward', 'gatehouse:pier']]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
