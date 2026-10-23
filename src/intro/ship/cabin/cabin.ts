/**
 * The cabin aft of the cockpit (docs/intro-ship.md, "Cabin"): the entry vestibule the Guardian
 * walks through to the door. A graphite floor in plates; charcoal liner panels on every facet of
 * the inner skin, seamed at the rib frames; the aft bulkhead with its hatch; the door's surround
 * and threshold; a bench and lockers on the starboard side; a light line down the ceiling and
 * along the floor's edges; trim round the panes inside.
 *
 * Everything is bounded by the hull's inner skin (kit.ts), so it meets the hull without a gap and
 * without sharing a plane with it.
 */
import { roundedPolygonLoop, roundedRectLoop, type HalfSpace, type RectAperture } from '../../../geometry/convex';
import { extrudeBevel, tube, type Basis } from '../../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { Parts } from '../../../field/kit/parts';
import { HULL, HULL_T, DOOR, FLOOR_Y } from '../spec';
import { CONSOLE } from './cockpit';
import { PANES, doorAperture } from '../hull';
import { SHIP_SLOT as S } from '../slots';
import { INNER, cabinSolid, clip2, linerPanels, ribFrame } from './kit';
import { planarRing } from '../details/mount';

/** Stations (x) of the cabin: its aft bulkhead, the rib frames, the cockpit's arch. */
export const CABIN = {
  aft: 0.22,
  bulkhead: 0.16,
  frames: [1.58, 4.95, 7.08],
  frameWidth: 0.15,
  frameAlong: 0.16,
  /** The starboard bench and lockers. */
  bench: { x0: 1.82, x1: 4.72, depth: 0.52, seat: 0.46 },
  lockers: { y0: 3.98, y1: 4.72, depth: 0.42 },
} as const;

/** The door's opening on the inner skin's side: x span and its top (for the liner and surround). */
const DOOR_X0 = DOOR.x - DOOR.halfWidth;
const DOOR_X1 = DOOR.x + DOOR.halfWidth;

const between = (x0: number, x1: number): HalfSpace[] => [
  { n: [-1, 0, 0], d: -x0 },
  { n: [1, 0, 0], d: x1 },
];
const aboveY = (y: number): HalfSpace => ({ n: [0, -1, 0], d: -y });
const belowY = (y: number): HalfSpace => ({ n: [0, 1, 0], d: y });

/** The frames' footprints along x (with a little clearance). */
const FRAME_SPANS = CABIN.frames.map((x) => [x - CABIN.frameAlong / 2 - 0.02, x + CABIN.frameAlong / 2 + 0.02] as const);

/** The ceiling's light line, between the frames: its segments' x spans. */
export const CEILING_LIGHTS: readonly (readonly [number, number])[] = [
  [0.66, FRAME_SPANS[0][0]],
  [FRAME_SPANS[0][1], FRAME_SPANS[1][0]],
  [FRAME_SPANS[1][1], FRAME_SPANS[2][0] - 0.1],
];
/** The light line's diffuser: its half-width and its face's height. */
export const CEILING_LIGHT = { halfWidth: 0.07, y: 5.01 - 0.05 } as const;

