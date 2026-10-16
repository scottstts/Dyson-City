/**
 * The gateway on the Gate Court (city_plan §4; layout.ts GATEWAY): two tall gate piers carrying
 * urns stand on the wall line; between them the drive's ramp rises in a cutting to the terrace, and
 * a flight of ten limestone steps rises beside it on each side to a landing at terrace level.
 *
 *  - The cutting walls retain the landings from the ramp; their copings are level with the
 *    terrace's, their feet follow the ramp. A balustrade runs along each, piers at both ends.
 *  - Cheek walls retain the lawn from the flights' outer sides, with a short balustrade from each
 *    gate pier back to the flight's head.
 *
 * Coordinates: the gateway faces south; u runs north from the wall line (u = −(z − south)).
 */
import { PolyMesh, type Vec2 } from '../geometry/polyMesh';
import { box as boxSolid, extrudeBevel, lathe, WORLD, type Basis } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { PAD_HEIGHT } from '../ground/site';
import { GATEWAY, TERRACE_Y } from './layout';
import { upright } from './kit';
import { addBalustrade, BALUSTRADE, type BalustradeOut, type Station } from './terraceWall';
import { ESTATE_SLOT } from './materials/materials';
import type { V2 } from './sdf2';

const T = TERRACE_Y;
const S = ESTATE_SLOT;
const G = GATEWAY;

/** The flights' top tread runs on past the last riser to the cheeks' heads (m). */
export const HEAD = 0.6;

/** Gate pier: plinth, rusticated shaft, moulded cornice; its top height above the pad. */
export const GATE_PIER = { plinth: 0.55, shaftTop: 3.05, cornice: 0.28, urn: 1.05 } as const;

/** A box from (x0, y0, z0) to (x1, y1, z1), bevelled. */
function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bevel: number, slot: number): PolyMesh {
  return boxSolid({ ...WORLD, o: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] }, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bevel, slot);
}

/** A garden urn on a square base: foot, stem, a gadroon-less bowl, rim and a pinecone finial. */
export function urnMesh(scale = 1): PolyMesh {
  const m = new PolyMesh(40);
  m.append(boxSolid({ ...WORLD, o: [0, 0.06 * scale, 0] }, 0.24 * scale, 0.06 * scale, 0.24 * scale, 0.01, S.limestone));
  const k = scale;
  const prof: Vec2[] = [
    [0, 0.12],
    [0.2, 0.12],
    [0.2, 0.15],
    [0.16, 0.18],
    [0.1, 0.22],
    [0.085, 0.3],
    [0.12, 0.34],
    [0.24, 0.4],
    [0.33, 0.5],
    [0.37, 0.6],
    [0.36, 0.7],
    [0.33, 0.76],
    [0.36, 0.79],
    [0.37, 0.82],
    [0.3, 0.83],
    [0.27, 0.86],
    [0.22, 0.9],
    [0.14, 0.92],
    [0.08, 0.94],
    [0.07, 0.97],
    [0.09, 1.0],
    [0.07, 1.04],
    [0, 1.06],
  ].map(([r, y]) => [r * k, y * k] as Vec2);
  m.append(lathe(prof, 28, upright(), S.limestone, 40));
  return m;
}

export interface Gateway {
  parts: Parts;
  out: BalustradeOut;
  proxies: PolyMesh[];
  /** Gate pier centres (plan). */
  piers: V2[];
}

