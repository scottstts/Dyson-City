/**
 * Runtime entry point: owns the frame loop and wires player, world, pipeline and exposure.
 * System logic lives in its own modules; this file only sequences them.
 */
import { PerspectiveCamera, Vector3, type Node, type Object3D } from 'three/webgpu';
import type { RendererHandle } from '../core/renderer';
import { fatal } from '../core/fatal';
import type { World } from './world';
import type { DebugParams } from '../debug/params';
import { VIEWPOINTS, DEFAULT_VIEWPOINT } from '../debug/viewpoints';
import { Input } from '../player/input';
import { EYE_FOV, PlayerController, type Spawn } from '../player/controller';
import { createPipeline, setPipelineTime, type Pipeline } from '../render/pipeline';
import { cameraExposure, whiteBalanceGains } from '../render/exposure';
import { STAR_DISC_MEAN_RADIANCE } from '../world/radiometry';
import { addLightingProbes } from '../debug/probes';
import type { AtmosphereTextures } from '../atmosphere/luts';
import { PauseMenu } from '../ui/pauseMenu';
import { loadAudioPrefs, prefsGain } from '../ui/audioPrefs';
import type { EntryScreen } from '../ui/entryScreen';
import { ADAPT_MAX, EyeAdaptation } from '../render/adaptation';
import { InteractionPrompt } from '../ui/prompt';
import type { GameAudio } from '../audio/gameAudio';
import { Driving } from './driving';
import type { FlightPhase } from '../vehicles/craft/flight';
import { READING_ADAPTATION, TerminalUse } from '../terminal/use';
import { terminalLive } from '../terminal/live';
import type { NarrationClips } from '../audio/loadNarration';
import type { TerminalKey } from '../terminal/os/os';
import { CrewFrameSource } from '../crew/frame';
import { crewReview } from '../crew/review';
import { FIELD_Y } from '../field/layout';
import type { Intro } from '../intro/intro';
import { IntroReview } from '../intro/review';

/** Where the West Gate's airlock is told the walker is while they drive: far from both its gates. */
const NOBODY = new Vector3(0, 0, 0);

/** Frames per period of the debug yaw wobble (?wobble). */
export const WOBBLE_PERIOD = 37;

/** Time constant (s) of the star's visible share as the eye moves under a roof. */
const STAR_EASE = 0.4;

export class Game {
  readonly camera: PerspectiveCamera;
  readonly pipeline: Pipeline;
  private readonly input: Input;
  private readonly player: PlayerController;
  private readonly pause: PauseMenu;
  private gameTime: number;
  private lastTime = -1;
  private playing = false;
  private running = false;
  /** The loop is held while the pause menu is up: nothing advances or renders. */
  private frozen = false;

  private readonly handle: RendererHandle;
  private readonly world: World;
  private readonly debug: DebugParams;
  private readonly entry: EntryScreen;
  private readonly spawnLook: Spawn;
  /** Null when the exposure is overridden for review (?ev). */
  private readonly adaptation: EyeAdaptation | null;
  private frameIndex = 0;
  /** The star's visible share as the eye takes it (eased; −1: take the next value as it is, after a teleport). */
  private starSeen = -1;
  private readonly audio: GameAudio;
  private readonly prompt: InteractionPrompt;
  private readonly driving: Driving;
  private readonly terminal: TerminalUse;
  private readonly narration: NarrationClips;
  /** Review (?terminal=keys): the keys still to press, one every REVIEW_KEY seconds after the boot. */
  private reviewKeys: TerminalKey[] = [];
  private reviewAt = 0;
  private reviewJumped = false;
  /** Review (?tat): the OS's clock, held. */
  private reviewHold: number | null = null;
  private readonly crewFrame: CrewFrameSource;
  /** The intro (src/intro/): played on the first Enter, then gone (null once it has ended). */
  private intro: Intro | null = null;
  /** ?introReview: the intro alone, looping, with review keys (intro/review.ts). */
  private introReview: IntroReview | null = null;
  private readonly host: HTMLElement;
  /** Whether the intro was held last frame (its pause stops the sound too). */
  private introHeld = false;

