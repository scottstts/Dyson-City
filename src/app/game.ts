/**
 * Runtime entry point: owns the frame loop and wires player, world, pipeline and exposure.
 * System logic lives in its own modules; this file only sequences them.
 */
import { PerspectiveCamera, type Node, type Vector3 } from 'three/webgpu';
import type { RendererHandle } from '../core/renderer';
import { fatal } from '../core/fatal';
import type { World } from './world';
import type { DebugParams } from '../debug/params';
import { VIEWPOINTS, DEFAULT_VIEWPOINT } from '../debug/viewpoints';
import { Input } from '../player/input';
import { PlayerController, type Spawn } from '../player/controller';
import { createPipeline, setPipelineTime, type Pipeline } from '../render/pipeline';
import { cameraExposure, whiteBalanceGains } from '../render/exposure';
import { STAR_DISC_MEAN_RADIANCE } from '../world/radiometry';
import { addLightingProbes } from '../debug/probes';
import type { AtmosphereTextures } from '../atmosphere/luts';
import { loadSettings, PauseMenu, type PlayerSettings } from '../ui/pauseMenu';
import type { EntryScreen } from '../ui/entryScreen';

/** Frames per period of the debug yaw wobble (?wobble). */
export const WOBBLE_PERIOD = 37;

export class Game {
  readonly camera: PerspectiveCamera;
  readonly pipeline: Pipeline;
  private readonly input: Input;
  private readonly player: PlayerController;
  private readonly settings: PlayerSettings;
  private readonly pause: PauseMenu;
  private gameTime: number;
  private lastTime = -1;
  private playing = false;
  private running = false;

  private readonly handle: RendererHandle;
  private readonly world: World;
  private readonly debug: DebugParams;
  private readonly entry: EntryScreen;
  private readonly spawnLook: Spawn;
  private frameIndex = 0;

  constructor(handle: RendererHandle, world: World, atmo: AtmosphereTextures, debug: DebugParams, entry: EntryScreen, host: HTMLElement) {
    this.handle = handle;
    this.world = world;
    this.debug = debug;
    this.entry = entry;
    this.settings = loadSettings();
    const { width, height } = handle.viewport();
    this.camera = new PerspectiveCamera(debug.fov ?? this.settings.fov, width / height, 0.05, 40_000);
    this.camera.name = 'PlayerCamera';
    handle.onViewport((size) => {
      this.camera.aspect = size.width / size.height;
      this.camera.updateProjectionMatrix();
    });

    this.input = new Input(handle.renderer.domElement);
    this.player = new PlayerController(this.camera, this.input);
    this.player.sensitivity = this.settings.sensitivity;
    const base = VIEWPOINTS[debug.spot ?? DEFAULT_VIEWPOINT] ?? VIEWPOINTS[DEFAULT_VIEWPOINT];
    const spawn = debug.look ? { ...base, yaw: (debug.look[0] * Math.PI) / 180, pitch: (debug.look[1] * Math.PI) / 180 } : base;
    this.player.spawn(spawn);
    this.spawnLook = spawn;
    if (debug.probe) addLightingProbes(world.scene, spawn.position, spawn.yaw);
    this.camera.updateMatrixWorld();

    this.gameTime = debug.time ?? 0;
    this.pipeline = createPipeline(handle.renderer, world.scene, this.camera, atmo, {
      view: debug.view,
      toneMapper: debug.toneMapper,
      ao: debug.ao,
      illuminant: world.star.illuminant as unknown as Node<'vec3'>,
    });
    const illuminant = world.star.illuminant.value as Vector3;
    // A daylight-balanced photograph exposed for the star (render/exposure.ts).
    const wb = whiteBalanceGains();
    (this.pipeline.camera.whiteBalance as unknown as { value: Vector3 }).value.set(wb[0], wb[1], wb[2]);
    const star: [number, number, number] = [STAR_DISC_MEAN_RADIANCE[0] * illuminant.x, STAR_DISC_MEAN_RADIANCE[1] * illuminant.y, STAR_DISC_MEAN_RADIANCE[2] * illuminant.z];
    (this.pipeline.camera.exposure as unknown as { value: number }).value = debug.ev !== null ? Math.pow(2, debug.ev) : cameraExposure(star, wb);

    this.pause = new PauseMenu(host, this.settings, (s) => {
      this.player.sensitivity = s.sensitivity;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    });
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.playing = true;
        this.entry.hide();
        this.pause.hide();
      } else if (this.playing && !fatal.hasFired) {
        this.pause.show(() => this.input.requestLock());
      }
    };
    fatal.onStop(() => this.stop());
  }

  /** Renders one frame synchronously (boot warmup and first frame). */
  renderFrame(dt = 1 / 60): void {
    this.frame(dt);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
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

  stop(): void {
    this.running = false;
    this.handle.renderer.setAnimationLoop(null);
  }

  enter(): void {
    this.input.requestLock();
  }

  /** Debug/review: jump to a named viewpoint (or an explicit spawn) without reloading. */
  setSpot(spot: string | Spawn): void {
    const s = typeof spot === 'string' ? VIEWPOINTS[spot] : spot;
    if (s) this.player.spawn(s);
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
    if (this.debug.time === null) this.gameTime += dt;
    this.world.update(this.gameTime);
    if (this.playing) this.player.update(dt);
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
    this.world.skyMesh.updateHistory(this.camera);
    setPipelineTime(this.gameTime);
    this.pipeline.render();
    if (this.debug.profile) this.profileFrame();
  }
}
