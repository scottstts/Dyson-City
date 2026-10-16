/**
 * The estate's plan (city_plan §4; docs/estate.md): one source of truth for everything on the
 * terrace, in world metres (+X east, +Z south). The ground, the walls, the planting, the walk, the
 * tests and tools/site-plan all read it.
 *
 * The house faces the datum, so the garden around it is laid out on the house's own axes (its
 * front F, its right R): the forecourt, the porch apron, the borders against the house and the
 * back walk. Everything set against the estate's edges (the belts, the kitchen garden, the
 * orchard, the pond garden) follows the edges.
 *
 *  - The forecourt: a carriage sweep round a planted island in front of the porch.
 *  - The front lawn: open from the porch to the balustrade over the field; tree groups flank it, so
 *    the field reads as one wide view over the balustrade and as framed pictures through gaps
 *    (claires-voies) in the belts.
 *  - The drive: from the gateway on the Gate Court, up a ramp in a cutting, past the carriage house
 *    and the west porch, to the forecourt.
 *  - North: the orchard in long grass between the walled kitchen garden (with its glasshouse) and
 *    a hedged pond garden.
 *  - West: the back lawn, a flagged walk on the house's axis between borders to a bench in a yew
 *    exedra at the back balustrade, the Dome's glass beyond it.
 */
import { ESTATE, ESTATE_GATEWAY, HOUSE_SITE } from '../field/layout';
import { TERRACE_Y } from './levels';
import { band, bezier, box, circle, offset, polygon, smoothUnion, stroke, subtract, union, type Shape, type V2 } from './sdf2';

export { TERRACE_Y };

// ── The house's frame ───────────────────────────────────────────────────────────────────────────

/** The house's front (toward the datum) and its right (glTF +X). */
export const HOUSE_F: V2 = (() => {
  const l = Math.hypot(HOUSE_SITE[0], HOUSE_SITE[1]);
  return [-HOUSE_SITE[0] / l, -HOUSE_SITE[1] / l];
})();
export const HOUSE_R: V2 = [HOUSE_F[1], -HOUSE_F[0]];
/** Rotation of the house frame in plan: angle of R (x toward z). */
export const HOUSE_ANGLE = Math.atan2(HOUSE_R[1], HOUSE_R[0]);

/** A point given in the house's frame (x right, z toward the front; glTF axes) in world plan. */
export function H(x: number, z: number): V2 {
  return [HOUSE_SITE[0] + x * HOUSE_R[0] + z * HOUSE_F[0], HOUSE_SITE[1] + x * HOUSE_R[1] + z * HOUSE_F[1]];
}

/** A box in the house frame (centre and half sizes in its axes). */
function hbox(x: number, z: number, hx: number, hz: number, r = 0): Shape {
  const [cx, cz] = H(x, z);
  return box(cx, cz, hx, hz, HOUSE_ANGLE, r);
}

/**
 * The house at grade (house frame), from its collision proxies (tests/estate.test.ts checks them
 * against the bundle): the foundation, the porch deck with its quarter-round about the turret, the
 * west porch, the rear stoop and the three flights of steps with their cheeks.
 */
export const HOUSE_FOOTPRINT: V2[][] = [
  // Foundation (the turret's curve is under the porch deck).
  [[1.54, 0.06], [-1.54, 0.06], [-1.54, 1.86], [-2.775, 1.86], [-3.775, 2.86], [-6.225, 2.86], [-7.225, 1.86], [-8.46, 1.86], [-8.46, -0.94], [-13.26, -0.94], [-13.26, -9.66], [-8.46, -9.66], [-8.46, -10.29], [-8.2, -10.29], [-8.2, -11.71], [-8.46, -11.71], [-8.46, -13.06], [-7.225, -13.06], [-6.225, -14.06], [-3.775, -14.06], [-2.775, -13.06], [6.26, -13.06], [6.26, -9.26], [9.86, -9.26], [9.86, -2.14], [6.26, -2.14], [6.26, -0.84]],
  // Porch deck: front run, the quarter-round about the turret, the east run.
  [[-1.6, 1.865], [-1.6, 4.4], [1.6, 4.4], [1.6, 4.243], [2.005, 4.471], [2.874, 4.797], [3.79, 4.943], [4.717, 4.901], [5.617, 4.675], [6.453, 4.272], [7.191, 3.71], [7.802, 3.012], [8.26, 2.205], [8.546, 1.322], [8.65, 0.4], [9.8, 0.4], [9.8, -2.135], [6.265, -2.135], [6.265, -0.84], [1.54, 0.06], [-1.535, 0.065]],
  // West porch with its steps and cheeks.
  [[-15.09, -1.04], [-8.465, -1.04], [-8.465, 1.64], [-15.09, 1.64]],
  // Rear stoop with its steps and cheeks.
  [[-0.13, -16.09], [2.34, -16.09], [2.34, -13.06], [-0.13, -13.06]],
  // Front steps and cheeks.
  [[-1.63, 4.4], [1.63, 4.4], [1.63, 5.89], [-1.63, 5.89]],
];

