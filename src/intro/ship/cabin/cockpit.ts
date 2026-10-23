/**
 * The cockpit (docs/intro-ship.md, "Cockpit"): one seat facing the faceted canopy. The dash runs
 * the cockpit's width under the windshield, its top meeting the glass's lower edge as the pilot
 * sees it (the glareshield), three displays on its raked face; consoles either side of the seat
 * (throttle levers to port, the side monitor on its arm to starboard); an overhead panel of
 * switches; a footrest; and the seat (seat.ts).
 *
 * The side monitor stands where the Guardian's eye turns to read it (eye.ts, scene 1): down and to
 * the right, square to the eye.
 */
import { planeAt, type HalfSpace } from '../../../geometry/convex';
import { box, extrudeBevel, tube, type Basis } from '../../../geometry/solids';
import { PolyMesh, v3, type Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { Parts } from '../../../field/kit/parts';
import { EYE, FLOOR_Y } from '../spec';
import { SHIP_SLOT as S } from '../slots';
import { cabinSolid } from './kit';
import { buildSeat } from './seat';

const rad = (d: number) => (d * Math.PI) / 180;

/** The dash: its glareshield's height, the raked face (a point on it and its rake from the vertical). */
export const DASH = {
  top: 3.27,
  bottom: FLOOR_Y + 0.62,
  face: { x: 9.3, y: 3.05, rake: rad(28) },
  displays: { z: [-0.53, 0, 0.53], hw: 0.215, hh: 0.112 },
} as const;

/** The consoles either side of the seat. */
export const CONSOLE = { inboard: 0.58, top: 3.0, aft: 7.52, fore: 9.18 } as const;

/** The cockpit's own lamps: two map lights under the overhead panel, a strip under the dash. */
export const COCKPIT_LAMPS = {
  overhead: { tilt: rad(22), at: [8.1, 4.66, 0] as Vec3, lights: [-0.38, 0.38], back: -0.34, r: 0.032 },
  footwell: { y: DASH.bottom - 0.004, x: 9.46, halfWidth: 0.82, depth: 0.018 },
} as const;

/** The overhead panel's underside as a basis: u across, v toward the nose along it, w down out of it. */
export function overheadFace(): Basis {
  const t = COCKPIT_LAMPS.overhead.tilt;
  const n: Vec3 = [-Math.sin(t), -Math.cos(t), 0];
  return { o: COCKPIT_LAMPS.overhead.at, u: [0, 0, 1], v: v3.norm(v3.cross(n, [0, 0, 1])), w: n };
}

/** The side monitor: its centre and size (its face square to the eye). */
export const MONITOR = { centre: [8.66, 3.27, 0.575] as Vec3, hw: 0.2, hh: 0.125, depth: 0.028 } as const;

const between = (x0: number, x1: number): HalfSpace[] => [
  { n: [-1, 0, 0], d: -x0 },
  { n: [1, 0, 0], d: x1 },
];

/** The dash's face as a basis: u across (+z), v up the face, w out of it toward the pilot. */
export function dashFace(): Basis {
  const r = DASH.face.rake;
  const w: Vec3 = [-Math.cos(r), Math.sin(r), 0];
  const v: Vec3 = [Math.sin(r), Math.cos(r), 0];
  return { o: [DASH.face.x, DASH.face.y, 0], u: [0, 0, 1], v, w };
}

const at = (b: Basis, x: number, y: number, z: number): Vec3 => v3.add(b.o, v3.add(v3.add(v3.scale(b.u, x), v3.scale(b.v, y)), v3.scale(b.w, z)));

export function buildCockpit(parts: Parts): void {
  const face = dashFace();
  // The dash: under the glareshield, over the knees, back to the raked face, out to the hull. The
  // glareshield falls toward the windshield, under the glass's lower edge.
  parts.add('dash', cabinSolid([
    { n: [0, 1, 0], d: DASH.top },
    planeAt(v3.norm([0.27, 1, 0]), [DASH.face.x + 0.05, DASH.top, 0]),
    // Its shoulders fall away under the side panes' lower edges.
    planeAt(v3.norm([0, 1, 0.62]), [0, DASH.top, 1.05]),
    planeAt(v3.norm([0, 1, -0.62]), [0, DASH.top, -1.05]),
    { n: [0, -1, 0], d: -DASH.bottom },
    planeAt(face.w, face.o),
  ], () => S.console, { bevel: 0.016 }));
  // Its displays: a bezel each, the glass set in it.
  const faceMid = (DASH.top + DASH.bottom) / 2;
  const midV = (faceMid - DASH.face.y) / Math.cos(DASH.face.rake);
  DASH.displays.z.forEach((z, i) => {
    const b: Basis = { o: at(face, z, midV, 0), u: face.u, v: face.v, w: face.w };
    parts.add(`display-bezel-${i}`, extrudeBevel(roundedRect(DASH.displays.hw + 0.022, DASH.displays.hh + 0.022, 0.018, 5), b, -0.004, 0.016, 0.005, S.cabinTrim));
    parts.add(`display-${i}`, extrudeBevel(roundedRect(DASH.displays.hw, DASH.displays.hh, 0.008, 4), b, 0.012, 0.0185, 0.002, S.display));
  });
  // A row of keys under the displays.
  const keys = new PolyMesh(40);
  for (let k = 0; k < 11; k++) {
    const b: Basis = { o: at(face, -0.6 + k * 0.12, midV - DASH.displays.hh - 0.05, 0), u: face.u, v: face.v, w: face.w };
    keys.append(box(b, 0.034, 0.014, 0.012, 0.004, S.cabinRubber));
  }
  parts.addSet('dash-keys', keys);

  // The consoles: port carries the throttle, starboard the monitor's arm.
  for (const side of [1, -1] as const) {
    const name = side > 0 ? 's' : 'p';
    const inboard: HalfSpace = { n: [0, 0, -side], d: -CONSOLE.inboard };
    // A chamfer from the top down to the inboard face, toward the seat.
    const chamfer = planeAt(v3.norm([0, 1, -side]), [0, CONSOLE.top - 0.05, side * CONSOLE.inboard]);
    parts.add(`console-${name}`, cabinSolid([{ n: [0, 1, 0], d: CONSOLE.top }, { n: [0, -1, 0], d: -(FLOOR_Y + 0.003) }, inboard, chamfer, ...between(CONSOLE.aft, CONSOLE.fore)], () => S.console, { bevel: 0.014 }));
    // An inlaid touch panel on its top, toward the front.
    const top: Basis = { o: [8.78, CONSOLE.top, side * (CONSOLE.inboard + 0.3)], u: [1, 0, 0], v: [0, 0, -side], w: [0, 1, 0] };
    parts.add(`console-panel-${name}`, extrudeBevel(roundedRect(0.2, 0.14, 0.012, 4), top, -0.003, 0.004, 0.0015, S.screen));
  }
  buildThrottle(parts);
  buildMonitor(parts);
  buildOverhead(parts);

  // The footwell's light: a diffuser strip along the dash's underside, near its face.
  const F = COCKPIT_LAMPS.footwell;
  parts.add('footwell-light', box({ o: [F.x - 0.06, F.y - F.depth / 2 + 0.002, 0], u: [0, 0, 1], v: [1, 0, 0], w: [0, 1, 0] }, F.halfWidth, 0.022, F.depth / 2, 0.005, S.lamp));
  // A footrest under the dash: a raked plate on two brackets.
  const foot: Basis = { o: [9.72, FLOOR_Y + 0.12, 0], u: [0, 0, 1], v: [-Math.sin(rad(55)), Math.cos(rad(55)), 0], w: [Math.cos(rad(55)), Math.sin(rad(55)), 0] };
  parts.add('footrest', extrudeBevel(roundedRect(0.42, 0.13, 0.03, 4), foot, -0.012, 0.012, 0.005, S.cabinMatte));
  for (const z of [-0.3, 0.3]) parts.add(`footrest-bracket-${z > 0 ? 's' : 'p'}`, box({ o: [9.76, FLOOR_Y + 0.045, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.05, 0.045, 0.02, 0.006, S.cabinTrim));

  buildSeat(parts);
}

/** Two throttle levers in a quadrant on the port console. */
function buildThrottle(parts: Parts): void {
  const base: Basis = { o: [8.42, CONSOLE.top, -(CONSOLE.inboard + 0.2)], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
  parts.add('throttle-quadrant', extrudeBevel(roundedRect(0.16, 0.085, 0.02, 4), base, -0.004, 0.05, 0.008, S.cabinTrim));
  const levers = new PolyMesh(40);
  for (const dz of [-0.035, 0.035]) {
    const z = base.o[2] + dz;
    const p0: Vec3 = [8.42, CONSOLE.top + 0.03, z];
    const p1: Vec3 = [8.47, CONSOLE.top + 0.17, z];
    levers.append(tube([{ p: p0, r: 0.011 }, { p: p1, r: 0.009 }], 12, S.cabinTrim));
    // The grip: a rounded block leaning forward.
    const g: Basis = { o: [8.485, CONSOLE.top + 0.205, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
    levers.append(box(g, 0.032, 0.045, 0.018, 0.012, S.cabinRubber));
  }
  parts.addSet('throttle-levers', levers);
}

/** The side monitor on its arm from the starboard console, its face square to the eye. */
function buildMonitor(parts: Parts): void {
  const M = MONITOR;
  const c = M.centre;
  const w = v3.norm(v3.sub(EYE, c));
  const u = v3.norm(v3.cross([0, 1, 0], w));
  const v = v3.cross(w, u);
  const b: Basis = { o: c, u, v, w };
  parts.add('monitor-housing', extrudeBevel(roundedRect(M.hw + 0.02, M.hh + 0.02, 0.022, 6), b, -M.depth, 0, 0.006, S.console));
  parts.add('monitor-glass', extrudeBevel(roundedRect(M.hw, M.hh, 0.01, 5), b, -0.004, 0.0025, 0.0015, S.monitor));
  // The arm: from a boss on the console top, up, then out to a swivel behind the housing.
  const boss: Vec3 = [8.36, CONSOLE.top, 0.86];
  const back = v3.add(c, v3.scale(w, -M.depth - 0.035));
  parts.add('monitor-boss', extrudeBevel(roundedRect(0.045, 0.045, 0.04, 6), { o: boss, u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, -0.004, 0.03, 0.006, S.cabinTrim));
  parts.add('monitor-arm', tube([
    { p: v3.add(boss, [0, 0.02, 0]), r: 0.016 },
    { p: v3.add(boss, [0, 0.12, 0]), r: 0.016 },
    { p: [back[0] - 0.06, back[1] - 0.02, back[2] + 0.12], r: 0.015 },
    { p: back, r: 0.015 },
    { p: v3.add(c, v3.scale(w, -M.depth + 0.004)), r: 0.015 },
  ], 14, S.cabinTrim));
}

/** The overhead panel: a raked slab under the roof, its face toward the seat, rows of switches. */
function buildOverhead(parts: Parts): void {
  const face = overheadFace();
  parts.add('overhead', cabinSolid([planeAt(face.w, face.o), ...between(7.55, 8.5), { n: [0, 0, 1], d: 0.44 }, { n: [0, 0, -1], d: 0.44 }], () => S.console, { bevel: 0.014, clearance: 0.04 }));
  // The map lights: a lens in a bezel either side, toward the seat.
  const L = COCKPIT_LAMPS.overhead;
  for (const z of L.lights) {
    const b: Basis = { o: at(face, z, L.back, 0), u: face.u, v: face.v, w: face.w };
    parts.add(`map-light-bezel-${z > 0 ? 's' : 'p'}`, tube([{ p: at(b, 0, 0, -0.004), r: L.r + 0.012 }, { p: at(b, 0, 0, 0.012), r: L.r + 0.012 }], 24, S.cabinTrim));
    parts.add(`map-light-${z > 0 ? 's' : 'p'}`, tube([{ p: at(b, 0, 0, 0.011), r: L.r }, { p: at(b, 0, 0, 0.016), r: L.r }], 24, S.spot));
  }
  const sw = new PolyMesh(40);
  // Rows of guarded toggles and two rotaries.
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 7; k++) {
      const x = -0.3 + k * 0.1;
      const y = -0.3 + row * 0.17;
      const b: Basis = { o: at(face, x, y, 0), u: face.u, v: face.v, w: face.w };
      sw.append(box(b, 0.022, 0.016, 0.01, 0.004, S.cabinTrim));
      sw.append(tube([{ p: at(face, x, y, 0.009), r: 0.0035 }, { p: at(face, x, y + 0.012, 0.03), r: 0.0035 }], 8, S.cabinTrim));
    }
  }
  for (const x of [-0.33, 0.33]) sw.append(tube([{ p: at(face, x, 0.17, -0.002), r: 0.024 }, { p: at(face, x, 0.17, 0.022), r: 0.022 }], 20, S.cabinRubber));
  parts.addSet('overhead-switches', sw);
  parts.add('overhead-display', extrudeBevel(roundedRect(0.12, 0.045, 0.006, 4), { o: at(face, 0, 0.2, 0), u: face.u, v: face.v, w: face.w }, -0.003, 0.004, 0.0015, S.screen));
}
