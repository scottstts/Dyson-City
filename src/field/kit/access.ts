/**
 * The human-scale fittings that tell you how big a machine is: ladders with safety cages, guard
 * rails, grating platforms. All are steel and sized as built (rungs 300 mm apart, rails at 1.1 m),
 * so wherever they appear they set the scale of what they are fixed to.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { basisAlong, box, extrudeBevel, tube, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';

/** A straight rod between two points (round, `sides` sides). */
export function rod(a: Vec3, b: Vec3, r: number, slot: number = FIELD_SLOT.steel, sides = 8): PolyMesh {
  return tube([{ p: a, r }, { p: b, r }], sides, slot);
}

/** A square post (bevelled box) between two points. */
export function post(a: Vec3, b: Vec3, half: number, slot: number = FIELD_SLOT.steel): PolyMesh {
  const len = v3.dist(a, b);
  const mid = v3.lerp(a, b, 0.5);
  const basis = basisAlong(mid, v3.sub(b, a));
  return box(basis, half, half, len / 2, Math.min(half * 0.25, 0.01), slot);
}

/**
 * A vertical ladder against a face: stiles and rungs, standing off the face on brackets, with a
 * safety cage of hoops and straps above 2.4 m when it climbs higher than 4 m. `faceInset(y)` is how
 * far a tapering face stands behind the foot's line at height y (the brackets reach it). `base` is the foot at
 * the face's centreline, `out` the horizontal direction away from the face.
 */
export function ladder(base: Vec3, height: number, out: Vec3, standoff = 0.2, cage = true, faceInset: (y: number) => number = () => 0): PolyMesh {
  const m = new PolyMesh(40);
  const o = v3.norm([out[0], 0, out[2]]);
  const side: Vec3 = [-o[2], 0, o[0]];
  const hw = 0.23;
  const foot = (s: number, d: number, y: number): Vec3 => v3.add(base, v3.add(v3.add(v3.scale(side, s), v3.scale(o, d)), [0, y, 0]));
  for (const s of [-1, 1]) m.append(post(foot(s * hw, standoff, 0), foot(s * hw, standoff, height + 1.1), 0.03));
  for (let y = 0.3; y < height - 0.05; y += 0.3) m.append(rod(foot(-hw + 0.02, standoff, y), foot(hw - 0.02, standoff, y), 0.014, FIELD_SLOT.steel, 6));
  // Brackets back to the face every ~3 m.
  for (let y = 1.0; y < height; y += 3.0) {
    const d = faceInset(y);
    if (!Number.isFinite(d)) continue;
    for (const s of [-1, 1]) m.append(post(foot(s * hw, standoff - 0.02, y), foot(s * hw, -d - 0.03, y), 0.025));
  }
  if (cage && height > 4) {
    const R = 0.36;
    const centre = (y: number) => foot(0, standoff + R - 0.02, y);
    const hoops: number[] = [];
    for (let y = 2.4; y < height + 1.0; y += 1.2) hoops.push(y);
    for (const y of hoops) {
      // A half-hoop from stile to stile round the front.
      const pts: Vec3[] = [];
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI * (k / 10);
        const c = centre(y);
        pts.push(v3.add(c, v3.add(v3.scale(side, -Math.cos(a) * (R + 0.0) * 0.9), v3.scale(o, Math.sin(a) * R - 0.0))));
      }
      pts[0] = foot(-hw - 0.01, standoff, y);
      pts[pts.length - 1] = foot(hw + 0.01, standoff, y);
      m.append(tube(pts.map((p) => ({ p, r: 0.016 })), 6, FIELD_SLOT.steel));
    }
    for (const a of [0.25, 0.5, 0.75].map((t) => Math.PI * t)) {
      const at = (y: number) => v3.add(centre(y), v3.add(v3.scale(side, -Math.cos(a) * R * 0.9), v3.scale(o, Math.sin(a) * R + 0.02)));
      m.append(post(at(hoops[0] - 0.05), at(hoops[hoops.length - 1] + 0.05), 0.02));
    }
  }
  return m;
}

/**
 * Guard rail along a polyline at deck level: posts at ≤ 1.8 m, a top rail at 1.1 m, a knee rail
 * and a toe board. `closed` joins the last point to the first.
 */
export function guardRail(path: Vec3[], closed = false, height = 1.1): PolyMesh {
  const m = new PolyMesh(40);
  const pts = closed ? [...path, path[0]] : path;
  const postsAt: Vec3[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(v3.dist(a, b) / 1.8));
    for (let k = 0; k < n; k++) postsAt.push(v3.lerp(a, b, k / n));
  }
  if (!closed) postsAt.push(pts[pts.length - 1]);
  for (const p of postsAt) m.append(post(p, v3.add(p, [0, height + 0.02, 0]), 0.022));
  const rail = (y: number, r: number) => {
    const line = pts.map((p) => v3.add(p, [0, y, 0]));
    if (closed) {
      m.append(tube(line.slice(0, -1).map((p) => ({ p, r })), 8, FIELD_SLOT.steel, { closed: true }));
    } else {
      m.append(tube(line.map((p) => ({ p, r })), 8, FIELD_SLOT.steel));
    }
  };
  rail(height, 0.024);
  rail(height * 0.5, 0.018);
  // Toe board: a thin plate along each segment.
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = v3.dist(a, b);
    if (len < 0.2) continue;
    const mid = v3.add(v3.lerp(a, b, 0.5), [0, 0.075, 0]);
    const dir = v3.norm(v3.sub(b, a));
    const basis: Basis = { o: mid, u: dir, v: [0, 1, 0], w: v3.cross(dir, [0, 1, 0]) };
    m.append(box(basis, len / 2 - 0.03, 0.07, 0.004, 0.002, FIELD_SLOT.steel));
  }
  return m;
}

/**
 * A grating platform: a plate of the given outline (x, z) at height y, `depth` thick, grating on
 * top and steel edge angles round it.
 */
export function gratingDeck(outline: Vec2[], y: number, depth = 0.12): PolyMesh {
  const b: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  const flipped = outline.map(([x, z]) => [x, -z] as Vec2);
  return extrudeBevel(flipped, b, y - depth, y, 0.015, FIELD_SLOT.steel, FIELD_SLOT.grating);
}
