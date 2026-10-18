/**
 * The East Lock's gate sounds come from its own machinery (audio/sounds/gate.ts LOCK_GATE_SOUND):
 * its hoists and the middle of its leaves' skins, in the world, at each openness.
 */
import { describe, expect, it } from 'vitest';
import { LOCK_GATE_SOUND, WEST_GATE_SOUND } from '../src/audio/sounds/gate';
import { craftAudible } from '../src/audio/sounds/vehicles';
import { LOCK, toWorld } from '../src/city/eastLock/spec';

describe('the East Lock’s sounds', () => {
  it('come from its hoists and leaves on the east side, the outer beyond the inner', () => {
    for (const s of [0, 0.5, 1]) {
      for (const g of [LOCK_GATE_SOUND.outer, LOCK_GATE_SOUND.inner]) {
        for (const side of [-1, 1] as const) {
          const h = g.hoist(side, s);
          expect(h[0]).toBeGreaterThan(-LOCK.innerLipX - 10);
          expect(h[0]).toBeLessThan(-LOCK.westX + 5);
          expect(Math.sign(h[2])).toBe(side);
        }
        const leaf = g.leaf(s);
        expect(Math.hypot(...leaf.axis)).toBeCloseTo(1, 6);
        // The skin's centre is R from the trunnion.
        const t = toWorld([g === LOCK_GATE_SOUND.outer ? LOCK.outerTrunnionX : LOCK.innerTrunnionX, LOCK.trunnionY, 0]);
        expect(Math.hypot(leaf.at[0] - t[0], leaf.at[1] - t[1])).toBeCloseTo(LOCK.R, 4);
      }
      expect(LOCK_GATE_SOUND.outer.leaf(s).at[0]).toBeGreaterThan(LOCK_GATE_SOUND.inner.leaf(s).at[0]);
    }
    expect(LOCK_GATE_SOUND.outer.bolts).toBeNull();
    expect(WEST_GATE_SOUND.outer.bolts).not.toBeNull();
  });
});

describe('the craft’s sound', () => {
  it('is heard only under the Dome, or in the gate’s chamber once the inner gate opens', () => {
    expect(craftAudible({ zone: 'city', innerOpen: 0 })).toBe(true);
    expect(craftAudible({ zone: 'house', innerOpen: 0 })).toBe(true);
    expect(craftAudible({ zone: 'outside', innerOpen: 1 })).toBe(false);
    expect(craftAudible({ zone: 'chamber', innerOpen: 0 })).toBe(false);
    expect(craftAudible({ zone: 'chamber', innerOpen: 0.01 })).toBe(true);
  });
});
