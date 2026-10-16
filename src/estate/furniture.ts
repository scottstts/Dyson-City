/**
 * Garden furniture (docs/estate.md "Furniture"): weathered teak benches (one at the back walk's end
 * facing the glass, two in the pond garden facing the water), and a sundial on a turned pedestal in
 * the forecourt's island. Under a star fixed overhead the gnomon's shadow is a soft smudge at its
 * foot and never moves: the dial is the estate's one joke, and nobody laughs.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { box as boxSolid, extrudeBevel, lathe, WORLD } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { BACK_WALK, FORECOURT, POOL, TERRACE_Y } from './layout';
import { member } from './glasshouse';
import { upright } from './kit';
import { ESTATE_SLOT } from './materials/materials';
import type { V2 } from './sdf2';

const T = TERRACE_Y;
const S = ESTATE_SLOT;

/** A bench 1.8 m long at `at` (plan), facing `face` (unit plan direction), standing on ground y. */
export function benchMesh(at: V2, face: V2, y: number): PolyMesh {
  const m = new PolyMesh(35);
  const f: Vec3 = [face[0], 0, face[1]];
  const r: Vec3 = [-face[1], 0, face[0]];
  const p = (u: number, h: number, d: number): Vec3 => [at[0] + r[0] * u + f[0] * d, y + h, at[1] + r[2] * u + f[2] * d];
  const L = 0.9;
  // Legs: front and back at each end (and the back legs rise into the back's stiles).
  for (const u of [-L, L]) {
    m.append(member(p(u, 0.0, 0.24), p(u, 0.62, 0.24), 0.06, 0.06, S.oak, f));
    m.append(member(p(u, 0.0, -0.24), p(u, 0.95, -0.3), 0.06, 0.06, S.oak, f));
    // Arm and its support.
    m.append(member(p(u, 0.64, 0.3), p(u, 0.64, -0.3), 0.07, 0.04, S.oak, [0, 1, 0]));
    m.append(member(p(u, 0.12, 0.0), p(u, 0.12, -0.26), 0.05, 0.05, S.oak, [0, 1, 0]));
  }
  // Seat rails and slats.
  for (const d of [0.22, -0.22]) m.append(member(p(-L + 0.03, 0.38, d), p(L - 0.03, 0.38, d), 0.05, 0.07, S.oak, [0, 1, 0]));
  for (let k = 0; k < 5; k++) {
    const d = 0.23 - k * 0.105;
    m.append(member(p(-L + 0.03, 0.435, d), p(L - 0.03, 0.435, d), 0.08, 0.025, S.oak, [0, 1, 0]));
  }
  // Back: rails and vertical slats, leaning back.
  m.append(member(p(-L + 0.03, 0.55, -0.255), p(L - 0.03, 0.55, -0.255), 0.05, 0.05, S.oak, f));
  m.append(member(p(-L + 0.03, 0.9, -0.29), p(L - 0.03, 0.9, -0.29), 0.06, 0.07, S.oak, f));
  for (let k = 1; k < 14; k++) {
    const u = -L + (k * 2 * L) / 14;
    m.append(member(p(u, 0.56, -0.258), p(u, 0.89, -0.288), 0.04, 0.018, S.oak, f));
  }
  return m;
}

/** The sundial: a square plinth, a turned baluster pedestal, a verdigris dial and gnomon. */
export function sundialMesh(at: V2, y: number, north: V2): PolyMesh {
  const m = new PolyMesh(40);
  m.append(boxSolid({ ...WORLD, o: [at[0], y + 0.06, at[1]] }, 0.32, 0.08, 0.32, 0.012, S.limestone));
  const prof: Vec2[] = [
    [0, 0.14],
    [0.22, 0.14],
    [0.22, 0.2],
    [0.17, 0.25],
    [0.12, 0.3],
    [0.15, 0.42],
    [0.16, 0.55],
    [0.12, 0.68],
    [0.09, 0.76],
    [0.1, 0.8],
    [0.19, 0.84],
    [0.2, 0.9],
    [0, 0.9],
  ];
  m.append(lathe(prof, 28, upright([at[0], y, at[1]]), S.limestone, 40));
  // Dial plate.
  const dial: Vec2[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    dial.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17]);
  }
  m.append(extrudeBevel(dial, { o: [at[0], y + 0.9, at[1]], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] }, -0.015, 0.0, 0.003, S.copper));
  // Gnomon: a triangle on the meridian (its edge would point at the pole, were there one to see).
  const n: Vec3 = [north[0], 0, north[1]];
  const side: Vec3 = [-north[1], 0, north[0]];
  const tri: Vec2[] = [
    [-0.14, 0],
    [0.12, 0],
    [-0.12, 0.13],
  ];
  m.append(extrudeBevel(tri, { o: [at[0], y + 0.915, at[1]], u: n, v: [0, 1, 0], w: side }, -0.004, 0.004, 0.001, S.copper));
  return m;
}

export function buildFurniture(): Parts {
  const parts = new Parts('estate:furniture');
  // At the back walk's end, facing out over the balustrade to the glass.
  const [sx, sz] = BACK_WALK.start;
  const [ex, ez] = BACK_WALK.end;
  const l = Math.hypot(ex - sx, ez - sz);
  const out: V2 = [(ex - sx) / l, (ez - sz) / l];
  parts.addSet('bench:back', benchMesh([ex + out[0] * 1.6, ez + out[1] * 1.6], out, T + 0.012));
  // Pond garden: one on the north side facing the water, one at the west end.
  parts.addSet('bench:pond-n', benchMesh([POOL.x - 1.5, POOL.z - POOL.hz - 1.55 - 0.45], [0, 1], T + 0.012));
  parts.addSet('bench:pond-w', benchMesh([POOL.x - POOL.hx - 1.55 - 0.45, POOL.z], [1, 0], T + 0.012));
  // The sundial in the forecourt's island.
  parts.addSet('sundial', sundialMesh(FORECOURT.centre, T + 0.04, [0, -1]));
  return parts;
}
