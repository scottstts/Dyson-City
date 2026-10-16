/**
 * Procedural impulse responses for the three spaces (docs/audio.md). Pure: returns sample arrays.
 *
 * An IR holds only the room's reflections: the direct sound takes the dry path (emitter.ts). Its
 * level is physical: in a diffuse field the reverberant energy relative to the direct sound at
 * 1 m is 16π/A, with A the room's absorption area (Sabine: A = 0.161 V / T60). So a footstep in
 * the stone chamber is wet, while the Dome's air, huge as it is, returns only a faint long wash.
 */
import { Biquad, decayPerSample, rng } from './dsp';
import { SPEED_OF_SOUND, type Zone } from './acoustics';
import { GATE } from '../city/gate/spec';

/** Octave band centres (Hz) for the decay times. */
export const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

export interface ShoeboxEarly {
  /** Room size (m): along the passage, across it, up. */
  size: [number, number, number];
  /** Canonical source and listener inside it (m). */
  source: [number, number, number];
  listener: [number, number, number];
  /** Pressure reflection coefficient of the walls per axis (x, z, y). */
  reflect: [number, number, number];
  /** Image sources are kept up to this delay (s) and fade into the tail before it. */
  window: number;
}

export interface ReverbSpec {
  /** Length of the IR (s). */
  length: number;
  /** T60 per octave band (s), BANDS order. */
  t60: readonly number[];
  /** The tail starts here (s) and builds up over `buildup` (s). */
  onset: number;
  buildup: number;
  /** Σh² of the tail, relative to the direct sound at 1 m (16π/A). */
  energy: number;
  /** Discrete early reflections from a shoebox model. */
  shoebox?: ShoeboxEarly;
  /** Extra discrete taps (s, amplitude relative to the direct at 1 m). */
  taps?: readonly { t: number; g: number; pan: number }[];
  /** Flutter echo between two parallel walls `width` m apart, as a fraction of the tail energy. */
  flutter?: { width: number; share: number; t60: number };
}

/** Sabine absorption area (m²) from volume and T60. */
export function absorptionArea(volume: number, t60: number): number {
  return (0.161 * volume) / t60;
}

/** Diffuse-field energy relative to the direct sound at 1 m. */
export function diffuseEnergy(volume: number, t60: number): number {
  return (16 * Math.PI) / absorptionArea(volume, t60);
}

const CHAMBER_SIZE: [number, number, number] = [GATE.innerLipX - GATE.outerLipX, 2 * GATE.passageHalf, GATE.springY - GATE.floor + 1];
const CHAMBER_VOLUME = CHAMBER_SIZE[0] * CHAMBER_SIZE[1] * CHAMBER_SIZE[2];
/** The Dome: a 2:1 half-ellipsoid, 1,005 m across and 251 m high. */
const DOME_VOLUME = (2 / 3) * Math.PI * 502 * 502 * 251;

/**
 * The chamber: a sealed vault of basalt, glazed stone and steel, ~26 × 18 × 26 m. Hard everywhere,
 * so it rings for seconds; the air (humid, up to 1 bar) takes the top octave. The two piers face
 * each other 18 m apart: a flutter echo every 52 ms.
 */
const CHAMBER_T60 = [3.4, 4.0, 4.3, 4.1, 3.7, 3.0, 2.2, 1.3];
/**
 * The city under the Dome: 1.3 × 10⁸ m³ of still air. Mean free path ~260 m, so the reflections
 * are sparse and slow; pale stone and glass keep the lows for many seconds, plants and water and the
 * air take the highs. Its physical level is ~−48 dB re 1 m, lifted 10 dB so the space is felt.
 */
const CITY_T60 = [6.5, 7.5, 7.5, 7.0, 6.2, 4.6, 3.0, 1.6];
const CITY_LIFT = 10;
/**
 * The house: furnished rooms of ~6 × 5 × 3.8 m (the ground floor's ceilings), plaster walls, timber
 * floors with rugs, upholstery and curtains. One response stands for every room (a zone's
 * reverberation is diffuse): ~0.5 s in the mids, less at the top where the soft furnishings drink.
 */
const HOUSE_SIZE: [number, number, number] = [6, 5, 3.8];
const HOUSE_T60 = [0.75, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.32];

