/**
 * The West Gate's fixed structure (docs/gate.md): the gatehouse that carries the airlock through the
 * Dome's skin.
 *
 *  - piers: two massive walls flanking the passage from the trunnion piers outside to the Gate
 *    Court inside, standing through the platform's steps; the Spinward Band's rails land on them;
 *  - head: over the outer gate (its underside is the outer leaf's top seal) and over the inner gate,
 *    with the chamber's segmental vault between them;
 *  - hood: the curved shell over the outer leaf's open position, about the outer trunnion axis;
 *  - chamber fittings: basalt floor slab, bronze sill plates, side-seal tracks, trunnion bearing
 *    housings, hoist brackets, luminaires, equalising vents and the pressure dial;
 *  - the bronze trim the Dome's glass stops on around the gatehouse, and the stone apron outside.
 *
 * Junction rules as in the frame: parts that meet either butt exactly on a shared plane (back to
 * back, both faces hidden) or sink into the part they bear on; nothing visible is coplanar.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { chamferRect, framesFrom, loftRings, loopProfile, revolve, sampleCurve, straightSweep, sweep, type Profile } from '../../geometry/sweep';
import { PAD_OUTER_RADIUS } from '../../ground/site';
import { DOME, GATE_OPENING, MEMBER, SILL } from '../dome/spec';
import { normalAt, radiusAt } from '../dome/surface';
import { GATE } from './spec';
import { BOLT_Z } from './leaf';

/** Material slots of the gatehouse. */
export const GH_SLOT = { stone: 0, bronze: 1, basalt: 2, lamp: 3, dial: 4, apron: 5, rubber: 6 } as const;
export const GH_SLOTS = 7;

export interface GatePart {
  name: string;
  mesh: PolyMesh;
}

const G = GATE;
const deg = Math.PI / 180;