export function buildCabin(parts: Parts): void {
  // Seams at the frames are as wide as a frame and a little more: the frame stands in it.
  const cuts = (extra: number[]) => [...CABIN.frames.map((x) => [x, CABIN.frameAlong + 0.03] as const), ...extra];

  // The floor: graphite plates on the cabin's whole width, seamed across at uneven stations.
  const floorCuts = [CABIN.aft, 2.18, 3.0, 5.62, 7.95, 9.95];
  for (let i = 0; i + 1 < floorCuts.length; i++) {
    const x0 = floorCuts[i] + (i ? 0.004 : 0);
    const x1 = floorCuts[i + 1] - 0.004;
    parts.add(`floor-${i}`, cabinSolid([belowY(FLOOR_Y), aboveY(FLOOR_Y - 0.07), ...between(x0, x1)], () => S.floor, { clearance: 0.006, bevel: 0.006 }));
  }

  // Liner panels: the roof, its slopes, the sides (round the door on port), the cockpit's walls.
  const liner = (name: string, plane: number, clip: HalfSpace[], extra: number[], slot: number = S.liner) =>
    linerPanels(plane, clip, cuts(extra), slot).forEach((m, i) => parts.add(`liner-${name}-${i}`, m));
  // The roof's flat either side of the light channel down its middle.
  // Over the cockpit the overhead panel stands against the roof: the liners stop aft of it.
  liner('top-s', HULL.top, [...between(CABIN.aft + 0.02, 7.5), { n: [0, 0, -1], d: -0.135 }], [3.32, 6.06]);
  liner('top-p', HULL.top, [...between(CABIN.aft + 0.02, 7.5), { n: [0, 0, 1], d: -0.135 }], [3.32, 6.06]);
  liner('roof-s', HULL.roofS, between(CABIN.aft + 0.02, 7.5), [2.86, 6.02]);
  liner('roof-p', HULL.roofP, between(CABIN.aft + 0.02, 7.5), [2.86, 6.02]);
  liner('side-s', HULL.sideS, [...between(CABIN.aft + 0.02, 7.2), aboveY(FLOOR_Y + 0.14)], [3.04, 6.1]);
  liner('side-p-aft', HULL.sideP, [...between(CABIN.aft + 0.02, DOOR_X0 - 0.17), aboveY(FLOOR_Y + 0.14)], []);
  liner('side-p-fore', HULL.sideP, [...between(DOOR_X1 + 0.17, 7.2), aboveY(FLOOR_Y + 0.14)], [6.1]);
  liner('side-p-head', HULL.sideP, [...between(DOOR_X0 - 0.17 + 0.016, DOOR_X1 + 0.17 - 0.016), aboveY(DOOR.top + 0.17)], []);
  // The cockpit's walls, over the consoles.
  liner('nose-s', HULL.noseS, [...between(7.36, 9.3), aboveY(CONSOLE.top + 0.02)], [], S.linerDark);
  liner('nose-p', HULL.noseP, [...between(7.36, 9.3), aboveY(CONSOLE.top + 0.02)], [], S.linerDark);

  // Skirting along both walls under the liner: a dark kick plate, floor to liner, clear of the
  // frames' feet, the door and the bench.
  const B = CABIN.bench;
  const [f0, f1, f2] = FRAME_SPANS;
  for (const [side, plane] of [['s', HULL.sideS], ['p', HULL.sideP]] as const) {
    const n = INNER[plane].n;
    const wall: HalfSpace = { n: v3.scale(n, -1) as Vec3, d: -(INNER[plane].d - 0.05) };
    const spans: [number, number][] =
      side === 'p'
        ? [[CABIN.aft + 0.02, f0[0]], [f0[1], DOOR_X0 - 0.16], [DOOR_X1 + 0.16, f1[0]], [f1[1], f2[0]]]
        : [[CABIN.aft + 0.02, f0[0]], [f1[1], f2[0]]];
    spans.forEach(([x0, x1], i) => parts.add(`skirting-${side}-${i}`, cabinSolid([wall, belowY(FLOOR_Y + 0.13), aboveY(FLOOR_Y + 0.002), ...between(x0, x1)], () => S.cabinMatte, { clearance: 0.004, bevel: 0.006 })));
  }

  // Rib frames: satin bands round the section, floor to floor.
  CABIN.frames.forEach((x, i) => parts.add(`frame-${i}`, ribFrame(x, FLOOR_Y + 0.001, { width: CABIN.frameWidth, along: CABIN.frameAlong }, S.cabinTrim)));

  // The aft bulkhead, and its hatch to the engine bay: a frame and a leaf standing proud of it.
  parts.add('bulkhead', cabinSolid([{ n: [-1, 0, 0], d: -(CABIN.aft - CABIN.bulkhead) }, { n: [1, 0, 0], d: CABIN.aft }, aboveY(FLOOR_Y - 0.07)], () => S.linerDark, { clearance: 0.004, bevel: 0.01 }));
  const hatch: Basis = { o: [CABIN.aft, FLOOR_Y + 1.02, 0.55], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] };
  parts.add('hatch-frame', ring(hatch, 0.43, 0.88, 0.16, 0.09, 0.0, 0.05, S.cabinTrim));
  parts.add('hatch-leaf', extrudeBevel(roundedRect(0.42, 0.87, 0.15, 6), hatch, 0.004, 0.032, 0.008, S.console));
  parts.add('hatch-handle', handle(hatch, [0.28, 0.0], 0.032, S.cabinTrim));

  // The door from inside: a surround over the liner's edges, the threshold through the opening.
  const door = doorAperture() as RectAperture;
  const pl = INNER[HULL.sideP];
  const side: Basis = { o: v3.sub(door.centre, v3.scale(pl.n, v3.dot(pl.n, door.centre) - pl.d)), u: [1, 0, 0], v: v3.cross(v3.scale(pl.n, -1), [1, 0, 0]), w: v3.scale(pl.n, -1) };
  // The surround stands on the floor: a U up the opening's sides and over its head (the opening
  // itself runs down under the floor, where the stair stows).
  const vCut = (FLOOR_Y + 0.004 - side.o[1]) / side.v[1];
  parts.add('door-surround', uFrame(side, door, 0.02, 0.06, vCut, 0.004, 0.042, S.cabinTrim));
  // The threshold runs from just past the floor's edge out through the opening's hull thickness.
  const sideIn = INNER[HULL.sideP];
  const beyondFloor: HalfSpace = { n: v3.scale(sideIn.n, -1) as Vec3, d: -(sideIn.d - 0.002) };
  parts.add('threshold', cabinSolid([belowY(FLOOR_Y), aboveY(FLOOR_Y - 0.045), ...between(DOOR_X0 + 0.012, DOOR_X1 - 0.012), beyondFloor], () => S.cabinTrim, { clearance: -HULL_T + 0.004, bevel: 0.006 }));

  // Starboard: a bench under lockers, between the frames either side of the door's station; all of
  // it stands clear of the liner behind it.
  const zIn = 2.7 - B.depth;
  parts.add('bench-base', cabinSolid([...between(B.x0, B.x1), { n: [0, 0, -1], d: -(zIn + 0.06) }, belowY(FLOOR_Y + B.seat - 0.1), aboveY(FLOOR_Y + 0.004)], () => S.console, { bevel: 0.012, clearance: 0.04 }));
  parts.add('bench-cushion', cabinSolid([...between(B.x0 + 0.03, B.x1 - 0.03), { n: [0, 0, -1], d: -zIn }, belowY(FLOOR_Y + B.seat), aboveY(FLOOR_Y + B.seat - 0.1 + 0.002)], () => S.leather, { bevel: 0.035, clearance: 0.04 }));
  parts.add('bench-back', cabinSolid([...between(B.x0 + 0.03, B.x1 - 0.03), { n: [0, 0, -1], d: -2.56 }, belowY(FLOOR_Y + B.seat + 0.52), aboveY(FLOOR_Y + B.seat + 0.04)], () => S.leather, { bevel: 0.03, clearance: 0.04 }));
  const L = CABIN.lockers;
  const lockerZ = 2.7 - L.depth;
  const lockerCuts = [B.x0, 2.78, 3.74, B.x1];
  for (let i = 0; i + 1 < lockerCuts.length; i++) {
    parts.add(`locker-${i}`, cabinSolid([...between(lockerCuts[i] + 0.005, lockerCuts[i + 1] - 0.005), { n: [0, 0, -1], d: -lockerZ }, belowY(L.y1), aboveY(L.y0)], () => S.console, { bevel: 0.014, clearance: 0.04 }));
    parts.add(`locker-pull-${i}`, handle({ o: [(lockerCuts[i] + lockerCuts[i + 1]) / 2, L.y0 + 0.09, lockerZ], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] }, [0, 0], 0.022, S.cabinTrim));
  }

  // Light: a diffuser line down the ceiling's flat between the frames, in a satin channel.
  CEILING_LIGHTS.forEach(([x0, x1], i) => {
    parts.add(`ceiling-light-${i}`, cabinSolid([...between(x0 + 0.06, x1 - 0.06), { n: [0, 0, 1], d: CEILING_LIGHT.halfWidth }, { n: [0, 0, -1], d: CEILING_LIGHT.halfWidth }, aboveY(CEILING_LIGHT.y)], () => S.lamp, { clearance: 0.012, bevel: 0.01 }));
    parts.add(`ceiling-channel-${i}`, ring({ o: [(x0 + x1) / 2, 5.01 - 0.004, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] }, (x1 - x0) / 2 - 0.05, 0.075, 0.02, 0.04, 0.0, 0.03, S.cabinTrim));
  });

  // The panes from inside: a trim ring round each, standing off the inner skin.
  for (const pane of PANES) {
    const pl2 = INNER[pane.plane];
    const n = pl2.n;
    const core = pane.core.map((p) => v3.sub(p, v3.scale(n, HULL_T)));
    const inner = roundedPolygonLoop(core, n, pane.r);
    const outer = roundedPolygonLoop(core, n, pane.r + 0.06);
    parts.add(`pane-trim-${pane.name}`, planarRing(inner, outer, v3.scale(n, -1), 0.003, 0.024, S.cabinTrim));
  }

  // A grab bar beside the door, on the fore side.
  const gx = DOOR_X1 + 0.13;
  const gz = -(2.7 - 0.09);
  parts.add('grab-bar', tube([
    { p: [gx, FLOOR_Y + 0.9, gz + 0.075], r: 0.017 },
    { p: [gx, FLOOR_Y + 0.92, gz], r: 0.017 },
    { p: [gx, FLOOR_Y + 1.75, gz], r: 0.017 },
    { p: [gx, FLOOR_Y + 1.77, gz + 0.075], r: 0.017 },
  ], 14, S.cabinTrim));
}