export function buildGateway(): Gateway {
  const parts = new Parts('estate:gateway');
  const out: BalustradeOut = { balusters: [], piers: [], finials: [], proxies: [] };
  const z0 = G.z;
  const y0 = PAD_HEIGHT - 0.05;
  const coping = T + BALUSTRADE.copingTop;
  const steps = G.steps;
  const run = steps.count * steps.tread;

  // Gate piers.
  const piers: V2[] = [];
  for (const [name, xc] of [['w', G.x0 - G.pier / 2], ['e', G.x1 + G.pier / 2]] as const) {
    piers.push([xc, z0]);
    const h = G.pier / 2;
    const p = new PolyMesh(35);
    // The plinth's footing goes deeper than the walls' (no shared bottom face).
    p.append(block(xc - h - 0.1, y0 - 0.06, z0 - h - 0.1, xc + h + 0.1, PAD_HEIGHT + GATE_PIER.plinth, z0 + h + 0.1, 0.02, S.sandstone));
    p.append(block(xc - h, PAD_HEIGHT + GATE_PIER.plinth, z0 - h, xc + h, PAD_HEIGHT + GATE_PIER.shaftTop, z0 + h, 0.015, S.sandstone));
    // Cornice: a projecting moulded cap in two stepped courses.
    p.append(block(xc - h - 0.06, PAD_HEIGHT + GATE_PIER.shaftTop, z0 - h - 0.06, xc + h + 0.06, PAD_HEIGHT + GATE_PIER.shaftTop + 0.1, z0 + h + 0.06, 0.02, S.limestone));
    p.append(block(xc - h - 0.12, PAD_HEIGHT + GATE_PIER.shaftTop + 0.1, z0 - h - 0.12, xc + h + 0.12, PAD_HEIGHT + GATE_PIER.shaftTop + GATE_PIER.cornice, z0 + h + 0.12, 0.03, S.limestone));
    parts.addSet(`pier:${name}`, p);
    const urn = urnMesh(1.15).transform(([x, y, z]) => [x + xc, y + PAD_HEIGHT + GATE_PIER.shaftTop + GATE_PIER.cornice, z + z0]);
    parts.addSet(`urn:${name}`, urn);
  }

  // Ramp cutting walls: (u, y) outline extruded across x.
  const rampLen = G.ramp.z0 - G.ramp.z1;
  const cutOutline: Vec2[] = [
    [0, y0],
    [rampLen, T - 0.05],
    [rampLen, coping],
    [0, coping],
  ];
  const basis = (x: number): Basis => ({ o: [x, 0, z0], u: [0, 0, -1], v: [0, 1, 0], w: [1, 0, 0] });
  for (const [name, xa, xb] of [['w', G.ramp.x0 - G.cut, G.ramp.x0], ['e', G.ramp.x1, G.ramp.x1 + G.cut]] as const) {
    parts.add(`cut:${name}`, extrudeBevel(cutOutline, basis(0), xa, xb, 0.012, S.sandstone, S.limestone));
  }
  // Flights: ten risers rising north from the wall line, the top tread level with the landing.
  const stair: Vec2[] = [[0, y0]];
  for (let k = 0; k < steps.count; k++) {
    // The top tread is a landing step running to the cheeks' heads.
    const end = k === steps.count - 1 ? run + HEAD : (k + 1) * steps.tread;
    stair.push([k * steps.tread, PAD_HEIGHT + (k + 1) * steps.rise], [end, PAD_HEIGHT + (k + 1) * steps.rise]);
  }
  stair.push([run + HEAD, y0]);
  for (const [name, xa, xb] of [['w', G.x0, G.ramp.x0 - G.cut], ['e', G.ramp.x1 + G.cut, G.x1]] as const) {
    parts.add(`flight:${name}`, extrudeBevel(stair, basis(0), xa, xb, 0.008, S.limestone));
  }
  // Cheek walls on the flights' outer sides, from the pier to the flight's head.
  const cheekLen = run + HEAD;
  const cheek: Vec2[] = [
    [G.pier / 2 - 0.02, y0],
    [cheekLen, y0],
    [cheekLen, coping],
    [G.pier / 2 - 0.02, coping],
  ];
  for (const [name, xa, xb] of [['w', G.x0 - 0.45, G.x0], ['e', G.x1, G.x1 + 0.45]] as const) {
    parts.add(`cheek:${name}`, extrudeBevel(cheek, basis(0), xa, xb, 0.012, S.sandstone, S.limestone));
  }

  // Balustrades: along each cutting wall (ramp foot to head) and each cheek (gate pier to the flight's head).
  const zAt = (u: number) => z0 - u;
  for (const [name, x] of [['cut-w', G.ramp.x0 - G.cut / 2], ['cut-e', G.ramp.x1 + G.cut / 2]] as const) {
    const st: Station[] = [];
    const n = Math.round((rampLen - 0.4) / BALUSTRADE.bay);
    for (let i = 0; i <= n; i++) st.push({ p: [x, zAt(0.3 + ((rampLen - 0.6) * i) / n)], kind: i === 0 || i === n ? 'finial' : 'pier' });
    addBalustrade(parts, `bal:${name}`, st, coping, out);
  }
  for (const [name, x] of [['cheek-w', G.x0 - 0.225], ['cheek-e', G.x1 + 0.225]] as const) {
    // From inside the gate pier (the rails butt into it) to a finial pier at the flight's head.
    const st: Station[] = [
      { p: [x, zAt(G.pier / 2 - BALUSTRADE.pierShaft)], kind: 'none' },
      { p: [x, zAt(cheekLen - 0.3)], kind: 'finial' },
    ];
    addBalustrade(parts, `bal:${name}`, st, coping, out);
  }

  // Walk proxies: the piers as blocks.
  const proxies = piers.map(([x, z]) => block(x - G.pier / 2, y0, z - G.pier / 2, x + G.pier / 2, PAD_HEIGHT + GATE_PIER.shaftTop, z + G.pier / 2, 0, 0));
  return { parts, out, proxies, piers };
}