/** Signed area of a 2D loop (positive: counter-clockwise). */
function area2(loop: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
const ccw = (loop: Vec2[]): Vec2[] => (area2(loop) >= 0 ? loop : [...loop].reverse());

/** Prism: a closed (x, y) outline extruded along z from z0 to z1. */
function extrudeZ(outline: Vec2[], z0: number, z1: number, slot: number, crease = 30): PolyMesh {
  // Along +z with up = +y the profile's b axis is +x.
  return straightSweep([0, 0, z0], [0, 0, z1], [0, 1, 0], loopProfile(ccw(outline), slot), { crease, capSlot: slot });
}

/** Prism: a closed (z, y) outline extruded along x from x0 to x1. */
function extrudeX(outline: Vec2[], x0: number, x1: number, slot: number, crease = 30): PolyMesh {
  // Along +x with up = +y the profile's b axis is −z.
  return straightSweep([x0, 0, 0], [x1, 0, 0], [0, 1, 0], loopProfile(ccw(outline.map(([z, y]) => [-z, y] as Vec2)), slot), { crease, capSlot: slot });
}

/** Pier plan ring at offsets (west, east, outer faces) with the outer corners chamfered. */
function pierRing(side: -1 | 1, y: number, dw: number, de: number, dout: number, ch: number): Vec3[] {
  const zi = side * G.passageHalf;
  const zo = side * (G.outerHalf + dout);
  const xw = G.westX - dw;
  const xe = G.eastX + de;
  const c = ch + Math.max(dw, de, dout) * 0.5;
  const pts: Vec3[] = [
    [xw, y, zi],
    [xe, y, zi],
    [xe, y, zo - side * c],
    [xe - c, y, zo],
    [xw + c, y, zo],
    [xw, y, zo - side * c],
  ];
  // loftRings wants rings counter-clockwise seen from +y (the loft's end): in (x, −z) terms.
  return area2(pts.map((p) => [p[0], -p[2]] as Vec2)) >= 0 ? pts : pts.reverse();
}

function piers(): GatePart[] {
  const out: GatePart[] = [];
  for (const side of [-1, 1] as const) {
    // Base course on the end faces, a plain outer face (the Dome's glass meets it), a cornice.
    const levels: [number, number, number, number][] = [
      [-0.05, 0.18, 0.18, 0],
      [1.6, 0.18, 0.18, 0],
      [1.78, 0, 0, 0],
      [30.1, 0, 0, 0],
      [30.42, 0.5, 0.5, 0.5],
      [G.topY, 0.5, 0.5, 0.5],
    ];
    const rings = levels.map(([y, dw, de, dout]) => pierRing(side, y, dw, de, dout, 0.3));
    out.push({ name: `gatehouse:pier${side}`, mesh: loftRings(rings, GH_SLOT.stone, 30) });
  }
  return out;
}

/** Heads over the gates and the vault between them (z = ±passageHalf: they butt on the piers). */
function headAndVault(): GatePart[] {
  const zh = G.passageHalf;
  const corn = 0.5;
  const west: Vec2[] = [
    [G.headWestX, G.clearTop], [G.vaultWestX, G.clearTop], [G.vaultWestX, G.topY], [G.headWestX - corn, G.topY], [G.headWestX - corn, 30.42], [G.headWestX, 30.1],
  ];
  const east: Vec2[] = [
    [G.vaultEastX, G.clearTop], [G.eastX, G.clearTop], [G.eastX, 30.1], [G.eastX + corn, 30.42], [G.eastX + corn, G.topY], [G.vaultEastX, G.topY],
  ];
  // Vault section (z, y): segmental intrados from springing to springing, flat roof above.
  const Rv = (zh * zh + (G.crownY - G.springY) ** 2) / (2 * (G.crownY - G.springY));
  const yc = G.crownY - Rv;
  const vault: Vec2[] = [];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const z = zh - (2 * zh * i) / n;
    vault.push([z, yc + Math.sqrt(Rv * Rv - z * z)]);
  }
  vault.push([-zh, G.topY], [zh, G.topY]);
  return [
    { name: 'gatehouse:head-west', mesh: extrudeZ(west, -zh, zh, GH_SLOT.stone) },
    { name: 'gatehouse:head-east', mesh: extrudeZ(east, -zh, zh, GH_SLOT.stone) },
    { name: 'gatehouse:vault', mesh: extrudeX(vault, G.vaultWestX, G.vaultEastX, GH_SLOT.stone) },
  ];
}

/** Vault intrados height at lateral z. */
export function vaultY(z: number): number {
  const zh = G.passageHalf;
  const Rv = (zh * zh + (G.crownY - G.springY) ** 2) / (2 * (G.crownY - G.springY));
  return G.crownY - Rv + Math.sqrt(Rv * Rv - z * z);
}

function hood(): GatePart {
  const xt = G.outerTrunnionX;
  const yt = G.trunnionY;
  const ri = G.hoodInner;
  const ro = G.hoodOuter;
  const thAt = (r: number, x: number) => Math.acos((x - xt) / r);
  // The east end sinks 0.25 m into the head over the outer gate (it bears on it).
  const xEast = G.headWestX + 0.25;
  const oE = thAt(ro, xEast);
  const oW = thAt(ro, G.hoodEndX);
  const iE = thAt(ri, xEast);
  const iW = thAt(ri, G.hoodEndX);
  const pts: Vec2[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const th = oE + ((oW - oE) * i) / n;
    pts.push([xt + ro * Math.cos(th), yt + ro * Math.sin(th)]);
  }
  for (let i = 0; i <= n; i++) {
    const th = iW + ((iE - iW) * i) / n;
    pts.push([xt + ri * Math.cos(th), yt + ri * Math.sin(th)]);
  }
  // Its ends run 0.3 m into the piers it spans between.
  return { name: 'gatehouse:hood', mesh: extrudeZ(pts, -G.passageHalf - 0.3, G.passageHalf + 0.3, GH_SLOT.stone) };
}

