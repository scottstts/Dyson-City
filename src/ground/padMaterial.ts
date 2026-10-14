/**
 * Honed pale limestone paving for the Garden Deck platform, sealed, with flush bronze survey inlays.
 *
 * The sealer is a thin clear coat over the honed stone: a dielectric film whose own reflection is
 * sharp, while the stone beneath stays matte. Under a 90° star and a bright shell, that is what
 * makes a real plaza read — a sheen of the sky toward the horizon, broken slab by slab where the
 * seal is worn — rather than a flat albedo.
 *
 * Layout: 1.2 × 0.6 m slabs in running bond along the Spinward (E–W) axis, framed every 24 m by
 * 0.3 m border courses of a darker stone, so the 1 km plane carries a legible perspective grid at
 * every distance; risers are single 0.4 m courses. Slabs sit with sub-millimetre lippage (a tiny
 * random tilt), which is what breaks a honed surface's sheen into individual stones. Each slab carries its own tone, roughness and vein orientation; near detail
 * (pores, aggregate, arris highlights) fades by pixel footprint. Inlays are material changes on a
 * single surface, never stacked geometry.
 */
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  float, vec2, vec3, positionWorld, normalWorldGeometry, normalViewGeometry, fwidth, length, max, min, abs, fract, atan, sin, cos, select, smoothstep, mix, normalize, transformNormalToView, PI,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, valueNoise3, fbm3, cellular3 } from '../render/tsl/noise';
import { band, runningBond, lodFade } from '../render/tsl/patterns';
import { SITE } from './site';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

const STONE = vec3(0.63, 0.61, 0.57);
/** Border courses: a darker, warmer limestone laid every 24 m on both axes. */
const COURSE = vec3(0.4, 0.37, 0.32);
const COURSE_PERIOD = 24;
const COURSE_HALF_WIDTH = 0.15;
const BRONZE = vec3(0.86, 0.69, 0.47);

/** Bronze survey inlay coverage on the platform top (0..1). */
function surveyInlays(p: V2, fp: F): F {
  const r = length(p);
  const onPlatform = smoothstep(SITE.boundaryInlayRadius + 0.5, SITE.boundaryInlayRadius - 0.5, r);
  const outsideDatum = smoothstep(3.05, 3.15, r);
  const hwAxis = SITE.axisInlayWidth / 2;
  let m: F = max(band(p.y, hwAxis, fp), band(p.x, hwAxis, fp)).mul(outsideDatum).mul(onPlatform);
  // Ticks every 10 m (short) and 100 m (long) along both axes.
  const tick = (along: F, across: F) => {
    const d10 = abs(fract(along.div(10).add(0.5)).sub(0.5)).mul(10);
    const d100 = abs(fract(along.div(100).add(0.5)).sub(0.5)).mul(100);
    const small = band(d10, 0.04, fp).mul(smoothstep(0.47, 0.43, abs(across)));
    const large = band(d100, 0.07, fp).mul(smoothstep(1.02, 0.96, abs(across)));
    return max(small, large).mul(outsideDatum).mul(onPlatform);
  };
  m = max(m, max(tick(p.x, p.y), tick(p.y, p.x)));
  // Boundary ring marking the platform's built edge.
  m = max(m, band(r.sub(SITE.boundaryInlayRadius), SITE.boundaryInlayWidth / 2, fp));
  // Datum: two rings and an eight-point rose.
  m = max(m, band(r.sub(3.0), 0.075, fp));
  m = max(m, band(r.sub(1.25), 0.04, fp));
  const ang = atan(p.y, p.x);
  const sector = abs(fract(ang.div(PI.div(4)).add(0.5)).sub(0.5)).mul(PI.div(4)).mul(r);
  const roseLen = select(fract(ang.div(PI.div(4)).mul(0.5).add(0.25)).lessThan(0.5), float(3.0), float(2.1));
  m = max(m, band(sector, 0.018, fp).mul(smoothstep(0.2, 0.3, r)).mul(smoothstep(roseLen, roseLen.sub(0.06), r)));
  m = max(m, smoothstep(0.16, 0.14, r));
  return m;
}

