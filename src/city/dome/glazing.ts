/**
 * How the Dome's glass is held. There are no glazing bars: each coffer (and each drum bay) is one
 * monolithic curved pane of transparent ceramic, pressed outward by the city's air against the
 * frame, which stands just off its outer face. At the platform edge the glass stands in a bronze
 * sill channel; at the West Gate it stops on the gatehouse's trim.
 *
 * This module owns the sill and the pane layout the glass shader needs (each pane has its own small
 * set error, so reflections break pane by pane): plan coffers above the eave, bays between the drum
 * verticals below it.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, sampleCurve, sweep, type Plane, type Profile } from '../../geometry/sweep';
import { DOME, GATE_OPENING, SILL } from './spec';
import { CARDINALS, cardinalPoint } from './surface';
import type { FrameLayout } from './frame';
import { SLOT } from './frame';

const { a } = DOME;
const holeW = GATE_OPENING.halfWidth + GATE_OPENING.trim;

/** Azimuths (at the sill) of the drum's verticals: posts, collar legs and band rails. */
export function drumVerticals(layout: FrameLayout): number[] {
  const phis: number[] = [];
  for (const n of layout.nodes) if (n.name.startsWith('node:eave:')) phis.push(Math.atan2(n.p[2], n.p[0]));
  for (const k of CARDINALS) {
    for (const w of [-DOME.arch.radius, -DOME.bandHalf, DOME.bandHalf, DOME.arch.radius]) {
      const p = cardinalPoint(k, w, DOME.centreY);
      phis.push(Math.atan2(p[2], p[0]));
    }
  }
  return phis.sort((p, q) => p - q);
}

/** Drum bay index by azimuth (the glass shader's pane identity below the eave). */
export function bayTable(layout: FrameLayout, size = 2048): Float32Array {
  const phis = drumVerticals(layout);
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const phi = -Math.PI + ((i + 0.5) / size) * 2 * Math.PI;
    let j = 0;
    while (j < phis.length && phis[j] <= phi) j++;
    table[i] = j % phis.length;
  }
  return table;
}

/** The sill channel: a bronze kerb on the platform's top edge with the glass's slot. */
export function buildSill() {
  const y0 = DOME.centreY - 0.02;
  const top = SILL.top;
  const rI = SILL.rIn;
  const rO = SILL.rOut;
  const slotIn = a - 0.085;
  const slotOut = a + 0.005;
  // (r, y) section, counter-clockwise, swept round the platform edge (t = y, b = ±(r − a)).
  const sec: Vec2[] = [
    [rI, y0], [rO, y0], [rO, top - 0.03], [rO - 0.03, top], [slotOut, top], [slotOut, top - 0.1], [slotIn, top - 0.1], [slotIn, top], [rI + 0.03, top], [rI, top - 0.03],
  ];
  const lat = holeW / a;
  const phiStart = Math.PI + Math.asin(lat);
  const phiEnd = Math.PI - Math.asin(lat) + 2 * Math.PI;
  const curve = (phi: number): Vec3 => [a * Math.cos(phi), 0, a * Math.sin(phi)];
  const { p } = sampleCurve(curve, phiStart - 0.002, phiEnd + 0.002, 2, 512);
  const frames = framesFrom(p, p.map(() => [0, 1, 0] as Vec3));
  const outward = v3.dot(frames[0].b, v3.norm([p[0][0], 0, p[0][2]])) > 0 ? 1 : -1;
  const prof: Profile = { pts: sec.map(([r, y]) => [outward * (r - a), y] as Vec2) };
  if (outward < 0) prof.pts.reverse();
  // The ring starts on the gatehouse's north side (z < 0) and ends on its south side.
  const planeA: Plane = { point: [0, 0, -holeW], normal: [0, 0, 1] };
  const planeB: Plane = { point: [0, 0, holeW], normal: [0, 0, 1] };
  return sweep(frames, prof, { trimStart: planeA, trimEnd: planeB, crease: 30, capSlot: SLOT.bronze });
}
