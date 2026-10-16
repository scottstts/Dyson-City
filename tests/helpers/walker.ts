/**
 * A walker for tests: the controller's stepping rules (player/controller.ts) without a camera:
 * horizontal moves resolved against the walls within the body's band, a step-up limit, and falls
 * off edges landing as the controller lands (swept over each frame's drop, 1 g at 60 Hz).
 */
import { CollisionWorld } from '../../src/player/collision';
import type { WalkMesh } from '../../src/player/walkMesh';
import { groundHeight } from '../../src/ground/site';

const STEP_UP = 0.45;
const BAND: [number, number] = [STEP_UP - 0.03, 1.75];
const R = 0.3;

export class TestWalker {
  readonly walls = new CollisionWorld();
  x = 0;
  y = 0;
  z = 0;

  constructor(meshes: WalkMesh[]) {
    this.walls.meshes.push(...meshes);
  }

  ground(x: number, z: number, yMax: number): number {
    let g = groundHeight(x, z);
    for (const m of this.walls.meshes) g = Math.max(g, m.height(x, z, yMax));
    return g;
  }

  place(x: number, z: number, yMax = Infinity): this {
    this.x = x;
    this.z = z;
    this.y = this.ground(x, z, yMax);
    return this;
  }

  /** Walks toward (dx, dz) for `dist` metres in 5 cm steps; returns this. */
  walk(dx: number, dz: number, dist: number): this {
    const l = Math.hypot(dx, dz);
    const n = Math.ceil(dist / 0.05);
    for (let i = 0; i < n; i++) {
      const [nx, nz] = this.walls.move(this.x, this.z, (dx / l) * 0.05, (dz / l) * 0.05, R, [this.y + BAND[0], this.y + BAND[1]]);
      const g = this.ground(nx, nz, this.y + STEP_UP);
      if (g - this.y > STEP_UP) continue;
      this.x = nx;
      this.z = nz;
      if (g - this.y < -STEP_UP) this.drop();
      else this.y = g;
    }
    return this;
  }

  /** Drops from the current height as the controller does, in place, until a floor catches the feet. */
  drop(): this {
    const dt = 1 / 60;
    let v = 0;
    for (let i = 0; i < 600; i++) {
      v -= 9.81 * dt;
      const from = this.y;
      this.y += v * dt;
      const floor = this.ground(this.x, this.z, Math.max(from, this.y) + 0.05);
      if (this.y <= floor) {
        this.y = floor;
        return this;
      }
    }
    return this;
  }
}
