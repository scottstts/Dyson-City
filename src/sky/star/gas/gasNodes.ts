/**
 * Shader side of the erupting gas (solver.ts): its emission along a view ray.
 *
 * The solved 2D field owns the silhouette and the motion; depth slices through a 3D eddy field,
 * written in the plane's own coordinates and drifting with the gas's age, erode it into billows and
 * filaments and give it depth, never its motion. The slices are jittered per pixel and frame
 * (temporal AA integrates them); octaves fade to their mean below the pixel footprint.
 *
 * Colour is temperature: a blackbody's colour (Planck per channel) from 3,300 K (deep gold) in old,
 * cooled gas to 5,300 K (hot white, a little cooler than the photosphere) in fresh cores. Brightness
 * follows the bolometric T⁴ rather than the visible band's much steeper Planck slope, which left the
 * cooling gas invisible. Thin plasma emits as density squared (collisional excitation: the emission
 * measure) and saturates when thick, taken as (1 − e^−τ)²: dense ribbons glow well above the thin
 * gas around them. (A plain 1 − e^−τ saturated too early: plumes read as uniform smoke.) An opaque
 * core at 5,300 K is GAS_PEAK times the disc mean, as bright as the jets this gas replaced.
 */
import { abs, atan, clamp, cos, dot, exp, floor, float, If, max, mix, pow, sin, smoothstep, sqrt, vec2, vec3 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';
import { vNoise4 } from '../../../render/tsl/volumeNoise';
import { loop } from '../../../render/tsl/helpers';
import { STAR_RADIUS_R } from '../../../world/constants';
import { STAR_CHROMA, STAR_DISC_MEAN_RADIANCE } from '../../../world/radiometry';
import { GAS_HEIGHT, GAS_NX, GAS_NY } from './domain';
import type { CoronalGas } from './solver';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

export const GAS_COOL_K = 3300;
export const GAS_HOT_K = 5300;
/** Luminance of an opaque core at GAS_HOT_K, relative to the disc mean. */
export const GAS_PEAK = 5;
/** Heat per unit density at which gas reaches GAS_HOT_K (fresh gas is injected at 1.7). */
const HOT_HEAT = 1.6;
/** Temperature rises as the square of heat / HOT_HEAT: cooling gas turns gold soon after it leaves the vent. */
const HEAT_CURVE = 2;
/** Optical depth per unit of eroded column. */
const KAPPA = 4;
const SLICES = 6;
/** Density at which the eddies erode as much as the reference's, and how fast erosion grows as gas thins. */
const THIN = 0.25;
const TEAR = 0.4;
/** Half-thickness of the gas sheet in eddy-noise units, and the eddy field's frequency (per star radius). */
const SHEET = 0.8;
const EDDY_SCALE = 173;

const T_STAR = 5772;
const C2 = 0.014388;
const LAMBDA = [650e-9, 550e-9, 450e-9];
const K = LAMBDA.map((l) => C2 / l);
/** Planck per channel relative to the photosphere, in the star's chroma: a blackbody's linear RGB. */
const PLANCK = [0, 1, 2].map((c) => STAR_CHROMA[c] * (Math.exp(K[c] / T_STAR) - 1));

/**
 * Radiance of an opaque core at temperature T (K): the blackbody's colour at unit luminance, times
 * (T / GAS_HOT_K)⁴ × GAS_PEAK × the disc mean.
 */
function gasRadiance(T: F): V3 {
  const inv = float(1).div(T);
  const bb = vec3(...([0, 1, 2].map((c) => float(PLANCK[c]).div(exp(inv.mul(K[c])).sub(1))) as [F, F, F]));
  const lum = dot(bb, vec3(0.2126, 0.7152, 0.0722));
  const t = T.div(GAS_HOT_K);
  const t2 = t.mul(t);
  return bb.div(lum).mul(t2.mul(t2).mul(GAS_PEAK * STAR_DISC_MEAN_RADIANCE[1])) as unknown as V3;
}

/**
 * Cubic B-spline reconstruction of the gas field (four bilinear taps). Shading is steeply nonlinear
 * in density, and bilinear samples showed the solver's grid through it as fine streaks.
 */
function smoothSample(tex: TextureNode, st: Node<'vec2'>): Node<'vec4'> {
  const size = vec2(GAS_NX, GAS_NY);
  const p = st.mul(size).sub(0.5);
  const i = floor(p);
  const f = p.sub(i);
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f.oneMinus().pow(3).div(6);
  const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
  const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6);
  const w3 = f3.div(6);
  const g0 = w0.add(w1);
  const g1 = w2.add(w3);
  const h0 = i.sub(0.5).add(w1.div(g0)).div(size);
  const h1 = i.add(1.5).add(w3.div(g1)).div(size);
  const row0 = tex.sample(h0).mul(g0.x).add(tex.sample(vec2(h1.x, h0.y)).mul(g1.x));
  const row1 = tex.sample(vec2(h0.x, h1.y)).mul(g0.x).add(tex.sample(h1).mul(g1.x));
  return row0.mul(g0.y).add(row1.mul(g1.y)) as unknown as Node<'vec4'>;
}

