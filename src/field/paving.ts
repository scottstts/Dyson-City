/**
 * What the Field sets flush into the platform's limestone (city_plan.md §6, §7): a material change
 * on the one platform surface, never stacked geometry (no coplanar layers, no lips to trip on).
 *
 *  - Roads: dark polished basalt slabs (1.6 × 0.8 m, running bond along the road) with bronze edge
 *    inlays. Polished, they mirror the gold machines and the sky; slab lippage breaks the mirror.
 *  - The landing pad: dark heat-resistant ceramic tiles (0.6 m), matte, each its own temper tint,
 *    with bronze markings (edge ring, touchdown ring, dashed ring, four ticks); the bronze datum
 *    disc stays in a limestone roundel at its centre.
 *  - The apron between pad and ring road: darker limestone courses on rings.
 *  - The Gate Court's bronze border and its stub to the estate's gateway.
 *  - Covered service trenches: graphite cover plates in 1.5 m lengths with bronze edges.
 *
 *  - The perimeter road: the same basalt on its arc inside the Cordon.
 *  - Precinct plates: every block between the roads is paved in its zone's own stone (city_plan.md
 *    §7: each place its own palette), slabs sized to the use, inside a bronze border 1.4 m in from
 *    the block's edge. Roads and trenches cut through the plates.
 *
 * Coverage is footprint-filtered, so edges and joints never alias at range.
 */
import { float, vec2, vec3, length, abs, fract, floor, max, min, mix, smoothstep, atan, select, PI } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, fbm3 } from '../render/tsl/noise';
import { band, lodFade } from '../render/tsl/patterns';
import { COMPOUND_R, CORDON, ESTATE_GATEWAY, GATE_COURT, LANDING_PAD, PERIMETER, PRECINCTS, RING_ROAD, RING_TRENCH_R, ROAD, ROADS, TRENCH_HALF, trenchLines, type RoadSegment, type Zone } from "./layout";

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** What the paving puts at a point; `cover` 0 leaves the limestone as it is. */
export interface PavingSample {
  cover: F;
  color: V3;
  roughness: F;
  metalness: F;
  /** Clear coat (the polish on basalt). */
  coat: F;
  coatRoughness: F;
  /** Per-slab tilt (world x, z) for the polished surfaces' broken reflection. */
  tilt: V2;
}

export type Paving = (p: V2, fp: F) => PavingSample;

const BASALT = vec3(0.045, 0.043, 0.041);
const TILE = vec3(0.075, 0.068, 0.062);
const COURSE = vec3(0.4, 0.37, 0.32);
const BRONZE = vec3(0.86, 0.69, 0.47);
const GRAPHITE = vec3(0.3, 0.29, 0.28);

/** Local (along, across) of p for a straight segment, and the segment's length. */
function segmentFrame(p: V2, s: RoadSegment): { along: F; across: F; len: number } {
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const q = p.sub(vec2(s.a[0], s.a[1]));
  return { along: q.x.mul(ux).add(q.y.mul(uz)), across: q.x.mul(-uz).add(q.y.mul(ux)), len };
}

/** Soft inside-coverage of an interval [lo, hi] at footprint fp. */
function inside(x: F, lo: number | F, hi: number | F, fp: F): F {
  const e = fp.mul(0.5);
  return smoothstep(float(lo as number).sub(e), float(lo as number).add(e), x).mul(smoothstep(float(hi as number).add(e), float(hi as number).sub(e), x));
}

/** Running-bond slab coordinates in (along, across): distance to the nearest joint and the slab id. */
function slabs(a: F, c: F, sx: number, sy: number): { dist: F; id: V2 } {
  const row = floor(c.div(sy));
  const shifted = a.add(fract(row.mul(0.5)).mul(sx));
  const lx = fract(shifted.div(sx)).mul(sx);
  const ly = fract(c.div(sy)).mul(sy);
  return { dist: min(min(lx, float(sx).sub(lx)), min(ly, float(sy).sub(ly))), id: vec2(floor(shifted.div(sx)), row) };
}

