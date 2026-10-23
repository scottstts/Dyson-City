/**
 * The cockpit's fittings (docs/intro-ship.md, "Cockpit fittings"): what the pilot's hands and eyes
 * work with, laid out as a single-seat cockpit is.
 *
 *  - Each console: a padded armrest at its inboard edge; ahead of it, the throttle (port, cockpit.ts)
 *    or the side-stick (starboard); outboard, a keypad, a cluster of rotary selectors and a field of
 *    circuit breakers; on its inboard face a footwell vent over a scuff plate.
 *  - The dash: rotary selectors between and beside its displays; along the glareshield's edge a
 *    padded coaming.
 *  - The overhead panel: two columns of breakers either side of its switches.
 *
 * Every fitting stands a few millimetres into what carries it (declared seats, parts.ts).
 */
import { extrudeBevel, lathe, tube, type Basis } from '../../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { box } from '../../../geometry/solids';
import { CONSOLE, DASH, dashFace, overheadFace } from '../cabin/cockpit';
import { SHIP_SLOT as S } from '../slots';
import type { ShipParts } from '../parts';
import { frameAt, louvres, subFrame } from './mount';

/** How deep a fitting sits into the surface that carries it inside the cabin (m). */
const SEAT_IN = 0.004;

/** A frame on a console's top at (x, z): u forward, v toward +z, w up. */
const onTop = (x: number, z: number): Basis => ({ o: [x, CONSOLE.top, z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] });

/** A rotary selector (w out of its panel): a skirt and a fluted cap. */
function knob(b: Basis, r: number): PolyMesh {
  return lathe([[0, -SEAT_IN], [r * 1.25, -SEAT_IN], [r * 1.25, 0.005], [r, 0.008], [r, 0.022], [r * 0.8, 0.026], [0, 0.026]], 18, b, S.cabinRubber);
}

/** A circuit breaker (w out of its panel): a collar and its button. */
function breaker(b: Basis): PolyMesh {
  return lathe([[0, -SEAT_IN], [0.009, -SEAT_IN], [0.009, 0.004], [0.006, 0.006], [0.006, 0.016], [0.0045, 0.018], [0, 0.018]], 12, b, S.cabinTrim);
}

export function buildCockpitDetails(parts: ShipParts): void {
  for (const side of [1, -1] as const) consoleFittings(parts, side);
  sideStick(parts);
  dashFittings(parts);
  overheadFittings(parts);
}

function consoleFittings(parts: ShipParts, side: 1 | -1): void {
  const s = side > 0 ? 's' : 'p';
  const host = `console-${s}`;
  const z = (v: number) => side * v;
  // The armrest: leather on a pad at the console's inboard edge, aft of the hand controls.
  parts.add(`armrest-${s}`, extrudeBevel(roundedRect(0.25, 0.08, 0.05, 6), onTop(7.87, z(0.72)), -SEAT_IN, 0.065, 0.022, S.leather));
  parts.seat(`armrest-${s}`, host);

  // The keypad: a bezel and a 3 × 4 field of keys.
  const pad = onTop(8.05, z(1.1));
  parts.add(`keypad-${s}`, extrudeBevel(roundedRect(0.12, 0.09, 0.012, 4), pad, -SEAT_IN, 0.008, 0.003, S.cabinMatte));
  parts.seat(`keypad-${s}`, host);
  const keys = new PolyMesh(40);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) keys.append(box(subFrame(pad, [-0.084 + i * 0.056, -0.05 + j * 0.05, 0.012]), 0.02, 0.016, 0.006, 0.0025, S.cabinRubber));
  parts.addSet(`keypad-keys-${s}`, keys);
  parts.seat(`set:keypad-keys-${s}`, `keypad-${s}`);

  // Rotary selectors on a plate.
  const sel = onTop(8.62, z(1.36));
  parts.add(`selector-plate-${s}`, extrudeBevel(roundedRect(0.13, 0.07, 0.012, 4), sel, -SEAT_IN, 0.006, 0.002, S.cabinMatte));
  parts.seat(`selector-plate-${s}`, host);
  const knobs = new PolyMesh(40);
  for (const [x, y] of [[-0.075, -0.025], [0, 0.025], [0.075, -0.025]] as Vec2[]) knobs.append(knob(subFrame(sel, [x, y, 0.006]), 0.017));
  parts.addSet(`selectors-${s}`, knobs);
  parts.seat(`set:selectors-${s}`, `selector-plate-${s}`);

  // Breakers: four rows of eight on a plate along the console's outboard side.
  const cb = onTop(8.4, z(1.78));
  parts.add(`breaker-plate-${s}`, extrudeBevel(roundedRect(0.4, 0.1, 0.012, 4), cb, -SEAT_IN, 0.006, 0.002, S.cabinMatte));
  parts.seat(`breaker-plate-${s}`, host);
  const cbs = new PolyMesh(40);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) cbs.append(breaker(subFrame(cb, [-0.33 + i * 0.094, -0.066 + j * 0.044, 0.006])));
  parts.addSet(`breakers-${s}`, cbs);
  parts.seat(`set:breakers-${s}`, `breaker-plate-${s}`);

  // The inboard face: a vent over a scuff plate (u forward, v up, w toward the seat).
  const face: Basis = { o: [8.35, 2.62, z(CONSOLE.inboard)], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, -side] };
  const { plate, slats } = louvres(face, 0.35, 0.08, 0.035, S.cabinMatte, S.cabinTrim);
  parts.add(`vent-${s}`, plate);
  parts.addSet(`vent-slats-${s}`, slats);
  parts.seat(`vent-${s}`, host);
  parts.seat(`set:vent-slats-${s}`, `vent-${s}`);
  parts.add(`scuff-${s}`, extrudeBevel(roundedRect(0.75, 0.045, 0.01, 3), subFrame(face, [0, -0.2, 0]), -SEAT_IN, 0.004, 0.0015, S.cabinTrim));
  parts.seat(`scuff-${s}`, host);
}

