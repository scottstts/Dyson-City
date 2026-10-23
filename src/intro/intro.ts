/**
 * The intro (docs/intro.md, docs/intro-film.md): a staged, real-time film from the Guardian's eyes,
 * from waking in the ship far outside the sphere to standing at the West Gate, where the game
 * begins on exactly the intro's last frame.
 *
 * It owns everything that exists only for it (the ship, scene 1's sky, the eyelids and fades, its
 * sounds) and drives the camera; the world goes on as in play while it runs. Nothing it changes
 * outlives it: when it ends (or is skipped) its objects are removed and disposed, and every switch
 * it threw is set back.
 */
import { Matrix3, Matrix4, Vector3, type Object3D, type PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import type { World } from '../app/world';
import { createAtmosphereNodes, type AtmosphereTextures } from '../atmosphere/luts';
import { buildTimeline, sceneAt, type Timeline } from './timeline';
import { Ship, type ShipState } from './ship/ship';
import { shipEnvironment, shipInSpace } from './ship/env';
import { cabinEnvironment, cabinState } from './ship/cabinLight';
import { createCanopy, type Canopy } from './ship/canopy';
import { ShipScreens, type ScreenData } from './ship/screens';
import { createSpaceView, type SpaceView } from './space/view';
import { Eye } from './eye';
import { IntroOverlay } from './overlay';
import { LANDING, newShipPose, shipMatrix, shipPose, type ShipPose } from './flight';
import type { FootEvent } from '../player/controller';
import { ADAPT_MAX } from '../render/adaptation';
import type { IntroSounds } from './audio/sounds';
import { shipStateAt } from './shipState';

/** What the game needs from the intro each frame. */
export interface IntroFrame {
  /** Deep space (scene 1): the band's world is hidden and does not advance. */
  space: boolean;
  /** The feet, for the world's systems and the sound of the steps. */
  feet: Vector3;
  /** Steps the feet took this frame. */
  steps: readonly FootEvent[];
  /** Share of the star's disc the eye sees (its glare), and the glass in between. */
  starSeen: number;
  /**
   * The most the eye may open (render/adaptation.ts limit). Far out, the star blazes through the
   * openings in a sphere that is otherwise nearly black: an eye squints at that, it does not open
   * to the black (an average meter would, and the blaze would flood the frame).
   */
  adaptationLimit: number;
  /** The intro has ended: the game takes over from this frame's view. */
  done: boolean;
}

export interface IntroDeps {
  renderer: WebGPURenderer;
  world: World;
  atmosphere: AtmosphereTextures;
  host: HTMLElement;
  /** Review: scene 1 seen from elsewhere (latitude°, longitude°, distance). */
  view?: [number, number, number] | null;
  /** Lengths of the nine recorded lines (s). */
  lines: readonly number[];
}

export class Intro {
  readonly timeline: Timeline;
  readonly ship: Ship;
  private readonly space: SpaceView;
  private readonly eye: Eye;
  private readonly overlay: IntroOverlay;
  private readonly world: World;
  private readonly canopy: Canopy;
  private readonly screens: ShipScreens;
  private readonly screenData: ScreenData = { eta: 0, range: 0, speed: 0, height: 0, sink: 0, ground: 0, toSpot: 0, main: 0, lift: 0, gear: 1, outside: 0.55, landed: false };
  private readonly poseBefore: ShipPose = newShipPose();
  private groundHigh = false;
  private readonly nearAlbedo = new Vector3();
  private readonly state3: ShipState = { door: 0, stair: 0, gear: 0, compression: 0, main: 0, lift: 0 };
  private readonly pose: ShipPose = newShipPose();
  private readonly shipM = new Matrix4();
  private readonly frameOut: IntroFrame = { space: true, feet: new Vector3(), steps: [], starSeen: 0, adaptationLimit: SPACE_ADAPTATION, done: false };
  private hidden: [Object3D, boolean][] | null = null;
  private time = 0;
  private hold: number | null = null;
  private state: 'idle' | 'running' | 'done' = 'idle';
  /** Its sound (audio/sounds.ts), once the game's audio exists. */
  private sound: IntroSounds | null = null;

  constructor(deps: IntroDeps) {
    this.world = deps.world;
    this.timeline = buildTimeline(deps.lines);
    this.space = createSpaceView(deps.renderer, { star: deps.world.star, atmo: createAtmosphereNodes(deps.atmosphere), space: deps.world.backdrop }, deps.view ?? undefined);
    this.screens = new ShipScreens();
    this.ship = new Ship(this.screens);
    const band = deps.world.environment.target.texture;
    this.ship.setLook({ env: shipEnvironment(band, this.space.texture), cabinEnv: cabinEnvironment(band, this.space.texture) });
    this.canopy = createCanopy(band, this.space.texture);
    deps.world.localComposites.push(this.canopy.composite);
    this.ship.group.visible = false;
    this.space.sky.mesh.visible = false;
    deps.world.scene.add(this.ship.group, ...this.ship.extras, this.space.sky.mesh);
    this.eye = new Eye(this.timeline, (x, z) => deps.world.city.walk.ground(x, z, Infinity));
    this.overlay = new IntroOverlay(deps.host, deps.renderer.domElement, this.timeline);
  }

  get running(): boolean {
    return this.state === 'running';
  }

  get pending(): boolean {
    return this.state === 'idle';
  }

  /** Every object the intro draws, shown (boot compiles their pipelines with the world's). */
  get objects(): Object3D[] {
    return [this.ship.group, ...this.ship.extras, this.space.sky.mesh];
  }

  /** Starts the film (at `at` s for review; `hold` freezes it there). */
  start(at = 0, hold = false): void {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.time = at;
    this.hold = hold ? at : null;
    this.ship.group.visible = true;
    this.canopy.enabled.value = 1;
    this.overlay.show();
    this.eye.reset();
  }

  /** Its sound, made once the game's audio exists (boot). */
  attachSound(s: IntroSounds): void {
    this.sound = s;
  }

  /** The film's clock (s). */
  get clock(): number {
    return this.time;
  }

  /** Space in play: holds the film where it is, or runs it on (its sound picks up). */
  togglePause(): void {
    this.seek(this.time, this.hold === null);
    this.overlay.setPaused(this.hold !== null);
  }

  /** The corner's key hint (the review mode shows its own readout instead). */
  setHint(shown: boolean): void {
    this.overlay.setHint(shown);
  }

  /** Review: the lids, the fades and the blur of waking on or off. */
  setOverlay(on: boolean): void {
    this.overlay.enabled = on;
  }

  get overlayOn(): boolean {
    return this.overlay.enabled;
  }

  /** Held at a moment (review). */
  get held(): boolean {
    return this.hold !== null;
  }

  /** Review: jumps to t (clamped to the film), held there or running on. */
  seek(t: number, hold: boolean): void {
    this.time = Math.min(Math.max(t, 0), this.timeline.end);
    this.hold = hold ? this.time : null;
    this.eye.reset();
    this.sound?.resync(hold);
  }

  /** Enter: straight to the end (the game's first view), out of black. */
  skip(): void {
    if (this.state !== 'running') return;
    this.time = this.timeline.end;
    this.hold = null;
  }

  /** Per frame: advances the film and poses the camera. */
  update(dt: number, camera: PerspectiveCamera): IntroFrame {
    const f = this.frameOut;
    if (this.hold !== null) this.time = this.hold;
    else this.time = Math.min(this.time + dt, this.timeline.end);
    const t = this.time;
    const tl = this.timeline;
    const scene = sceneAt(tl, t);
    const space = scene === 1;
    this.setSpace(space);
    if (space) {
      this.shipM.identity();
      this.space.exterior.frame.value++;
    }
    else shipMatrix(shipPose(tl, t, this.pose), this.shipM);
    this.ship.setPose(this.shipM);
    this.ship.update(this.shipState(t, space), t);
    this.sound?.set({ time: t, space, ship: this.ship.group.matrixWorld, state: this.state3 });
    (cabinState.door as unknown as { value: number }).value = this.ship.doorOpen;
    this.setCabin(space);
    this.setGround(scene === 2);
    const e = this.eye.update(t, this.hold !== null ? 0 : dt, this.shipM);
    e.matrix.decompose(camera.position, camera.quaternion, SCALE);
    camera.updateMatrixWorld();
    this.overlay.update(t);
    this.updateScreens(t, space, e.aboard);
    f.space = space;
    f.feet.copy(e.feet);
    f.steps = this.eye.feetEvents;
    f.starSeen = space ? 0 : e.aboard ? 0.15 : 1;
    f.adaptationLimit = space ? SPACE_ADAPTATION : e.aboard ? CABIN_ADAPTATION : ADAPT_MAX;
    f.done = t >= tl.end && this.hold === null;
    return f;
  }

  /** What moves on the ship at t (shipState.ts). */
  private shipState(t: number, space: boolean): ShipState {
    return shipStateAt(this.timeline, t, space, this.pose, this.state3);
  }

  /** The screens' figures from the flight (scene 1: far out; on the band: the descent). */
  private updateScreens(t: number, space: boolean, aboard: boolean): void {
    const s = this.screenData;
    const tl = this.timeline;
    const p = this.pose;
    if (space) {
      // "Approximately five hours": the clock runs down from just under it as she speaks.
      s.eta = Math.max(5 * 3600 - 28 - (t - tl.lines[0]), 0);
      s.speed = APPROACH_SPEED;
      s.range = SCENE1_RANGE - APPROACH_SPEED * t;
      s.main = 0.12;
      s.lift = 0;
      s.gear = 0;
    } else {
      s.eta = null;
      const pos = p.position;
      // Rates from the flight's own closed form, a tenth of a second back.
      const before = shipPose(tl, t - 0.1, this.poseBefore).position;
      s.sink = (before.y - pos.y) / 0.1;
      s.ground = Math.hypot(pos.x - before.x, pos.z - before.z) / 0.1;
      s.height = pos.y;
      s.toSpot = Math.hypot(pos.x - LANDING.x, pos.z - LANDING.z);
      s.main = p.main;
      s.lift = p.lift;
      s.gear = p.gear;
      s.landed = t >= tl.scene2.touchdown;
    }
    this.screens.update(t, s, aboard);
  }

  /**
   * Flying high (scene 2) the sky shows the ground beyond the deck's mesh: the deck there, not the
   * platform's pale stone (which at eye height is always under the mesh). Set back after.
   */
  private setGround(high: boolean): void {
    if (high === this.groundHigh) return;
    this.groundHigh = high;
    const near = this.world.sky.options.nearGroundAlbedo as unknown as { value: Vector3 };
    const deck = this.world.sky.options.deckAlbedo as unknown as { value: Vector3 };
    if (high) {
      this.nearAlbedo.copy(near.value);
      near.value.copy(deck.value);
    } else near.value.copy(this.nearAlbedo);
  }

  /** The cabin's light this frame: where the ship is, its door, the light it passes round. */
  private setCabin(space: boolean): void {
    const S = cabinState;
    (S.toShip.value as Matrix4).copy(this.shipM).invert();
    (S.rotation.value as Matrix3).setFromMatrix4(this.shipM);
    const fill = space ? CABIN_FILL.space : CABIN_FILL.band;
    (S.fill.value as Vector3).set(fill, fill * 0.97, fill * 0.93);
  }

  /** Scene 1 is far from the band: its world is hidden, the ship lit by the sphere's light. */
  private setSpace(space: boolean): void {
    const inSpace = this.hidden !== null;
    if (space === inSpace) return;
    const scene = this.world.scene;
    if (space) {
      this.hidden = [];
      for (const o of scene.children) {
        if (o === this.ship.group || o === this.space.sky.mesh) continue;
        this.hidden.push([o, o.visible]);
        o.visible = false;
      }
      this.space.sky.mesh.visible = true;
    } else {
      for (const [o, v] of this.hidden!) o.visible = v;
      this.hidden = null;
      this.space.sky.mesh.visible = false;
    }
    shipInSpace.value = space ? 1 : 0;
  }

  /** Per frame before rendering: the sky's motion history (scene 1). */
  updateHistory(camera: PerspectiveCamera): void {
    if (this.hidden) this.space.sky.updateHistory(camera);
  }

  /** Ends the intro: everything it made is removed and disposed, every switch set back. */
  finish(): void {
    if (this.state === 'done') return;
    this.setSpace(false);
    this.setGround(false);
    this.state = 'done';
    this.canopy.enabled.value = 0;
    this.overlay.dispose();
    this.ship.dispose();
    this.screens.dispose();
    this.space.dispose();
    this.sound?.dispose();
    this.sound = null;
  }
}

const SCALE = new Vector3();

/** Scene 1: the closing speed (km/s) and the range to the shell at its start (km): 1.15 shell radii. */
const APPROACH_SPEED = 54.8;
const SCENE1_RANGE = 1_131_600;

/**
 * Aboard on the band the eye stays near the sunlit key: the world through the canopy reads as
 * day, the cabin round it dimmer (an average meter in the dark cockpit blew the windows out).
 */
const CABIN_ADAPTATION = 1.8;

/** Scene 1's eye: open at most this far (×, over the star's key). */
const SPACE_ADAPTATION = 8;

/** The light the cabin passes round itself (a radiance): dim far out, brighter under the star. */
const CABIN_FILL = { space: 0.004, band: 0.04 } as const;
