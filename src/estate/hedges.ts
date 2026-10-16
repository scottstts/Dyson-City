/**
 * Clipped hedges (docs/estate.md "Hedges"): yew round the pond garden (a room with two openings:
 * the entrance from the lawn and a claire-voie to the field), yew wings round the bench at the back
 * walk's end, low box behind the back borders and a box ring in the forecourt's island.
 *
 * A hedge is a swept section: battered sides (wider at the foot, as hedges are cut so their bases
 * get light), a rounded top, rounded ends. Its surface is displaced by noise at two scales (the
 * shears' bulges, the shoots' fuzz) along its normals, so the silhouette reads as clipped foliage,
 * never as a box. The mesh stays one closed solid.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { orientOutward } from '../geometry/solids';
import { Parts, rng } from '../field/kit/parts';
import { BACK_WALK, FORECOURT, H, POND_GARDEN, TERRACE_Y } from './layout';
import { densify, mitres } from './kit';
import type { V2 } from './sdf2';

export interface HedgeSpec {
  name: string;
  path: V2[];
  closed: boolean;
  /** Width at the foot and at the top; height above the ground. */
  base: number;
  top: number;
  height: number;
  /** Ground level under it. */
  y: number;
  kind: 'yew' | 'box';
}

/** The hedges of the plan. */
export function hedgeSpecs(): HedgeSpec[] {
  const out: HedgeSpec[] = [];
  const p = POND_GARDEN;
  const ground = TERRACE_Y + 0.02;
  // The pond garden: its room's outline, inset by half the hedge, cut by the entrance (south) and the claire-voie (east).
  const hx = p.hx - p.hedge / 2;
  const hz = p.hz - p.hedge / 2;
  const r = 1.5 - p.hedge / 2;
  // Openings: the entrance's walk (1.2 m half-width) passes with room to spare; the claire-voie matches it.
  const gap = 1.7;
  const ring = roundedRect(p.x, p.z, hx, hz, r);
  const cut = (pts: V2[], test: (q: V2) => boolean): V2[][] => {
    const runs: V2[][] = [];
    let cur: V2[] = [];
    for (const q of pts) {
      if (test(q)) {
        if (cur.length > 1) runs.push(cur);
        cur = [];
      } else cur.push(q);
    }
    if (cur.length > 1) runs.push(cur);
    // The ring is closed: join the last run onto the first if both reach the seam.
    if (runs.length > 1 && !test(pts[0]) && !test(pts[pts.length - 1])) {
      const last = runs.pop()!;
      runs[0] = [...last, ...runs[0]];
    }
    return runs;
  };
  const dense = densify(ring, 0.12, true);
  const openings = (q: V2) => (Math.abs(q[0] - p.x) < gap && q[1] > p.z + hz - 0.5) || (Math.abs(q[1] - p.z) < gap && q[0] > p.x + hx - 0.5);
  cut(dense, openings).forEach((run, i) => out.push({ name: `pond:${i}`, path: run, closed: false, base: p.hedge, top: p.hedge * 0.82, height: 2.2, y: ground, kind: 'yew' }));
  // The bench's wings: two arcs round the paved circle at the back walk's end, open toward the house and toward the glass.
  const [ex, ez] = BACK_WALK.end;
  const dx = BACK_WALK.end[0] - BACK_WALK.start[0];
  const dz = BACK_WALK.end[1] - BACK_WALK.start[1];
  const ang = Math.atan2(dz, dx);
  const R = BACK_WALK.exedra;
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const pts: V2[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = ang + s * (Math.PI * 0.27 + (k / 16) * Math.PI * 0.46);
      pts.push([ex + Math.cos(a) * R, ez + Math.sin(a) * R]);
    }
    out.push({ name: `exedra:${i}`, path: pts, closed: false, base: 0.9, top: 0.75, height: 2.0, y: ground, kind: 'yew' });
  }
  // Low box behind the back borders (their outer sides).
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const a = H(1.1 + s * 5.3, -20.4);
    const b = H(1.1 + s * 5.3, -39.6);
    out.push({ name: `border:${i}`, path: [a, b], closed: false, base: 0.62, top: 0.52, height: 1.05, y: ground, kind: 'box' });
  }
  // A box ring in the forecourt's island, round the sundial.
  const [cx, cz] = FORECOURT.centre;
  const ringPts: V2[] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    ringPts.push([cx + Math.cos(a) * (FORECOURT.island - 1.35), cz + Math.sin(a) * (FORECOURT.island - 1.35)]);
  }
  out.push({ name: 'island', path: ringPts, closed: true, base: 0.5, top: 0.42, height: 0.55, y: TERRACE_Y + 0.04, kind: 'box' });
  return out;
}

