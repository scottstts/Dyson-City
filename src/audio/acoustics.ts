/**
 * The acoustic spaces and what couples them (docs/audio.md). Pure: positions in, gains and filter
 * cutoffs out.
 *
 * Four zones: the band outside (0.55 bar, open to the horizon), the gate chamber (a sealed stone
 * vault whose pressure cycles), the city under the Dome (1 bar, enormous), and the house's rooms
 * on the estate. Sound crosses between them through the West Gate's leaves (an 80 mm steel skin:
 * nothing but a low rumble when shut, everything once open), the Dome's glass, or the house's
 * walls and shut sashes (an open outer door lets the estate in).
 *
 * Which zone a point is in is plan geometry except for the house, whose rooms the house itself
 * knows (AudioEngine.locate).
 */
import { H, HOUSE_FOOTPRINT } from '../estate/layout';
import { GATE } from '../city/gate/spec';
import { openingHeight } from '../city/gate/lighting';
import { PAD_OUTER_RADIUS } from '../ground/site';
import { SILL } from '../city/dome/spec';

export type Zone = 'outside' | 'chamber' | 'city' | 'house';
export const ZONES: readonly Zone[] = ['outside', 'chamber', 'city', 'house'];

export const SPEED_OF_SOUND = 343;

/** Which space a point (plan position) is in, outside the house's rooms. */
export function zoneAt(x: number, z: number): Zone {
  if (Math.abs(z) < GATE.passageHalf) {
    if (x > GATE.outerLipX && x < GATE.innerLipX) return 'chamber';
    if (x <= GATE.outerLipX && x >= GATE.westX) return 'outside';
    if (x >= GATE.innerLipX && x <= GATE.eastX) return 'city';
  }
  return Math.hypot(x, z) < SILL.rIn ? 'city' : 'outside';
}

/** A path's effect on sound: broadband gain and a low-pass cutoff (Hz). */
export interface Path {
  gain: number;
  cutoff: number;
}

export const OPEN_PATH: Readonly<Path> = { gain: 1, cutoff: 20000 };

/**
 * A shut leaf (or the Dome's glass) passes only structure-borne low rumble. Mass law for 80 mm of
 * steel gives ~50 dB at 100 Hz and more above; flanking through the piers leaves a little more.
 */
const SHUT: Path = { gain: 0.004, cutoff: 160 };
const GLASS: Path = { gain: 0.006, cutoff: 220 };
/**
 * The house's shell, shut: brick and clapboard walls with sash windows. The sashes are the weak
 * part (single glazing in timber frames, ~25–30 dB); what gets through is mostly below 600 Hz.
 */
const FACADE: Path = { gain: 0.035, cutoff: 600 };

/**
 * Through the house's shell with its outer doors `open` (0..1, the widest open leaf): a door's
 * gap leaks early as the gate's slot does, and wide open the hall hears the estate nearly as the
 * porch does (a 1 m opening into a room, not the same space: −6 dB).
 */
export function facadePath(open: number): Path {
  const f = Math.min(Math.max(open, 0), 1);
  if (f <= 0) return { ...FACADE };
  const o = Math.pow(f, 0.4);
  return { gain: FACADE.gain + (0.5 - FACADE.gain) * o, cutoff: FACADE.cutoff * Math.pow(20000 / FACADE.cutoff, Math.pow(f, 0.3)) };
}

/**
 * Through a gate opening `h` metres high (lip above the sill). Even a slot leaks a lot: an 18 m
 * wide gap of 2 cm passes ~−20 dB, and its highs most of all once it is wider than their
 * wavelength. Fully open, the passage is just more of the same space.
 */
export function aperture(h: number): Path {
  const full = GATE.clearTop - GATE.seal;
  const f = Math.min(Math.max(h / full, 0), 1);
  if (f <= 0) return { ...SHUT };
  const open = Math.pow(f, 0.35);
  return {
    gain: SHUT.gain + (1 - SHUT.gain) * open,
    cutoff: SHUT.cutoff * Math.pow(20000 / SHUT.cutoff, Math.pow(f, 0.25)),
  };
}

/** Gate openness (0..1, as the airlock reports it) to an aperture. */
export function gatePath(openness: number): Path {
  return aperture(openingHeight(openness));
}

function series(a: Path, b: Path): Path {
  return { gain: a.gain * b.gain, cutoff: Math.min(a.cutoff, b.cutoff) };
}

function louder(a: Path, b: Path): Path {
  return a.gain >= b.gain ? a : b;
}