/** Bronze inlay on the West Gate's apron: the Spinward axis carried out from the threshold, ticked. */
function apronInlays(p: V2, fp: F): F {
  const hwAxis = SITE.axisInlayWidth / 2;
  const along = p.x;
  const d10 = abs(fract(along.div(10).add(0.5)).sub(0.5)).mul(10);
  const tick = band(d10, 0.04, fp).mul(smoothstep(0.47, 0.43, abs(p.y)));
  return max(band(p.y, hwAxis, fp), tick);
}

export interface PadMaterialOptions {
  /** 'platform': the survey inlays of the Garden Deck; 'axis': the Spinward axis only (the apron). */
  inlays?: 'platform' | 'axis';
}

export function createPadMaterial(opts: PadMaterialOptions = {}): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = opts.inlays === 'axis' ? 'WestGate.apron' : 'GardenDeck.stone';

  const wp = positionWorld;
  const geoN = normalWorldGeometry;
  const isTop = geoN.y.greaterThan(0.7);
  const r = length(wp.xz);
  // Planar coordinates: xz on horizontal faces; (arc length, height) on risers.
  const p = select(isTop, wp.xz, vec2(atan(wp.z, wp.x).mul(r), wp.y)).toVar();
  const fp = max(length(fwidth(p)), 1e-5).toVar();

  const slabSize = select(isTop, vec2(1.2, 0.6), vec2(1.2, SITE.stepRise));
  const slab = runningBond(select(isTop, p, vec2(p.x, p.y.add(0.0))), slabSize);
  const sid = vec3(slab.id, select(isTop, float(1), float(2)));
  // Per-slab identity fades to the mean once a pixel covers several slabs (no far-field shimmer).
  const slabFade = lodFade(fp, 0.45);
  const h = mix(vec3(0.5), hash33(sid), slabFade).toVar();

  // Stone body: tone per slab, gentle large-scale variation, veins, pores, aggregate.
  const veinAngle = h.z.mul(PI);
  const veinDir = vec2(cos(veinAngle), sin(veinAngle));
  const warp = fbm3(vec3(p.mul(0.9), h.x.mul(19)), 3, fp.mul(0.9));
  // Thin veins with a per-slab phase, so they never run continuously across joints.
  const vein = smoothstep(0.965, 0.995, sin(p.x.mul(veinDir.x).add(p.y.mul(veinDir.y)).mul(5.3).add(warp.mul(7)).add(h.y.mul(40))).abs()).mul(lodFade(fp, 0.01)).mul(h.x.greaterThan(0.45).select(float(1), float(0)));
  const pores = cellular3(vec3(p.mul(vec2(26, 40)), h.y.mul(7)), float(0), float(0));
  const pore = smoothstep(0.16, 0.06, pores.x).mul(select(pores.z.lessThan(0.22), float(1), float(0))).mul(lodFade(fp, 0.012));
  const grain = valueNoise3(vec3(p.mul(140), 3)).sub(0.5).mul(lodFade(fp, 0.008));
  // Fine mottling of the limestone body (5–20 cm clouds).
  const mottle = fbm3(vec3(p.mul(9), h.z.mul(13)), 3, fp.mul(9)).sub(0.5).mul(lodFade(fp, 0.05));
  const broad = fbm3(vec3(p.mul(1 / 45), 5), 3, fp.mul(1 / 45));
  const dust = fbm3(vec3(p.mul(1 / 7), 9), 3, fp.mul(1 / 7));
  const tone = float(0.95).add(h.x.mul(0.07)).add(mottle.mul(0.09)).add(broad.sub(0.5).mul(0.1)).add(grain.mul(0.06)).sub(vein.mul(0.05)).sub(pore.mul(0.22)).sub(dust.sub(0.5).mul(0.05));
  const hue = vec3(1.0, 1.0, 1.0).add(vec3(0.0, -0.01, -0.035).mul(h.y.sub(0.5).mul(2)));
  const stoneColor = STONE.mul(hue).mul(tone);
  const stoneRough = float(0.42).add(h.y.mul(0.1)).add(pore.mul(0.25)).add(grain.mul(0.05)).add(dust.sub(0.5).mul(0.12));

  // Joints: 6 mm, recessed and dust-filled, with a 2 mm arris catching light at close range.
  const joint = band(slab.dist, 0.003, fp).toVar();
  const arrisZone = float(1).sub(smoothstep(0.002, 0.006, slab.dist)).mul(lodFade(fp, 0.004));
  const half = slabSize.mul(0.5);
  const towardX = select(slab.local.x.lessThan(half.x), float(-1), float(1));
  const towardY = select(slab.local.y.lessThan(half.y), float(-1), float(1));
  const dxEdge = min(slab.local.x, slabSize.x.sub(slab.local.x));
  const dyEdge = min(slab.local.y, slabSize.y.sub(slab.local.y));
  const lippage = vec2(h.x.sub(0.5), h.z.sub(0.5)).mul(0.005);
  const tilt2 = select(dxEdge.lessThan(dyEdge), vec2(towardX, 0), vec2(0, towardY)).mul(arrisZone).mul(0.55).add(lippage);

  // Inlays on the platform top only.
  const inlay = (opts.inlays === 'axis' ? select(isTop, apronInlays(wp.xz, fp), float(0)) : select(isTop.and(r.lessThan(SITE.padRadius - 0.05)), surveyInlays(wp.xz, fp), float(0))).toVar();

  // Border courses on the platform top (not inside the datum).
  // Courses sit half a bay off the survey axes so they never run under the bronze inlays.
  const coursePos = fract(wp.xz.div(COURSE_PERIOD)).sub(0.5).mul(COURSE_PERIOD);
  const course = select(isTop, max(band(coursePos.x, COURSE_HALF_WIDTH, fp), band(coursePos.y, COURSE_HALF_WIDTH, fp)), float(0)).mul(float(1).sub(inlay)).toVar();
  const courseColor = COURSE.mul(float(0.9).add(h.y.mul(0.15)));
  const stoneWithCourse = mix(stoneColor, courseColor, course);
  const color = mix(stoneWithCourse.mul(float(1).sub(joint.mul(0.65))), BRONZE.mul(float(0.92).add(h.x.mul(0.08))), inlay);
  mat.colorNode = color;
  mat.roughnessNode = mix(mix(mix(stoneRough, float(0.36), course), float(0.92), joint), float(0.55).add(grain.abs().mul(0.2)), inlay);
  mat.metalnessNode = inlay;
  // Sealer: a clear coat, intact on most slabs and worn on some; none in the joints or on bronze.
  const wear = smoothstep(0.55, 0.95, h.z).mul(0.6).add(dust.sub(0.5).mul(0.3)).clamp(0, 1);
  mat.clearcoatNode = float(0.9).sub(wear.mul(0.6)).mul(float(1).sub(joint)).mul(float(1).sub(inlay)).mul(select(isTop, float(1), float(0.7)));
  mat.clearcoatRoughnessNode = float(0.07).add(h.x.mul(0.06)).add(wear.mul(0.18)).add(grain.abs().mul(0.05));

  // Perturb the normal (world space) on horizontal faces; risers keep their geometric normal.
  const perturb = select(isTop, vec3(tilt2.x, 0, tilt2.y), vec3(0));
  const nWorld = normalize(geoN.add(perturb));
  mat.normalNode = select(isTop, transformNormalToView(nWorld), normalViewGeometry);
  // The seal follows each slab's lippage, so the sky's reflection breaks slab by slab.
  mat.clearcoatNormalNode = mat.normalNode;
  return mat;
}
