/**
 * The intro's soundtrack rendered offline (tools/intro-audio.mjs): the film's clock run at 60 Hz
 * through the real flight, ship state and eye, the intro's sound (src/intro/audio/sounds.ts)
 * scheduling into an OfflineAudioContext through the game's engine, exactly as the game plays it.
 * The world's own sounds are left out: this is the ship.
 */
import { Matrix4 } from 'three/webgpu';
import { AudioEngine, type ListenerState } from '../src/audio/engine';
import { buildAudioBank } from '../src/audio/bank';
import { LEVEL } from '../src/audio/mix';
import { IntroSounds } from '../src/intro/audio/sounds';
import { buildTimeline, sceneAt, SPEAKER } from '../src/intro/timeline';
import { newShipPose, shipMatrix, shipPose } from '../src/intro/flight';
import { shipStateAt } from '../src/intro/shipState';
import { Eye } from '../src/intro/eye';
import type { ShipState } from '../src/intro/ship/ship';

export async function render(files: ArrayBuffer[], from = 0, to = -1, levels: Record<string, number> = {}, sampleRate = 48000): Promise<{ sampleRate: number; left: Float32Array; right: Float32Array; log: string[] }> {
  // Review: intro levels overridden (mix.ts LEVEL.intro), to hear one source alone.
  Object.assign(LEVEL.intro as Record<string, number>, levels);
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  const lines = await Promise.all(files.map((f) => decoder.decodeAudioData(f)));
  // As the game loads them (intro/audio/lines.ts): each at a peak of 1.
  for (const b of lines) {
    let peak = 0;
    for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] /= peak;
    }
  }
  const tl = buildTimeline(lines.map((b) => b.duration));
  const end = to > 0 ? Math.min(to, tl.end) : tl.end;
  const ctx = new OfflineAudioContext(2, Math.ceil((end - from) * sampleRate), sampleRate);
  const engine = new AudioEngine(ctx, buildAudioBank(sampleRate));
  engine.master.gain.value = LEVEL.master;
  const sounds = new IntroSounds(engine, lines, tl);
  const eye = new Eye(tl);
  const pose = newShipPose();
  const ship = new Matrix4();
  const state: ShipState = { door: 0, stair: 0, gear: 0, compression: 0, main: 0, lift: 0 };
  const l: ListenerState = { x: 0, y: 0, z: 0, forward: [0, 0, -1], up: [0, 1, 0], zone: 'cabin', outerOpen: 0, innerOpen: 0, bar: 0.55, houseOpen: 0, cabin: { open: 0, vacuum: true } };
  const log: string[] = [];
  tl.lines.forEach((t, i) => log.push(`line ${i + 1} (${SPEAKER[i]}) at ${t.toFixed(2)} s, ${lines[i].duration.toFixed(2)} s`));
  log.push(`touchdown ${tl.scene2.touchdown.toFixed(2)} s, door ${tl.scene3.doorOpen.toFixed(2)} s, liftoff ${tl.scene3.liftoff.toFixed(2)} s, end ${tl.end.toFixed(2)} s`);
  const dt = 1 / 60;
  let zone = '';
  for (let i = 0; from + i * dt <= end; i++) {
    const t = from + i * dt;
    const at = i * dt;
    const space = sceneAt(tl, t) === 1;
    if (space) ship.identity();
    else shipMatrix(shipPose(tl, t, pose), ship);
    shipStateAt(tl, t, space, pose, state);
    sounds.set({ time: t, space, ship, state });
    const m = eye.update(t, dt, ship).matrix.elements;
    l.x = m[12];
    l.y = m[13];
    l.z = m[14];
    l.forward = [-m[8], -m[9], -m[10]];
    l.up = [m[4], m[5], m[6]];
    l.zone = engine.locate(l.x, l.y, l.z);
    l.cabin.open = sounds.cabin.open;
    l.cabin.vacuum = sounds.cabin.vacuum;
    if (l.zone !== zone) {
      log.push(`${t.toFixed(2)} s: listener in ${l.zone}`);
      zone = l.zone;
    }
    sounds.update(at, l);
    engine.update(l, at);
  }
  const out = await ctx.startRendering();
  return { sampleRate, left: out.getChannelData(0), right: out.getChannelData(1), log };
}
