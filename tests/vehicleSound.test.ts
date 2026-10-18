/**
 * The East Lock's gate sounds come from its own machinery (audio/sounds/gate.ts LOCK_GATE_SOUND):
 * its hoists and the middle of its leaves' skins, in the world, at each openness.
 */
import { describe, expect, it } from 'vitest';
import { LOCK_GATE_SOUND, WEST_GATE_SOUND } from '../src/audio/sounds/gate';
import { craftAudible } from '../src/audio/sounds/vehicles';
import { LOCK, toWorld } from '../src/city/eastLock/spec';
import { slapShare } from '../src/audio/acoustics';
import { REVERBS, synthesizeImpulse } from '../src/audio/reverb';
import { DOME_SEND } from '../src/audio/mix';

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

describe('the Dome-wide sources', () => {
  it('fall with distance across the whole Dome, even beside a wall', () => {
    // Steady power at the ears relative to the source's level at its size (the craft's 8 m), for a
    // listener 2.5 m from a big face (the slap's strongest): direct 1/d, the slap's share, and the
    // city's reverberation at the Dome-wide send.
    const [l] = synthesizeImpulse(REVERBS.city, 16000, 37);
    let reverb = 0;
    for (const v of l) reverb += v * v;
    const path = 2 * 2.5;
    const level = (d: number) => {
      const slap = (DOME_SEND * 0.8 * slapShare(path, d)) / path;
      return 10 * Math.log10((8 / d) ** 2 + slap ** 2 + DOME_SEND ** 2 * reverb);
    };
    const ds = [20, 50, 100, 200, 400, 700, 1000];
    for (let i = 1; i < ds.length; i++) expect(level(ds[i])).toBeLessThan(level(ds[i - 1]) - 1);
    expect(level(1000)).toBeLessThan(level(30) - 25);
    // A source at the listener keeps its whole slap (footsteps by the house's walls).
    expect(slapShare(path, 1.6)).toBe(1);
  });
});