/** Each zone's stone: colour, roughness, slab (along x, along z). */
const ZONE_STONE: Record<Zone, { color: [number, number, number]; rough: number; slab: [number, number] }> = {
  craft: { color: [0.22, 0.22, 0.23], rough: 0.62, slab: [1.2, 1.2] },
  instruments: { color: [0.72, 0.71, 0.68], rough: 0.32, slab: [2.4, 1.2] },
  power: { color: [0.62, 0.5, 0.36], rough: 0.7, slab: [1.8, 0.9] },
  cryo: { color: [0.42, 0.46, 0.5], rough: 0.45, slab: [1.5, 1.0] },
  science: { color: [0.7, 0.66, 0.58], rough: 0.5, slab: [1.6, 0.8] },
  works: { color: [0.15, 0.14, 0.13], rough: 0.75, slab: [0.3, 0.2] },
  heat: { color: [0.55, 0.32, 0.22], rough: 0.68, slab: [0.6, 0.3] },
};

/** Running bond with a slab size chosen per pixel (a node): distance to the nearest joint and the slab id. */
function slabsSized(a: F, c: F, size: V2): { dist: F; id: V2 } {
  const row = floor(c.div(size.y));
  const shifted = a.add(fract(row.mul(0.5)).mul(size.x));
  const lx = fract(shifted.div(size.x)).mul(size.x);
  const ly = fract(c.div(size.y)).mul(size.y);
  return { dist: min(min(lx, size.x.sub(lx)), min(ly, size.y.sub(ly))), id: vec2(floor(shifted.div(size.x)), row) };
}

