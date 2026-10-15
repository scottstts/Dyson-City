/**
 * The radiator forest (docs/field.md), either side of the cold plant in the south: heat-rejection
 * spires. Their cores are cut into deep flutes (the radiating fins), their rings are the coolant
 * headers fed by spoke pipes. Ranks of varied height and girth, as a plant grows, stepping down
 * toward the glass.
 *
 * Every spire stays at least GLASS_CLEARANCE under the Dome's glass at its reach.
 */
import { FIELD_SLOT } from '../materials/materials';
import { Parts, rng } from '../kit/parts';
import { buildSpire, type SpireSpec } from '../kit/spire';
import { FIELD_Y, GLASS_CLEARANCE, PLANT, distToViaduct, glassHeightAt, onRoad } from '../layout';

/** Tallest a spire may stand whose outer reach is at plan radius r. */
export function heightLimit(r: number, base = 0): number {
  // The finial adds 6 % (at least 3 m) above the core (kit/spire.ts).
  const room = glassHeightAt(r) - GLASS_CLEARANCE - base;
  return Math.min(room / 1.06, room - 3);
}

/**
 * The radiator spires' layout: staggered ranks across each region of the heat precinct (a planted
 * forest, not a scatter), stepping down in height toward the drum as the glass comes down; each
 * spire's girth and height wander a little about its rank's.
 */
export function radiatorLayout(): SpireSpec[] {
  const rand = rng(2203);
  const out: SpireSpec[] = [];
  const pitch = { x: 21, z: 19 };
  PLANT.regions.forEach((reg, bi) => {
    for (let row = 0, z = reg.z0 + 11; z < reg.z1 - 9; row++, z += pitch.z) {
      for (let x = reg.x0 + 11 + (row % 2) * pitch.x * 0.5; x < reg.x1 - 9; x += pitch.x) {
      const r0 = 1.5 + rand() * 0.9;
      const ringR = r0 * (3.3 + rand() * 0.6);
      const reach = Math.max(ringR + 0.6, r0 * 4.2);
      const rPlan = Math.hypot(x, z) + reach;
      if (rPlan > PLAN_LIMIT) continue;
      if (onRoad(x, z, reach + 3) || distToViaduct(x, z) < reach + 6) continue;
      const limit = heightLimit(rPlan);
      if (limit < 30) continue;
      const height = Math.min(limit, (62 - (z - reg.z0) * 0.12) * (0.9 + rand() * 0.2));
      if (height < 28) continue;
      const k = out.length;
      const rings: SpireSpec['rings'] = [];
      const nRings = 2 + Math.floor(rand() * 2.5);
      for (let j = 0; j < nRings; j++) {
        const h = height * (0.28 + 0.55 * (j / Math.max(1, nRings - 1))) * (0.92 + rand() * 0.12);
        const R = ringR * (1 - 0.25 * (h / height));
        rings.push({ h, R, hr: 0.14 + r0 * 0.04, ha: 0.18 + r0 * 0.05, slot: j % 2 ? FIELD_SLOT.chrome : FIELD_SLOT.gold, spokes: 4 + (j % 2) });
      }
      out.push({
        name: `sp-rad${bi}-${k}`,
        x,
        z,
        y0: FIELD_Y,
        height,
        r0,
        r1: r0 * 0.28,
        entasis: 0.05,
        flutes: 14 + Math.floor(rand() * 6),
        fluteDepth: 0.22,
        fins: 4 + Math.floor(rand() * 2),
        finReach: r0 * 4.2,
        finHeight: height * (0.24 + rand() * 0.08),
        phase: rand() * Math.PI,
        rings,
      });
      }
    }
  });
  return out;
}

/** Plan radius the radiator forest keeps inside (it stays off the drum). */
const PLAN_LIMIT = PLANT.rMax;


export function buildRadiators(): Parts {
  const parts = new Parts('rad');
  for (const s of radiatorLayout()) buildSpire(parts, s);
  return parts;
}