/** The side-stick on the starboard console: a boot, a shaft, the grip with its hat switch. */
function sideStick(parts: ShipParts): void {
  const b = onTop(8.2, 0.7);
  parts.add('stick-boot', lathe([[0, -SEAT_IN], [0.055, -SEAT_IN], [0.055, 0.012], [0.04, 0.03], [0.022, 0.06], [0, 0.066]], 24, b, S.cabinRubber));
  parts.seat('stick-boot', 'console-s');
  // Leaning a little forward and inboard, to the hand.
  const top: Vec3 = [8.215, CONSOLE.top + 0.12, 0.69];
  parts.add('stick-shaft', tube([{ p: frameAt(b, 0, 0, 0.05), r: 0.011 }, { p: top, r: 0.011 }], 12, S.cabinTrim));
  parts.seat('stick-shaft', 'stick-boot');
  const axis = v3.norm(v3.sub(top, b.o));
  const u = v3.norm(v3.cross([0, 0, 1], axis));
  const grip: Basis = { o: v3.sub(top, v3.scale(axis, 0.01)), u, v: v3.cross(axis, u), w: axis };
  parts.add('stick-grip', lathe([[0, 0], [0.022, 0.004], [0.029, 0.03], [0.031, 0.08], [0.025, 0.115], [0.012, 0.13], [0, 0.132]], 24, grip, S.cabinRubber));
  parts.seat('stick-grip', 'stick-shaft');
  parts.add('stick-hat', box(subFrame(grip, [0.012, 0, 0.128]), 0.01, 0.01, 0.008, 0.003, S.cabinTrim));
  parts.seat('stick-hat', 'stick-grip');
}

function dashFittings(parts: ShipParts): void {
  const face = dashFace();
  const midV = ((DASH.top + DASH.bottom) / 2 - DASH.face.y) / Math.cos(DASH.face.rake);
  // Selectors in the gaps between the displays and beyond the outer ones.
  const gap = (DASH.displays.z[1] + DASH.displays.z[2]) / 2;
  const knobs = new PolyMesh(40);
  for (const z of [-0.8, -gap, gap, 0.8]) for (const dv of [-0.06, 0.06]) knobs.append(knob(subFrame(face, [z, midV + dv, 0]), 0.014));
  parts.addSet('dash-selectors', knobs);
  parts.seat('set:dash-selectors', 'dash');
  // The coaming: a padded roll along the glareshield's edge over the displays.
  const r = DASH.face.rake;
  const ex = DASH.face.x + (DASH.top - DASH.face.y) * Math.tan(r);
  const y = DASH.top - 0.01;
  const x = ex - 0.012;
  parts.add('coaming', tube([
    { p: [x, y, -0.95], r: 0.012 },
    { p: [x, y, -0.935], r: 0.026 },
    { p: [x, y, 0.935], r: 0.026 },
    { p: [x, y, 0.95], r: 0.012 },
  ], 16, S.cabinRubber));
  parts.seat('coaming', 'dash');
}

function overheadFittings(parts: ShipParts): void {
  const face = overheadFace();
  const cbs = new PolyMesh(40);
  for (const u of [-0.41, -0.36, 0.36, 0.41]) for (let k = 0; k < 6; k++) cbs.append(breaker(subFrame(face, [u, -0.22 + k * 0.06, 0])));
  parts.addSet('overhead-breakers', cbs);
  parts.seat('set:overhead-breakers', 'overhead');
}