/** Thin bright ridges where a noise channel crosses ½. */
const ridges = (n: F, p: number): F => pow(float(1).sub(abs(n.mul(2).sub(1))), p) as unknown as F;

/**
 * Emission of the erupting gas along view direction `d` (local frame, shell units, observer at the
 * origin and star centre at (0, 1, 0)). `jitter` ∈ [0, 1) per pixel and frame.
 */
export function gasEmission(gas: CoronalGas, d: V3, pixelAngle: F, jitter: F): V3 {
  const s = STAR_RADIUS_R;
  const out = vec3(0).toVar();
  // Impact parameter of the sight line (star radii) and its height above the limb.
  const sinA = sqrt(max(d.y.mul(d.y).oneMinus(), 1e-8)).toVar();
  const h = sinA.div(s).sub(1).toVar();
  If(h.greaterThan(0.0).and(h.lessThan(GAS_HEIGHT)), () => {
    const psi = atan(d.z, d.x).toVar();
    const st = vec2(psi.div(2 * Math.PI).add(0.5), h.div(GAS_HEIGHT)).toVar();
    // A bilinear look first: most of the annulus is empty.
    const blend = gas.blend as unknown as F;
    If(mix(gas.previous.sample(st).r, gas.field.sample(st).r, blend).greaterThan(0.002), () => {
      const state = mix(smoothSample(gas.previous, st), smoothSample(gas.field, st), blend).toVar();
      const density = state.r;
      // Heat per unit density. (A regularised heat / (density + 0.08) read thin gas as cold, and with
      // brightness in T⁴ a thinning plume blacked out at once instead of dissipating.)
      const temp = state.g.div(max(density, 0.01));
      const age = state.b;
      const time = gas.clock as unknown as F;
      const r = h.add(1);
      const er = vec2(cos(psi), sin(psi));
      const et = vec2(sin(psi).negate(), cos(psi));
      // Eddies drift with the gas's age (out along the plume, a little along the limb).
      const plane = er.mul(r.mul(EDDY_SCALE)).add(et.mul(age.mul(0.11))).sub(er.mul(age.mul(0.22))).toVar();
      // Pixel footprint in star radii: along the limb (r/sinA per radian) or across it (cos/s).
      const foot = pixelAngle.mul(max(r.div(sinA), d.y.div(s))).mul(EDDY_SCALE).toVar();
      const fade = (f: number) => float(1).sub(smoothstep(0.25, 0.6, foot.mul(f)));
      const f3 = fade(3.4).toVar();
      const f4 = fade(8.31).toVar();
      // Ridged noise is ~4× sharper than its lattice: the filaments fade by that.
      const fRidge = fade(3.4 * 4).toVar();
      const sum = float(0).toVar();
      loop('gasSlice', SLICES, (i) => {
        const z = i.toFloat().add(jitter).div(SLICES).sub(0.5).mul(2 * SHEET);
        const p = vec3(plane, z.mul(3).add(time.mul(0.045)));
        const a = vNoise4(p).x;
        const b = vNoise4(p.mul(2.03).add(7.3)).y;
        const c = vNoise4(p.mul(3.4).add(19.7));
        const e = vNoise4(p.mul(8.31).add(2.4)).w;
        const eddies = a.mul(0.53).add(b.mul(0.27)).add(mix(float(0.5), c.z, f3).mul(0.13)).add(mix(float(0.5), e, f4).mul(0.07));
        const filament = mix(float(0.3), ridges(c.x, 3), fRidge);
        // Dense gas fills its eddies; as it thins it tears into wisps before it is gone.
        const erosion = smoothstep(0.28, 0.65, eddies.add(density.sub(THIN).mul(TEAR)));
        sum.addAssign(erosion.mul(filament.mul(0.5).add(0.5)).mul(float(1).sub(z.mul(z).mul(0.35))));
      });
      const amount = sum.div(SLICES).mul(pow(density, 0.78));
      const T = mix(float(GAS_COOL_K), float(GAS_HOT_K), pow(clamp(temp.div(HOT_HEAT), 0.0, 1.0), HEAT_CURVE));
      const opacity = exp(amount.mul(-KAPPA)).oneMinus();
      out.assign(gasRadiance(T).mul(opacity.mul(opacity)));
    });
  });
  return out as unknown as V3;
}
