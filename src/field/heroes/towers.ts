/**
 * The field's mega-towers (docs/field.md): three clusters of bundled, ribbed gold towers as tall
 * as the Dome allows where they stand, each with a working purpose:
 *
 *  - the Stills (north): the cryogen distillation columns, five towers;
 *  - the Converter (east, behind the Gyre): power conversion, the shell's supply stepped down
 *    for the compound, four towers;
 *  - the Reckoner (south-west): the compound's computation, cryogen-cooled, three towers.
 *
 * Heights are solved per tower: its needle stays GLASS_CLEARANCE under the glass.
 */
import { FIELD_SLOT } from '../materials/materials';
import { Parts, rng } from '../kit/parts';
import { buildCluster, towerAxis, towerRadius, towerTop, type ClusterSpec, type TowerSpec } from '../kit/tower';
import { CONVERTER, FIELD_Y, GLASS_CLEARANCE, RECKONER, STILLS, glassHeightAt } from '../layout';

interface ClusterPlan {
  name: string;
  x: number;
  z: number;
  podiumR: number;
  podiumTop: number;
  seed: number;
  /** Central tower: foot radius and lobes. */
  core: { r0: number; lobes: number };
  /** Satellites: count, ring radius about the centre, foot radius range, height fraction range. */
  sat: { n: number; at: number; r0: [number, number]; h: [number, number]; lobes: number };
  rings: { h: number; R: number; slot: number; gallery?: boolean }[];
}

/** Tallest a tower's shell may be at a foot (x, z) leaning by `lean`, under the glass. */
function solveHeight(x: number, z: number, y0: number, lean: [number, number], want: number): number {
  let h = want;
  for (let i = 0; i < 30; i++) {
    const s: TowerSpec = { name: '', x, z, y0, height: h, lean, r0: 1, lobes: 3, lobeDepth: 0, ribs: 1, phase: 0 };
    const tipR = Math.hypot(x + lean[0], z + lean[1]) + 3;
    const room = glassHeightAt(tipR) - GLASS_CLEARANCE - (y0 - FIELD_Y);
    if (towerTop(s) <= room) return h;
    h *= room / towerTop(s) - 0.002;
  }
  return h;
}

/** Do two towers' envelopes keep `gap` apart at every height? */
function clearOf(a: TowerSpec, b: TowerSpec, gap: number): boolean {
  const top = Math.min(a.height, b.height) + 6;
  for (let y = 0; y <= top; y += 1.5) {
    const pa = towerAxis(a, Math.min(1, y / a.height));
    const pb = towerAxis(b, Math.min(1, y / b.height));
    const ra = y > a.height ? 0 : towerRadius(a, y / a.height);
    const rb = y > b.height ? 0 : towerRadius(b, y / b.height);
    if (Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) - ra - rb < gap) return false;
  }
  return true;
}

function plan(p: ClusterPlan): ClusterSpec {
  const rand = rng(p.seed);
  const y0 = FIELD_Y + p.podiumTop;
  const towers: TowerSpec[] = [];
  const h0 = solveHeight(p.x, p.z, y0, [0, 0], 240);
  towers.push({ name: 't0', x: p.x, z: p.z, y0, height: h0, lean: [0, 0], r0: p.core.r0, lobes: p.core.lobes, lobeDepth: 0.16, ribs: 7, phase: rand() * Math.PI });
  for (let k = 0; k < p.sat.n; k++) {
    const a = (2 * Math.PI * k) / p.sat.n + rand() * 0.5;
    const d = p.sat.at * (0.9 + rand() * 0.2);
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const want = h0 * (p.sat.h[0] + rand() * (p.sat.h[1] - p.sat.h[0]));
    const r0 = p.sat.r0[0] + rand() * (p.sat.r0[1] - p.sat.r0[0]);
    const phase = rand() * Math.PI;
    // Satellites lean in toward the centre, converging on the tallest, as far as stays clear of it.
    let tower: TowerSpec | null = null;
    for (let f = 0.24; f >= 0; f -= 0.02) {
      const lean: [number, number] = [-Math.cos(a) * d * f, -Math.sin(a) * d * f];
      const height = solveHeight(x, z, y0, lean, want);
      const s: TowerSpec = { name: `t${k + 1}`, x, z, y0, height, lean, r0, lobes: p.sat.lobes, lobeDepth: 0.14, ribs: 6, phase };
      if (clearOf(s, towers[0], 1.5)) {
        tower = s;
        break;
      }
    }
    if (tower) towers.push(tower);
  }
  return {
    name: p.name,
    x: p.x,
    z: p.z,
    podiumR: p.podiumR,
    podiumTop: p.podiumTop,
    towers,
    rings: p.rings.map((r) => ({ h: r.h * h0, R: r.R, hr: 0.9, ha: 1.1, slot: r.slot, gallery: r.gallery })),
    buttresses: 3,
  };
}

export function clusterPlans(): ClusterSpec[] {
  return [
    plan({
      name: 'stills',
      ...STILLS,
      seed: 911,
      core: { r0: 15, lobes: 3 },
      sat: { n: 4, at: 36, r0: [8.5, 10.5], h: [0.55, 0.8], lobes: 3 },
      rings: [
        { h: 0.3, R: 54, slot: FIELD_SLOT.ceramic, gallery: true },
        { h: 0.5, R: 44, slot: FIELD_SLOT.gold },
        { h: 0.68, R: 30, slot: FIELD_SLOT.chrome },
      ],
    }),
    plan({
      name: 'converter',
      ...CONVERTER,
      seed: 4127,
      core: { r0: 12.5, lobes: 4 },
      sat: { n: 3, at: 31, r0: [8, 9.5], h: [0.5, 0.75], lobes: 4 },
      rings: [
        { h: 0.34, R: 46, slot: FIELD_SLOT.gold, gallery: true },
        { h: 0.56, R: 36, slot: FIELD_SLOT.ceramic },
      ],
    }),
    plan({
      name: 'reckoner',
      ...RECKONER,
      seed: 6020,
      core: { r0: 13.5, lobes: 5 },
      sat: { n: 2, at: 33, r0: [9, 10], h: [0.62, 0.82], lobes: 5 },
      rings: [
        { h: 0.28, R: 50, slot: FIELD_SLOT.ceramic, gallery: true },
        { h: 0.47, R: 40, slot: FIELD_SLOT.chrome },
        { h: 0.64, R: 28, slot: FIELD_SLOT.gold },
      ],
    }),
  ];
}

export function buildTowers(zone: string, spec: ClusterSpec): Parts {
  const parts = new Parts(zone);
  buildCluster(parts, spec);
  return parts;
}

export { towerRadius };
