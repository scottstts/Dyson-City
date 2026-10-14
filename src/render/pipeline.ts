/**
 * Final-image pipeline. One owner per signal, in this order:
 *
 *   scene pass (MRT: HDR colour, view normal, velocity; reversed depth)
 *     → GTAO (half resolution) applied to geometry only
 *     → aerial perspective on geometry (same atmosphere model as the sky); the star's atmosphere
 *       on the sky (sky/star/atmosphere.ts)
 *     → TRAA (sky pixels carry rotation-only velocity)
 *     → glare: the eye's scatter and the camera's bloom (render/glare.ts, glarePass.ts) — the star's
 *       share analytic, every other source spread in screen space — then exposure × white balance
 *     → lens vignette → film look: black point + high contrast (render/tsl/look.ts)
 *     → filmic tone map (once)
 *     → grade (saturation) → grain → sRGB OETF → dither
 *
 * Exposure is the fixed camera exposure (render/exposure.ts). Debug views short-circuit the
 * chain at named stages (?view=...).
 */
import { RenderPipeline, type PerspectiveCamera, type Scene, type WebGPURenderer, type DataTexture } from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, screenUV, vec3, vec4, float, Fn, If, uniform, texture,
  getViewPosition, length, normalize, mix, pow, dot, smoothstep, sRGBTransferOETF, agxToneMapping,
  acesFilmicToneMapping, neutralToneMapping, luminance, clamp, screenCoordinate, fract, sin, fwidth, exp, select,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { aerialLutUV, type AtmosphereTextures } from '../atmosphere/luts';
import { hash12 } from './tsl/noise';
import { hueFilmic } from './tsl/toneMap';
import { filmLook, vignette } from './tsl/look';
import { createGlarePass, HALATION } from './glarePass';

type TexNode = Node<'vec4'> & { sample(uv: Node<'vec2'>): Node<'vec4'>; value: import('three/webgpu').Texture };

export type DebugView = 'final' | 'hdr' | 'ao' | 'normal' | 'depth' | 'velocity' | 'aerial' | 'nopost' | 'distance' | 'glare';

export interface CameraSettings {
  /** Linear exposure multiplier (fixed camera exposure, render/exposure.ts). */
  exposure: Node<'float'>;
  /** Camera white balance: per-channel gains with unit luminance. */
  whiteBalance: Node<'vec3'>;
  saturation: Node<'float'>;
  grain: Node<'float'>;
  /** Eye adaptation: a multiplier on the exposure (1 outdoors; render/adaptation.ts). */
  adaptation: Node<'float'>;
  /** Share of the star's disc the eye sees (scales its analytic glare and halation; glarePass.ts). */
  starVisibility: Node<'float'>;
  /** Transmission of glass between the eye and the star (scales its glare only). */
  starTransmission: Node<'float'>;
}

export interface Pipeline {
  readonly pipeline: RenderPipeline;
  readonly camera: CameraSettings;
  /** Scene luminance (before exposure) at a screen UV, after TAA: the eye-adaptation meter's input. */
  readonly sceneLuminance: (uv: Node<'vec2'>) => Node<'float'>;
  render(): void;
}

export type ToneMapper = 'film' | 'agx' | 'aces' | 'neutral';

/**
 * A thin transparent layer composited analytically before aerial perspective (the Dome's glass, the
 * gate chamber's mist):
 * given the camera position, view direction, distance to the opaque scene (or ~∞ for sky) and the
 * radiance behind, it returns what the eye sees through it.
 */
export type TransparencyComposite = (origin: Node<'vec3'>, dir: Node<'vec3'>, dist: Node<'float'>, color: Node<'vec3'>) => Node<'vec3'>;

