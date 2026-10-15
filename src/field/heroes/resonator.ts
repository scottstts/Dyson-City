/**
 * The Resonator (city_plan.md §5.2): it listens to the star. A cryogenic resonant ring, 100 m
 * across, that the star's pressure oscillations, carried through the sphere's structure, set
 * ringing. A flawless polished gold torus hanging free inside a tall ceramic portal, suspended on
 * long cables from isolation stages so it touches nothing. Utterly still. It faces the house, which
 * it reflects; it is the best mirror in the field.
 *
 * Construction (frame: T along the ring's plane, N its face normal toward the house, y up):
 *  - plinth: two stepped tiers, a black glazed slab under the ring's nadir;
 *  - pylons: tapered dressed towers with a cast channel down each face and black course bands,
 *    a glazed black bearing pad on each, the box beam across them;
 *  - isolation stages on the beam: turned housings with foil domes; from each, a pair of cables
 *    drops through bronze sleeves in the beam's soffit to a clamp collar on the torus's flank;
 *  - the torus: one seamless mirror; cryostat pods clamped to its lower rim, sensor rings round it.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, girderProfile, sweep } from '../../geometry/sweep';
import { basisAlong, box, extrudeBevel, lathe, orientOutward, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import { Parts } from '../kit/parts';
import { guardRail } from '../kit/access';
import { FIELD_Y, HOUSE_SITE, RESONATOR } from '../layout';

/** The ring's frame: T (in its plane, horizontal) and N (its face normal, toward the house). */
export function resonatorFrame(): { T: Vec3; N: Vec3; o: Vec3 } {
  const dx = HOUSE_SITE[0] - RESONATOR.x;
  const dz = HOUSE_SITE[1] - RESONATOR.z;
  const l = Math.hypot(dx, dz);
  const N: Vec3 = [dx / l, 0, dz / l];
  const T: Vec3 = [-N[2], 0, N[0]];
  return { T, N, o: [RESONATOR.x, FIELD_Y, RESONATOR.z] };
}

export const TORUS = { R: RESONATOR.ringR, r: 3.5 } as const;
export const PYLON = { baseHalf: 8, topHalf: 5, beamBottom: 121, beamHalfWidth: 4.2 } as const;
export const SUSPENSION = { s: 30, cablePairHalf: 1.2, cableR: 0.11 } as const;

