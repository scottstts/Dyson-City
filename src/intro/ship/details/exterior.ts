/**
 * The hull's fittings (docs/intro-ship.md, "Exterior fittings"): what a working ship carries on
 * its skin, each placed where it would serve.
 *
 *  - A dorsal spine over the cabin (the cable and coolant run aft from the cockpit), finned where
 *    it sheds the avionics' heat; the upper anti-collision beacon on it, the lower on the belly.
 *  - Blade antennas on the tail's roof and the belly; air-data probes either side of the nose.
 *  - Reaction-control quads: blocks of small thrusters at the nose's and the tail's corners, each
 *    firing out, up, down and along.
 *  - Navigation lights on the nacelles' outboard faces (red to port, green to starboard), white at
 *    the tail; strobes on the fins' tips; landing lights in the chin; a sensor turret under the nose.
 *  - On the tail's aft plate the auxiliary power unit's exhaust, a ground service panel and a
 *    louvred vent; by the door its keypad.
 *  - In each nacelle the fan behind the intake; on each nozzle its gimbal collar, two actuators and
 *    the centre plug.
 *
 * Built for starboard where a pair is mirrored. Every fitting sits a centimetre into what carries it
 * (declared seats, parts.ts) and its footprint is recorded for the tests.
 */
import { convexSolid, inset, planeAt, roundedRectLoop, withBevels, type HalfSpace } from '../../../geometry/convex';
import { box, extrudeBevel, lathe, tube, type Basis } from '../../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { HULL_BEVELLED } from '../hull';
import { finToShip, FIN, INTAKE_CENTRE, mirrorZ, NAC, NACELLE_PLANES, nacelleSlot } from '../nacelle';
import { BELL } from '../engines';
import { HULL, NACELLE, NOZZLE_CENTRE } from '../spec';
import { SHIP_SLOT as S } from '../slots';
import type { ShipParts } from '../parts';
import { boxPlanes, facetFrame, footprint, frameAt, localSolid, louvres, planarRing, SINK, sideXZ, subFrame } from './mount';
import { buildPlates } from './plates';

const H = HULL_BEVELLED;
/** Bevels for a fitting modelled from boxPlanes: none on its buried base (plane 0). */
const edges = (w: number) => (i: number, j: number) => (i === 0 || j === 0 ? 0 : w);

/** Adds a starboard part and its port mirror (slots swapped by `swap`), each seated in its host. */
function pair(parts: ShipParts, name: string, mesh: PolyMesh, host: string | null, swap: Record<number, number> = {}): void {
  const port = mirrorZ(mesh);
  port.faceMat = port.faceMat.map((s) => swap[s] ?? s);
  const set = name.startsWith('set:');
  for (const [side, m] of [['s', mesh], ['p', port]] as const) {
    const n = `${name}-${side}`;
    if (set) parts.addSet(n.slice(4), m);
    else parts.add(n, m);
    if (host) parts.seat(n, host.replace('$', side));
  }
}

export function buildExteriorDetails(parts: ShipParts): void {
  spine(parts);
  antennas(parts);
  rcs(parts);
  probes(parts);
  lights(parts);
  aftPlate(parts);
  keypad(parts);
  engines(parts);
  radiators(parts);
  hatch(parts);
  strakes(parts);
  nacelleBands(parts);
  intakes(parts);
  bellBands(parts);
  noseFittings(parts);
  buildPlates(parts);
}

/** Radiator panels on the tail's sides, over and under the wing's root; the bays' on the nacelles. */
function radiators(parts: ShipParts): void {
  const list: [string, Vec3, number, number][] = [
    ['radiator-low', [-4.5, 2.55, 2.5], 1.4, 0.42],
    ['radiator-high', [-4.8, 4.1, 2.5], 1.2, 0.22],
  ];
  for (const [name, at, hx, hy] of list) {
    const b = facetFrame(H[HULL.tailS], at, [1, 0, 0]);
    const { plate, slats } = louvres(b, hx, hy, 0.08, S.hull, S.titanium);
    pair(parts, name, plate, 'hull');
    pair(parts, `set:${name}-slats`, slats, `${name}-$`);
    footprint(parts, name, 'hull', HULL.tailS, b, hx, hy);
  }
  const nb = facetFrame(NACELLE_PLANES[NAC.top], [-7.5, 0, NACELLE.z], [1, 0, 0]);
  const { plate, slats } = louvres(nb, 0.9, 0.26, 0.06, S.hull, S.titanium);
  pair(parts, 'bay-louvre', plate, 'nacelle-$');
  pair(parts, 'set:bay-louvre-slats', slats, 'bay-louvre-$');
  footprint(parts, 'bay-louvre', 'nacelle', NAC.top, nb, 0.9, 0.26);
}

