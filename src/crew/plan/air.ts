/**
 * The crew's flights (docs/crew.md, "The air"): Spotters' inspection sorties and Ferries' runs.
 *
 *  - A Spotter rests on a cradle (a slender post, fixtures.ts) on open ground in its hero's
 *    precinct. A sortie climbs straight up, crosses at a cruise height clear of everything under
 *    the leg, holds a few stations beside its hero (dwelling, its camera on the work), and comes
 *    home the same way.
 *  - A Ferry shuttles between two landing pads in neighbouring precincts, crossing the avenue
 *    between them at cruise height: no robot crosses a road on the ground.
 *  - Every leg is checked against the field's height map (the highest surface in each 1 m texel,
 *    lighting/starShade.ts): at least 4 m over whatever stands within 5 m of it, 15 m under the glass,
 *    never into the craft corridor or over the pad, except the pad's own two Spotters, which sweep it
 *    only while the craft is away (agents/drone.ts).
 */
import { CORRIDOR, FIELD_Y, GYRE, COLD_HOLD, LOOM, MAST, PRECINCTS, glassHeightAt, inEstate, type Precinct } from '../../field/layout';
import { clusterPlans } from '../../field/heroes/towers';
import { towerTop } from '../../field/kit/tower';
import { resonatorFrame, TORUS } from '../../field/heroes/resonator';
import { RESONATOR } from '../../field/layout';
import { clearanceAt, type NavGrid } from '../nav';
import { v3, type Vec3 } from '../../geometry/polyMesh';

/** The field's height map: highest surface per texel (the star-shade raster's [lo, hi] pairs). */
export interface HeightMap {
  N: number;
  origin: number;
  cell: number;
  lohi: Float32Array;
}

/** The highest surface within r of a plan point (−∞ where nothing stands). */
export function heightNear(h: HeightMap, x: number, z: number, r: number): number {
  const i0 = Math.floor((x - r - h.origin) / h.cell);
  const i1 = Math.floor((x + r - h.origin) / h.cell);
  const j0 = Math.floor((z - r - h.origin) / h.cell);
  const j1 = Math.floor((z + r - h.origin) / h.cell);
  let top = -Infinity;
  for (let j = Math.max(0, j0); j <= Math.min(h.N - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(h.N - 1, i1); i++) {
      const v = h.lohi[2 * (j * h.N + i) + 1];
      if (v > top) top = v;
    }
  }
  return top;
}

export const AIR = {
  /** Clearance over structure (m), how far round a point counts, under the glass. */
  over: 4,
  reach: 5,
  glass: 15,
  /** Cruise speeds (m/s), climb and descent (m/s). */
  spotterSpeed: 5,
  ferrySpeed: 4,
  climb: 2.2,
  /** Spotter cradle height (its skids' seat), Ferry pad height. */
  cradle: 4.2,
  pad: 0.32,
} as const;

export interface Station {
  p: Vec3;
  /** Seconds held there (0: flown through), and where its camera looks. */
  dwell: number;
  look: Vec3 | null;
}

export interface Sortie {
  name: string;
  kind: 'spotter' | 'ferry';
  /** Where it rests: a cradle's seat, or a pad's top (the Ferry's two). */
  home: Vec3;
  /** The flight, from leaving home to arriving back (Ferries: to the other pad, then back). */
  stations: Station[];
  /** Rests between sorties (s). */
  rest: [number, number];
  /** Sweeps the pad: flies only while the craft is away. */
  pad?: boolean;
  /** A Ferry's far pad. */
  away?: Vec3;
}

const inCorridor = (p: Vec3) => p[0] > CORRIDOR.x0 - 12 && Math.abs(p[2]) < CORRIDOR.half + 12 && p[1] < FIELD_Y + 70;
const overPad = (p: Vec3) => Math.hypot(p[0], p[2]) < 60;

