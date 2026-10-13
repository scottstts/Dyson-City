import { describe, expect, it } from 'vitest';
import { COLLECTOR_TEMPERATURE, HEADER_TEMPERATURE, OFFLINE_TEMPERATURE, STRUCTURE_TEMPERATURE, glowRadiance, meanGlowRadiance } from '../src/sky/structure/thermal';
import { SURFACES } from '../src/sky/structure/enclosure';
import { STAR_DISC_MEAN_RADIANCE, luminance } from '../src/world/radiometry';

const starMean = luminance(...STAR_DISC_MEAN_RADIANCE);
const rel = (rgb: readonly number[]) => luminance(rgb[0], rgb[1], rgb[2]) / starMean;

describe('thermal glow of the shell', () => {
  it('rises steeply with temperature and runs red', () => {
    let prev = 0;
    for (const T of [1600, 2000, 2400, 2800, 3200]) {
      const g = rel(glowRadiance(T));
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    const c = glowRadiance(COLLECTOR_TEMPERATURE);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });

  it('keeps the collectors a dark bronze, the headers visible, offline tiles dark', () => {
    expect(rel(glowRadiance(COLLECTOR_TEMPERATURE))).toBeGreaterThan(0.002);
    expect(rel(glowRadiance(COLLECTOR_TEMPERATURE))).toBeLessThan(0.015);
    expect(rel(glowRadiance(STRUCTURE_TEMPERATURE))).toBeLessThan(rel(glowRadiance(COLLECTOR_TEMPERATURE)));
    expect(rel(glowRadiance(HEADER_TEMPERATURE))).toBeGreaterThan(0.03);
    expect(rel(glowRadiance(OFFLINE_TEMPERATURE))).toBeLessThan(1e-4);
  });

  it('nothing on the shell outshines the star: no line can saturate into a flickering neon', () => {
    // The hottest emitter on the structure stays far below the star's own radiance, per channel.
    const h = glowRadiance(HEADER_TEMPERATURE);
    for (let c = 0; c < 3; c++) expect(h[c]).toBeLessThan(STAR_DISC_MEAN_RADIANCE[c] * 0.15);
    for (const s of Object.values(SURFACES)) {
      if (!s.cls) continue;
      const e = 'emission' in s.cls ? (s.cls.emission as readonly number[]) : [0, 0, 0];
      for (let c = 0; c < 3; c++) expect(e[c] + s.cls.f0[c] * STAR_DISC_MEAN_RADIANCE[c]).toBeLessThan(STAR_DISC_MEAN_RADIANCE[c]);
    }
  });

  it('a varied surface glows brighter on average than a uniform one (glow is convex in T)', () => {
    const uniform = rel(glowRadiance(COLLECTOR_TEMPERATURE));
    const varied = rel(meanGlowRadiance(COLLECTOR_TEMPERATURE, 0.04));
    expect(varied).toBeGreaterThan(uniform);
    expect(varied / uniform).toBeLessThan(1.15);
  });
});
