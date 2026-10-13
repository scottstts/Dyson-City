/**
 * Thermal glow of the shell. The structure absorbs most of 23,000 suns and carries the heat away
 * through coolant to radiators outside the shell; its fictional refractory alloy (it does not melt)
 * runs collector faces near 2,600 K, close to the temperature that balances re-radiation against
 * heat-engine efficiency, set a little low for the look. At that temperature metal glows like a lamp
 * filament, but at only ~0.6 % of the star's radiance: a dark bronze cast with a physical cause, and — because visible glow is steep in temperature (a 5 %
 * change is a 1.6× change in brightness) — a source of detail: tiles hotter in the middle than at
 * their cooled seams, coolant warming across each module, sections at different loads, offline
 * tiles dark. The collecting channels (headers) are the hottest parts and glow orange-gold: the
 * logo's lines, at a few percent of the star, never bright enough to bloom.
 *
 * Radiance per channel is the Planck ratio against the photosphere at the 650/550/450 nm channel
 * wavelengths, times the photosphere's own disc-centre radiance (world/radiometry.ts), so the glow
 * shares the star's radiance scale exactly.
 */
import { Fn, exp, float, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { STAR_CENTER_RADIANCE } from '../../world/radiometry';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type RGB = [number, number, number];

const C2 = 0.014388;
const LAMBDA = [650e-9, 550e-9, 450e-9] as const;
const T_STAR = 5772;

/** Emissivity of the alloy's oxidised working face in the visible. */
export const EMISSIVITY = 0.9;
/** Mean working temperatures (K). */
export const COLLECTOR_TEMPERATURE = 2600;
export const STRUCTURE_TEMPERATURE = 2350;
export const HEADER_TEMPERATURE = 3450;
/** An offline tile is shuttered (its reflective cover closed): it absorbs almost nothing and runs cold. */
export const OFFLINE_TEMPERATURE = 1600;
/** Relative spread of collector temperatures (regions, tiles, domes, coolant gradients). */
export const COLLECTOR_TEMPERATURE_SPREAD = 0.04;
/** Share of collector tiles offline at any time. */
export const OFFLINE_SHARE = 0.03;

/** Planck ratio B_λ(T) / B_λ(T_star) at each channel (CPU). */
function planckRatio(T: number, c: number): number {
  const x = C2 / LAMBDA[c];
  return (Math.exp(x / T_STAR) - 1) / (Math.exp(x / T) - 1);
}

/** Thermal radiance (scene units, RGB) of the alloy at temperature T (CPU). */
export function glowRadiance(T: number, emissivity = EMISSIVITY): RGB {
  return [0, 1, 2].map((c) => emissivity * planckRatio(T, c) * STAR_CENTER_RADIANCE[c]) as RGB;
}

/**
 * Mean glow of a surface whose temperature varies by a relative spread σ about T (CPU). Visible
 * glow is convex in temperature, so a varied surface glows brighter on average than a uniform one
 * at the same mean temperature: this keeps unresolved distant plating at the mean of its detail.
 */
export function meanGlowRadiance(T: number, sigma: number, emissivity = EMISSIVITY): RGB {
  const N = 33;
  const out: RGB = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < N; i++) {
    const z = -3 + (6 * i) / (N - 1);
    const w = Math.exp(-0.5 * z * z);
    const g = glowRadiance(T * (1 + sigma * z), emissivity);
    for (let c = 0; c < 3; c++) out[c] += w * g[c];
    wsum += w;
  }
  return out.map((v) => v / wsum) as RGB;
}

const K = LAMBDA.map((l) => C2 / l);
const NUM = K.map((k) => Math.exp(k / T_STAR) - 1);

/** Thermal radiance (scene units) at temperature T (K) — shader version of glowRadiance. */
export const glowNode = Fn(([T]: [F]) => {
  const inv = float(1).div(T.max(300.0));
  const r = float(NUM[0] * EMISSIVITY * STAR_CENTER_RADIANCE[0]).div(exp(inv.mul(K[0])).sub(1));
  const g = float(NUM[1] * EMISSIVITY * STAR_CENTER_RADIANCE[1]).div(exp(inv.mul(K[1])).sub(1));
  const b = float(NUM[2] * EMISSIVITY * STAR_CENTER_RADIANCE[2]).div(exp(inv.mul(K[2])).sub(1));
  return vec3(r, g, b);
}).setLayout({ name: 'dyGlow', type: 'vec3', inputs: [{ name: 'T', type: 'float' }] }) as unknown as (T: F) => V3;
