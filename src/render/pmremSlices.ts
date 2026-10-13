/**
 * Re-prefilters an existing PMREM in place, spread over frames.
 *
 * PMREMGenerator.fromCubemap does the whole job in one call: the GGX convolution of a 512 cube
 * (256 importance samples per texel, the 256² level dominating) is ~9 ms of GPU time on the dev
 * machine — a visible hitch if it lands in one frame. Here each step is at most one cube face of
 * one level (≤ ~1.5 ms there): the copy of the cube into level 0, then each large level face by
 * face (the filter's scissor clipped to that face), then each small level whole. Every step reads only levels
 * completed by earlier steps. The target is never cleared: each step overwrites its own region.
 *
 * This drives PMREMGenerator's internals, pinned to three 0.186.1; `assertInternals` fails boot
 * loudly if an upgrade changes them, rather than leaving a stale or broken environment.
 */
import type { CubeTexture, PMREMGenerator, RenderTarget, WebGPURenderer } from 'three/webgpu';

interface PmremInternals {
  _sizeLods: number[];
  _lodMeshes: unknown[];
  _setSizeFromTexture(texture: CubeTexture): void;
  _init(target: RenderTarget): void;
  _textureToCubeUV(texture: CubeTexture, target: RenderTarget): void;
  _applyGGXFilter(target: RenderTarget, lodIn: number, lodOut: number): void;
  _setViewport(target: RenderTarget, x: number, y: number, width: number, height: number): void;
}

const REQUIRED = ['_setSizeFromTexture', '_init', '_textureToCubeUV', '_applyGGXFilter', '_setViewport'] as const;

function assertInternals(g: PMREMGenerator): asserts g is PMREMGenerator & PmremInternals {
  const missing = REQUIRED.filter((k) => typeof (g as unknown as Record<string, unknown>)[k] !== 'function');
  if (missing.length) throw new Error(`PMREMGenerator internals changed (missing ${missing.join(', ')}): update render/pmremSlices.ts`);
}

/** Levels at least this size are filtered one face per step. */
const SLICED_LEVEL = 128;

export interface PmremSlicer {
  /** Steps in one full re-prefilter. */
  readonly steps: number;
  /** Runs step i (0 ≤ i < steps) of re-prefiltering `cube` into `target`. */
  run(i: number): void;
}

export function createPmremSlicer(renderer: WebGPURenderer, generator: PMREMGenerator, cube: CubeTexture, target: RenderTarget): PmremSlicer {
  assertInternals(generator);
  const g = generator;
  g._setSizeFromTexture(cube);
  g._init(target);

  // The filter sets one viewport (and scissor) per pass covering all six faces of a level, laid
  // out 3 × 2; while `face` is set, the scissor is clipped to that face.
  let face = -1;
  const setViewport = g._setViewport.bind(g);
  g._setViewport = (t, x, y, w, h) => {
    setViewport(t, x, y, w, h);
    if (face < 0) return;
    const fw = w / 3;
    const fh = h / 2;
    t.scissor.set(x + (face % 3) * fw, y + Math.floor(face / 3) * fh, fw, fh);
  };

  type Step = () => void;
  const steps: Step[] = [() => g._textureToCubeUV(cube, target)];
  const n = g._lodMeshes.length;
  for (let lod = 1; lod < n; lod++) {
    if (g._sizeLods[lod] >= SLICED_LEVEL) {
      for (let f = 0; f < 6; f++) {
        steps.push(() => {
          face = f;
          g._applyGGXFilter(target, lod - 1, lod);
          face = -1;
        });
      }
    } else steps.push(() => g._applyGGXFilter(target, lod - 1, lod));
  }

  return {
    steps: steps.length,
    run(i) {
      const prev = renderer.getRenderTarget();
      const prevFace = renderer.getActiveCubeFace();
      const prevLevel = renderer.getActiveMipmapLevel();
      const autoClear = renderer.autoClear;
      // WebGPURenderer applies a target's scissor only under the renderer's own scissor test.
      const scissorTest = renderer.getScissorTest();
      renderer.autoClear = false;
      renderer.setScissorTest(true);
      target.scissorTest = true;
      steps[i]();
      target.scissorTest = false;
      renderer.setScissorTest(scissorTest);
      target.viewport.set(0, 0, target.width, target.height);
      target.scissor.set(0, 0, target.width, target.height);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(prev, prevFace, prevLevel);
    },
  };
}
