/**
 * The secondary plant's lots (docs/field.md, "Secondary plant"): every precinct is filled as a
 * working plant, 40–55 % built, by packing its free ground in strips along its long side with
 * service lanes between them. What stands on a lot follows the precinct's zone (a weighted menu);
 * along the craft corridor the first strip is a row of hangars whose doors face it.
 *
 * Keep-outs are declared here from the layout, not measured from the heroes' geometry: the heroes'
 * footprints (with a working margin), the core, roads, trenches, viaducts and pavilions, the
 * corridor, the estate, the compound's edge. Heights stay under the glass (with its clearance),
 * low near the estate, under the corridor's ceiling margin beside it.
 *
 * Pure data: the builders (buildings.ts), the site plan and the tests read the same lots.
 */
import {
  CONVERTER,
  CORRIDOR,
  COLD_HOLD,
  ESTATE,
  GLASS_CLEARANCE,
  GYRE,
  HOUSE_SITE,
  LOOM,
  MAST,
  PAVILIONS,
  PLANT,
  PRECINCTS,
  RECKONER,
  RESONATOR,
  RING_ROAD,
  STILLS,
  TRENCH_HALF,
  distToSegment,
  distToViaduct,
  glassHeightAt,
  inCompound,
  inEstate,
  onRoad,
  trenchLines,
  type Precinct,
  type Zone,
} from '../layout';
import { rng } from '../kit/parts';
import { inLane, precinctLanes, type Lane } from './lanes';

export type PlantKind = 'hall' | 'hangar' | 'drum' | 'tanks' | 'spheres' | 'switchyard' | 'lab' | 'store' | 'chiller';

export interface Lot {
  name: string;
  precinct: string;
  zone: Zone;
  kind: PlantKind;
  /** Footprint centre. */
  x: number;
  z: number;
  /** Long axis along x (0) or z (1). */
  axis: 0 | 1;
  /** Long and short footprint sizes, and the height (top of the building's body or roof, not its stacks). */
  L: number;
  W: number;
  H: number;
  /** The tallest anything on the lot may stand (stacks, vents): the glass, the estate, the corridor. */
  cap: number;
  /** The side its front faces (±1 along the short axis): the lane, or the corridor for a hangar. */
  face: 1 | -1;
  seed: number;
}

/** Size ranges by kind: long side, short side, height. */
export const KIND: Record<PlantKind, { L: [number, number]; W: [number, number]; H: [number, number] }> = {
  hall: { L: [36, 72], W: [18, 28], H: [12, 20] },
  hangar: { L: [44, 60], W: [30, 40], H: [16, 18] },
  drum: { L: [16, 26], W: [16, 26], H: [9, 14] },
  tanks: { L: [30, 56], W: [20, 30], H: [10, 16] },
  spheres: { L: [30, 46], W: [15, 19], H: [13, 17] },
  switchyard: { L: [40, 64], W: [24, 34], H: [11, 14] },
  lab: { L: [24, 44], W: [16, 26], H: [10, 24] },
  store: { L: [40, 72], W: [22, 32], H: [9, 12] },
  chiller: { L: [36, 60], W: [18, 26], H: [9, 12] },
};

const MENU: Record<Zone, [PlantKind, number][]> = {
  craft: [['hall', 2], ['store', 1], ['drum', 1]],
  instruments: [['lab', 3], ['hall', 1], ['drum', 1]],
  power: [['switchyard', 3], ['hall', 2], ['drum', 1]],
  cryo: [['drum', 3], ['tanks', 2], ['spheres', 2], ['hall', 1]],
  science: [['lab', 3], ['hall', 1]],
  works: [['store', 3], ['hall', 2], ['drum', 1], ['tanks', 1]],
  heat: [['chiller', 3], ['hall', 1]],
};

/** Packing: margin inside a precinct's edge, lanes between strips, gaps between buildings, clearance to keep-outs. */
export const PACK = { edge: 7, lane: [9, 12], gap: [6, 10], clear: 2.5, minH: 7 } as const;

type Shape = { kind: 'rect'; x0: number; x1: number; z0: number; z1: number } | { kind: 'circle'; x: number; z: number; r: number } | { kind: 'obox'; x: number; z: number; ux: number; uz: number; hu: number; hv: number };

