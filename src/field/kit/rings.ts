/**
 * Large fabricated rings (gimbals, the Resonator's isolation hoops, flanges on the spool): a dressed
 * box section swept round a circle, built in shop segments joined by black glazed splice collars.
 */
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, girderProfile, sweep } from '../../geometry/sweep';
import { lathe, orientOutward, type Basis } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';

export interface RingSpec {
  /** Centreline radius. */
  R: number;
  /** Half-size radially and axially. */
  hr: number;
  ha: number;
  /** Basis: the circle lies in (u, v) about o; w is its axis. */
  b: Basis;
  slot?: number;
  /** Samples per metre of centreline (default ~1 per 1.2 m). */
  ds?: number;
}

/** A point on the ring's centreline at angle φ (from u toward v). */
export function ringPoint(s: RingSpec, phi: number, radial = 0, axial = 0): Vec3 {
  const r = s.R + radial;
  return v3.add(s.b.o, v3.add(v3.add(v3.scale(s.b.u, Math.cos(phi) * r), v3.scale(s.b.v, Math.sin(phi) * r)), v3.scale(s.b.w, axial)));
}

/** The ring as one closed solid: chamfered box section with a shallow groove on both faces. */
export function ringBody(s: RingSpec): PolyMesh {
  const n = Math.ceil((2 * Math.PI * s.R) / (s.ds ?? 1.2));
  const pts: Vec3[] = [];
  const nrm: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push(ringPoint(s, a));
    nrm.push(v3.norm(v3.sub(ringPoint(s, a, 1), ringPoint(s, a))));
  }
  const frames = framesFrom(pts, nrm, true);
  const ch = Math.min(s.hr, s.ha) * 0.12;
  const groove = Math.min(s.hr, s.ha) * 0.08;
  const prof = girderProfile({ halfWidth: s.ha, t0: -s.hr, t1: s.hr, chamferBottom: ch, chamferTop: ch, grooves: [[-s.hr * 0.25, s.hr * 0.25, groove]], topSlot: s.slot ?? FIELD_SLOT.gold, sideSlot: s.slot ?? FIELD_SLOT.gold, bottomSlot: s.slot ?? FIELD_SLOT.gold });
  return orientOutward(sweep(frames, prof, { closed: true, crease: 30 }));
}

/**
 * A splice collar round the ring's section at angle φ: a black glazed band `len` long, standing
 * `proud` off the section (seated 10 mm into it).
 */
export function spliceCollar(s: RingSpec, phi: number, len: number, proud: number): PolyMesh {
  const c = ringPoint(s, phi);
  const t = v3.norm(v3.sub(ringPoint(s, phi + 1e-3), ringPoint(s, phi - 1e-3)));
  const radial = v3.norm(v3.sub(ringPoint(s, phi, 1), c));
  // Collar as a short sweep along the tangent of a chamfered rectangle slightly larger than the section.
  const hw = s.ha + proud;
  const hh = s.hr + proud;
  const pts: Vec3[] = [v3.add(c, v3.scale(t, -len / 2)), v3.add(c, v3.scale(t, len / 2))];
  const frames = framesFrom(pts, [radial, radial]);
  const prof = girderProfile({ halfWidth: hw, t0: -hh, t1: hh, chamferBottom: proud * 0.8, chamferTop: proud * 0.8, topSlot: FIELD_SLOT.black, sideSlot: FIELD_SLOT.black, bottomSlot: FIELD_SLOT.black });
  return orientOutward(sweep(frames, prof, { crease: 30, capSlot: FIELD_SLOT.black }));
}

/**
 * A turned bearing housing on an axis: a flanged drum with a bolted cap. `base` is where it is
 * seated (the face it stands on), `axis` points away from that face.
 */
export function bearingHousing(b: Basis, r: number, len: number, slot: number = FIELD_SLOT.steel, capSlot: number = FIELD_SLOT.bronze): PolyMesh {
  const f = r * 1.25;
  const prof: [number, number][] = [
    [0, -0.05],
    [f, -0.05],
    [f, len * 0.12],
    [r + 0.04, len * 0.16],
    [r, len * 0.2],
    [r, len * 0.86],
    [r * 0.92, len * 0.9],
    [r * 0.7, len * 0.9],
    [r * 0.66, len],
    [0, len],
  ];
  const segs = Math.max(32, Math.round(r * 24));
  return lathe(prof, segs, b, [slot, slot, slot, slot, slot, slot, capSlot, capSlot, capSlot], 36);
}