/** The dorsal hatch (the docking port) on the tail's roof: a ring, its leaf, two grips. */
function hatch(parts: ShipParts): void {
  const b = facetFrame(H[HULL.tailTop], [-1.6, 0, 0], [1, 0, 0]);
  parts.add('dorsal-hatch-ring', lathe([[0.44, -SINK], [0.56, -SINK], [0.56, 0.04], [0.53, 0.06], [0.44, 0.06]], 64, b, S.titanium));
  parts.add('dorsal-hatch-leaf', lathe([[0, -SINK], [0.43, -SINK], [0.43, 0.035], [0.4, 0.045], [0, 0.045]], 64, b, S.hull));
  parts.seat('dorsal-hatch-ring', 'hull');
  parts.seat('dorsal-hatch-leaf', 'hull');
  footprint(parts, 'dorsal-hatch-ring', 'hull', HULL.tailTop, b, 0.56, 0.56);
  const grips = new PolyMesh(40);
  for (const y of [-0.2, 0.2]) {
    const p = (x: number, z: number): Vec3 => frameAt(b, x, y, z);
    grips.append(tube([{ p: p(-0.1, 0.035), r: 0.012 }, { p: p(-0.1, 0.085), r: 0.012 }, { p: p(0.1, 0.085), r: 0.012 }, { p: p(0.1, 0.035), r: 0.012 }], 10, S.trim));
  }
  parts.addSet('dorsal-hatch-grips', grips);
  parts.seat('set:dorsal-hatch-grips', 'dorsal-hatch-leaf');
}

/** Ventral strakes along the belly: keels for the flow under the body. */
function strakes(parts: ShipParts): void {
  const b = facetFrame(H[HULL.belly], [0.7, 0, 1.95], [1, 0, 0]);
  const L = 2.6;
  const h = 0.14;
  pair(parts, 'strake', localSolid(b, [
    { n: [0, 0, -1], d: SINK },
    { n: [0, 0, 1], d: h },
    { n: [0, 1, 0], d: 0.0175 },
    { n: [0, -1, 0], d: 0.0175 },
    sideXZ([L, 0], [L - 0.6, h], [0, h / 2]),
    sideXZ([-L, 0], [-L + 0.4, h], [0, h / 2]),
  ], edges(0.008), S.hull), 'hull');
  footprint(parts, 'strake', 'hull', HULL.belly, b, L, 0.0175);
}

/** The dorsal spine over the cabin, its heat-shedding fins and the upper beacon. */
function spine(parts: ShipParts): void {
  const b = facetFrame(H[HULL.top], [3.7, 0, 0], [1, 0, 0]);
  const L = 2.95;
  const hw = 0.28;
  const h = 0.14;
  const side = (s: 1 | -1): HalfSpace => planeAt(v3.norm([0, s * h, hw - 0.18]), [0, s * hw, 0]);
  parts.add('spine', localSolid(b, [
    { n: [0, 0, -1], d: SINK },
    { n: [0, 0, 1], d: h },
    side(1),
    side(-1),
    sideXZ([L, 0], [L - 0.35, h], [0, h / 2]),
    sideXZ([-L, 0], [-L + 0.35, h], [0, h / 2]),
  ], edges(0.012), S.hull));
  parts.seat('spine', 'hull');
  footprint(parts, 'spine', 'hull', HULL.top, b, L, hw);
  const fins = new PolyMesh(40);
  for (let k = 0; k < 10; k++) fins.append(box(subFrame(b, [-0.9 + k * 0.15, 0, h + 0.021]), 0.007, 0.15, 0.026, 0.003, S.titanium));
  parts.addSet('spine-fins', fins);
  parts.seat('set:spine-fins', 'spine');
  beacon(parts, 'beacon-top', subFrame(b, [-2.4, 0, h]), 'spine');
  const belly = facetFrame(H[HULL.belly], [1.6, 0, 0], [1, 0, 0]);
  beacon(parts, 'beacon-belly', belly, 'hull');
  footprint(parts, 'beacon-belly', 'hull', HULL.belly, belly, 0.07, 0.07);
}

