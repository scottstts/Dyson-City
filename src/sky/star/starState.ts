import { Matrix3, Vector3, Vector4 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { vec4Array, type Vec4Array } from '../../render/tsl/helpers';
import { RELATIVE_ROTATION_RATE } from '../../world/constants';
import { MagneticState } from './magnetic';
import {
  buildStarCatalogue,
  flareEnvelope,
  flareEvent,
  flareStart,
  FLARE_INTERVAL,
  MAX_REGIONS,
  MAX_SPOTS,
  type StarCatalogue,
  type V3,
} from './features';

/** Game-time epoch offset (s). Chosen so a large active region sits on the eastern half of the disc at spawn. */
export const STAR_EPOCH = 2350;
/**
 * Granulation runs in real time. A granule lives ~8 min; time-lapsing it (an earlier build ran it
 * 20× fast) is the miniature effect: a surface that boils like a pot reads as a small object.
 */
export const GRANULE_LIFETIME = 480;
/** Period of the small orbit each granule's centre drifts on (its horizontal flows, ~1–2 km/s). */
export const GRANULE_DRIFT_PERIOD = 900;
export const FLARE_SLOTS = 2;

const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * CPU-side state for the star: rotation of the star frame relative to the observer, feature
 * uniforms, and the flare scheduler. No per-frame allocation.
 */
export class StarState {
  readonly catalogue: StarCatalogue;
  readonly rotation = uniform(new Matrix3());
  /** Star time (s, game time + epoch): drives granulation, flares and the magnetic atmosphere in real time. */
  readonly time = uniform(0);
  /** Sub-observer point on the star (star frame, unit). */
  readonly subObserver = uniform(new Vector3(0, -1, 0));
  /**
   * The star's measured disc-mean radiance relative to the white photosphere's (per channel; see
   * starIlluminant.ts). Scales everything the star lights: air, far structure, ground.
   */
  readonly illuminant = uniform(new Vector3(1, 1, 1));
  readonly spotA: Vec4Array;
  readonly spotB: Vec4Array;
  readonly regionA: Vec4Array;
  readonly regionB: Vec4Array;
  /**
   * Per flare slot, three vec4s (slot·3 + k):
   *   0: (regionIndex, intensity, twist, start s)
   *   1: (rise s, decay s, active 0/1, 0)
   *   2: impulsive burst times (s)
   * The shader evaluates the brightening at any time — the direct view now, reflections at their
   * retarded time (light echoes).
   */
  readonly flares: Vec4Array;
  readonly spotCount: number;
  readonly regionCount: number;
  /** Prominences, eruptions and jets at the limb (magnetic.ts). */
  readonly magnetic: MagneticState;

  private readonly flareVecs: Vector4[];
  private readonly rotMatrix = new Matrix3();

  constructor(seed?: number) {
    this.catalogue = buildStarCatalogue(seed);
    const { spots, regions } = this.catalogue;
    this.spotCount = spots.length;
    this.regionCount = regions.length;

    const pad = (arr: Vector4[], n: number): Vector4[] => {
      while (arr.length < n) arr.push(new Vector4(0, 0, 0, 0));
      return arr;
    };
    this.spotA = vec4Array(pad(spots.map((s) => new Vector4(s.dir[0], s.dir[1], s.dir[2], s.penumbra)), MAX_SPOTS));
    this.spotB = vec4Array(pad(spots.map((s) => new Vector4(s.umbraRatio, s.seed, s.region, 0)), MAX_SPOTS));
    this.regionA = vec4Array(pad(regions.map((r) => new Vector4(r.center[0], r.center[1], r.center[2], r.radius)), MAX_REGIONS));
    this.regionB = vec4Array(pad(regions.map((r) => new Vector4(r.axis[0], r.axis[1], r.axis[2], r.activity)), MAX_REGIONS));
    this.flareVecs = Array.from({ length: FLARE_SLOTS * 3 }, () => new Vector4(0, 0, 0, 0));
    this.flares = vec4Array(this.flareVecs);
    this.magnetic = new MagneticState();
  }

  /** Star-frame rotation angle at game time t (s). */
  static rotationAngle(t: number): number {
    return RELATIVE_ROTATION_RATE * (t + STAR_EPOCH);
  }

  update(gameTime: number): void {
    const t = gameTime + STAR_EPOCH;
    const a = RELATIVE_ROTATION_RATE * t;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // X_star = Rz(a) · n_world
    this.rotMatrix.set(c, -s, 0, s, c, 0, 0, 0, 1);
    (this.rotation.value as Matrix3).copy(this.rotMatrix);
    this.time.value = t;
    (this.subObserver.value as Vector3).set(s, -c, 0);
    this.updateFlares(t, [s, -c, 0]);
    this.magnetic.update(t, [s, -c, 0]);
  }

  private updateFlares(t: number, sub: V3): void {
    // Flares that could be active (or still echoing): the last few started before t.
    const kNow = Math.floor(t / FLARE_INTERVAL) + 1;
    let slot = 0;
    for (const v of this.flareVecs) v.set(0, 0, 0, 0);
    for (let k = kNow; k >= Math.max(0, kNow - 8) && slot < FLARE_SLOTS; k--) {
      if (flareStart(k) > t) continue;
      const f = flareEvent(k, this.catalogue.regions);
      if (flareEnvelope(f, t) < 0.01) continue;
      const region = this.catalogue.regions[f.region];
      // Flares on the visible cap and just beyond (the far shell's mirrors see a little further round).
      if (!region || dot3(region.center, sub) < 0.6) continue;
      this.flareVecs[slot * 3].set(f.region, f.intensity * (0.5 + 0.5 * region.activity), f.twist, f.start);
      this.flareVecs[slot * 3 + 1].set(f.rise, f.decay, 1, 0);
      this.flareVecs[slot * 3 + 2].set(...f.bursts);
      slot++;
    }
  }
}