function roundedRect(cx: number, cz: number, hx: number, hz: number, r: number): V2[] {
  const out: V2[] = [];
  const corners: [number, number, number][] = [
    [cx + hx - r, cz + hz - r, 0],
    [cx - hx + r, cz + hz - r, Math.PI / 2],
    [cx - hx + r, cz - hz + r, Math.PI],
    [cx + hx - r, cz - hz + r, (3 * Math.PI) / 2],
  ];
  for (const [x, z, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
  }
  return out;
}

/** Smooth 3D value noise (CPU), [−1, 1]. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number, c: number) => {
    let n = (a * 374761393 + b * 668265263 + c * 2147483647 + seed * 144665) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/**
 * Section of a hedge in (b, height), anticlockwise: battered sides, rounded shoulders, a slightly
 * domed top; its foot 8 cm into the ground.
 */
function section(spec: HedgeSpec): Vec2[] {
  const b0 = spec.base / 2;
  const b1 = spec.top / 2;
  const h = spec.height;
  const r = Math.min(b1 * 0.55, 0.22);
  const side = (t: number): Vec2 => [b0 + (b1 - b0) * t, (h - r) * t];
  const right: Vec2[] = [];
  for (let i = 0; i <= 5; i++) right.push(side(i / 5));
  for (let i = 1; i <= 5; i++) {
    const a = (i / 12) * Math.PI;
    right.push([b1 - r + Math.cos(a) * r, h - r + Math.sin(a) * r]);
  }
  const left = [...right].reverse().map(([b, y]) => [-b, y] as Vec2);
  return [[-b0, -0.08], [b0, -0.08], ...right, [0, h + 0.02], ...left];
}

/** One hedge as a closed, displaced solid. */
export function hedgeMesh(spec: HedgeSpec, seed: number): PolyMesh {
  const path = densify(spec.path, 0.1, spec.closed);
  const sec = section(spec);
  const mt = mitres(path, spec.closed);
  const mesh = new PolyMesh(80);
  const rand = rng(seed);
  const s0 = rand() * 100;
  // Rounded ends: open hedges taper their last metre's width into a half dome by scaling the section.
  const arc: number[] = [0];
  for (let i = 1; i < path.length; i++) arc.push(arc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = arc[arc.length - 1];
  const endScale = (s: number) => {
    if (spec.closed) return 1;
    const d = Math.min(s, total - s);
    const r = spec.base / 2;
    return d >= r ? 1 : Math.sqrt(Math.max(1 - ((r - d) / r) ** 2, 0.02));
  };
  const rings: number[][] = [];
  path.forEach((p, i) => {
    const k = endScale(arc[i]);
    const ring: number[] = [];
    for (const [b, h] of sec) {
      const bb = b * k;
      const hh = h < 0 ? h : h * (0.55 + 0.45 * k);
      let x = p[0] + mt[i].m[0] * bb * mt[i].s;
      let z = p[1] + mt[i].m[1] * bb * mt[i].s;
      let y = spec.y + hh;
      // Displacement along the section's outward direction: shears' bulges (0.5–1 m) and shoots (8–15 cm).
      if (h > 0.05) {
        const nb = Math.sign(b) * (1 - Math.min(h / spec.height, 1) ** 4);
        const ny = Math.min(h / spec.height, 1) ** 4;
        const bulge = noise3(x * 1.4, y * 1.4, z * 1.4, seed) * 0.05 + noise3(x * 0.5 + s0, y * 0.5, z * 0.5, seed + 1) * 0.04;
        const fuzz = noise3(x * 9, y * 9, z * 9, seed + 2) * 0.025;
        const d = (bulge + fuzz) * Math.min(1, h / 0.25);
        x += mt[i].m[0] * nb * d;
        z += mt[i].m[1] * nb * d;
        y += ny * d;
      }
      ring.push(mesh.vert([x, y, z] as Vec3));
    }
    rings.push(ring);
  });
  const n = sec.length;
  const segs = spec.closed ? path.length : path.length - 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % path.length;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      mesh.face([rings[i][k], rings[i1][k], rings[i1][k1], rings[i][k1]], 0, [
        [arc[i] ?? 0, k],
        [arc[i1] ?? 0, k],
        [arc[i1] ?? 0, k1],
        [arc[i] ?? 0, k1],
      ]);
    }
  }
  if (!spec.closed) {
    mesh.face([...rings[0]], 0);
    mesh.face([...rings[path.length - 1]].reverse(), 0);
  }
  return orientOutward(mesh);
}

export function buildHedges(): { parts: Parts; specs: HedgeSpec[] } {
  const parts = new Parts('estate:hedge');
  const specs = hedgeSpecs();
  specs.forEach((s, i) => parts.add(s.name, hedgeMesh(s, 101 + i * 17)));
  return { parts, specs };
}
