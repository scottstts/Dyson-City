/**
 * The glasshouse in the kitchen garden (city_plan §4; docs/estate.md "Glasshouse"): a Victorian
 * span house on a brick dwarf wall, its ridge running east–west, the door in the middle of the
 * garden (south) side under a small glazed gablet. White-painted glazing bars at 0.6 m, a glass
 * roof pitched 34°, a gutter at the eaves, cast-iron cresting along the ridge with finials at the
 * gable ends. Inside: slatted staging along both long sides either side of a tiled path.
 *
 * The frame is parts (paint, brick, iron); the panes are one glass mesh (thin-pane glass, drawn as
 * transmittance then reflection, which is order-independent between panes).
 */
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { box as boxSolid, lathe, type Basis } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { GLASSHOUSE, TERRACE_Y } from './layout';
import { ESTATE_SLOT } from './materials/materials';
import { upright } from './kit';

const T = TERRACE_Y;
const S = ESTATE_SLOT;
const G = GLASSHOUSE;

export const GH = {
  dwarf: 0.72,
  eaves: 2.7,
  pitch: (34 * Math.PI) / 180,
  bay: 0.62,
  bar: 0.05,
  post: 0.09,
  door: 1.3,
  doorH: 2.25,
} as const;

/** A rectangular member from a to b (centreline), w across (horizontal-ish), h deep, its up near `up`. */
export function member(a: Vec3, b: Vec3, w: number, h: number, slot: number, up: Vec3 = [0, 1, 0], bevel = 0.006): PolyMesh {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  const t: Vec3 = [dx / l, dy / l, dz / l];
  // Section axes: v as close to `up` as possible, u = v × t.
  let v: Vec3 = [up[0] - t[0] * (up[0] * t[0] + up[1] * t[1] + up[2] * t[2]), up[1] - t[1] * (up[0] * t[0] + up[1] * t[1] + up[2] * t[2]), up[2] - t[2] * (up[0] * t[0] + up[1] * t[1] + up[2] * t[2])];
  let vl = Math.hypot(...v);
  if (vl < 1e-6) {
    v = [1, 0, 0];
    vl = 1;
  }
  v = [v[0] / vl, v[1] / vl, v[2] / vl];
  const u: Vec3 = [v[1] * t[2] - v[2] * t[1], v[2] * t[0] - v[0] * t[2], v[0] * t[1] - v[1] * t[0]];
  const basis: Basis = { o: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], u, v, w: t };
  return boxSolid(basis, w / 2, h / 2, l / 2, Math.min(bevel, w / 4, h / 4), slot);
}

export interface Glasshouse {
  parts: Parts;
  /** The panes as one open mesh of quads/triangles (thin pane: one surface per pane). */
  panes: PolyMesh;
}

