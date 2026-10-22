/**
 * The loading glyph's sphere (the logo, docs/design.md §3), as one model shared by the offline
 * illustration (tools/sphereArt.ts) and the live coolant overlay (sphereGlyph.ts), so the two
 * register exactly.
 *
 * Unit sphere, orthographic, seen from 12° above the band with spine 0 facing the eye. The frame
 * stands off the gores: band ring outermost, hub collars where the spines end on it, spines and
 * latitude rings, polar collars. Each sector carries a gore of riveted plates; the two sectors
 * either side of the front spine are cut low, leaving wide windows onto the star, and every gore
 * stands clear of its spines, leaving a narrow slot. As in the world (docs/design.md), only the
 * band turns: it runs through the hub collars of the fixed frame.
 */

export type V3 = [number, number, number];

const DEG = Math.PI / 180;

/** The view's elevation above the band. */
export const TILT = 12 * DEG;
/** Glyph units per sphere radius, and the half-extent of the drawing (viewBox and image alike). */
export const UNIT = 100;
export const HALF = 118;

/** Radii of the shells, outermost first. */
export const SHELL = {
  collar: 1.062,
  band: 1.042,
  hub: 1.05,
  frame: 1.022,
  gore: 1,
  star: 0.56,
} as const;

/** Angles in degrees (physical: a longitude span is measured along the parallel). */
export const FRAME = {
  /** Band ring half-height. */
  band: 5.2,
  /** The latitude rings that bound the open bands either side of the band. */
  ring: 14.5,
  ringHalf: 1.0,
  /** Spines: half-width, and where they meet the polar collars. */
  spineHalf: 1.25,
  polar: 75.5,
  polarHalf: 1.9,
  /** Gores: from the ring to under the polar collar, standing clear of the spines by `slot`. */
  goreLo: 16.2,
  goreLoCut: 39,
  goreHi: 73,
  slot: 1.55,
  /** Hub collars: angular radii of the collar's bore and rim. */
  collarIn: 3.6,
  collarOut: 5.6,
} as const;

export const SPINES = [0, 60, 120, 180, 240, 300] as const;

/**
 * The belt (the band, with the hub collars it runs through) as a sprite of the band's turn:
 * `frames` frames over one `period` (degrees, where the band's pattern repeats) in a `cols`×`rows`
 * grid, row-major. Each cell is `pitch` glyph units wide, centred on the drawing (wider than it, so
 * no cell's light reaches the next), and spans `top`–`bottom` units from the centre, y down: the
 * belt's visible extent with a margin.
 */
export const BELT = { period: 60, frames: 120, cols: 12, rows: 10, pitch: 295, top: -24, bottom: 48 } as const;

/** Sectors (by their first spine) whose gores are cut low: either side of the front spine. */
const CUT_SECTORS = new Set([0, 300]);

/** Model space (y up, z toward the eye at spine 0) to view space (z toward the eye). */
export function toView([x, y, z]: V3): V3 {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  return [x, y * c - z * s, z * c + y * s];
}

export function fromView([x, y, z]: V3): V3 {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  return [x, y * c + z * s, z * c - y * s];
}

/** A point on a shell (radius r) at latitude/longitude in degrees, in view space. */
export function onShell(lat: number, lon: number, r: number): V3 {
  const t = lat * DEG;
  const p = lon * DEG;
  return toView([r * Math.cos(t) * Math.sin(p), r * Math.sin(t), r * Math.cos(t) * Math.cos(p)]);
}

