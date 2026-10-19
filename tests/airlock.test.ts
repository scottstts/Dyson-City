import { describe, expect, it } from 'vitest';
import { Airlock, TIMING } from '../src/city/gate/airlock';
import { GATE } from '../src/city/gate/spec';

/** Walks a player east or west along the axis, waiting at closed gates; returns the time taken. */
function walk(lock: Airlock, from: number, to: number, check: (l: Airlock) => void, maxT = 120): number {
  const dt = 1 / 60;
  let x = from;
  let t = 0;
  const dir = Math.sign(to - from);
  while ((to - x) * dir > 0 && t < maxT) {
    const nx = x + dir * 2 * dt;
    // The leaves block until fully open.
    const blockedOuter = !lock.outer.isOpen && (x - (GATE.outerLipX - 0.6)) * (nx - (GATE.outerLipX - 0.6)) <= 0 && dir > 0;
    const blockedOuterBack = !lock.outer.isOpen && (x - (GATE.outerLipX + 0.6)) * (nx - (GATE.outerLipX + 0.6)) <= 0 && dir < 0;
    const blockedInner = !lock.inner.isOpen && (x - (GATE.innerLipX - 0.6)) * (nx - (GATE.innerLipX - 0.6)) <= 0 && dir > 0;
    const blockedInnerBack = !lock.inner.isOpen && (x - (GATE.innerLipX + 0.6)) * (nx - (GATE.innerLipX + 0.6)) <= 0 && dir < 0;
    if (!(blockedOuter || blockedOuterBack || blockedInner || blockedInnerBack)) x = nx;
    lock.update(dt, { x, z: 0 });
    check(lock);
    t += dt;
  }
  return t;
}

const neverBothOpen = (l: Airlock) => expect(l.outer.openness > 0 && l.inner.openness > 0).toBe(false);

describe('west gate airlock', () => {
  it('cycles a player in from the band and out again, never opening both gates', () => {
    const lock = new Airlock();
    let sawMist = 0;
    const tIn = walk(lock, -560, -440, neverBothOpen);
    expect(tIn).toBeLessThan(120);
    expect(lock.pressure).toBe(1);
    // Wait in the city until the inner gate has shut behind.
    for (let i = 0; i < 60 * 15; i++) lock.update(1 / 60, { x: -400, z: 0 });
    expect(lock.inner.isClosedAndBolted).toBe(true);
    const tOut = walk(lock, -400, -560, (l) => {
      neverBothOpen(l);
      sawMist = Math.max(sawMist, l.mist);
    });
    expect(tOut).toBeLessThan(140);
    expect(lock.pressure).toBe(0);
    expect(sawMist).toBeGreaterThan(0.5);
  });

  it('only changes the chamber pressure while both gates are shut and bolted', () => {
    const lock = new Airlock();
    let prev = lock.pressure;
    let wasSealed = true;
    walk(lock, -540, -440, (l) => {
      // Judged on the state the step started from (the gate that opens next unbolts in the step
      // the chamber reaches its pressure).
      if (l.pressure !== prev) expect(wasSealed).toBe(true);
      prev = l.pressure;
      wasSealed = l.outer.isClosedAndBolted && l.inner.isClosedAndBolted;
    });
  });

  it('a closing gate reverses if the player steps back into its sweep', () => {
    const lock = new Airlock();
    for (let i = 0; i < 60 * 20; i++) lock.update(1 / 60, { x: -505, z: 0 });
    expect(lock.outer.isOpen).toBe(true);
    // Walk away so it starts to close, then step back under it.
    for (let i = 0; i < 60 * 6; i++) lock.update(1 / 60, { x: -540, z: 0 });
    expect(lock.outer.phase === 'closing' || lock.outer.phase === 'bolting' || lock.outer.phase === 'closed').toBe(true);
    if (lock.outer.phase === 'closing') {
      lock.update(1 / 60, { x: -499.2, z: 0 });
      lock.update(1 / 60, { x: -499.2, z: 0 });
      expect(lock.outer.phase).toBe('opening');
    }
  });
});

describe('chamber lamps', () => {
  it('face into the chamber (three lights the side its local +Z faces)', async () => {
    const { createLamps } = await import('../src/city/gate/lighting');
    const { Vector3 } = await import('three');
    const centre = new Vector3((GATE.outerLipX + GATE.innerLipX) / 2, 12, 0);
    for (const lamp of createLamps()) {
      const z = new Vector3(0, 0, 1).applyQuaternion(lamp.quaternion);
      const toCentre = centre.clone().sub(lamp.position);
      // Uplights face the vault above them; every other lamp faces the chamber's middle.
      if (z.y > 0.9) expect(lamp.position.y).toBeGreaterThan(20);
      else expect(z.dot(toCentre)).toBeGreaterThan(0);
    }
  });
});

describe('west gate announcements', () => {
  const LEN = { enter: 2.6, pressurize: 2.0, depressurize: 2.2, exit: 2.3 };
  const announced = () => {
    const lock = new Airlock();
    Object.assign(lock.announce, LEN);
    return lock;
  };

  it('opens to the band only after the enter announcement and its pause', () => {
    const lock = announced();
    const dt = 1 / 60;
    let t = 0;
    let unboltAt = -1;
    while (t < 10 && unboltAt < 0) {
      lock.update(dt, { x: -505, z: 0 });
      t += dt;
      if (lock.outer.phase !== 'closed') unboltAt = t;
    }
    expect(lock.announcement.cue).toBe('enter');
    expect(lock.announcement.count).toBe(1);
    expect(unboltAt).toBeGreaterThan(LEN.enter + TIMING.announceGap - 0.05);
    expect(unboltAt).toBeLessThan(LEN.enter + TIMING.announceGap + 0.2);
  });

  it('announces each step of a walk in and out, in order, and holds the cycle for them', () => {
    const lock = announced();
    const cues: string[] = [];
    let count = 0;
    let pressureAtCue = -1;
    const watch = (l: Airlock) => {
      if (l.announcement.count !== count) {
        count = l.announcement.count;
        cues.push(l.announcement.cue!);
        pressureAtCue = l.pressure;
      }
      // Nothing moves while a held announcement plays.
      const a = l.announcement;
      if (a.cue === 'pressurize' && a.t < LEN.pressurize) expect(l.pressure).toBe(0);
      if (a.cue === 'depressurize' && a.t < LEN.depressurize) expect(l.pressure).toBe(1);
      neverBothOpen(l);
    };
    walk(lock, -560, -440, watch);
    expect(cues).toEqual(['enter', 'pressurize']);
    expect(pressureAtCue).toBe(0);
    for (let i = 0; i < 60 * 15; i++) lock.update(1 / 60, { x: -400, z: 0 });
    walk(lock, -400, -560, watch);
    for (let i = 0; i < 60 * 15; i++) {
      lock.update(1 / 60, { x: -560, z: 0 });
      watch(lock);
    }
    expect(cues).toEqual(['enter', 'pressurize', 'depressurize', 'exit']);
    expect(lock.outer.isClosedAndBolted).toBe(true);
  });

  it('does not announce the exit when an approach from the band ends without anyone passing', () => {
    const lock = announced();
    for (let i = 0; i < 60 * 20; i++) lock.update(1 / 60, { x: -505, z: 0 });
    expect(lock.outer.isOpen).toBe(true);
    for (let i = 0; i < 60 * 20; i++) lock.update(1 / 60, { x: -560, z: 0 });
    expect(lock.outer.isClosedAndBolted).toBe(true);
    expect(lock.announcement.count).toBe(1);
  });
});
