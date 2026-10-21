/**
 * The crew's fixtures in the field (docs/crew.md, "Fixtures"): where the fliers rest and the Drays
 * plug in. Static, of the Dome's hand (ceramic, bronze, black glaze).
 *
 *  - A Spotter's cradle: a fluted ceramic post on a plinth, a bronze seat its skids rest on.
 *  - A Ferry's pad: a low ceramic drum with a bronze ring inlaid near its rim and a black datum.
 *  - A Dray's socket: a bronze disc 15 mm proud of the paving, a black bore at its centre.
 */
import type { Vec2, Vec3 } from '../geometry/polyMesh';
import { lathe } from '../geometry/solids';
import { FIELD_Y } from '../field/layout';
import { CREW_SLOT as S } from './materials';
import { frame } from './kit/shapes';
import type { PartDef } from './rig';

const Y: Vec3 = [0, 1, 0];
const X: Vec3 = [1, 0, 0];
const up = (c: Vec3) => frame(c, Y, X);

/** The cradle's footprint radius (its plinth), the pad's, the socket's. */
export const FIXTURE_R = { cradle: 0.55, pad: 2.2, socket: 0.15 } as const;

export function cradleParts(seat: Vec3, k: number): PartDef[] {
  const base: Vec3 = [seat[0], FIELD_Y, seat[2]];
  const h = seat[1] - FIELD_Y;
  const plinth: Vec2[] = [[0, -0.02], [0.52, -0.02], [0.55, 0.0], [0.55, 0.2], [0.52, 0.23], [0.2, 0.25], [0, 0.25]];
  // The post: an entasis taper from the plinth to the seat's neck.
  const post: Vec2[] = [[0, 0.2]];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = 0.22 + (h - 0.36) * t;
    post.push([0.15 - 0.055 * t + 0.012 * Math.sin(Math.PI * t), y]);
  }
  post.push([0.13, h - 0.1], [0, h - 0.1]);
  const seatP: Vec2[] = [[0, h - 0.13], [0.11, h - 0.13], [0.3, h - 0.045], [0.32, h - 0.03], [0.32, -0.0 + h], [0, h]];
  return [
    { name: `cradle${k}:plinth`, mesh: lathe(plinth, 40, up(base), S.shell) },
    { name: `cradle${k}:post`, mesh: lathe(post, 32, up(base), S.shell, 50) },
    { name: `cradle${k}:seat`, mesh: lathe(seatP, 40, up(base), S.bronze) },
  ];
}

export function padParts(top: Vec3, k: number): PartDef[] {
  const base: Vec3 = [top[0], FIELD_Y, top[2]];
  const h = top[1] - FIELD_Y;
  const r = FIXTURE_R.pad;
  return [
    { name: `pad${k}:drum`, mesh: lathe([[0, -0.02], [r - 0.04, -0.02], [r, 0.02], [r, h - 0.04], [r - 0.04, h], [0, h]], 64, up(base), S.shell) },
    // The ring stands 3 mm proud of the top, inside the rim's chamfer.
    { name: `pad${k}:ring`, mesh: lathe([[r - 0.36, h - 0.004], [r - 0.24, h - 0.004], [r - 0.24, h + 0.003], [r - 0.36, h + 0.003]], 64, up(base), S.bronze) },
    { name: `pad${k}:datum`, mesh: lathe([[0, h - 0.004], [0.22, h - 0.004], [0.22, h + 0.003], [0, h + 0.003]], 32, up(base), S.black) },
  ];
}

export function socketParts(c: Vec3, k: number): PartDef[] {
  const base: Vec3 = [c[0], FIELD_Y, c[2]];
  const r = FIXTURE_R.socket;
  return [
    { name: `socket${k}:disc`, mesh: lathe([[0.05, -0.01], [r, -0.01], [r, 0.01], [r - 0.006, 0.015], [0.05, 0.015]], 36, up(base), S.bronze) },
    { name: `socket${k}:bore`, mesh: lathe([[0, -0.01], [0.052, -0.01], [0.052, 0.009], [0, 0.009]], 24, up(base), S.black) },
  ];
}

