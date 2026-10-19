/**
 * The craft's visits (vehicles/craft/flight.ts) through the East Lock's airlock
 * (city/eastLock/airlock.ts): the airlock never stands open both ways and opens a gate only onto
 * equal pressure; the craft never meets a gate that is not fully open, nor any of the field's or
 * the lock's structure; it hovers clear of the pad (higher over the car); a visit under the Dome
 * lasts about 30 s.
 */
import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { CraftAirlock } from '../src/city/eastLock/airlock';
import { CraftFlight, CRAFT_NOSE, CRAFT_TAIL, CRAFT_UNDER, FLIGHT, LEGS, SETTLE, type FlightPhase } from '../src/vehicles/craft/flight';
import { buildCraftModel, CRAFT_SCALE } from '../src/vehicles/craft/model';
import { buildFieldZones } from '../src/field/field';
import { buildLockStructure } from '../src/city/eastLock/structure';
import { LOCK, mirrorMesh, toWorld } from '../src/city/eastLock/spec';
import { buildLockLeaf } from '../src/city/eastLock/leaf';
import { lockLeafPose } from '../src/city/eastLock/lock';
import { PAD_HEIGHT } from '../src/ground/site';
import type { PolyMesh } from '../src/geometry/polyMesh';

const DT = 1 / 30;
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const nobody = () => -Infinity;

interface Sample {
  t: number;
  phase: FlightPhase;
  pos: Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  outer: number;
  inner: number;
  outerClosed: boolean;
  innerClosed: boolean;
  pressure: number;
  burn: number;
}

function fly(seconds: number, under: (x: number, z: number, r: number) => number = nobody): Sample[] {
  const lock = new CraftAirlock();
  const flight = new CraftFlight(0);
  const control = { request: (s: 'outer' | 'inner' | 'closed') => lock.request(s), isOpen: (s: 'outer' | 'inner') => lock.isOpen(s) };
  const out: Sample[] = [];
  for (let t = 0; t < seconds; t += DT) {
    flight.update(DT, control, under);
    lock.update(DT);
    out.push({
      t,
      phase: flight.phase,
      pos: flight.position.clone(),
      yaw: flight.yaw,
      pitch: flight.pitch,
      roll: flight.roll,
      outer: lock.outer.openness,
      inner: lock.inner.openness,
      outerClosed: lock.outer.phase === 'closed',
      innerClosed: lock.inner.phase === 'closed',
      pressure: lock.pressure,
      burn: flight.burn,
    });
  }
  return out;
}

/** The craft's extent along the axis (world x) at a sample. */
function extent(s: Sample): [number, number] {
  const nx = -Math.sin(s.yaw);
  const a = s.pos.x + nx * CRAFT_NOSE;
  const b = s.pos.x - nx * CRAFT_TAIL;
  return [Math.min(a, b), Math.max(a, b)];
}

