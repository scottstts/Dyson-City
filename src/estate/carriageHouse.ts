/**
 * The carriage house (city_plan §4: "beside the drive is where the car lives"; docs/estate.md):
 * built in the house's language: a sandstone base, pale-blue clapboard with cream corner boards and
 * trims, a steep slate roof (45°) with its ridge north–south, a louvred cupola with a copper
 * weathervane. Two pairs of panelled carriage doors face the yard (east) under transoms, with a hay
 * loft gablet between them above; small windows in the other walls, an oculus in each gable.
 *
 * Windows show an unlit interior: dark glass in the casings. The doors are shut until the car
 * (step 4) needs them.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { box as boxSolid, extrudeBevel, lathe, WORLD, type Basis } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { CARRIAGE_HOUSE, TERRACE_Y } from './layout';
import { runSweep, upright } from './kit';
import { member } from './glasshouse';
import { ESTATE_SLOT } from './materials/materials';

const T = TERRACE_Y;
const S = ESTATE_SLOT;
const C = CARRIAGE_HOUSE;

export const CARRIAGE = { base: 0.5, eaves: 3.7, pitch: Math.PI / 4, overhang: 0.42, roof: 0.16 } as const;

function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bevel: number, slot: number): PolyMesh {
  return boxSolid({ ...WORLD, o: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] }, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bevel, slot);
}

/** A window on a wall face: casing, sill, head, glazing bars and a dark pane (all proud of the face). */
function windowOn(out: PolyMesh, panes: PolyMesh, c: Vec3, face: Vec3, w: number, h: number): void {
  const n = face;
  const across: Vec3 = [-n[2], 0, n[0]];
  const at = (u: number, v: number, d: number): Vec3 => [c[0] + across[0] * u + n[0] * d, c[1] + v, c[2] + across[2] * u + n[2] * d];
  const cw = 0.09;
  out.append(member(at(-w / 2 - cw / 2, -h / 2, 0.025), at(-w / 2 - cw / 2, h / 2, 0.025), cw, 0.05, S.paint, n));
  out.append(member(at(w / 2 + cw / 2, -h / 2, 0.025), at(w / 2 + cw / 2, h / 2, 0.025), cw, 0.05, S.paint, n));
  out.append(member(at(-w / 2 - cw - 0.05, h / 2 + 0.06, 0.035), at(w / 2 + cw + 0.05, h / 2 + 0.06, 0.035), 0.12, 0.07, S.paint, n));
  out.append(member(at(-w / 2 - cw - 0.04, -h / 2 - 0.04, 0.05), at(w / 2 + cw + 0.04, -h / 2 - 0.04, 0.05), 0.08, 0.1, S.paint, [0, 1, 0]));
  // Glazing bars: a six-light sash.
  out.append(member(at(0, -h / 2, 0.012), at(0, h / 2, 0.012), 0.03, 0.025, S.paint, n));
  for (const v of [-h / 6, h / 6]) out.append(member(at(-w / 2, v, 0.012), at(w / 2, v, 0.012), 0.03, 0.025, S.paint, n));
  const a = panes.vert(at(-w / 2, -h / 2, 0.006));
  const b = panes.vert(at(w / 2, -h / 2, 0.006));
  const cc = panes.vert(at(w / 2, h / 2, 0.006));
  const d = panes.vert(at(-w / 2, h / 2, 0.006));
  panes.face([a, b, cc, d], 0);
}

