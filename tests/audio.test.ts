import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import { airCutoff, aperture, facadePath, gatePath, mediumFactor, transmission, wallDistance, zoneAt } from '../src/audio/acoustics';
import { H } from '../src/estate/layout';
import { BANDS, REVERBS, synthesizeImpulse } from '../src/audio/reverb';
import { Biquad, energyDecayDb, filter, peak, rng, t60FromDecay } from '../src/audio/dsp';
import { FOOT_GAITS, FOOT_SURFACES, synthFootstep } from '../src/audio/synth/footstep';
import { synthTick } from '../src/audio/synth/house';
import { synthValve } from '../src/audio/synth/valve';
import { addPrint, BAND_COUNT, printLength, synthTexture, texturePsd, THIRD_OCTAVES, type SpectralPrint } from '../src/audio/synth/spectral';
import { buildAudioBank } from '../src/audio/bank';
import { VariantPicker } from '../src/audio/sounds/oneShot';
import { floorSurface } from '../src/house/floors';
import { VAULT_SHUT } from '../src/audio/models/vaultShut';
import { HYDRAULIC_STOP } from '../src/audio/models/hydraulicStop';
import { HYDRAULIC_RUN } from '../src/audio/models/hydraulicRun';
import { FOOTSTEP_WALK } from '../src/audio/models/footsteps';
import { bandLevels } from '../tools/soundModel';
import { AirlockWatcher } from '../src/audio/airlockEvents';
import { Airlock } from '../src/city/gate/airlock';
import { GATE } from '../src/city/gate/spec';
import { PlayerController, type FootEvent } from '../src/player/controller';
import type { Input } from '../src/player/input';
import type { GroundSurface } from '../src/city/walk';

const SR = 48000;

function finite(x: Float32Array): boolean {
  for (const v of x) if (!Number.isFinite(v)) return false;
  return true;
}

function energy(x: Float32Array, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return e;
}

function band(x: Float32Array, lo: number, hi: number): number {
  const y = Float32Array.from(x);
  new Biquad('highpass', lo, 0.7, SR).process(y);
  new Biquad('lowpass', hi, 0.7, SR).process(y);
  return energy(y);
}

describe('acoustic spaces', () => {
  it('places points in the band, the chamber and the city', () => {
    expect(zoneAt(-540, 0)).toBe('outside');
    expect(zoneAt(-486, 0)).toBe('chamber');
    expect(zoneAt(-460, 0)).toBe('city');
    expect(zoneAt(0, 0)).toBe('city');
    expect(zoneAt(0, 600)).toBe('outside');
  });

  it('passes nothing but a low rumble through a shut leaf, everything through an open one', () => {
    const shut = gatePath(0);
    expect(shut.gain).toBeLessThan(0.01);
    expect(shut.cutoff).toBeLessThan(300);
    const open = gatePath(1);
    expect(open.gain).toBeGreaterThan(0.95);
    expect(open.cutoff).toBeGreaterThan(15000);
    let prev = aperture(0);
    for (let h = 0.01; h < 15; h += 0.25) {
      const p = aperture(h);
      expect(p.gain).toBeGreaterThanOrEqual(prev.gain);
      expect(p.cutoff).toBeGreaterThanOrEqual(prev.cutoff);
      prev = p;
    }
  });

  it('couples the band and the city only through the glass while the gates are shut', () => {
    const p = transmission('outside', 'city', 0, 0);
    expect(p.gain).toBeLessThan(0.01);
    expect(transmission('chamber', 'chamber', 0, 0).gain).toBe(1);
    expect(transmission('outside', 'chamber', 1, 0).gain).toBeGreaterThan(0.95);
    expect(transmission('outside', 'chamber', 0, 1).gain).toBeLessThan(0.01);
  });

  it('carries sound 5 dB quieter in the band’s 0.55 bar air and dulls it with distance', () => {
    expect(20 * Math.log10(mediumFactor('outside', 1))).toBeCloseTo(-5.2, 1);
    expect(mediumFactor('chamber', 0.8)).toBe(0.8);
    expect(airCutoff('city', 300)).toBeLessThan(airCutoff('city', 30));
    expect(airCutoff('outside', 100)).toBeLessThan(airCutoff('city', 100));
  });

  it('keeps the slap’s wall distance continuous through the gatehouse (no jump, no near-zero)', () => {
    for (const zone of ['outside', 'city'] as const) {
      let prev = wallDistance(zone, -560, 0);
      for (let x = -560; x <= -440; x += 0.05) {
        const d = wallDistance(zone, x, 0);
        expect(d).toBeGreaterThanOrEqual(2.5);
        expect(Math.abs(d - prev)).toBeLessThan(0.2);
        prev = d;
      }
    }
  });
});