  constructor(handle: RendererHandle, world: World, atmo: AtmosphereTextures, audio: GameAudio, debug: DebugParams, entry: EntryScreen, host: HTMLElement, narration: NarrationClips) {
    this.narration = narration;
    this.handle = handle;
    this.audio = audio;
    this.world = world;
    this.debug = debug;
    this.entry = entry;
    const { width, height } = handle.viewport();
    this.camera = new PerspectiveCamera(debug.fov ?? EYE_FOV, width / height, 0.05, 40_000);
    this.camera.name = 'PlayerCamera';
    this.crewFrame = new CrewFrameSource(this.camera.position);
    handle.onViewport((size) => {
      this.camera.aspect = size.width / size.height;
      this.camera.updateProjectionMatrix();
      // A resized canvas is cleared: paused, redraw the same instant once.
      if (this.frozen) this.still();
    });

    this.input = new Input(handle.renderer.domElement);
    this.player = new PlayerController(this.camera, this.input, world.city.walk);
    this.player.onFoot = (e) => audio.foot(e);
    const base = VIEWPOINTS[debug.spot ?? DEFAULT_VIEWPOINT] ?? VIEWPOINTS[DEFAULT_VIEWPOINT];
    const spawn = debug.look ? { ...base, yaw: (debug.look[0] * Math.PI) / 180, pitch: (debug.look[1] * Math.PI) / 180 } : base;
    this.player.spawn(spawn);
    this.spawnLook = spawn;
    this.driving = new Driving(world.vehicles.car, this.input, this.player, this.camera, world.city.walk, world.vehicles.carWalls);
    this.terminal = new TerminalUse(world.stand.os, this.input, this.player, this.camera);
    if (debug.probe) addLightingProbes(world.scene, spawn.position, spawn.yaw);
    this.camera.updateMatrixWorld();

    this.gameTime = debug.time ?? 0;
    this.pipeline = createPipeline(handle.renderer, world.scene, this.camera, atmo, {
      view: debug.view,
      toneMapper: debug.toneMapper,
      ao: debug.ao,
      illuminant: world.star.illuminant as unknown as Node<'vec3'>,
      skyOverlay: world.starAtmosphere,
      composites: world.composites,
      localComposites: world.localComposites,
    });
    const illuminant = world.star.illuminant.value as Vector3;
    // A daylight-balanced photograph exposed for the star (render/exposure.ts).
    const wb = whiteBalanceGains();
    (this.pipeline.camera.whiteBalance as unknown as { value: Vector3 }).value.set(wb[0], wb[1], wb[2]);
    const star: [number, number, number] = [STAR_DISC_MEAN_RADIANCE[0] * illuminant.x, STAR_DISC_MEAN_RADIANCE[1] * illuminant.y, STAR_DISC_MEAN_RADIANCE[2] * illuminant.z];
    (this.pipeline.camera.exposure as unknown as { value: number }).value = debug.ev !== null ? Math.pow(2, debug.ev) : cameraExposure(star, wb);

    this.adaptation = debug.ev === null ? new EyeAdaptation(handle.renderer, this.pipeline.sceneLuminance) : null;
    if (debug.gate) world.city.gate.airlock.hold(debug.gate);
    if (debug.vent) world.field.vents.lift(0);
    if (debug.craft) {
      const [phase, extra] = debug.craft.split(':');
      world.vehicles.fastForward(phase as FlightPhase, extra ? Number(extra) : undefined);
    }
    if (debug.drive) this.driving.startInCar();
    if (debug.crew) {
      const s = crewReview(world.crew, debug.crew, world.vehicles.craft.flight.untilInside(), FIELD_Y);
      if (s) this.player.spawn(s);
    }
    if (debug.terminal !== null) {
      this.player.spawn(this.terminal.standSpot());
      this.terminal.startAt(this.gameTime);
      const names: Record<string, TerminalKey> = { u: 'up', d: 'down', l: 'left', r: 'right', e: 'enter', b: 'back' };
      this.reviewKeys = [...debug.terminal].map((c) => names[c]).filter((k): k is TerminalKey => !!k);
    }
    if (debug.lock) world.city.lock.airlock.hold(debug.lock === 'outer' || debug.lock === 'open', debug.lock === 'inner' || debug.lock === 'open');

    this.host = host;
    this.prompt = new InteractionPrompt(host);
    const prefs = loadAudioPrefs();
    audio.setUserGain(prefsGain(prefs));
    this.pause = new PauseMenu(host, prefs, (gain) => audio.setUserGain(gain));
    this.input.onLockChange = (locked) => {
      this.audio.setActive(locked);
      if (locked) {
        // The first Enter starts the intro; the game begins when it ends.
        if (this.intro?.pending) this.intro.start();
        else if (!this.intro?.running) this.playing = true;
        this.entry.hide();
        this.pause.hide();
        this.start();
        this.thaw();
      } else if ((this.playing || this.intro?.running) && !fatal.hasFired) {
        this.freeze();
        this.pause.show(() => this.input.requestLock());
      }
    };
    fatal.onStop(() => this.stop());
  }

