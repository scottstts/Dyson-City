/**
 * Joint hardware shared by the crew (docs/crew.md, "Joints"). Every degree of freedom is one rotary
 * actuator: a motor drum (the stator, finned graphite with black end faces) on one link and a bolted
 * bronze output flange or a yoke on the next. A joint of several degrees of freedom is a short
 * chain of them whose axes cross at one point (a gimbal), so it turns exactly as its angles say.
 *
 * Every articulation is built so its moving parts never pass through each other at any angle:
 *  - a drum turning about its own axis occupies the same space whatever the angle;
 *  - a yoke's two plates straddle the drum they carry with a running gap, their ends arcs about the
 *    axis, so they turn past it; and what hangs beyond a joint starts outside the yoke's radius.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { extrudeBevel, type Basis } from '../../geometry/solids';
import { currentDetail, frame, seg, turn as lathe } from '../kit/shapes';
import { CREW_SLOT as S } from '../materials';

/** A sphere about c (closed, outward). */
export function ball(c: Vec3, r: number, slot: number, segments = 20): PolyMesh {
  const prof: Vec2[] = [[0, -r]];
  const n = Math.max(6, Math.round(segments / 2));
  for (let i = 1; i < n; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    prof.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  prof.push([0, r]);
  return lathe(prof, segments, { o: c, u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, slot, 60);
}

/** A basis on an axis through c (w along the axis). */
const onAxis = (c: Vec3, axis: Vec3): Basis => frame(c, axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);

/**
 * A motor drum on an axis through c, from h0 to h1 along it: finned graphite sides (shallow
 * circumferential grooves), chamfered rims, black end faces stepped to a hub.
 */
export function drum(c: Vec3, axis: Vec3, r: number, h0: number, h1: number, opts: { fins?: number; segments?: number; side?: number } = {}): PolyMesh {
  const L = h1 - h0;
  const ch = Math.min(r * 0.12, L * 0.18, 0.004);
  const hub = r * 0.62;
  const step = Math.min(0.0025, L * 0.08);
  const prof: [number, number, number][] = [
    [0, h0 - step, S.black],
    [hub - step * 0.6, h0 - step, S.black],
    [hub, h0 - step * 0.4, S.black],
    [hub, h0, S.black],
    [r - ch, h0, S.black],
  ];
  // Fins: a few grooves round the middle of the drum (no more than five: beyond that they only add
  // triangles a pixel cannot resolve).
  const fins = currentDetail() < 0.5 ? 0 : (opts.fins ?? Math.min(5, Math.max(0, Math.floor((L - 4 * ch) / 0.009) - 1)));
  const side = opts.side ?? S.graphite;
  prof.push([r, h0 + ch, side]);
  if (fins > 0) {
    const a = h0 + ch * 2;
    const b = h1 - ch * 2;
    const pitch = (b - a) / (fins + 1);
    const g = Math.min(0.0012, pitch * 0.25);
    const d = Math.min(0.0016, r * 0.05);
    for (let k = 1; k <= fins; k++) {
      const z = a + pitch * k;
      prof.push([r, z - g, side], [r - d, z - g * 0.4, side], [r - d, z + g * 0.4, side], [r, z + g, side]);
    }
  }
  prof.push([r, h1 - ch, S.black], [r - ch, h1, S.black], [hub, h1, S.black], [hub, h1 + step * 0.4, S.black], [hub - step * 0.6, h1 + step, S.black], [0, h1 + step, S.black]);
  // Sides by radius: a clean silhouette at the size it is seen, no more.
  const segments = opts.segments ?? Math.max(16, Math.min(32, Math.round(r * 420)));
  return lathe(prof.map((p) => [p[0], p[1]] as Vec2), segments, onAxis(c, axis), prof.map((p) => p[2]), 38);
}

/**
 * A bronze output flange on an axis through c, from h0 to h1, with a ring of bolt heads on its face
 * at h1 (a part of several closed components: the disc and its bolts, seated 1 mm).
 */
export function flange(c: Vec3, axis: Vec3, r: number, h0: number, h1: number, opts: { bolts?: number; face?: 1 | -1; segments?: number } = {}): PolyMesh {
  const ch = Math.min(0.0025, (h1 - h0) * 0.3, r * 0.1);
  const b = onAxis(c, axis);
  const mesh = new PolyMesh(38);
  mesh.append(lathe([[0, h0], [r - ch, h0], [r, h0 + ch], [r, h1 - ch], [r - ch, h1], [0, h1]], opts.segments ?? 32, b, S.bronze));
  // Bolt heads only where they can be seen (the near level).
  const n = currentDetail() < 0.6 ? 0 : (opts.bolts ?? (r > 0.03 ? 8 : 6));
  const face = opts.face ?? 1;
  const hz = face > 0 ? h1 : h0;
  const br = Math.min(0.0034, r * 0.09);
  const rr = r * 0.74;
  const head = Math.min(0.0026, br * 0.8);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * (k + 0.5)) / n;
    const o: Vec3 = [b.o[0] + (b.u[0] * Math.cos(a) + b.v[0] * Math.sin(a)) * rr, b.o[1] + (b.u[1] * Math.cos(a) + b.v[1] * Math.sin(a)) * rr, b.o[2] + (b.u[2] * Math.cos(a) + b.v[2] * Math.sin(a)) * rr];
    const bb: Basis = { o, u: b.u, v: b.v, w: b.w };
    const z0 = hz - face * 0.001;
    const z1 = hz + face * head;
    mesh.append(lathe([[0, Math.min(z0, z1)], [br, Math.min(z0, z1)], [br, Math.max(z0, z1) - 0.0006], [br - 0.0006, Math.max(z0, z1)], [0, Math.max(z0, z1)]], 8, bb, S.graphite));
  }
  return mesh;
}

