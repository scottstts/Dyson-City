import type { Spawn } from '../player/controller';
import { HOUSE_SITE } from '../field/layout';
import { HOUSE_GRADE } from '../estate/levels';

/** Named camera positions for review and headless renders. Yaw 0 faces north (−Z); −π/2 faces east. */
const deg = (d: number) => (d * Math.PI) / 180;
/** Standing at `from` (plan), facing `to`, pitched up by `pitch`. */
const look = (from: [number, number], to: [number, number], pitch: number): Spawn => ({ position: from, yaw: Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])), pitch });

/** The house's front: toward the datum. Its +X (glTF) is (F.z, −F.x). */
const FRONT = (() => {
  const l = Math.hypot(HOUSE_SITE[0], HOUSE_SITE[1]);
  return [-HOUSE_SITE[0] / l, -HOUSE_SITE[1] / l] as const;
})();
/**
 * In the house: a point in its own frame (x right, z toward the front, metres from the front door's
 * grade), a floor height above grade, a view direction in its frame (degrees from its front, + to
 * the right) and pitch.
 */
const inHouse = (x: number, z: number, floor: number, headingDeg: number, pitch: number): Spawn => {
  const [fx, fz] = FRONT;
  const px = HOUSE_SITE[0] + x * fz + z * fx;
  const pz = HOUSE_SITE[1] - x * fx + z * fz;
  const h = (headingDeg * Math.PI) / 180;
  const dx = Math.sin(h) * fz + Math.cos(h) * fx;
  const dz = -Math.sin(h) * fx + Math.cos(h) * fz;
  return { position: [px, pz], yaw: Math.atan2(-dx, -dz), pitch, height: HOUSE_GRADE + floor + 0.3 };
};