export function buildResonator(): Parts {
  const parts = new Parts('resonator');
  const { T, N, o } = resonatorFrame();
  const Y: Vec3 = [0, 1, 0];
  const P = (s: number, y: number, q = 0): Vec3 => v3.add(o, v3.add(v3.add(v3.scale(T, s), v3.scale(Y, y)), v3.scale(N, q)));
  const B = (s: number, y: number, q = 0): Basis => ({ o: P(s, y, q), u: T, v: N, w: Y });
  const ringC = RESONATOR.centreY;
  const off = RESONATOR.pylonOff;

  // --- Plinth ------------------------------------------------------------------------------------
  const L = off + PYLON.baseHalf + RESONATOR.plinthEnd;
  const W = RESONATOR.plinthHalf;
  const rect = (hs: number, hq: number): Vec2[] => [[-hs, -hq], [hs, -hq], [hs, hq], [-hs, hq]];
  parts.add('plinth:0', extrudeBevel(rect(L, W), B(0, 0), -0.02, 0.6, 0.06, FIELD_SLOT.ceramic));
  parts.add('plinth:1', extrudeBevel(rect(L - 1.2, W - 3), B(0, 0), 0.58, 1.1, 0.05, FIELD_SLOT.ceramic));
  parts.add('nadir', extrudeBevel(rect(16, 8).map(([a, b]) => [a, b] as Vec2), B(0, 0), 1.08, 1.16, 0.03, FIELD_SLOT.black));

  // --- Pylons: a section with a cast channel down each face, tapering, swept up ------------------
  const pylonOutline = (h: number): Vec2[] => {
    const c = h * h * (3 - 2 * h);
    const a = PYLON.baseHalf + (PYLON.topHalf - PYLON.baseHalf) * (0.15 * h + 0.85 * c);
    const ch = 0.35;
    const g = a * 0.28;
    const d = 0.55;
    const out: Vec2[] = [];
    // Counter-clockwise: each side runs corner chamfer → channel → corner chamfer.
    const side = (k: number) => {
      const rot = (x: number, y: number): Vec2 => {
        const ang = (k * Math.PI) / 2;
        return [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)];
      };
      out.push(rot(a, -a + ch), rot(a, -g), rot(a - d, -g + d * 0.5), rot(a - d, g - d * 0.5), rot(a, g), rot(a, a - ch));
    };
    for (let k = 0; k < 4; k++) side(k);
    return out;
  };
  const pylonTop = PYLON.beamBottom - 0.2;
  for (const s of [-1, 1]) {
    const heights: number[] = [];
    for (let h = 1.08; h < pylonTop; h += 4) heights.push(h);
    heights.push(pylonTop);
    const pts = heights.map((h) => P(s * off, h));
    const frames = framesFrom(pts, pts.map(() => N));
    const prof = (_f: unknown, i: number) => {
      const loop = pylonOutline((heights[i] - 1.08) / (pylonTop - 1.08));
      return { pts: loop, slots: loop.map(() => FIELD_SLOT.ceramic) };
    };
    parts.add(`pylon:${s}`, orientOutward(sweep(frames, prof, { crease: 28, capSlot: FIELD_SLOT.ceramic })));
    // Black course bands at irregular heights (a band round the pylon, seated 30 mm).
    for (const [k, h] of [17.5, 46, 71.5, 103].entries()) {
      const t = (h - 1.08) / (pylonTop - 1.08);
      const c = t * t * (3 - 2 * t);
      const a = PYLON.baseHalf + (PYLON.topHalf - PYLON.baseHalf) * (0.15 * t + 0.85 * c) + 0.06;
      parts.add(`band:${s}:${k}`, box(B(s * off, h), a, a, 0.35, 0.05, FIELD_SLOT.black));
    }
    // Base course: a dressed block the pylon stands in.
    parts.add(`base:${s}`, box(B(s * off, 1.08 + 1.1), PYLON.baseHalf + 0.25, PYLON.baseHalf + 0.25, 1.12, 0.12, FIELD_SLOT.ceramic));
    // Bearing pad under the beam.
    parts.add(`pad:${s}`, box(B(s * off, PYLON.beamBottom - 0.12), PYLON.topHalf + 0.4, PYLON.topHalf + 0.4, 0.14, 0.04, FIELD_SLOT.black));
    // A bronze door at the pylon's foot, set into the channel on its outer face.
    parts.add(`door:${s}`, box({ o: P(s * (off + PYLON.baseHalf - 0.58), 5.6, 0), u: N, v: Y, w: T }, 1.5, 2.2, 0.08, 0.02, FIELD_SLOT.bronze));
  }

  // --- The beam ----------------------------------------------------------------------------------
  {
    const s0 = -(off + PYLON.topHalf + 2.5);
    const s1 = off + PYLON.topHalf + 2.5;
    const prof = girderProfile({ halfWidth: PYLON.beamHalfWidth, t0: PYLON.beamBottom, t1: RESONATOR.top, chamferBottom: 0.4, chamferTop: 0.3, grooves: [[PYLON.beamBottom + 2.2, PYLON.beamBottom + 6.4, 0.4]] });
    const frames = framesFrom([P(s0, 0), P(s1, 0)], [Y, Y]);
    parts.add('beam', orientOutward(sweep(frames, prof, { crease: 30, capSlot: FIELD_SLOT.ceramic })));
    // Guard rails along the beam's top edges.
    for (const q of [-1, 1]) parts.addSet(`rail:${q}`, guardRail([P(s0 + 0.6, RESONATOR.top, q * (PYLON.beamHalfWidth - 0.45)), P(s1 - 0.6, RESONATOR.top, q * (PYLON.beamHalfWidth - 0.45))]));
  }

  // --- Isolation stages and the suspension ----------------------------------------------------------
  const ringPoint = (theta: number, radial = 0, q = 0): Vec3 => P(Math.cos(theta) * (TORUS.R + radial), ringC + Math.sin(theta) * (TORUS.R + radial), q);
  for (const s of [-1, 1]) {
    const sx = s * SUSPENSION.s;
    // Housing on the beam: a turned drum with a foil dome (the cryogenic isolation stage).
    parts.add(`stage:${s}`, lathe([[0, -0.05], [3.4, -0.05], [3.4, 0.4], [3.1, 0.6], [3.1, 3.6], [3.35, 3.8], [3.35, 4.2], [0, 4.2]], 64, basisAlong(P(sx, RESONATOR.top), Y), FIELD_SLOT.ceramic));
    const dome: Vec2[] = [[0, 0]];
    for (let k = 0; k <= 12; k++) {
      const a = (Math.PI / 2) * (k / 12);
      dome.push([Math.cos(a) * 3.0, 0.02 + Math.sin(a) * 2.2]);
    }
    dome[dome.length - 1] = [0, 2.22];
    parts.add(`dome:${s}`, lathe(dome, 64, basisAlong(P(sx, RESONATOR.top + 4.15), Y), FIELD_SLOT.foil));
    // The ring's attachment: where the vertical through sx meets the tube's top, and its collar.
    const yHit = (q: number) => Math.sqrt((TORUS.R + Math.sqrt(TORUS.r ** 2 - q * q)) ** 2 - sx * sx);
    const theta = Math.atan2(yHit(0), sx);
    const centre = ringPoint(theta);
    const tangent = v3.norm(v3.sub(ringPoint(theta + 1e-3), ringPoint(theta - 1e-3)));
    parts.add(`collar:${s}`, lathe([[TORUS.r - 0.02, -0.45], [TORUS.r + 0.16, -0.45], [TORUS.r + 0.22, -0.35], [TORUS.r + 0.22, 0.35], [TORUS.r + 0.16, 0.45], [TORUS.r - 0.02, 0.45]], 64, basisAlong(centre, tangent), FIELD_SLOT.bronze));
    for (const q of [-1, 1]) {
      const qq = q * SUSPENSION.cablePairHalf;
      const topY = PYLON.beamBottom + 0.3;
      // Down into the collar (seated 120 mm).
      const bottom = P(sx, ringC + yHit(qq) + 0.12, qq);
      parts.add(`cable:${s}:${q}`, tube([{ p: bottom, r: SUSPENSION.cableR }, { p: P(sx, topY, qq), r: SUSPENSION.cableR }], 10, FIELD_SLOT.steel));
      // Bronze sleeve where the cable leaves the soffit.
      parts.add(`sleeve:${s}:${q}`, lathe([[0, -0.6], [0.32, -0.6], [0.32, -0.15], [0.42, -0.08], [0.42, 0.25], [0, 0.25]], 24, basisAlong(P(sx, PYLON.beamBottom, qq), Y), FIELD_SLOT.bronze));
    }
  }

  // --- The torus: one seamless mirror ---------------------------------------------------------------
  {
    const n = 360;
    const rings = Array.from({ length: n }, (_, k) => ({ p: ringPoint((2 * Math.PI * k) / n), r: TORUS.r }));
    parts.add('torus', tube(rings, 64, FIELD_SLOT.mirror, { closed: true, seed: N, crease: 60 }));
  }
  // Sensor rings round the tube at irregular angles.
  for (const [k, deg] of [12, 37, 101, 148, 167, 203, 252, 296, 331].entries()) {
    const th = (deg * Math.PI) / 180;
    const c = ringPoint(th);
    const t = v3.norm(v3.sub(ringPoint(th + 1e-3), ringPoint(th - 1e-3)));
    const w = 0.12 + (k % 3) * 0.06;
    parts.add(`sensor:${k}`, lathe([[TORUS.r - 0.01, -w], [TORUS.r + 0.05, -w], [TORUS.r + 0.07, -w + 0.02], [TORUS.r + 0.07, w - 0.02], [TORUS.r + 0.05, w], [TORUS.r - 0.01, w]], 64, basisAlong(c, t), k % 2 ? FIELD_SLOT.black : FIELD_SLOT.bronze));
  }
  // Cryostat pods on the lower rim: a foil capsule on two clamp saddles each.
  for (const [k, deg] of [-24, -90, -151].entries()) {
    const th = (deg * Math.PI) / 180;
    const podR = 2.1;
    const len = 9;
    const c = ringPoint(th, TORUS.r + podR + 0.6);
    const t = v3.norm(v3.sub(ringPoint(th + 1e-3), ringPoint(th - 1e-3)));
    const cap: Vec2[] = [[0, -len / 2]];
    for (let j = 1; j <= 8; j++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (j / 8);
      cap.push([Math.cos(a) * podR, -len / 2 + podR + Math.sin(a) * podR]);
    }
    for (let j = 0; j <= 8; j++) {
      const a = (Math.PI / 2) * (j / 8);
      cap.push([Math.cos(a) * podR, len / 2 - podR + Math.sin(a) * podR]);
    }
    cap[cap.length - 1] = [0, len / 2];
    parts.add(`pod:${k}`, lathe(cap, 48, basisAlong(c, t), FIELD_SLOT.foil, 40));
    for (const e of [-1, 1]) {
      const sc = v3.add(ringPoint(th, TORUS.r + 0.3), v3.scale(t, e * 2.4));
      const radial = v3.norm(v3.sub(ringPoint(th, 1), ringPoint(th)));
      parts.add(`saddle:${k}:${e}`, box({ o: v3.add(sc, v3.scale(radial, -0.25)), u: radial, v: N, w: t }, 1.5, 1.1, 0.22, 0.05, FIELD_SLOT.steel));
    }
  }
  return parts;
}
