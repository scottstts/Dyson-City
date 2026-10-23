/**
 * The engine nacelles (docs/intro-ship.md): two long faceted pods held clear of the body on swept
 * stub wings, a canted fin on each tail. The gap between body and pod is the ship's silhouette: a
 * slim chined body between two engines, not one block.
 *
 *  - Each pod is a thick shell, open at its intake (a face raked back under a falling cowl) and at
 *    the nozzle's throat in its aft plate.
 *  - Each wing is a solid slab, wedged to a leading edge, its root buried in the body's side and
 *    its tip in the pod's inboard face (declared seats).
 *  - Each fin is a thin swept slab canted out from the pod's roof, its root buried in it.
 *
 * Built for starboard; the port side is the mirror (mirrorZ).
 */
import { convexSolid, facetedShell, planeAt, withBevels, type Aperture, type HalfSpace } from '../../geometry/convex';
import { LEGS } from './gear';
import { VENTS } from './engines';
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { SHIP_SLOT } from './slots';
import { NACELLE, NOZZLE_CENTRE } from './spec';

const rad = (d: number) => (d * Math.PI) / 180;
const C = Math.cos;
const S = Math.sin;

export { NACELLE, NOZZLE_CENTRE } from './spec';

/** Named pod planes. */
export const NAC = {
  top: 0,
  bottom: 1,
  inboard: 2,
  outboard: 3,
  upperOut: 4,
  upperIn: 5,
  lowerOut: 6,
  lowerIn: 7,
  intake: 8,
  cowl: 9,
  chin: 10,
  rear: 11,
  boatTop: 12,
  boatBottom: 13,
  boatOut: 14,
} as const;

function nacellePlanes(): HalfSpace[] {
  const N = NACELLE;
  const at = (dy: number, dz: number, x = 0): Vec3 => [x, N.y + dy, N.z + dz];
  const out: HalfSpace[] = [];
  out[NAC.top] = planeAt([0, 1, 0], at(N.halfHeight, 0));
  out[NAC.bottom] = planeAt([0, -1, 0], at(-N.halfHeight, 0));
  out[NAC.inboard] = planeAt([0, 0, -1], at(0, -N.halfWidth));
  out[NAC.outboard] = planeAt([0, 0, 1], at(0, N.halfWidth));
  // Chamfers from the flat roof and floor to the sides: a hexagon-ish section.
  const up = Math.atan2(N.halfWidth - N.flat, N.halfHeight * 0.55);
  out[NAC.upperOut] = planeAt([0, S(up), C(up)], at(N.halfHeight, N.flat));
  out[NAC.upperIn] = planeAt([0, S(up), -C(up)], at(N.halfHeight, -N.flat));
  out[NAC.lowerOut] = planeAt([0, -S(up), C(up)], at(-N.halfHeight, N.flat));
  out[NAC.lowerIn] = planeAt([0, -S(up), -C(up)], at(-N.halfHeight, -N.flat));
  // The intake: raked back 26° from the vertical; the cowl falls to its lip, the chin rises to it.
  out[NAC.intake] = planeAt([C(rad(26)), -S(rad(26)), 0], at(0, 0, N.front));
  out[NAC.cowl] = planeAt([S(rad(17)), C(rad(17)), 0], at(N.halfHeight, 0, -1.3));
  out[NAC.chin] = planeAt([S(rad(34)), -C(rad(34)), 0], at(-N.halfHeight, 0, 0.1));
  // The tail: the aft plate, and a boat-tail drawing the pod in toward it.
  out[NAC.rear] = planeAt([-1, 0, 0], at(0, 0, N.rear));
  out[NAC.boatTop] = planeAt([-S(rad(6)), C(rad(6)), 0], at(N.halfHeight, 0, -10.6));
  out[NAC.boatBottom] = planeAt([-S(rad(5)), -C(rad(5)), 0], at(-N.halfHeight, 0, -10.8));
  out[NAC.boatOut] = planeAt([-S(rad(4)), 0, C(rad(4))], at(0, N.halfWidth, -10.4));
  return out;
}

export const NACELLE_PLANES: readonly HalfSpace[] = withBevels(nacellePlanes(), () => 0.07);

/** The intake's centre on its face, and the nozzle throat's centre on the aft plate (starboard). */
export const INTAKE_CENTRE: Vec3 = [NACELLE.front, NACELLE.y - 0.18, NACELLE.z];

/** The starboard pod: a thick shell open at the intake and at the nozzle's throat. */
export function buildNacelle(): PolyMesh {
  const N = NACELLE;
  return facetedShell(NACELLE_PLANES, N.wall, {
    slot: (p, skin) => (skin === 'outer' ? nacelleSlot(p) : SHIP_SLOT.reveal),
    apertures: [
      { plane: NAC.intake, centre: INTAKE_CENTRE, u: [0, 0, 1], hw: N.intake.hw, hh: N.intake.hh, r: N.intake.r, slot: SHIP_SLOT.reveal },
      { plane: NAC.rear, centre: NOZZLE_CENTRE, u: [0, 0, -1], hw: N.nozzle.r, hh: N.nozzle.r, r: N.nozzle.r * 0.999, corner: 10, slot: SHIP_SLOT.titanium },
      // The main gear's bay and the lift vents in the floor (starboard: the port pod is the mirror).
      ...floorOpenings(),
    ],
    margin: 0.03,
  });
}