/** A pair of panelled carriage doors (shut) on the east face at z = zc. */
function carriageDoors(out: PolyMesh, panes: PolyMesh, x: number, zc: number, w: number, h: number): void {
  const n: Vec3 = [1, 0, 0];
  const y0 = T + 0.02;
  // Frame: posts and a head beam, a transom of four lights above.
  out.append(member([x + 0.04, y0, zc - w / 2 - 0.08], [x + 0.04, y0 + h + 0.55, zc - w / 2 - 0.08], 0.16, 0.08, S.paint, n));
  out.append(member([x + 0.04, y0, zc + w / 2 + 0.08], [x + 0.04, y0 + h + 0.55, zc + w / 2 + 0.08], 0.16, 0.08, S.paint, n));
  // Head beams bed 5 mm into the wall (the posts stand on its face).
  out.append(member([x + 0.045, y0 + h + 0.04, zc - w / 2 - 0.19], [x + 0.045, y0 + h + 0.04, zc + w / 2 + 0.19], 0.12, 0.1, S.paint, n));
  out.append(member([x + 0.055, y0 + h + 0.6, zc - w / 2 - 0.2], [x + 0.055, y0 + h + 0.6, zc + w / 2 + 0.2], 0.14, 0.12, S.paint, n));
  for (let k = 1; k < 4; k++) {
    const z = zc - w / 2 + (k * w) / 4;
    out.append(member([x + 0.03, y0 + h + 0.1, z], [x + 0.03, y0 + h + 0.53, z], 0.04, 0.04, S.paint, n));
  }
  const a = panes.vert([x + 0.012, y0 + h + 0.1, zc + w / 2]);
  const b = panes.vert([x + 0.012, y0 + h + 0.1, zc - w / 2]);
  const c = panes.vert([x + 0.012, y0 + h + 0.53, zc - w / 2]);
  const d = panes.vert([x + 0.012, y0 + h + 0.53, zc + w / 2]);
  panes.face([a, b, c, d], 0);
  // Leaves: boarded panels within stiles and rails, a diagonal brace in each lower panel.
  for (const [za, zb] of [[zc - w / 2, zc - 0.005], [zc + 0.005, zc + w / 2]]) {
    out.append(block(x, y0, za, x + 0.05, y0 + h, zb, 0.008, S.green));
    const zm = (za + zb) / 2;
    // Stiles, rails and brace bed 1 cm into the boarding at different depths, so no two share a face.
    for (const dz of [-(zb - za) / 2 + 0.07, (zb - za) / 2 - 0.07]) out.append(member([x + 0.065, y0 + 0.02, zm + dz], [x + 0.065, y0 + h - 0.02, zm + dz], 0.12, 0.05, S.green, n));
    // Rails stand a few millimetres less proud than the stiles, the brace less again (no shared faces).
    for (const y of [y0 + 0.12, y0 + h * 0.52, y0 + h - 0.12]) out.append(member([x + 0.0635, y, za + 0.13], [x + 0.0635, y, zb - 0.13], 0.16, 0.043, S.green, n));
    const lo = y0 + 0.2;
    const hi = y0 + h * 0.52 - 0.08;
    out.append(member([x + 0.062, lo, za + 0.15], [x + 0.062, hi, zb - 0.15], 0.1, 0.036, S.green, n));
  }
}