export const REVERBS: Record<Zone, ReverbSpec> = {
  chamber: {
    length: 5.5,
    t60: CHAMBER_T60,
    onset: 0.025,
    buildup: 0.07,
    energy: diffuseEnergy(CHAMBER_VOLUME, CHAMBER_T60[4]),
    shoebox: {
      size: CHAMBER_SIZE,
      source: [11, 1.0, 7.5],
      listener: [14, 1.6, 9.6],
      reflect: [0.96, 0.97, 0.95],
      window: 0.16,
    },
    flutter: { width: CHAMBER_SIZE[1], share: 0.12, t60: 2.4 },
  },
  city: {
    length: 7.5,
    t60: CITY_T60,
    onset: 0.06,
    buildup: 0.55,
    energy: diffuseEnergy(DOME_VOLUME, CITY_T60[4]) * Math.pow(10, CITY_LIFT / 10),
    taps: [
      { t: 0.085, g: 0.02, pan: -0.4 },
      { t: 0.21, g: 0.013, pan: 0.5 },
      { t: 0.37, g: 0.009, pan: -0.2 },
      { t: 0.64, g: 0.006, pan: 0.3 },
    ],
  },
  /**
   * The band: open deck to the horizon. Only the Dome's posts and frame scatter a little back; the
   * big slap off the drum and gatehouse is a moving delay (engine.ts), not part of this IR.
   */
  house: {
    length: 1.4,
    t60: HOUSE_T60,
    onset: 0.012,
    buildup: 0.03,
    energy: diffuseEnergy(HOUSE_SIZE[0] * HOUSE_SIZE[1] * HOUSE_SIZE[2], HOUSE_T60[4]),
    shoebox: {
      size: HOUSE_SIZE,
      source: [2.2, 0.1, 1.9],
      listener: [2.6, 1.6, 2.4],
      reflect: [0.82, 0.8, 0.7],
      window: 0.04,
    },
  },
  outside: {
    length: 1.6,
    t60: [1.2, 1.2, 1.1, 1.0, 0.9, 0.7, 0.5, 0.3],
    onset: 0.05,
    buildup: 0.15,
    energy: 4e-4,
  },
};

/** Adds an impulse of amplitude g at fractional sample position p (linear split). */
function impulse(x: Float32Array, p: number, g: number): void {
  const i = Math.floor(p);
  if (i < 0 || i + 1 >= x.length) return;
  const f = p - i;
  x[i] += g * (1 - f);
  x[i + 1] += g * f;
}

/** Image sources of a shoebox up to `window` seconds, low-passed per reflection order. */
function addShoebox(out: [Float32Array, Float32Array], sb: ShoeboxEarly, sr: number): void {
  const [L, W, H] = sb.size;
  const s = [sb.source[0], sb.source[2], sb.source[1]];
  const l = [sb.listener[0], sb.listener[2], sb.listener[1]];
  const dims = [L, W, H];
  const maxD = sb.window * SPEED_OF_SOUND;
  const maxOrder = 14;
  const byOrder = Array.from({ length: maxOrder + 1 }, () => [new Float32Array(out[0].length), new Float32Array(out[0].length)]);
  const axis = (k: number) => {
    const imgs: { p: number; n: number }[] = [];
    const N = Math.ceil(maxD / (2 * dims[k])) + 1;
    for (let n = -N; n <= N; n++) {
      imgs.push({ p: 2 * n * dims[k] + s[k], n: Math.abs(2 * n) });
      imgs.push({ p: 2 * n * dims[k] - s[k], n: Math.abs(2 * n - 1) });
    }
    return imgs;
  };
  const ax = axis(0);
  const az = axis(1);
  const ay = axis(2);
  for (const a of ax)
    for (const b of az)
      for (const c of ay) {
        const order = a.n + b.n + c.n;
        if (order === 0 || order > maxOrder) continue;
        const dx = a.p - l[0];
        const dz = b.p - l[1];
        const dy = c.p - l[2];
        const d = Math.hypot(dx, dz, dy);
        if (d > maxD) continue;
        const g = Math.pow(sb.reflect[0], a.n) * Math.pow(sb.reflect[1], b.n) * Math.pow(sb.reflect[2], c.n) / d;
        // Fade the discrete images out over the last 40 % of the window, where the tail takes over.
        const fade = Math.min(1, (1 - d / maxD) / 0.4);
        const pan = Math.max(-1, Math.min(1, dz / d));
        const t = (d / SPEED_OF_SOUND) * sr;
        impulse(byOrder[order][0], t, g * fade * Math.sqrt((1 - pan) / 2));
        impulse(byOrder[order][1], t, g * fade * Math.sqrt((1 + pan) / 2));
      }
  for (let o = 1; o <= maxOrder; o++) {
    const fc = 15000 / (1 + 0.35 * (o - 1));
    for (let ch = 0; ch < 2; ch++) {
      const b = byOrder[o][ch];
      new Biquad('lowpass', fc, 0.6, sr).process(b);
      const dst = out[ch];
      for (let i = 0; i < dst.length; i++) dst[i] += b[i];
    }
  }
}

