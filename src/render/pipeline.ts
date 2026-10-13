/**
 * Final-image pipeline. One owner per signal, in this order:
 *
 *   scene pass (MRT: HDR colour, view normal, velocity; reversed depth)
 *     → GTAO (half resolution) applied to geometry only
 *     → aerial perspective on geometry (same atmosphere model as the sky)
 *     → TRAA (sky pixels carry rotation-only velocity)
 *     → eye: veiling glare from the eye's point-spread function (render/glare.ts) — the star's share
 *       analytic, every other source spread in screen space — then exposure × white balance
 *     → filmic tone map (once) → grade → grain → sRGB OETF → dither
 *
 * Exposure is the fixed camera exposure (render/exposure.ts). Debug views short-circuit the
 * chain at named stages (?view=...).
 */
import { RenderPipeline, type PerspectiveCamera, type Scene, type WebGPURenderer, type DataTexture } from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, screenUV, vec2, vec3, vec4, float, Fn, If, uniform, texture,
  getViewPosition, length, normalize, mix, max, pow, smoothstep, sRGBTransferOETF, agxToneMapping,
  acesFilmicToneMapping, neutralToneMapping, luminance, clamp, screenCoordinate, fract, sin, acos,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { aerialLutUV, type AtmosphereTextures } from '../atmosphere/luts';
import { hash12 } from './tsl/noise';
import { STAR_ANGULAR_RADIUS } from '../world/constants';
import { STAR_CENTER_RADIANCE } from '../world/radiometry';
import { hueFilmic } from './tsl/toneMap';
import { GLARE_CORE_FRACTION, screenGlareLobes } from './glare';

const STAR_COS_ALPHA = Math.cos(STAR_ANGULAR_RADIUS);

type TexNode = Node<'vec4'> & { sample(uv: Node<'vec2'>): Node<'vec4'>; value: import('three/webgpu').Texture };

export type DebugView = 'final' | 'hdr' | 'ao' | 'normal' | 'depth' | 'velocity' | 'aerial' | 'nopost' | 'distance' | 'glare';

export interface CameraSettings {
  /** Linear exposure multiplier (fixed camera exposure, render/exposure.ts). */
  exposure: Node<'float'>;
  /** Camera white balance: per-channel gains with unit luminance. */
  whiteBalance: Node<'vec3'>;
  saturation: Node<'float'>;
  contrast: Node<'float'>;
  grain: Node<'float'>;
}

export interface Pipeline {
  readonly pipeline: RenderPipeline;
  readonly camera: CameraSettings;
  render(): void;
}

export type ToneMapper = 'film' | 'agx' | 'aces' | 'neutral';

