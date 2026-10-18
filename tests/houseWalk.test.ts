import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { H, HOUSE_F, HOUSE_FOOTPRINT } from '../src/estate/layout';
import { inside } from '../src/estate/sdf2';
import { HOUSE_GRADE } from '../src/estate/levels';
import { TestWalker } from './helpers/walker';
import { roomOf } from '../src/house/rooms';
import { indoorSurface } from '../src/house/floors';
import { hasPack, houseWorld } from './helpers/houseWorld';

/**
 * Walking into and through the house on its collision proxies (blender/docs/house.md "Collision"),
 * placed as the game places it. Skipped when the pack has not been exported.
 */
describe.skipIf(!hasPack)('walking the house', () => {
  const { root, walk, terrace, doors, floors, markers, boxes } = hasPack ? houseWorld() : ({} as ReturnType<typeof houseWorld>);
  const shutAll = () => doors.forEach((d) => walk.setDynamic(d.name, d.tris));
  const openAll = () => doors.forEach((d) => walk.setDynamic(d.name, null));
  const toHouse = new Vector3(-HOUSE_F[0], 0, -HOUSE_F[1]);
  const local = (w: { x: number; y: number; z: number }) => new Vector3(w.x, w.y, w.z).applyMatrix4(root.clone().invert());
  const underfoot = (w: { x: number; y: number; z: number }) => {
    const p = local(w);
    // As the house hears it (House.surfaceAt): rooms' boxes are in Blender axes (x, −z, y).
    return indoorSurface(floors.at(p.x, p.y, p.z), roomOf(boxes, p.x, -p.z, p.y) !== null);
  };
  /** Walks in quarter-metre steps, listing the surfaces met underfoot in order. */
  const along = (w: TestWalker, dx: number, dz: number, dist: number) => {
    const seen: string[] = [];
    for (let d = 0; d < dist; d += 0.25) {
      w.walk(dx, dz, 0.25);
      const s = underfoot(w) ?? 'off';
      if (seen.at(-1) !== s) seen.push(s);
    }
    return seen;
  };
  const walker = () => {
    const [x, z] = H(0, 7);
    return new TestWalker([walk, terrace]).place(x, z);
  };

  it('climbs the porch steps and is stopped by the shut front door', () => {
    shutAll();
    const w = walker();
    const seen = along(w, toHouse.x, toHouse.z, 8);
    expect(w.y).toBeGreaterThan(HOUSE_GRADE + 0.85);
    // Stopped at the door: still on the porch, in front of the house's front wall.
    expect(local(w).z).toBeGreaterThan(0);
    // Underfoot (footsteps): off the house, up its stone steps, across the porch's boards to the door's mat.
    expect(seen.join(' ')).toBe('off stone boards rug');
  });

  it('walks through the open door into the hall, on the ground floor', () => {
    openAll();
    const w = walker();
    const seen = along(w, toHouse.x, toHouse.z, 12);
    expect(local(w).z).toBeLessThan(-3);
    expect(w.y).toBeCloseTo(HOUSE_GRADE + 1.05, 2);
    // Steps, porch boards, the coir mat, the oak threshold, the vestibule's mat, its tiles and the hall's boards (both hard), the runner.
    expect(seen.join(' ')).toBe('off stone boards rug wood rug wood rug');
  });

  it('climbs the west porch steps onto its deck', () => {
    const [x, z] = H(-16.6, 0.3);
    const [ex, ez] = H(1, 0.3);
    const [ox, oz] = H(0, 0.3);
    const w = new TestWalker([walk, terrace]).place(x, z);
    const seen = along(w, ex - ox, ez - oz, 4.5);
    expect(local(w).x).toBeGreaterThan(-12.5);
    expect(w.y).toBeCloseTo(HOUSE_GRADE + 0.9, 1);
    expect(seen.join(' ')).toBe('off stone boards');
  });

  it('never slips past a flight or its cheeks into the void under a deck', () => {
    // Every flight approached from an arc of directions and offsets, up to the deck and on: the
    // walker must never stand under a deck (a floor overhead, at grade within the porches' plan).
    // The cheeks and skirts had no proxies, and a 2 cm crack between the deck and its top step
    // let a walker drop through the deck; both left it trapped under the porch.
    const decks = HOUSE_FOOTPRINT.slice(1);
    const under = (w: TestWalker) => {
      const q = local(w);
      // a floor over the feet up to the decks' height: the deck itself, not a beam or roof higher up
      return decks.some((p) => inside(p, q.x, q.z)) && walk.height(w.x, w.z, HOUSE_GRADE + 1.0) - w.y > 0.3;
    };
    // Foot of each flight (house frame) and the direction up it.
    const flights: [string, number, number, number, number][] = [
      ['front', 0, 5.89, 0, -1],
      ['west', -15.09, 0.3, 1, 0],
      ['rear', 1.1, -16.09, 0, 1],
    ];
    const [ox, oz] = H(0, 0);
    for (const [name, fx, fz, ux, uz] of flights) {
      for (let a = -80; a <= 80; a += 10) {
        const s = Math.sin((a * Math.PI) / 180);
        const c = Math.cos((a * Math.PI) / 180);
        // Up the flight turned by a (house frame), from 7 m out along the reverse.
        const dx = ux * c - uz * s;
        const dz = uz * c + ux * s;
        for (const off of [-1.4, -0.8, 0, 0.8, 1.4]) {
          const sx = fx - dx * 7 - uz * off;
          const sz = fz - dz * 7 + ux * off;
          const w = new TestWalker([walk, terrace]).place(...H(sx, sz));
          const [ex, ez] = H(dx, dz);
          for (let k = 0; k < 220; k++) {
            w.walk(ex - ox, ez - oz, 0.05);
            expect(under(w), `${name} flight, from (${sx.toFixed(1)}, ${sz.toFixed(1)}) at ${a}°: under the deck at ${local(w).toArray().map((n) => n.toFixed(2))}`).toBe(false);
          }
        }
      }
    }
  });

  it('lands on the porch deck from a fall, never through it', () => {
    // From 0.5–4 m above the deck (8.9 m/s at the end of the longest): each frame's drop is swept.
    for (const h of [0.5, 1, 2, 3, 4]) {
      for (const [x, z] of [[0, 3], [-1, 2.5], [8.5, -1], [-0.8, 4.41]]) {
        const w = new TestWalker([walk, terrace]).place(...H(x, z), HOUSE_GRADE + 1.2);
        w.y += h;
        w.drop();
        expect(w.y - HOUSE_GRADE, `fell ${h} m at (${x}, ${z})`).toBeCloseTo(0.9, 2);
      }
    }
  });

  it('places each sound in its room, whose reverb it feeds (docs/audio.md "The house")', () => {
    // Marker positions are house frame (glTF); rooms are Blender axes: (x, −z, y).
    const room = (name: string) => {
      const m = markers.find((k) => k.name === name)!;
      return roomOf(boxes, m.position[0], -m.position[2], m.position[1]);
    };
    expect(room('Sound_Hall_Clock')).toBe('Hall');
    expect(room('Sound_Parlour_Clock')).toBe('Parlour');
    // On the porch, outdoors: no room.
    expect(roomOf(boxes, 0, -3, 1.5)).toBe(null);
  });

  it('climbs the main stair to the first floor', () => {
    openAll();
    // From the hall behind the stair's foot, up it toward the front.
    const [x, z] = H(1.47, -9.0);
    const w = new TestWalker([walk, terrace]).place(x, z, HOUSE_GRADE + 1.5);
    const seen = along(w, HOUSE_F[0], HOUSE_F[1], 8.5);
    expect(w.y, `stopped at ${local(w).toArray().map((n) => n.toFixed(2))}`).toBeCloseTo(HOUSE_GRADE + 5.25, 1);
    // Oak treads beside the runner, then the landing's boards.
    expect(seen.join(' ')).toBe('wood');
  });
});
