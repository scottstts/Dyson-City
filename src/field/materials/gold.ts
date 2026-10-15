/**
 * The Field's gold (docs/field.md, city_plan.md §2, §5.1). Gold is there for a physical reason: it
 * reflects infrared, the standard thermal control for instruments under 23,000 suns. Under a 90°
 * star overhead it is a mirror of the world, so its finish follows which way a face looks:
 *
 *  - **Clad gold** (`createGoldMaterial`): polished where a face is vertical or curved away from
 *    the zenith (it mirrors the pale ground, the other machines, the house), satin where a face
 *    turns up toward the star. An up-facing mirror would be as bright as the star: the field must
 *    not become a field of second suns. The cladding is laid in panels (metric UVs from the sweeps)
 *    with fine seams; each panel is set with its own milliradian error, so reflections break panel
 *    by panel instead of sliding like CG chrome.
 *  - **Mirror** (`createMirrorMaterial`): the Resonator's flawless torus. No seams, the faintest
 *    long-wave figure error, and only the top band toward the star dulled.
 *  - **Satin** (`createSatinGoldMaterial`): brushed gold for broad flat faces, streaked along u.
 *  - **Foil** (`createFoilMaterial`): multi-layer insulation of aluminised polyimide, crinkled into
 *    facets, quilted and stitched in gores (UVs: u around, v along), as on spacecraft.
 *
 * Every detail fades to its mean by pixel footprint, and the lost facet slope is handed to the
 * roughness, so the far field keeps the near field's average sheen (specular anti-aliasing).
 */
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, vec2, vec3, uv, fwidth, length, max, abs, fract, floor, mix, smoothstep, normalize, normalWorldGeometry, positionWorld, transformNormalToView, sin, dot, clamp } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, valueNoise3, fbm3, cellular3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Gold's reflectance (linear F0); a little washed toward white, as the field's gold reads under the blaze. */
export const GOLD_F0 = vec3(0.95, 0.75, 0.38);
/** Aluminised polyimide (MLI outer layer): deeper, more amber than bulk gold. */
export const FOIL_F0 = vec3(0.86, 0.6, 0.27);

/** Polished and satin roughness of the cladding. */
const POLISHED = 0.055;
const SATIN = 0.5;

/** Tilts a world normal by a world-space vector, projected into the tangent plane. */
function tilt(n: V3, t: V3): V3 {
  return normalize(n.add(t.sub(n.mul(dot(n, t)))));
}

/** How much a face looks up at the star: 0 for vertical and down-facing, 1 facing the zenith. */
export function upFacing(n: V3 = normalWorldGeometry): F {
  return smoothstep(0.55, 0.88, n.y);
}

export interface GoldOptions {
  /** Cladding panel size (u along the member, v around it), metres. */
  panel?: [number, number];
}

export function createGoldMaterial(name: string, opts: GoldOptions = {}): MeshPhysicalNodeMaterial {
  const [pu, pv] = opts.panel ?? [2.4, 1.2];
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5).toVar();
  // Panels in running bond along u; the row's phase steps per row so seams stagger.
  const row = floor(st.y.div(pv));
  const q = vec2(st.x.add(fract(row.mul(0.5)).mul(pu)), st.y);
  const cell = floor(q.div(vec2(pu, pv)));
  const local = fract(q.div(vec2(pu, pv))).mul(vec2(pu, pv));
  const toEdge = local.min(vec2(pu, pv).sub(local));
  const edge = toEdge.x.min(toEdge.y);
  const seam = band(edge, 0.0025, fp).toVar();
  const fade = lodFade(fp, 0.9);
  const h = mix(vec3(0.5), hash33(vec3(cell, 41)), fade).toVar();
  const n = normalWorldGeometry;
  const up = upFacing(n);
  // Panel set error (±1.2 mrad) and a faint oil-can drift across large panels.
  const wobble = fbm3(positionWorld.mul(0.6), 2, fp.mul(0.6)).sub(0.5);
  const t = h.sub(0.5).mul(0.0024 * 2).mul(fade).add(vec3(wobble, wobble.mul(0.5), wobble.negate()).mul(0.0012));
  const nW = tilt(n, t);
  mat.normalNode = transformNormalToView(nW);
  const tone = float(0.97).add(h.x.sub(0.5).mul(0.04));
  mat.colorNode = GOLD_F0.mul(tone).mul(float(1).sub(seam.mul(0.55)));
  // Satin tops, polished sides; seams are dull; lost panel tilt goes to roughness at range.
  const rough = mix(float(POLISHED).add(h.y.sub(0.5).mul(0.02)), float(SATIN).add(h.y.sub(0.5).mul(0.06)), up);
  mat.roughnessNode = clamp(rough.add(seam.mul(0.4)).add(float(1).sub(fade).mul(0.015)), 0.03, 1);
  mat.metalnessNode = float(1);
  return mat;
}