  /** Review: the intro at t s, held there (tools/intro-shots.mjs). */
  introSeek(t: number, hold = true): void {
    this.intro?.seek(t, hold);
  }

  /** The intro to play on the first Enter (boot); `at` starts it at once for review (?intro). */
  setIntro(intro: Intro, at?: { at: number; hold: boolean }): void {
    this.intro = intro;
    if (this.debug.introReview) this.introReview = new IntroReview(intro, this.host);
    if (at) intro.start(at.at, at.hold);
  }

  /**
   * Compiles every pipeline the game draws with, during loading. One frame through the real
   * pipeline (the scene pass's MRT targets, the post passes) with every object shown and none
   * culled, so whatever is out of the spawn view, beyond a range, or indoors (the house's floors,
   * the far side of the field) has its pipelines and textures ready before play: nothing compiles
   * when it first comes into view. (renderer.compileAsync builds for the canvas, not the scene
   * pass's targets, and skips what the camera's frustum culls.)
   */
  warmAll(): void {
    const saved: [Object3D, boolean, boolean][] = [];
    this.world.scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    try {
      this.pipeline.render();
    } finally {
      for (const [o, visible, culled] of saved) {
        o.visible = visible;
        o.frustumCulled = culled;
      }
    }
  }

  /** Renders one frame synchronously (boot warmup and first frame). */
  renderFrame(dt = 1 / 60): void {
    this.frame(dt);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    this.frozen = false;
    this.handle.renderer.setAnimationLoop(null);
    this.audio.close();
  }

  /** Holds the world and the picture on the current instant (pause). */
  private freeze(): void {
    if (!this.running || this.frozen) return;
    this.frozen = true;
    this.handle.renderer.setAnimationLoop(null);
  }

  private thaw(): void {
    if (!this.frozen) return;
    this.frozen = false;
    if (!this.running || fatal.hasFired) return;
    // Time paused with the picture: no catch-up step on resume.
    this.lastTime = -1;
    this.loop();
  }

  /** Re-renders the held instant without advancing anything. */
  private still(): void {
    try {
      this.frame(0);
    } catch (error) {
      fatal.report('Rendering stopped', error);
    }
  }

  private loop(): void {
    this.handle.renderer.setAnimationLoop((time: number) => {
      const t = time / 1000;
      const dt = this.lastTime < 0 ? 1 / 60 : Math.min(Math.max(t - this.lastTime, 0), 0.1);
      this.lastTime = t;
      try {
        this.frame(dt);
      } catch (error) {
        fatal.report('Rendering stopped', error);
      }
    });
  }

  enter(): void {
    this.input.requestLock();
  }

  /** Debug/review: jump to a named viewpoint (or an explicit spawn) without reloading. */
  setSpot(spot: string | Spawn): void {
    const s = typeof spot === 'string' ? VIEWPOINTS[spot] : spot;
    if (s) this.player.spawn(s);
    this.starSeen = -1;
  }

  /** Review (?terminal=keys): presses the queued keys, one at a time, once the terminal has booted. */
  private reviewTerminal(): void {
    if (!this.reviewKeys.length) {
      // Then (?tat) jump the recording forward, once.
      const os = this.world.stand.os;
      if (this.debug.terminalAt !== null && os.playback && !this.reviewJumped && this.gameTime >= this.reviewAt) {
        this.reviewJumped = true;
        // The recording is held at that moment (stills for review): the OS's clock stops there.
        os.playback.start = this.gameTime - this.debug.terminalAt;
        this.reviewHold = this.gameTime;
        os.version++;
      }
      return;
    }
    const os = this.world.stand.os;
    if (os.booting || !os.awake) return;
    if (this.gameTime < this.reviewAt) return;
    os.key(this.reviewKeys.shift()!, this.gameTime);
    this.reviewAt = this.gameTime + 0.35;
  }

