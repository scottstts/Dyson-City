/**
 * Offline audio scenarios for tools/audio-preview.mjs (bundled and run in headless Chrome; not part
 * of the game). The real player controller, walls, airlock and GameAudio run frame by frame at
 * 60 Hz with scripted keys, scheduling everything into an OfflineAudioContext, which then renders
 * what the game would have played.
 */
import { PerspectiveCamera } from 'three/webgpu';
import { PlayerController, type Spawn } from '../src/player/controller';
import type { Input } from '../src/player/input';
import { Airlock } from '../src/city/gate/airlock';
import { openingHeight } from '../src/city/gate/lighting';
import { LEAF_CLEAR } from '../src/city/gate/gate';
import { frameLayout } from '../src/city/dome/frame';
import { buildWalk } from '../src/city/walk';
import { GameAudio } from '../src/audio/gameAudio';
import { AudioEngine } from '../src/audio/engine';
import { Emitter } from '../src/audio/emitter';
import { buildAudioBank, type AudioBank } from '../src/audio/bank';

/** Keys held over [from, to) seconds; `look` turns the view (deg yaw per second). */
interface Segment {
  from: number;
  to: number;
  keys: string[];
  look?: number;
}

interface Scenario {
  seconds: number;
  spawn: Spawn;
  script: Segment[];
}

const EAST = -Math.PI / 2;

export const SCENARIOS: Record<string, Scenario> = {
  /** Spawn on the apron, walk in through the airlock, then run and jump in the Gate Court. */
  'walk-in': {
    seconds: 75,
    spawn: { position: [-540, 0], yaw: EAST, pitch: 0 },
    script: [
      { from: 0.5, to: 62, keys: ['KeyW'] },
      { from: 62, to: 68, keys: ['KeyW', 'ShiftLeft'] },
      { from: 66, to: 66.1, keys: ['KeyW', 'ShiftLeft', 'Space'] },
    ],
  },
  /** Walk out from the Gate Court: the chamber vents (with its mist) and the outer gate opens. */
  'walk-out': {
    seconds: 70,
    spawn: { position: [-455, 0], yaw: Math.PI / 2, pitch: 0 },
    script: [{ from: 0.5, to: 66, keys: ['KeyW'] }],
  },
  /** Stand in the chamber's middle while a walker's cycle runs (listener held, airlock driven from outside in). */
  'chamber-stand': {
    seconds: 40,
    spawn: { position: [-486, 2], yaw: Math.PI, pitch: 0 },
    script: [],
  },
  /** Stand beside the outer gate while it opens, turning on the spot (90°/s): direction at the ears. */
  turn: {
    seconds: 12,
    spawn: { position: [-506, 0], yaw: EAST, pitch: 0 },
    script: [{ from: 0, to: 12, keys: [], look: 90 }],
  },
  /** The deck: walk, stop, run, jump, step down from the platform. */
  deck: {
    seconds: 16,
    spawn: { position: [-560, 30], yaw: EAST, pitch: 0 },
    script: [
      { from: 0.3, to: 4, keys: ['KeyW'] },
      { from: 5, to: 9, keys: ['KeyW', 'ShiftLeft'] },
      { from: 10, to: 10.1, keys: ['Space'] },
      { from: 12, to: 12.1, keys: ['Space', 'KeyW'] },
      { from: 12.1, to: 14, keys: ['KeyW'] },
    ],
  },
};

function stubInput(): Input & { held: Set<string> } {
  const held = new Set<string>();
  return { held, down: (c: string) => held.has(c), consumeLook: () => [0, 0] } as unknown as Input & { held: Set<string> };
}

/** The bank, built once per rate for all scenarios. */
const banks = new Map<number, AudioBank>();
function bankAt(sr: number): AudioBank {
  let b = banks.get(sr);
  if (!b) banks.set(sr, (b = buildAudioBank(sr)));
  return b;
}

