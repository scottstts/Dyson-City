/**
 * The pilot's seat (docs/intro-ship.md, "Cockpit"): on floor rails, a pedestal, a shell carrying
 * leather cushions with raised bolsters, reclined 15°, and a headrest on two posts. Placed so the
 * Guardian's eye (spec.ts EYE) sits where a seated person's eyes do: ~0.8 m over the pan, a hand's
 * breadth forward of the backrest.
 */
import { box, extrudeBevel, tube, type Basis } from '../../../geometry/solids';
import { v3, type Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { Parts } from '../../../field/kit/parts';
import { FLOOR_Y } from '../spec';
import { SHIP_SLOT as S } from '../slots';

const rad = (d: number) => (d * Math.PI) / 180;

/** The seat's datum: the pan's rear edge on the centreline, and its recline. */
export const SEAT = { x: 8.25, y: FLOOR_Y + 0.4, recline: rad(15), width: 0.25 } as const;

export function buildSeat(parts: Parts): void {
  const o: Vec3 = [SEAT.x, SEAT.y, 0];
  const r = SEAT.recline;
  // Pan frame: u across, v forward, w up. Back frame: u across, v up the back, w forward out of it.
  const pan: Basis = { o, u: [0, 0, -1], v: [1, 0, 0], w: [0, 1, 0] };
  const backUp: Vec3 = [-Math.sin(r), Math.cos(r), 0];
  const backFwd: Vec3 = [Math.cos(r), Math.sin(r), 0];
  const back = (along: number, out: number): Basis => ({ o: v3.add(o, v3.add(v3.scale(backUp, along), v3.scale(backFwd, out))), u: [0, 0, 1], v: backUp, w: backFwd });
  const W = SEAT.width;

  // Rails, and the pedestal standing on them.
  for (const z of [-0.17, 0.17]) parts.add(`seat-rail-${z > 0 ? 's' : 'p'}`, box({ o: [SEAT.x + 0.22, FLOOR_Y + 0.016, z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, 0.58, 0.022, 0.016, 0.005, S.cabinTrim));
  parts.add('seat-pedestal', box({ o: [SEAT.x + 0.24, FLOOR_Y + 0.19, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, 0.17, 0.13, 0.155, 0.02, S.console));
  // The pan: a shell, the cushion on it, a bolster either side.
  parts.add('seat-pan-shell', extrudeBevel(roundedRect(W + 0.02, 0.27, 0.05, 6), { ...pan, o: v3.add(o, [0.27, -0.05, 0]) }, 0, 0.05, 0.012, S.console));
  parts.add('seat-pan', extrudeBevel(roundedRect(W - 0.035, 0.25, 0.06, 6), { ...pan, o: v3.add(o, [0.26, 0, 0]) }, 0.002, 0.085, 0.03, S.leather));
  for (const side of [1, -1]) parts.add(`seat-pan-bolster-${side > 0 ? 's' : 'p'}`, extrudeBevel(roundedRect(0.024, 0.24, 0.02, 5), { ...pan, o: v3.add(o, [0.26, 0, side * (W - 0.008)]) }, 0.002, 0.12, 0.018, S.leather));
  // The back: a shell, the cushion in front of it, bolsters, and the headrest on its posts.
  parts.add('seat-back-shell', extrudeBevel(roundedRect(W + 0.02, 0.4, 0.06, 6), back(0.42, -0.06), 0, 0.05, 0.014, S.console));
  parts.add('seat-back', extrudeBevel(roundedRect(W - 0.035, 0.34, 0.07, 6), back(0.44, -0.008), 0, 0.09, 0.03, S.leather));
  for (const side of [1, -1]) {
    const b = back(0.44, -0.008);
    b.o = v3.add(b.o, [0, 0, side * (W - 0.008)]);
    parts.add(`seat-back-bolster-${side > 0 ? 's' : 'p'}`, extrudeBevel(roundedRect(0.024, 0.32, 0.02, 5), b, 0, 0.13, 0.018, S.leather));
  }
  const head = back(0.98, 0.0);
  parts.add('seat-headrest', extrudeBevel(roundedRect(0.15, 0.1, 0.05, 6), head, -0.04, 0.085, 0.03, S.leather));
  for (const z of [-0.07, 0.07]) {
    const a = v3.add(back(0.8, -0.035).o, [0, 0, z]);
    const b = v3.add(back(0.9, -0.0).o, [0, 0, z]);
    parts.add(`seat-post-${z > 0 ? 's' : 'p'}`, tube([{ p: v3.add(a, v3.scale(backUp, -0.02)), r: 0.011 }, { p: b, r: 0.011 }], 12, S.cabinTrim));
  }
}