  private profileCounter = 0;
  /** Debug: GPU time of the frame's render passes, published on window.__dyson.gpuMs. */
  private profileFrame(): void {
    if (++this.profileCounter % 20 !== 0) return;
    const r = this.handle.renderer;
    void r.resolveTimestampsAsync('render').then(() => {
      const d = (window as unknown as { __dyson?: { gpuMs?: number } }).__dyson;
      if (d) d.gpuMs = r.info.render.timestamp;
    });
  }

  private frame(dt: number): void {
    if (this.intro?.running) {
      this.introFrame(dt);
      return;
    }
    if (this.debug.time === null) this.gameTime += dt;
    this.world.update(this.gameTime);
    const driving = this.driving;
    const terminal = this.terminal;
    if (this.playing && !driving.inCar && !terminal.active) this.player.update(dt);
    const use = this.playing && this.input.consumePress('KeyE');
    // The terminal takes E first (it is never within the car's reach), then the car, then a door.
    const usedByTerminal = !driving.inCar && terminal.update(dt, this.gameTime, this.playing, use);
    const usedByCar = !terminal.active && driving.update(dt, this.playing, use && !usedByTerminal);
    if (terminal.active) driving.update(dt, false, false);
    this.reviewTerminal();
    this.advanceWorld(dt, driving.inCar ? null : this.player.feet, this.player.feet, use && !usedByCar && !usedByTerminal && !driving.inCar && !terminal.active);
    const aimed = driving.inCar || terminal.active ? null : this.world.house.doors.aimed;
    this.prompt.set(!this.playing || terminal.active ? null : (terminal.prompt ?? driving.prompt ?? (aimed ? (aimed.target > 0.5 ? 'Close' : 'Open') : null)));
    if (this.debug.wobble !== null) {
      // Flicker review: a yaw sweep that returns to the same view every period, with a different
      // amplitude (so a different motion history and speed) each time; the period is prime so the
      // TAA jitter phase differs at every return.
      const period = Math.floor(this.frameIndex / WOBBLE_PERIOD);
      const scale = this.debug.steady ? 1 : 0.4 + 0.6 * (((Math.sin(period * 12.9898) * 43758.5453) % 1) + 1) % 1;
      const a = (this.debug.wobble * scale * Math.PI) / 180;
      this.player.setLook(this.spawnLook.yaw + a * Math.sin((2 * Math.PI * this.frameIndex) / WOBBLE_PERIOD), this.spawnLook.pitch);
    }
    this.frameIndex++;
    this.camera.updateMatrixWorld();
    // The Stand's silencer follows the player up and down it, on foot or in the car.
    const car = this.world.vehicles.car;
    if (driving.inCar) this.world.stand.listen(dt, car.state.x, car.groundY, car.state.z);
    else this.world.stand.listen(dt, this.player.feet.x, this.player.feet.y, this.player.feet.z);
    this.present(dt, this.player.feet, 1);
  }

