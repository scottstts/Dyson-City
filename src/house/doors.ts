/**
 * The house's doors (blender/docs/house.md "Doors"): every leaf hangs on a static rig at its shut
 * pose; the engine drives only the leaf's local transform. Hinged leaves turn about their pin (local
 * +Y) between 0 and `limit`; pocket doors slide along local +X between 0 and `limit` into the wall.
 * Leaves start in the pose they were exported in (some ajar).
 *
 * The player opens and shuts the door they stand at with E: the nearest leaf whose handle is within
 * reach of the feet in plan, at a storey's height, and roughly ahead (bearing in plan, the view's
 * pitch ignored). Once offered, a door stays offered until the player steps or turns clearly away
 * (wider limits to keep than to take), so the prompt holds steady while they stand near it.
 * *Rejected:* the handle within 12.6° of the line of sight from the eye. Up close the handle sits
 * ~0.7 m below the eye, so looking ahead it was outside the cone except in a narrow band of distances,
 * and the prompt flickered on and off. A pair of leaves moves together. A leaf is a moving wall (its collision box, as triangles in the walk
 * mesh), and it stops against the player rather than pass through them.
 */
import { Group, Vector3, type Camera } from 'three/webgpu';
import type { WalkMesh } from '../player/walkMesh';

/**
 * Plan distance from the feet to a handle (m) and bearing off the view's heading (rad) for a door to
 * be offered, and the wider limits that keep it offered.
 */
const REACH = 1.8;
const AIM = (60 * Math.PI) / 180;
const KEEP_REACH = 2.3;
const KEEP_AIM = (80 * Math.PI) / 180;
/** A handle counts when it is this far above and below the feet (m): the door on the walker's storey. */
const HANDLE_ABOVE: [number, number] = [0.3, 1.6];
/** Swing speed of a hinged leaf (rad/s) and of a pocket door (m/s) at full pace. */
const SWING = 1.5;
const SLIDE = 0.75;

const Y = new Vector3(0, 1, 0);

export interface DoorSpec {
  name: string;
  kind: 'hinge' | 'slide';
  /** Exported pose (rad or m) and the limit of travel (signed). */
  rest: number;
  limit: number;
  translation: [number, number, number];
  handle: [number, number, number];
  box: [number, number, number, number, number, number] | null;
  /** An outer door (in the exterior part): open, it lets the estate's sound in. */
  exterior: boolean;
}

/** How fast a leaf's rate follows what the hand wants (1/s), and the brake's deceleration (paces per second). */
const FOLLOW = 8;
const BRAKE = 3;

/** A leaf's full pace (amount per second). */
function paceOf(spec: DoorSpec): number {
  return (spec.kind === 'hinge' ? SWING : SLIDE) / Math.max(Math.abs(spec.limit), 1e-3);
}

/**
 * One step of a leaf's motion: a hand pushes it off, it runs at its pace and is caught before the
 * stop (constant deceleration), its rate following what the hand wants. Writes [amount, rate].
 */
function stepLeaf(amount: number, rate: number, target: number, pace: number, dt: number, out: [number, number]): [number, number] {
  const diff = target - amount;
  const want = Math.sign(diff) * Math.min(pace, Math.sqrt(2 * pace * BRAKE * Math.abs(diff)));
  const r = rate + (want - rate) * Math.min(1, dt * FOLLOW);
  const next = amount + r * dt;
  const done = (next - target) * Math.sign(diff) >= 0 || Math.abs(diff) < 1e-4;
  out[0] = done ? target : next;
  out[1] = done ? 0 : r;
  return out;
}

const STEP: [number, number] = [0, 0];
/** The step timeToTarget() looks ahead with (s). */
const LOOK_STEP = 1 / 240;

export class HouseDoor {
  readonly name: string;
  /** Leaves of a pair share it (Door_G_Front_L / _R → Door_G_Front). */
  readonly pair: string;
  readonly leaf: Group;
  readonly spec: DoorSpec;
  amount: number;
  target: number;
  /** Rate of travel (amount per second, signed). */
  rate = 0;
  private readonly shut: Vector3;
  private readonly corners: Vector3[] = [];