describe('the house', () => {
  it('hears the estate through its shell: faint and dull shut, nearly open with an outer door wide', () => {
    const shut = transmission('city', 'house', 0, 0, 0);
    expect(20 * Math.log10(shut.gain)).toBeLessThan(-25);
    expect(shut.cutoff).toBeLessThan(1000);
    const open = transmission('house', 'city', 0, 0, 1);
    expect(open.gain).toBeGreaterThan(0.4);
    expect(open.cutoff).toBeGreaterThan(15000);
    // A door ajar already lets a good deal through.
    expect(facadePath(0.1).gain).toBeGreaterThan(5 * shut.gain);
    // To the band: the shell and then the Dome's glass.
    expect(transmission('house', 'outside', 0, 0, 1).gain).toBeLessThan(0.01);
    expect(mediumFactor('house', 0.55)).toBe(1);
  });

  it('returns a slap off its walls to the terrace, continuously, never nearer than 2.5 m', () => {
    const [x0, z0] = H(0, 12);
    const [x1, z1] = H(0, 40);
    let prev = wallDistance('city', x0, z0);
    expect(prev).toBeLessThan(10);
    for (let i = 1; i <= 400; i++) {
      const d = wallDistance('city', x0 + ((x1 - x0) * i) / 400, z0 + ((z1 - z0) * i) / 400);
      expect(d).toBeGreaterThanOrEqual(2.5);
      expect(Math.abs(d - prev)).toBeLessThan(0.2);
      prev = d;
    }
    // The house is no zone of its own in plan (its rooms are: AudioEngine.locate).
    expect(zoneAt(x0, z0)).toBe('city');
  });

  it('beats its clocks as tick and tock: same modes, a different blow', () => {
    for (const kind of ['longcase', 'mantel'] as const) {
      const tick = synthTick(kind, 0, SR, 1);
      const tock = synthTick(kind, 1, SR, 2);
      expect(finite(tick) && finite(tock)).toBe(true);
      expect(band(tock, 3000, 12000) / energy(tock)).toBeLessThan(band(tick, 3000, 12000) / energy(tick));
    }
    // The longcase's trunk: a deeper body than the mantel clock's case.
    const low = (x: Float32Array) => band(x, 80, 400) / energy(x);
    expect(low(synthTick('longcase', 0, SR, 3))).toBeGreaterThan(low(synthTick('mantel', 0, SR, 3)));
  });
});