export function createPipeline(renderer: WebGPURenderer, scene: Scene, cam: PerspectiveCamera, atmo: AtmosphereTextures, opts: { view: DebugView; toneMapper: ToneMapper; ao: boolean; illuminant: Node<'vec3'>; skyOverlay?: (dir: Node<'vec3'>, pixelAngle: Node<'float'>) => Node<'vec4'>; composites?: TransparencyComposite[] }): Pipeline {
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
    grain: uniform(0.012) as unknown as Node<'float'>,
    adaptation: uniform(1) as unknown as Node<'float'>,
    starVisibility: uniform(1) as unknown as Node<'float'>,
    starTransmission: uniform(1) as unknown as Node<'float'>,
  };

  const taaEncode = (c: Node<'vec3'>) => {
    const e = c.mul(settings.exposure);
    return e.div(luminance(e).add(1.0));
  };
  const taaDecode = (e: Node<'vec3'>) => e.div(float(1).sub(luminance(e)).max(1e-3)).div(settings.exposure);

  const viewDirAt = (uv: Node<'vec2'>) => normalize(camWorld.mul(vec4(normalize(getViewPosition(uv, float(1.0), projInv)), 0.0)).xyz);

  // --- AO + aerial perspective on geometry; the star's atmosphere on the sky ---------------------
  const apS = atmo.aerialS as DataTexture;
  const apT = atmo.aerialT as DataTexture;
  const aoStrength = uniform(opts.ao ? 1.0 : 0.0);
  const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
  const lit = Fn(() => {
    const uv = screenUV;
    const c = colorTex.sample(uv).toVar();
    const d = depthTex.sample(uv).r;
    // What lies behind any glass, and the air in front of it (none for the sky: it carries its own).
    const behind = c.rgb.toVar();
    const transmit = vec3(1).toVar();
    const inscatter = vec3(0).toVar();
    const dist = float(1e9).toVar();
    const dirW = viewDirAt(uv).toVar();
    // Reversed depth: 0 = cleared (sky).
    If(d.greaterThan(0.0), () => {
      const vp = getViewPosition(uv, d, projInv);
      dist.assign(length(vp));
      dirW.assign(normalize(camWorld.mul(vec4(normalize(vp), 0.0)).xyz));
      // Contact occlusion only: beyond a few tens of metres a pixel spans more than the AO radius.
      const aoFade = float(1).sub(smoothstep(25.0, 60.0, dist));
      const occlusion = mix(float(1), aoTex.sample(uv).r, aoStrength.mul(aoFade));
      const apUV = aerialLutUV(dirW.y, dist);
      inscatter.assign(texture(apS, apUV).rgb.mul(opts.illuminant));
      transmit.assign(texture(apT, apUV).rgb);
      behind.assign(c.rgb.mul(occlusion));
    }).Else(() => {
      // Its own pass keeps the sky shader small (sky/star/atmosphere.ts).
      if (opts.skyOverlay) {
        const overlay = opts.skyOverlay(dirW, length(fwidth(dirW)).max(1e-6)).toVar();
        behind.assign(behind.mul(exp(overlay.a.negate())).add(overlay.rgb));
      }
    });
    // Thin layers in front of the opaque scene, farthest first (the Dome's glass, then the mist in the gate's chamber).
    let seen: Node<'vec3'> = behind;
    for (const c of opts.composites ?? []) seen = c(camPos as unknown as Node<'vec3'>, dirW, dist, seen);
    const outc = seen.mul(transmit).add(inscatter);
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

  // --- Glare: the eye's scatter and the camera's bloom (render/glare.ts, render/glarePass.ts) ---
  const skyAt = (uv: Node<'vec2'>) => select(depthTex.sample(uv).r.greaterThan(0.0), float(0), float(1)) as unknown as Node<'float'>;
  const glare = createGlarePass({ hdr: (uv) => hdr.sample(uv).rgb, viewDirAt, starGlare: atmo.starGlare, illuminant: opts.illuminant, skyAt, starVisibility: settings.starVisibility, starTransmission: settings.starTransmission });

  // The optical axis, for the lens vignette (the camera looks down its local −Z).
  const camAxis = normalize(camWorld.mul(vec4(0, 0, -1, 0)).xyz);

  const camera = Fn(() => {
    const uv = screenUV;
    const viewDir = viewDirAt(uv);
    const exposed = glare.apply(hdr.sample(uv).rgb, viewDir, skyAt(uv)).mul(settings.exposure).mul(settings.adaptation).mul(settings.whiteBalance).mul(vignette(dot(viewDir, camAxis)));
    // The look sits before the display transform, in scene-linear exposure (render/tsl/look.ts).
    const looked = filmLook(exposed) as unknown as Node<'vec3'>;
    // The clipped disc's halation spills white past its outline (glarePass.ts), screen-blended.
    const spill = vec3(...HALATION.tint).mul(glare.halation(viewDir));
    const mapped = float(1).sub(float(1).sub(toneMap(opts.toneMapper, looked)).mul(float(1).sub(spill)));
    // Grade in display-linear: saturation (contrast is the look's).
    const lum = luminance(mapped);
    const graded = mix(vec3(lum), mapped, settings.saturation).clamp(0, 1);
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
      outputNode = Fn(() => vec4(oetf(clamp(glare.starShare(viewDirAt(screenUV)).mul(settings.exposure).mul(4), 0, 1)), 1))() as unknown as Node<'vec4'>;
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
    sceneLuminance: (uv) => luminance(hdr.sample(uv).rgb) as unknown as Node<'float'>,
    render: () => {
      // Glare blurs are specified in degrees: follow the current pixels per degree.
      glare.resize(renderer.domElement.height / cam.fov);
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

