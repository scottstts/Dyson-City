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
import { airlockAnnouncements, loadSpeech } from '../audio/loadSpeech';
import { NarrationClips } from '../audio/loadNarration';
import { isDebugHost, readDebugParams } from '../debug/params';
import type { EntryScreen } from '../ui/entryScreen';
import { Intro } from '../intro/intro';
import { loadIntroLines } from '../intro/audio/lines';
import { IntroSounds } from '../intro/audio/sounds';

function stage(name: BootStage, entry: EntryScreen, progress: number): void {
  if (fatal.hasFired) throw new Error(`Startup aborted before stage "${name}"`);
  fatal.stage = name;
  entry.setProgress(progress);
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

  stage('renderer', entry, 0.08);
  const handle = await createRenderer(host, { profile: debug.profile });

  stage('atmosphere', entry, 0.2);
  // The sound is synthesised in a worker alongside (docs/audio.md); its context sets the rate. The
  // announcements are the one recording that ships: fetched and decoded alongside.
  const audioContext = GameAudio.context();
  // The house's exterior is fetched and compiled alongside (house/assets.ts).
  // The intro's recorded lines too (intro/audio/lines.ts).
  const [atmosphere, noise, audioBank, speech, houseAssets, introLines] = await Promise.all([computeAtmosphereTextures(), generateNoiseVolumes(), loadAudioBank(audioContext.sampleRate), loadSpeech(audioContext), loadHouseAssets(), loadIntroLines(audioContext)]);
  setNoiseVolumes(noise);

  stage('environment', entry, 0.4);
  await nextFrame();
  const world = await buildWorld(handle.renderer, atmosphere, houseAssets, debug.time ?? 0, debug.sky);

  // The intro (src/intro/): its ship and its view of the sphere from outside, in the world's scene.
  const intro = new Intro({ renderer: handle.renderer, world, atmosphere, host, lines: introLines.map((b) => b.duration), view: debug.introView });

  stage('interiors', entry, 0.5);
  // The house's floors are built while loading, never in play (house/house.ts).
  await world.house.loadInteriors();

  stage('compile', entry, 0.6);
  // The airlock waits out its announcements (city/gate/airlock.ts).
  Object.assign(world.city.gate.airlock.announce, airlockAnnouncements(speech));
  // The terminal's narration loads after boot, in the background (audio/loadNarration.ts).
  const narration = new NarrationClips();
  const audio = new GameAudio(audioContext, audioWorld(world, speech, narration), audioBank);
  // The intro's sound through the game's engine: the ship's cabin and machines (intro/audio/sounds.ts).
  const introSound = new IntroSounds(audio.engine, introLines, intro.timeline);
  intro.attachSound(introSound);
  audio.setTransient(introSound);
  const game = new Game(handle, world, atmosphere, audio, debug, entry, host, narration);
  game.setIntro(intro, debug.intro ?? undefined);
  // Every pipeline the game will draw with, compiled through the real passes (game.ts warmAll).
  game.warmAll();
  await nextFrame();

  stage('warmup', entry, 0.85);
  for (let i = 0; i < 3; i++) {
    game.renderFrame();
    await nextFrame();
  }

  stage('first-frame', entry, 0.97);
  game.renderFrame();
  await nextFrame();
  if (fatal.hasFired) throw new Error('Startup aborted after a GPU error');

  fatal.stage = 'running';
  narration.load(audioContext);
  // The frame loop starts with the Enter click, which starts the intro: until then the stills cover
  // the canvas. Review tooling (?autostart, ?intro) runs it at once.
  const review = debug.autostart || debug.intro !== null;
  if (!debug.manual && review) game.start();
  if (review) entry.hide();
  else entry.showReady(() => game.enter());
  // Review tooling hooks (tools/*.mjs), on local hosts only.
  if (isDebugHost()) (window as unknown as { __dyson?: unknown }).__dyson = { game, world, atmosphere, ready: true };
}
