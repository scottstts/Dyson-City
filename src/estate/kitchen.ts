/**
 * The walled kitchen garden (city_plan §4: "a kitchen garden"; docs/estate.md): old red brick walls
 * 2.4 m high in Flemish bond under a limestone coping, buttressed by piers, with two gateways (south,
 * toward the house; east, from the service walk) between stone-capped piers carrying ball finials.
 * Its beds are the ground's soil regions (layout.ts KITCHEN_BEDS); the glasshouse stands against
 * the north wall (glasshouse.ts).
 */
import { PolyMesh, type Vec2 } from '../geometry/polyMesh';
import { box as boxSolid, lathe, WORLD } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { KITCHEN, TERRACE_Y } from './layout';
import { runSweep, pathLength, pointsAlong, upright } from './kit';
import { ESTATE_SLOT } from './materials/materials';
import type { V2 } from './sdf2';

const T = TERRACE_Y;
const S = ESTATE_SLOT;

export const KITCHEN_WALL = { height: 2.4, coping: 0.1, gate: 1.1, pier: 0.56, gatePier: 0.62, bay: 3.6 } as const;

/** The wall's runs (outer faces' centreline offset in by half the wall), split at the gateways. */
export function kitchenRuns(): V2[][] {
  const k = KITCHEN;
  const h = k.wall / 2;
  const x0 = k.x0 + h, x1 = k.x1 - h, z0 = k.z0 + h, z1 = k.z1 - h;
  const g = KITCHEN_WALL.gate + KITCHEN_WALL.gatePier;
  // Anticlockwise from the south gateway's east side: south (east part), east up to the gate, east (north part), north, west, south (west part).
  return [
    [[k.gateS + g, z1], [x1, z1], [x1, k.gateE + g]],
    [[x1, k.gateE - g], [x1, z0], [x0, z0], [x0, z1], [k.gateS - g, z1]],
  ];
}

function wallProfile(): { pts: Vec2[]; slots: number[] } {
  const w = KITCHEN.wall / 2;
  const top = T + KITCHEN_WALL.height;
  const c = KITCHEN_WALL.coping;
  // Brick body with a plinth (one brick proud), a stone coping with drips both sides and a ridge.
  const pts: Vec2[] = [
    [-w - 0.06, T - 0.15],
    [w + 0.06, T - 0.15],
    [w + 0.06, T + 0.3],
    [w, T + 0.36],
    [w, top - c],
    [w + 0.05, top - c],
    [w + 0.05, top - c + 0.05],
    [w * 0.35, top],
    [-w * 0.35, top],
    [-w - 0.05, top - c + 0.05],
    [-w - 0.05, top - c],
    [-w, top - c],
    [-w, T + 0.36],
    [-w - 0.06, T + 0.3],
  ];
  const slots = pts.map((_, i) => (i >= 4 && i <= 10 ? S.limestone : S.brick));
  return { pts, slots };
}

export function buildKitchenGarden(): { parts: Parts; proxies: PolyMesh[] } {
  const parts = new Parts('estate:kitchen');
  const prof = wallProfile();
  const kw = KITCHEN_WALL;
  kitchenRuns().forEach((run, i) => {
    parts.add(`wall:${i}`, runSweep(run, prof, { slot: S.brick, capSlot: S.brick }));
    // Buttress piers along the outer faces, between the corners.
    const len = pathLength(run);
    const n = Math.max(1, Math.round(len / kw.bay));
    const stations = pointsAlong(run, Array.from({ length: n - 1 }, (_, k) => ((k + 1) * len) / n));
    stations.forEach(({ p, d }, k) => {
      // Outward: the left of travel.
      const ox = -d[1], oz = d[0];
      const off = KITCHEN.wall / 2 + 0.1;
      // From below the wall's footing (no shared bottom) to under its coping.
      const yb = T - 0.2;
      const yt = T + kw.height - kw.coping - 0.02;
      const m = boxSolid({ o: [p[0] + ox * off, (yb + yt) / 2, p[1] + oz * off], u: [d[0], 0, d[1]], v: [0, 1, 0], w: [ox, 0, oz] }, kw.pier / 2, (yt - yb) / 2, 0.2, 0.01, S.brick);
      parts.add(`pier:${i}:${k}`, m);
    });
  });
  // Gateways: brick piers with stone caps and ball finials.
  const k = KITCHEN;
  const gates: [string, V2, V2][] = [
    ['s', [k.gateS, k.z1 - k.wall / 2], [1, 0]],
    ['e', [k.x1 - k.wall / 2, k.gateE], [0, 1]],
  ];
  for (const [name, [cx, cz], [ax, az]] of gates) {
    for (const s of [-1, 1]) {
      const off = kw.gate + kw.gatePier / 2;
      const x = cx + ax * off * s;
      const z = cz + az * off * s;
      const p = new PolyMesh(35);
      const hp = kw.gatePier / 2;
      p.append(boxSolid({ ...WORLD, o: [x, T + (kw.height + 0.2) / 2 - 0.08, z] }, hp, (kw.height + 0.2) / 2 + 0.08, hp, 0.01, S.brick));
      p.append(boxSolid({ ...WORLD, o: [x, T + kw.height + 0.2 + 0.05, z] }, hp + 0.06, 0.05, hp + 0.06, 0.012, S.limestone));
      const ball: Vec2[] = [[0, 0], [0.12, 0], [0.12, 0.03], [0.07, 0.06], [0.06, 0.1]];
      const r = 0.15;
      const c = 0.1 + r * 0.95;
      for (let i = 1; i < 12; i++) {
        const a = -Math.PI / 2 + Math.asin(0.06 / r) + (i / 12) * (Math.PI - Math.asin(0.06 / r));
        ball.push([Math.cos(a) * r, c + Math.sin(a) * r]);
      }
      ball.push([0, c + r]);
      p.append(lathe(ball, 20, upright([x, T + kw.height + 0.3, z]), S.limestone, 40));
      parts.addSet(`gatepier:${name}:${s > 0 ? 'b' : 'a'}`, p);
    }
  }
  return { parts, proxies: [] };
}