describe('impulse responses', () => {
  const irs = { chamber: synthesizeImpulse(REVERBS.chamber, SR, 1), city: synthesizeImpulse(REVERBS.city, SR, 2), outside: synthesizeImpulse(REVERBS.outside, SR, 3), house: synthesizeImpulse(REVERBS.house, SR, 4) };

  it('are finite and fade out', () => {
    for (const [l, r] of Object.values(irs)) {
      expect(finite(l) && finite(r)).toBe(true);
      expect(Math.abs(l[l.length - 1])).toBeLessThan(1e-4);
    }
  });

  it('decay at the specified rate (1 kHz octave, chamber, city and house)', () => {
    for (const zone of ['chamber', 'city', 'house'] as const) {
      const x = Float32Array.from(irs[zone][0]);
      new Biquad('bandpass', 1000, 1.41, SR).process(x);
      new Biquad('bandpass', 1000, 1.41, SR).process(x);
      const t60 = t60FromDecay(energyDecayDb(x), SR);
      const spec = REVERBS[zone].t60[BANDS.indexOf(1000)];
      expect(t60).toBeGreaterThan(spec * 0.8);
      expect(t60).toBeLessThan(spec * 1.2);
    }
  });

  it('return the stone chamber loud and the vast Dome faint (diffuse-field level)', () => {
    const e = (z: keyof typeof irs) => energy(irs[z][0]);
    expect(e('chamber')).toBeGreaterThan(REVERBS.chamber.energy * 0.9);
    expect(e('chamber') / e('city')).toBeGreaterThan(30);
    expect(e('outside')).toBeLessThan(e('city'));
  });
});

