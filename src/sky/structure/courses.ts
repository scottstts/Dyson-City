/**
 * Construction of the band's top (the Veil's mirror shield): a broad, continuous shield made of
 * innumerable smaller assemblies, organised by its own logic rather than the collectors'.
 *
 *   courses (circumferential, irregular widths) → sections (staggered per course) → panes → tiles
 *
 * - Courses run all the way round the star. Their irregular widths make the band's longitudinal
 *   organisation say that it circles the star, with no course boundary on the city's own line
 *   (a centre line pointing at the viewer reads as a road).
 * - Each course is cut into sections independently, at jittered lengths: transverse joints never
 *   line up across the band, so it has no ladder or paving rhythm. (Along the shell, equal lengths
 *   occupy roughly equal elevation angles, so an even rhythm would not even recede.)
 * - Course and section boundaries are where the organisation and the coating change (pane packing,
 *   coating reflectance, haze, how precisely the panes are set); the physical joints there are
 *   narrow: a structural seam between courses, hairlines elsewhere. The old shield's broad dark
 *   mullions at its largest divisions read as the gaps between paving slabs. A precision mirror
 *   mostly images more of itself, so these finish changes are what show its construction.
 * - Panes inside a section are laid along the course, staggered in some sections and aligned in
 *   others. Sections and panes follow the band's curve; only panes smaller than flatMax are flat.
 *
 * Coordinates: band longitude and latitude (radians); the band is within 3.5° of the equator, so
 * longitude is arc length to 0.2 %.
 */
import { float, vec2, vec3, floor, max, min, mix, select, step } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { DEG } from './layout';
import { lineCoverage, resolved2, type Division } from './plating';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export const BELT = {
  /** Course edges (latitude, degrees), south to north. The outermost lie under the rails; none on the equator. */
  courseEdges: [-3.5, -2.95, -2.15, -1.8, -0.75, 0.2, 0.85, 1.95, 2.4, 3.05, 3.5],
  /** Section length range along a course (radians); each course has its own, boundaries jittered ±jitter of it. */
  sectionMin: 1.6 * DEG,
  sectionMax: 5.5 * DEG,
  jitter: 0.3,
  /** Panes across a course (count range) and their length along it (multiples of their width). */
  panesMin: 2,
  panesMax: 6,
  aspects: [1, 1.5, 2.5, 4],
  /** Joint half-widths (radians): course seams (a range, set per boundary), section and pane joints (≈ 70, 30 km). */
  courseSeamMin: 0.00003,
  courseSeamMax: 0.00008,
  sectionJoint: 0.00007,
  paneJoint: 0.00003,
  /** The finest tile (sample-statistics lattice). */
  finest: 0.00025,
  /** Shared set error of a section (1σ, radians). */
  sectionSigma: 0.0012,
  /**
   * Each section's figure (haze: extra normal spread, 1σ radians) and the wide-angle scatter that
   * comes with it (diffuse albedo), its coating reflectance and its pane-setting precision (× the
   * panes' set error). The mean scatter is the enclosure solve's veil albedo.
   */
  figureMin: 0.0008,
  figureMax: 0.008,
  scatterMin: 0.003,
  scatterMax: 0.011,
  coatMin: 0.9,
  coatMax: 1.04,
  /** Panes vary about their section: tone (±) and scatter (×1 ± this). */
  paneTone: 0.035,
  paneScatter: 0.3,
  precisionMin: 0.4,
  precisionMax: 4,
} as const;

export interface BeltAssembly {
  /** Plating coordinates (longitude, latitude) and the pane as a division. */
  a: V2;
  pane: Division;
  /** Course identity. */
  courseHash: V3;
  /** The section's shared set error (radians along east, north). */
  sectionTilt: V2;
  /** The section's figure: extra normal spread of its panes (σ, radians). */
  figure: F;
  /** The pane's wide-angle scatter (diffuse albedo) and coating reflectance (× the shield's), and the section's pane set-error scale. */
  scatter: F;
  coat: F;
  precision: F;
  /** Coverage of the structural seam between courses. */
  seam: F;
}

