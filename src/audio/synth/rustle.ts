/**
 * A tree's leaves rustling in the breeze (docs/audio.md "The estate"), cloned from a recording: the
 * fitted texture (models/estateRustle.ts: the crown's bright hush and the leaves' ticking) under the
 * leaves' flutter. A random-phase texture is stationary at every time scale, but the recorded leaf
 * band swells and drops by ~5 dB over tens of milliseconds, as clusters of leaves catch the air
 * together: that flutter is a log-normal envelope on the band above FLUTTER_HZ, its depth and time
 * scale fitted so the clone's short-time level spread matches the recording's. On top, the breeze
 * itself rises and settles over seconds. Pure: a seamless loop of 2^log2n samples.
 */
import { filter, rng } from '../dsp';
import { fft } from './fft';
import { synthTexture } from './spectral';
import { loopWander } from './house';
import { ESTATE_RUSTLE } from '../models/estateRustle';

/** Below this the crown's sound is the air's hush, which does not flutter with the leaves. */
const FLUTTER_HZ = 1200;
/** The flutter's depth (dB, standard deviation) and its bandwidth (Hz): ~40 ms swells. */
const FLUTTER_DB = 4.4;
const FLUTTER_BW = 9;
/** The breeze's slow rise and fall over the loop (dB, peak to peak). */
const GUST_DB = 6;

export function synthRustle(log2n: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const n = 1 << log2n;
  const full = synthTexture(ESTATE_RUSTLE, log2n, sr, r);
  const high = periodicHighpass(full, sr);
  const flutter = periodicFlutter(n, sr, r);
  const phases = [r() * 6.28, r() * 6.28, r() * 6.28];
  const seconds = n / sr;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gust = Math.pow(10, (GUST_DB * (loopWander(i / sr, seconds, phases) - 0.5)) / 20);
    out[i] = gust * (full[i] - high[i] + flutter[i] * high[i]);
  }
  return out;
}

/** The loop's band above FLUTTER_HZ, filtered as the periodic signal it is (warmed up on its own tail). */
function periodicHighpass(x: Float32Array, sr: number): Float32Array {
  const warm = Math.round(0.1 * sr);
  const y = new Float32Array(warm + x.length);
  y.set(x.subarray(x.length - warm), 0);
  y.set(x, warm);
  filter(y, sr, ['highpass', FLUTTER_HZ, 0.7], ['highpass', FLUTTER_HZ, 0.7]);
  return y.slice(warm);
}

/** A periodic log-normal gain of mean square 1: Gaussian noise band-limited to FLUTTER_BW. */
function periodicFlutter(n: number, sr: number, r: () => number): Float32Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const df = sr / n;
  for (let k = 1; k < n / 2; k++) {
    const a = Math.exp(-0.5 * Math.pow((k * df) / FLUTTER_BW, 2));
    if (a < 1e-6) break;
    const ph = 2 * Math.PI * r();
    re[k] = a * Math.cos(ph);
    im[k] = a * Math.sin(ph);
    re[n - k] = re[k];
    im[n - k] = -im[k];
  }
  fft(re, im, true);
  let ms = 0;
  for (let i = 0; i < n; i++) ms += re[i] * re[i];
  const sd = Math.sqrt(ms / n) || 1;
  const g = new Float32Array(n);
  let power = 0;
  for (let i = 0; i < n; i++) {
    g[i] = Math.pow(10, (FLUTTER_DB * (re[i] / sd)) / 20);
    power += g[i] * g[i];
  }
  const norm = 1 / Math.sqrt(power / n);
  for (let i = 0; i < n; i++) g[i] *= norm;
  return g;
}
