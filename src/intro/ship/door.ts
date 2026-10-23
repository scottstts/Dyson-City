/**
 * The door (docs/intro-ship.md, "Door"): a plug leaf flush in its opening on the port side, its
 * outer face the hull's, its inner face the cabin's. Opening, it unlatches, moves straight out of
 * the opening (its edges clear the reveal's walls, which run square to the facet), then slides aft
 * along the hull on a track hidden in the fairing over the opening. Closing runs it back.
 *
 * Built in the ship's frame at the closed position; `doorOffset` moves it.
 */
import { extrudeBevel, tube, type Basis } from '../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { roundedRect } from '../../geometry/sweep';
import { convexSolid, planeAt, withBevels, type RectAperture } from '../../geometry/convex';
import { doorAperture, HULL_BEVELLED } from './hull';
import { DOOR, HULL, HULL_T } from './spec';
import { SHIP_SLOT as S } from './slots';

/** The side facet's outward normal, and the door's opening on it. */
const N: Vec3 = HULL_BEVELLED[HULL.sideP].n;
const A = doorAperture() as RectAperture;

/** The opening's frame on the outer skin: u aft→fore (x), v up the facet, w out of it. */
export function doorFrame(): Basis {
  const pl = HULL_BEVELLED[HULL.sideP];
  const o = v3.sub(A.centre, v3.scale(pl.n, v3.dot(pl.n, A.centre) - pl.d));
  const u: Vec3 = [1, 0, 0];
  return { o, u, v: v3.cross(N, u), w: N };
}

/** The leaf's phases (s): unlatch, out, aft. Closing runs them backward. */
export const DOOR_MOTION = { unlatch: 0.35, out: 0.75, slide: 1.5 } as const;
export const DOOR_TIME = DOOR_MOTION.unlatch + DOOR_MOTION.out + DOOR_MOTION.slide;

const ease = (u: number) => {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * (3 - 2 * x);
};

/**
 * The leaf's offset from closed at `s` seconds into opening (0 … DOOR_TIME), and how much of the
 * opening it has uncovered (0 … 1: light and air through it).
 */
export function doorOffset(s: number): { offset: Vec3; open: number } {
  const M = DOOR_MOTION;
  const out = ease((s - M.unlatch) / M.out) * DOOR.out;
  const aft = ease((s - M.unlatch - M.out) / M.slide) * DOOR.aft;
  const width = 2 * DOOR.halfWidth;
  // Moving out it opens a slot all round; sliding it uncovers the opening from the fore edge.
  const open = Math.min(1, (out / DOOR.out) * 0.06 + Math.min(aft / width, 1) * 0.94);
  return { offset: v3.add(v3.scale(N, out), [-aft, 0, 0]), open };
}

/** The leaf: its outer face the hull's finish, its inner the cabin's, its edges the reveal's. */
export function buildDoorLeaf(): PolyMesh[] {
  const f = doorFrame();
  const g = DOOR.gap;
  // Out to in: w from 0 (the outer skin) to −HULL_T (the inner).
  const b: Basis = { o: f.o, u: f.u, v: f.v, w: v3.scale(f.w, -1) };
  const leaf = extrudeBevel(roundedRect(A.hw - g, A.hh - g, A.r - g, 6), b, 0.002, HULL_T - 0.002, 0.006, S.reveal, S.hull);
  // The inner cap faces into the cabin: the cabin's finish.
  leaf.faces.forEach((face, i) => {
    if (leaf.faceMat[i] !== S.hull) return;
    const c = face.map((k) => leaf.verts[k]).reduce((a, p) => v3.add(a, v3.scale(p, 1 / face.length)), [0, 0, 0] as Vec3);
    if (v3.dot(v3.sub(c, f.o), N) < -HULL_T / 2) leaf.faceMat[i] = S.linerDark;
  });
  // Inside: a recessed trim panel and a pull handle, toward the leaf's fore edge.
  const inside: Basis = { o: v3.sub(f.o, v3.scale(N, HULL_T)), u: f.u, v: f.v, w: v3.scale(N, -1) };
  const panel = extrudeBevel(roundedRect(A.hw - 0.12, A.hh - 0.16, Math.max(A.r - 0.1, 0.04), 6), inside, 0.0, 0.012, 0.004, S.console);
  const grip = tube(handlePath(inside, [A.hw - 0.2, 0.05]), 12, S.cabinTrim);
  // Outside: a flush finger pocket's cover plate (a hard-edged recess would need the leaf cut).
  const outside: Basis = { o: f.o, u: f.u, v: f.v, w: N };
  const plate = extrudeBevel(roundedRect(0.07, 0.14, 0.03, 5), { ...outside, o: v3.add(f.o, v3.scale(f.u, A.hw - 0.2)) }, -0.002, 0.004, 0.0015, S.trim);
  return [leaf, panel, grip, plate];
}

function handlePath(b: Basis, at: Vec2): { p: Vec3; r: number }[] {
  const p = (x: number, y: number, z: number): Vec3 => v3.add(b.o, v3.add(v3.add(v3.scale(b.u, at[0] + x), v3.scale(b.v, at[1] + y)), v3.scale(b.w, z)));
  return [
    { p: p(0, -0.16, 0.004), r: 0.014 },
    { p: p(0, -0.16, 0.055), r: 0.014 },
    { p: p(0, 0.16, 0.055), r: 0.014 },
    { p: p(0, 0.16, 0.004), r: 0.014 },
  ];
}

/**
 * The track's fairing over the opening and the leaf's path aft: a slim faceted housing standing
 * off the hull, deep enough to hide the carrier that runs in it as the leaf moves out and aft.
 */
export function buildDoorFairing(): PolyMesh {
  const f = doorFrame();
  const top = A.hh + 0.04;
  const x0 = -A.hw - DOOR.aft - 0.08;
  const x1 = A.hw + 0.06;
  const at = (x: number, y: number, z: number): Vec3 => v3.add(f.o, v3.add(v3.add(v3.scale(f.u, x), v3.scale(f.v, y)), v3.scale(f.w, z)));
  // Its section: a lip off the hull, a sloped face, a drip edge; bounded by the facet, buried 1 cm.
  const planes = [
    planeAt(v3.scale(f.w, -1), at(0, 0, -0.01)),
    planeAt(f.w, at(0, 0, DOOR.out + 0.06)),
    planeAt(v3.scale(f.v, -1), at(0, top, 0)),
    planeAt(f.v, at(0, top + 0.1, 0)),
    planeAt(v3.norm(v3.add(f.v, v3.scale(f.w, 1.3))), at(0, top + 0.1, 0.02)),
    planeAt(v3.scale(f.u, -1), at(x0, 0, 0)),
    planeAt(f.u, at(x1, 0, 0)),
  ];
  return convexSolid(withBevels(planes, (i, j) => (i === 0 || j === 0 ? 0 : 0.01)), () => S.hull);
}