function floorAndSills(): GatePart[] {
  const out: GatePart[] = [];
  const zh = G.passageHalf - 0.004;
  const y0 = DOME.centreY - 0.02;
  const x0 = -499.6;
  const x1 = -472.4;
  // Basalt slab with chamfered ends (a 50 mm rise you walk over).
  const slab: Vec2[] = [[x0, y0], [x1, y0], [x1, G.floor - 0.035], [x1 - 0.035, G.floor], [x0 + 0.035, G.floor], [x0, G.floor - 0.035]];
  out.push({ name: 'gatehouse:floor', mesh: extrudeZ(slab, -zh, zh, GH_SLOT.basalt) });
  for (const [name, lip] of [['outer', G.outerLipX], ['inner', G.innerLipX]] as const) {
    const w0 = 0.42;
    const w1 = 0.25;
    const plate: Vec2[] = [[lip - w0, G.floor - 0.005], [lip + w1, G.floor - 0.005], [lip + w1, G.seal - 0.006], [lip + w1 - 0.006, G.seal], [lip - w0 + 0.006, G.seal], [lip - w0, G.seal - 0.006]];
    out.push({ name: `gatehouse:sill-${name}`, mesh: extrudeZ(plate, -(G.passageHalf - 0.01), G.passageHalf - 0.01, GH_SLOT.bronze) });
    // Bezels round the floor bolts' sockets, under the lip's keepers (clear of the skin's edge).
    for (const z of BOLT_Z) {
      const bez: Vec2[] = [[0, G.seal - 0.004], [BOLT.bezel, G.seal - 0.004], [BOLT.bezel, G.seal + 0.004], [BOLT.bezel - 0.02, G.seal + 0.006], [0, G.seal + 0.006]];
      const xb = boltX(lip);
      out.push({ name: `gatehouse:bezel-${name}${z}`, mesh: revolve(bez, 24, (x, y, h) => [xb + x, h, z - y], GH_SLOT.bronze) });
    }
  }
  return out;
}

/** Floor bolts: radius, bezel radius and travel (they rise into the lip keepers). */
export const BOLT = { radius: 0.045, bezel: 0.09, rise: 0.38 } as const;

/** Floor bolt axis x for a gate: under the lip keeper, clear of the skin's lower edge. */
export function boltX(lipX: number): number {
  return lipX - 0.2;
}

function sealTracks(): GatePart[] {
  const out: GatePart[] = [];
  for (const [name, xt] of [['outer', G.outerTrunnionX], ['inner', G.innerTrunnionX]] as const) {
    for (const side of [-1, 1]) {
      const th0 = G.thetaBottom - 2 * deg;
      const th1 = G.thetaTop + G.openAngle + 2 * deg;
      const r0 = 15.86;
      const r1 = 16.04;
      const pts: Vec2[] = [];
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const th = th0 + ((th1 - th0) * i) / n;
        pts.push([xt + r1 * Math.cos(th), G.trunnionY + r1 * Math.sin(th)]);
      }
      for (let i = n; i >= 0; i--) {
        const th = th0 + ((th1 - th0) * i) / n;
        pts.push([xt + r0 * Math.cos(th), G.trunnionY + r0 * Math.sin(th)]);
      }
      const zf = side * (G.passageHalf - 0.008);
      const zb = side * (G.passageHalf + 0.08);
      out.push({ name: `gatehouse:track-${name}${side}`, mesh: extrudeZ(side > 0 ? pts : pts, Math.min(zf, zb), Math.max(zf, zb), GH_SLOT.bronze) });
    }
  }
  return out;
}

