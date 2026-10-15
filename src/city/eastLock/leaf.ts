/**
 * An East Lock leaf (both are identical), in its trunnion frame (origin on the trunnion axis, z
 * along it, θ from +x counter-clockwise up), as the West Gate's leaf (city/gate/leaf.ts) at craft
 * size: a 52 m skin of radius 34 m, three girders behind it spanning between the arm frames, T-rib
 * stiffeners in runs between the girders, three radial struts and two braces per side, cast bronze
 * hubs, the hoists' lugs, and rubber seals at the lip and both edges.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { chamferRect, framesFrom, girderProfile, loopProfile, revolve, sampleCurve, straightSweep, sweep } from '../../geometry/sweep';
import { LEAF_SLOT } from '../gate/leaf';
import type { LockPart } from './structure';
import { LOCK } from './spec';

const L = LOCK;
const SKIN_IN = L.R - L.skin;
const GIRDER_IN = SKIN_IN - L.girderDepth;

const polar = (r: number, th: number, z: number): Vec3 => [r * Math.cos(th), r * Math.sin(th), z];
const radial = (th: number): Vec3 => [Math.cos(th), Math.sin(th), 0];
const arc = (r: number, th0: number, th1: number, z: number, ds = 0.8): Vec3[] => sampleCurve((t) => polar(r, t, z), th0, th1, ds, 6).p;

export function buildLockLeaf(): LockPart[] {
  const parts: LockPart[] = [];
  const th0 = L.thetaBottom;
  const th1 = L.thetaTop;
  {
    const pts = arc(L.R - L.skin / 2, th0, th1, 0, 0.6);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const prof = girderProfile({ halfWidth: L.leafHalf, t0: -L.skin / 2, t1: L.skin / 2, chamferBottom: 0.02, chamferTop: 0.03 });
    parts.push({ name: 'leaf:skin', mesh: sweep(frames, { pts: prof.pts }, { crease: 30, capSlot: LEAF_SLOT.steel }) });
  }
  const flangeHalf = 0.55;
  L.girders.forEach((g, gi) => {
    const r0 = GIRDER_IN;
    const r1 = SKIN_IN + 0.008;
    const h = r1 - r0;
    const rc = (r0 + r1) / 2;
    const ft = 0.1;
    const web = 0.045;
    const ipts: Vec2[] = [
      [-flangeHalf, -h / 2], [flangeHalf, -h / 2], [flangeHalf, -h / 2 + ft], [web, -h / 2 + ft], [web, h / 2 - ft], [flangeHalf, h / 2 - ft],
      [flangeHalf, h / 2], [-flangeHalf, h / 2], [-flangeHalf, h / 2 - ft], [-web, h / 2 - ft], [-web, -h / 2 + ft], [-flangeHalf, -h / 2 + ft],
    ];
    const c = v3.scale(radial(g), rc);
    const zEnd = L.armZ + L.armHalf + 0.02;
    parts.push({ name: `leaf:girder${gi}`, mesh: straightSweep([c[0], c[1], -zEnd], [c[0], c[1], zEnd], radial(g), loopProfile(ipts), { crease: 30 }) });
  });
  // T-ribs on the skin's back in runs between the girders (20 mm reveals).
  const gap = (flangeHalf + 0.02) / SKIN_IN;
  const bounds = [th0 + 0.05 / L.R, ...L.girders.flatMap((g) => [g - gap, g + gap]), th1 - 0.05 / L.R];
  const runs: [number, number][] = [];
  for (let i = 0; i < bounds.length; i += 2) runs.push([bounds[i], bounds[i + 1]]);
  const depth = 0.8;
  const tpts: Vec2[] = [[0.03, 0.008], [-0.03, 0.008], [-0.03, -depth + 0.06], [-0.18, -depth + 0.06], [-0.18, -depth], [0.18, -depth], [0.18, -depth + 0.06], [0.03, -depth + 0.06]];
  for (let k = 0; k < 15; k++) {
    const z = -L.leafHalf + 1.7 + ((2 * L.leafHalf - 3.4) * (k + 0.5)) / 15;
    if (Math.abs(Math.abs(z) - L.armZ) < 1.2) continue;
    runs.forEach(([a, b], ri) => {
      const pts = arc(SKIN_IN, a, b, z, 0.6);
      const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
      parts.push({ name: `leaf:rib${k}:${ri}`, mesh: sweep(frames, loopProfile(tpts), { crease: 30 }) });
    });
  }
  // Arm frames: a strut from the hub to each girder, and braces between the struts.
  const strut = loopProfile(chamferRect(0.42, L.armHalf, 0.08));
  for (const side of [-1, 1]) {
    const z = side * L.armZ;
    L.girders.forEach((g, si) => {
      const a = v3.add(v3.scale(radial(g), L.hubR - 0.1), [0, 0, z]);
      const b = v3.add(v3.scale(radial(g), GIRDER_IN + 0.01), [0, 0, z]);
      parts.push({ name: `leaf:strut${side}:${si}`, mesh: straightSweep(a, b, [0, 0, 1], strut, { crease: 30 }) });
    });
    for (let k = 0; k + 1 < L.girders.length; k++) {
      const pa = v3.add(v3.scale(radial(L.girders[k]), GIRDER_IN - 3.2), [0, 0, z]);
      const pb = v3.add(v3.scale(radial(L.girders[k + 1]), 15), [0, 0, z]);
      const dir = v3.norm(v3.sub(pb, pa));
      parts.push({ name: `leaf:brace${side}:${k}`, mesh: straightSweep(v3.add(pa, v3.scale(dir, -0.25 + L.armHalf)), v3.add(pb, v3.scale(dir, 0.25 - L.armHalf)), [0, 0, 1], loopProfile(chamferRect(0.3, 0.3, 0.05)), { crease: 30 }) });
    }
  }
  for (const side of [-1, 1]) {
    const zOut = side * (L.armZ + L.armHalf + 0.1);
    const zIn = side * (L.armZ - L.armHalf - 0.1);
    const w = (zOut - zIn) * side;
    const prof: Vec2[] = [[0, -0.7], [0.9, -0.7], [1.0, -0.6], [1.0, -0.45], [1.5, -0.45], [1.6, -0.35], [1.6, 0], [L.hubR - 0.1, 0], [L.hubR, 0.1], [L.hubR, w - 0.1], [L.hubR - 0.1, w], [0, w]];
    const frame = (x: number, y: number, h: number): Vec3 => (side > 0 ? [x, y, zIn + h] : [y, x, zIn - h]);
    parts.push({ name: `leaf:hub${side}`, mesh: revolve(prof, 64, frame, LEAF_SLOT.bronze) });
  }
  const gTop = L.girders[L.girders.length - 1];
  for (const side of [-1, 1]) {
    const c = v3.scale(radial(gTop), L.hoistB);
    parts.push({ name: `leaf:lug${side}`, mesh: straightSweep([c[0], c[1], side * (L.armZ - L.armHalf + 0.04)], [c[0], c[1], side * (L.hoistZ - 0.55)], radial(gTop), loopProfile(chamferRect(0.45, 0.65, 0.1)), { crease: 30 }) });
  }
  {
    const pts = arc(SKIN_IN + 0.06, th0 - 0.0005, th0 + 0.0025, 0, 0.004);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    parts.push({ name: 'leaf:seal-lip', mesh: sweep(frames, loopProfile(chamferRect(L.passageHalf - 0.006, 0.05, 0.006), LEAF_SLOT.rubber), { crease: 30, capSlot: LEAF_SLOT.rubber }) });
  }
  for (const side of [-1, 1]) {
    const pts = arc(SKIN_IN + 0.06, th0 + 0.003, th1 + 0.001, 0, 0.6);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const z0 = L.leafHalf - 0.03;
    const z1 = L.passageHalf - 0.006;
    const loop: Vec2[] = side > 0 ? [[z0, -0.05], [z1, -0.05], [z1, 0.05], [z0, 0.05]] : [[-z1, -0.05], [-z0, -0.05], [-z0, 0.05], [-z1, 0.05]];
    parts.push({ name: `leaf:seal-side${side}`, mesh: sweep(frames, loopProfile(loop, LEAF_SLOT.rubber), { crease: 30, capSlot: LEAF_SLOT.rubber }) });
  }
  return parts;
}

/** The hoist lug's pin (pivot B) in the trunnion frame, closed. */
export function lockLugPin(side: -1 | 1): Vec3 {
  const g = L.girders[L.girders.length - 1];
  return [L.hoistB * Math.cos(g), L.hoistB * Math.sin(g), side * L.hoistZ];
}