/** Path from a sound in zone `from` to a listener in zone `to`, given the gates' and the house's outer doors' openness. */
export function transmission(from: Zone, to: Zone, outerOpen: number, innerOpen: number, houseOpen = 0): Path {
  if (from === to) return { ...OPEN_PATH };
  // The house stands in the city: to or from it, through its shell, then on as from the city.
  if (from === 'house') return to === 'city' ? facadePath(houseOpen) : series(facadePath(houseOpen), transmission('city', to, outerOpen, innerOpen));
  if (to === 'house') return from === 'city' ? facadePath(houseOpen) : series(transmission(from, 'city', outerOpen, innerOpen), facadePath(houseOpen));
  const outer = gatePath(outerOpen);
  const inner = gatePath(innerOpen);
  if ((from === 'outside' && to === 'chamber') || (from === 'chamber' && to === 'outside')) return outer;
  if ((from === 'chamber' && to === 'city') || (from === 'city' && to === 'chamber')) return inner;
  // Outside ↔ city: through the glass, or through the chamber (the gates never both stand open).
  return louder({ ...GLASS }, series(outer, inner));
}

/**
 * Radiation into air of density ρ: a surface vibrating at a given velocity radiates pressure in
 * proportion to ρc, so the band's 0.55 bar air carries every sound 5 dB quieter than the city's.
 * Returns the amplitude factor relative to 1 bar.
 */
export function mediumFactor(zone: Zone, chamberBar: number): number {
  if (zone === 'outside') return 0.55;
  if (zone === 'city' || zone === 'house') return 1;
  return chamberBar;
}

/**
 * Air absorption over `d` metres as a low-pass cutoff: classical plus relaxation absorption grows
 * as f² (≈ 0.1 dB/m at 8 kHz in the city's humid 1 bar air) and inversely with pressure, so the
 * band's thin dry air dulls distant sounds sooner. The cutoff is where the loss reaches 3 dB.
 */
export function airCutoff(zone: Zone, d: number): number {
  const k = zone === 'outside' ? 2.4e-9 : 1.56e-9; // dB per metre per Hz²
  return Math.min(20000, Math.sqrt(3 / (k * Math.max(d, 1))));
}

/**
 * Distance (m) from a listener to the nearest large reflecting face of their zone: the Dome's
 * drum and the gatehouse front outside, the drum's glass, the gatehouse's inner faces and the
 * house's walls in the city. The chamber's and the house's rooms are in their impulse responses.
 */
export function wallDistance(zone: Zone, x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (zone === 'chamber') return GATE.passageHalf;
  if (zone === 'house') return MIN_WALL_DISTANCE;
  // The piers' end faces (the passage between them is open): outside the west ends, inside the east.
  const faceX = zone === 'outside' ? GATE.westX : GATE.eastX;
  const pier = Math.min(segmentDistance(x, z, faceX, GATE.passageHalf, GATE.outerHalf), segmentDistance(x, z, faceX, -GATE.outerHalf, -GATE.passageHalf));
  const drum = zone === 'outside' ? r - PAD_OUTER_RADIUS : SILL.rIn - r;
  const house = zone === 'city' ? houseDistance(x, z) : Infinity;
  // Closer than a couple of metres the slap merges with the direct sound; keep it a reflection.
  return Math.max(Math.min(pier, Math.abs(drum), house), MIN_WALL_DISTANCE);
}

/** The house's walls in plan (world): its foundation outline. */
const HOUSE_WALLS = HOUSE_FOOTPRINT[0].map(([x, z]) => H(x, z));
const HOUSE_BOUND = (() => {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of HOUSE_WALLS) {
    cx += x / HOUSE_WALLS.length;
    cz += z / HOUSE_WALLS.length;
  }
  return { cx, cz, r: Math.max(...HOUSE_WALLS.map(([x, z]) => Math.hypot(x - cx, z - cz))) };
})();

/** Plan distance from (x, z) to the house's walls (Infinity beyond any slap's reach). */
function houseDistance(x: number, z: number): number {
  if (Math.hypot(x - HOUSE_BOUND.cx, z - HOUSE_BOUND.cz) > HOUSE_BOUND.r + MAX_SLAP_DISTANCE) return Infinity;
  let best = Infinity;
  for (let i = 0; i < HOUSE_WALLS.length; i++) {
    const [ax, az] = HOUSE_WALLS[i];
    const [bx, bz] = HOUSE_WALLS[(i + 1) % HOUSE_WALLS.length];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0), 1);
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/** Beyond this the house's slap is weaker than the drum's anyway. */
const MAX_SLAP_DISTANCE = 60;

const MIN_WALL_DISTANCE = 2.5;

/** Plan distance from (x, z) to the segment x = fx, z ∈ [z0, z1]. */
function segmentDistance(x: number, z: number, fx: number, z0: number, z1: number): number {
  const dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
  return Math.hypot(x - fx, dz);
}