/** Whether a straight leg keeps clear of the field, the glass and (unless allowed) the corridor and pad. */
export function legClear(h: HeightMap, a: Vec3, b: Vec3, padAllowed = false, ends = 0): boolean {
  const L = v3.dist(a, b);
  const n = Math.max(1, Math.ceil(L / 2));
  for (let k = 0; k <= n; k++) {
    const p = v3.lerp(a, b, k / n);
    // The legs' first and last metres (onto a cradle or pad) are checked against the fixture, not the map.
    if (v3.dist(p, a) < ends || v3.dist(p, b) < ends) continue;
    if (p[1] < heightNear(h, p[0], p[2], AIR.reach) + AIR.over) return false;
    if (p[1] > FIELD_Y + glassHeightAt(Math.hypot(p[0], p[2])) - AIR.glass) return false;
    if (!padAllowed && (inCorridor(p) || overPad(p))) return false;
    // The garden stays quiet: nothing flies over the estate.
    if (inEstate(p[0], p[2], 12)) return false;
  }
  return true;
}

/** Open ground for a fixture: free on the grid and nothing overhead within r. */
function openSpot(nav: NavGrid, h: HeightMap, p: Precinct, near: [number, number], clear: number, sky: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let x = p.x0 + 8; x < p.x1 - 8; x += 3) {
    for (let z = p.z0 + 8; z < p.z1 - 8; z += 3) {
      if (clearanceAt(nav, x, z) < clear) continue;
      if (heightNear(h, x, z, sky) > FIELD_Y + 0.6) continue;
      const d = Math.hypot(x - near[0], z - near[1]);
      if (d < bd) {
        bd = d;
        best = [x, z];
      }
    }
  }
  return best;
}

/** A flight out from home through stations and back, its cruise legs lifted until they clear. */
function route(h: HeightMap, home: Vec3, stations: Station[], pad = false): Station[] | null {
  const out: Station[] = [];
  let cur = home;
  const go = (to: Station, endsHome: number) => {
    // Onto a fixture near the ground, the last metres are the fixture's to clear.
    const ends = to.p[1] < FIELD_Y + 8 ? 7 : endsHome;
    // Up to a cruise height that clears the leg, across, then to the station.
    let cruise = Math.max(FIELD_Y + 26, cur[1], to.p[1]);
    for (let k = 0; k < 30; k++) {
      const a: Vec3 = [cur[0], cruise, cur[2]];
      const b: Vec3 = [to.p[0], cruise, to.p[2]];
      if (legClear(h, a, b, pad) && legClear(h, cur, a, pad, ends) && legClear(h, b, to.p, pad, ends)) break;
      cruise += 4;
    }
    const a: Vec3 = [cur[0], cruise, cur[2]];
    const b: Vec3 = [to.p[0], cruise, to.p[2]];
    if (!legClear(h, a, b, pad) || !legClear(h, cur, a, pad, ends) || !legClear(h, b, to.p, pad, ends)) return false;
    if (Math.abs(cruise - cur[1]) > 0.5) out.push({ p: a, dwell: 0, look: null });
    if (Math.abs(cruise - to.p[1]) > 0.5 || v3.dist(a, b) > 0.5) out.push({ p: b, dwell: 0, look: null });
    out.push(to);
    cur = to.p;
    return true;
  };
  for (const s of stations) {
    // Between stations close together, fly straight if it clears.
    if (out.length && legClear(h, cur, s.p, pad)) {
      out.push(s);
      cur = s.p;
      continue;
    }
    if (!go(s, 0)) return null;
  }
  if (!go({ p: home, dwell: 0, look: null }, 7)) return null;
  return out;
}

const precinct = (n: string) => PRECINCTS.find((p) => p.name === n)!;

/** Hover stations round a centre: n points on a circle of radius r at heights y, looking at `look`. */
function ring(c: [number, number], r: number, y: number, n: number, a0: number, span: number, look: Vec3, dwell: number): Station[] {
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + (span * k) / Math.max(1, n - 1);
    return { p: [c[0] + Math.cos(a) * r, FIELD_Y + y, c[1] + Math.sin(a) * r] as Vec3, dwell, look };
  });
}

export interface AirPlan {
  spotters: Sortie[];
  ferries: Sortie[];
  /** Fixtures: cradles (their seat), pads (their top centre). */
  cradles: Vec3[];
  pads: Vec3[];
}