function housings(): GatePart[] {
  const out: GatePart[] = [];
  const prof: Vec2[] = [[0, 0], [1.72, 0], [1.9, 0.08], [1.9, 0.36], [0, 0.36]];
  const bolt: Vec2[] = [[0, -0.045], [0.065, -0.045], [0.075, -0.035], [0.075, 0.006], [0, 0.006]];
  for (const [name, xt] of [['outer', G.outerTrunnionX], ['inner', G.innerTrunnionX]] as const) {
    for (const side of [-1, 1]) {
      const z0 = side * (G.passageHalf - 0.08);
      // Local h grows into the wall; for −z the axes swap to keep the mapping right-handed.
      const frame = (x: number, y: number, h: number): Vec3 => (side > 0 ? [xt + x, G.trunnionY + y, z0 + h] : [xt + y, G.trunnionY + x, z0 - h]);
      out.push({ name: `gatehouse:housing-${name}${side}`, mesh: revolve(prof, 48, frame, GH_SLOT.bronze) });
      for (let k = 0; k < 16; k++) {
        const a = (2 * Math.PI * k) / 16 + Math.PI / 16;
        const bx = 1.62 * Math.cos(a);
        const by = 1.62 * Math.sin(a);
        const bf = (x: number, y: number, h: number): Vec3 => (side > 0 ? [xt + bx + x, G.trunnionY + by + y, z0 + h] : [xt + bx + y, G.trunnionY + by + x, z0 - h]);
        out.push({ name: `gatehouse:housing-${name}${side}:bolt${k}`, mesh: revolve(bolt, 6, bf, GH_SLOT.bronze) });
      }
    }
  }
  return out;
}

/** Fixed hoist pivots (A) in world coordinates. */
export function hoistPivotA(trunnionX: number, side: -1 | 1): Vec3 {
  return [trunnionX + G.hoistA.r * Math.cos(G.hoistA.theta), G.trunnionY + G.hoistA.r * Math.sin(G.hoistA.theta), side * G.hoistZ];
}

function hoistBrackets(): GatePart[] {
  const out: GatePart[] = [];
  for (const [name, xt] of [['outer', G.outerTrunnionX], ['inner', G.innerTrunnionX]] as const) {
    for (const side of [-1, 1] as const) {
      const A = hoistPivotA(xt, side);
      const radial: Vec3 = [Math.cos(G.hoistA.theta), Math.sin(G.hoistA.theta), 0];
      // From just below the pivot up into the hood (outer) or the vault (inner).
      const top = name === 'outer' ? G.hoodInner + 0.06 - G.hoistA.r : (vaultY(side * G.hoistZ) + 0.06 - A[1]) / radial[1];
      const a = v3.add(A, v3.scale(radial, -0.45));
      const b = v3.add(A, v3.scale(radial, top));
      out.push({ name: `gatehouse:bracket-${name}${side}`, mesh: straightSweep(a, b, [0, 0, 1], loopProfile(chamferRect(0.34, 0.42, 0.06)), { crease: 30 }) });
    }
  }
  return out;
}

/** Pendant luminaires under the vault (lateral offsets, extent): diffusers below and above. */
export const LUMINAIRE = { z: 4.5, x0: -494.5, x1: -474.5, bottom: 27.4, top: 27.75, half: 0.32 } as const;
/**
 * Wall luminaires: slim continuous lines on both piers, 45 mm proud (inside the 100 mm between the
 * leaves' edges and the jambs, clear of the vents, dial, housings and seal tracks).
 */
export const WALL_LAMP = { y0: 5.1, y1: 5.42, x0: -495.8, x1: -474.2, proud: 0.045 } as const;