/** A plain bearing cap (a bronze disc with a chamfered rim) on an axis, from h0 to h1. */
export function cap(c: Vec3, axis: Vec3, r: number, h0: number, h1: number): PolyMesh {
  const ch = Math.min(0.0015, (h1 - h0) * 0.35);
  return lathe([[0, h0], [r, h0], [r, h1 - ch], [r - ch, h1], [0, h1]], 24, onAxis(c, axis), S.bronze);
}

export interface ClevisSpec {
  /** The hinge's centre and axis (unit). */
  c: Vec3;
  axis: Vec3;
  /** Which way the owner lies from the hinge (unit, ⟂ axis): the plates run that way. */
  toward: Vec3;
  /** Plates' inner and outer distance from the centre along the axis. */
  inner: number;
  outer: number;
  /** Radius of the plates' arc ends about the axis, and how far they run toward the owner. */
  radius: number;
  reach: number;
  /** Half-width of a plate where it runs into its owner (≥ radius: it flares). */
  flare?: number;
  slot: number;
  bevel?: number;
}

/** The two plates of a yoke or clevis (each a closed solid; one part of two components). */
export function clevis(s: ClevisSpec): PolyMesh {
  const b0 = frame(s.c, s.axis, s.toward);
  // Outline in (u: toward the owner, v: across), the arc end about the centre.
  const r = s.radius;
  const fl = s.flare ?? r;
  const out: Vec2[] = [];
  const n = seg(14, 6);
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  // (A flare's knee only where it flares: on a straight side it would be a collinear point.)
  const knee = fl > r + 1e-4;
  if (knee) out.push([s.reach * 0.55, -(r + (fl - r) * 0.4)]);
  out.push([s.reach, -fl], [s.reach, fl]);
  if (knee) out.push([s.reach * 0.55, r + (fl - r) * 0.4]);
  const mesh = new PolyMesh(36);
  for (const side of [-1, 1]) {
    const d0 = side > 0 ? s.inner : -s.outer;
    const d1 = side > 0 ? s.outer : -s.inner;
    mesh.append(extrudeBevel(out, { o: b0.o, u: b0.u, v: b0.v, w: b0.w }, d0, d1, s.bevel ?? Math.min(0.003, (s.outer - s.inner) * 0.25), s.slot));
  }
  return mesh;
}

/** Bearing caps on both outer faces of a clevis (one part of two components). */
export function clevisCaps(c: Vec3, axis: Vec3, outer: number, r: number, t = 0.006): PolyMesh {
  const m = new PolyMesh(38);
  m.append(cap(c, axis, r, outer - 0.0008, outer + t));
  m.append(cap(c, [-axis[0], -axis[1], -axis[2]], r, outer - 0.0008, outer + t));
  return m;
}