export const houseFootprint: Shape = union(...HOUSE_FOOTPRINT.map((p) => polygon(p.map(([x, z]) => H(x, z)))));

// ── The terrace and its walls ───────────────────────────────────────────────────────────────────

/** Retaining wall: thickness behind its face, and the plan of its outer face. */
export const WALL = { thickness: 0.6, arcSegments: 48 } as const;

/** x of the arc (the back edge, a circle about the datum) at z. */
export const arcX = (z: number): number => -Math.sqrt(ESTATE.backR ** 2 - z * z);

/** The terrace's outer face, counter-clockwise from the south-east corner (x right, z down). */
export const TERRACE_OUTLINE: V2[] = (() => {
  const pts: V2[] = [[ESTATE.east, ESTATE.south], [ESTATE.east, ESTATE.north]];
  const a0 = Math.atan2(ESTATE.north, arcX(ESTATE.north));
  const a1 = Math.atan2(ESTATE.south, arcX(ESTATE.south));
  for (let i = 0; i <= WALL.arcSegments; i++) {
    const a = a0 + ((a1 - a0) * i) / WALL.arcSegments;
    pts.push([Math.cos(a) * ESTATE.backR, Math.sin(a) * ESTATE.backR]);
  }
  return pts;
})();

export const terrace: Shape = polygon(TERRACE_OUTLINE);
/** The soil inside the walls. */
export const terraceInterior: Shape = offset(terrace, -WALL.thickness);

/**
 * The gateway on the Gate Court (city_plan §4: "its gateway and steps toward the Gate Court"): two
 * piers on the wall line; between them the drive's ramp in a cutting, a flight of steps on each
 * side of it rising to landings at terrace level.
 */
export const GATEWAY = (() => {
  const x0 = ESTATE_GATEWAY.x0 + 1.0;
  const x1 = ESTATE_GATEWAY.x1 - 1.0;
  const mid = (x0 + x1) / 2;
  return {
    /** Clear opening between the piers' faces. */
    x0,
    x1,
    z: ESTATE.south,
    pier: 1.3,
    /** The ramp between its cutting walls, from the pad at the wall line up to the terrace. */
    ramp: { x0: mid - 3, x1: mid + 3, z0: ESTATE.south, z1: ESTATE.south - 20 },
    /** Cutting walls either side of the ramp. */
    cut: 0.45,
    /** Steps: risers and treads (rising north from the wall line). */
    steps: { count: 10, rise: 0.16, tread: 0.4 },
  };
})();

// ── The house's surroundings ────────────────────────────────────────────────────────────────────

/** The forecourt's carriage sweep (gravel ring) and its planted island, in front of the porch. */
export const FORECOURT = { centre: H(0, 19.5), r: 11.5, island: 4.8 } as const;

/** The carriage house (where the car lives) beside the drive near the gateway, doors east. */
export const CARRIAGE_HOUSE = { x: -450, z: -76, hx: 4.5, hz: 6.5 } as const;

/** The walled kitchen garden in the north-west (outer faces), its glasshouse against the north wall. */
export const KITCHEN = { x0: -435, x1: -399, z0: -166, z1: -140, wall: 0.36, gateS: -417, gateE: -151 } as const;
export const GLASSHOUSE = { x0: -425, x1: -409, z0: -165.1, z1: -158.2 } as const;

/** The pond garden in the north-east: a yew-hedged room round a lily pool. */
export const POND_GARDEN = { x: -322, z: -151, hx: 16, hz: 12.5, hedge: 0.9 } as const;
export const POOL = { x: -322, z: -151, hx: 7.2, hz: 3.0 } as const;

/** The orchard in long grass between the kitchen garden and the pond garden. */
export const ORCHARD = { x0: -393, x1: -343, z0: -167.5, z1: -136 } as const;

