import { describe, expect, it } from 'vitest';
import { coronaColumn, coronaTableU, computeCoronaTable, CORONA_LIMB, CORONA_SAMPLES, OBSERVER_RADIUS } from '../src/sky/star/corona';

describe('corona', () => {
  it('is normalised at the limb and falls off outward', () => {
    expect(coronaColumn(1 + 1e-7)).toBeCloseTo(CORONA_LIMB, 6);
    let prev = Infinity;
    for (const b of [1.001, 1.02, 1.05, 1.1, 1.2, 1.3, 1.4]) {
      const c = coronaColumn(b);
      expect(c).toBeLessThan(prev);
      prev = c;
    }
    // Halved within ~0.05 star radii (≈3° at the limb), nearly gone by the horizon.
    expect(coronaColumn(1.05)).toBeLessThan(CORONA_LIMB * 0.6);
    expect(coronaColumn(OBSERVER_RADIUS - 0.01)).toBeLessThan(CORONA_LIMB * 0.02);
  });

  it('the table follows the column through its limb-dense mapping', () => {
    const table = computeCoronaTable();
    for (const b of [0.5, 0.95, 1.01, 1.1, 1.3]) {
      const i = Math.round(coronaTableU(b) * (CORONA_SAMPLES - 1));
      expect(table[i * 4]).toBeCloseTo(coronaColumn(b), 2);
    }
  });
});