function luminaires(): GatePart[] {
  const out: GatePart[] = [];
  const L = LUMINAIRE;
  for (const side of [-1, 1]) {
    const zc = side * L.z;
    // Housing (z, y) section: a bronze channel with an opal diffuser underneath.
    const sec: Vec2[] = [
      [zc - L.half, L.top - 0.04], [zc - L.half, L.bottom + 0.05], [zc - L.half + 0.04, L.bottom], [zc + L.half - 0.04, L.bottom], [zc + L.half, L.bottom + 0.05], [zc + L.half, L.top - 0.04], [zc + L.half - 0.04, L.top], [zc - L.half + 0.04, L.top],
    ];
    const m = extrudeX(sec, L.x0, L.x1, GH_SLOT.bronze);
    // Diffusers: the faces looking down (the downlight) and up (the uplight washing the vault).
    m.faces.forEach((f, i) => {
      const nn = v3.norm(v3.cross(v3.sub(m.verts[f[1]], m.verts[f[0]]), v3.sub(m.verts[f[2]], m.verts[f[0]])));
      if (Math.abs(nn[1]) > 0.99 && Math.abs(nn[0]) < 0.5) m.faceMat[i] = GH_SLOT.lamp;
    });
    out.push({ name: `gatehouse:luminaire${side}`, mesh: m });
    for (let k = 0; k < 5; k++) {
      const x = L.x0 + 1 + ((L.x1 - L.x0 - 2) * k) / 4;
      const yTop = vaultY(zc) + 0.04;
      out.push({ name: `gatehouse:stem${side}:${k}`, mesh: revolve([[0, 0], [0.03, 0], [0.03, yTop - L.top + 0.01], [0, yTop - L.top + 0.01]], 12, (a, b, h) => [x + a, L.top - 0.01 + h, zc - b], GH_SLOT.bronze) });
    }
  }
  // Wall lines: a bronze channel with an opal face, set on each pier's inner face.
  const W = WALL_LAMP;
  for (const side of [-1, 1]) {
    const zf = side * (G.passageHalf - W.proud);
    const zb = side * (G.passageHalf + 0.05);
    const sec: Vec2[] = [
      [zb, W.y0], [zf + side * 0.012, W.y0], [zf, W.y0 + 0.012], [zf, W.y1 - 0.012], [zf + side * 0.012, W.y1], [zb, W.y1],
    ];
    const m = extrudeX(sec, W.x0, W.x1, GH_SLOT.bronze);
    m.faces.forEach((f, i) => {
      const nn = v3.norm(v3.cross(v3.sub(m.verts[f[1]], m.verts[f[0]]), v3.sub(m.verts[f[2]], m.verts[f[0]])));
      if (nn[2] * side < -0.99) m.faceMat[i] = GH_SLOT.lamp;
    });
    out.push({ name: `gatehouse:walllamp${side}`, mesh: m });
  }
  return out;
}

/**
 * Top seals: black rubber bars along each head's lower west edge. Their west face is an arc 5 mm
 * inside the leaf skin's outer radius, so the skin bears on them all the way up and closes on them.
 */
function topSeals(): GatePart[] {
  const out: GatePart[] = [];
  for (const [name, xt, faceX] of [['outer', G.outerTrunnionX, G.headWestX], ['inner', G.innerTrunnionX, G.vaultEastX]] as const) {
    const r = G.R - 0.005;
    const y0 = G.clearTop - 0.07;
    const y1 = G.clearTop + 0.13;
    const pts: Vec2[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      pts.push([xt + Math.sqrt(r * r - (y - G.trunnionY) ** 2), y]);
    }
    pts.push([faceX + 0.06, y1], [faceX + 0.06, y0]);
    out.push({ name: `gatehouse:topseal-${name}`, mesh: extrudeZ(pts, -(G.passageHalf - 0.004), G.passageHalf - 0.004, GH_SLOT.rubber) });
  }
  return out;
}

/** Vents (x centre) and the dial on the pier inner faces. */
export const VENTS = [-494.8, -490.2];
export const DIAL = { x: -492.5, y: 3.4, side: -1 as const, radius: 0.75 };

