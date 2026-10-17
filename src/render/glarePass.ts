/**
 * Screen-space side of the glare (render/glare.ts): the eye's scatter and the camera's bloom
 * applied to the HDR image before exposure.
 *
 *  - The star's share of both is exact: a table against the angle from its centre, which also
 *    covers the part of the disc outside the frame.
 *  - Everything else is spread by chained Gaussian blurs: the eye's three lobes from the image, the
 *    camera's four from the image's excess over the bloom threshold. σ is in degrees, so each
 *    stage's resolution follows the current pixels per degree.
 *
 * What the glare adds, the sources lose. Over the disc, the bloom's loss is taken from the smooth
 * limb-darkened disc rather than from each pixel, so the surface keeps its texture's amplitude.
 *
 * Halation. Even far past saturation, energy-conserving glare cannot hide the limb: just outside
 * it at most half the kernel sees the (limb-darkened) disc, so the glare there tops out near 20 % of
 * the disc and the clipped disc keeps a hard white outline. What erases the outline of a
 * photographed sun is the sensor's response to saturation — halation and blooming spill the clipped
 * white past it. Applied after the tone curve, as a sensor would: the disc dissolves into a white
 * blaze with no edge you can point to, fading over a few degrees into the structure around it.
 * It is a spread in the image plane of the clipped disc that falls on the sensor (the visible disc's
 * pixels, blurred): with the star out of frame there is none. Keyed to the angle from the star
 * instead, its tail laid a white veil over the whole frame looking level, after the tone curve,
 * and every dark in the estate read as overcast grey.
 */
import { Fn, vec2, vec3, vec4, float, max, sqrt, pow, clamp, acos, smoothstep, texture, luminance, screenUV, rtt } from 'three/tsl';
import type { DataTexture, Node } from 'three/webgpu';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { STAR_ANGULAR_RADIUS } from '../world/constants';
import { LIMB_DARKENING_EXPONENT, STAR_CENTER_RADIANCE, STAR_DISC_MEAN_RADIANCE, luminance as lum3 } from '../world/radiometry';
import { BLOOM_THRESHOLD, CAMERA_BLOOM, CAMERA_BLOOM_SHARE, GLARE_CORE_FRACTION, screenGlareLobes, type GlareLobe } from './glare';

type V3 = Node<'vec3'>;
type BlurNode = Node<'vec4'> & { resolutionScale: number; getTextureNode(): Node };

const STAR_COS_ALPHA = Math.cos(STAR_ANGULAR_RADIUS);
const STAR_SIN_ALPHA = Math.sin(STAR_ANGULAR_RADIUS);

/** Resolution of the glare sources relative to the drawing buffer. */
const SOURCE_SCALE = 0.5;
const EXCESS_SCALE = 0.25;

const blur = gaussianBlur as unknown as (n: Node, dir: number, sigma: number, o: { resolutionScale: number }) => BlurNode;

interface Stage {
  lobe: GlareLobe;
  stepSigmaDeg: number;
  sigmaTexels: number;
  node: BlurNode;
}

/**
 * A chain of blurs, one per lobe: each blurs the previous one by the σ still missing (σ adds in
 * quadrature), so every stage downsamples an input that is already smooth at its own texel size.
 * Blurring the sharp image straight to a few texels across would alias small bright sources into
 * flicker. Kernel σ in texels for a blur node of parameter p is (3 + 2p)/3.
 */
function blurChain(input: Node<'vec4'>, lobes: readonly GlareLobe[]): Stage[] {
  const stages: Stage[] = [];
  lobes.forEach((lobe, i) => {
    const p = i === 0 ? 2 : 4;
    const prev = stages[i - 1];
    const stepSigmaDeg = prev ? Math.sqrt(lobe.sigmaDeg ** 2 - prev.lobe.sigmaDeg ** 2) : lobe.sigmaDeg;
    const src = prev ? prev.node.getTextureNode() : input;
    stages.push({ lobe, stepSigmaDeg, sigmaTexels: (3 + 2 * p) / 3, node: blur(src, 1.0, p, { resolutionScale: 0.25 }) });
  });
  return stages;
}

function sizeChain(stages: Stage[], pxPerDeg: number): void {
  let inputPxPerDeg = pxPerDeg;
  for (const s of stages) {
    s.node.resolutionScale = Math.min(1, s.sigmaTexels / (s.stepSigmaDeg * inputPxPerDeg));
    inputPxPerDeg *= s.node.resolutionScale;
  }
}

function weightedSum(stages: Stage[]): V3 {
  let sum: V3 = vec3(0);
  for (const s of stages) sum = sum.add(s.node.rgb.mul(s.lobe.weight)) as unknown as V3;
  return sum;
}

/**
 * Halation of the clipped disc (display units, screen-blended): the visible disc blurred in the image
 * plane by two Gaussians (σ in degrees, gain on the blurred mask). Just outside a long limb a lobe
 * reads half its gain, so the spill holds full white at the limb, ~0.3 five degrees out and a faint
 * tail over ~20°, in the star's warm white: the disc has no locatable edge.
 */
export const HALATION = { near: { sigmaDeg: 4.5, gain: 1.94 }, far: { sigmaDeg: 15, gain: 0.9 }, tint: [1.0, 0.95, 0.86] as const };

