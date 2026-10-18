/**
 * The vehicles as built (docs/vehicles.md): the ported models are clean (no coplanar overlap, no
 * degenerate or normal-less triangles, every part consistently wound), the wheels clear the body
 * at full lock and the suspension's extremes, and the car stands on the pad.
 */
import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry } from 'three';
import { auditGeometry } from '../tools/geometry-kit/geometry-audit.js';
import { armMatrix, bodyMatrix, buildCarModel, CAR, hubAt } from '../src/vehicles/car/model';
import { buildCraftModel, CRAFT_BOUNDS } from '../src/vehicles/craft/model';
import { CAR_PHYSICS } from '../src/vehicles/car/dynamics';
import type { PartSink } from '../src/vehicles/kit/loft';

function assembly(sink: PartSink): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial();
  sink.parts.forEach((p, i) => {
    const m = new Mesh(p.geometry as never, mat);
    m.name = `${p.name}#${i}`;
    g.add(m);
  });
  g.updateMatrixWorld(true);
  return g;
}

/** Directed edges used twice in the same direction: a part wound inconsistently (a face turned inside out). */
function misWound(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const ix = g.index!;
  const key = (i: number) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const seen = new Set<string>();
  let bad = 0;
  for (let t = 0; t < ix.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const e = `${key(ix.getX(t + k))}|${key(ix.getX(t + ((k + 1) % 3)))}`;
      if (seen.has(e)) bad++;
      seen.add(e);
    }
  }
  return bad;
}

describe('the car (refs/car.html)', () => {
  const car = buildCarModel();

  it('is clean: no coplanar overlap, no degenerate triangles, consistent winding', () => {
    for (const sink of [car.bodyParts, car.rotorParts, car.hubParts]) {
      const r = auditGeometry(assembly(sink), { clash: false, maxTriangles: 2_000_000 });
      expect(r.zfight, JSON.stringify(r.zfight.slice(0, 4))).toHaveLength(0);
      expect(r.defects, JSON.stringify(r.defects.slice(0, 4))).toHaveLength(0);
      const wound = sink.parts.filter((p) => misWound(p.geometry) > 0).map((p) => p.name);
      expect(wound).toEqual([]);
    }
  }, 120_000);

  it('stands on its wheels at the ref’s stretched proportions', () => {
    car.body.computeBoundingBox();
    const b = car.body.boundingBox!;
    // The ref's envelope: ~6.65 m long, ~3.4 m body width (4.3 m over the wheels), 1.79 m high.
    expect(b.max.z - b.min.z).toBeCloseTo(6.65, 1);
    expect(b.max.y).toBeCloseTo(1.79, 1);
    // Wheels on the ground, the hubs on their axle datums.
    expect(CAR.hubY - CAR.wheelRadius).toBeCloseTo(0, 6);
    expect(CAR.wheelbase).toBeCloseTo(4.323, 3);
    // Nothing of the body below the wheels' contact (it does not drag).
    expect(b.min.y).toBeGreaterThan(0.1);
  });

  it('clears its wheels drawn in and deployed, at full lock and the suspension’s extremes', () => {
    // The wheel's solids, in the ref's units (x along the axle, r from it): the rotor's annulus and
    // the hub (motor, faces, blades). The ties reach through the rotor's aperture onto the hub.
    const ROTOR = { x: 0.285, r: 0.64, out: 0.81 };
    const HUB = { x: 0.21, r: 0.655 };
    const ties = (name: string) => /aero fairing|lamp surround|running lamp/.test(name);
    const margin = 0.01;
    const P = CAR_PHYSICS;
    const v = new Vector3();
    const hub = new Vector3();
    let worst = Infinity;
    let where = '';
    const check = (pos: { count: number; getX(i: number): number }, m: Matrix4, tie: boolean, label: string) => {
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as never, i).applyMatrix4(m);
        const x = Math.abs(v.x) / 1.2;
        const r = Math.hypot(v.y, v.z) / 0.86;
        const rotor = Math.max(x - ROTOR.x, ROTOR.r - r, r - ROTOR.out) - margin;
        const hubGap = Math.max(x - HUB.x, r - HUB.r) - margin;
        const gap = tie ? rotor : Math.min(rotor, hubGap);
        if (gap < worst) {
          worst = gap;
          where = label;
        }
      }
    };
    for (const deploy of [0, 1])
      for (const steer of deploy ? [0, P.steerLock / 2, P.steerLock, -P.steerLock / 2, -P.steerLock] : [0])
        for (const rear of deploy ? [0, P.rearLock, -P.rearLock] : [0])
          // Drawn in, the suspension rests on its stops (car.ts): the body does not sway.
          for (const pitch of deploy ? [-0.03, 0.03] : [0])
            for (const roll of deploy ? [-0.045, 0.045] : [0]) {
              const body = bodyMatrix(pitch, roll, 0);
              const arms = car.arms.map((a) => armMatrix(a, body, hubAt(a.hub, deploy)));
              car.hubs.forEach((h, wi) => {
                hubAt(h, deploy, hub);
                const toWheel = new Matrix4().makeRotationY(-(wi < 2 ? steer : rear)).multiply(new Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z));
                const label = (name: string) => `${name} wheel ${wi} deploy ${deploy} steer ${steer.toFixed(2)} rear ${rear.toFixed(2)} pitch ${pitch} roll ${roll}`;
                const m = toWheel.clone().multiply(body);
                for (const p of car.bodyParts.parts) check(p.geometry.getAttribute('position'), m, ties(p.name), label(p.name));
                // Every arm: its own wheel's rotor only (it ends on that hub); the others' whole wheels.
                car.arms.forEach((a, ai) => {
                  const ma = toWheel.clone().multiply(arms[ai]);
                  for (const p of a.parts.parts) check(p.geometry.getAttribute('position'), ma, true, label(p.name));
                  if (ai !== wi) for (const p of a.parts.parts) check(p.geometry.getAttribute('position'), ma, false, label(p.name));
                });
              });
            }
    expect(worst, where).toBeGreaterThan(0);
  }, 300_000);

  it('keeps each arm on its hub as the body rides its springs and the wheels deploy', () => {
    const v = new Vector3();
    for (const deploy of [0, 0.5, 1])
      for (const pitch of [-0.03, 0.03])
        for (const roll of [-0.045, 0.045])
          for (const heave of [-0.01, 0.01]) {
            const body = bodyMatrix(pitch, roll, heave);
            for (const a of car.arms) {
              const target = hubAt(a.hub, deploy);
              // The arm's end (its built hub point) lands on the hub.
              v.copy(a.hub).applyMatrix4(armMatrix(a, body, target));
              expect(v.distanceTo(target)).toBeLessThan(1e-4);
            }
          }
  });

  it('has a lighter level of detail', () => {
    const lite = buildCarModel(0.3);
    expect(lite.triangles).toBeLessThan(car.triangles * 0.3);
    expect(lite.triangles).toBeGreaterThan(car.triangles * 0.1);
  });
});