function vents(): GatePart[] {
  const out: GatePart[] = [];
  const w = 1.1;
  const y0 = 1.8;
  const y1 = 3.4;
  for (const side of [-1, 1] as const) {
    for (const xc of VENTS) {
      const zf = side * (G.passageHalf - 0.2);
      const zb = side * (G.passageHalf + 0.06);
      // Frame: a rectangular ring (outer and inner outlines) as one closed solid.
      const ring = frameRing(xc, (y0 + y1) / 2, w, (y1 - y0) / 2, 0.12, Math.min(zf, zb), Math.max(zf, zb));
      out.push({ name: `gatehouse:vent${side}:${xc}`, mesh: ring });
      // Louvres: slats tilted 35°, spanning between the frame's jambs with 4 mm reveals.
      const slats = 6;
      for (let k = 0; k < slats; k++) {
        const yc = y0 + 0.12 + ((y1 - y0 - 0.24) * (k + 0.5)) / slats;
        const zc = side * (G.passageHalf - 0.08);
        const half = 0.11;
        const t = 0.012;
        const c = Math.cos(35 * deg);
        const s = Math.sin(35 * deg);
        const sec: Vec2[] = [[-half, -t], [half, -t], [half, t], [-half, t]].map(([u, v]) => [zc + side * (u * c - v * s), yc + u * s + v * c] as Vec2);
        out.push({ name: `gatehouse:louvre${side}:${xc}:${k}`, mesh: extrudeX(sec, xc - w + 0.12 + 0.004, xc + w - 0.12 - 0.004, GH_SLOT.bronze) });
      }
    }
  }
  return out;
}

/** A rectangular frame ring in a plane z ∈ [z0, z1]: outer half-sizes (hw, hh), bar width b. */
function frameRing(xc: number, yc: number, hw: number, hh: number, b: number, z0: number, z1: number): PolyMesh {
  const mesh = new PolyMesh(30);
  const outer: Vec2[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const inner: Vec2[] = [[-hw + b, -hh + b], [hw - b, -hh + b], [hw - b, hh - b], [-hw + b, hh - b]];
  const id = (p: Vec2, z: number) => mesh.vert([xc + p[0], yc + p[1], z]);
  const oF = outer.map((p) => id(p, z0));
  const oB = outer.map((p) => id(p, z1));
  const iF = inner.map((p) => id(p, z0));
  const iB = inner.map((p) => id(p, z1));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // Outer sides face out, inner sides face in; front (z0) and back (z1) faces are quads around.
    mesh.face([oF[i], oF[j], oB[j], oB[i]], GH_SLOT.bronze);
    mesh.face([iF[i], iB[i], iB[j], iF[j]], GH_SLOT.bronze);
    mesh.face([oF[i], iF[i], iF[j], oF[j]], GH_SLOT.bronze);
    mesh.face([oB[i], oB[j], iB[j], iB[i]], GH_SLOT.bronze);
  }
  return mesh;
}

function dial(): GatePart[] {
  const D = DIAL;
  const zw = D.side * G.passageHalf;
  // Axis normal to the wall; local h runs out of the wall into the chamber (right-handed both ways).
  const map = (x: number, y: number, h: number): Vec3 => (D.side < 0 ? [D.x + x, D.y + y, zw - 0.06 + h] : [D.x + y, D.y + x, zw + 0.06 - h]);
  const R = D.radius;
  const body: Vec2[] = [[0, 0], [R + 0.08, 0], [R + 0.1, 0.02], [R + 0.1, 0.22], [R + 0.06, 0.26], [R, 0.26], [R - 0.02, 0.2], [0, 0.2]];
  return [{ name: 'gatehouse:dial', mesh: revolve(body, 64, map, [GH_SLOT.bronze, GH_SLOT.bronze, GH_SLOT.bronze, GH_SLOT.bronze, GH_SLOT.bronze, GH_SLOT.bronze, GH_SLOT.dial, GH_SLOT.dial]) }];
}