describe('cloned sounds', () => {
  /**
   * Mean absolute error (dB), over bands within 30 dB of the loudest, between each band's energy over
   * the whole event as the print states it and as its resynthesis measures (the synthesis' calibration).
   */
  function printError(p: SpectralPrint): number {
    const step = 0.005;
    const times: number[] = [];
    for (let t = 0; t < printLength(p); t += step) times.push(t);
    const want = new Array<number>(BAND_COUNT).fill(0);
    for (let k = 0; k + 1 < p.times.length; k++) {
      const dt = p.times[k + 1] - p.times[k];
      p.levels[k].forEach((lv, b) => (want[b] += Math.pow(10, lv / 10) * dt));
    }
    for (const [, strike, contact] of p.onsets ?? []) strike.forEach((lv, b) => lv > -150 && (want[b] += Math.pow(10, lv / 10) * (Math.min(0.025, Math.max(0.0015, 2 / (THIRD_OCTAVES[b] / 1.6))) + (contact ?? 0))));
    const got = new Array<number>(BAND_COUNT).fill(0);
    for (let s = 0; s < 2; s++) {
      const y = new Float32Array(Math.ceil((printLength(p) + 0.5) * SR));
      addPrint(y, p, SR, rng(90 + s), { at: 0.2 });
      bandLevels({ x: y, sr: SR }, times.map((t) => t + 0.2)).forEach((row) => row.forEach((db, b) => (got[b] += (Math.pow(10, db / 10) * step) / 2)));
    }
    const top = Math.max(...want.map((v) => 10 * Math.log10(v)));
    let sum = 0;
    let n = 0;
    want.forEach((w, b) => {
      if (10 * Math.log10(w) < top - 30 || THIRD_OCTAVES[b] < 40) return;
      sum += Math.abs(10 * Math.log10(got[b] / w));
      n++;
    });
    return sum / n;
  }

  it('resynthesise their prints at the stated level (the dense door shut, the lift stop, a step)', () => {
    expect(printError(VAULT_SHUT[0])).toBeLessThan(2);
    expect(printError(HYDRAULIC_STOP[0])).toBeLessThan(2);
    expect(printError(FOOTSTEP_WALK[0])).toBeLessThan(5);
  });

  it('loop a texture seamlessly at its modelled spectrum', () => {
    const y = synthTexture(HYDRAULIC_RUN, 17, SR, rng(4));
    expect(finite(y)).toBe(true);
    let ms = 0;
    for (const v of y) ms += v * v;
    const rmsY = Math.sqrt(ms / y.length);
    // Periodic: the wrap is no bigger a step than any other.
    expect(Math.abs(y[0] - y[y.length - 1])).toBeLessThan(4 * rmsY);
    // The pump's 448 Hz line stands ~20 dB over its floor, its harmonics far less: a machine, not a siren.
    const line = (f: number) => 10 * Math.log10(texturePsd(HYDRAULIC_RUN, f));
    expect(line(448) - line(420)).toBeGreaterThan(12);
    expect(line(448) - line(896)).toBeGreaterThan(12);
  });

  it('builds a bank at the requested rate, scaled as documented', () => {
    const bank = buildAudioBank(SR);
    expect(bank.sampleRate).toBe(SR);
    const mean = bank.footsteps['stone:walk'].reduce((m, x) => m + peak(x), 0) / bank.footsteps['stone:walk'].length;
    expect(mean).toBeCloseTo(1, 5);
    for (const loop of [bank.hydraulicRun, bank.leafRumble]) {
      let ms = 0;
      for (const v of loop) ms += v * v;
      expect(Math.sqrt(ms / loop.length)).toBeCloseTo(1, 3);
    }
    for (const x of [...Object.values(bank.footsteps).flat(), bank.hydraulicStart, ...bank.hydraulicStop, ...bank.leafShut, ...bank.latch, bank.valveOpen, bank.valveClose, ...bank.door.open, ...bank.door.shut, ...Object.values(bank.ticks).flat(2)]) {
      expect(finite(x)).toBe(true);
      expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-2 * peak(x));
    }
    // The door: the shut peaks at 1, its strike inside it and near its peak; the open quieter, as recorded.
    const shut = bank.door.shut[0];
    let at = 0;
    for (let i = 0; i < shut.length; i++) if (Math.abs(shut[i]) > Math.abs(shut[at])) at = i;
    expect(Math.abs(at / SR - bank.door.strike)).toBeLessThan(0.06);
    expect(peak(bank.door.open[0])).toBeLessThan(0.5);
    // The crew's walkers: every floor each meets, all its variants, finite and decayed; a Hand's step
    // on stone near the player's (the same recording, made metal).
    for (const [key, list] of Object.entries(bank.robotSteps)) {
      expect(list.length, key).toBe(5);
      for (const x of list) {
        expect(finite(x)).toBe(true);
        expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-2 * peak(x));
      }
    }
    const handStone = bank.robotSteps['hand:stone'].reduce((m, x) => m + peak(x), 0) / 5;
    expect(20 * Math.log10(handStone)).toBeGreaterThan(-6);
    expect(20 * Math.log10(handStone)).toBeLessThan(6);
    // The vehicles', the drone's and the field machines' loops are seamless at RMS 1, and seconds
    // long: their tonal lines are a few hertz wide (a 21 ms field loop once buzzed at 47 Hz).
    for (const loop of [bank.car, bank.craft, bank.drone, ...Object.values(bank.field)]) {
      expect(finite(loop)).toBe(true);
      expect(loop.length / SR).toBeGreaterThan(4);
      let ms = 0;
      let step = 0;
      for (let i = 0; i < loop.length; i++) {
        ms += loop[i] * loop[i];
        if (i > 0) step = Math.max(step, Math.abs(loop[i] - loop[i - 1]));
      }
      expect(Math.sqrt(ms / loop.length)).toBeCloseTo(1, 3);
      // Periodic: the wrap is no bigger a step than the loop's own (clicks make big steps anywhere).
      expect(Math.abs(loop[0] - loop[loop.length - 1])).toBeLessThanOrEqual(step);
    }
    // The car's knocks peak at 1 and ring down within their length.
    for (const k of bank.impact) {
      expect(peak(k)).toBeCloseTo(1, 6);
      const tail = k.subarray(Math.round(k.length * 0.9));
      expect(peak(tail)).toBeLessThan(0.01);
    }
    // A walking step on turf is quieter than on stone; on gravel, louder than on turf.
    const loud = (k: keyof typeof bank.footsteps) => bank.footsteps[k].reduce((m, x) => m + band(x, 250, 16000), 0);
    expect(loud('grass:walk')).toBeLessThan(loud('stone:walk') / 4);
    expect(loud('gravel:walk')).toBeGreaterThan(loud('grass:walk'));
    // A walk on the house's floors has every recorded step, at levels a dB or two apart (the
    // recording's 17 dB spread was its microphone's distance).
    for (const k of ['wood:walk', 'rug:walk'] as const) {
      const db = bank.footsteps[k].map((x) => 10 * Math.log10(energy(x)));
      expect(db.length).toBeGreaterThanOrEqual(20);
      expect(Math.max(...db) - Math.min(...db)).toBeLessThan(6);
    }
  }, 30000);
});