describe('the craft’s visits', () => {
  const run = fly(260);
  const visible = run.filter((s) => s.phase !== 'gap');

  it('completes visits, one after another', () => {
    const departs = run.filter((s, i) => i > 0 && s.phase === 'gap' && run[i - 1].phase === 'depart').length;
    expect(departs).toBeGreaterThanOrEqual(2);
  });

  it('never opens the lock both ways, and opens a gate only onto equal pressure', () => {
    for (const s of run) {
      expect(s.outerClosed || s.innerClosed, `t ${s.t.toFixed(2)}`).toBe(true);
      if (s.outer > 0.001) expect(s.pressure).toBe(0);
      if (s.inner > 0.001) expect(s.pressure).toBe(1);
    }
  });

  it('never meets a gate that is not fully open', () => {
    // The leaves' sweeps (world x) round each lip.
    const outerLip = -LOCK.outerLipX;
    const innerLip = -LOCK.innerLipX;
    for (const s of visible) {
      const [x0, x1] = extent(s);
      if (s.outer < 0.999) expect(x1 < outerLip - 4 || x0 > outerLip + 4 || (x0 > innerLip && x1 < outerLip), `outer t ${s.t.toFixed(2)} ${s.phase}`).toBe(true);
      if (s.inner < 0.999) expect(x0 > innerLip + 4 || x1 < innerLip - 4 || (x0 > innerLip && x1 < outerLip), `inner t ${s.t.toFixed(2)} ${s.phase}`).toBe(true);
    }
  });

  it('hovers with its ventral foil clear of the pad, and higher over the car', () => {
    const hover = run.filter((s) => s.phase === 'hover');
    expect(hover.length).toBeGreaterThan(0);
    // Never under the hover height; at it once the settle is done and until the lift starts.
    const t0 = hover[0].t;
    for (const s of hover) {
      const clear = s.pos.y - CRAFT_UNDER - PAD_HEIGHT;
      expect(clear).toBeGreaterThan(FLIGHT.hoverClear - 0.15);
      const t = s.t - t0;
      if (t > SETTLE.time - SETTLE.lead + 0.3 && t < LEGS.hover - SETTLE.liftLead) expect(clear).toBeLessThan(FLIGHT.hoverClear + 0.15);
    }
    const carTop = PAD_HEIGHT + 1.79;
    const over = fly(120, (x, z, r) => (Math.hypot(x - 4, z - 2) < r + 2 ? carTop : -Infinity)).filter((s) => s.phase === 'hover');
    for (const s of over.slice(Math.round(2 / DT))) expect(s.pos.y - CRAFT_UNDER).toBeGreaterThan(carTop + FLIGHT.hoverClearOver - 0.3);
  });

  it('moves smoothly: no jump in place or attitude from leg to leg', () => {
    // Second differences over the visit inside the Dome (and the legs either side): a pose jump of
    // a few centimetres in one frame shows as hundreds of m/s².
    const near = run.filter((s) => s.phase === 'wait-in' || s.phase === 'inbound' || s.phase === 'hover' || s.phase === 'outbound' || s.phase === 'wait-out');
    let worstA = 0;
    let worstPad = 0;
    let worstW = 0;
    let where = '';
    for (let i = 1; i + 1 < near.length; i++) {
      const [a, b, c] = [near[i - 1], near[i], near[i + 1]];
      if (c.t - a.t > 2.5 * DT) continue;
      const acc = Math.hypot(a.pos.x - 2 * b.pos.x + c.pos.x, a.pos.y - 2 * b.pos.y + c.pos.y, a.pos.z - 2 * b.pos.z + c.pos.z) / (DT * DT);
      const ang = Math.max(Math.abs(a.pitch - 2 * b.pitch + c.pitch), Math.abs(a.roll - 2 * b.roll + c.roll), Math.abs(wrap(c.yaw - b.yaw) - wrap(b.yaw - a.yaw))) / (DT * DT);
      if (acc > worstA) {
        worstA = acc;
        where = `${b.phase} t ${b.t.toFixed(2)}`;
      }
      if (a.phase === 'hover' && c.phase === 'hover') worstPad = Math.max(worstPad, acc);
      worstW = Math.max(worstW, ang);
    }
    // Along the corridor the path's own braking and its spline's curvature steps reach ~2–3 g; a
    // pose jump of a few centimetres in one frame shows as hundreds of m/s². In the hover the craft
    // settles, drifts and lifts gently.
    expect(worstA, where).toBeLessThan(60);
    expect(worstPad).toBeLessThan(4);
    expect(worstW).toBeLessThan(1.5);
  });

  it('keeps the whole hull clear of the pad while it settles, pivots and lifts', () => {
    const pos = buildCraftModel(0.1).geometry.getAttribute('position');
    const pts: Vector3[] = [];
    for (let i = 0; i < pos.count; i += 3) pts.push(new Vector3().fromBufferAttribute(pos, i));
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s4 = new Vector3(CRAFT_SCALE, CRAFT_SCALE, CRAFT_SCALE);
    let lowest = Infinity;
    for (const s of run) {
      if (s.phase !== 'hover' && !(s.phase === 'inbound' && s.pos.x < 40) && !(s.phase === 'outbound' && s.pos.x < 40)) continue;
      m.compose(s.pos, q.setFromEuler(e.set(s.pitch, s.yaw, s.roll, 'YXZ')), s4);
      for (const c of pts) lowest = Math.min(lowest, p.copy(c).applyMatrix4(m).y - PAD_HEIGHT);
    }
    expect(lowest).toBeGreaterThan(1.0);
  });

  it('spends about 30 s under the Dome, and burns hard leaving', () => {
    const inside = run.filter((s) => s.phase === 'inbound' || s.phase === 'hover' || s.phase === 'outbound');
    const visits = inside.length * DT / 2;
    expect(visits).toBeGreaterThan(28);
    expect(visits).toBeLessThan(34);
    const depart = run.filter((s) => s.phase === 'depart');
    expect(Math.max(...depart.map((s) => s.burn))).toBeGreaterThan(0.8);
    const hover = run.filter((s) => s.phase === 'hover');
    expect(Math.max(...hover.map((s) => s.burn))).toBeLessThan(0.2);
  });

  it('clears the field’s and the lock’s structure all the way', () => {
    // Occupancy of everything the craft flies past, 1 m cells, from each polygon sampled at 0.4 m.
    const X0 = -70, X1 = 640, Y0 = 0, Y1 = 75, Z0 = -50, Z1 = 50;
    const nx = X1 - X0, ny = Y1 - Y0, nz = Z1 - Z0;
    const occ = new Uint8Array(nx * ny * nz);
    const mark = (x: number, y: number, z: number) => {
      const i = Math.floor(x - X0), j = Math.floor(y - Y0), k = Math.floor(z - Z0);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
      occ[(k * ny + j) * nx + i] = 1;
    };
    const raster = (m: PolyMesh, f: (p: [number, number, number]) => [number, number, number] = (p) => p) => {
      const v = m.verts.map(f);
      for (const face of m.faces) {
        for (let t = 1; t + 1 < face.length; t++) {
          const a = v[face[0]], b = v[face[t]], c = v[face[t + 1]];
          const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])];
          const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
          if (hi[0] < X0 || lo[0] > X1 || hi[1] < Y0 || lo[1] > Y1 || hi[2] < Z0 || lo[2] > Z1) continue;
          const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
          const n = Math.max(1, Math.ceil(len / 0.4));
          for (let i = 0; i <= n; i++)
            for (let j = 0; j <= n - i; j++) {
              const u = i / n, w = j / n;
              mark(a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * w, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * w, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * w);
            }
        }
      }
    };
    for (const z of buildFieldZones()) for (const p of z.parts) raster(p.mesh);
    for (const p of buildLockStructure()) raster(p.mesh, toWorld);
    // The craft as points (its lightest tessellation), posed along the flight.
    const pos = buildCraftModel(0.1).geometry.getAttribute('position');
    const pts: Vector3[] = [];
    for (let i = 0; i < pos.count; i += 3) pts.push(new Vector3().fromBufferAttribute(pos, i));
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s4 = new Vector3(CRAFT_SCALE, CRAFT_SCALE, CRAFT_SCALE);
    const hits: string[] = [];
    for (const s of visible) {
      if (s.pos.x > X1 - 20) continue;
      m.compose(s.pos, q.setFromEuler(e.set(s.pitch, s.yaw, s.roll, 'YXZ')), s4);
      for (const c of pts) {
        p.copy(c).applyMatrix4(m);
        const i = Math.floor(p.x - X0), j = Math.floor(p.y - Y0), k = Math.floor(p.z - Z0);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        if (occ[(k * ny + j) * nx + i]) {
          hits.push(`${s.phase} t ${s.t.toFixed(1)} at ${p.toArray().map((x) => x.toFixed(1))}`);
          break;
        }
      }
      if (hits.length > 5) break;
    }
    expect(hits).toEqual([]);
  }, 300_000);

  it('clears the lock’s leaves as they move', () => {
    // Each leaf rasterised at openness steps of 0.05 over the lock (1 m cells), and the craft checked
    // against both leaves at the step nearest their openness at every sample.
    const X0 = 450, X1 = 600, Y0 = 0, Y1 = 75, Z0 = -32, Z1 = 32;
    const nx = X1 - X0, ny = Y1 - Y0, nz = Z1 - Z0;
    const leaf = buildLockLeaf().map((p) => mirrorMesh(p.mesh));
    const steps = 21;
    const grids = [LOCK.outerTrunnionX, LOCK.innerTrunnionX].map((xt) =>
      Array.from({ length: steps }, (_, k) => {
        const occ = new Uint8Array(nx * ny * nz);
        const pose = lockLeafPose(xt, k / (steps - 1));
        for (const m of leaf) {
          const v = m.verts.map(pose);
          for (const f of m.faces)
            for (let t = 1; t + 1 < f.length; t++) {
              const a = v[f[0]], b = v[f[t]], c = v[f[t + 1]];
              const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
              const n = Math.max(1, Math.ceil(len / 0.4));
              for (let i = 0; i <= n; i++)
                for (let j = 0; j <= n - i; j++) {
                  const u = i / n, w = j / n;
                  const x = a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * w, y = a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * w, z = a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * w;
                  const ii = Math.floor(x - X0), jj = Math.floor(y - Y0), kk = Math.floor(z - Z0);
                  if (ii >= 0 && jj >= 0 && kk >= 0 && ii < nx && jj < ny && kk < nz) occ[(kk * ny + jj) * nx + ii] = 1;
                }
            }
        }
        return occ;
      }),
    );
    const pos = buildCraftModel(0.1).geometry.getAttribute('position');
    const pts: Vector3[] = [];
    for (let i = 0; i < pos.count; i += 3) pts.push(new Vector3().fromBufferAttribute(pos, i));
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s4 = new Vector3(CRAFT_SCALE, CRAFT_SCALE, CRAFT_SCALE);
    const hits: string[] = [];
    for (const s of visible) {
      if (s.pos.x < X0 - 30 || s.pos.x > X1 + 30) continue;
      const g = [grids[0][Math.round(s.outer * (steps - 1))], grids[1][Math.round(s.inner * (steps - 1))]];
      m.compose(s.pos, q.setFromEuler(e.set(s.pitch, s.yaw, s.roll, 'YXZ')), s4);
      for (const c of pts) {
        p.copy(c).applyMatrix4(m);
        const i = Math.floor(p.x - X0), j = Math.floor(p.y - Y0), k = Math.floor(p.z - Z0);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const cell = (k * ny + j) * nx + i;
        if (g[0][cell] || g[1][cell]) {
          hits.push(`${s.phase} t ${s.t.toFixed(1)} outer ${s.outer.toFixed(2)} inner ${s.inner.toFixed(2)} at ${p.toArray().map((x) => x.toFixed(1))}`);
          break;
        }
      }
      if (hits.length > 5) break;
    }
    expect(hits).toEqual([]);
  }, 300_000);
});
