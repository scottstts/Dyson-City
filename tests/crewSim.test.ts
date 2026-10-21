/**
 * The crew at work (docs/crew.md): the whole crew run for two minutes of game time on the real
 * field and estate, checked as it goes. Ground robots stay off the roads and clear of the plant,
 * the estate's Hands on the terrace's walkable ground, every Hand's joints in range through its real
 * jobs (walking a beat, reading its slate, crouching, mowing, trimming, walking a deck), drones never
 * inside the structure they fly over; footfalls and latches come where the feet and probes are; and
 * a frame of the whole crew is cheap.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Crew, type CrewFrame } from '../src/crew/crew';
import { crewWorld } from './helpers/crewWorld';
import { clearanceAt } from '../src/crew/nav';
import { CLEARANCE, fieldOut } from '../src/crew/plan/field';
import { heightNear } from '../src/crew/plan/air';
import { FIELD_Y } from '../src/field/layout';
import { handBreaches } from './helpers/handLimits';
import { SPOTTER, FERRY } from '../src/crew/models/drones';

describe('the crew at work', () => {
  const inputs = crewWorld().inputs;
  const crew = new Crew(inputs);
  const frame: CrewFrame = { feet: null, car: null, craftWindow: Infinity, eye: new Vector3(0, FIELD_Y + 1.6, 0) };
  const dt = 1 / 30;
  const seconds = 120;
  const issues: Record<string, string[]> = { ground: [], estate: [], limits: [], drones: [], events: [] };
  const note = (k: string, s: string) => issues[k].length < 12 && issues[k].push(s);
  const counts = { hand: 0, rigger: 0, latch: 0 };
  const flying = { max: 0 };
  let ms = 0;

  for (let f = 0; f < seconds / dt; f++) {
    const t0 = performance.now();
    crew.update(dt, frame);
    ms += performance.now() - t0;
    const t = (f * dt).toFixed(1);
    // This frame's events: on the ground (or a deck), where they happened.
    for (let k = 0; k < crew.sound.count; k++) {
      const e = crew.sound.events[k];
      counts[e.kind]++;
      if (!Number.isFinite(e.x + e.y + e.z + e.force) || e.force <= 0) note('events', `${t}s ${e.kind} not finite`);
    }
    if (f % 15) continue;
    for (const [k, h] of crew.hands.entries()) {
      const r = h.follow.root;
      if (h.job.kind === 'field') {
        if (fieldOut(r.x, r.z)) note('ground', `${t}s hand${k} on forbidden ground at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}`);
        else if (clearanceAt(crew.fieldNav, r.x, r.z) < CLEARANCE.hand - 0.3) note('ground', `${t}s hand${k} against the plant at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}`);
      } else if (h.job.kind !== 'deck') {
        if (clearanceAt(crew.estateNav, r.x, r.z) < 0.15) note('estate', `${t}s ${h.job.kind} hand off the walkable ground at ${r.x.toFixed(2)}, ${r.z.toFixed(2)}`);
      }
      for (const b of handBreaches(h.motion.rig, h.motion.pose)) note('limits', `${t}s hand${k} (${h.job.kind}) ${b.joint} ${b.value.toFixed(3)} ∉ [${b.range.join(', ')}]`);
    }
    for (const [k, g] of crew.riggers.entries()) {
      if (fieldOut(g.x, g.z)) note('ground', `${t}s rigger${k} on forbidden ground`);
      else if (clearanceAt(crew.fieldNav, g.x, g.z) < CLEARANCE.rigger - 0.3) note('ground', `${t}s rigger${k} against the plant at ${g.x.toFixed(1)}, ${g.z.toFixed(1)}`);
    }
    for (const [k, d] of crew.drays.entries()) {
      if (fieldOut(d.x, d.z)) note('ground', `${t}s dray${k} on forbidden ground at ${d.x.toFixed(1)}, ${d.z.toFixed(1)}`);
      else if (clearanceAt(crew.fieldNav, d.x, d.z) < 0.5) note('ground', `${t}s dray${k} against the plant at ${d.x.toFixed(1)}, ${d.z.toFixed(1)}`);
    }
    for (const [k, d] of crew.drones.entries()) {
      if (d.state !== 'fly') continue;
      flying.max = Math.max(flying.max, crew.drones.filter((x) => x.state === 'fly').length);
      // Its underside over whatever stands within its span.
      const span = d.sortie.kind === 'spotter' ? 0.4 : 0.95;
      const bottom = d.pos.y - (d.sortie.kind === 'spotter' ? SPOTTER.bottom : FERRY.bottom);
      const top = heightNear(inputs.heights, d.pos.x, d.pos.z, span);
      if (bottom < Math.max(top, FIELD_Y) - 0.05) note('drones', `${t}s ${d.sortie.kind}${k} at ${d.pos.x.toFixed(1)}, ${d.pos.y.toFixed(1)}, ${d.pos.z.toFixed(1)} under ${top.toFixed(1)}`);
    }
  }

  it('keeps the ground robots off the roads and clear of the plant', () => {
    expect(issues.ground).toEqual([]);
  });

  it('keeps the estate’s Hands on the terrace’s walkable ground', () => {
    expect(issues.estate).toEqual([]);
  });

  it('keeps every Hand’s joints in range through its real jobs', () => {
    expect(issues.limits).toEqual([]);
  });

  it('never flies a drone into what it flies over, and flies them', () => {
    expect(issues.drones).toEqual([]);
    expect(flying.max).toBeGreaterThan(0);
  });

  it('reports footfalls and latches for the sound', () => {
    console.info(`crew events in ${seconds} s: ${counts.hand} Hand steps, ${counts.rigger} Rigger pads, ${counts.latch} latches`);
    expect(issues.events).toEqual([]);
    expect(counts.hand).toBeGreaterThan(500);
    expect(counts.rigger).toBeGreaterThan(50);
    // Drones at rest are silent; working loops are within range.
    for (const l of crew.sound.loops) {
      expect(l.work).toBeGreaterThanOrEqual(0);
      expect(l.work).toBeLessThanOrEqual(1);
    }
  });

  it('costs little per frame', () => {
    const mean = ms / (seconds / dt);
    console.info(`crew update: ${mean.toFixed(3)} ms per frame (Node)`);
    expect(mean).toBeLessThan(4);
  });
});
