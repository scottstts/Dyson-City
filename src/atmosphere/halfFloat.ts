/** Float32 → IEEE half conversion (round-to-nearest), dependency-free so it can run in a worker. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp >= 0x1f) {
    // overflow, inf or NaN → clamp to max finite (never emit inf/NaN into a LUT)
    return sign | 0x7bff;
  }
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    if (mant & 0x1000) mant += 0x2000;
    return sign | (mant >>> 13);
  }
  if (mant & 0x1000) {
    mant += 0x2000;
    if (mant & 0x800000) {
      mant = 0;
      exp += 1;
      if (exp >= 0x1f) return sign | 0x7bff;
    }
  }
  return sign | (exp << 10) | (mant >>> 13);
}

/**
 * Splits an interleaved (S.rgb, T.rgb) float array into two RGBA half-float arrays.
 */
export function splitScatterTransmittance(src: Float32Array, texels: number): { scatter: Uint16Array; transmittance: Uint16Array } {
  const scatter = new Uint16Array(texels * 4);
  const transmittance = new Uint16Array(texels * 4);
  const one = toHalf(1);
  for (let i = 0; i < texels; i++) {
    const o = i * 6;
    scatter[i * 4] = toHalf(src[o]);
    scatter[i * 4 + 1] = toHalf(src[o + 1]);
    scatter[i * 4 + 2] = toHalf(src[o + 2]);
    scatter[i * 4 + 3] = one;
    transmittance[i * 4] = toHalf(src[o + 3]);
    transmittance[i * 4 + 1] = toHalf(src[o + 4]);
    transmittance[i * 4 + 2] = toHalf(src[o + 5]);
    transmittance[i * 4 + 3] = one;
  }
  return { scatter, transmittance };
}

/** Converts an RGBA float array to half floats. */
export function toHalfArray(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = toHalf(src[i]);
  return out;
}