/** The back walk: from the rear stoop along the house's axis to a bench in a yew exedra. */
export const BACK_WALK = (() => {
  const start = H(1.1, -16.25);
  // Out along −F until the walk ends 7 m inside the back wall.
  let t = 0;
  for (; t < 200; t += 0.05) {
    const x = start[0] - HOUSE_F[0] * t;
    const z = start[1] - HOUSE_F[1] * t;
    if (Math.hypot(x, z) > ESTATE.backR - 7) break;
  }
  const end: V2 = [start[0] - HOUSE_F[0] * t, start[1] - HOUSE_F[1] * t];
  return { start, end, half: 0.9, exedra: 4.2 };
})();

// ── Ground regions ──────────────────────────────────────────────────────────────────────────────

export type GroundClass = 'void' | 'water' | 'soil' | 'flag' | 'brick' | 'ramp' | 'gravel' | 'meadow' | 'lawn';

/** Priority: a point belongs to the first class whose shape contains it. */
export const GROUND_ORDER: GroundClass[] = ['void', 'water', 'soil', 'flag', 'brick', 'ramp', 'gravel', 'meadow', 'lawn'];

/** Surface level of each class above the terrace (m): grass stands proud of gravel; tilth in kerbed beds. */
export const GROUND_LEVEL: Record<GroundClass, number> = {
  void: 0,
  water: -0.32,
  soil: 0.04,
  flag: 0.012,
  brick: 0.012,
  ramp: 0,
  gravel: 0,
  meadow: 0.02,
  lawn: 0.02,
};

const W = GATEWAY;

/** The drive's centreline: up the ramp, then curving past the carriage yard and the west porch into the forecourt. */
export const DRIVE: V2[] = (() => {
  const x = (W.ramp.x0 + W.ramp.x1) / 2;
  const top: V2 = [x, W.ramp.z1];
  // East along the south of the house (12 m clear of the west porch), then into the forecourt from the south-west.
  const pass: V2 = [-378, -86];
  const into = H(-4, 16);
  return [[x, ESTATE.south], ...bezier(top, [x, W.ramp.z1 - 16], [pass[0] - 26, pass[1] + 1], pass, 32), ...bezier(pass, [pass[0] + 11, pass[1] - 0.5], [into[0] - 6, into[1] + 9], into, 20).slice(1)];
})();
export const DRIVE_HALF = 3;

/** The gravel walks (half-width 1.2): north to the pond garden and the orchard, and the service walk round the house's right side. */
export const WALKS: { name: string; pts: V2[]; half: number }[] = [
  { name: 'pond', pts: bezier(H(7, 27), H(10, 33), [POND_GARDEN.x - 4, POND_GARDEN.z + POND_GARDEN.hz + 9], [POND_GARDEN.x, POND_GARDEN.z + POND_GARDEN.hz - 0.5], 24), half: 1.2 },
  { name: 'service', pts: [H(9.5, 14), ...bezier(H(13.5, 9), H(14.2, 2), H(14.2, -6), H(14.2, -14), 12), ...bezier(H(14.2, -14), H(14.2, -18), H(6, -19.5), H(1.1, -19.5), 12)], half: 1.1 },
  { name: 'kitchen', pts: bezier(H(14.2, -12), [KITCHEN.x1 + 10, KITCHEN.gateE + 2], [KITCHEN.x1 + 4, KITCHEN.gateE], [KITCHEN.x1 - 0.5, KITCHEN.gateE], 20), half: 0.95 },
  { name: 'westporch', pts: [H(-15.6, 0.3), H(-25.5, 0.3)], half: 1.0 },
  { name: 'terrace', pts: [[ESTATE.east - 2.1, ESTATE.north + 3.5], [ESTATE.east - 2.1, ESTATE.south - 3.2]], half: 1.5 },
  { name: 'orchard', pts: [[ORCHARD.x0 + 1, (ORCHARD.z0 + ORCHARD.z1) / 2], [ORCHARD.x1 + 4, (ORCHARD.z0 + ORCHARD.z1) / 2]], half: 1.0 },
];