export interface GlarePass {
  /** The image with glare, given its HDR value at a pixel and its world view direction. */
  /** `sky` is 1 where the pixel shows the sky (nothing opaque in front), 0 on geometry. */
  apply(scene: V3, viewDir: V3, sky: Node<'float'>): V3;
  /** Halation of the clipped disc at this pixel (display units, 0..1; 1 over the disc). */
  halation(): Node<'float'>;
  /** The star's analytic share alone (debug view). */
  starShare(viewDir: V3): V3;
  /** The added light by origin (debug view `veil`): the star's analytic share, the eye's scatter and the camera's bloom of the image. */
  parts(viewDir: V3): { star: V3; eye: V3; camera: V3 };
  /** Call once per frame before rendering. */
  resize(pxPerDeg: number): void;
}

export function createGlarePass(opts: {
  /** HDR scene radiance at a screen UV. */
  hdr: (uv: Node<'vec2'>) => V3;
  /** World view direction at a screen UV. */
  viewDirAt: (uv: Node<'vec2'>) => V3;
  starGlare: DataTexture;
  illuminant: V3;
  /** 1 where the pixel at a screen UV shows the sky, 0 on geometry. */
  skyAt: (uv: Node<'vec2'>) => Node<'float'>;
  /**
   * Share of the star's disc the eye can see (1 in the open, a little less under the Dome's frame,
   * 0 under a roof): scales the star's analytic glare. (The halation follows the disc's pixels.)
   */
  starVisibility: Node<'float'>;
  /**
   * Transmission of glass in front of the star (the Dome's tint): scales its glare, not the
   * halation, which is the sensor's response to the still-clipped disc.
   */
  starTransmission: Node<'float'>;
}): GlarePass {
  const { hdr, viewDirAt, illuminant, skyAt, starVisibility, starTransmission } = opts;
  const threshold = float(BLOOM_THRESHOLD * lum3(...STAR_DISC_MEAN_RADIANCE)).mul(luminance(illuminant));
  const excess = (c: V3): V3 => c.mul(max(float(1).sub(threshold.div(max(luminance(c), 1e-6))), 0.0)) as unknown as V3;

  const offDisc = (vd: V3) => float(1).sub(smoothstep(STAR_COS_ALPHA - 1e-4, STAR_COS_ALPHA + 1e-4, vd.y));
  // The blurred sources start at reduced resolution: every lobe is wider than a few full-res
  // pixels. A bilinear tap at the centre of a half-res texel is an exact 2×2 box filter, so nothing
  // aliases; the bloom's input is derived from that at quarter resolution. (Two full-resolution
  // masked inputs and the first stages reading them cost ~2.5 ms at 1080p.)
  // Only sky pixels on the disc are the analytic star's; geometry in that direction (a vault, a
  // frame member, a lamp) is an ordinary source.
  const source = rtt(Fn(() => vec4(hdr(screenUV).mul(float(1).sub(float(1).sub(offDisc(viewDirAt(screenUV))).mul(skyAt(screenUV)))), 1.0))(), null, null, { resolutionScale: SOURCE_SCALE });
  // The clipped disc on the sensor (sky pixels on the disc), for its halation.
  const discMask = rtt(Fn(() => vec4(vec3(float(1).sub(offDisc(viewDirAt(screenUV))).mul(skyAt(screenUV))), 1.0))(), null, null, { resolutionScale: EXCESS_SCALE });
  const sourceExcess = rtt(Fn(() => vec4(excess(source.sample(screenUV).rgb as unknown as V3), 1.0))(), null, null, { resolutionScale: EXCESS_SCALE });

  const eye = blurChain(source as unknown as Node<'vec4'>, screenGlareLobes());
  const camera = blurChain(sourceExcess as unknown as Node<'vec4'>, CAMERA_BLOOM);
  const halo = blurChain(discMask as unknown as Node<'vec4'>, [
    { sigmaDeg: HALATION.near.sigmaDeg, weight: HALATION.near.gain },
    { sigmaDeg: HALATION.far.sigmaDeg, weight: HALATION.far.gain },
  ]);

  const starTex = texture(opts.starGlare);
  const starCentre = vec3(...STAR_CENTER_RADIANCE).mul(illuminant);
  const starShare = (vd: V3): V3 => starTex.sample(vec2(acos(clamp(vd.y, -1.0, 1.0)).div(Math.PI), 0.5)).rgb.mul(starCentre).mul(starVisibility).mul(starTransmission) as unknown as V3;

  return {
    apply(scene, vd, sky) {
      // The smooth limb-darkened disc in this direction (zero off the disc).
      const sinPsi = sqrt(max(float(1).sub(vd.y.mul(vd.y)), 0.0));
      const mu = sqrt(max(float(1).sub(sinPsi.div(STAR_SIN_ALPHA).pow(2)), 0.0));
      // The disc as it arrives (through the Dome's tint, if any): the bloom's loss is taken from it.
      const disc = starCentre.mul(pow(vec3(mu), vec3(...LIMB_DARKENING_EXPONENT))).mul(starTransmission);
      const onDisc = float(1).sub(offDisc(vd)).mul(sky);
      const source = scene.mul(onDisc.oneMinus()).add(disc.mul(onDisc)) as unknown as V3;
      const kept = scene.mul(GLARE_CORE_FRACTION).sub(excess(source).mul(CAMERA_BLOOM_SHARE)).max(0.0);
      return kept.add(starShare(vd)).add(weightedSum(eye)).add(weightedSum(camera)) as unknown as V3;
    },
    starShare,
    parts: (vd) => ({ star: starShare(vd), eye: weightedSum(eye), camera: weightedSum(camera) }),
    halation() {
      return luminance(weightedSum(halo)).min(1.0) as unknown as Node<'float'>;
    },
    resize(pxPerDeg) {
      sizeChain(eye, pxPerDeg * SOURCE_SCALE);
      sizeChain(camera, pxPerDeg * EXCESS_SCALE);
      sizeChain(halo, pxPerDeg * EXCESS_SCALE);
    },
  };
}