/** The pane at band (lat, lon), with joints filtered by the footprints along east (fpE) and north (fpN). */
export function beltAssembly(lat: F, lon: F, fpE: F, fpN: F): BeltAssembly {
  const B = BELT;
  const edges = B.courseEdges.map((e) => e * DEG);
  // The course: its bounds and index.
  let lo: F = float(edges[0]);
  let hi: F = float(edges[edges.length - 1]);
  let course: F = float(0);
  for (let i = 1; i < edges.length - 1; i++) {
    const above = step(edges[i], lat);
    lo = mix(lo, float(edges[i]), above);
    hi = min(hi, select(lat.lessThan(edges[i]), float(edges[i]), float(10)));
    course = course.add(above);
  }
  const ch = hash33(vec3(course, 0, 7101));
  const width = hi.sub(lo);
  // Each boundary's seam has its own width (hashed by the boundary, so both courses agree).
  const seamAt = (edge: F) => mix(float(B.courseSeamMin), float(B.courseSeamMax), hash33(vec3(floor(edge.mul(1e5)), 0, 7113)).x);
  const dLo = lat.sub(lo);
  const dHi = hi.sub(lat);
  const seam = max(lineCoverage(dLo, seamAt(lo), fpN), lineCoverage(dHi, seamAt(hi), fpN));

  // Sections: boundary k of a course lies at (k + J(k))·L + phase, J ∈ ±jitter.
  const L = mix(float(B.sectionMin), float(B.sectionMax), ch.x);
  const phase = ch.y.mul(L);
  const bound = (k: F): F => k.add(hash33(vec3(k, course, 7103)).x.sub(0.5).mul(2 * B.jitter)).mul(L).add(phase);
  const j = floor(lon.sub(phase).div(L));
  const bj = bound(j);
  const bj1 = bound(j.add(1));
  const before = lon.lessThan(bj);
  const after = lon.greaterThanEqual(bj1);
  const third = bound(select(before, j.sub(1), j.add(2)));
  const s0 = select(before, third, select(after, bj1, bj));
  const s1 = select(before, bj, select(after, third, bj1));
  const section = select(before, j.sub(1), select(after, j.add(1), j));
  const sh = hash33(vec3(section, course, 7107));

  // Panes: rows across the course, laid along it; staggered or aligned per section.
  const n = floor(mix(float(B.panesMin), float(B.panesMax + 1), sh.x)).min(B.panesMax);
  const pw = width.div(n);
  const aspect = select(sh.y.lessThan(0.25), float(B.aspects[0]), select(sh.y.lessThan(0.5), float(B.aspects[1]), select(sh.y.lessThan(0.75), float(B.aspects[2]), float(B.aspects[3]))));
  const pl = pw.mul(aspect);
  const row = floor(lat.sub(lo).div(pw)).clamp(0, n.sub(1));
  const odd = row.sub(floor(row.mul(0.5)).mul(2.0));
  const offset = select(sh.z.lessThan(0.55), odd.mul(pl).mul(0.5), float(0));
  const q = floor(lon.sub(s0).add(offset).div(pl));
  // A pane ends at its section's boundaries: the organisation changes there.
  const p0 = max(q.mul(pl).sub(offset).add(s0), s0);
  const p1 = min(q.add(1).mul(pl).sub(offset).add(s0), s1);
  const r0 = lo.add(row.mul(pw));
  const origin = vec2(p0, r0) as unknown as V2;
  const size = vec2(p1.sub(p0), pw) as unknown as V2;
  const ph = hash33(vec3(q, row.add(course.mul(16.0)), section.add(7109.0)));

  // Joints: hairlines inside a course, slightly wider between sections.
  const dSection = min(lon.sub(s0), s1.sub(lon));
  const dRow = min(lat.sub(r0), r0.add(pw).sub(lat));
  const dPane = min(lon.sub(p0), p1.sub(lon));
  const mullion = max(lineCoverage(dSection, B.sectionJoint, fpE), max(lineCoverage(dRow, B.paneJoint, fpN), lineCoverage(dPane, B.paneJoint, fpE)));

  const sh2 = hash33(vec3(section, course, 7111));
  const paneRes = resolved2(size, vec2(fpE, fpN) as unknown as V2);
  return {
    a: vec2(lon, lat) as unknown as V2,
    pane: { origin, size, hash: ph, mullion },
    courseHash: ch,
    sectionTilt: sh2.xy.sub(0.5).mul(Math.sqrt(12) * B.sectionSigma) as unknown as V2,
    // Squared draws: most sections are crisp, a few hazy.
    figure: mix(float(B.figureMin), float(B.figureMax), sh2.z.mul(sh2.z)),
    // Panes differ about their section only where they are resolved (their mean is the section's).
    scatter: mix(float(B.scatterMin), float(B.scatterMax), sh2.z.mul(sh2.z)).mul(ph.y.sub(0.5).mul(2 * B.paneScatter).mul(paneRes).add(1)),
    coat: mix(float(B.coatMin), float(B.coatMax), sh.z.mul(0.6).add(ch.y.mul(0.4))).add(ph.z.sub(0.5).mul(2 * B.paneTone).mul(paneRes)),
    precision: mix(float(B.precisionMin), float(B.precisionMax), ch.z.mul(ch.z)),
    seam,
  };
}
