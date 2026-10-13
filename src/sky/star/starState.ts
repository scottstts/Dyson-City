import { Matrix3, Vector3, Vector4 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { vec4Array, type Vec4Array } from '../../render/tsl/helpers';
import { RELATIVE_ROTATION_RATE } from '../../world/constants';
import {
  buildStarCatalogue,
  flareEnvelope,
  flareEvent,
  flareStart,
  MAX_REGIONS,
  MAX_SPOTS,
  type StarCatalogue,
  type V3,
} from './features';

/** Game-time epoch offset (s). Chosen so a large active region sits on the eastern half of the disc at spawn. */
export const STAR_EPOCH = 2350;
/** Convection evolution runs faster than real time so the surface visibly boils when watched. */
export const CONVECTION_TIME_SCALE = 20;
export const FLARE_SLOTS = 2;

const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * CPU-side state for the star: rotation of the star frame relative to the observer, feature
 * uniforms, and the flare scheduler. No per-frame allocation.
 */
export class StarState {
  readonly catalogue: StarCatalogue;
  readonly rotation = uniform(new Matrix3());
  /** Convection phase (radians-ish clock for granule evolution). */
  readonly evolution = uniform(0);
  readonly time = uniform(0);
  /**
   * The star's measured disc-mean radiance relative to the white photosphere's (per channel; see
   * starIlluminant.ts). Scales everything the star lights: air, far structure, ground.
   */
  readonly illuminant = uniform(new Vector3(1, 1, 1));
  readonly spotA: Vec4Array;
  readonly spotB: Vec4Array;
  readonly regionA: Vec4Array;
  readonly regionB: Vec4Array;
  /** Per slot: (regionIndex, envelope·intensity, twist, age seconds). */
  readonly flares: Vec4Array;
  readonly spotCount: number;
  readonly regionCount: number;

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
    this.flareVecs = Array.from({ length: FLARE_SLOTS }, () => new Vector4(0, 0, 0, 0));
    this.flares = vec4Array(this.flareVecs);
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
    this.evolution.value = (t * CONVECTION_TIME_SCALE * 2 * Math.PI) / 600;
    this.time.value = t;
    this.updateFlares(t, c, s);
  }

  /** Sub-observer direction in the star frame at the current rotation (world (0,−1,0) rotated). */
  private subObserver(c: number, s: number): V3 {
    return [s, -c, 0];
  }

  private updateFlares(t: number, c: number, s: number): void {
    const sub = this.subObserver(c, s);
    // Flares that could be active: the last few started before t.
    const kNow = Math.floor(t / 150) + 1;
    let slot = 0;
    for (const v of this.flareVecs) v.set(0, 0, 0, 0);
    for (let k = kNow; k >= Math.max(0, kNow - 8) && slot < FLARE_SLOTS; k--) {
      if (flareStart(k) > t) continue;
      const f = flareEvent(k, this.regionCount);
      const env = flareEnvelope(f, t);
      if (env < 0.01) continue;
      const region = this.catalogue.regions[f.region];
      if (!region || dot3(region.center, sub) < 0.74) continue; // only flares on the visible cap
      this.flareVecs[slot].set(f.region, env * f.intensity * (0.5 + 0.5 * region.activity), f.twist, t - f.start);
      slot++;
    }
  }
}

