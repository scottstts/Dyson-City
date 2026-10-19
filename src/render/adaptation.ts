/**
 * Eye adaptation (design §12, docs/render-pipeline.md): a metered, global exposure, never local.
 *
 * The exposure stays keyed to the star; adaptation only multiplies it upward when the view is dimmer
 * than a sunlit scene (under the Dome's tint, an interior), never below 1 (the open deck and
 * anything facing the star stay on the star's key). The eye adapts fully over the first
 * ADAPT_FULL_STOPS of darkness and then only partly (ADAPT_SLOPE per stop), as an eye's adaptation
 * is incomplete: a room 8 stops under the sunlit garden reads ~1.2 stops dimmer than it, a lamp-lit
 * hall 11 stops under it ~1.8 stops dimmer, legible but dim; the windows blow out. Asymmetric like
 * an eye: it opens slowly going in (~4 s) and clamps down fast going out (~1 s, after a moment of
 * overexposure).
 *
 * Meter: a 64 × 36 log-luminance image of the scene after TAA (centre-weighted), read back
 * asynchronously every few frames; the log-average sets the target.
 */
import { HalfFloatType, NodeMaterial, QuadMesh, RenderTarget, RGBAFormat, type WebGPURenderer } from 'three/webgpu';
import { vec2, vec4, log, max, exp, dot, screenUV, float } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * Log-average scene luminance below which the eye starts to open up (scene units): a sunlit view's.
 * The estate under the Dome meters ~0.18 (pale ground, dark sky through the tinted glass) and opens
 * ~0.7 stop, so its sunlit tops read near white as noon ground does; the open deck meters above it
 * and stays on the star's key.
 */
export const ADAPT_REF = 0.3;
/** Stops of darkness the eye adapts to fully, the share of each further stop, and the ceiling (+11 EV). */
export const ADAPT_FULL_STOPS = 2;
export const ADAPT_SLOPE = 0.8;
export const ADAPT_MAX = 2048;
/** Time constants (s): opening up (scene got darker) and clamping down (scene got brighter). */
export const ADAPT_TAU = { open: 1.4, close: 0.3 } as const;

/**
 * The material output is clamped to [0, 1] on the way into the target, so the log-luminance is
 * stored offset and scaled: (ln L + LOG_OFFSET) / LOG_SCALE.
 */
const LOG_OFFSET = 16;
const LOG_SCALE = 32;

const W = 64;
const H = 36;
const EVERY = 4;

/** Adaptation target for a metered log-average luminance (natural log). */
export function adaptationTarget(logAverage: number): number {
  const dark = Math.log2(ADAPT_REF) - logAverage / Math.LN2;
  if (dark <= 0) return 1;
  const open = dark <= ADAPT_FULL_STOPS ? dark : ADAPT_FULL_STOPS + (dark - ADAPT_FULL_STOPS) * ADAPT_SLOPE;
  return Math.min(2 ** open, ADAPT_MAX);
}

/** One smoothing step toward the target (in log space). */
export function adaptStep(current: number, target: number, dt: number): number {
  const tau = target > current ? ADAPT_TAU.open : ADAPT_TAU.close;
  const k = 1 - Math.exp(-dt / tau);
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
}

export class EyeAdaptation {
  /** Current multiplier on the exposure. */
  value = 1;
  /**
   * The most the eye may open now (default: ADAPT_MAX). The terminal's screen dims itself by the
   * eye's adaptation (terminal/screenMaterial.ts): the dimmer panel would open the eye further, and
   * the loop would run to ADAPT_MAX. While the view is at it, the terminal holds the eye here.
   */
  limit = ADAPT_MAX;

  private target = 1;
  private readonly rt = new RenderTarget(W, H, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false });
  private readonly quad: QuadMesh;
  private frame = 0;
  private pending = false;
  private readonly renderer: WebGPURenderer;

  constructor(renderer: WebGPURenderer, sceneLuminance: (uv: Node<'vec2'>) => Node<'float'>) {
    this.renderer = renderer;
    const mat = new NodeMaterial();
    mat.name = 'EyeAdaptation.meter';
    const uv = screenUV;
    const lum = sceneLuminance(uv);
    // Centre-weighted, as an eye fixates where it looks.
    const d = uv.sub(0.5).mul(vec2(2.2, 1.6));
    const w = exp(dot(d, d).mul(-1.5));
    const enc = log(max(lum, 1e-6)).add(LOG_OFFSET).div(LOG_SCALE).clamp(0, 1);
    mat.colorNode = vec4(enc.mul(w), w, float(0), float(1));
    this.quad = new QuadMesh(mat);
  }

  update(dt: number): number {
    if (++this.frame % EVERY === 0 && !this.pending) {
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.rt);
      this.quad.render(this.renderer);
      this.renderer.setRenderTarget(prev);
      this.pending = true;
      void this.renderer
        .readRenderTargetPixelsAsync(this.rt, 0, 0, W, H)
        .then((px) => {
          const a = px as unknown as ArrayLike<number>;
          let sum = 0;
          let wsum = 0;
          const half = a instanceof Uint16Array;
          for (let i = 0; i < W * H; i++) {
            const lw = half ? fromHalf(a[i * 4]) : a[i * 4];
            const ww = half ? fromHalf(a[i * 4 + 1]) : a[i * 4 + 1];
            sum += lw;
            wsum += ww;
          }
          if (wsum > 0 && Number.isFinite(sum)) this.target = adaptationTarget((sum / wsum) * LOG_SCALE - LOG_OFFSET);
        })
        .finally(() => {
          this.pending = false;
        });
    }
    this.value = adaptStep(this.value, Math.min(this.target, this.limit), dt);
    return this.value;
  }
}

/** IEEE half float to number. */
function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