export function airPlan(nav: NavGrid, h: HeightMap): AirPlan {
  const spotters: Sortie[] = [];
  const cradles: Vec3[] = [];
  const pads: Vec3[] = [];
  const spot = (name: string, pres: string | string[], near: [number, number], stations: Station[], rest: [number, number], pad = false) => {
    // The first of its precincts with open ground near where it works.
    let s: [number, number] | null = null;
    let pre = '';
    for (const p of typeof pres === 'string' ? [pres] : pres) {
      s = openSpot(nav, h, precinct(p), near, 2.6, 7);
      pre = p;
      if (s) break;
    }
    if (!s) return;
    // Cradles keep apart (two in a precinct stand a few metres from each other).
    const home: Vec3 = [s[0], FIELD_Y + AIR.cradle, s[1]];
    if (cradles.some((c) => Math.hypot(c[0] - home[0], c[2] - home[2]) < 6)) {
      const alt = openSpot(nav, h, precinct(pre), [near[0] + 14, near[1] + 9], 2.6, 7);
      if (!alt) return;
      home[0] = alt[0];
      home[2] = alt[1];
    }
    const r = route(h, home, stations, pad);
    if (!r) return;
    cradles.push(home);
    spotters.push({ name, kind: 'spotter', home, stations: r, rest, pad });
  };
  // The pad: two Spotters sweep its tiles while the craft is away.
  const sweep = (z0: number, z1: number): Station[] => {
    const out: Station[] = [];
    for (let k = 0; k < 4; k++) {
      const z = z0 + ((z1 - z0) * k) / 3;
      const xs = k % 2 ? [32, -32] : [-32, 32];
      for (const x of xs) out.push({ p: [x, FIELD_Y + 7, z], dwell: x === xs[1] ? 1.5 : 1, look: [x, FIELD_Y, z] });
    }
    return out;
  };
  spot('pad-north', ['ne-north', 'nw-north', 'ne-inner'], [40, -150], sweep(-30, -4), [40, 70], true);
  spot('pad-south', ['se-inner', 'sw-inner', 'sw-south'], [-40, 150], sweep(4, 30), [40, 70], true);
  // The Resonator: stations on the house's side of the torus, drifting across it.
  const rf = resonatorFrame();
  const rc: Vec3 = [RESONATOR.x, FIELD_Y + RESONATOR.centreY, RESONATOR.z];
  const front = (lat: number, up: number, out: number): Station => ({ p: v3.add(v3.add(rc, v3.scale(rf.T, lat)), v3.add(v3.scale(rf.N, TORUS.r + out), [0, up, 0])), dwell: 14, look: v3.add(rc, v3.scale(rf.T, lat * 0.6)) });
  spot('resonator-a', 'sw-south', [RESONATOR.x + 60, RESONATOR.z - 30], [front(-30, 18, 22), front(-10, 4, 20), front(-34, -16, 22)], [50, 90]);
  spot('resonator-b', 'sw-south', [RESONATOR.x - 40, RESONATOR.z - 40], [front(30, -12, 24), front(12, 22, 20), front(34, 10, 22)], [60, 100]);
  // The Gyre: east and west of it, level with the rotor, clear of its gimbals' sweep and its yoke.
  const gc: [number, number] = [GYRE.x, GYRE.z];
  const gl: Vec3 = [GYRE.x, FIELD_Y + GYRE.centreY, GYRE.z];
  spot('gyre', 'ne-north', [GYRE.x + 70, GYRE.z + 40], [...ring(gc, 74, GYRE.centreY, 3, -0.5, 1.0, gl, 12), ...ring(gc, 74, GYRE.centreY + 10, 3, Math.PI - 0.5, 1.0, gl, 12)], [60, 110]);
  // The Mast: its dish heads, from the side away from the corridor.
  const ml: Vec3 = [MAST.x, FIELD_Y + 96, MAST.z];
  spot('mast', 'ne-inner', [MAST.x - 40, MAST.z - 40], ring([MAST.x, MAST.z], 26, 96, 3, -2.4, 1.3, ml, 14), [60, 120]);
  // The towers: beside each cluster's tallest, high on its outward side.
  for (const c of clusterPlans()) {
    const t = c.towers[0];
    const top = towerTop(t);
    const out = v3.norm([c.x, 0, c.z]);
    const a0 = Math.atan2(out[2], out[0]);
    const look: Vec3 = [c.x, FIELD_Y + top * 0.75, c.z];
    const pre = c.name === 'stills' ? 'nw-north' : c.name === 'converter' ? 'ne-east' : 'sw-inner';
    spot(`tower-${c.name}`, pre, [c.x + out[0] * 80, c.z + out[2] * 80], ring([c.x, c.z], c.podiumR + 30, top * 0.72, 3, a0 - 0.5, 1.0, look, 16), [70, 120]);
  }
  // The Cold Hold: over its spheres' crowns.
  const hl: Vec3 = [COLD_HOLD.x, FIELD_Y + 30, COLD_HOLD.z];
  spot('hold-a', 'nw-inner', [COLD_HOLD.x0 + 10, COLD_HOLD.z1 - 6], [{ p: [-140, FIELD_Y + 52, -60], dwell: 12, look: hl }, { p: [-90, FIELD_Y + 52, -70], dwell: 12, look: hl }], [40, 80]);
  spot('hold-b', 'nw-inner', [COLD_HOLD.x1 - 6, COLD_HOLD.z0 + 12], [{ p: [-60, FIELD_Y + 52, -150], dwell: 12, look: hl }, { p: [-120, FIELD_Y + 52, -140], dwell: 12, look: hl }], [40, 80]);
  // The Loom: over its spool and along its gantry.
  const sp = LOOM.spool;
  spot('loom', 'se-east', [sp.x - 30, sp.z1 + 30], [
    { p: [sp.x - 10, FIELD_Y + 62, (sp.z0 + sp.z1) / 2 + 40], dwell: 14, look: [sp.x, FIELD_Y + sp.centreY, (sp.z0 + sp.z1) / 2] },
    { p: [250, FIELD_Y + 58, LOOM.zB + 30], dwell: 12, look: [250, FIELD_Y + LOOM.railTop, (LOOM.zA + LOOM.zB) / 2] },
  ], [60, 110]);

  // Ferries: pad pairs in neighbouring precincts, a cruise across the avenue between.
  const ferries: Sortie[] = [];
  // Neighbours across an avenue; a pair that finds no open ground gives way to the next.
  const pairs: [string, string, string, [number, number], [number, number]][] = [
    ['hold-stills', 'nw-inner', 'nw-north', [-170, -40], [-150, -250]],
    ['loom-works', 'se-east', 'se-inner', [300, 60], [100, 60]],
    ['labs-reckoner', 'sw-west', 'sw-inner', [-300, 120], [-60, 60]],
    ['hangars-converter', 'ne-inner', 'ne-east', [80, -60], [300, -60]],
    ['labs-resonator', 'sw-west', 'sw-south', [-300, 60], [-60, 300]],
    ['stills-gyre', 'nw-north', 'ne-north', [-60, -300], [60, -300]],
    ['heat-works', 'se-south', 'se-east', [100, 300], [300, 100]],
  ];
  for (const [name, a, b, na, nb] of pairs) {
    if (ferries.length >= 4) break;
    const sa = openSpot(nav, h, precinct(a), na, 3.2, 9);
    const sb = openSpot(nav, h, precinct(b), nb, 3.2, 9);
    if (!sa || !sb) continue;
    const pa: Vec3 = [sa[0], FIELD_Y + AIR.pad, sa[1]];
    const pb: Vec3 = [sb[0], FIELD_Y + AIR.pad, sb[1]];
    if ([...pads, ...cradles].some((q) => Math.hypot(q[0] - pa[0], q[2] - pa[2]) < 10 || Math.hypot(q[0] - pb[0], q[2] - pb[2]) < 10)) continue;
    const r = route(h, pa, [{ p: pb, dwell: 45, look: null }]);
    if (!r) continue;
    pads.push(pa, pb);
    ferries.push({ name, kind: 'ferry', home: pa, away: pb, stations: r, rest: [35, 70] });
  }
  return { spotters, ferries, cradles, pads };
}
