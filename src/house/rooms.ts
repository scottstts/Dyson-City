/**
 * Which room a point is in (docs/house.md): the rooms' boxes (house frame, Blender axes), each
 * grown by the walls' half thickness in plan and a little under the floor and over the ceiling so
 * a point in a doorway or on the floor still belongs to a room. Where grown boxes overlap (a
 * doorway between two rooms), the room the point lies deepest inside wins.
 */
import type { RoomBox } from './probeGrid';

const WALL = 0.15;
const UNDER = 0.1;
const OVER = 0.3;

/** The room's name, or null outside every room. */
export function roomOf(rooms: readonly RoomBox[], x: number, y: number, z: number): string | null {
  let best: string | null = null;
  let depth = -Infinity;
  for (const r of rooms) {
    const b = r.box;
    const d = Math.min(x - (b[0] - WALL), b[3] + WALL - x, y - (b[1] - WALL), b[4] + WALL - y, z - (b[2] - UNDER), b[5] + OVER - z);
    if (d > 0 && d > depth) {
      depth = d;
      best = r.name;
    }
  }
  return best;
}
