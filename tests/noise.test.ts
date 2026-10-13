import { describe, expect, it } from 'vitest';
import { generateValueVolume, VALUE_SIZE } from '../src/render/noiseVolumes';
import { toHalf } from '../src/atmosphere/halfFloat';

describe('noise volumes', () => {
  it('value noise tiles seamlessly across the volume edge', () => {
    const v = generateValueVolume();
    const N = VALUE_SIZE;
    let maxJump = 0;
    let maxEdge = 0;
    for (let z = 0; z < N; z += 7) {
      for (let y = 0; y < N; y += 5) {
        const at = (x: number) => v[((z * N + y) * N + x) * 4];
        maxEdge = Math.max(maxEdge, Math.abs(at(N - 1) - at(0)));
        for (let x = 1; x < N; x++) maxJump = Math.max(maxJump, Math.abs(at(x) - at(x - 1)));
      }
    }
    // The wrap step is no larger than an ordinary neighbouring-texel step.
    expect(maxEdge).toBeLessThanOrEqual(maxJump);
  });
});

describe('half floats', () => {
  it('encode exact values and clamp overflow to finite', () => {
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(1e9)).toBe(0x7bff);
    expect(toHalf(0)).toBe(0);
  });
});
