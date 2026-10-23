/**
 * The airstair (docs/intro-ship.md, "Stair"): a flight stowed flat in the floor's void under the
 * door's threshold. With the door open it runs straight out through the opening's foot, then
 * swings down about its inboard end until its foot pads meet the ground. Its treads ride pivots
 * on the stringers and stay level as it swings (a parallelogram linkage), and its handrails
 * stand up on their stanchions as it lowers: stowed, treads and rails lie flat in the stringers'
 * depth, so the whole flight passes the slot under the threshold.
 *
 * Stair frame (built in it, posed by `stairPose`): x across (the ship's x), y along the flight from
 * its hinge outward, z up out of its top. Ship frame: slid out and swung down to port.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { box, extrudeBevel, tube, type Basis } from '../../geometry/solids';
import { PolyMesh, type Vec3 } from '../../geometry/polyMesh';
import { roundedRect } from '../../geometry/sweep';
import { DOOR, STAIR } from './spec';
import { SHIP_SLOT as S } from './slots';

/** The hinge's height (mid-depth of the stowed flight) and its place, stowed and run out (ship frame). */
export const HINGE = {
  y: STAIR.stowY - STAIR.depth / 2,
  x: DOOR.x,
  /** Run out: just outside the hull's port side. */
  out: -3.1,
} as const;
/** Stowed, the flight lies inboard of the slot, its outer end at the opening. */
export const HINGE_STOWED_Z = HINGE.out + STAIR.length;

/**
 * The foot pads (stair frame): their centre along the flight, their soles' drop under its axis, and
 * the reach of their outer edge, which meets the ground first. The deployed pitch puts that edge on
 * the ground: hinge height = along·sin P + drop·cos P.
 */
export const FOOT = { along: STAIR.length - 0.08, drop: STAIR.depth / 2 + 0.03, half: 0.07 } as const;
const FOOT_REACH = FOOT.along + FOOT.half;
export const STAIR_PITCH = Math.asin(HINGE.y / Math.hypot(FOOT_REACH, FOOT.drop)) - Math.atan2(FOOT.drop, FOOT_REACH);

/** Tread centres along the flight (y, from the hinge), the stringers' half-spacing. */
export const TREADS: readonly number[] = Array.from({ length: STAIR.treads }, (_, i) => 0.16 + (i * (STAIR.length - 0.42)) / (STAIR.treads - 1));
const HALF = STAIR.width / 2;
const STRINGER_T = 0.026;
/** Stanchions (along the flight), their height and the rails' radius and offset out of the stringers. */
const RAIL = { stanchions: [0.2, 1.3, 2.4], height: 0.9, r: 0.018, x: HALF + 0.03 } as const;

/** The motion's phases (s): run out, swing down. Retracting runs them backward. */
export const STAIR_MOTION = { run: 1.4, swing: 1.5 } as const;
export const STAIR_TIME = STAIR_MOTION.run + STAIR_MOTION.swing;

const ease = (u: number) => {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * (3 - 2 * x);
};

/** The flight at `s` seconds into deploying: the hinge's run (0…1) and the swing angle (rad). */
export function stairState(s: number): { run: number; pitch: number } {
  return { run: ease(s / STAIR_MOTION.run), pitch: ease((s - STAIR_MOTION.run) / STAIR_MOTION.swing) * STAIR_PITCH };
}

/** The flight's frame in the ship's (run 0…1, pitch rad). */
export function stairPose(run: number, pitch: number, out = new Matrix4()): Matrix4 {
  const hz = HINGE_STOWED_Z + (HINGE.out - HINGE_STOWED_Z) * run;
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  // Along the flight: outward (−z) and down; up out of its top: the cross product.
  const along = new Vector3(0, -s, -c);
  const up = new Vector3(0, c, -s);
  return out.makeBasis(new Vector3(1, 0, 0), along, up).setPosition(HINGE.x, HINGE.y, hz);
}