/** The pod's lower facets (darker), its chamfers (worn edges), the rest. */
const LOWER = new Set<number>([NAC.bottom, NAC.lowerOut, NAC.lowerIn, NAC.chin, NAC.boatBottom]);
export function nacelleSlot(plane: number): number {
  if (plane > NAC.boatOut) return SHIP_SLOT.hullEdge;
  return LOWER.has(plane) ? SHIP_SLOT.hullLow : SHIP_SLOT.hull;
}

function floorOpenings(): Aperture[] {
  const N = NACELLE;
  const y = N.y - N.halfHeight;
  const main = LEGS.find((l) => l.name === 'main-s')!;
  const out: Aperture[] = [{ plane: NAC.bottom, centre: [main.pivot[0] + (main.fore - main.aft) / 2, y, N.z], u: [1, 0, 0], hw: (main.fore + main.aft) / 2, hh: main.bayHalf, r: 0.03, slot: SHIP_SLOT.matte }];
  for (const v of VENTS) if (v.z > 0 && v.name !== 'belly') out.push({ plane: NAC.bottom, centre: [v.x, y, v.z], u: [1, 0, 0], hw: v.hx, hh: v.hz, r: 0.03, slot: SHIP_SLOT.matte });
  return out;
}

/** The stub wing (starboard): root chord along the body, tip chord along the pod, swept. */
export const WING = {
  /** Mid-plane height and thickness. */
  y: 3.5,
  thick: 0.34,
  root: { z: 2.55, le: -0.7, te: -7.0 },
  tip: { z: 4.35, le: -3.3, te: -8.1 },
  /** Depth of the leading edge's wedge (m along x). */
  wedge: 0.9,
} as const;

export function buildWing(): PolyMesh {
  const W = WING;
  const le0: Vec3 = [W.root.le, W.y, W.root.z];
  const le1: Vec3 = [W.tip.le, W.y, W.tip.z];
  const along = v3.norm(v3.sub(le1, le0));
  // A wedge facet: through the leading edge and the line `wedge` aft of it on the top (or bottom).
  const wedge = (side: 1 | -1): HalfSpace => {
    let n = v3.norm(v3.cross(along, [-W.wedge, (side * W.thick) / 2, 0]));
    if (n[1] * side < 0) n = v3.scale(n, -1);
    return planeAt(n, le0);
  };
  const planes: HalfSpace[] = [
    planeAt([0, 1, 0], [0, W.y + W.thick / 2, 0]),
    planeAt([0, -1, 0], [0, W.y - W.thick / 2, 0]),
    wedge(1),
    wedge(-1),
    planeAt(v3.norm([-(W.tip.z - W.root.z), 0, W.tip.te - W.root.te]), [W.root.te, 0, W.root.z]),
    planeAt([0, 0, -1], [0, 0, W.root.z]),
    planeAt([0, 0, 1], [0, 0, W.tip.z]),
  ];
  // The ends are buried (root in the body, tip in the pod): only the exposed edges are chamfered.
  return convexSolid(withBevels(planes, (i, j) => (i >= 5 || j >= 5 ? 0 : 0.05)), (p) => (p >= planes.length ? SHIP_SLOT.hullEdge : p === 1 ? SHIP_SLOT.hullLow : SHIP_SLOT.hull));
}

/** The fin (starboard): a swept slab canted out from the pod's roof. */
export const FIN = {
  cant: rad(22),
  thick: 0.16,
  height: 1.55,
  root: { le: -9.3, te: -12.5 },
  tip: { le: -11.6, te: -12.95 },
  /** Depth the root sinks into the pod's roof. */
  sink: 0.12,
} as const;

export function buildFin(): PolyMesh {
  const F = FIN;
  // Fin frame: x along the ship, h up the fin, w across it; built upright, then canted about its root.
  const planes: HalfSpace[] = [
    planeAt([0, -1, 0], [0, -F.sink, 0]),
    planeAt([0, 1, 0], [0, F.height, 0]),
    planeAt([0, 0, 1], [0, 0, F.thick / 2]),
    planeAt([0, 0, -1], [0, 0, -F.thick / 2]),
    planeAt(v3.norm([F.height, F.root.le - F.tip.le, 0]), [F.root.le, 0, 0]),
    planeAt(v3.norm([-F.height, F.tip.te - F.root.te, 0]), [F.root.te, 0, 0]),
  ];
  return convexSolid(withBevels(planes, (i, j) => (i === 0 || j === 0 ? 0 : 0.04)), (p) => (p >= planes.length ? SHIP_SLOT.hullEdge : SHIP_SLOT.hull)).transform(finToShip);
}

/** The fin's frame (x along the ship, h up the fin, w across it) to the ship's (starboard). */
export function finToShip([x, h, w]: Vec3): Vec3 {
  const F = FIN;
  const by = NACELLE.y + NACELLE.halfHeight;
  const bz = NACELLE.z + 0.1;
  return [x, by + h * C(F.cant) - w * S(F.cant), bz + h * S(F.cant) + w * C(F.cant)];
}

/** Mirrors a part across the ship's centre plane (z → −z), keeping it outward. */
export function mirrorZ(m: PolyMesh): PolyMesh {
  const out = new PolyMesh(m.crease);
  out.verts = m.verts.map(([x, y, z]) => [x, y, -z] as Vec3);
  out.faces = m.faces.map((f) => [...f].reverse());
  out.faceMat = [...m.faceMat];
  out.uvs = m.uvs.map((u) => [...u].reverse());
  return out;
}
