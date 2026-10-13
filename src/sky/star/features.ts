/**
 * Deterministic catalogue of the star's large features, in the star's rotating frame (unit
 * vectors from the star centre). The shell spins about Z, so the frame turns about Z relative to
 * the observer; the star's own magnetic axis is tilted so activity belts cross the disc obliquely.
 *
 * Only a 45° heliocentric cap of the star is visible at any moment (the observer stands 1.41
 * star radii from its centre), and the relative rotation brings every longitude past in 17.5 h.
 */

export type V3 = [number, number, number];

export interface Spot {
  dir: V3;
  /** Penumbra angular radius on the star (radians). */
  penumbra: number;
  /** Umbra radius as a fraction of the penumbra radius. */
  umbraRatio: number;
  seed: number;
  region: number;
}

export interface ActiveRegion {
  center: V3;
  /** Unit tangent along the bipole axis (leader → follower). */
  axis: V3;
  /** Angular radius of the plage/facular envelope (radians). */
  radius: number;
  /** 0..1 activity, scales plage brightness and flare likelihood. */
  activity: number;
}

export interface StarCatalogue {
  regions: ActiveRegion[];
  spots: Spot[];
}

export const MAX_SPOTS = 48;
export const MAX_REGIONS = 24;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

/** Move along the sphere from `p` in tangent direction `t` by angle `ang`. */
export function slerpOffset(p: V3, t: V3, ang: number): V3 {
  return norm(add(scale(p, Math.cos(ang)), t, Math.sin(ang)));
}

/** Tilt of the star's own magnetic/rotation axis from the shell's spin axis. */
const OWN_AXIS_TILT = (28 * Math.PI) / 180;

export function buildStarCatalogue(seed = 20261013): StarCatalogue {
  const rnd = mulberry32(seed);
  const own: V3 = norm([Math.sin(OWN_AXIS_TILT), 0, -Math.cos(OWN_AXIS_TILT)]);
  // Basis around the own axis.
  const e1 = norm(cross(own, [0, 1, 0]));
  const e2 = norm(cross(own, e1));
  const fromHelio = (lat: number, lon: number): V3 =>
    norm(add(add(scale(e1, Math.cos(lat) * Math.cos(lon)), e2, Math.cos(lat) * Math.sin(lon)), own, Math.sin(lat)));

  const regions: ActiveRegion[] = [];
  const spots: Spot[] = [];

  const nRegions = 22;
  for (let i = 0; i < nRegions && regions.length < MAX_REGIONS; i++) {
    const hemi = rnd() < 0.5 ? -1 : 1;
    const lat = hemi * (0.12 + rnd() * 0.42);
    // Stratified longitudes so activity is spread around the star.
    const lon = ((i + rnd() * 0.8) / nRegions) * Math.PI * 2;
    const center = fromHelio(lat, lon);
    // Bipole axis along heliographic east–west with a Joy's-law tilt toward the equator.
    const east = norm(cross(own, center));
    const north = norm(cross(center, east));
    const joy = hemi * (0.12 + rnd() * 0.2);
    const axis = norm(add(scale(east, Math.cos(joy)), north, -Math.sin(joy)));
    const sizeClass = rnd();
    const big = sizeClass > 0.72;
    const medium = !big && sizeClass > 0.32;
    const leaderPen = big ? 0.022 + rnd() * 0.012 : medium ? 0.012 + rnd() * 0.008 : 0.006 + rnd() * 0.005;
    const separation = leaderPen * (2.4 + rnd() * 1.6);
    const regionIndex = regions.length;
    const regionRadius = separation * 1.25 + leaderPen * 2.2;
    regions.push({ center, axis, radius: regionRadius, activity: big ? 1 : medium ? 0.7 : 0.4 });

    const leaderPos = slerpOffset(center, axis, -separation * 0.45);
    pushSpot(spots, leaderPos, leaderPen, 0.38 + rnd() * 0.08, rnd(), regionIndex);
    // Follower: one large or a fragmented cluster.
    const followerCenter = slerpOffset(center, axis, separation * 0.55);
    const nFollow = big ? 2 + Math.floor(rnd() * 2) : medium ? 1 + Math.floor(rnd() * 2) : rnd() < 0.5 ? 1 : 0;
    for (let k = 0; k < nFollow; k++) {
      const jitter = norm(add(scale(axis, rnd() - 0.5), north, rnd() - 0.5));
      const p = slerpOffset(followerCenter, jitter, leaderPen * (0.4 + rnd() * 1.1) * (k === 0 ? 0.2 : 1));
      pushSpot(spots, p, leaderPen * (k === 0 ? 0.62 + rnd() * 0.2 : 0.3 + rnd() * 0.2), 0.36 + rnd() * 0.1, rnd(), regionIndex);
    }
    // Pores between and around the main spots.
    const nPores = big ? 4 : medium ? 3 : 1;
    for (let k = 0; k < nPores; k++) {
      const t = rnd() * 1.2 - 0.1;
      const base = slerpOffset(center, axis, (t - 0.45) * separation);
      const off = norm(add(scale(north, rnd() - 0.5), axis, rnd() - 0.5));
      pushSpot(spots, slerpOffset(base, off, leaderPen * rnd() * 1.4), 0.0022 + rnd() * 0.0025, 0.55, rnd(), regionIndex);
    }
  }

  return { regions, spots };
}

function pushSpot(spots: Spot[], dir: V3, penumbra: number, umbraRatio: number, seed: number, region: number): void {
  if (spots.length >= MAX_SPOTS) return;
  spots.push({ dir, penumbra, umbraRatio, seed, region });
}

// ---------------------------------------------------------------------------------------------
// Flares

export interface FlareEvent {
  region: number;
  start: number;
  /** Rise (s) and e-folding decay (s). */
  rise: number;
  decay: number;
  intensity: number;
  /** Orientation offset of the ribbon pair (radians around the region axis). */
  twist: number;
}

/**
 * Deterministic flare sequence: flare k starts at a seeded time and picks among the regions with a
 * seeded preference; whether it is visible is decided at evaluation time (only regions on the
 * visible cap are drawn). The schedule is a pure function of k, so any game time can be evaluated.
 */
export function flareEvent(k: number, regionCount: number, seed = 7717): FlareEvent {
  const rnd = mulberry32(seed + k * 7919);
  return {
    region: Math.floor(rnd() * regionCount),
    start: flareStart(k, seed),
    rise: 12 + rnd() * 20,
    decay: 60 + rnd() * 120,
    intensity: 0.6 + rnd() * 0.9,
    twist: (rnd() - 0.5) * 0.6,
  };
}

/** Start time of flare k: cumulative seeded intervals (closed-form via mean + bounded jitter). */
export function flareStart(k: number, seed = 7717): number {
  const rnd = mulberry32(seed * 31 + k * 104729);
  const mean = 150;
  return k * mean + (rnd() - 0.5) * mean * 0.8;
}

/** Envelope 0..1 of a flare at time t. */
export function flareEnvelope(f: FlareEvent, t: number): number {
  const dt = t - f.start;
  if (dt < 0) return 0;
  if (dt < f.rise) {
    const x = dt / f.rise;
    return x * x * (3 - 2 * x);
  }
  return Math.exp(-(dt - f.rise) / f.decay);
}