describe('footsteps', () => {
  const surfaces = FOOT_SURFACES;

  it('know two floors in the house: hard and soft', () => {
    const inside = ['floor_oak', 'floor_parquet', 'floor_pine', 'oak_tread', 'oak_threshold', 'floor_encaustic', 'floor_flag', 'marble_hearth', 'tile_hex', 'brick'];
    for (const m of inside) expect(floorSurface(m)).toBe('wood');
    for (const m of ['rug_parlour', 'stair_runner', 'coir_mat']) expect(floorSurface(`${m}__gltf`)).toBe('rug');
    // Outdoors: the dressed sandstone steps and the porches' boards.
    expect(floorSurface('sandstone')).toBe('stone');
    expect(floorSurface('porch_floor')).toBe('boards');
  });

  it('never return to a step within half the variants', () => {
    const picker = new VariantPicker(rng(7), 10);
    const seq = Array.from({ length: 400 }, () => picker.pick(20));
    for (let i = 0; i < seq.length; i++) expect(seq.slice(Math.max(0, i - 10), i)).not.toContain(seq[i]);
    // Every variant comes round.
    expect(new Set(seq).size).toBe(20);
    // Memory 1: never twice in a row.
    const one = new VariantPicker(rng(8));
    let last = -1;
    for (let i = 0; i < 100; i++) {
      const v = one.pick(3);
      expect(v).not.toBe(last);
      last = v;
    }
  });

  it('strike harder running than walking, and harder still landing', () => {
    for (const s of surfaces) {
      const e = (g: (typeof FOOT_GAITS)[number]) => energy(synthFootstep(s, g, 2, SR, 5));
      expect(e('run')).toBeGreaterThan(e('walk'));
      expect(e('land')).toBeGreaterThan(e('run'));
      expect(e('stop')).toBeLessThan(e('walk'));
    }
  });

  it('thud like a heel on stone: most of a walking step’s energy between 100 and 600 Hz', () => {
    const x = synthFootstep('stone', 'walk', 0, SR, 9);
    expect(band(x, 100, 600)).toBeGreaterThan(band(x, 600, 12000));
    expect(band(x, 100, 600)).toBeGreaterThan(band(x, 20, 100));
  });

  it('sound hollow on the deck', () => {
    const body = (s: GroundSurface) => {
      const x = synthFootstep(s, 'walk', 1, SR, 11);
      return band(x, 140, 300) / energy(x);
    };
    expect(body('deck')).toBeGreaterThan(body('stone'));
  });

  it('crunch on gravel, swish on grass, thud on rugs, boom on boards', () => {
    // Gravel crunches (grains giving way: sharp peaks over the step's highs); grass is a soft brush of
    // blades over the foot's low thud into the turf, as recorded.
    const crest = (s: GroundSurface) => [0, 1, 2].reduce((m, v) => m + crestOf(s, v), 0) / 3;
    const crestOf = (s: GroundSurface, v: number) => {
      const x = filter(synthFootstep(s, 'walk', v, SR, 13 + v), SR, ['highpass', 2000, 0.7], ['lowpass', 12000, 0.7]);
      let pk = 0;
      let e = 0;
      const w = Math.round(0.3 * SR);
      for (let i = 0; i < x.length; i++) {
        pk = Math.max(pk, Math.abs(x[i]));
        if (i < w) e += x[i] * x[i];
      }
      return pk / Math.sqrt(e / w);
    };
    expect(crest('gravel')).toBeGreaterThan(1.8 * crest('grass'));
    const grass = synthFootstep('grass', 'walk', 0, SR, 15);
    expect(band(grass, 30, 160)).toBeGreaterThan(band(grass, 2000, 16000));
    const bright = (s: GroundSurface) => {
      const x = synthFootstep(s, 'walk', 2, SR, 17);
      return band(x, 2000, 12000) / energy(x);
    };
    expect(bright('rug')).toBeLessThan(0.3 * bright('wood'));
    const low = (s: GroundSurface) => {
      const x = synthFootstep(s, 'walk', 0, SR, 19);
      return band(x, 70, 250) / energy(x);
    };
    expect(low('boards')).toBeGreaterThan(low('wood'));
  });
});