/** The heroes' working footprints in plan. */
export function heroKeepouts(): { name: string; shape: Shape }[] {
  const n = [HOUSE_SITE[0] - RESONATOR.x, HOUSE_SITE[1] - RESONATOR.z];
  const nl = Math.hypot(n[0], n[1]);
  return [
    { name: 'gyre', shape: { kind: 'rect', x0: GYRE.x - 54, x1: GYRE.x + 54, z0: GYRE.z - GYRE.plinth.hz - 8, z1: GYRE.z + GYRE.plinth.hz + 8 } },
    // The Resonator's plinth runs along the ring's plane (across the line to the house).
    { name: 'resonator', shape: { kind: 'obox', x: RESONATOR.x, z: RESONATOR.z, ux: -n[1] / nl, uz: n[0] / nl, hu: RESONATOR.pylonOff + 16, hv: RESONATOR.plinthHalf + 10 } },
    { name: 'hold', shape: { kind: 'rect', x0: COLD_HOLD.x0 - 6, x1: COLD_HOLD.x1 + 6, z0: COLD_HOLD.z0 - 6, z1: COLD_HOLD.z1 + 6 } },
    { name: 'mast', shape: { kind: 'circle', x: MAST.x, z: MAST.z, r: 38 } },
    { name: 'loom', shape: { kind: 'rect', x0: LOOM.x0 - 10, x1: LOOM.spool.x + LOOM.spool.d / 2 + 10, z0: LOOM.zA - 22, z1: LOOM.zB + 22 } },
    { name: 'stills', shape: { kind: 'circle', x: STILLS.x, z: STILLS.z, r: STILLS.podiumR + 10 } },
    { name: 'converter', shape: { kind: 'circle', x: CONVERTER.x, z: CONVERTER.z, r: CONVERTER.podiumR + 10 } },
    { name: 'reckoner', shape: { kind: 'circle', x: RECKONER.x, z: RECKONER.z, r: RECKONER.podiumR + 10 } },
    ...PLANT.regions.map((r, i) => ({ name: `radiators${i}`, shape: { kind: 'rect', x0: r.x0 - 6, x1: r.x1 + 6, z0: r.z0 - 6, z1: r.z1 + 6 } as Shape })),
  ];
}

export function inShape(s: Shape, x: number, z: number, m: number): boolean {
  if (s.kind === 'rect') return x > s.x0 - m && x < s.x1 + m && z > s.z0 - m && z < s.z1 + m;
  if (s.kind === 'circle') return Math.hypot(x - s.x, z - s.z) < s.r + m;
  const dx = x - s.x;
  const dz = z - s.z;
  const u = dx * s.ux + dz * s.uz;
  const v = -dx * s.uz + dz * s.ux;
  return Math.abs(u) < s.hu + m && Math.abs(v) < s.hv + m;
}

const HEROES = heroKeepouts();
const TRENCHES = trenchLines();

/** Is (x, z) unavailable to secondary plant (with margin m)? */
export function plantBlocked(x: number, z: number, m: number): boolean {
  if (!inCompound(x, z, 4 + m)) return true;
  if (Math.hypot(x, z) < RING_ROAD.r1 + 10 + m) return true;
  if (onRoad(x, z, 3 + m)) return true;
  if (TRENCHES.some((t) => distToSegment(x, z, t) < TRENCH_HALF + 2 + m)) return true;
  if (distToViaduct(x, z) < 6 + m) return true;
  if (PAVILIONS.some((p) => Math.hypot(p.x - x, p.z - z) < 10 + m)) return true;
  if (x > CORRIDOR.x0 - 6 && Math.abs(z) < CORRIDOR.half + 4 + m) return true;
  if (inEstate(x, z, 12 + m)) return true;
  return HEROES.some((h) => inShape(h.shape, x, z, m));
}

/** Corners and an interior lattice (≤ 3 m) of a footprint, grown by m. */
function footprintSamples(x: number, z: number, hx: number, hz: number, m: number): [number, number][] {
  const out: [number, number][] = [];
  const nx = Math.max(1, Math.ceil((2 * (hx + m)) / 3));
  const nz = Math.max(1, Math.ceil((2 * (hz + m)) / 3));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push([x - hx - m + (2 * (hx + m) * i) / nx, z - hz - m + (2 * (hz + m) * j) / nz]);
  return out;
}

