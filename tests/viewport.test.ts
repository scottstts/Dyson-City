import { describe, expect, it } from 'vitest';
import { computeViewport, MAX_DRAWING_BUFFER_PIXELS, MAX_DPR } from '../src/core/viewport';

describe('drawing-buffer policy', () => {
  it('leaves an ordinary Mac viewport at its native DPR when under the cap', () => {
    const v = computeViewport(1440, 900, 2);
    expect(v.dpr).toBeCloseTo(Math.min(2, MAX_DPR, Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (1440 * 900))));
    expect(v.width * v.dpr * v.height * v.dpr).toBeLessThanOrEqual(MAX_DRAWING_BUFFER_PIXELS + 1);
  });

  it('caps the DPR at 1.7', () => {
    expect(computeViewport(800, 600, 3).dpr).toBe(MAX_DPR);
  });

  it('lets the DPR fall below 1 on huge CSS viewports (no floor)', () => {
    const v = computeViewport(3840, 2160, 1);
    expect(v.dpr).toBeLessThan(1);
    expect(v.width * v.dpr * v.height * v.dpr).toBeCloseTo(MAX_DRAWING_BUFFER_PIXELS, -2);
  });

  it('multiplies a render scale into the base DPR', () => {
    const base = computeViewport(1600, 900, 2).dpr;
    expect(computeViewport(1600, 900, 2, 0.5).dpr).toBeCloseTo(base * 0.5);
  });

  it('never returns a non-finite or non-positive DPR', () => {
    expect(computeViewport(0, 0, NaN).dpr).toBe(1);
    expect(computeViewport(100, 100, 0).dpr).toBe(1);
  });
});
