/**
 * Using the terminal (docs/terminal.md). Game owns the loop; this owns the switch between walking
 * and using it, as app/driving.ts owns the car's:
 *
 *  - On the deck in front of it, looking at the screen, E uses it: the OS wakes and the view moves
 *    from the eye to a framed shot square on the screen, close enough that the screen fills most of
 *    the view (FILL of its limiting side) with the hood and the world round it, over TRANSITION
 *    seconds on an eased path. The pointer stays locked.
 *  - Using it, the arrow keys, Enter and Backspace go to the OS; the mouse does nothing; E leaves,
 *    the OS sleeps and the view moves back to the eye.
 *  - The framing follows the viewport (it is recomputed every frame, so a resize keeps it).
 */
import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Input } from '../player/input';
import type { PlayerController } from '../player/controller';
import { DECK_Y, TERMINAL, terminalFrame } from './layout';
import { screenPose } from './build/console';
import type { TerminalKey, TerminalOS } from './os/os';

/**
 * How far the eye opens looking into the hood (×, ~2.5 stops): the hood and the world round it blow
 * out, as everything does to an eye opened to shade; the screen divides it out (screenMaterial.ts).
 */
export const READING_ADAPTATION = 6;

/** Share of the view's limiting side the screen fills. */
export const FILL = 0.8;
/** The view's move between the eye and the screen (s). */
export const TRANSITION = 1.3;
/** The eye must look this directly at the screen (cosine) for E to use it. */
const AIM = 0.72;

const KEYS: [string, TerminalKey][] = [
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['Enter', 'enter'],
  ['NumpadEnter', 'enter'],
  ['Backspace', 'back'],
];

type Mode = 'walking' | 'entering' | 'using' | 'leaving';

/** Smootherstep: zero velocity and acceleration at both ends. */
function ease(u: number): number {
  return u * u * u * (u * (u * 6 - 15) + 10);
}

export class TerminalUse {
  private mode: Mode = 'walking';
  private t = 0;
  private readonly fromPos = new Vector3();
  private readonly fromQuat = new Quaternion();
  private readonly toPos = new Vector3();
  private readonly toQuat = new Quaternion();
  private readonly m = new Matrix4();
  private readonly pose = screenPose();
  private readonly centre: Vector3;
  private readonly normal: Vector3;
  private readonly up: Vector3;
  /** Where a walker stands to use it. */
  private readonly spot: [number, number];
  private readonly os: TerminalOS;
  private readonly keys: Input;
  private readonly player: PlayerController;
  private readonly camera: PerspectiveCamera;
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();
  /** What E would do now (the prompt), or null. */
  prompt: string | null = null;

  constructor(os: TerminalOS, keys: Input, player: PlayerController, camera: PerspectiveCamera) {
    this.os = os;
    this.keys = keys;
    this.player = player;
    this.camera = camera;
    this.centre = new Vector3(...this.pose.centre);
    this.normal = new Vector3(...this.pose.normal);
    this.up = new Vector3(...this.pose.up);
    const { base, inward } = terminalFrame();
    this.spot = [base[0] + inward[0] * TERMINAL.stand, base[2] + inward[1] * TERMINAL.stand];
  }

  /** The view is on the screen (moving in, or there). */
  get reading(): boolean {
    return this.mode === 'entering' || this.mode === 'using';
  }

  /** The player is at the terminal (or moving to or from it): the walker does not move. */
  get active(): boolean {
    return this.mode !== 'walking';
  }

  /** Where a walker stands to use it, facing it (a spawn). */
  standSpot(): { position: [number, number]; yaw: number; pitch: number } {
    const dx = this.centre.x - this.spot[0];
    const dz = this.centre.z - this.spot[1];
    return { position: [this.spot[0], this.spot[1]], yaw: Math.atan2(-dx, -dz), pitch: -0.2 };
  }

  /** Review (?terminal): starts at the screen, awake. */
  startAt(t: number): void {
    this.mode = 'using';
    this.os.wake(t);
    this.frame();
    this.camera.position.copy(this.toPos);
    this.camera.quaternion.copy(this.toQuat);
  }

  /**
   * Per frame, after the walker has moved. `use` is an E press this frame; returns whether it was
   * taken here (so the car and the doors do not take it too). `t` is game time (the OS's clock).
   */
  update(dt: number, t: number, playing: boolean, use: boolean): boolean {
    let used = false;
    this.prompt = null;
    switch (this.mode) {
      case 'walking': {
        if (playing && this.within()) {
          this.prompt = 'Use';
          if (use) {
            used = true;
            this.begin('entering');
            this.os.wake(t);
          }
        }
        break;
      }
      case 'entering':
      case 'using': {
        this.frame();
        if (this.mode === 'entering') this.blend(dt, this.toPos, this.toQuat, () => (this.mode = 'using'));
        else {
          this.camera.position.copy(this.toPos);
          this.camera.quaternion.copy(this.toQuat);
        }
        // The mouse does nothing here; the keys go to the OS.
        this.keys.consumeLook();
        if (playing) for (const [code, k] of KEYS) if (this.keys.consumePress(code)) this.os.key(k, t);
        if (playing && use) {
          used = true;
          this.os.sleep(t);
          this.begin('leaving');
        }
        break;
      }
      case 'leaving': {
        // The walker stands still while the view returns to the eye.
        this.player.update(0);
        this.blend(dt, this.camera.position.clone(), this.camera.quaternion.clone(), () => (this.mode = 'walking'));
        break;
      }
    }
    return used;
  }

  /** On the deck, at the spot in front of the screen, looking at it. */
  private within(): boolean {
    const f = this.player.feet;
    if (Math.abs(f.y - DECK_Y) > 0.3) return false;
    if (Math.hypot(f.x - this.spot[0], f.z - this.spot[1]) > TERMINAL.reach) return false;
    const to = this.tmp.copy(this.centre).sub(this.camera.position).normalize();
    const fwd = this.fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return fwd.dot(to) > AIM;
  }

  /** The framed shot: square on the screen, at the distance where it fills FILL of the view. */
  private frame(): void {
    const cam = this.camera;
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    const dH = this.pose.h / FILL / (2 * tanV);
    const dW = this.pose.w / FILL / (2 * tanV * cam.aspect);
    const d = Math.max(dH, dW);
    this.toPos.copy(this.centre).addScaledVector(this.normal, d);
    this.m.lookAt(this.toPos, this.centre, this.up);
    this.toQuat.setFromRotationMatrix(this.m);
  }

  private begin(mode: 'entering' | 'leaving'): void {
    this.mode = mode;
    this.t = 0;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
  }

  /** Eases the camera from the saved pose to (pos, quat); `done` at the end. */
  private blend(dt: number, pos: Vector3, quat: Quaternion, done: () => void): void {
    this.t += dt;
    const u = Math.min(1, this.t / TRANSITION);
    const e = ease(u);
    this.camera.position.lerpVectors(this.fromPos, pos, e);
    this.camera.quaternion.slerpQuaternions(this.fromQuat, quat, ease(Math.min(1, u * 1.15)));
    if (u >= 1) done();
  }
}