/** Tallest a building may stand on a footprint: the glass (with clearance), the estate, the corridor. */
export function heightCap(x: number, z: number, hx: number, hz: number): number {
  let cap = Infinity;
  for (const [px, pz] of footprintSamples(x, z, hx, hz, 0)) cap = Math.min(cap, glassHeightAt(Math.hypot(px, pz)) - GLASS_CLEARANCE - 2);
  // Low beside the estate (the house looks over it).
  const dx = Math.max(0, x - hx - ESTATE.east);
  const dz = Math.max(0, ESTATE.north - (z + hz), z - hz - ESTATE.south);
  if (Math.hypot(dx, dz) < 60) cap = Math.min(cap, 8);
  // Under the corridor's ceiling, with a margin, beside it.
  if (x + hx > CORRIDOR.x0 - 30 && Math.abs(z) - hz < CORRIDOR.half + 60) cap = Math.min(cap, 18);
  return cap;
}

function pick<T>(rand: () => number, menu: [T, number][]): T {
  const sum = menu.reduce((a, [, w]) => a + w, 0);
  let r = rand() * sum;
  for (const [k, w] of menu) if ((r -= w) <= 0) return k;
  return menu[menu.length - 1][0];
}

const between = (rand: () => number, [a, b]: readonly [number, number] | [number, number]) => a + (b - a) * rand();

/** Does a precinct border the craft corridor (its hangar row)? */
function besideCorridor(p: Precinct): 1 | -1 | 0 {
  if (p.x1 < CORRIDOR.x0) return 0;
  if (p.z1 < 0 && p.z1 > -CORRIDOR.half - 6) return 1;
  if (p.z0 > 0 && p.z0 < CORRIDOR.half + 6) return -1;
  return 0;
}

/**
 * Packs a precinct on a 1 m raster: scanning rows from the precinct's corner, each free cell takes
 * the largest building of the zone's menu that fits there (clear of keep-outs, a gap from the
 * buildings already placed). Anchored at the scan corner, buildings line up in rows and the gaps
 * between them become the lanes.
 */