/** An anti-collision beacon: a dome lens on a base ring (w out of its mount). */
function beacon(parts: ShipParts, name: string, b: Basis, host: string): void {
  parts.add(`${name}-base`, lathe([[0, -SINK], [0.07, -SINK], [0.07, 0.018], [0.058, 0.03], [0, 0.03]], 32, b, S.trim));
  parts.add(`${name}-lens`, lathe([[0, 0.026], [0.05, 0.026], [0.05, 0.045], [0.036, 0.072], [0, 0.08]], 32, b, S.beacon));
  parts.seat(`${name}-base`, host);
  parts.seat(`${name}-lens`, `${name}-base`);
}

/** A swept blade antenna: base chord c0, tip chord c1, height, sweep of its leading edge, thickness. */
function blade(b: Basis, height: number, c0: number, c1: number, sweep: number, t: number): PolyMesh {
  const tipLE = c0 / 2 - sweep;
  const mid: Vec2 = [(tipLE - c1 / 2) / 2, height / 2];
  return localSolid(b, [
    { n: [0, 0, -1], d: SINK },
    { n: [0, 0, 1], d: height },
    { n: [0, 1, 0], d: t / 2 },
    { n: [0, -1, 0], d: t / 2 },
    sideXZ([c0 / 2, 0], [tipLE, height], mid),
    sideXZ([-c0 / 2, 0], [tipLE - c1, height], mid),
  ], (i, j) => (i === 0 || j === 0 ? 0 : 0.006), S.hull);
}

function antennas(parts: ShipParts): void {
  const list: [string, number, Vec3, number, number, number, number][] = [
    ['antenna-tail-fore', HULL.tailTop, [-2.6, 0, 0], 0.26, 0.34, 0.13, 0.16],
    ['antenna-tail-aft', HULL.tailTop, [-6.2, 0, 0], 0.38, 0.46, 0.16, 0.26],
    ['antenna-belly', HULL.belly, [0.6, 0, 0.9], 0.2, 0.3, 0.12, 0.14],
  ];
  for (const [name, plane, at, height, c0, c1, sweep] of list) {
    const b = facetFrame(H[plane], at, [1, 0, 0]);
    parts.add(name, blade(b, height, c0, c1, sweep, 0.022));
    parts.seat(name, 'hull');
    footprint(parts, name, 'hull', plane, b, c0 / 2, 0.011);
  }
}

/** A thruster's bell (w along its thrust), its throat under the face it stands on. */
function bell(b: Basis): PolyMesh {
  return lathe([[0.016, -0.012], [0.026, -0.012], [0.026, 0], [0.042, 0.05], [0.05, 0.07], [0.04, 0.07], [0.022, 0.012], [0.016, 0.012]], 20, b, S.nozzle);
}

/** Reaction-control quads: at the nose's sides and the tail's, mirrored to port. */
function rcs(parts: ShipParts): void {
  const quads: [string, number, Vec3, 1 | -1][] = [
    ['rcs-nose', HULL.noseS, [9.95, 3.15, 2.5], 1],
    ['rcs-tail', HULL.tailS, [-10.2, 3.4, 2.5], -1],
  ];
  for (const [name, plane, at, along] of quads) {
    const b = facetFrame(H[plane], at, [1, 0, 0]);
    const hx = 0.13;
    const hy = 0.1;
    const top = 0.13;
    pair(parts, name, localSolid(b, boxPlanes(hx, hy, -SINK, top), edges(0.015), S.hull), 'hull');
    footprint(parts, name, 'hull', plane, b, hx, hy);
    const bells = new PolyMesh(40);
    bells.append(bell(subFrame(b, [0, 0, top])));
    bells.append(bell(subFrame(b, [0, hy, 0.065], [1, 0, 0], [0, 0, 1], [0, 1, 0])));
    bells.append(bell(subFrame(b, [0, -hy, 0.065], [1, 0, 0], [0, 0, -1], [0, -1, 0])));
    bells.append(bell(subFrame(b, [along * hx, 0, 0.065], [0, 1, 0], [0, 0, 1], [along, 0, 0])));
    pair(parts, `set:${name}-bells`, bells, `${name}-$`);
  }
}

