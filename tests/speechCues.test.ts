import { describe, expect, it } from 'vitest';
import { PAD_AREA_R, PAD_REPEAT, PORTAL_HALF, SpeechCues, type CueInput } from '../src/audio/speechCues';
import { CORDON, ESTATE_GATEWAY } from '../src/field/layout';
import { estateDistance } from '../src/estate/silencer';

const base: CueInput = { x: -440, z: 0, driven: false, craft: null };

/** Steps the cues along a straight walk; returns every announcement made. */
function walk(cues: SpeechCues, from: [number, number], to: [number, number], extra: Partial<CueInput> = {}): string[] {
  const out: string[] = [];
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push(...cues.update(1 / 60, { ...base, ...extra, x: from[0] + (to[0] - from[0]) * f, z: from[1] + (to[1] - from[1]) * f }));
  }
  return out;
}

describe('announcement cues', () => {
  it('announces the compound once on crossing the portal eastward, and again only after going back out', () => {
    const cues = new SpeechCues();
    expect(walk(cues, [-440, 0], [-380, 2])).toEqual(['enter-compound']);
    // Lingering on the line, or stepping back a little, repeats nothing.
    expect(walk(cues, [-380, 2], [CORDON.frontX - 1, 0])).toEqual([]);
    expect(walk(cues, [CORDON.frontX - 1, 0], [-380, 0])).toEqual([]);
    expect(walk(cues, [-380, 0], [-440, 0])).toEqual([]);
    expect(walk(cues, [-440, 0], [-380, 0])).toEqual(['enter-compound']);
  });

  it('only crosses the threshold between the portal pylons', () => {
    const cues = new SpeechCues();
    expect(PORTAL_HALF).toBeGreaterThan(10);
    expect(walk(cues, [-440, PORTAL_HALF + 3], [-380, PORTAL_HALF + 3])).toEqual([]);
  });

  it('announces the estate on walking in through its gateway, never at the start inside it', () => {
    const gx = (ESTATE_GATEWAY.x0 + ESTATE_GATEWAY.x1) / 2;
    expect(estateDistance(gx, ESTATE_GATEWAY.z - 6)).toBeLessThan(0);
    const cues = new SpeechCues();
    expect(walk(cues, [gx, -10], [gx, ESTATE_GATEWAY.z - 8])).toEqual(['enter-estate']);
    const inside = new SpeechCues();
    expect(walk(inside, [gx, ESTATE_GATEWAY.z - 20], [gx, ESTATE_GATEWAY.z - 8])).toEqual([]);
  });

  it('announces the drive as the car is taken', () => {
    const cues = new SpeechCues();
    expect(cues.update(1 / 60, base)).toEqual([]);
    expect(cues.update(1 / 60, { ...base, driven: true })).toEqual(['drive']);
    expect(cues.update(1 / 60, { ...base, driven: true })).toEqual([]);
  });

  it('announces the pad only while the craft and the listener are both over its circle', () => {
    const over = { x: 0, z: 0 };
    const count = (craft: { x: number; z: number } | null, x: number, z: number, seconds: number, cues = new SpeechCues()) => {
      let n = 0;
      for (let i = 0; i < 60 * seconds; i++) n += cues.update(1 / 60, { ...base, x, z, craft }).length;
      return n;
    };
    // Both over it: at once, then every PAD_REPEAT.
    expect(count(over, 30, 40, 12.4)).toBe(1 + Math.floor(12.4 / PAD_REPEAT));
    // On the white apron counts; beyond the ring road does not.
    expect(count(over, PAD_AREA_R - 2, 0, 1)).toBe(1);
    expect(count(over, PAD_AREA_R + 2, 0, 12)).toBe(0);
    // The craft away from the pad (in its corridor, or not here).
    expect(count({ x: 300, z: 0 }, 0, 10, 12)).toBe(0);
    expect(count(null, 0, 10, 12)).toBe(0);
    // Walking onto the pad with no craft announces nothing.
    expect(walk(new SpeechCues(), [0, 140], [0, 10])).toEqual([]);
    // Either condition ending stops the repeats: none begins after the listener leaves.
    const cues = new SpeechCues();
    expect(count(over, 0, 10, 1, cues)).toBe(1);
    expect(count(over, 0, PAD_AREA_R + 10, 10, cues)).toBe(0);
    // Coming back starts again at once.
    expect(count(over, 0, 10, 0.1, cues)).toBe(1);
  });
});