export function createMirrorMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = max(length(fwidth(positionWorld)), 1e-5);
  const n = normalWorldGeometry;
  // Figure error: a few hundred microradians over metres, so the mirror is real, not CG.
  const w = vec3(valueNoise3(positionWorld.mul(0.08)), valueNoise3(positionWorld.mul(0.08).add(17)), valueNoise3(positionWorld.mul(0.08).add(31))).sub(0.5);
  const fine = fbm3(positionWorld.mul(1.3), 2, fp.mul(1.3)).sub(0.5);
  mat.normalNode = transformNormalToView(tilt(n, w.mul(0.0012).add(vec3(fine).mul(0.0004))));
  mat.colorNode = GOLD_F0;
  mat.roughnessNode = mix(float(0.03), float(0.16), smoothstep(0.8, 0.97, n.y));
  mat.metalnessNode = float(1);
  return mat;
}

export function createSatinGoldMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5);
  // Brushing streaks run along u: stretched noise, fading by footprint across v.
  const streak = valueNoise3(vec3(st.x.mul(0.8), st.y.mul(160), 3)).sub(0.5).mul(lodFade(fp, 0.02));
  const cloud = fbm3(positionWorld.mul(0.25), 3, fp.mul(0.25)).sub(0.5);
  mat.colorNode = GOLD_F0.mul(float(0.95).add(cloud.mul(0.05)));
  mat.roughnessNode = float(0.28).add(streak.mul(0.12)).add(cloud.mul(0.05));
  mat.metalnessNode = float(1);
  return mat;
}

/**
 * Multi-layer insulation blanket. Its outer film is crumpled into facets of a few centimetres to a
 * few decimetres (Voronoi cells, each tilted), the blanket is quilted by tack stitches on a grid
 * and closed along gore seams (bands of stitching along u at `gore` metres, along v at `quilt`).
 */
export function createFoilMaterial(name: string, opts: { gore?: number; quilt?: number } = {}): MeshPhysicalNodeMaterial {
  const gore = opts.gore ?? 1.5;
  const quilt = opts.quilt ?? 0.45;
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const wp = positionWorld;
  const fpW = max(length(fwidth(wp)), 1e-5).toVar();
  const fpU = max(length(fwidth(st)), 1e-5).toVar();
  const n = normalWorldGeometry;
  // Large crinkles (~0.25 m) and fine ones (~5 cm); each cell tilts its film.
  const c1 = cellular3(wp.mul(4), float(0), float(0));
  const c2 = cellular3(wp.mul(19).add(7), float(0), float(0));
  const f1 = lodFade(fpW, 0.25);
  const f2 = lodFade(fpW, 0.05);
  const r1 = hash33(vec3(c1.z.mul(9187), 3, 11)).sub(0.5);
  const r2 = hash33(vec3(c2.z.mul(7411), 5, 13)).sub(0.5);
  // Creases between cells catch the light: a ridge where F2 − F1 is small.
  const crease = smoothstep(0.06, 0.0, c1.y.sub(c1.x)).mul(f1);
  // Quilting: tack points on the grid and stitched seams along the gores.
  const gu = abs(fract(st.x.div(gore).add(0.5)).sub(0.5)).mul(gore);
  const qv = abs(fract(st.y.div(quilt).add(0.5)).sub(0.5)).mul(quilt);
  const seam = band(gu, 0.012, fpU).toVar();
  const stitch = seam.mul(smoothstep(0.35, 0.65, sin(st.y.mul(260)).mul(0.5).add(0.5)).mul(lodFade(fpU, 0.006)).add(float(1).sub(lodFade(fpU, 0.006)).mul(0.5)));
  const tack = band(length(vec2(abs(fract(st.x.div(quilt).add(0.5)).sub(0.5)).mul(quilt), qv)), 0.02, fpU);
  // The blanket puffs between tacks: a pillow slope toward each tack.
  const pillow = vec3(sin(st.x.div(quilt).mul(6.2832)), sin(st.y.div(quilt).mul(6.2832)), 0).mul(0.035).mul(lodFade(fpU, 0.1));
  const t = r1.mul(0.14).mul(f1).add(r2.mul(0.07).mul(f2)).add(vec3(pillow.x, pillow.y, pillow.x.negate()));
  mat.normalNode = transformNormalToView(tilt(n, t));
  const tone = float(0.93).add(r1.x.mul(0.1).mul(f1)).add(r2.y.mul(0.06).mul(f2));
  mat.colorNode = mix(FOIL_F0.mul(tone).mul(float(1).add(crease.mul(0.25))), vec3(0.42, 0.3, 0.16), max(stitch.mul(0.7), tack.mul(0.4)));
  // Facet slope lost to the footprint becomes roughness (the blanket's average sheen at range).
  const lost = float(1).sub(f1).mul(0.12).add(float(1).sub(f2).mul(0.05));
  mat.roughnessNode = clamp(float(0.3).add(abs(r2.z).mul(0.14)).add(lost).add(seam.mul(0.2)), 0.2, 0.75);
  mat.metalnessNode = float(1);
  return mat;
}