export const VIEWPOINTS: Record<string, Spawn> = {
  /** Arrival: on the apron ~30 m in front of the West Gate's piers, facing the gate. */
  gate: { position: [-548, 0], yaw: -Math.PI / 2, pitch: 0.2 },
  /** Close to the drum outside, looking along the posts and the stepped sill. */
  drum: { position: [-470, -195], yaw: -Math.PI / 2 - 0.85, pitch: 0.18 },
  /** Inside the Dome at the centre, looking up through the coffers toward the west collar. */
  inside: { position: [60, 30], yaw: Math.PI / 2, pitch: 0.55 },
  /** Inside, at the drum, looking up along the glass. */
  ringwalk: { position: [470, 120], yaw: -Math.PI / 2 - 0.3, pitch: 0.35 },
  /** Close to the West Gate's outer leaf, under the hood. */
  portal: { position: [-530, 6], yaw: -Math.PI / 2 - 0.25, pitch: 0.12 },
  /** In the airlock chamber, looking at the inner gate. */
  chamber: { position: [-494, -3], yaw: -Math.PI / 2 + 0.15, pitch: 0.12 },
  /** In the Gate Court, looking back at the inner gate and the gatehouse. */
  court: { position: [-445, 14], yaw: Math.PI / 2 - 0.25, pitch: 0.1 },
  /** First impression: near the platform's east edge, looking east along the Spinward axis. */
  east: { position: [430, 0], yaw: -Math.PI / 2, pitch: 0.47 },
  /** Straight up into the star. */
  zenith: { position: [0, 0], yaw: 0, pitch: 1.5 },
  /** Toward the north pole on the star's limb. */
  north: { position: [0, 0], yaw: 0, pitch: 0.42 },
  /** The star's limb, north-east. */
  limb: { position: [0, 0], yaw: -Math.PI / 4, pitch: 0.74 },
  /** Low view along the horizon to the east (Girdle ribbon). */
  horizon: { position: [0, 0], yaw: -Math.PI / 2, pitch: 0.05 },
  /** Standing on the deck outside the platform, looking back at its stepped edge. */
  edge: { position: [508, -6], yaw: Math.PI / 2 - 0.25, pitch: -0.12 },
  /** The bronze datum at the centre. */
  datum: { position: [0, 4.5], yaw: 0, pitch: -0.95 },
  /** Out on the bare deck. */
  deck: { position: [1600, 300], yaw: -Math.PI / 2 + 0.3, pitch: 0.12 },
  /** The platform from its west edge, looking east across the whole site. */
  west: { position: [-470, 0], yaw: -Math.PI / 2, pitch: 0.12 },
  // The field (docs/field.md; city_plan.md §8 views 1, 2, 5, 6, 7).
  /** §8.1: the inner gate opens: the road into the field, the Halo and the Mast at its end. */
  reveal: { position: [-462, 0], yaw: -Math.PI / 2, pitch: 0.08 },
  /** §8.2: on the porch, over the lawn to the field. */
  porch: inHouse(0, 3.0, 0.9, 0, 0.06),
  // The house (docs/house.md): rooms for review.
  /** The front lawn, looking back at the house. */
  front: { ...inHouse(-2, 34, 0, 180, 0.12), height: undefined },
  parlour: inHouse(-4.9, -1.0, 1.05, -20, 0.02),
  hall: inHouse(0.25, -1.2, 1.05, 180, 0.08),
  library: inHouse(-10.6, -6.5, 1.05, 30, 0.02),
  dining: inHouse(-4.9, -11.5, 1.05, 10, 0.0),
  landing: inHouse(0.25, -3.0, 5.25, 180, 0.0),
  study: inHouse(4.0, -5.0, 5.25, 35, 0.0),
  /** §8.3: the turret room's window seat, the whole compound below. */
  turret: inHouse(3.4, -0.9, 9.15, 40, -0.12),
  // The estate (docs/estate.md).
  /** From the Gate Court, the gateway and the terrace wall. */
  gateway: look([-418, -12], [-430, -40], deg(6)),
  /** From the field below the east balustrade. */
  balustrade: look([-262, -88], [-290, -112], deg(10)),
  /** Over the forecourt toward the porch. */
  forecourt: look([-336, -98], [-366, -110], deg(4)),
  /** Up the drive from the ramp's head. */
  approach: look([-430, -66], [-385, -88], deg(2)),
  /** The pond garden from its entrance. */
  pond: look([-322, -133], [-322, -151], deg(-4)),
  /** The kitchen garden from its south gate toward the glasshouse. */
  kitchen: look([-417, -137], [-417, -162], deg(4)),
  /** The carriage house across its yard. */
  carriage: look([-428, -86], [-450, -76], deg(5)),
  /** §8.4: the back garden's bench, the glass and the bare deck beyond. */
  back: { position: [-446, -135], yaw: deg(73.3), pitch: 0.05 },
  /** §8.5: from the Meridian, across the science block to the Resonator's ring. */
  resonator: look([0, 250], [-97, 290], 0.45),
  /** §8.6: on the craft corridor beside the Halo, looking east to the East Lock. */
  arrival: { position: [100, -28], yaw: -Math.PI / 2, pitch: 0.1 },
  /** §8.7: on the Meridian south of the Halo, toward the heat precincts and the south gate. */
  drive: { position: [0, 150], yaw: Math.PI, pitch: 0.05 },
  gyre: look([0, -200], [96, -288], deg(16)),
  hold: look([-150, 0], [-110, -110], deg(14)),
  stills: look([-40, -192], [-97, -290], deg(22)),
  converter: look([192, -40], [296, -124], deg(22)),
  reckoner: look([-40, 40], [-128, 128], deg(22)),
  loom: look([12, 192], [170, 147], deg(14)),
  mast: { position: [100, -20], yaw: deg(-50), pitch: deg(30) },
  halo: { position: [30, 140], yaw: deg(12), pitch: deg(10) },
  lock: { position: [620, 60], yaw: deg(70), pitch: deg(10) },
  /** The Cordon from the perimeter road: the south gate's pylons and bridge, the arcade running off. */
  cordon: look([70, 412], [0, 440], deg(8)),
  /** Down a lane of the science precinct's labs, from the west avenue. */
  plant: look([-192, 96], [-330, 96], deg(4)),
  /** The power precinct's switchyards and halls from the north avenue. */
  power: look([230, -192], [300, -300], deg(8)),
};

/** Arrival (design §7.4): outside the West Gate, facing the Dome. */
export const DEFAULT_VIEWPOINT = 'gate';
