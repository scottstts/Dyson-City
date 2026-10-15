import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { PolyMesh, v3 } from '../src/geometry/polyMesh';
import { buildLockStructure } from '../src/city/eastLock/structure';
import { buildLockLeaf } from '../src/city/eastLock/leaf';
import { aim, lockHoistBarrel, lockHoistEnds, lockHoistRod, lockLeafPose, LOCK_HOIST } from '../src/city/eastLock/lock';
import { LOCK, mirrorMesh } from '../src/city/eastLock/spec';
import { assemblyAudit, describeTopology, topologyFailures, type NamedPart } from './geometryGate';

const GATES = [
  { name: 'outer', xt: LOCK.outerTrunnionX },
  { name: 'inner', xt: LOCK.innerTrunnionX },
];

function transformed(m: PolyMesh, f: (p: [number, number, number]) => [number, number, number]): PolyMesh {
  const out = new PolyMesh(m.crease).append(m);
  out.verts = out.verts.map(f);
  return out;
}

function scene(s: number): NamedPart[] {
  const parts: NamedPart[] = [...buildLockStructure()];
  const leaf = buildLockLeaf().map((p) => ({ name: p.name, mesh: mirrorMesh(p.mesh) }));
  const barrel = lockHoistBarrel();
  const rod = lockHoistRod();
  const m = new Matrix4();
  const v = new Vector3();
  const apply = (mesh: PolyMesh, mat: Matrix4) => transformed(mesh, (p) => {
    v.set(p[0], p[1], p[2]).applyMatrix4(mat);
    return [v.x, v.y, v.z];
  });
  for (const g of GATES) {
    const pose = lockLeafPose(g.xt, s);
    for (const p of leaf) parts.push({ name: `${p.name}@${g.name}`, mesh: transformed(p.mesh, pose) });
    for (const side of [-1, 1] as const) {
      const { A, B } = lockHoistEnds(g.xt, side, s);
      parts.push({ name: `hoist-barrel${side}@${g.name}`, mesh: apply(barrel, aim(m, A, B).clone()) });
      parts.push({ name: `hoist-rod${side}@${g.name}`, mesh: apply(rod, aim(m, B, A).clone()) });
    }
  }
  return parts;
}

const ALLOW: [string, string][] = [
  ['leaf:rib', 'leaf:skin'],
  ['leaf:girder', 'leaf:skin'],
  ['leaf:strut', 'leaf:hub'],
  ['leaf:strut', 'leaf:girder'],
  // Struts converge into the cast hub.
  ['leaf:strut', 'leaf:strut'],
  ['leaf:brace', 'leaf:strut'],
  ['leaf:lug', 'leaf:strut'],
  ['hoist-rod', 'hoist-barrel'],
  // At full stroke the rod's tip is inside the barrel, within the bracket's clevis.
  ['hoist-rod', 'lock:bracket'],
  ['hoist-rod', 'leaf:lug'],
  ['hoist-barrel', 'lock:bracket'],
  ['lock:bracket', 'lock:hood'],
  ['lock:bracket', 'lock:vault'],
  ['lock:hood', 'lock:head-west'],
  ['lock:hood', 'lock:pier'],
  ['lock:housing', 'lock:pier'],
  ['lock:track', 'lock:pier'],
  ['lock:track', 'lock:floor'],
  ['lock:track', 'lock:sill'],
  ['lock:sill', 'lock:floor'],
  ['leaf:hub', 'lock:housing'],
  ['leaf:seal', 'leaf:skin'],
  ['leaf:seal', 'leaf:seal'],
  ['leaf:seal', 'lock:track'],
  ['leaf:seal-lip', 'lock:sill'],
  ['lock:topseal', 'lock:head'],
  ['lock:topseal', 'lock:vault'],
  ['lock:topseal', 'lock:track'],
  ['lock:topseal', 'leaf:skin'],
  ['lock:topseal', 'leaf:seal'],
];

describe('east lock geometry', () => {
  it('every part is one closed solid', () => {
    const parts = [...buildLockStructure(), ...buildLockLeaf(), { name: 'barrel', mesh: lockHoistBarrel() }, { name: 'rod', mesh: lockHoistRod() }];
    const failures = topologyFailures(parts);
    expect(failures, describeTopology(failures)).toEqual([]);
  });

  it('the hoists telescope within their travel over the whole stroke', () => {
    for (const g of GATES) {
      for (let i = 0; i <= 32; i++) {
        const { A, B } = lockHoistEnds(g.xt, 1, i / 32);
        const L = v3.dist(A, B);
        expect(L).toBeGreaterThan(LOCK_HOIST.barrelLength + 0.4);
        expect(L).toBeLessThan(LOCK_HOIST.barrelLength + LOCK_HOIST.rodLength - 0.8);
      }
    }
  });

  for (const [label, s] of [['closed', 0], ['part open', 0.4], ['open', 1]] as const) {
    it(`assembles without z-fighting or clashes (${label})`, { timeout: 600_000 }, () => {
      const report = assemblyAudit(scene(s), 7, ALLOW);
      expect(report.defects, JSON.stringify(report.defects.slice(0, 4))).toEqual([]);
      expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
      expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
    });
  }
});

describe('east lock in the dome', () => {
  it('meets the frame and sill cleanly (the Spinward rails land on its roof)', { timeout: 600_000 }, async () => {
    const { buildFrameParts, frameLayout } = await import('../src/city/dome/frame');
    const { domeClashAllow } = await import('./helpers/domeAllow');
    const { buildSill } = await import('../src/city/dome/glazing');
    const layout = frameLayout();
    const near = (m: NamedPart) => m.mesh.verts.some((v) => v[0] > 420 && Math.abs(v[2]) < 100);
    const parts = [...buildFrameParts(layout).filter(near), ...buildSill().map((mesh, i) => ({ name: `sill${i}`, mesh })), ...buildLockStructure()];
    const report = assemblyAudit(parts, 7, [...ALLOW, ...domeClashAllow(layout), ['member:rail:spinward', 'lock:vault'], ['member:rail:spinward', 'lock:head']]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});