function packPrecinct(p: Precinct, seed: number): Lot[] {
  const rand = rng(seed);
  const lots: Lot[] = [];
  const x0 = Math.ceil(p.x0 + PACK.edge);
  const z0 = Math.ceil(p.z0 + PACK.edge);
  const nx = Math.floor(p.x1 - PACK.edge) - x0;
  const nz = Math.floor(p.z1 - PACK.edge) - z0;
  if (nx < 20 || nz < 20) return lots;
  // Blocked cells (keep-outs grown by the clearance) and taken cells (buildings grown by half a gap).
  // The service lanes first (lanes.ts): the buildings line up along them.
  const lanes = precinctLanes(p, (x, z) => plantBlocked(x, z, 0));
  LANES.push(...lanes);
  const blocked = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) blocked[j * nx + i] = plantBlocked(x0 + i + 0.5, z0 + j + 0.5, PACK.clear) ? 1 : 0;
  for (const ln of lanes) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inLane(ln, x0 + i + 0.5, z0 + j + 0.5)) blocked[j * nx + i] = 1;
  const taken = new Uint8Array(nx * nz);
  const sat = new Int32Array((nx + 1) * (nz + 1));
  const rebuild = () => {
    for (let j = 0; j < nz; j++) {
      let row = 0;
      for (let i = 0; i < nx; i++) {
        row += blocked[j * nx + i] | taken[j * nx + i];
        sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + row;
      }
    }
  };
  rebuild();
  /** Cells [i0, i1) × [j0, j1) all free (and inside)? */
  const empty = (i0: number, j0: number, i1: number, j1: number) => {
    if (i0 < 0 || j0 < 0 || i1 > nx || j1 > nz) return false;
    return sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0] === 0;
  };
  const place = (kind: PlantKind, i: number, j: number, sx: number, sz: number, face: 1 | -1, want: number): boolean => {
    const cx = x0 + i + sx / 2;
    const cz = z0 + j + sz / 2;
    const cap = heightCap(cx, cz, sx / 2, sz / 2);
    const H = Math.min(want, cap);
    if (H < PACK.minH) return false;
    const axis: 0 | 1 = sx >= sz ? 0 : 1;
    lots.push({ name: `${p.name}-${lots.length}`, precinct: p.name, zone: p.zone, kind, x: cx, z: cz, axis: kind === 'hangar' ? 1 : axis, L: kind === 'hangar' ? sz : Math.max(sx, sz), W: kind === 'hangar' ? sx : Math.min(sx, sz), H, cap, face, seed: Math.floor(rand() * 1e9) });
    const g = Math.round(between(rand, PACK.gap));
    for (let jj = Math.max(0, j - g); jj < Math.min(nz, j + sz + g); jj++) for (let ii = Math.max(0, i - g); ii < Math.min(nx, i + sx + g); ii++) taken[jj * nx + ii] = 1;
    rebuild();
    return true;
  };

  // The hangar row: along the corridor's edge, spans along x, doors facing the corridor.
  const side = besideCorridor(p);
  if (side !== 0) {
    const depth = Math.round(between(rand, KIND.hangar.L));
    const j = side === 1 ? nz - depth : 0;
    for (let i = 0; i < nx; i += 2) {
      const span = Math.round(between(rand, KIND.hangar.W));
      if (empty(i, j, i + span, j + depth) && place('hangar', i, j, span, depth, side, KIND.hangar.H[1])) i += span;
    }
  }

  // Scan from the corner nearest the core outward, so the inner rows fill first.
  const flipX = Math.abs(p.x1) < Math.abs(p.x0);
  const flipZ = Math.abs(p.z1) < Math.abs(p.z0);
  for (let jj = 0; jj < nz; jj += 2) {
    for (let ii = 0; ii < nx; ii += 2) {
      const j = flipZ ? nz - 1 - jj : jj;
      const i = flipX ? nx - 1 - ii : ii;
      if (blocked[j * nx + i] | taken[j * nx + i]) continue;
      const kind = pick(rand, MENU[p.zone]);
      const k = KIND[kind];
      const W = Math.round(between(rand, k.W));
      const want = between(rand, k.H);
      // Longest first, along the precinct's long side, then across; drums and sphere rows keep their shape.
      const alongX = nx >= nz;
      let done = false;
      for (let L = Math.round(kind === 'drum' ? W : k.L[1]); L >= (kind === 'drum' ? W : k.L[0] * 0.7) && !done; L -= 4) {
        for (const ax of alongX ? [0, 1] : [1, 0]) {
          const sx = ax === 0 ? L : W;
          const sz = ax === 0 ? W : L;
          // Anchored at the scan corner (the box grows away from it).
          const ia = flipX ? i - sx + 1 : i;
          const ja = flipZ ? j - sz + 1 : j;
          if (empty(ia, ja, ia + sx, ja + sz) && place(kind, ia, ja, sx, sz, ((flipZ ? -1 : 1) * (ax === 0 ? 1 : -1)) as 1 | -1, want)) {
            done = true;
            break;
          }
        }
      }
    }
  }
  return lots;
}

const LANES: Lane[] = [];

let cached: Lot[] | null = null;

/** Every precinct's lots (deterministic). */
export function plantLots(): Lot[] {
  cached ??= PRECINCTS.flatMap((p, i) => packPrecinct(p, 7001 + i * 131));
  return cached;
}

/** Every precinct's service lanes (planned with the lots). */
export function plantLanes(): Lane[] {
  plantLots();
  return LANES;
}

/** Built fraction of each precinct's ground inside the compound (footprints over area). */
export function plantCoverage(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PRECINCTS) {
    let area = 0;
    for (let x = p.x0 + 2; x < p.x1; x += 4) for (let z = p.z0 + 2; z < p.z1; z += 4) if (inCompound(x, z)) area += 16;
    out[p.name] = area > 0 ? plantLots().filter((l) => l.precinct === p.name).reduce((s, l) => s + l.L * l.W, 0) / area : 0;
  }
  return out;
}