/** Bronze trim the Dome's glass stops on, on the glass's outer face around the gatehouse. */
function glassTrim(): GatePart[] {
  const out: GatePart[] = [];
  // A 30 mm reveal off the gatehouse (S's normal tilts the strip's section a few mm).
  const zc = GATE_OPENING.halfWidth + 0.03 + GATE_OPENING.trim / 2;
  const half = GATE_OPENING.trim / 2;
  const yTop = GATE_OPENING.top + 0.03 + half;
  const prof: Profile = loopProfile(chamferRect(half, 0.055, 0.012).map(([b, t]) => [b, t + 0.065] as Vec2), GH_SLOT.bronze);
  const onS = (z: number, y: number): Vec3 => {
    const r = radiusAt(y);
    return [-Math.sqrt(r * r - z * z), y, z];
  };
  // Verticals: from the sill's top to just under the piers' cornice.
  for (const s of [-1, 1]) {
    const c = (y: number) => onS(s * zc, y);
    const { p } = sampleCurve(c, SILL.top - 0.005, 30.42 - 0.32 - 0.01, 1.5, 4);
    out.push({ name: `gatehouse:trim${s}`, mesh: sweep(framesFrom(p, p.map(normalAt)), prof, { crease: 30, capSlot: GH_SLOT.bronze }) });
  }
  // Across the top, above the roof's edge, in three runs between the Spinward rails landing there.
  const railIn = DOME.bandHalf - MEMBER.rail.halfWidth - 0.05;
  const railOut = DOME.bandHalf + MEMBER.rail.halfWidth + 0.05;
  const runs: [number, number][] = [[-(zc + half), -railOut], [-railIn, railIn], [railOut, zc + half]];
  runs.forEach(([z0, z1], i) => {
    const c = (z: number) => onS(z, yTop);
    const { p } = sampleCurve(c, z0, z1, 1, 2);
    out.push({ name: `gatehouse:trim-top${i}`, mesh: sweep(framesFrom(p, p.map(normalAt)), prof, { crease: 30, capSlot: GH_SLOT.bronze }) });
  });
  return out;
}

/** Stone apron outside the outer gate: between the piers, then wider in front of them. */
function apron(): GatePart {
  const r = PAD_OUTER_RADIUS + 0.02;
  const zh = G.passageHalf - 0.01;
  // Clear of the piers' base course (0.18 proud of their west faces) by 10 mm.
  const xf = G.westX - 0.19;
  // Plan outline (x, z): the bottom riser's arc between the piers, round the piers' fronts.
  const pts: Vec2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const z = -zh + (2 * zh * i) / n;
    pts.push([-Math.sqrt(r * r - z * z), z]);
  }
  pts.push([xf, zh], [xf, 20], [-560, 20], [-560, -20], [xf, -20], [xf, -zh]);
  // A 15 mm slab on the deck with an 8 mm arris on its free edges (west and sides).
  const top = 0.015;
  const inset = (k: number): Vec2[] => pts.map(([x, z]) => [x <= -559.99 ? x + k : x, Math.abs(Math.abs(z) - 20) < 1e-6 && x < xf - 1e-6 ? z - Math.sign(z) * k : z]);
  const ring = (loop: Vec2[], y: number): Vec3[] => {
    const rg = loop.map(([x, z]) => [x, y, z] as Vec3);
    return area2(loop.map(([x, z]) => [x, -z] as Vec2)) >= 0 ? rg : rg.reverse();
  };
  const rings = [ring(pts, -0.03), ring(pts, top - 0.008), ring(inset(0.008), top)];
  return { name: 'gatehouse:apron', mesh: loftRings(rings, GH_SLOT.apron, 30) };
}

export function buildGatehouse(): GatePart[] {
  return [...piers(), ...headAndVault(), hood(), ...floorAndSills(), ...sealTracks(), ...housings(), ...hoistBrackets(), ...luminaires(), ...topSeals(), ...vents(), ...dial(), ...glassTrim(), apron()];
}