  constructor(spec: DoorSpec, leaf: Group) {
    this.spec = spec;
    this.name = spec.name;
    this.pair = spec.name.replace(/_[LR]$/, '');
    this.leaf = leaf;
    const t = spec.translation;
    this.shut = spec.kind === 'slide' ? new Vector3(t[0] - spec.rest, t[1], t[2]) : new Vector3(t[0], t[1], t[2]);
    this.amount = spec.limit !== 0 ? Math.min(Math.max(spec.rest / spec.limit, 0), 1) : 0;
    this.target = this.amount;
    if (spec.box) {
      const b = spec.box;
      for (let i = 0; i < 8; i++) this.corners.push(new Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]));
    }
    this.pose(this.amount);
  }

  /** Seconds until the leaf reaches its target if nothing stops it (0 at rest): its own motion, run ahead. */
  timeToTarget(): number {
    const pace = paceOf(this.spec);
    let a = this.amount;
    let r = this.rate;
    let t = 0;
    while (a !== this.target && t < 10) {
      [a, r] = stepLeaf(a, r, this.target, pace, LOOK_STEP, STEP);
      t += LOOK_STEP;
    }
    return t;
  }

  pose(amount: number): void {
    const s = this.spec;
    if (s.kind === 'hinge') {
      this.leaf.position.copy(this.shut);
      this.leaf.quaternion.setFromAxisAngle(Y, s.limit * amount);
    } else {
      this.leaf.position.set(this.shut.x + s.limit * amount, this.shut.y, this.shut.z);
      this.leaf.quaternion.identity();
    }
    this.leaf.updateMatrixWorld(true);
  }

  handleWorld(out: Vector3): Vector3 {
    return out.set(...this.spec.handle).applyMatrix4(this.leaf.matrixWorld);
  }

  /** The leaf's collision box as 12 world-space triangles. */
  collision(): Float32Array | null {
    if (!this.corners.length) return null;
    const w = this.corners.map((c) => c.clone().applyMatrix4(this.leaf.matrixWorld));
    const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    const out = new Float32Array(faces.length * 2 * 9);
    let o = 0;
    for (const f of faces) {
      for (const tri of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
        for (const k of tri) {
          out[o++] = w[k].x;
          out[o++] = w[k].y;
          out[o++] = w[k].z;
        }
      }
    }
    return out;
  }
}

const tmp = new Vector3();
const dir = new Vector3();

export class HouseDoors {
  readonly list: HouseDoor[] = [];
  private readonly walk: WalkMesh;
  /** The leaf the player is aiming at (for the prompt), if any. */
  aimed: HouseDoor | null = null;

  constructor(walk: WalkMesh) {
    this.walk = walk;
  }

  add(door: HouseDoor): void {
    this.list.push(door);
    this.walk.setDynamic(door.name, door.collision());
  }

  /** Finds the door the player stands at, toggles on `use`, moves leaves toward their targets. */
  update(dt: number, camera: Camera, feet: Vector3, use: boolean): void {
    camera.getWorldDirection(dir);
    const hx = dir.x;
    const hz = dir.z;
    const hl = Math.hypot(hx, hz);
    // Plan distance and bearing of a leaf's handle, or null if it is not on the walker's storey.
    const place = (d: HouseDoor): [number, number] | null => {
      d.handleWorld(tmp);
      const up = tmp.y - feet.y;
      if (up < HANDLE_ABOVE[0] || up > HANDLE_ABOVE[1]) return null;
      const dx = tmp.x - feet.x;
      const dz = tmp.z - feet.z;
      const dist = Math.hypot(dx, dz);
      // Looking straight up or down the heading is undefined: any bearing will do.
      const bearing = dist < 0.25 || hl < 1e-3 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * hx + dz * hz) / (dist * hl))));
      return [dist, bearing];
    };
    let best: HouseDoor | null = null;
    let bestScore = Infinity;
    for (const d of this.list) {
      const p = place(d);
      if (!p || p[0] > REACH || p[1] > AIM) continue;
      // Nearest first, ahead preferred: a radian off the heading weighs like a metre.
      const score = p[0] + p[1];
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    // The door already offered stays while within the wider limits, unless another is clearly better.
    const held = this.aimed ? place(this.aimed) : null;
    if (this.aimed && held && held[0] <= KEEP_REACH && held[1] <= KEEP_AIM) {
      if (!best || best.pair === this.aimed.pair || held[0] + held[1] < bestScore + 0.5) best = this.aimed;
    }
    this.aimed = best;
    if (use && best) {
      const open = best.target < 0.5;
      for (const d of this.list) if (d.pair === best.pair) d.target = open ? 1 : 0;
    }
    const y0 = feet.y + 0.42;
    const y1 = feet.y + 1.75;
    for (const d of this.list) {
      if (d.amount === d.target) continue;
      const prev = d.amount;
      [d.amount, d.rate] = stepLeaf(d.amount, d.rate, d.target, paceOf(d.spec), dt, STEP);
      d.pose(d.amount);
      const tris = d.collision();
      this.walk.setDynamic(d.name, tris);
      // It stops against the walker.
      if (tris && this.walk.overlapsDynamic(d.name, feet.x, feet.z, 0.3, y0, y1)) {
        d.amount = prev;
        d.target = prev;
        d.rate = 0;
        d.pose(prev);
        this.walk.setDynamic(d.name, d.collision());
      }
    }
  }
}