export function buildCarriageHouse(): { parts: Parts; panes: PolyMesh; proxies: PolyMesh[] } {
  const parts = new Parts('estate:carriage');
  const panes = new PolyMesh(20);
  const cb = CARRIAGE;
  const x0 = C.x - C.hx, x1 = C.x + C.hx, z0 = C.z - C.hz, z1 = C.z + C.hz;
  const yE = T + cb.eaves;
  const rise = Math.tan(cb.pitch) * C.hx;
  const yR = yE + rise;

  // Base (sandstone) and walls (clapboard) up to the eaves; the gables above.
  parts.add('base', block(x0 - 0.06, T - 0.15, z0 - 0.06, x1 + 0.06, T + cb.base, z1 + 0.06, 0.012, S.sandstone));
  parts.add('walls', block(x0, T + cb.base - 0.02, z0, x1, yE, z1, 0.004, S.siding));
  const gableOutline: Vec2[] = [
    [-C.hx, 0],
    [C.hx, 0],
    [0, rise - 0.05],
  ];
  for (const [name, z, s] of [['n', z0, -1], ['s', z1, 1]] as const) {
    const b: Basis = { o: [C.x, yE - 0.004, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
    parts.add(`gable:${name}`, extrudeBevel(gableOutline, b, s > 0 ? -0.2 : 0, s > 0 ? 0 : 0.2, 0.004, S.siding));
  }
  // Corner boards.
  const corners = new PolyMesh(35);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) corners.append(block(x - 0.07, T + cb.base, z - 0.07, x + 0.07, yE - 0.02, z + 0.07, 0.008, S.paint));
  parts.addSet('corners', corners);

  // Roof: one sweep of the V section (slate above, painted soffit and fascia) along the ridge.
  const ov = cb.overhang;
  const t = cb.roof;
  const dy = Math.tan(cb.pitch);
  const eY = yE - ov * dy;
  const sec: Vec2[] = [
    [-C.hx - ov, eY - 0.18],
    [-C.hx - ov + 0.04, eY - 0.18],
    [0, yR - 0.18 / Math.cos(cb.pitch) + 0.02],
    [C.hx + ov - 0.04, eY - 0.18],
    [C.hx + ov, eY - 0.18],
    [C.hx + ov, eY - 0.18 + 0.2],
    [0, yR + t / Math.cos(cb.pitch) - 0.02],
    [-C.hx - ov, eY - 0.18 + 0.2],
  ];
  const slots = [S.paint, S.paint, S.paint, S.paint, S.paint, S.slate, S.slate, S.paint];
  // Travel north (−z): the section's b (left of travel) is +x.
  parts.add('roof', runSweep([[C.x, z1 + ov * 0.85], [C.x, z0 - ov * 0.85]], { pts: sec.map(([b, y]) => [b, y] as Vec2), slots }, { slot: S.paint, capSlot: S.paint }));
  // Ridge roll (lead).
  parts.add('ridge', member([C.x, yR + 0.11, z1 + ov * 0.85 + 0.02], [C.x, yR + 0.11, z0 - ov * 0.85 - 0.02], 0.12, 0.08, S.lead));

  // Cupola: a louvred box on the ridge with a pyramid cap and a weathervane.
  const cup = new PolyMesh(35);
  const ch = 0.62;
  cup.append(block(C.x - ch, yR - 0.4, C.z - ch, C.x + ch, yR + 0.75, C.z + ch, 0.01, S.paint));
  for (let k = 0; k < 7; k++) {
    const y = yR + 0.15 + k * 0.08;
    for (const s of [-1, 1]) {
      cup.append(member([C.x + s * (ch + 0.02), y, C.z - ch + 0.08], [C.x + s * (ch + 0.02), y, C.z + ch - 0.08], 0.06, 0.012, S.paint, [s, 1, 0]));
      cup.append(member([C.x - ch + 0.08, y, C.z + s * (ch + 0.02)], [C.x + ch - 0.08, y, C.z + s * (ch + 0.02)], 0.06, 0.012, S.paint, [0, 1, s]));
    }
  }
  parts.addSet('cupola', cup);
  const capProf: Vec2[] = [[0, 0], [ch + 0.15, 0], [ch + 0.15, 0.06], [0.06, 0.62], [0, 0.66]];
  parts.add('cupola-cap', lathe(capProf, 4, upright([C.x, yR + 0.75, C.z]), S.copper, 30, Math.PI / 4));
  const vane = new PolyMesh(35);
  vane.append(member([C.x, yR + 1.38, C.z], [C.x, yR + 2.2, C.z], 0.022, 0.022, S.copper, [1, 0, 0]));
  vane.append(member([C.x, yR + 1.75, C.z - 0.3], [C.x, yR + 1.75, C.z + 0.3], 0.012, 0.012, S.copper));
  vane.append(member([C.x - 0.3, yR + 1.75, C.z], [C.x + 0.3, yR + 1.75, C.z], 0.012, 0.012, S.copper));
  vane.append(member([C.x - 0.42, yR + 2.05, C.z], [C.x + 0.38, yR + 2.05, C.z], 0.01, 0.16, S.copper, [0, 0, 1]));
  parts.addSet('vane', vane);

  // East (yard) front: two pairs of carriage doors, the hay loft gablet's door above between them.
  const front = new PolyMesh(35);
  carriageDoors(front, panes, x1, C.z - 3.05, 2.7, 2.6);
  carriageDoors(front, panes, x1, C.z + 3.05, 2.7, 2.6);
  parts.addSet('doors', front);
  const loft: Vec2[] = [
    [-1.1, 0],
    [1.1, 0],
    [1.1, 0.9],
    [0, 2.0],
    [-1.1, 0.9],
  ];
  // Gablet: a small gable face standing proud of the roof over the doors' middle.
  parts.add('gablet', extrudeBevel(loft, { o: [x1 - 0.004, yE - 0.12, C.z], u: [0, 0, -1], v: [0, 1, 0], w: [1, 0, 0] }, -1.3, 0.04, 0.006, S.siding));
  const gr = new PolyMesh(35);
  const gy = yE - 0.12;
  // Its own small roof: two slate planes under a ridge, from the gable face back into the main roof.
  for (const s of [-1, 1]) gr.append(member([x1 + 0.12, gy + 0.9 + 0.55, C.z + s * 0.6], [x1 - 1.4, gy + 0.9 + 0.55, C.z + s * 0.6], 1.45, 0.08, S.slate, [0, Math.cos(Math.PI / 4), s * Math.sin(Math.PI / 4)]));
  parts.addSet('gablet-roof', gr);
  const hay = new PolyMesh(35);
  windowOn(hay, panes, [x1 + 0.04, gy + 0.75, C.z], [1, 0, 0], 0.8, 1.0);
  parts.addSet('loft-window', hay);

  // Other walls: windows; an oculus in each gable.
  const win = new PolyMesh(35);
  for (const zc of [C.z - 3.2, C.z + 3.2]) windowOn(win, panes, [x0, T + 2.1, zc], [-1, 0, 0], 0.75, 1.1);
  for (const [z, s] of [[z0, -1], [z1, 1]] as const) {
    for (const xc of [C.x - 2.2, C.x + 2.2]) windowOn(win, panes, [xc, T + 2.1, z], [0, 0, s], 0.75, 1.1);
  }
  parts.addSet('windows', win);
  for (const [name, z, s] of [['n', z0, -1], ['s', z1, 1]] as const) {
    const ring: Vec2[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.42, Math.sin(a) * 0.42]);
    }
    const b: Basis = { o: [C.x, yE + rise * 0.42, z], u: [s, 0, 0], v: [0, 1, 0], w: [0, 0, s] };
    parts.add(`oculus:${name}`, extrudeBevel(ring.map(([u, v]) => [u * 1.18, v * 1.18] as Vec2), b, 0.0, 0.05, 0.01, S.paint));
    const c = panes.vert([C.x, yE + rise * 0.42, z + s * 0.056]);
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2;
      const a1 = ((k + 1) / 24) * Math.PI * 2;
      const p0 = panes.vert([C.x + s * Math.cos(a0) * 0.42, yE + rise * 0.42 + Math.sin(a0) * 0.42, z + s * 0.056]);
      const p1 = panes.vert([C.x + s * Math.cos(a1) * 0.42, yE + rise * 0.42 + Math.sin(a1) * 0.42, z + s * 0.056]);
      panes.face([c, p0, p1], 0);
    }
  }
  // Gutters along the eaves, downpipes at the corners.
  const rain = new PolyMesh(35);
  for (const s of [-1, 1]) {
    const x = C.x + s * (C.hx + ov + 0.06);
    rain.append(member([x, eY - 0.12, z0 - ov * 0.85], [x, eY - 0.12, z1 + ov * 0.85], 0.13, 0.11, S.iron));
    for (const z of [z0 - ov * 0.6, z1 + ov * 0.6]) rain.append(member([x, T + 0.05, z], [x, eY - 0.1, z], 0.075, 0.075, S.iron, [1, 0, 0]));
  }
  parts.addSet('rain', rain);
  return { parts, panes, proxies: [block(x0 - 0.1, T, z0 - 0.1, x1 + 0.12, yE, z1 + 0.1, 0, 0)] };
}
