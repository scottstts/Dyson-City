/**
 * The cabin's fittings (docs/intro-ship.md, "Cabin fittings"): the things a crewed cabin carries
 * that the eye checks it against.
 *
 *  - The pilot's seat: a five-point harness lying on its cushions (shoulder straps from the back's
 *    slots, lap belts from the pan's sides, the crotch strap from its front) into a rotary buckle;
 *    side wings on the back's shell; the height lever.
 *  - Overhead: grab rails along the ceiling between the frames.
 *  - The floor: tie-down tracks along its length.
 *  - By the door: its control panel (a status screen, two keys); on the aft bulkhead an
 *    extinguisher in its bracket.
 *
 * Every fitting sits a few millimetres into what carries it (declared seats, parts.ts).
 */
import { extrudeBevel, lathe, tube, type Basis } from '../../../geometry/solids';
import { box } from '../../../geometry/solids';
import { v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import { framesFrom, loopProfile, roundedRect, sweep } from '../../../geometry/sweep';
import { DOOR, FLOOR_Y, HULL } from '../spec';
import { SHIP_SLOT as S } from '../slots';
import { CABIN } from '../cabin/cabin';
import { INNER } from '../cabin/kit';
import { SEAT } from '../cabin/seat';
import type { ShipParts } from '../parts';
import { facetFrame, subFrame } from './mount';

const SEAT_IN = 0.004;

export function buildCabinDetails(parts: ShipParts): void {
  harness(parts);
  seatShell(parts);
  rails(parts);
  tracks(parts);
  doorPanel(parts);
  extinguisher(parts);
}

/** The seat's frames (seat.ts): a point on the back's cushion face and on the pan's top. */
const R = SEAT.recline;
const BACK_UP: Vec3 = [-Math.sin(R), Math.cos(R), 0];
const BACK_FWD: Vec3 = [Math.cos(R), Math.sin(R), 0];
const O: Vec3 = [SEAT.x, SEAT.y, 0];
/** The back cushion's face (out from its frame) and the pan cushion's top (seat.ts). */
const BACK_FACE = 0.082;
const PAN_TOP = SEAT.y + 0.085;
const onBack = (along: number, z: number, lift = 0.0015): Vec3 => v3.add(v3.add(O, v3.add(v3.scale(BACK_UP, along), v3.scale(BACK_FWD, BACK_FACE + lift))), [0, 0, z]);
const onPan = (x: number, z: number, lift = 0.0015): Vec3 => [x, PAN_TOP + lift, z];

/** A webbing strap along a path, lying on the surfaces whose normals are given. */
function strap(points: Vec3[], normals: Vec3[], width = 0.046) {
  const w = width / 2;
  const t = 0.0025;
  return sweep(framesFrom(points, normals), loopProfile([[-w, -t], [w, -t], [w, t], [-w, t]] as Vec2[], S.cabinMatte), { capSlot: S.cabinMatte });
}

function harness(parts: ShipParts): void {
  const buckle: Vec3 = [8.52, PAN_TOP, 0];
  const up: Vec3 = [0, 1, 0];
  const bridge = v3.norm(v3.add(BACK_FWD, up));
  for (const s of [1, -1]) {
    const n = s > 0 ? 's' : 'p';
    // Shoulder strap: from the back's slot down its face, over the crease, along the pan.
    parts.add(`harness-shoulder-${n}`, strap(
      [onBack(0.74, s * 0.09), onBack(0.45, s * 0.07), onBack(0.17, s * 0.045), onPan(8.33, s * 0.04), onPan(8.45, s * 0.03), v3.add(buckle, [-0.05, 0.0015, s * 0.02])],
      [BACK_FWD, BACK_FWD, BACK_FWD, bridge, up, up],
    ));
    parts.seat(`harness-shoulder-${n}`, 'seat-back');
    parts.seat(`harness-shoulder-${n}`, 'seat-pan');
    // Lap belt: from between the pan and its bolster to the buckle, over the shoulder strap's end.
    parts.add(`harness-lap-${n}`, strap([onPan(8.36, s * 0.2), onPan(8.45, s * 0.11, 0.0045), v3.add(buckle, [-0.01, 0.0075, s * 0.035])], [up, up, up], 0.05));
    parts.seat(`harness-lap-${n}`, 'seat-pan');
  }
  parts.add('harness-crotch', strap([onPan(8.72, 0), onPan(8.6, 0), v3.add(buckle, [0.03, 0.0015, 0])], [up, up, up], 0.05));
  parts.seat('harness-crotch', 'seat-pan');
  // The rotary buckle over the straps' ends, its release knob on top.
  const b: Basis = { o: buckle, u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
  parts.add('harness-buckle', lathe([[0, -SEAT_IN], [0.05, -SEAT_IN], [0.05, 0.01], [0.045, 0.016], [0, 0.016]], 32, b, S.cabinTrim));
  parts.add('harness-knob', lathe([[0, 0.012], [0.03, 0.012], [0.03, 0.024], [0.024, 0.03], [0, 0.03]], 8, b, S.cabinRubber));
  parts.seat('harness-buckle', 'seat-pan');
  for (const n of ['shoulder-s', 'shoulder-p', 'lap-s', 'lap-p']) parts.seat(`harness-${n}`, 'harness-buckle');
  parts.seat('harness-crotch', 'harness-buckle');
  parts.seat('harness-knob', 'harness-buckle');
}

/** Wings on the back's shell either side of its cushion; the height lever on the pan's shell. */
function seatShell(parts: ShipParts): void {
  for (const s of [1, -1]) {
    const n = s > 0 ? 's' : 'p';
    const o = v3.add(v3.add(O, v3.add(v3.scale(BACK_UP, 0.44), v3.scale(BACK_FWD, 0.01))), [0, 0, s * (SEAT.width + 0.026)]);
    parts.add(`seat-wing-${n}`, extrudeBevel(roundedRect(0.06, 0.34, 0.03, 5), { o, u: BACK_FWD, v: BACK_UP, w: [0, 0, 1] }, -0.008, 0.008, 0.003, S.console));
    parts.seat(`seat-wing-${n}`, 'seat-back-shell');
  }
  const z = -(SEAT.width + 0.015);
  parts.add('seat-lever', tube([
    { p: [8.55, SEAT.y - 0.025, z + 0.012], r: 0.008 },
    { p: [8.55, SEAT.y - 0.025, z - 0.035], r: 0.008 },
    { p: [8.6, SEAT.y - 0.027, z - 0.045], r: 0.008 },
    { p: [8.7, SEAT.y - 0.03, z - 0.045], r: 0.008 },
  ], 10, S.cabinTrim));
  parts.add('seat-lever-grip', tube([{ p: [8.66, SEAT.y - 0.029, z - 0.045], r: 0.013 }, { p: [8.74, SEAT.y - 0.031, z - 0.045], r: 0.013 }], 12, S.cabinRubber));
  parts.seat('seat-lever', 'seat-pan-shell');
  parts.seat('seat-lever-grip', 'seat-lever');
}

/** The ceiling's top liners: their cuts along x (cabin.ts), to name the panel a fitting stands on. */
const TOP_CUTS = [CABIN.frames[0], 3.32, CABIN.frames[1], 6.06, CABIN.frames[2]];
const topPanel = (side: 's' | 'p', x: number) => `liner-top-${side}-${TOP_CUTS.filter((c) => c < x).length}`;

/** Grab rails along the ceiling's flat between the frames, on standoffs into its liners. */
function rails(parts: ShipParts): void {
  const liner = 5.01 - 0.006 - 0.028;
  const y = liner - 0.075;
  const spans: [number, number][] = [[0.6, 1.36], [1.8, 4.73], [5.17, 6.85]];
  for (const s of [1, -1]) {
    const side = s > 0 ? 's' : 'p';
    const z = s * 0.62;
    spans.forEach(([x0, x1], i) => {
      const a = x0 + 0.08;
      const b = x1 - 0.08;
      const name = `ceiling-rail-${side}-${i}`;
      parts.add(name, tube([
        { p: [a, liner + SEAT_IN, z], r: 0.016 },
        { p: [a, y + 0.03, z], r: 0.016 },
        { p: [a + 0.03, y, z], r: 0.016 },
        { p: [b - 0.03, y, z], r: 0.016 },
        { p: [b, y + 0.03, z], r: 0.016 },
        { p: [b, liner + SEAT_IN, z], r: 0.016 },
      ], 14, S.cabinTrim));
      for (const x of new Set([topPanel(side, a), topPanel(side, b)])) parts.seat(name, x);
    });
  }
}

/** Tie-down tracks along the floor, either side of the aisle, over the plates they cross. */
function tracks(parts: ShipParts): void {
  const floorCuts = [CABIN.aft, 2.18, 3.0, 5.62, 7.95];
  const x0 = 0.45;
  const x1 = 7.3;
  for (const s of [1, -1]) {
    const name = `floor-track-${s > 0 ? 's' : 'p'}`;
    parts.add(name, box({ o: [(x0 + x1) / 2, FLOOR_Y + 0.001, s * 1.45], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, (x1 - x0) / 2, 0.016, SEAT_IN, 0.002, S.cabinTrim));
    floorCuts.forEach((c, i) => {
      if (c < x1 && (floorCuts[i + 1] ?? 99) > x0) parts.seat(name, `floor-${i}`);
    });
  }
}

/** The door's control panel inside, fore of the door on the port liner. */
function doorPanel(parts: ShipParts): void {
  const pl = INNER[HULL.sideP];
  // The liner's face (kit.ts linerPanels: stood off the inner skin, its thickness), facing in.
  const face = { n: v3.scale(pl.n, -1) as Vec3, d: -(pl.d - 0.034) };
  const b = facetFrame(face, [DOOR.x + DOOR.halfWidth + 0.43, 3.45, -2.6], [1, 0, 0]);
  parts.add('door-panel', extrudeBevel(roundedRect(0.07, 0.11, 0.015, 4), b, -SEAT_IN, 0.012, 0.003, S.cabinTrim));
  parts.seat('door-panel', 'liner-side-p-fore-0');
  parts.add('door-panel-screen', extrudeBevel(roundedRect(0.05, 0.035, 0.006, 3), subFrame(b, [0, 0.045, 0]), 0.008, 0.015, 0.0015, S.screen));
  parts.seat('door-panel-screen', 'door-panel');
  for (const [k, y] of [[0, -0.035], [1, -0.075]] as const) {
    parts.add(`door-panel-key-${k}`, box(subFrame(b, [0, y, 0.014]), 0.035, 0.013, 0.006, 0.003, S.cabinRubber));
    parts.seat(`door-panel-key-${k}`, 'door-panel');
  }
}

/** A dry-powder extinguisher on the aft bulkhead, in a bracket with two straps. */
function extinguisher(parts: ShipParts): void {
  const x = CABIN.aft;
  const z = -1.6;
  const y0 = FLOOR_Y + 0.42;
  const plate: Basis = { o: [x, y0 + 0.2, z], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] };
  parts.add('extinguisher-bracket', extrudeBevel(roundedRect(0.07, 0.26, 0.02, 4), plate, -SEAT_IN, 0.012, 0.003, S.cabinTrim));
  parts.seat('extinguisher-bracket', 'bulkhead');
  const axis: Basis = { o: [x + 0.012 + 0.065, y0, z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
  parts.add('extinguisher', lathe([[0, 0], [0.058, 0], [0.065, 0.015], [0.065, 0.36], [0.05, 0.4], [0.02, 0.41], [0.02, 0.44], [0, 0.44]], 28, axis, S.cabinRubber));
  parts.add('extinguisher-valve', box({ o: [x + 0.077, y0 + 0.455, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.035, 0.02, 0.016, 0.005, S.cabinTrim));
  parts.seat('extinguisher-valve', 'extinguisher');
  for (const h of [0.08, 0.3]) {
    parts.add(`extinguisher-strap-${h}`, lathe([[0.064, h - 0.012], [0.072, h - 0.012], [0.072, h + 0.012], [0.064, h + 0.012]], 28, axis, S.cabinTrim));
    parts.seat(`extinguisher-strap-${h}`, 'extinguisher');
    parts.seat(`extinguisher-strap-${h}`, 'extinguisher-bracket');
  }
  parts.seat('extinguisher', 'extinguisher-bracket');
}