export function buildGlasshouse(): Glasshouse {
  const parts = new Parts('estate:glasshouse');
  const frame = new PolyMesh(35);
  const panes = new PolyMesh(20);
  const x0 = G.x0, x1 = G.x1, z0 = G.z0, z1 = G.z1;
  const zm = (z0 + z1) / 2;
  const half = (z1 - z0) / 2;
  const yD = T + GH.dwarf;
  const yE = T + GH.eaves;
  const yR = yE + Math.tan(GH.pitch) * half;
  const doorX0 = (x0 + x1) / 2 - GH.door / 2;
  const doorX1 = (x0 + x1) / 2 + GH.door / 2;

  // Dwarf wall: brick, with a stone sill; the door's opening in the south side.
  const dw = 0.3;
  const wall = new PolyMesh(35);
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    wall.append(member([ax, T - 0.1 + (GH.dwarf + 0.1) / 2, az], [bx, T - 0.1 + (GH.dwarf + 0.1) / 2, bz], dw, GH.dwarf + 0.1, S.brick, [0, 1, 0], 0.01));
  };
  seg(x0 + dw / 2, z0 + dw / 2, x1 - dw / 2, z0 + dw / 2);
  seg(x0 + dw / 2, z0 + dw / 2 + dw, x0 + dw / 2, z1 - dw / 2 - dw);
  seg(x1 - dw / 2, z0 + dw / 2 + dw, x1 - dw / 2, z1 - dw / 2 - dw);
  // The door's posts stand on the wall's ends.
  seg(x0 + dw / 2, z1 - dw / 2, doorX0 - 0.06, z1 - dw / 2);
  seg(doorX1 + 0.06, z1 - dw / 2, x1 - dw / 2, z1 - dw / 2);
  parts.addSet('dwarf', wall);
  const sill = new PolyMesh(35);
  const sillY = yD + 0.03;
  const sillSeg = (ax: number, az: number, bx: number, bz: number) => sill.append(member([ax, sillY, az], [bx, sillY, bz], dw + 0.06, 0.06, S.paint, [0, 1, 0], 0.008));
  sillSeg(x0 - 0.03, z0 + dw / 2, x1 + 0.03, z0 + dw / 2);
  sillSeg(x0 + dw / 2, z0 + dw + 0.03, x0 + dw / 2, z1 - dw - 0.03);
  sillSeg(x1 - dw / 2, z0 + dw + 0.03, x1 - dw / 2, z1 - dw - 0.03);
  sillSeg(x0 - 0.03, z1 - dw / 2, doorX0 - 0.03, z1 - dw / 2);
  sillSeg(doorX1 + 0.03, z1 - dw / 2, x1 + 0.03, z1 - dw / 2);
  parts.addSet('sill', sill);

  // Long sides: posts at the bays, a head plate at the eaves, glazing between.
  const side = (z: number, south: boolean) => {
    const n = Math.round((x1 - x0) / GH.bay);
    const bay = (x1 - x0) / n;
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * bay;
      const xc = Math.min(Math.max(x, x0 + GH.post / 2), x1 - GH.post / 2);
      if (south && xc > doorX0 - 0.02 && xc < doorX1 + 0.02) continue;
      frame.append(member([xc, sillY + 0.03, z], [xc, yE, z], GH.post, GH.post, S.paint, [0, 0, 1]));
    }
    frame.append(member([x0, yE + 0.06, z], [x1, yE + 0.06, z], 0.12, 0.12, S.paint, [0, 1, 0]));
    // A mid rail, and the panes between posts above and below it.
    const yMid = sillY + 0.03 + (yE - sillY) * 0.42;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * bay + GH.post / 2;
      const xb = x0 + (i + 1) * bay - GH.post / 2;
      if (south && xb > doorX0 - 0.1 && xa < doorX1 + 0.1) continue;
      frame.append(member([xa, yMid, z], [xb, yMid, z], 0.05, 0.06, S.paint, [0, 0, 1]));
      for (const [ya, yb] of [[sillY + 0.06, yMid - 0.03], [yMid + 0.03, yE]]) {
        const a = panes.vert([xa, ya, z]);
        const b = panes.vert([xb, ya, z]);
        const c = panes.vert([xb, yb, z]);
        const d = panes.vert([xa, yb, z]);
        panes.face(south ? [a, b, c, d] : [b, a, d, c], 0);
      }
    }
  };
  side(z1 - dw / 2, true);
  side(z0 + dw / 2, false);

  // Gable ends: posts, and panes up to the roof's line.
  const gable = (x: number, east: boolean) => {
    const n = Math.round((z1 - z0) / GH.bay);
    const bay = (z1 - z0) / n;
    const roofY = (z: number) => yE + Math.tan(GH.pitch) * (half - Math.abs(z - zm));
    for (let i = 1; i < n; i++) {
      const z = z0 + i * bay;
      frame.append(member([x, sillY + 0.03, z], [x, roofY(z) - 0.06, z], GH.post * 0.8, GH.post * 0.8, S.paint, [1, 0, 0]));
    }
    for (let i = 0; i < n; i++) {
      const za = z0 + i * bay + GH.post / 2;
      const zb = z0 + (i + 1) * bay - GH.post / 2;
      const a = panes.vert([x, sillY + 0.06, za]);
      const b = panes.vert([x, sillY + 0.06, zb]);
      const c = panes.vert([x, roofY(zb) - 0.08, zb]);
      const d = panes.vert([x, roofY(za) - 0.08, za]);
      panes.face(east ? [b, a, d, c] : [a, b, c, d], 0);
    }
  };
  gable(x0 + dw / 2, false);
  gable(x1 - dw / 2, true);

  // Roof: rafters from eaves to ridge at the bays; panes between; ridge board; gutters.
  const n = Math.round((x1 - x0) / GH.bay);
  const bay = (x1 - x0) / n;
  for (const s of [-1, 1]) {
    const zE = zm + s * half;
    for (let i = 0; i <= n; i++) {
      const x = Math.min(Math.max(x0 + i * bay, x0 + 0.04), x1 - 0.04);
      frame.append(member([x, yE + 0.12, zE], [x, yR - 0.02, zm + s * 0.06], 0.05, 0.1, S.paint, [0, 1, 0]));
    }
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * bay + 0.03;
      const xb = x0 + (i + 1) * bay - 0.03;
      const a = panes.vert([xa, yE + 0.17, zE]);
      const b = panes.vert([xb, yE + 0.17, zE]);
      const c = panes.vert([xb, yR + 0.03, zm + s * 0.07]);
      const d = panes.vert([xa, yR + 0.03, zm + s * 0.07]);
      panes.face(s > 0 ? [a, b, c, d] : [b, a, d, c], 0);
    }
    // Gutter (ogee section approximated by a box with a lip).
    frame.append(member([x0 - 0.08, yE + 0.06, zE + s * 0.1], [x1 + 0.08, yE + 0.06, zE + s * 0.1], 0.12, 0.1, S.paint));
  }
  frame.append(member([x0 - 0.05, yR + 0.04, zm], [x1 + 0.05, yR + 0.04, zm], 0.07, 0.16, S.paint));
  parts.addSet('frame', frame);

  // Cresting along the ridge: a fleur-topped iron rail, and finials at the gable ends.
  const crest = new PolyMesh(40);
  const yC = yR + 0.12;
  crest.append(member([x0, yC, zm], [x1, yC, zm], 0.02, 0.025, S.iron));
  crest.append(member([x0, yC + 0.2, zm], [x1, yC + 0.2, zm], 0.018, 0.02, S.iron));
  for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.15) {
    crest.append(member([x, yC + 0.01, zm], [x, yC + 0.3, zm], 0.012, 0.012, S.iron, [1, 0, 0], 0.002));
  }
  parts.addSet('cresting', crest);
  for (const [name, x] of [['w', x0 - 0.02], ['e', x1 + 0.02]] as const) {
    const prof: Vec2[] = [[0, 0], [0.06, 0], [0.06, 0.04], [0.03, 0.08], [0.025, 0.25], [0.05, 0.3], [0.055, 0.34], [0.03, 0.38], [0.012, 0.55], [0, 0.6]];
    parts.add(`finial:${name}`, lathe(prof, 12, upright([x, yR + 0.12, zm]), S.iron, 40));
  }

  // Doors: a pair of half-glazed leaves, shut, in a frame; a glazed gablet above.
  const door = new PolyMesh(35);
  const zf = z1 - dw / 2;
  const top = T + 0.03 + GH.doorH;
  door.append(member([doorX0 - 0.05, T + 0.02, zf], [doorX0 - 0.05, top + 0.08, zf], 0.1, 0.12, S.paint, [0, 0, 1]));
  door.append(member([doorX1 + 0.05, T + 0.02, zf], [doorX1 + 0.05, top + 0.08, zf], 0.1, 0.12, S.paint, [0, 0, 1]));
  door.append(member([doorX0 - 0.14, top + 0.08, zf], [doorX1 + 0.14, top + 0.08, zf], 0.1, 0.13, S.paint, [0, 0, 1]));
  for (const [xa, xb] of [[doorX0, (doorX0 + doorX1) / 2], [(doorX0 + doorX1) / 2, doorX1]]) {
    // Bottom panel, stiles and rails; glazing above the lock rail.
    door.append(member([xa + 0.005, T + 0.04 + 0.45, zf], [xb - 0.005, T + 0.04 + 0.45, zf], 0.04, 0.9, S.paint, [0, 1, 0], 0.004));
    door.append(member([xa + 0.04, T + 0.93, zf], [xa + 0.04, top, zf], 0.07, 0.06, S.paint, [0, 0, 1]));
    door.append(member([xb - 0.04, T + 0.93, zf], [xb - 0.04, top, zf], 0.07, 0.06, S.paint, [0, 0, 1]));
    door.append(member([xa + 0.075, top - 0.04, zf], [xb - 0.075, top - 0.04, zf], 0.06, 0.065, S.paint, [0, 0, 1]));
    const a = panes.vert([xa + 0.075, T + 0.95, zf]);
    const b = panes.vert([xb - 0.075, T + 0.95, zf]);
    const c = panes.vert([xb - 0.075, top - 0.075, zf]);
    const d = panes.vert([xa + 0.075, top - 0.075, zf]);
    panes.face([a, b, c, d], 0);
  }
  parts.addSet('door', door);

  // Staging: slatted benches on legs along both long sides, either side of a tiled path.
  const staging = new PolyMesh(35);
  for (const zs of [z0 + dw + 0.55, z1 - dw - 0.55]) {
    const ys = T + 0.82;
    for (let x = x0 + dw + 0.4; x < x1 - dw - 0.3; x += 1.5) {
      for (const dz of [-0.4, 0.4]) staging.append(member([x, T + 0.01, zs + dz], [x, ys - 0.03, zs + dz], 0.05, 0.05, S.oak, [1, 0, 0]));
    }
    for (let k = 0; k < 6; k++) {
      const z = zs - 0.45 + k * 0.18;
      staging.append(member([x0 + dw + 0.15, ys, z], [x1 - dw - 0.15, ys, z], 0.13, 0.03, S.oak));
    }
  }
  parts.addSet('staging', staging);
  return { parts, panes };
}