/** The diffuse tail of one channel: octave bands of noise, each decaying at its own T60. */
function tail(n: number, spec: ReverbSpec, sr: number, r: () => number): Float32Array {
  const out = new Float32Array(n);
  const start = Math.round(spec.onset * sr);
  const band = new Float32Array(n);
  for (let b = 0; b < BANDS.length; b++) {
    for (let i = 0; i < n; i++) band[i] = i >= start ? 2 * r() - 1 : 0;
    const f = BANDS[b];
    if (b === 0) new Biquad('lowpass', f * 1.41, 0.7, sr).process(band);
    else if (b === BANDS.length - 1) new Biquad('highpass', f / 1.41, 0.7, sr).process(band);
    else {
      new Biquad('bandpass', f, 1.41, sr).process(band);
      new Biquad('bandpass', f, 1.41, sr).process(band);
    }
    const k = decayPerSample(spec.t60[b], sr);
    let env = 1;
    for (let i = start; i < n; i++) {
      out[i] += band[i] * env;
      env *= k;
    }
  }
  // Build-up: echo density grows from the onset.
  const tau = spec.buildup * sr;
  for (let i = start; i < n; i++) out[i] *= 1 - Math.exp(-(i - start) / tau);
  if (spec.flutter) addFlutter(out, spec, sr, r);
  return out;
}

/** Repeating reflections between two parallel walls: a fast, bright, slightly jittered train. */
function addFlutter(out: Float32Array, spec: ReverbSpec, sr: number, r: () => number): void {
  const fl = spec.flutter!;
  const train = new Float32Array(out.length);
  const period = ((2 * fl.width) / SPEED_OF_SOUND) * sr;
  const k = decayPerSample(fl.t60, sr);
  for (let p = spec.onset * sr + period; p < out.length - 2; p += period) {
    impulse(train, p + (r() - 0.5) * 0.0008 * sr, Math.pow(k, p) * (0.8 + 0.4 * r()));
  }
  new Biquad('highpass', 450, 0.7, sr).process(train);
  new Biquad('lowpass', 4500, 0.7, sr).process(train);
  let et = 0;
  let eo = 0;
  for (let i = 0; i < out.length; i++) {
    et += train[i] * train[i];
    eo += out[i] * out[i];
  }
  const s = et > 0 ? Math.sqrt((fl.share * eo) / et) : 0;
  for (let i = 0; i < out.length; i++) out[i] += s * train[i];
}

/** Synthesises a stereo IR at `sr`. Tail channels are decorrelated; their energy is `spec.energy`. */
export function synthesizeImpulse(spec: ReverbSpec, sr: number, seed: number): [Float32Array, Float32Array] {
  const n = Math.round(spec.length * sr);
  const r = rng(seed);
  const out: [Float32Array, Float32Array] = [tail(n, spec, sr, r), tail(n, spec, sr, r)];
  for (const ch of out) {
    let e = 0;
    for (let i = 0; i < n; i++) e += ch[i] * ch[i];
    const s = e > 0 ? Math.sqrt(spec.energy / e) : 0;
    for (let i = 0; i < n; i++) ch[i] *= s;
  }
  if (spec.shoebox) addShoebox(out, spec.shoebox, sr);
  for (const tap of spec.taps ?? []) {
    const p = tap.t * sr;
    impulse(out[0], p, tap.g * Math.sqrt((1 - tap.pan) / 2));
    impulse(out[1], p, tap.g * Math.sqrt((1 + tap.pan) / 2));
  }
  // A short fade so the IR's end is never a cut.
  const nf = Math.round(0.3 * sr);
  for (const ch of out) for (let i = 0; i < nf; i++) ch[n - 1 - i] *= i / nf;
  return out;
}
