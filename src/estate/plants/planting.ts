/**
 * The planting plan (docs/estate.md "Planting"): where every tree stands and what fills every bed.
 * Pure: positions from the estate's layout; beds filled by a seeded scatter.
 *
 *  - Trees: a cedar of Lebanon on the south-east lawn (clear of the porch's view to the Resonator),
 *    a copper beech in the back garden, limes along the south wall, oaks at the east corners, an
 *    orchard of apples in two staggered rows, clipped Irish yews flanking the porch's apron and the
 *    drive's head.
 *  - Beds, tallest at the back: the house's borders (hydrangeas and roses against the house,
 *    lavender along the kerb), the south shrubbery (laurels against the wall, hydrangeas, ferns and
 *    hostas at the front), the back borders (delphiniums and foxgloves at the back, daisies, then
 *    lavender along the walk), the pond garden (hydrangeas, hostas, ferns), the forecourt's island
 *    (roses round the sundial, lavender outside its box ring), the kitchen garden (cabbages and
 *    lettuces in rows in the quarters, flowers for cutting along the walls).
 */
import { FORECOURT, H, KITCHEN, ORCHARD, POND_GARDEN, TERRACE_Y, houseFootprint } from './../layout';
import { inside, polygon, subtract, type Shape, type V2 } from '../sdf2';
import type { Region } from '../regions';
import { SHRUB_SIZE, type ShrubKind } from './shrub';

export interface TreePlace {
  species: 'cedar' | 'copperBeech' | 'lime' | 'oak' | 'apple';
  x: number;
  z: number;
  seed: number;
  scale: number;
}

export interface TopiaryPlace {
  x: number;
  z: number;
  height: number;
}

export interface ShrubPlace {
  kind: ShrubKind;
  x: number;
  y: number;
  z: number;
  seed: number;
  scale: number;
}

export function treePlan(): TreePlace[] {
  const t: TreePlace[] = [
    { species: 'cedar', x: -312, z: -70, seed: 11, scale: 1 },
    { species: 'copperBeech', x: -420, z: -104, seed: 21, scale: 1 },
    { species: 'lime', x: -418.5, z: -47, seed: 31, scale: 0.95 },
    { species: 'lime', x: -392, z: -47.5, seed: 32, scale: 1.05 },
    { species: 'lime', x: -371, z: -46.5, seed: 33, scale: 1 },
    { species: 'lime', x: -351, z: -47.5, seed: 34, scale: 0.92 },
    { species: 'lime', x: -451, z: -112, seed: 35, scale: 0.95 },
    { species: 'lime', x: -322, z: -166.6, seed: 36, scale: 0.85 },
    { species: 'oak', x: -301, z: -160, seed: 42, scale: 0.85 },
  ];
  // The orchard: two staggered rows either side of its mown walk.
  const zs = [ORCHARD.z0 + 6.4, ORCHARD.z1 - 6.4];
  let s = 60;
  zs.forEach((z, row) => {
    for (let x = ORCHARD.x0 + 5 + row * 3.2; x < ORCHARD.x1 - 3.5; x += 6.6) t.push({ species: 'apple', x, z: z + ((s % 3) - 1) * 0.6, seed: s++, scale: 0.9 + (s % 5) * 0.05 });
  });
  return t;
}

export function topiaryPlan(): TopiaryPlace[] {
  const [a, b] = [H(-4.3, 7.6), H(4.3, 7.6)];
  return [
    { x: a[0], z: a[1], height: 3.4 },
    { x: b[0], z: b[1], height: 3.4 },
    { x: -437.8, z: -62.8, height: 3.0 },
    { x: -422.2, z: -62.8, height: 3.0 },
  ];
}

type BedKind = 'house' | 'island' | 'kitchenQuarter' | 'kitchenWall' | 'shrubbery' | 'pond' | 'back';

