/**
 * Staged boot. Every stage runs inside the single promise chain started in main.ts; a failure at
 * any point (including any uncaptured GPU error, which reports through `fatal`) aborts startup and
 * shows the entry screen's error panel with the stage and diagnostics.
 */
import { fatal, type BootStage } from '../core/fatal';
import { createRenderer } from '../core/renderer';
import { computeAtmosphereTextures } from '../atmosphere/luts';
import { generateNoiseVolumes, setNoiseVolumes } from '../render/tsl/volumeNoise';
import { buildWorld } from './world';
import { loadHouseAssets } from '../house/assets';
import { audioWorld } from './audioWorld';
import { Game } from './game';
import { GameAudio } from '../audio/gameAudio';
import { loadAudioBank } from '../audio/loadBank';
import { isDebugHost, readDebugParams } from '../debug/params';
import type { EntryScreen } from '../ui/entryScreen';

let stageStart = performance.now();

function stage(name: BootStage, entry: EntryScreen, progress: number, label: string): void {
  if (fatal.hasFired) throw new Error(`Startup aborted before stage "${name}"`);
  const now = performance.now();
  console.info(`[Dyson] boot: ${fatal.stage} took ${(now - stageStart).toFixed(0)} ms`);
  stageStart = now;
  fatal.stage = name;
  entry.setProgress(progress, label);
}

/** Yields to the browser for one frame; falls back to a timer in hidden/background tabs where rAF stalls. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 100);
  });

export async function boot(host: HTMLElement, entry: EntryScreen): Promise<void> {
  const debug = readDebugParams();

  stage('renderer', entry, 0.08, 'Starting WebGPU');
  const handle = await createRenderer(host, { profile: debug.profile });

  stage('atmosphere', entry, 0.2, 'Integrating the atmosphere');
  // The sound is synthesised in a worker alongside (docs/audio.md); its context sets the rate.
  const audioContext = GameAudio.context();
  // The house's exterior is fetched and compiled alongside (house/assets.ts).
  const [atmosphere, noise, audioBank, houseAssets] = await Promise.all([computeAtmosphereTextures(), generateNoiseVolumes(), loadAudioBank(audioContext.sampleRate), loadHouseAssets()]);
  setNoiseVolumes(noise);

  stage('environment', entry, 0.4, 'Lighting the world');
  await nextFrame();
  const world = await buildWorld(handle.renderer, atmosphere, houseAssets, debug.time ?? 0, debug.sky);

  stage('compile', entry, 0.6, 'Compiling shaders');
  const audio = new GameAudio(audioContext, audioWorld(world), audioBank);
  const game = new Game(handle, world, atmosphere, audio, debug, entry, host);
  await handle.renderer.compileAsync(world.scene, game.camera);

  stage('warmup', entry, 0.85, 'Warming up');
  for (let i = 0; i < 3; i++) {
    game.renderFrame();
    await nextFrame();
  }

  stage('first-frame', entry, 0.97, 'Almost there');
  game.renderFrame();
  await nextFrame();
  if (fatal.hasFired) throw new Error('Startup aborted after a GPU error');

  console.info(`[Dyson] boot: ${fatal.stage} took ${(performance.now() - stageStart).toFixed(0)} ms`);
  fatal.stage = 'running';
  if (!debug.manual) game.start();
  // The house's floors stream in while the game runs (a failure is fatal: never a half-built house).
  world.house.streamInteriors(game.camera, (e) => fatal.report('The house failed to load', e));
  if (debug.autostart) entry.hide();
  else entry.showReady(() => game.enter());
  // Review tooling hooks (tools/*.mjs), on local hosts only.
  if (isDebugHost()) (window as unknown as { __dyson?: unknown }).__dyson = { game, world, atmosphere, ready: true };
}
