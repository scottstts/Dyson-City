/**
 * What a traced reflection shows of the structure it meets. A precision mirror (the band) or a
 * resolved polished tile images real pieces of the enclosure, so a reflected panel must look like
 * that panel's region, not the enclosure's average: its basins of polished or satin plating at their
 * own loads, its rim and the hot perimeter header, the girders' cooler alloy. That is what makes
 * the image an enclosure reflecting itself.
 *
 * It is a coarse evaluation, not the surface shader: the broad layout only (the first
 * `coarseLevels` of the collection network, districts.ts), each class's reflected light from the
 * enclosure solve (enclosure.ts REFLECTION_CLASSES) by the elevation it is seen at, and the glow of
 * the region's temperature. Finer detail is below the reflection's own blur.
 */
import { float, vec3, vec4, If, abs, max, mix, select, smoothstep, step, cos, sin } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { MAT, panelField, type StructureHit } from './trace';
import { DISTRICTS, DISTRICT_KINDS, basinCharacter, channelHalfWidth, channelHeat, descend, panelCoords, panelSeed, sideDistances } from './districts';
import { lineCoverage } from './plating';
import { COLLECTOR_TEMPERATURE, HEADER_TEMPERATURE, OFFLINE_SHARE, STRUCTURE_TEMPERATURE, glowNode, glowRadiance } from './thermal';
import { PANEL_HEADER } from './surfaces';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/** Area shares of the finishes on a polished collector field and a satin one (surfaces.ts fields). */
const POLISHED_FIELD_SATIN = 0.28;
const SATIN_FIELD_SATIN = 0.7;
const HEADER_GLOW = glowRadiance(HEADER_TEMPERATURE);

export interface ReflectedRegion {
  /** Weights of the reflection classes (collector, satin, structure, veil). */
  weights: V4;
  /** Thermal glow (scene radiance). */
  emission: V3;
}

/**
 * The region a reflection ray meets. `hit` is the traced hit (frame coordinates in aux for panels,
 * band coordinates for the band); `fp` the ray's footprint there (arc units).
 */
export function reflectedRegion(hit: StructureHit, fp: F): ReflectedRegion {
  // One glow per ray: the region's temperature and a scale, and the header's coverage (its glow is a
  // constant). Mixing in temperature rather than in glow understates the convexity a little; this is
  // a coarse view.
  const weights = vec4(0, 0, 1, 0).toVar();
  const T = float(STRUCTURE_TEMPERATURE).toVar();
  const scale = float(1).toVar();
  const header = float(0).toVar();
  If(hit.mat.equal(float(MAT.panel)), () => {
    const lat = hit.aux.x;
    const lon = hit.aux.y;
    const qn = vec3(cos(lat).mul(sin(lon)), cos(lat).mul(cos(lon)).negate(), sin(lat).negate());
    const pf = panelField(qn);
    const c = panelCoords(lon, abs(lat), pf.lon0, pf.lonSpan, panelSeed(pf.cell));
    const cell = descend(c, DISTRICTS.coarseLevels);
    const basin = basinCharacter(cell.basin);
    // Expected satin share of the basin's districts (satin, striped and polished kinds).
    const pSatin = basin.satin.mul(DISTRICT_KINDS.satinPerShare);
    const pStriped = float(DISTRICT_KINDS.striped);
    const satin = pSatin.mul(SATIN_FIELD_SATIN).add(pStriped.mul((SATIN_FIELD_SATIN + POLISHED_FIELD_SATIN) / 2)).add(float(1).sub(pSatin).sub(pStriped).mul(POLISHED_FIELD_SATIN));
    const collect = float(1 - OFFLINE_SHARE);
    // The manifolds of the broad layout (hotter by what they collect), the rim and the perimeter header.
    const d = sideDistances(c, cell).outer;
    const S = cell.side;
    const cov = (['x', 'y', 'z', 'w'] as const).map((i) => {
      const hw = channelHalfWidth(S[i]);
      const k = lineCoverage(d[i], max(hw, 1e-7), fp).mul(step(1e-7, hw));
      return { k, heat: k.mul(channelHeat(S[i])) };
    });
    const channel = cov.map((v) => v.k).reduce((x, y) => max(x, y));
    const heat = cov.map((v) => v.heat).reduce((x, y) => max(x, y));
    const rim = float(1).sub(smoothstep(0.0008, 0.0016, pf.dist));
    const structural = max(channel, rim);
    weights.assign(vec4(collect.mul(satin.oneMinus()), collect.mul(satin), float(0), float(0)).mul(structural.oneMinus()).add(vec4(0, 0, structural, 0)));
    T.assign(mix(float(COLLECTOR_TEMPERATURE).mul(basin.heat.add(heat).add(1)), float(STRUCTURE_TEMPERATURE), rim));
    scale.assign(mix(collect.mul(1.04), float(1), structural));
    header.assign(lineCoverage(pf.dist.sub(PANEL_HEADER.offset), PANEL_HEADER.halfWidth, fp));
  });
  If(hit.mat.equal(float(MAT.panelEdge)), () => {
    T.assign(STRUCTURE_TEMPERATURE * 0.88);
  });
  If(hit.mat.equal(float(MAT.frame)).or(hit.mat.equal(float(MAT.hub))), () => {
    // Decks carry sections of collector plating; walls only conduct and run cooler.
    const top = hit.aux.y.lessThan(0.5);
    weights.assign(select(top, vec4(0.15, 0.08, 0.77, 0), vec4(0, 0, 1, 0)));
    T.assign(select(top, float(STRUCTURE_TEMPERATURE * 0.7 + COLLECTOR_TEMPERATURE * 0.3), float(STRUCTURE_TEMPERATURE * 0.86)));
  });
  If(hit.mat.equal(float(MAT.girdle)), () => {
    weights.assign(vec4(0, 0, 0, 1));
    scale.assign(0);
  });
  return { weights, emission: mix(glowNode(T).mul(scale), vec3(...HEADER_GLOW), header) as unknown as V3 };
}