export function fieldPaving(): Paving {
  const trenches = trenchLines();
  return (p, fp) => {
    const r = length(p);
    // --- Roads: the straight ones and the ring --------------------------------------------------
    let along: F = atan(p.y, p.x).mul(RING_ROAD.r0 + ROAD.half);
    let across: F = r.sub((RING_ROAD.r0 + RING_ROAD.r1) / 2);
    const ring = inside(r, RING_ROAD.r0, RING_ROAD.r1, fp);
    // The perimeter road: an arc inside the cordon (it stops short of the estate and the west front).
    const angle = atan(p.y, p.x);
    const perim = inside(r, PERIMETER.r0, PERIMETER.r1, fp).mul(inside(angle, PERIMETER.a0, PERIMETER.a1, fp.div(r)));
    let roadCover: F = max(ring, perim);
    along = select(perim.greaterThan(ring), angle.mul((PERIMETER.r0 + PERIMETER.r1) / 2), along);
    across = select(perim.greaterThan(ring), r.sub((PERIMETER.r0 + PERIMETER.r1) / 2), across);
    const straight: F[] = [];
    for (const s of ROADS) {
      const f = segmentFrame(p, s);
      const c = inside(f.across, -s.half, s.half, fp).mul(inside(f.along, 0, f.len, fp));
      straight.push(c);
      // The slab frame follows whichever road covers the point most.
      along = select(c.greaterThan(roadCover), f.along, along);
      across = select(c.greaterThan(roadCover), f.across, across);
      roadCover = max(roadCover, c);
    }
    const anyStraight = straight.reduce((a, b) => max(a, b));
    // Bronze edges: each road's edge lines, but not across another road's surface.
    let edge: F = max(max(band(r.sub(RING_ROAD.r0), ROAD.edge / 2, fp), band(r.sub(RING_ROAD.r1), ROAD.edge / 2, fp)), max(band(r.sub(PERIMETER.r0), ROAD.edge / 2, fp), band(r.sub(PERIMETER.r1), ROAD.edge / 2, fp)).mul(inside(angle, PERIMETER.a0, PERIMETER.a1, fp.div(r)))).mul(float(1).sub(anyStraight));
    ROADS.forEach((s, i) => {
      const f = segmentFrame(p, s);
      const others = max(max(ring, perim), straight.filter((_, k) => k !== i).reduce((a, b) => max(a, b), float(0)));
      const lines = max(band(f.across.sub(s.half), ROAD.edge / 2, fp), band(f.across.add(s.half), ROAD.edge / 2, fp)).mul(inside(f.along, 0, f.len, fp));
      // The far end is closed by a cross band where the road meets a hero's apron.
      const end = band(f.along.sub(f.len), ROAD.edge / 2, fp).mul(inside(f.across, -s.half, s.half, fp));
      edge = max(edge, max(lines, i === 0 ? float(0) : end).mul(float(1).sub(others)));
    });
    const slab = slabs(along, across, 1.6, 0.8);
    const slabFade = lodFade(fp, 0.5);
    const hs = mix(vec3(0.5), hash33(vec3(slab.id, 23)), slabFade);
    const sJoint = band(slab.dist, 0.002, fp);
    const basalt = BASALT.mul(float(0.9).add(hs.x.mul(0.2))).mul(float(1).sub(sJoint.mul(0.4)));

    // --- The landing pad: dark ceramic tiles, bronze markings, limestone round the datum --------
    const padCover = inside(r, 3.5, LANDING_PAD.r, fp);
    const tileId = floor(p.div(0.6));
    const tl = fract(p.div(0.6)).mul(0.6);
    const tDist = min(min(tl.x, float(0.6).sub(tl.x)), min(tl.y, float(0.6).sub(tl.y)));
    const tJoint = band(tDist, 0.002, fp);
    const ht = mix(vec3(0.5), hash33(vec3(tileId, 31)), lodFade(fp, 0.2));
    const temper = fbm3(vec3(p.mul(0.08), 4), 3, fp.mul(0.08));
    const tile = TILE.mul(float(0.85).add(ht.x.mul(0.3))).mul(vec3(1.0, float(0.97).add(temper.mul(0.04)), float(0.93).add(temper.mul(0.08)))).mul(float(1).sub(tJoint.mul(0.35)));
    const ang = atan(p.y, p.x);
    const dash = smoothstep(0.42, 0.58, abs(fract(ang.div(PI.mul(2)).mul(72)).sub(0.5)).mul(2));
    const tick = band(abs(fract(ang.div(PI.mul(0.5)).add(0.5)).sub(0.5)).mul(PI.mul(0.5)).mul(r), 0.18, fp).mul(inside(r, LANDING_PAD.r - 12, LANDING_PAD.r - 4, fp));
    const marks = max(
      max(band(r.sub(LANDING_PAD.r - 0.1), 0.1, fp), band(r.sub(LANDING_PAD.r - 3), 0.17, fp)),
      max(band(r.sub(LANDING_PAD.r - 14), 0.1, fp).mul(dash), max(tick, band(r.sub(3.5), 0.06, fp))),
    );

    // --- Apron courses, the Gate Court's border, trenches -----------------------------------------
    const apron = inside(r, LANDING_PAD.r + 1, RING_ROAD.r0 - 1, fp);
    const ringCourse = band(abs(fract(r.sub(LANDING_PAD.r).div(11).add(0.5)).sub(0.5)).mul(11), 0.15, fp).mul(apron).mul(smoothstep(LANDING_PAD.r + 5, LANDING_PAD.r + 6, r));
    const cx = p.x;
    const cz = p.y;
    const inStub = inside(cx, ESTATE_GATEWAY.x0, ESTATE_GATEWAY.x1, fp).mul(inside(cz, ESTATE_GATEWAY.z, GATE_COURT.z0, fp));
    const courtEdge = max(
      max(band(cx.sub(GATE_COURT.x1), 0.1, fp).mul(inside(cz, GATE_COURT.z0, GATE_COURT.z1, fp)).mul(float(1).sub(roadCover)), band(cz.sub(GATE_COURT.z1), 0.1, fp).mul(inside(cx, GATE_COURT.x0, GATE_COURT.x1, fp))),
      max(band(cz.sub(GATE_COURT.z0), 0.1, fp).mul(inside(cx, GATE_COURT.x0, GATE_COURT.x1, fp)).mul(float(1).sub(inStub)), max(band(cx.sub(ESTATE_GATEWAY.x0), 0.1, fp), band(cx.sub(ESTATE_GATEWAY.x1), 0.1, fp)).mul(inside(cz, ESTATE_GATEWAY.z, GATE_COURT.z0, fp))),
    );
    let trench: F = inside(r, RING_TRENCH_R - TRENCH_HALF, RING_TRENCH_R + TRENCH_HALF, fp).mul(float(1).sub(anyStraight));
    let trenchAlong: F = atan(p.y, p.x).mul(RING_TRENCH_R);
    let trenchAcross: F = r.sub(RING_TRENCH_R);
    for (const t of trenches) {
      const f = segmentFrame(p, t);
      const c = inside(f.across, -TRENCH_HALF, TRENCH_HALF, fp).mul(inside(f.along, 0, f.len, fp)).mul(float(1).sub(ring));
      trenchAlong = select(c.greaterThan(trench), f.along, trenchAlong);
      trenchAcross = select(c.greaterThan(trench), f.across, trenchAcross);
      trench = max(trench, c);
    }
    const plateL = fract(trenchAlong.div(1.5)).mul(1.5);
    const plateJoint = band(min(plateL, float(1.5).sub(plateL)), 0.004, fp);
    const trenchEdge = band(abs(trenchAcross).sub(TRENCH_HALF - 0.04), 0.035, fp);
    const plateId = floor(trenchAlong.div(1.5));
    const hp = hash33(vec3(plateId, 5, 7));
    const plate = GRAPHITE.mul(float(0.85).add(hp.x.mul(0.25))).mul(float(1).sub(plateJoint.mul(0.6)));

    // --- Precinct plates: each block its own stone, a bronze border inset from its edge -----------
    const keep = smoothstep(RING_ROAD.r1 + 4, RING_ROAD.r1 + 6, r).mul(smoothstep(COMPOUND_R + 1, COMPOUND_R - 1, r)).mul(smoothstep(CORDON.frontX + 5, CORDON.frontX + 7, p.x));
    let plateCover: F = float(0);
    let zoneColor: V3 = vec3(0);
    let zoneRough: F = float(0.4);
    let zoneSize: V2 = vec2(1.6, 0.8);
    let plateEdge: F = float(0);
    for (const pr of PRECINCTS) {
      const z = ZONE_STONE[pr.zone];
      const c = inside(p.x, pr.x0, pr.x1, fp).mul(inside(p.y, pr.z0, pr.z1, fp)).mul(keep);
      zoneColor = select(c.greaterThan(plateCover), vec3(...z.color), zoneColor);
      zoneRough = select(c.greaterThan(plateCover), float(z.rough), zoneRough);
      zoneSize = select(c.greaterThan(plateCover), vec2(...z.slab), zoneSize);
      const dEdge = min(min(p.x.sub(pr.x0), float(pr.x1).sub(p.x)), min(p.y.sub(pr.z0), float(pr.z1).sub(p.y)));
      plateEdge = max(plateEdge, band(dEdge.sub(1.4), 0.14, fp).mul(c));
      plateCover = max(plateCover, c);
    }
    const ps = slabsSized(p.x, p.y, zoneSize);
    const hz = mix(vec3(0.5), hash33(vec3(ps.id, 47)), lodFade(fp, 0.4));
    const pJoint = band(ps.dist, 0.0025, fp);
    const zoneStone = zoneColor.mul(float(0.88).add(hz.x.mul(0.24))).mul(float(1).sub(pJoint.mul(0.45)));

    // --- Combine --------------------------------------------------------------------------------
    const road = roadCover.mul(float(1).sub(padCover));
    const plateOnly = plateCover.mul(float(1).sub(road)).mul(float(1).sub(trench));
    const bronze = max(max(edge, marks.mul(padCover)), max(max(courtEdge, trenchEdge.mul(trench)), plateEdge.mul(plateOnly)));
    const cover = max(max(max(road, padCover), plateCover), max(max(ringCourse, trench), bronze)).min(1);
    let color: V3 = mix(mix(COURSE.mul(float(0.9).add(hs.y.mul(0.15))), zoneStone, plateOnly), basalt, road);
    color = mix(color, tile, padCover);
    color = mix(color, plate, trench.mul(float(1).sub(road)));
    color = mix(color, BRONZE.mul(float(0.92).add(hs.z.mul(0.08))), bronze);
    const roughness = mix(mix(mix(mix(float(0.36), zoneRough.add(pJoint.mul(0.4)), plateOnly), float(0.3).add(hs.y.mul(0.08)).add(sJoint.mul(0.5)), road), float(0.55).add(ht.y.mul(0.15)).add(tJoint.mul(0.3)), padCover), float(0.5), bronze).add(trench.mul(float(1).sub(road)).mul(0.2));
    const metalness = max(bronze, trench.mul(float(1).sub(road)).mul(float(1).sub(bronze)));
    const coat = road.mul(float(1).sub(sJoint)).mul(float(1).sub(bronze)).mul(0.9);
    const coatRoughness = float(0.2).add(hs.z.mul(0.08));
    const tilt = vec2(hs.x.sub(0.5), hs.z.sub(0.5)).mul(0.004).mul(road);
    return { cover, color, roughness, metalness, coat, coatRoughness, tilt };
  };
}
