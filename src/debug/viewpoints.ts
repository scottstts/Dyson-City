import type { Spawn } from '../player/controller';

/** Named camera positions for review and headless renders. Yaw 0 faces north (−Z); −π/2 faces east. */
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
};

/** Arrival (design §7.4): outside the West Gate, facing the Dome. */
export const DEFAULT_VIEWPOINT = 'gate';
