import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh } from 'three';
import { buildFieldZones } from '../src/field/field';
import { emitParts } from '../src/geometry/polyMesh';
import { FIELD_SLOTS } from '../src/field/materials/materials';
import { CollisionWorld } from '../src/player/collision';
import { addFieldWalls, fieldSurface } from '../src/field/walk';
import { portalAngles, ARCH } from '../src/field/halo';
import { GYRE, STILLS } from '../src/field/layout';

describe('walking the field', () => {
  const meshes: Mesh[] = [];
  for (const z of buildFieldZones()) {
    meshes.push(new Mesh(emitParts(z.parts.map((p) => p.mesh), { slots: FIELD_SLOTS })));
    for (const mv of z.movers) {
      const m = new Mesh(emitParts(mv.parts.map((p) => p.mesh), { slots: FIELD_SLOTS }));
      m.matrixAutoUpdate = false;
      mv.pose(0, m.matrix as Matrix4);
      meshes.push(m);
    }
  }
  const walls = new CollisionWorld();
  const n = addFieldWalls(walls, meshes as never);
  const go = (x: number, z: number, dx: number, dz: number, steps = 200) => {
    let p: [number, number] = [x, z];
    for (let i = 0; i < steps; i++) p = walls.move(p[0], p[1], dx / steps, dz / steps, 0.3);
    return p;
  };

  it('builds a wall outline', () => {
    expect(n).toBeGreaterThan(1000);
  });

  it('the ring road runs clear under the arches, but not through their feet', () => {
    const a = portalAngles()[3];
    const c = (r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    // Along the road's centreline, through the arch's station.
    const t: [number, number] = [-Math.sin(a), Math.cos(a)];
    const [x0, z0] = c(ARCH.rc);
    const end = go(x0 - t[0] * 20, z0 - t[1] * 20, t[0] * 40, t[1] * 40);
    expect(Math.hypot(end[0] - (x0 + t[0] * 20), end[1] - (z0 + t[1] * 20))).toBeLessThan(0.05);
    // Radially out through the inner foot: stopped before it.
    const [fx, fz] = c(ARCH.rc - ARCH.half - 6);
    const r = Math.hypot(...go(fx, fz, Math.cos(a) * 8, Math.sin(a) * 8));
    expect(r).toBeLessThan(ARCH.rc - ARCH.half - 1.0);
  });

  it('plinths and podiums are solid', () => {
    expect(go(GYRE.x, GYRE.z - 120, 0, 100)[1]).toBeLessThan(GYRE.z - GYRE.plinth.hz + 0.2);
    expect(Math.hypot(...((p) => [p[0] - STILLS.x, p[1] - STILLS.z] as [number, number])(go(STILLS.x, STILLS.z + 100, 0, -60)))).toBeGreaterThan(STILLS.podiumR - 0.5);
  });

  it('roads are basalt underfoot', () => {
    expect(fieldSurface(() => 'stone' as const, 0, 110)).toBe('basalt');
    expect(fieldSurface(() => 'stone' as const, 60, 60)).toBe('stone');
  });
});