/**
 * A frame ring in a basis's plane: the rounded rectangle (hw, hh, r) grown by `width`, extruded
 * from w = d0 to d1. Optionally its inner edge is grown by `lip` (a frame that overlaps a liner).
 */
function ring(b: Basis, hw: number, hh: number, r: number, width: number, d0: number, d1: number, slot: number, lip = 0): PolyMesh {
  const inner = roundedRectLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], hw + lip, hh + lip, r + lip, 6);
  const outer = roundedRectLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], hw + width, hh + width, r + width, 6);
  const to = (p: Vec3): Vec3 => v3.add(b.o, v3.add(v3.scale(b.u, p[0]), v3.scale(b.v, p[1])));
  return planarRing(inner.map(to), outer.map(to), b.w, d0, d1 - d0, slot);
}

/**
 * A U-shaped frame round a rounded-rect opening in a basis's plane: from the opening grown by
 * `lip` out to `width` beyond it, cut off below v = vCut (it stands on the floor there).
 */
function uFrame(b: Basis, a: RectAperture, lip: number, width: number, vCut: number, d0: number, d1: number, slot: number): PolyMesh {
  const loop2 = (grow: number): Vec2[] => roundedRectLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], a.hw + grow, a.hh + grow, a.r + grow, 6).map((p) => [p[0], p[1]] as Vec2);
  const cut = (l: Vec2[]) => {
    const c = clip2(l, [0, -1], -vCut);
    // Start just after the cut edge (both its ends on v = vCut), so the loop runs up, over, down.
    const k = c.findIndex((p, i) => Math.abs(p[1] - vCut) < 1e-6 && Math.abs(c[(i + 1) % c.length][1] - vCut) < 1e-6);
    return [...c.slice(k + 1), ...c.slice(0, k + 1)];
  };
  const outline: Vec2[] = [...cut(loop2(width)), ...cut(loop2(lip)).reverse()];
  return extrudeBevel(outline, b, d0, d1, 0.006, slot);
}

/** A pull handle: a bar on two posts, standing off a surface along the basis's w. */
function handle(b: Basis, at: Vec2, r: number, slot: number): PolyMesh {
  const p = (x: number, y: number, z: number): Vec3 => v3.add(b.o, v3.add(v3.add(v3.scale(b.u, at[0] + x), v3.scale(b.v, at[1] + y)), v3.scale(b.w, z)));
  return tube([
    { p: p(0, -0.11, -0.005), r },
    { p: p(0, -0.11, 0.045), r },
    { p: p(0, 0.11, 0.045), r },
    { p: p(0, 0.11, -0.005), r },
  ], 12, slot);
}