describe('the craft (refs/spacecraft.html)', () => {
  const craft = buildCraftModel();

  it('is clean: no coplanar overlap, no degenerate triangles, consistent winding', () => {
    const r = auditGeometry(assembly(craft.parts), { clash: false, maxTriangles: 2_000_000 });
    expect(r.zfight, JSON.stringify(r.zfight.slice(0, 4))).toHaveLength(0);
    expect(r.defects, JSON.stringify(r.defects.slice(0, 4))).toHaveLength(0);
    const wound = craft.parts.parts.filter((p) => misWound(p.geometry) > 0).map((p) => p.name);
    expect([...new Set(wound)]).toEqual([]);
  }, 120_000);

  it('keeps the ref’s envelope', () => {
    craft.geometry.computeBoundingBox();
    const b = craft.geometry.boundingBox!;
    expect(b.min.y).toBeCloseTo(CRAFT_BOUNDS.bottom, 2);
    expect(b.max.y).toBeCloseTo(CRAFT_BOUNDS.top, 2);
    expect(b.max.x).toBeCloseTo(CRAFT_BOUNDS.halfSpan, 2);
    expect(b.min.z).toBeCloseTo(CRAFT_BOUNDS.nose, 2);
    expect(b.max.z).toBeCloseTo(CRAFT_BOUNDS.tail, 2);
  }, 60_000);

  it('has lighter levels of detail', () => {
    const mid = buildCraftModel(0.3);
    const far = buildCraftModel(0.1);
    expect(mid.triangles).toBeLessThan(craft.triangles * 0.2);
    expect(far.triangles).toBeLessThan(mid.triangles * 0.7);
  }, 60_000);
});
