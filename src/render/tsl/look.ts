/**
 * The compositing look, applied to exposed scene radiance before the tone curve (as a film look
 * sits before the display transform), inside the final camera pass: no extra passes.
 *
 *  - Lens vignette: the natural cos⁴ falloff of light toward the field's edge, of which a corrected
 *    lens leaves only a small share. Physical in kind, so it narrows with the field of view (a
 *    telescope's narrow field shows none).
 *  - Black point (flare compensation, as a colourist sets blacks): the star's glare veil lifts the
 *    frame near it. The starry gaps beside the star exposed at ~0.11, under a stop below mid-grey,
 *    and nothing was black. A smooth floor is taken off each exposed channel and the rest rescaled
 *    about a bright pivot, so highlights (sunlit stone, the star) keep their place, darks go deep and
 *    mid-greys come down a little. Rescaling about mid-grey instead pushed highlights up nearly a
 *    stop. The floor is the veil the pixel actually carries (the star's analytic share, exposed),
 *    capped at BLACK_POINT.floor: a fixed floor everywhere took ~0.075 off views far from the star,
 *    where the veil is ~0.01, and crushed the estate's foliage, lawn and shaded walls (sunlit, but
 *    exposed 0.03–0.09) into flat grey-black. A grading choice, not physics: the scene's radiance
 *    is untouched, only the print's blacks are set.
 *  - High-contrast look (in the manner of Blender Filmic's "High Contrast"): an S-curve in log
 *    exposure about mid-grey, on luminance only (hue preserved). Darks deepen (the gaps, the air
 *    veil in front of them), midtones firm up; the gain eases above mid-grey because the tone
 *    curve's shoulder already compresses the highlights, and sunlit stone must keep its texture.
 */
import { Fn, float, vec3, max, dot, log2, exp2, smoothstep, mix, pow, clamp, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

const REC709 = vec3(0.2126, 0.7152, 0.0722);

/** Log-exposure gain below and above mid-grey, blended over ±BLEND stops about it. */
export const LOOK = { shadowGain: 1.35, highlightGain: 1.18, blend: 1.0 } as const;
/**
 * Black point in exposed luminance: the deepest veil floor taken off (beside the star), the softness
 * of its knee (blacks roll off rather than clip, so stars and nebulae survive) and the pivot the rest
 * is rescaled about.
 */
export const BLACK_POINT = { floor: 0.075, knee: 0.02, pivot: 0.45 } as const;
/** Share of the natural cos⁴ falloff left uncorrected: very light. */
export const VIGNETTE = 0.15;

function gainCpu(s: number): number {
  const t = Math.min(Math.max((s + LOOK.blend) / (2 * LOOK.blend), 0), 1);
  return LOOK.shadowGain + (LOOK.highlightGain - LOOK.shadowGain) * t * t * (3 - 2 * t);
}

/** Smooth max(L − floor, 0). */
function softFloor(L: number, floor: number): number {
  const { knee } = BLACK_POINT;
  return (L - floor + Math.sqrt((L - floor) ** 2 + knee * knee)) / 2;
}

/** The floor for a pixel carrying an exposed veil `veil` (the star's analytic share). */
export function blackFloorCpu(veil: number): number {
  return Math.min(Math.max(veil, 0), BLACK_POINT.floor);
}

/** Black point, rescaled so the pivot is unchanged. */
function blackPointCpu(L: number, floor: number): number {
  return (softFloor(L, floor) * BLACK_POINT.pivot) / softFloor(BLACK_POINT.pivot, floor);
}

/**
 * The look on a scalar luminance (scene-linear in and out) for a pixel carrying an exposed star
 * veil `veil` (default: the deepest, beside the star). Mirrored on the CPU for tests.
 */
export function lookCpu(L: number, veil: number = BLACK_POINT.floor): number {
  const s = Math.log2(Math.max(blackPointCpu(L, blackFloorCpu(veil)), 1e-10) / 0.18);
  return 0.18 * 2 ** (s * gainCpu(s));
}

/** Exposure falloff toward the field's edge; cosAxis is the cosine of the angle off the optical axis. */
export function vignetteCpu(cosAxis: number): number {
  return 1 - VIGNETTE * (1 - cosAxis ** 4);
}

/** The soft floor on a scalar (shader side of softFloor). */
const softFloorNode = (L: F, floor: F): F => L.sub(floor).add(sqrt(L.sub(floor).mul(L.sub(floor)).add(BLACK_POINT.knee * BLACK_POINT.knee))).mul(0.5) as F;

export const filmLook = Fn(([color, veil]: [V3, F]) => {
  // Black point per channel: flare is added light, so taking it off each channel gives back the
  // colour beneath it (a red nebula behind a neutral veil). On luminance alone it only darkened
  // the veiled mixture into grey. The floor is the pixel's own veil, capped.
  const floor = clamp(veil, 0.0, BLACK_POINT.floor) as F;
  const norm = float(BLACK_POINT.pivot).div(softFloorNode(float(BLACK_POINT.pivot) as F, floor));
  const x = max(color, vec3(0.0)).sub(floor);
  const c = x.add(sqrt(x.mul(x).add(BLACK_POINT.knee * BLACK_POINT.knee))).mul(norm.mul(0.5));
  // The contrast look on luminance (hue preserved).
  const L = max(dot(c, REC709), 1e-8);
  const s = log2(L.div(0.18));
  const g = mix(float(LOOK.shadowGain), float(LOOK.highlightGain), smoothstep(-LOOK.blend, LOOK.blend, s));
  const L2 = exp2(s.mul(g)).mul(0.18);
  return c.mul(L2.div(L));
}).setLayout({ name: 'dyFilmLook', type: 'vec3', inputs: [{ name: 'color', type: 'vec3' }, { name: 'veil', type: 'float' }] });

export function vignette(cosAxis: F): F {
  return float(1).sub(float(1).sub(pow(clamp(cosAxis, 0, 1), 4)).mul(VIGNETTE)) as unknown as F;
}
