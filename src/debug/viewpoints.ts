import type { Spawn } from '../player/controller';

/** Named camera positions for review and headless renders. Yaw 0 faces north (−Z); −π/2 faces east. */
const deg = (d: number) => (d * Math.PI) / 180;
/** Standing at `from` (plan), facing `to`, pitched up by `pitch`. */
const look = (from: [number, number], to: [number, number], pitch: number): Spawn => ({ position: from, yaw: Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])), pitch });

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
  /** §8.2: from where the house's porch will be, over the field. */
  porch: { position: [-357, -100], yaw: deg(-105.6), pitch: 0.1 },
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