export function createPipeline(renderer: WebGPURenderer, scene: Scene, cam: PerspectiveCamera, atmo: AtmosphereTextures, opts: { view: DebugView; toneMapper: ToneMapper; ao: boolean; illuminant: Node<'vec3'> }): Pipeline {
  const scenePass = pass(scene, cam);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
  const colorTex = scenePass.getTextureNode('output');
  const normalTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const velocityTex = scenePass.getTextureNode('velocity');

  // --- GTAO -----------------------------------------------------------------------------------
  const normalSampler = sample((uv: Node<'vec2'>) => unpackRGBToNormal(normalTex.sample(uv)));
  const aoPass = ao(depthTex, normalSampler, cam);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 0.8;
  aoPass.thickness.value = 1.0;
  aoPass.distanceExponent.value = 1.6;
  aoPass.scale.value = 1.6;
  aoPass.samples.value = 16;
  aoPass.useTemporalFiltering = true;
  const aoTex = aoPass.getTextureNode();

  // Post passes render a fullscreen quad with its own camera, so the scene camera's matrices must be
  // bound explicitly (these reference the live matrices, including TRAA's jitter while it is applied).
  const projInv = uniform(cam.projectionMatrixInverse);
  const camWorld = uniform(cam.matrixWorld);

  // --- Camera response ------------------------------------------------------------------------
  const settings: CameraSettings = {
    exposure: uniform(0.14) as unknown as Node<'float'>,
    whiteBalance: uniform(vec3(1.0, 1.0, 1.0)) as unknown as Node<'vec3'>,
    saturation: uniform(1.08) as unknown as Node<'float'>,
    contrast: uniform(1.0) as unknown as Node<'float'>,
    grain: uniform(0.012) as unknown as Node<'float'>,
  };

  const taaEncode = (c: Node<'vec3'>) => {
    const e = c.mul(settings.exposure);
    return e.div(luminance(e).add(1.0));
  };
  const taaDecode = (e: Node<'vec3'>) => e.div(float(1).sub(luminance(e)).max(1e-3)).div(settings.exposure);

  // --- AO + aerial perspective on geometry -----------------------------------------------------
  const apS = atmo.aerialS as DataTexture;
  const apT = atmo.aerialT as DataTexture;
  const aoStrength = uniform(opts.ao ? 1.0 : 0.0);
  const lit = Fn(() => {
    const uv = screenUV;
    const c = colorTex.sample(uv).toVar();
    const d = depthTex.sample(uv).r;
    const outc = c.rgb.toVar();
    // Reversed depth: 0 = cleared (sky).
    If(d.greaterThan(0.0), () => {
      const vp = getViewPosition(uv, d, projInv);
      const dist = length(vp);
      const dirW = normalize(camWorld.mul(vec4(normalize(vp), 0.0)).xyz);
      // Contact occlusion only: beyond a few tens of metres a pixel spans more than the AO radius.
      const aoFade = float(1).sub(smoothstep(25.0, 60.0, dist));
      const occlusion = mix(float(1), aoTex.sample(uv).r, aoStrength.mul(aoFade));
      const apUV = aerialLutUV(dirW.y, dist);
      const S = texture(apS, apUV).rgb.mul(opts.illuminant);
      const T = texture(apT, apUV).rgb;
      outc.assign(c.rgb.mul(occlusion).mul(T).add(S));
    });
    return vec4(taaEncode(outc), 1.0);
  })();

  // --- Temporal AA ----------------------------------------------------------------------------
  // TAA resolves in a compressed space (x/(1+x) of exposed luminance) and the result is expanded
  // again, so the few sub-pixel highlights that remain (glints, the star seen in tilted tiles) do
  // not dominate the history blend. Nothing on the structure emits above the star's radiance
  // (tests/thermal.test.ts): sub-pixel super-white lines flickered under camera motion, when
  // TRAA tightens its variance clip, and their glare pumped with them.
  const aaPass = traa(lit, depthTex, velocityTex, cam);
  const hdrTex = (aaPass as unknown as { getTextureNode(): TexNode }).getTextureNode();
  const hdr = { sample: (uv: Node<'vec2'>) => vec4(taaDecode(hdrTex.sample(uv).rgb), 1.0), get rgb() { return taaDecode(hdrTex.rgb); } };

  // --- The eye's glare ------------------------------------------------------------------------
  // Light scattered inside the eye spreads a fixed fraction of every source over the field
  // (render/glare.ts). The star's share is exact: a table against the angle from its centre, which
  // also covers the part of the disc outside the frame. Everything else (lit metal, glints, the
  // pad) is spread by three Gaussians matched to the PSF's annuli; their σ is in degrees, so the
  // blur resolution follows the current pixels per degree.
  const viewDirAt = (uv: Node<'vec2'>) => normalize(camWorld.mul(vec4(normalize(getViewPosition(uv, float(1.0), projInv)), 0.0)).xyz);
  const nonStar = Fn(() => {
    const vd = viewDirAt(screenUV);
    const offDisc = float(1).sub(smoothstep(STAR_COS_ALPHA - 1e-4, STAR_COS_ALPHA + 1e-4, vd.y));
    return vec4(hdr.sample(screenUV).rgb.mul(offDisc), 1.0);
  })();
  type BlurNode = Node<'vec4'> & { resolutionScale: number };
  const blur = gaussianBlur as unknown as (n: Node, dir: number, sigma: number, o: { resolutionScale: number }) => BlurNode;
  const lobes = screenGlareLobes();
  // Kernel σ in texels for a blur node of parameter p is (3 + 2p)/3.
  const lobeBlurs = lobes.map((l, i) => {
    const p = i === 0 ? 2 : 4;
    return { lobe: l, sigmaTexels: (3 + 2 * p) / 3, node: blur(nonStar, 1.0, p, { resolutionScale: 0.25 }) };
  });
  const starGlareTex = texture(atmo.starGlare);
  const starCentre = vec3(...STAR_CENTER_RADIANCE).mul(opts.illuminant);

  const camera = Fn(() => {
    const uv = screenUV;
    const scene = hdr.sample(uv).rgb;
    const viewDir = viewDirAt(uv);
    const theta = acos(clamp(viewDir.y, -1.0, 1.0)).div(Math.PI);
    const starGlare = starGlareTex.sample(vec2(theta, 0.5)).rgb.mul(starCentre);
    let otherGlare: Node<'vec3'> = vec3(0);
    for (const b of lobeBlurs) otherGlare = otherGlare.add(b.node.rgb.mul(b.lobe.weight));
    const withGlare = scene.mul(GLARE_CORE_FRACTION).add(starGlare).add(otherGlare);
    const exposed = withGlare.mul(settings.exposure).mul(settings.whiteBalance);
    const mapped = toneMap(opts.toneMapper, exposed);
    // Grade in display-linear: contrast about mid-grey (in log-ish space) and saturation.
    const lum = luminance(mapped);
    const graded0 = mix(vec3(lum), mapped, settings.saturation);
    const pivot = float(0.18);
    const graded = pow(max(graded0, vec3(1e-6)).div(pivot), vec3(settings.contrast)).mul(pivot).min(vec3(1.0));
    // Fine luminance-weighted grain.
    const n = hash12(screenCoordinate.xy.add(fract(sin(uniformTime.mul(12.9898)).mul(437.585)).mul(1000))).sub(0.5);
    const grained = graded.add(graded.mul(n).mul(settings.grain).mul(2));
    const encoded = oetf(clamp(grained, 0, 1));
    // Triangular-ish dither to hide 8-bit banding in the sky gradients.
    const dn = hash12(screenCoordinate.xy.mul(1.37).add(17.0)).add(hash12(screenCoordinate.xy.mul(0.91).add(3.0))).sub(1.0);
    return vec4(encoded.add(dn.div(255)), 1.0);
  })();

  // --- Debug views ----------------------------------------------------------------------------
  let outputNode: Node<'vec4'> = camera as unknown as Node<'vec4'>;
  switch (opts.view) {
    case 'hdr':
      outputNode = vec4(oetf(clamp(hdr.rgb.mul(settings.exposure), 0, 1)), 1) as unknown as Node<'vec4'>;
      break;
    case 'ao':
      outputNode = vec4(vec3(aoTex.sample(screenUV).r), 1) as unknown as Node<'vec4'>;
      break;
    case 'normal':
      outputNode = vec4(normalTex.sample(screenUV).rgb, 1) as unknown as Node<'vec4'>;
      break;
    case 'depth':
      outputNode = vec4(vec3(pow(depthTex.sample(screenUV).r, 0.25)), 1) as unknown as Node<'vec4'>;
      break;
    case 'velocity':
      outputNode = vec4(velocityTex.sample(screenUV).xy.mul(40).add(0.5), 0.5, 1) as unknown as Node<'vec4'>;
      break;
    case 'aerial':
      outputNode = vec4(oetf(clamp(lit.rgb.mul(settings.exposure), 0, 1)), 1) as unknown as Node<'vec4'>;
      break;
    case 'distance':
      outputNode = Fn(() => {
        const d = depthTex.sample(screenUV).r;
        const vp = getViewPosition(screenUV, d, projInv);
        return vec4(vec3(length(vp).div(1000).fract()), 1);
      })() as unknown as Node<'vec4'>;
      break;
    case 'glare':
      outputNode = Fn(() => {
        const vd = viewDirAt(screenUV);
        const g = starGlareTex.sample(vec2(acos(clamp(vd.y, -1.0, 1.0)).div(Math.PI), 0.5)).rgb.mul(starCentre);
        return vec4(oetf(clamp(g.mul(settings.exposure).mul(4), 0, 1)), 1);
      })() as unknown as Node<'vec4'>;
      break;
    case 'nopost':
      outputNode = vec4(oetf(toneMap(opts.toneMapper, colorTex.sample(screenUV).rgb.mul(settings.exposure).mul(settings.whiteBalance))), 1) as unknown as Node<'vec4'>;
      break;
    default:
      break;
  }

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = outputNode;

  return {
    pipeline,
    camera: settings,
    render: () => {
      // Glare blurs are specified in degrees: follow the current pixels per degree.
      const pxPerDeg = renderer.domElement.height / cam.fov;
      for (const b of lobeBlurs) b.node.resolutionScale = Math.min(1, b.sigmaTexels / (b.lobe.sigmaDeg * pxPerDeg));
      pipeline.render();
    },
  };
}

const uniformTime = uniform(0);

const oetf = (c: Node<'vec3'>): Node<'vec3'> => sRGBTransferOETF(c) as unknown as Node<'vec3'>;

function toneMap(kind: ToneMapper, c: Node<'vec3'>): Node<'vec3'> {
  if (kind === 'film') return hueFilmic(c) as unknown as Node<'vec3'>;
  const fn = (kind === 'aces' ? acesFilmicToneMapping : kind === 'neutral' ? neutralToneMapping : agxToneMapping) as unknown as (c: Node<'vec3'>, e: Node<'float'>) => Node<'vec3'>;
  return fn(c, float(1));
}
export function setPipelineTime(t: number): void {
  uniformTime.value = t;
}

