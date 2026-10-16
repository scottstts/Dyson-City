import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { estateGeometry, estateWalk } from '../src/estate/build';
import { DRIVE, DRIVE_HALF, GATEWAY, GROUND_ORDER, houseFootprint, terraceInterior, TERRACE_Y, WALKS } from '../src/estate/layout';
import { ESTATE_SLOTS } from '../src/estate/materials/materials';
import { emitParts } from '../src/geometry/polyMesh';
import { ESTATE } from '../src/field/layout';
import { PAD_HEIGHT } from '../src/ground/site';
import { assemblyAudit, describeTopology, topologyFailures, type NamedPart } from './geometryGate';
import { TestWalker } from './helpers/walker';
import { ESTATE_ALLOW } from './helpers/estateAllow';
import { ESTATE_PROBE } from '../src/estate/probe';
import { estateSurface } from '../src/estate/surface';
import { classGrid } from '../src/estate/regions';
import { grassRange, ringDensity, ringHalf, LAWN_GRASS, MEADOW_GRASS } from '../src/estate/grass';

describe('the estate', () => {
  const geo = estateGeometry();
  const walk = estateWalk(geo);

  it('lays out every ground class, inside the terrace', () => {
    for (const c of GROUND_ORDER) if (c !== 'void') expect(geo.regions[c].length, c).toBeGreaterThan(0);
    for (const c of GROUND_ORDER) {
      for (const r of geo.regions[c]) for (const [x, z] of r.outer) expect(terraceInterior.sdf(x, z), `${c} at ${x},${z}`).toBeLessThan(0.15);
    }
  });

  it('captures its reflection probe in open air, clear of the house and of everything standing near', () => {
    const [x, y, z] = ESTATE_PROBE.centre;
    expect(houseFootprint.sdf(x, z)).toBeGreaterThan(8);
    let top = -Infinity;
    for (const list of Object.values(geo.parts))
      for (const p of list)
        for (const v of p.mesh.verts) if (Math.hypot(v[0] - x, v[2] - z) < 3) top = Math.max(top, v[1]);
    expect(y - top).toBeGreaterThan(1.5);
  });

  it('says what is underfoot: grass on the lawns, gravel on the drive, nothing below the terrace', () => {
    const at = estateSurface(classGrid());
    const d = DRIVE[Math.floor(DRIVE.length / 2)];
    expect(at(d[0], d[1], TERRACE_Y)).toBe('gravel');
    expect(at(ESTATE_PROBE.centre[0] + 18, ESTATE_PROBE.centre[2] + 14, TERRACE_Y)).toBe('grass');
    expect(at(ESTATE_PROBE.centre[0] + 18, ESTATE_PROBE.centre[2] + 14, TERRACE_Y - 1.6)).toBeNull();
  });

  it('keeps the drive and the walks off the house', () => {
    for (const [x, z] of DRIVE) expect(houseFootprint.sdf(x, z), `drive at ${x},${z}`).toBeGreaterThan(DRIVE_HALF + 5);
    for (const w of WALKS) {
      if (w.name === 'service' || w.name === 'westporch') continue;
      for (const [x, z] of w.pts) expect(houseFootprint.sdf(x, z), `${w.name} at ${x},${z}`).toBeGreaterThan(w.half + 1.5);
    }
  });

  it('every part is a closed outward solid (sets: one per component)', () => {
    const all: NamedPart[] = Object.values(geo.parts).flat();
    const single = topologyFailures(all.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(all.filter((p) => p.name.includes(':set:')), { maxComponents: 2000 });
    const inst = topologyFailures(Object.entries(geo.instances).map(([name, i]) => ({ name, mesh: i.mesh })), { maxComponents: 10 });
    expect([...single, ...sets, ...inst], describeTopology([...single, ...sets, ...inst])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 300_000 }, () => {
    // The parts with the instanced repeats placed where they stand (a pier or baluster is named by its index).
    const extra: Mesh[] = [];
    const mat = new MeshBasicMaterial();
    for (const [name, inst] of Object.entries(geo.instances)) {
      const g = emitParts([inst.mesh], { slots: ESTATE_SLOTS });
      inst.matrices.forEach((m: Matrix4, i: number) => {
        const mesh = new Mesh(g, Array(ESTATE_SLOTS).fill(mat));
        mesh.name = `estate:${name}:${i}`;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(m);
        extra.push(mesh);
      });
    }
    const parts: NamedPart[] = Object.values(geo.parts).flat();
    // Tile the audit along the wall: parts and instances near each station.
    const report = assemblyAudit(parts, ESTATE_SLOTS, ESTATE_ALLOW, extra);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });

  it('walks up the ramp from the Gate Court to the terrace', () => {
    const x = (GATEWAY.ramp.x0 + GATEWAY.ramp.x1) / 2;
    const w = new TestWalker([walk]).place(x, ESTATE.south + 12);
    expect(w.y).toBeCloseTo(PAD_HEIGHT, 2);
    w.walk(0, -1, 40);
    expect(w.z).toBeLessThan(GATEWAY.ramp.z1 - 5);
    expect(w.y).toBeCloseTo(TERRACE_Y, 1);
  });

  it('climbs both flights of steps beside the ramp', () => {
    for (const x of [(GATEWAY.x0 + GATEWAY.ramp.x0 - GATEWAY.cut) / 2, (GATEWAY.x1 + GATEWAY.ramp.x1 + GATEWAY.cut) / 2]) {
      const w = new TestWalker([walk]).place(x, ESTATE.south + 6).walk(0, -1, 14);
      expect(w.y, `flight at ${x}`).toBeGreaterThan(TERRACE_Y - 0.05);
    }
  });

  it('the retaining wall stops the walker below, the balustrade above', () => {
    const below = new TestWalker([walk]).place(ESTATE.east + 10, -100).walk(-1, 0, 20);
    expect(below.x).toBeGreaterThan(ESTATE.east);
    expect(below.y).toBeCloseTo(PAD_HEIGHT, 2);
    const above = new TestWalker([walk]).place(ESTATE.east - 8, -100).walk(1, 0, 20);
    expect(above.x).toBeLessThan(ESTATE.east - 0.3);
    expect(above.y).toBeGreaterThan(TERRACE_Y - 0.05);
  });
});

describe('grass rings', () => {
  it('nest, and hand over without a change in density', () => {
    for (const spec of [LAWN_GRASS, MEADOW_GRASS]) {
      for (let k = 0; k < spec.rings; k++) {
        // Each ring's grid reaches past its crossover band, a snapped cell to spare.
        const cell = spec.cell * 2 ** k;
        expect(ringHalf(spec) * cell - cell).toBeGreaterThanOrEqual(spec.thin * 2 ** (k + 1) * 1.12);
      }
      // The rings' shares sum to the 1/d² law at every distance (a ring at a boundary would show as a line).
      for (let d = 0.5; d < grassRange(spec); d += 0.05) {
        let sum = 0;
        for (let k = 0; k < spec.rings; k++) sum += ringDensity(spec, k, d);
        const law = Math.min(1, (spec.thin / d) ** 2);
        expect(Math.abs(sum / law - 1), `${spec.kind} at ${d.toFixed(2)} m`).toBeLessThan(0.2);
      }
    }
    // Far enough that the last blades are about a pixel tall where they fade.
    expect(grassRange(LAWN_GRASS)).toBeGreaterThan(50);
    expect(grassRange(MEADOW_GRASS)).toBeGreaterThan(75);
  });
});