export async function render(name: string, sampleRate = 48000): Promise<{ sampleRate: number; left: Float32Array; right: Float32Array; log: string[] }> {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const log: string[] = [];
  const ctx = new OfflineAudioContext(2, Math.round(sc.seconds * sampleRate), sampleRate);
  const walk = buildWalk(frameLayout());
  const lock = new Airlock();
  const t0 = performance.now();
  const audio = new GameAudio(ctx, { airlock: lock, surface: (x, z) => walk.surface(x, z) }, bankAt(sampleRate));
  log.push(`synthesis ${(performance.now() - t0).toFixed(0)} ms`);
  const camera = new PerspectiveCamera(60, 16 / 9, 0.05, 1000);
  const input = stubInput();
  const player = new PlayerController(camera, input, walk);
  player.spawn(sc.spawn);
  let yaw = sc.spawn.yaw;
  player.onFoot = (e) => {
    audio.foot(e);
    log.push(`${t.toFixed(2)} foot ${e.kind} ${walk.surface(player.feet.x, player.feet.z)}`);
  };
  // The chamber scenario drives the airlock with a walker going in while the listener stands still.
  const ghost = name === 'chamber-stand' ? { x: -520 } : null;
  const dt = 1 / 60;
  let t = 0;
  const phases = { outer: lock.outer.phase, inner: lock.inner.phase };
  for (let i = 0; i < sc.seconds * 60; i++) {
    t = i * dt;
    input.held.clear();
    for (const s of sc.script)
      if (t >= s.from && t < s.to) {
        for (const k of s.keys) input.held.add(k);
        if (s.look) {
          yaw += (s.look * Math.PI * dt) / 180;
          player.setLook(yaw, 0);
        }
      }
    player.update(dt);
    if (ghost) {
      // Walks east at 2 m/s, waiting at a leaf until it is open.
      const blocked = (lip: number, open: boolean) => !open && ghost.x < lip - 0.6 && ghost.x + 2 * dt >= lip - 0.6;
      if (!blocked(-499, lock.outer.isOpen) && !blocked(-473, lock.inner.isOpen)) ghost.x += 2 * dt;
      lock.update(dt, { x: ghost.x, z: 0 });
    } else lock.update(dt, { x: player.feet.x, z: player.feet.z });
    walk.walls.setEnabled('gate:outer', openingHeight(lock.outer.openness) < LEAF_CLEAR);
    walk.walls.setEnabled('gate:inner', openingHeight(lock.inner.openness) < LEAF_CLEAR);
    for (const g of ['outer', 'inner'] as const)
      if (lock[g].phase !== phases[g]) {
        phases[g] = lock[g].phase;
        log.push(`${t.toFixed(2)} ${g} ${phases[g]} (x=${player.feet.x.toFixed(1)})`);
      }
    camera.updateMatrixWorld();
    audio.update(dt, camera, player.feet, t);
  }
  const t1 = performance.now();
  const out = await ctx.startRendering();
  log.push(`render ${(performance.now() - t1).toFixed(0)} ms for ${sc.seconds} s`);
  return { sampleRate, left: out.getChannelData(0), right: out.getChannelData(1), log };
}

/**
 * Direction check: one noise source 10 m east of a listener turning at 90°/s (no world). Returns
 * the left/right energy per half-second, which should swing with the head.
 */
export async function directionCheck(sampleRate = 48000): Promise<{ yaw: number; lr: number }[]> {
  const seconds = 4;
  const ctx = new OfflineAudioContext(2, seconds * sampleRate, sampleRate);
  const engine = new AudioEngine(ctx, bankAt(sampleRate));
  const e = new Emitter(engine, { name: 'probe', zones: ['outside'], refDistance: 1 });
  e.setPosition(10, 1.6, 0);
  const src = new AudioBufferSourceNode(ctx, { buffer: engine.noise, loop: true });
  src.connect(new GainNode(ctx, { gain: 0.5 })).connect(e.input);
  src.start(0);
  for (let i = 0; i < seconds * 60; i++) {
    const t = i / 60;
    const yaw = (Math.PI / 2) * t;
    engine.update({ x: 0, y: 1.6, z: 0, forward: [-Math.sin(yaw), 0, -Math.cos(yaw)], up: [0, 1, 0], zone: 'outside', outerOpen: 0, innerOpen: 0, bar: 0.55 }, t);
  }
  const out = await ctx.startRendering();
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  const rows: { yaw: number; lr: number }[] = [];
  for (let s = 0; s < seconds; s += 0.25) {
    let l = 0;
    let r = 0;
    for (let i = Math.floor(s * sampleRate); i < Math.floor((s + 0.25) * sampleRate); i++) {
      l += L[i] * L[i];
      r += R[i] * R[i];
    }
    rows.push({ yaw: ((s + 0.125) * 90) % 360, lr: 10 * Math.log10((l + 1e-12) / (r + 1e-12)) });
  }
  return rows;
}