/** Air-data probes: a mast on each side of the nose, the probe pointing forward. */
function probes(parts: ShipParts): void {
  const b = facetFrame(H[HULL.noseS], [9.3, 2.78, 2.5], [1, 0, 0]);
  pair(parts, 'pitot-mast', localSolid(b, boxPlanes(0.05, 0.014, -SINK, 0.085), edges(0.006), S.titanium), 'hull');
  footprint(parts, 'pitot-mast', 'hull', HULL.noseS, b, 0.05, 0.014);
  const o = frameAt(b, 0, 0, 0.062);
  const probe = lathe([[0, -0.04], [0.011, -0.04], [0.011, 0.2], [0.008, 0.25], [0.005, 0.27], [0, 0.272]], 16, { o, u: [0, 1, 0], v: [0, 0, 1], w: [1, 0, 0] }, S.trim);
  pair(parts, 'pitot-probe', probe, 'pitot-mast-$');
}

function lights(parts: ShipParts): void {
  // Navigation: a raked housing on each nacelle's outboard face, its lens toward the side.
  const nb = facetFrame(NACELLE_PLANES[NAC.outboard], [0.5, NACELLE.y, NACELLE.z], [1, 0, 0]);
  const housing = localSolid(nb, [
    { n: [0, 0, -1], d: SINK },
    { n: [0, 0, 1], d: 0.05 },
    { n: [0, 1, 0], d: 0.045 },
    { n: [0, -1, 0], d: 0.045 },
    sideXZ([0.12, 0], [0.07, 0.05], [0, 0.02]),
    sideXZ([-0.12, 0], [-0.09, 0.05], [0, 0.02]),
  ], edges(0.008), S.hull);
  pair(parts, 'nav-housing', housing, 'nacelle-$');
  footprint(parts, 'nav-housing', 'nacelle', NAC.outboard, nb, 0.12, 0.045);
  const lens = extrudeBevel(roundedRect(0.055, 0.028, 0.012, 4), subFrame(nb, [-0.01, 0, 0.05]), -0.004, 0.006, 0.002, S.navGreen);
  pair(parts, 'nav-lens', lens, 'nav-housing-$', { [S.navGreen]: S.navRed });

  // Strobes: a lens along each fin's tip.
  const tip = box({ o: [(FIN.tip.le + FIN.tip.te) / 2, FIN.height + 0.02 - SINK, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.09, 0.02, 0.028, 0.008, S.strobe).transform(finToShip);
  pair(parts, 'strobe', tip, 'fin-$');

  // The tail light, on the aft plate over the service fittings.
  const tb = facetFrame(H[HULL.aft], [-11.2, 3.82, 0], [0, 0, 1]);
  parts.add('tail-light-housing', extrudeBevel(roundedRect(0.07, 0.04, 0.02, 4), tb, -SINK, 0.03, 0.006, S.trim));
  parts.add('tail-light', extrudeBevel(roundedRect(0.05, 0.025, 0.014, 4), tb, 0.02, 0.04, 0.003, S.navWhite));
  parts.seat('tail-light-housing', 'hull');
  parts.seat('tail-light', 'tail-light-housing');
  footprint(parts, 'tail-light', 'hull', HULL.aft, tb, 0.07, 0.04);

  // Landing lights in the chin, either side of the centreline.
  const lb = facetFrame(H[HULL.chin], [11.4, 2.0, 0.42], [0, 0, 1]);
  pair(parts, 'landing-bezel', lathe([[0.07, -SINK], [0.1, -SINK], [0.1, 0.012], [0.086, 0.026], [0.07, 0.026]], 32, lb, S.trim), 'hull');
  pair(parts, 'landing-lens', lathe([[0, -SINK], [0.072, -SINK], [0.072, 0.014], [0.055, 0.022], [0, 0.025]], 32, lb, S.landing), 'landing-bezel-$');
  parts.seat('landing-lens-s', 'hull');
  parts.seat('landing-lens-p', 'hull');
  footprint(parts, 'landing-light', 'hull', HULL.chin, lb, 0.1, 0.1);

  // The sensor turret under the nose: a glazed ball in a ring.
  const eb = facetFrame(H[HULL.belly], [10.75, 0, 0], [1, 0, 0]);
  parts.add('turret-ring', lathe([[0, -SINK], [0.15, -SINK], [0.15, 0.03], [0.13, 0.045], [0, 0.045]], 36, eb, S.titanium));
  const ball: Vec2[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + (k / 12) * Math.PI;
    ball.push([k === 0 || k === 12 ? 0 : 0.1 * Math.cos(a), 0.1 + 0.1 * Math.sin(a)]);
  }
  parts.add('turret-ball', lathe(ball, 36, eb, S.lens));
  parts.seat('turret-ring', 'hull');
  parts.seat('turret-ball', 'turret-ring');
  footprint(parts, 'turret-ring', 'hull', HULL.belly, eb, 0.15, 0.15);
}

/** The aft plate: the APU's exhaust, a ground service panel, a louvred vent. */
function aftPlate(parts: ShipParts): void {
  const pl = H[HULL.aft];
  const apu = facetFrame(pl, [-11.2, 3.45, 1.05], [0, 0, 1]);
  parts.add('apu-exhaust', lathe([[0, -SINK], [0.115, -SINK], [0.115, 0.13], [0.1, 0.15], [0.088, 0.15], [0.088, 0.035], [0, 0.035]], 32, apu, S.nozzle));
  parts.seat('apu-exhaust', 'hull');
  footprint(parts, 'apu-exhaust', 'hull', HULL.aft, apu, 0.115, 0.115);

  const sp = facetFrame(pl, [-11.2, 2.85, -0.85], [0, 0, 1]);
  parts.add('service-panel', extrudeBevel(roundedRect(0.3, 0.17, 0.03, 4), sp, -SINK, 0.018, 0.004, S.titanium));
  parts.seat('service-panel', 'hull');
  footprint(parts, 'service-panel', 'hull', HULL.aft, sp, 0.3, 0.17);
  const sockets = new PolyMesh(40);
  for (const x of [-0.18, 0, 0.18]) sockets.append(lathe([[0, 0.008], [0.04, 0.008], [0.04, 0.045], [0.03, 0.045], [0.03, 0.022], [0, 0.022]], 20, subFrame(sp, [x, 0, 0]), S.rubber));
  parts.addSet('service-sockets', sockets);
  parts.seat('set:service-sockets', 'service-panel');

  const vent = facetFrame(pl, [-11.2, 2.75, 0.75], [0, 0, 1]);
  const slats = new PolyMesh(40);
  for (let k = 0; k < 5; k++) slats.append(box(subFrame(vent, [0, -0.12 + k * 0.06, 0.012]), 0.25, 0.012, 0.022, 0.003, S.titanium));
  parts.addSet('aft-vent', slats);
  parts.seat('set:aft-vent', 'hull');
  footprint(parts, 'aft-vent', 'hull', HULL.aft, vent, 0.25, 0.135);
}

/** The door's keypad, fore of the door at hand height. */
function keypad(parts: ShipParts): void {
  // u aft (−x) so that v runs up the port side.
  const b = facetFrame(H[HULL.sideP], [4.55, 3.3, -3], [-1, 0, 0]);
  parts.add('keypad', extrudeBevel(roundedRect(0.075, 0.12, 0.02, 4), b, -SINK, 0.012, 0.003, S.titanium));
  parts.seat('keypad', 'hull');
  footprint(parts, 'keypad', 'hull', HULL.sideP, b, 0.075, 0.12);
  const keys = new PolyMesh(40);
  for (const x of [-0.03, 0.03]) for (const y of [-0.075, -0.035, 0.005]) keys.append(box(subFrame(b, [x, y, 0.014]), 0.018, 0.014, 0.006, 0.003, S.rubber));
  keys.append(box(subFrame(b, [0, 0.07, 0.014]), 0.03, 0.01, 0.006, 0.003, S.navGreen));
  parts.addSet('keypad-keys', keys);
  parts.seat('set:keypad-keys', 'keypad');
}

/** The nacelles' fans and the nozzles' gimbal collars, actuators and plugs (starboard, mirrored). */
function engines(parts: ShipParts): void {
  // The fan behind the intake: a hub with a spinner, fifteen blades at 35°.
  const fan: Basis = { o: [-0.9, NACELLE.y, NACELLE.z], u: [0, 1, 0], v: [0, 0, 1], w: [1, 0, 0] };
  pair(parts, 'fan-hub', lathe([[0, -0.18], [0.17, -0.18], [0.17, 0.08], [0.13, 0.18], [0.06, 0.26], [0, 0.28]], 32, fan, S.titanium), null);
  const blades = new PolyMesh(40);
  const pitch = (35 * Math.PI) / 180;
  for (let k = 0; k < 15; k++) {
    const a = (2 * Math.PI * k) / 15;
    const er: Vec3 = [0, Math.cos(a), Math.sin(a)];
    const et: Vec3 = [0, -Math.sin(a), Math.cos(a)];
    const c = v3.add(v3.scale(et, Math.cos(pitch)), [Math.sin(pitch), 0, 0]);
    blades.append(box({ o: v3.add(fan.o, v3.scale(er, 0.36)), u: er, v: c, w: v3.cross(er, c) }, 0.2, 0.065, 0.006, 0.002, S.titanium));
  }
  pair(parts, 'set:fan-blades', blades, 'fan-hub-$');

  // The nozzle's shroud: a bronze drum on the aft plate over the bell's gimbal, ribbed along its
  // length and banded, the bell flaring out of it.
  const c = NOZZLE_CENTRE;
  const plate: Basis = { o: [c[0], c[1], c[2]], u: [0, 1, 0], v: [0, 0, 1], w: [-1, 0, 0] };
  const len = 0.38;
  const rIn = bellRadius(len + BELL.inset) + BELL.wall + 0.007;
  const rOut = rIn + 0.03;
  pair(parts, 'nozzle-shroud', lathe([[rIn, -SINK], [rOut, -SINK], [rOut, len - 0.01], [rOut - 0.012, len], [rIn, len]], 64, plate, S.nozzle), 'nacelle-$');
  const ribs = new PolyMesh(40);
  for (let k = 0; k < 36; k++) {
    const t = (2 * Math.PI * k) / 36;
    const d: Vec3 = [0, Math.cos(t), Math.sin(t)];
    const e: Vec3 = [0, -Math.sin(t), Math.cos(t)];
    ribs.append(box({ o: v3.add([c[0] - len / 2 - 0.005, c[1], c[2]], v3.scale(d, rOut + 0.005)), u: d, v: e, w: [-1, 0, 0] }, 0.009, 0.006, len / 2 - 0.05, 0.002, S.nozzle));
  }
  pair(parts, 'set:nozzle-ribs', ribs, 'nozzle-shroud-$');
  const hoops = new PolyMesh(40);
  for (const h of [0.03, len / 2, len - 0.04]) hoops.append(lathe([[rOut - 0.004, h - 0.016], [rOut + 0.02, h - 0.016], [rOut + 0.024, h - 0.01], [rOut + 0.024, h + 0.01], [rOut + 0.02, h + 0.016], [rOut - 0.004, h + 0.016]], 64, plate, S.titanium));
  pair(parts, 'set:nozzle-hoops', hoops, 'nozzle-shroud-$');
  // The ribs run under the hoops.
  parts.seat('set:nozzle-ribs-s', 'set:nozzle-hoops-s');
  parts.seat('set:nozzle-ribs-p', 'set:nozzle-hoops-p');
  // The plug: a cone on the core, deep in the throat.
  const base: Basis = { o: [c[0] + BELL.inset, c[1], c[2]], u: [0, 1, 0], v: [0, 0, 1], w: [-1, 0, 0] };
  pair(parts, 'nozzle-plug', lathe([[0, 0.045], [0.2, 0.045], [0.14, 0.35], [0.05, 0.6], [0, 0.65]], 32, base, S.nozzle), 'core-$');
}

/** The bell's inner radius at h from its base (engines.ts buildMainEngine's contour). */
function bellRadius(h: number): number {
  const t = Math.min(Math.max(h / (BELL.length + BELL.inset), 0), 1);
  return BELL.throat + (BELL.exit - BELL.throat) * Math.pow(t, 1.6);
}

/** Segment bands round each nacelle: its skin's joints between sections, a little proud. */
function nacelleBands(parts: ShipParts): void {
  const out = inset(NACELLE_PLANES, -0.02);
  for (const [k, [x0, x1]] of ([[-0.46, -0.32], [-1.3, -1.18], [-2.7, -2.55], [-9.14, -9.0], [-10.95, -10.82]] as const).entries()) {
    const own = out.length;
    const planes: HalfSpace[] = [...out, { n: [-1, 0, 0], d: -x0 }, { n: [1, 0, 0], d: x1 }];
    const band = convexSolid(withBevels(planes, (i, j) => (i >= own || j >= own ? 0.008 : 0)), (p) => nacelleSlot(p < own ? p : NAC.top));
    pair(parts, `nacelle-band-${k}`, band, 'nacelle-$');
  }
  parts.seat('nacelle-band-2-s', 'wing-s');
  parts.seat('nacelle-band-2-p', 'wing-p');
  parts.seat('nacelle-band-4-s', 'fin-s');
  parts.seat('nacelle-band-4-p', 'fin-p');
}

/** The intakes' frames and the vanes across them. */
function intakes(parts: ShipParts): void {
  const N = NACELLE.intake;
  const b = facetFrame(NACELLE_PLANES[NAC.intake], INTAKE_CENTRE, [0, 0, 1]);
  const inner = roundedRectLoop(b.o, b.u, b.v, N.hw + 0.006, N.hh + 0.006, N.r + 0.006, 6);
  const outer = roundedRectLoop(b.o, b.u, b.v, N.hw + 0.08, N.hh + 0.08, N.r + 0.08, 6);
  pair(parts, 'intake-frame', planarRing(inner, outer, b.w, -SINK, 0.06, S.titanium), 'nacelle-$');
  footprint(parts, 'intake-frame', 'nacelle', NAC.intake, b, N.hw + 0.08, N.hh + 0.08);
  const vanes = new PolyMesh(40);
  for (const y of [-0.07, 0.07]) vanes.append(box(subFrame(b, [0, y, -0.05]), N.hw + 0.012, 0.006, 0.03, 0.002, S.titanium));
  pair(parts, 'set:intake-vanes', vanes, 'nacelle-$');
}

/** Bronze bands round each bell, fore and aft of the actuators' lugs. */
function bellBands(parts: ShipParts): void {
  const c = NOZZLE_CENTRE;
  const base: Basis = { o: [c[0] + BELL.inset, c[1], c[2]], u: [0, 1, 0], v: [0, 0, 1], w: [-1, 0, 0] };
  const rings = new PolyMesh(40);
  for (const h of [0.75, 0.9, 1.05]) {
    const ro = bellRadius(h + 0.02) + BELL.wall - 0.003;
    rings.append(lathe([[ro, h - 0.02], [ro + 0.025, h - 0.02], [ro + 0.028, h - 0.015], [ro + 0.028, h + 0.015], [ro + 0.025, h + 0.02], [ro, h + 0.02]], 48, base, S.nozzle));
  }
  pair(parts, 'set:bell-bands', rings, 'bell-$');
}

/** Ground service sockets under the starboard (and port) windows; the chin's camera. */
function noseFittings(parts: ShipParts): void {
  const b = facetFrame(H[HULL.noseS], [8.5, 2.85, 2.6], [1, 0, 0]);
  pair(parts, 'nose-sockets', extrudeBevel(roundedRect(0.12, 0.06, 0.02, 4), b, -SINK, 0.012, 0.003, S.titanium), 'hull');
  footprint(parts, 'nose-sockets', 'hull', HULL.noseS, b, 0.12, 0.06);
  const cups = new PolyMesh(40);
  for (const x of [-0.075, 0, 0.075]) cups.append(lathe([[0, 0.006], [0.026, 0.006], [0.026, 0.03], [0.019, 0.03], [0.019, 0.016], [0, 0.016]], 18, subFrame(b, [x, 0, 0]), S.rubber));
  pair(parts, 'set:nose-socket-cups', cups, 'nose-sockets-$');
  const cb = facetFrame(H[HULL.chin], [11.4, 2.0, 0], [0, 0, 1]);
  parts.add('chin-camera', localSolid(cb, boxPlanes(0.08, 0.06, -SINK, 0.07), edges(0.012), S.hull));
  parts.seat('chin-camera', 'hull');
  footprint(parts, 'chin-camera', 'hull', HULL.chin, cb, 0.08, 0.06);
  parts.add('chin-camera-lens', lathe([[0, 0.06], [0.035, 0.06], [0.035, 0.078], [0.028, 0.084], [0, 0.084]], 24, cb, S.lens));
  parts.seat('chin-camera-lens', 'chin-camera');
}
