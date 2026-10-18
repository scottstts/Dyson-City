/**
 * The player's footsteps: two emitters at the feet (left and right of the body's line, on the
 * ground), so steps come from below and alternate sides at the ears, take the zone's medium and
 * reverberation, and are heard by anything else exactly as any other sound would be.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import type { FootGait } from '../synth/footstep';
import type { FootKey } from '../bank';
import { LEVEL } from '../mix';
import { between, rng } from '../dsp';
import { playInto, VariantPicker } from './oneShot';
import type { GroundSurface } from '../../city/walk';
import type { FootEvent } from '../../player/controller';

/** Half the stance width: each foot is this far from the body's line (m). */
const FOOT_OFFSET = 0.11;
/** The feet's reference distance (m): a step's level is its level at the foot. */
const FOOT_REF = 0.3;
/** A walking step's force at the 2 m/s walk; slower steps are lighter. */
const WALK_SPEED = 2;

export class Footsteps {
  private readonly feet: [Emitter, Emitter];
  private readonly bank = new Map<string, AudioBuffer[]>();
  /** One picker per floor and gait, each remembering its own recent steps. */
  private readonly pickers = new Map<string, VariantPicker>();
  private readonly random = rng(0xf007);
  private readonly surfaceAt: (x: number, z: number, y: number) => GroundSurface;
  private side = 0;

  constructor(engine: AudioEngine, surfaceAt: (x: number, z: number, y: number) => GroundSurface) {
    this.surfaceAt = surfaceAt;
    // In the house a step feeds the room's reverb at its level at 1 m (sounds/house.ts); the gate's
    // chamber keeps the send it was tuned by ear with.
    const make = (name: string) => new Emitter(engine, { name, zones: 'located', refDistance: FOOT_REF, sendScale: (zone) => (zone === 'house' ? FOOT_REF : 1) });
    this.feet = [make('foot.left'), make('foot.right')];
    // A walking step on stone peaks at 1 in the bank; gaits and floors keep their relative force.
    for (const [key, list] of Object.entries(engine.bank.footsteps)) this.bank.set(key, list.map((x) => engine.buffer(x)));
  }

  /** Per frame: the feet follow the body (`right` is the body's horizontal right, unit). */
  follow(x: number, y: number, z: number, rightX: number, rightZ: number): void {
    this.feet[0].setPosition(x - rightX * FOOT_OFFSET, y + 0.02, z - rightZ * FOOT_OFFSET);
    this.feet[1].setPosition(x + rightX * FOOT_OFFSET, y + 0.02, z + rightZ * FOOT_OFFSET);
  }

  play(e: FootEvent, x: number, y: number, z: number, t: number): void {
    let gait: FootGait;
    let force: number;
    switch (e.kind) {
      case 'step':
        gait = e.run > 0.5 ? 'run' : 'walk';
        force = gait === 'run' ? 1 : Math.pow(Math.min(e.speed / WALK_SPEED, 1.3), 0.7);
        if (e.crouch) force *= 0.6;
        break;
      case 'stop':
        gait = 'stop';
        force = 1;
        break;
      case 'takeoff':
        gait = 'takeoff';
        force = 1;
        break;
      case 'land':
        // A drop of a few centimetres is just a step down; a jump or a stair lands on both feet.
        gait = e.impact < 1.4 ? 'stop' : 'land';
        force = Math.min(Math.max(e.impact / 3.5, 0.4), 1.6);
        break;
    }
    const key = `${this.surfaceAt(x, z, y)}:${gait}` satisfies FootKey;
    const list = this.bank.get(key)!;
    let picker = this.pickers.get(key);
    // Half the variants are kept out after each pick: no step returns within the next n/2.
    if (!picker) this.pickers.set(key, (picker = new VariantPicker(this.random, Math.floor(list.length / 2))));
    const buffer = list[picker.pick(list.length)];
    const foot = this.feet[this.side];
    // Both feet land together on a landing; otherwise feet alternate.
    if (gait !== 'land') this.side = 1 - this.side;
    const gain = LEVEL.footstep * force * Math.pow(10, between(this.random, -1.5, 1.5) / 20);
    playInto(foot, buffer, t, gain, between(this.random, 0.98, 1.02));
  }
}
