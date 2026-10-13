/**
 * Tone mapping: linear shadows, exponential shoulder, path to white.
 *
 * Below a knee the response is a straight line in log exposure with slight contrast (display =
 * 0.18·2^(γ·stops)): mid-grey stays mid-grey and black stays black — dark glossy metal must read
 * black, which a lifted film toe (AgX) turns grey. Above the knee an exponential shoulder runs
 * smoothly to white at EV_MAX, so the star, several stops over, is white-hot and keeps a trace of
 * texture. Colour is rescaled with luminance (hue preserved) and blends toward white near display
 * white; clipped channels hand their luminance to the open ones.
 */
import { Fn, vec3, max, min, dot, step, mix, smoothstep, log2, exp2, exp, select, float } from 'three/tsl';
import type { Node } from 'three/webgpu';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

const REC709 = vec3(0.2126, 0.7152, 0.0722);

/** Stops over mid-grey (0.18) that reach display white, the knee's display value, and the slope. */
export const EV_MAX = 4.5;
const KNEE = 0.6;
const GAMMA = 1.1;
const S_KNEE = Math.log2(KNEE / 0.18) / GAMMA;
const RATE = (KNEE * Math.LN2 * GAMMA) / (1 - KNEE);

/** The curve on a scalar luminance (display-linear out). Mirrored on the CPU for tests. */
export function curveCpu(L: number): number {
  const s = Math.log2(Math.max(L, 1e-10) / 0.18);
  return s <= S_KNEE ? 0.18 * 2 ** (GAMMA * s) : 1 - (1 - KNEE) * Math.exp(-(s - S_KNEE) * RATE);
}

function curve(L: F): F {
  const s = log2(L.div(0.18));
  const lin = exp2(s.mul(GAMMA)).mul(0.18);
  const sh = float(1).sub(exp(s.sub(S_KNEE).mul(-RATE)).mul(1 - KNEE));
  return select(s.lessThanEqual(S_KNEE), lin, sh).clamp(0, 1) as unknown as F;
}

/** Clip to display white and give the lost luminance to the unclipped channels (one pass). */
function redistribute(c: V3, target: F): V3 {
  const clipped = min(c, vec3(1.0));
  const deficit = max(target.sub(dot(clipped, REC709)), 0.0);
  const open = step(clipped, vec3(0.9999)) as unknown as V3;
  const room = max(dot(open, REC709), 1e-4);
  return min(clipped.add(open.mul(deficit.div(room))), vec3(1.0));
}

export const hueFilmic = Fn(([color]: [V3]) => {
  const c = max(color, vec3(0.0));
  const L = max(dot(c, REC709), 1e-8);
  const Lm = curve(L);
  const scaled = c.mul(Lm.div(L));
  // Path to white for the brightest values.
  const whitened = mix(scaled, vec3(Lm), smoothstep(0.45, 1.0, Lm));
  return redistribute(redistribute(whitened, Lm), Lm);
}).setLayout({ name: 'dyHueFilmic', type: 'vec3', inputs: [{ name: 'color', type: 'vec3' }] });