function bedKind(c: V2): BedKind {
  const [x, z] = c;
  if (Math.hypot(x - FORECOURT.centre[0], z - FORECOURT.centre[1]) < FORECOURT.island + 0.5) return 'island';
  if (x > KITCHEN.x0 && x < KITCHEN.x1 && z > KITCHEN.z0 && z < KITCHEN.z1) {
    const k = KITCHEN;
    const nearWall = x < k.x0 + 2 || x > k.x1 - 2 || z < k.z0 + 2 || z > k.z1 - 2;
    return nearWall ? 'kitchenWall' : 'kitchenQuarter';
  }
  if (Math.abs(x - POND_GARDEN.x) < POND_GARDEN.hx + 1 && Math.abs(z - POND_GARDEN.z) < POND_GARDEN.hz + 1) return 'pond';
  if (houseFootprint.sdf(x, z) < 3) return 'house';
  if (z > -60) return 'shrubbery';
  return 'back';
}

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What grows at a point of a bed, by the bed's kind and how far back from its front the point is (0 front – 1 back). */
function choose(kind: BedKind, back: number, r: () => number): ShrubKind {
  switch (kind) {
    case 'house':
      return back > 0.55 ? (r() < 0.6 ? 'hydrangea' : 'rose') : 'lavender';
    case 'shrubbery':
      return back > 0.55 ? 'laurel' : back > 0.25 ? (r() < 0.6 ? 'hydrangea' : 'laurel') : r() < 0.5 ? 'fern' : 'hosta';
    case 'back':
      return back > 0.6 ? (r() < 0.55 ? 'delphinium' : 'foxglove') : back > 0.3 ? (r() < 0.6 ? 'daisy' : 'rose') : 'lavender';
    case 'pond':
      return back > 0.5 ? 'hydrangea' : r() < 0.55 ? 'hosta' : 'fern';
    case 'island':
      return 'lavender';
    case 'kitchenWall':
      return r() < 0.4 ? 'rose' : r() < 0.6 ? 'delphinium' : 'daisy';
    case 'kitchenQuarter':
      return r() < 0.55 ? 'cabbage' : 'lettuce';
  }
}

/** Fills the beds (soil regions) with plants, tallest at the back, never across a kerb or a path. */
export function shrubPlan(beds: Region[]): ShrubPlace[] {
  const out: ShrubPlace[] = [];
  beds.forEach((bed, bi) => {
    const shape: Shape = subtract(polygon(bed.outer), ...bed.holes.map((h) => polygon(h)));
    let cx = 0;
    let cz = 0;
    for (const [x, z] of bed.outer) {
      cx += x;
      cz += z;
    }
    const centre: V2 = [cx / bed.outer.length, cz / bed.outer.length];
    const kind = bedKind(centre);
    const r = random(1000 + bi * 7919);
    const b = shape.bounds;
    // The bed's depth: its deepest point (the back is where the bed is deepest from its front edge).
    const placed: { x: number; z: number; r: number }[] = [];
    // Kitchen quarters: rows.
    if (kind === 'kitchenQuarter') {
      for (let z = b[1] + 0.35; z < b[3] - 0.3; z += 0.55) {
        for (let x = b[0] + 0.35; x < b[2] - 0.3; x += 0.5) {
          if (!inside(bed.outer, x, z) || shape.sdf(x, z) > -0.25) continue;
          const row = Math.floor((z - b[1]) / 0.55);
          out.push({ kind: row % 3 === 2 ? 'lettuce' : 'cabbage', x: x + (r() - 0.5) * 0.06, y: TERRACE_Y + 0.04, z: z + (r() - 0.5) * 0.06, seed: Math.floor(r() * 1e9), scale: 0.85 + r() * 0.3 });
        }
      }
      return;
    }
    const depth = Math.min(1.6, (b[2] - b[0]) / 2, (b[3] - b[1]) / 2);
    const tries = Math.ceil(((b[2] - b[0]) * (b[3] - b[1])) / 0.08);
    for (let t = 0; t < tries; t++) {
      const x = b[0] + r() * (b[2] - b[0]);
      const z = b[1] + r() * (b[3] - b[1]);
      const d = -shape.sdf(x, z);
      if (d < 0.18) continue;
      // How far back: from the bed's front (the edge away from the house or the wall it backs on).
      let back = Math.min(d / Math.max(depth, 0.5), 1);
      if (kind === 'house') back = 1 - Math.min(Math.max(houseFootprint.sdf(x, z), 0) / 1.5, 1);
      if (kind === 'shrubbery') back = Math.min(Math.max((z + 53.2) / 12, 0), 1);
      if (kind === 'island') {
        const rr = Math.hypot(x - FORECOURT.centre[0], z - FORECOURT.centre[1]);
        if (rr < 0.75) continue;
        // Roses inside the box ring, lavender outside it; nothing on the ring.
        if (Math.abs(rr - (FORECOURT.island - 1.35)) < 0.5) continue;
      }
      let k = choose(kind, back, r);
      if (kind === 'island') {
        const rr = Math.hypot(x - FORECOURT.centre[0], z - FORECOURT.centre[1]);
        k = rr < FORECOURT.island - 1.35 ? 'rose' : 'lavender';
      }
      const size = SHRUB_SIZE[k];
      const scale = 0.8 + r() * 0.35;
      const rad = size.r * scale;
      // Its spread stays inside the bed (behind the kerb), and clear of what is already planted.
      if (d < rad * 0.75 + 0.1) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + rad) * 0.8)) continue;
      placed.push({ x, z, r: rad });
      out.push({ kind: k, x, y: TERRACE_Y + 0.04, z, seed: Math.floor(r() * 1e9), scale });
    }
  });
  return out;
}
