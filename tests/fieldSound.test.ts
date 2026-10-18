import { describe, expect, it } from 'vitest';
import { fieldSoundSources } from '../src/field/sources';
import { FIELD_AUDIBLE, machineLevel } from '../src/audio/sounds/field';
import { ESTATE, ESTATE_GATEWAY, FIELD_Y, HOUSE_SITE } from '../src/field/layout';
import { fieldGain } from '../src/estate/silencer';

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

describe('field sound is local', () => {
  const sources = fieldSoundSources();
  const at = (x: number, z: number) => sources.map((s) => ({ name: s.name, level: machineLevel(s, 0, x, FIELD_Y + 1.7, z) })).sort((a, b) => b.level - a.level);

  it('by the house and at the drum no machine is near enough to be loud', () => {
    for (const [x, z] of [[-372, -90], [-380, -150], [-60, 470]]) {
      const top = at(x, z)[0];
      expect(db(top.level), `${top.name} at ${x},${z}`).toBeLessThan(db(FIELD_AUDIBLE) + 14);
    }
  });

  it('next to a machine, that machine dominates by a wide margin; only its own precinct is audible', () => {
    const pump = sources.find((s) => s.kind === 'pump')!;
    const p: [number, number, number] = [0, 0, 0];
    pump.at(0, p);
    const near = at(p[0] + 6, p[2]);
    expect(near[0].name).toBe(pump.name);
    expect(db(near[0].level) - db(near[1].level)).toBeGreaterThan(12);
    // What else you hear is the precinct you stand in (within ~150 m), never the far side of the compound.
    const q: [number, number, number] = [0, 0, 0];
    for (const s of sources) {
      if (machineLevel(s, 0, p[0] + 6, FIELD_Y + 1.7, p[2]) <= FIELD_AUDIBLE) continue;
      s.at(0, q);
      expect(Math.hypot(q[0] - p[0] - 6, q[2] - p[2]), s.name).toBeLessThan(160);
    }
  });
});

describe('the estate silencer', () => {
  it('takes the machines away within the walls, fading across the wall', () => {
    const gate = (ESTATE_GATEWAY.x0 + ESTATE_GATEWAY.x1) / 2;
    // In the house and deep in the garden: gone. Out in the field: full.
    expect(fieldGain(HOUSE_SITE[0], HOUSE_SITE[1])).toBe(0);
    expect(fieldGain(-330, -100)).toBe(0);
    expect(fieldGain(-200, -100)).toBe(1);
    expect(fieldGain(0, 0)).toBe(1);
    // Walking out through the gateway (south), it rises smoothly: no step between samples.
    let prev = fieldGain(gate, ESTATE.south - 20);
    expect(prev).toBe(0);
    for (let z = ESTATE.south - 20; z <= ESTATE.south + 10; z += 0.25) {
      const g = fieldGain(gate, z);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(g - prev).toBeLessThan(0.06);
      prev = g;
    }
    expect(prev).toBe(1);
    // At the wall face it is partly there: neither cut nor full.
    const at = fieldGain(gate, ESTATE.south);
    expect(at).toBeGreaterThan(0.2);
    expect(at).toBeLessThan(0.9);
  });
});
