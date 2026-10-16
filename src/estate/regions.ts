/**
 * The estate's ground as regions (layout.ts `groundShapes`): each class's shape minus everything of
 * higher priority, contoured on a 10 cm grid (sdf2.ts) into outlines with holes. Neighbouring
 * regions are cut from the same fields, so their outlines coincide.
 */
import { box, contours, gridOver, intersect, nest, sample, union, type V2 } from './sdf2';
import { ESTATE_BOUNDS, GATEWAY, GROUND_ORDER, groundShapes, terraceInterior, type GroundClass } from './layout';

export interface Region {
  outer: V2[];
  holes: V2[][];
}

export const REGION_STEP = 0.1;

/** The class at each grid node (index into GROUND_ORDER; 255 off the ground): the grass's mask. */
export interface ClassGrid {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  cls: Uint8Array;
}

let lastGrid: ClassGrid | null = null;

/** The class grid of the last `groundRegions` call (same nodes the outlines were contoured on). */
export function classGrid(): ClassGrid {
  if (!lastGrid) groundRegions();
  return lastGrid!;
}

export function groundRegions(step = REGION_STEP): Record<GroundClass, Region[]> {
  const shapes = groundShapes();
  // Every class stays on the terrace (inside its walls); only the ramp runs out through the gateway.
  const r = GATEWAY.ramp;
  const site = union(terraceInterior, box((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, (r.z0 - r.z1) / 2));
  for (const c of GROUND_ORDER) if (c !== 'lawn') shapes[c] = intersect(shapes[c], site);
  const g = gridOver(ESTATE_BOUNDS, step);
  const n = g.nx * g.nz;
  // Everything already claimed by a higher class (min of their fields).
  const taken = new Float32Array(n).fill(1e3);
  const label = new Uint8Array(n).fill(255);
  const out = {} as Record<GroundClass, Region[]>;
  for (const [ci, cls] of GROUND_ORDER.entries()) {
    const f = sample(g, shapes[cls], undefined, 2 * step);
    const mine = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      mine[k] = Math.max(f[k], -taken[k]);
      if (mine[k] < 0) label[k] = ci;
      if (f[k] < taken[k]) taken[k] = f[k];
    }
    out[cls] = cls === 'void' ? [] : nest(contours(g, mine, 0.006));
  }
  lastGrid = { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, cls: label };
  return out;
}
