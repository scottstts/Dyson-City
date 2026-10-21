/**
 * Review (?crew=<type>[:i[:s]]): runs the crew s seconds forward (20 by default; drones 0, so they
 * are seen at rest on their cradles and pads) and stands the walker where robot i of a type is seen
 * whole: in front of it and a little to one side, at a distance for its size, looking at its middle.
 * A robot up high (a deck, the supply line, a drone in flight) is seen from far enough back that the
 * view stays under the star: looking up into it blows the frame out. Types: hand, rigger, dray,
 * linewalker, spotter, ferry, mower, hedger, gardener (the estate's three by their work).
 */
import type { Spawn } from '../player/controller';
import { EYE_HEIGHT } from '../world/constants';
import { clearanceAt, type NavGrid } from './nav';
import type { Crew } from './crew';
import { HandAgent } from './agents/hand';

/** The highest a subject may stand over the eye's level (rad): the star's cone begins 45° up. */
const UP_MAX = 0.36;

interface Subject {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Height of its middle over its feet, and how far to stand back (plan). */
  mid: number;
  back: number;
  nav: NavGrid;
}

function subjects(crew: Crew, type: string): Subject[] {
  const hand = (h: HandAgent): Subject => {
    const r = h.follow.root;
    const estate = h.job.kind === 'mow' || h.job.kind === 'hedge' || h.job.kind === 'garden';
    return { x: r.x, y: h.motion.world[0].elements[13] - 0.95, z: r.z, heading: r.heading, mid: 1.0, back: h.job.kind === 'deck' ? 9 : 3.6, nav: estate ? crew.estateNav : crew.fieldNav };
  };
  const estate = { mower: 'mow', hedger: 'hedge', gardener: 'garden' } as const;
  if (type in estate) return crew.hands.filter((h) => h.job.kind === estate[type as keyof typeof estate]).map(hand);
  switch (type) {
    case 'hand':
      return crew.hands.filter((h) => h.job.kind === 'field' || h.job.kind === 'deck').map(hand);
    case 'rigger':
      return crew.riggers.map((g) => ({ x: g.x, y: 0, z: g.z, heading: g.follow.root.heading, mid: 1.4, back: 7, nav: crew.fieldNav }));
    case 'dray':
      return crew.drays.map((g) => ({ x: g.x, y: 0, z: g.z, heading: g.follow.root.heading, mid: 0.8, back: 7.5, nav: crew.fieldNav }));
    case 'linewalker':
      return crew.linewalkers.map((l) => {
        const e = l.world[0].elements;
        return { x: e[12], y: e[13], z: e[14], heading: Math.atan2(e[8], e[10]), mid: 0, back: 6, nav: crew.fieldNav };
      });
    case 'spotter':
    case 'ferry':
      return crew.drones.filter((d) => d.sortie.kind === type).map((d) => ({ x: d.pos.x, y: d.pos.y, z: d.pos.z, heading: d.heading, mid: 0, back: type === 'ferry' ? 9 : 5, nav: crew.fieldNav }));
    default:
      return [];
  }
}

/** The walker's spawn for a review of one robot, or null (no such robot). */
export function crewReview(crew: Crew, spec: string, craftWindow: number, groundY: number): Spawn | null {
  const [type, index, seconds] = spec.split(':');
  const drone = type === 'spotter' || type === 'ferry';
  crew.fastForward(seconds !== undefined && Number.isFinite(Number(seconds)) ? Number(seconds) : drone ? 0 : 20, craftWindow);
  const list = subjects(crew, type);
  if (!list.length) return null;
  const s = list[Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0)))];
  // Up high: back far enough that it stands at most UP_MAX over the eye's level.
  const rise = s.y + s.mid - (groundY + EYE_HEIGHT);
  if (rise > 2) s.back = Math.max(s.back, rise / Math.tan(UP_MAX));
  // In front and to one side, then round it until there is room to stand.
  const at = (a: number): [number, number] => [s.x + Math.sin(s.heading + a) * s.back, s.z + Math.cos(s.heading + a) * s.back];
  let p = at(0.5);
  for (const a of [0.5, -0.5, 1.0, -1.0, 0.2, -0.2, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
    const q = at(a);
    if (clearanceAt(s.nav, q[0], q[1]) >= 0.5) {
      p = q;
      break;
    }
  }
  const foot = s.nav === crew.estateNav ? s.y : groundY;
  const dx = s.x - p[0];
  const dz = s.z - p[1];
  const target = (s.mid ? s.y + s.mid : s.y) - (foot + EYE_HEIGHT);
  // Never pitched up more than half the subject's rise: the frame's top stays under the star.
  return { position: p, yaw: Math.atan2(-dx, -dz), pitch: Math.min(Math.atan2(target, Math.hypot(dx, dz)), UP_MAX / 2) };
}
