/**
 * The crew's plan (docs/crew.md): every robot that should exist does, works where it belongs, and
 * its routes keep their clearance. Built on the real field and estate.
 */
import { describe, expect, it } from 'vitest';
import { Crew } from '../src/crew/crew';
import { crewWorld } from './helpers/crewWorld';
import { clearanceAt } from '../src/crew/nav';
import { CLEARANCE, fieldOut } from '../src/crew/plan/field';

describe('the crew plan', () => {
  const crew = new Crew(crewWorld().inputs);

  it('staffs the compound and the garden', () => {
    const field = crew.hands.filter((h) => h.job.kind === 'field').length;
    const estate = crew.hands.filter((h) => ['mow', 'hedge', 'garden'].includes(h.job.kind)).length;
    const decks = crew.hands.filter((h) => h.job.kind === 'deck').length;
    console.info(`field Hands ${field}, deck ${decks}, estate ${estate}; Riggers ${crew.riggers.length}, Drays ${crew.drays.length}, Linewalkers ${crew.linewalkers.length}, drones ${crew.drones.length}`);
    expect(estate).toBe(3);
    expect(decks).toBe(4);
    expect(field).toBeGreaterThanOrEqual(14);
    expect(crew.riggers.length).toBeGreaterThanOrEqual(6);
    expect(crew.drays.length).toBeGreaterThanOrEqual(6);
    expect(crew.linewalkers.length).toBe(16);
    expect(crew.drones.filter((d) => d.sortie.kind === 'spotter').length).toBe(12);
    expect(crew.drones.filter((d) => d.sortie.kind === 'ferry').length).toBe(4);
  });

  it('keeps every ground route off the roads and clear of the plant', () => {
    const bad: string[] = [];
    const check = (name: string, pts: [number, number][], c: number) => {
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
        for (let k = 0; k <= n; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / n;
          const z = a[1] + ((b[1] - a[1]) * k) / n;
          if (fieldOut(x, z) || clearanceAt(crew.fieldNav, x, z) < c - 0.26) {
            if (bad.length < 12) bad.push(`${name} at ${x.toFixed(1)}, ${z.toFixed(1)}`);
            return;
          }
        }
      }
    };
    crew.hands.forEach((h, k) => {
      if (h.job.kind === 'field') h.job.beat.legs.forEach((l, i) => check(`hand${k}.leg${i}`, l, CLEARANCE.hand));
    });
    crew.riggers.forEach((r, k) => r['beat' as never] && (r as unknown as { beat: { legs: [number, number][][] } }).beat.legs.forEach((l, i) => check(`rigger${k}.leg${i}`, l, CLEARANCE.rigger)));
    // A Dray's rounded corners cut in by up to a metre: its body (0.9 m half-width) must still clear.
    crew.drays.forEach((d, k) => (d as unknown as { legs: [number, number][][] }).legs.forEach((l, i) => check(`dray${k}.leg${i}`, l, 1.0)));
    expect(bad).toEqual([]);
  });
});