/** Longitude in [0, 360). */
export function wrapLon(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

/** Signed physical angular distance (degrees along the parallel) from the nearest spine, and that spine. */
export function fromSpine(lat: number, lon: number): { d: number; spine: number } {
  const l = wrapLon(lon);
  const spine = (Math.round(l / 60) * 60) % 360;
  let dl = l - spine;
  if (dl > 180) dl -= 360;
  return { d: dl * Math.cos(lat * DEG), spine };
}

export function sectorOf(lon: number): number {
  return Math.floor(wrapLon(lon) / 60) * 60;
}

export function goreLow(sector: number): number {
  return CUT_SECTORS.has(sector) ? FRAME.goreLoCut : FRAME.goreLo;
}

/** Great-circle distance (degrees) from a point to the hub at (0, lon). */
export function fromHub(lat: number, lon: number, hubLon: number): number {
  const t = lat * DEG;
  const d = (lon - hubLon) * DEG;
  return Math.acos(Math.min(1, Math.cos(t) * Math.cos(d))) / DEG;
}

// Coolant overlay ------------------------------------------------------------

/** One lit run of coolant line: a polyline on a shell, in view space. */
export interface CoolantRun {
  readonly points: V3[];
  readonly closed: boolean;
  /** Stroke width in glyph units. */
  readonly width: number;
}

/** A frame member, as the runs of coolant line that light with it. */
export interface Member {
  readonly name: string;
  readonly runs: CoolantRun[];
}

function parallel(lat: number, r: number, lon0 = 0, lon1 = 360, steps = 180): V3[] {
  return Array.from({ length: steps + 1 }, (_, i) => onShell(lat, lon0 + ((lon1 - lon0) * i) / steps, r));
}

function meridian(lon: number, lat0: number, lat1: number, r: number, steps = 80): V3[] {
  return Array.from({ length: steps + 1 }, (_, i) => onShell(lat0 + ((lat1 - lat0) * i) / steps, lon, r));
}

/** A small circle of angular radius `rad` (degrees) round the hub on the band at `lon`, on shell r. */
function hubCircle(lon: number, rad: number, r: number, steps = 64): V3[] {
  const a = rad * DEG;
  const p = lon * DEG;
  const c: V3 = [Math.sin(p), 0, Math.cos(p)];
  const east: V3 = [Math.cos(p), 0, -Math.sin(p)];
  return Array.from({ length: steps }, (_, i) => {
    const t = (2 * Math.PI * i) / steps;
    const u = Math.cos(a);
    const v = Math.sin(a);
    const x = c[0] * u + v * Math.cos(t) * east[0];
    const y = v * Math.sin(t);
    const z = c[2] * u + v * Math.cos(t) * east[2];
    return toView([r * x, r * y, r * z]);
  });
}

/** Spine coolant: a line down the crown, from the polar collar to the hub collar (both hemispheres). */
function spineRuns(lon: number): CoolantRun[] {
  const r = SHELL.frame + 0.002;
  const end = FRAME.collarOut + 0.3;
  return [
    { points: meridian(lon, end, FRAME.polar - FRAME.polarHalf, r), closed: false, width: 0.42 },
    { points: meridian(lon, -end, -FRAME.polar + FRAME.polarHalf, r), closed: false, width: 0.42 },
  ];
}

/** The band's coolant channels, broken where the hub collars ride over them. */
function bandRuns(lat: number, r: number): CoolantRun[] {
  const runs: CoolantRun[] = [];
  // Longitude offset at which this parallel leaves a collar's rim (great-circle radius).
  const clear = Math.acos(Math.cos((FRAME.collarOut + 0.15) * DEG) / Math.cos(lat * DEG)) / DEG;
  for (const hub of SPINES) {
    // From this hub's collar to the next one's.
    const a = hub + clear;
    const b = hub + 60 - clear;
    runs.push({ points: parallel(lat, r, a, b, 48), closed: false, width: 0.5 });
  }
  return runs;
}

/** The frame in the order loading lights it: band, its collars, the spines, the rings, the poles. */
export function members(): Member[] {
  const bandEdge = FRAME.band - 0.75;
  const rb = SHELL.band + 0.002;
  return [
    { name: 'band', runs: [...bandRuns(bandEdge, rb), ...bandRuns(-bandEdge, rb)] },
    ...SPINES.map((lon) => ({
      name: `collar ${lon}`,
      runs: [
        { points: hubCircle(lon, FRAME.collarOut - 0.55, SHELL.collar + 0.002), closed: true, width: 0.45 },
        { points: hubCircle(lon, FRAME.collarIn + 0.35, SHELL.collar + 0.002), closed: true, width: 0.3 },
      ],
    })),
    ...SPINES.map((lon) => ({ name: `spine ${lon}`, runs: spineRuns(lon) })),
    ...[FRAME.ring, -FRAME.ring].map((lat) => ({ name: `ring ${lat}`, runs: [{ points: parallel(lat, SHELL.frame + 0.002), closed: true, width: 0.36 }] })),
    ...[FRAME.polar, -FRAME.polar].map((lat) => ({
      name: `polar ${lat}`,
      runs: [
        { points: parallel(lat + Math.sign(lat) * 0.8, SHELL.frame + 0.002, 0, 360, 120), closed: true, width: 0.36 },
        { points: parallel(lat - Math.sign(lat) * 0.8, SHELL.frame + 0.002, 0, 360, 120), closed: true, width: 0.36 },
      ],
    })),
  ];
}