/**
 * A stanchion's turn about x relative to the flight (it is built up its +z): folded forward along
 * the flight while it lies flat (−90°: out over the treads, away from the hull), upright in the
 * world once swung down (the flight's pitch). A tread turns by the pitch itself, to stay level.
 */
export function stanchionTurn(pitch: number): number {
  return -Math.PI / 2 + (Math.PI / 2 + STAIR_PITCH) * (pitch / STAIR_PITCH);
}

/** The flight's fixed parts (stair frame): stringers, the end plate, the hinge tube, the feet. */
export function buildFlight(): PolyMesh[] {
  const L = STAIR.length;
  const D = STAIR.depth;
  const out: PolyMesh[] = [];
  for (const sx of [-1, 1]) {
    const b: Basis = { o: [sx * (HALF - STRINGER_T / 2), L / 2, 0], u: [0, 1, 0], v: [0, 0, 1], w: [1, 0, 0] };
    out.push(extrudeBevel(roundedRect(L / 2, D / 2, 0.02, 4), b, -STRINGER_T / 2, STRINGER_T / 2, 0.006, S.titanium));
  }
  // The end plate closes the slot when stowed; the feet hang under it.
  out.push(box({ o: [0, L - 0.015, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, HALF + 0.004, D / 2, 0.015, 0.005, S.hull));
  out.push(tube([{ p: [-HALF - 0.012, 0.03, 0], r: 0.03 }, { p: [HALF + 0.012, 0.03, 0], r: 0.03 }], 16, S.titanium));
  for (const sx of [-1, 1]) {
    const foot: Basis = { o: [sx * (HALF - 0.08), FOOT.along, -FOOT.drop + 0.018], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
    out.push(extrudeBevel(roundedRect(FOOT.half, FOOT.half, 0.03, 5), foot, -0.018, 0.012, 0.006, S.rubber));
  }
  return out;
}

/** One tread (its own frame, about its pivot): a grated plate with a bright nosing. */
export function buildTread(): PolyMesh[] {
  const plate = box({ o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, HALF - STRINGER_T - 0.006, 0.12, 0.016, 0.004, S.matte);
  const nose = box({ o: [0, 0.112, 0.019], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, HALF - STRINGER_T - 0.02, 0.012, 0.004, 0.0015, S.trim);
  // Its pivots: pins into the stringers.
  const pins = new PolyMesh(40);
  for (const sx of [-1, 1]) pins.append(tube([{ p: [sx * (HALF - STRINGER_T - 0.008), 0, 0], r: 0.012 }, { p: [sx * (HALF - STRINGER_T / 2), 0, 0], r: 0.012 }], 10, S.titanium));
  return [plate, nose, pins];
}

/** A stanchion (its own frame, about its foot's pivot: up its length is +z). */
export function buildStanchion(): PolyMesh {
  return tube([{ p: [0, 0, -0.02], r: RAIL.r * 0.9 }, { p: [0, 0, RAIL.height], r: RAIL.r * 0.9 }], 12, S.trim);
}

/** Where each stanchion's pivot is (stair frame) and the rail's radius and height. */
export const STANCHIONS: readonly Vec3[] = [-1, 1].flatMap((sx) => RAIL.stanchions.map((y) => [sx * RAIL.x, y, 0] as Vec3));
export const HANDRAIL = RAIL;

/** A handrail (stair frame of its side, at the stanchions' tops when upright), length to span them. */
export function buildHandrail(): PolyMesh {
  const y0 = RAIL.stanchions[0] - 0.12;
  const y1 = RAIL.stanchions[RAIL.stanchions.length - 1] + 0.12;
  return tube([{ p: [0, y0, 0], r: RAIL.r }, { p: [0, y1, 0], r: RAIL.r }], 14, S.trim);
}

/** The foot's drop under the flight (for the pitch) and a tread centre in the ship frame (sound, walking). */
export function treadCentre(i: number, run = 1, pitch = STAIR_PITCH): Vec3 {
  const m = stairPose(run, pitch);
  const p = new Vector3(0, TREADS[i], 0.016).applyMatrix4(m);
  return [p.x, p.y, p.z];
}