/** Kitchen garden beds (soil) inside its brick paths. */
export const KITCHEN_BEDS: Shape[] = (() => {
  const k = KITCHEN;
  const ix0 = k.x0 + k.wall, ix1 = k.x1 - k.wall, iz0 = k.z0 + k.wall, iz1 = k.z1 - k.wall;
  const beds: Shape[] = [];
  const rect = (x0: number, z0: number, x1: number, z1: number) => box((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 0.05);
  // Wall borders (fruit trained on the walls): west, east (gate gap), south (gate gap), north either side of the glasshouse.
  const d = 1.3;
  beds.push(rect(ix0, iz0 + d + 1.0, ix0 + d, iz1));
  // Gateways: the beds stop short of the gate piers (1.1 m opening + 0.62 m pier + a margin).
  const gp = 1.95;
  beds.push(rect(ix1 - d, iz0 + d + 1.0, ix1, k.gateE - gp), rect(ix1 - d, k.gateE + gp, ix1, iz1));
  beds.push(rect(ix0 + d + 1.0, iz1 - d, k.gateS - gp, iz1), rect(k.gateS + gp, iz1 - d, ix1 - d - 1.0, iz1));
  beds.push(rect(ix0, iz0, GLASSHOUSE.x0 - 1.0, iz0 + d), rect(GLASSHOUSE.x1 + 1.0, iz0, ix1, iz0 + d));
  // Four quarters round the cross walks, each split by a narrow path.
  const qx0 = ix0 + d + 1.0, qx1 = ix1 - d - 1.0, qz0 = GLASSHOUSE.z1 + 1.2, qz1 = iz1 - d - 1.0;
  const cx = k.gateS, cz = k.gateE;
  for (const [x0, x1] of [[qx0, cx - 1.0], [cx + 1.0, qx1]]) {
    for (const [z0, z1] of [[qz0, cz - 1.0], [cz + 1.0, qz1]]) {
      const m = (x0 + x1) / 2;
      beds.push(rect(x0, z0, m - 0.35, z1), rect(m + 0.35, z0, x1, z1));
    }
  }
  return beds;
})();

/** Where the house's borders give way to the walks and apron that meet it. */
const BORDER_CUTS: Shape[] = [
  hbox(0, 7.0, 2.6, 2.4),
  hbox(-16.2, 0.3, 1.9, 1.4),
  hbox(1.1, -17.4, 1.6, 1.8),
  hbox(9.8, 0.4, 3.4, 1.8),
];

export function groundShapes(): Record<GroundClass, Shape> {
  const p = POND_GARDEN;
  const pondRoom = box(p.x, p.z, p.hx, p.hz, 0, 1.5);
  const pool = box(POOL.x, POOL.z, POOL.hx, POOL.hz, 0, POOL.hz);
  const rampBox = box((W.ramp.x0 + W.ramp.x1) / 2, (W.ramp.z0 + W.ramp.z1) / 2, (W.ramp.x1 - W.ramp.x0) / 2, (W.ramp.z0 - W.ramp.z1) / 2);
  // The flights to their heads (the top tread runs 0.6 m past the last riser, to the cheeks' ends).
  const flightLen = W.steps.count * W.steps.tread + 0.6;
  const stepsBox = box((W.x0 + W.x1) / 2, W.z - flightLen / 2 + 0.3, (W.x1 - W.x0) / 2, flightLen / 2 + 0.3);
  // The flights' cheek walls (gateway.ts) stand on the lawn's edge.
  const cheekLen = W.steps.count * W.steps.tread + 0.6;
  const cheeks = [W.x0 - 0.225, W.x1 + 0.225].map((x) => box(x, W.z - cheekLen / 2, 0.225, cheekLen / 2));
  const cuts = [-1, 1].map((s) => {
    const x = s < 0 ? W.ramp.x0 - W.cut / 2 : W.ramp.x1 + W.cut / 2;
    return box(x, (W.ramp.z0 + W.ramp.z1) / 2 - 0.3, W.cut / 2, (W.ramp.z0 - W.ramp.z1) / 2 + 0.3);
  });
  const k = KITCHEN;
  const kitchenOuter = box((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2, (k.x1 - k.x0) / 2, (k.z1 - k.z0) / 2);
  const kitchenInner = offset(kitchenOuter, -k.wall);
  // The gateways' openings through the wall (1.1 m either side of each gate's line).
  const kitchenGates = [box(k.gateS, k.z1 - k.wall / 2, 1.1, k.wall), box(k.x1 - k.wall / 2, k.gateE, k.wall, 1.1)];
  const ch = CARRIAGE_HOUSE;
  const houseBorder = subtract(band(houseFootprint, -0.05, 1.5), ...BORDER_CUTS);
  // The south shrubbery: two beds along the south wall, the claire-voie toward the Resonator between.
  const southBeds = [
    box((-421 + -336) / 2, -47.2, (421 - 336) / 2, 6.0, 0, 3),
    box(-296.2, -50.5, 3.6, 9.2, 0, 2.5),
  ];
  const northBelt = box((KITCHEN.x1 + 6 + ORCHARD.x0 - 2) / 2, -164.5, (ORCHARD.x0 - 2 - KITCHEN.x1 - 6) / 2, 3.2, 0, 1.5);
  const pondBeds = subtract(band(pondRoom, -p.hedge - 1.6, -p.hedge), box(p.x, p.z + p.hz - 1, 2.4, 2.5), box(p.x + p.hx - 1, p.z, 2.5, 2.4));
  const backBorders = [-1, 1].map((s) => {
    const a = H(1.1 + s * 3.4, -20);
    const b = H(1.1 + s * 3.4, -40);
    return stroke([a, b], 1.4);
  });
  const backWalk = union(stroke([BACK_WALK.start, BACK_WALK.end], BACK_WALK.half), circle(BACK_WALK.end[0], BACK_WALK.end[1], BACK_WALK.exedra * 0.62));
  return {
    void: union(stepsBox, ...cuts, ...cheeks, box(ch.x, ch.z, ch.hx, ch.hz), subtract(kitchenOuter, kitchenInner, ...kitchenGates), box((GLASSHOUSE.x0 + GLASSHOUSE.x1) / 2, (GLASSHOUSE.z0 + GLASSHOUSE.z1) / 2, (GLASSHOUSE.x1 - GLASSHOUSE.x0) / 2, (GLASSHOUSE.z1 - GLASSHOUSE.z0) / 2)),
    water: pool,
    soil: union(houseBorder, circle(FORECOURT.centre[0], FORECOURT.centre[1], FORECOURT.island), ...KITCHEN_BEDS, ...southBeds, northBelt, pondBeds, ...backBorders),
    flag: union(backWalk, offset(pool, 1.5)),
    brick: kitchenInner,
    ramp: rampBox,
    // The gravel network flares where its paths meet.
    gravel: smoothUnion(
      1.6,
      stroke(DRIVE, DRIVE_HALF),
      circle(FORECOURT.centre[0], FORECOURT.centre[1], FORECOURT.r),
      hbox(0, 7.0, 2.6, 2.4),
      ...WALKS.filter((w) => w.name !== 'orchard').map((w) => stroke(w.pts, w.half)),
      box(ch.x + ch.hx + 7.5, ch.z, 7.5, 8.0, 0, 1.0),
      // Landings beside the ramp, at terrace level, from the flights' heads to the ramp's.
      ...[[W.x0, W.ramp.x0 - W.cut], [W.ramp.x1 + W.cut, W.x1]].map(([a, b]) => {
        const zHead = W.z - W.steps.count * W.steps.tread - 0.6;
        return box((a + b) / 2, (zHead + W.ramp.z1 - 1) / 2, (b - a) / 2, (zHead - W.ramp.z1 + 1) / 2);
      }),
    ),
    meadow: subtract(box((ORCHARD.x0 + ORCHARD.x1) / 2, (ORCHARD.z0 + ORCHARD.z1) / 2, (ORCHARD.x1 - ORCHARD.x0) / 2, (ORCHARD.z1 - ORCHARD.z0) / 2, 0, 3), stroke(WALKS.find((w) => w.name === 'orchard')!.pts, 1.0)),
    lawn: terraceInterior,
  };
}

/** The ground's own level at a plan point: the terrace, or the ramp's slope. */
export function groundLevel(cls: GroundClass, _x: number, z: number): number {
  if (cls === 'ramp') {
    const t = Math.min(Math.max((W.ramp.z0 - z) / (W.ramp.z0 - W.ramp.z1), 0), 1);
    return TERRACE_Y - 1.6 * (1 - t);
  }
  return TERRACE_Y + GROUND_LEVEL[cls];
}

/** Bounds of the whole estate (plan). */
export const ESTATE_BOUNDS: [number, number, number, number] = [-470, ESTATE.north - 1, ESTATE.east + 1, ESTATE.south + 1];

/** The estate's floor at a plan point (the terrace or the ramp), or null off the estate (the star-shade's floor map). */
export function estateFloor(x: number, z: number): number | null {
  if (x < ESTATE_BOUNDS[0] || x > ESTATE_BOUNDS[2] || z < ESTATE_BOUNDS[1] || z > ESTATE_BOUNDS[3]) return null;
  const r = W.ramp;
  if (x > r.x0 && x < r.x1 && z < r.z0 && z > r.z1) return groundLevel('ramp', x, z);
  return terrace.sdf(x, z) < 0 ? TERRACE_Y : null;
}