  /**
   * The world's systems for this frame: the West Gate's airlock, the vehicles and the crew (a
   * walker at `walker`, or none: driving), the house's doors (E pressed, `use`) and what is
   * drawn of it and the estate from the eye.
   */
  private advanceWorld(dt: number, walker: Vector3 | null, feet: Vector3, use: boolean): void {
    // In the car the West Gate's airlock does not see a walker (the car never enters it).
    this.world.city.update(dt, walker ?? NOBODY);
    // Review time (?time) holds the craft where ?craft put it, as it holds the star.
    this.world.vehicles.update(this.debug.time === null ? dt : 0, this.gameTime, walker);
    // The crew after them (they hold for the walker and the car); review time holds them too.
    this.world.crew.update(this.debug.time === null ? dt : 0, this.crewFrame.at(walker, this.world.vehicles));
    this.camera.updateMatrixWorld();
    this.world.house.update(dt, this.camera, feet, use);
    const indoors = this.world.house.inside(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    this.world.indoors = indoors;
    this.world.estate.view(this.camera, indoors);
    this.world.house.culling.update(this.camera, indoors);
  }

  /**
   * The Stand's screen, the sound, and the picture: the star's glare as the eye sees it (`starShare`
   * scales what city/visibility.ts finds, for an eye under a roof it does not know: the intro's
   * cockpit), then the render and the eye's adaptation.
   */
  private present(dt: number, feet: Vector3, starShare: number): void {
    // The screen's auto-brightness follows the eye's adaptation (terminal/screenMaterial.ts).
    this.world.stand.update(this.reviewHold ?? this.gameTime, this.camera.position, terminalLive(this.world), this.narration.peaks, this.adaptation?.value ?? 1);
    this.audio.update(dt, this.camera, feet);
    this.world.skyMesh.updateHistory(this.camera);
    setPipelineTime(this.gameTime);
    const star = this.world.city.starVisibility(this.camera.position);
    const visible = star.visible * starShare;
    // Under the house's roofs and the gate's vault the star is hidden by them (city/visibility.ts):
    // it fades as the eye walks in, eased over STAR_EASE so a quick step or turn never pops it.
    this.starSeen = this.starSeen < 0 ? visible : this.starSeen + (visible - this.starSeen) * (1 - Math.exp(-dt / STAR_EASE));
    (this.pipeline.camera.starVisibility as unknown as { value: number }).value = this.starSeen;
    (this.pipeline.camera.starTransmission as unknown as { value: number }).value = star.transmission;
    this.render(dt);
  }

  private render(dt: number, limit = this.terminal.reading ? READING_ADAPTATION : ADAPT_MAX): void {
    this.pipeline.render();
    if (this.adaptation) {
      this.adaptation.limit = limit;
      (this.pipeline.camera.adaptation as unknown as { value: number }).value = this.adaptation.update(dt);
    }
    if (this.debug.profile) this.profileFrame();
  }

  /**
   * A frame of the intro (src/intro/): it poses the camera; on the band the world runs as in play
   * round the ship; in deep space (scene 1) the world is hidden and held. Enter skips it; its last
   * frame is the player's first.
   */
  private introFrame(dt: number): void {
    const intro = this.intro!;
    if (this.introReview) this.introReview.update(this.input);
    else {
      if (this.input.consumePress('Enter') || this.input.consumePress('NumpadEnter')) intro.skip();
      if (this.input.consumePress('Space')) intro.togglePause();
    }
    // The head is the film's: the mouse does nothing until it ends.
    this.input.consumeLook();
    const f = intro.update(dt, this.camera);
    // Held (Space, or the review's hold): the world and the sound stop with the film.
    if (intro.held !== this.introHeld) {
      this.introHeld = intro.held;
      this.audio.setActive(!intro.held && this.input.locked);
    }
    for (const e of f.steps) this.audio.foot(e);
    const band = this.pipeline.camera.band as unknown as { value: number };
    if (f.space) {
      band.value = 0;
      this.audio.update(dt, this.camera, f.feet);
      intro.updateHistory(this.camera);
      setPipelineTime(this.gameTime);
      (this.pipeline.camera.starVisibility as unknown as { value: number }).value = 0;
      this.starSeen = -1;
      this.render(dt, f.adaptationLimit);
    } else {
      band.value = 1;
      if (this.debug.time === null && !intro.held) this.gameTime += dt;
      this.world.update(this.gameTime);
      this.advanceWorld(dt, f.feet, f.feet, false);
      this.prompt.set(null);
      this.world.stand.listen(dt, f.feet.x, f.feet.y, f.feet.z);
      this.present(dt, f.feet, f.starSeen);
    }
    this.introReview?.show();
    if (f.done && this.introReview) this.introReview.loop();
    else if (f.done) {
      intro.finish();
      this.audio.setTransient(null);
      this.intro = null;
      // The game begins on the intro's last view, exactly.
      this.player.spawn(VIEWPOINTS[DEFAULT_VIEWPOINT]);
      this.playing = this.input.locked;
    }
  }
}