describe('valves', () => {
  it('synthesise cleanly', () => {
    for (const x of [synthValve('open', SR, 1), synthValve('close', SR, 2)]) {
      expect(finite(x)).toBe(true);
      expect(peak(x)).toBeCloseTo(1, 5);
    }
  });
});

describe('airlock sound events', () => {
  it('sounds every stage of a walk through, in order, and the valves once per cycle', () => {
    const lock = new Airlock();
    const watcher = new AirlockWatcher(lock);
    const events: string[] = [];
    let x = -540;
    for (let i = 0; i < 60 * 120 && x < -440; i++) {
      const nx = x + 2 / 60;
      const blocked = (lip: number, open: boolean) => !open && x < lip - 0.6 && nx >= lip - 0.6;
      if (!blocked(GATE.outerLipX, lock.outer.isOpen) && !blocked(GATE.innerLipX, lock.inner.isOpen)) x = nx;
      lock.update(1 / 60, { x, z: 0 });
      const ev = watcher.step(lock);
      // Events of one step sound together; list the valves first.
      if (ev.pressure) events.push(ev.pressure);
      for (const g of ev.gates) events.push(`${g.gate}:${g.event}`);
    }
    const order = (...seq: string[]) => {
      let i = 0;
      for (const e of events) if (e === seq[i]) i++;
      return i === seq.length;
    };
    expect(order('outer:unbolt', 'outer:unbolted', 'outer:closed', 'outer:bolt', 'outer:bolted', 'valve-open', 'valve-close', 'inner:unbolt', 'inner:unbolted', 'inner:opened')).toBe(true);
    expect(events.filter((e) => e === 'valve-open').length).toBe(events.filter((e) => e === 'valve-close').length);
  });
});

describe('player foot events', () => {
  function player() {
    const held = new Set<string>();
    const input = { down: (c: string) => held.has(c), consumeLook: () => [0, 0] } as unknown as Input;
    const p = new PlayerController(new PerspectiveCamera(), input);
    p.spawn({ position: [0, 0], yaw: 0, pitch: 0 });
    const events: { t: number; e: FootEvent }[] = [];
    let t = 0;
    p.onFoot = (e) => events.push({ t, e });
    const run = (seconds: number, keys: string[]) => {
      held.clear();
      for (const k of keys) held.add(k);
      for (let i = 0; i < seconds * 120; i++) {
        p.update(1 / 120);
        t += 1 / 120;
      }
    };
    return { run, events };
  }

  it('steps at the walking cadence, never twice at once, and settles with one step on stopping', () => {
    const { run, events } = player();
    run(4, ['KeyW']);
    run(1, []);
    const steps = events.filter((x) => x.e.kind === 'step');
    expect(steps.length).toBeGreaterThan(6);
    expect(steps.length).toBeLessThan(10);
    for (let i = 1; i < events.length; i++) expect(events[i].t - events[i - 1].t).toBeGreaterThan(0.14);
    expect(events.filter((x) => x.e.kind === 'stop').length).toBe(1);
  });

  it('pushes off and lands on a jump', () => {
    const { run, events } = player();
    run(0.05, ['Space']);
    run(1.2, []);
    const kinds = events.map((x) => x.e.kind);
    expect(kinds[0]).toBe('takeoff');
    const land = events.find((x) => x.e.kind === 'land');
    expect(land).toBeDefined();
    expect(land!.e.kind === 'land' && land!.e.impact).toBeGreaterThan(3);
  });
});
