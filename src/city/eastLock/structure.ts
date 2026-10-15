/**
 * The East Lock's fixed structure (docs/east-lock.md), as the West Gate's gatehouse
 * (city/gate/gatehouse.ts) at craft size, in the lock's frame (spec.ts) and mirrored onto the east
 * cardinal: piers through the Dome's skin, the heads over both gates and the chamber's vault
 * between them, the hood over the outer leaf's open position, the basalt floor and bronze sills,
 * the side-seal tracks, trunnion housings, hoist brackets, top seals, the bronze trim the glass
 * stops on, and the stone apron outside on the deck.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { chamferRect, framesFrom, loftRings, loopProfile, revolve, sampleCurve, straightSweep, sweep, type Profile } from '../../geometry/sweep';
import { PAD_OUTER_RADIUS } from '../../ground/site';
import { DOME, MEMBER, SILL } from '../dome/spec';
import { normalAt, radiusAt } from '../dome/surface';
import { area2, extrudeX, extrudeZ, GH_SLOT } from '../gate/gatehouse';
import { LOCK, LOCK_OPENING, mirrorMesh } from './spec';

export interface LockPart {
  name: string;
  mesh: PolyMesh;
}

const L = LOCK;
const deg = Math.PI / 180;

function pierRing(side: -1 | 1, y: number, dw: number, de: number, dout: number, ch: number): Vec3[] {
  const zi = side * L.passageHalf;
  const zo = side * (L.outerHalf + dout);
  const xw = L.westX - dw;
  const xe = L.eastX + de;
  const c = ch + Math.max(dw, de, dout) * 0.5;
  const pts: Vec3[] = [[xw, y, zi], [xe, y, zi], [xe, y, zo - side * c], [xe - c, y, zo], [xw + c, y, zo], [xw, y, zo - side * c]];
  return area2(pts.map((p) => [p[0], -p[2]] as Vec2)) >= 0 ? pts : pts.reverse();
}

function piers(): LockPart[] {
  return ([-1, 1] as const).map((side) => {
    const levels: [number, number, number, number][] = [
      [-0.05, 0.35, 0.35, 0],
      [3.0, 0.35, 0.35, 0],
      [3.3, 0, 0, 0],
      [L.topY - 1.6, 0, 0, 0],
      [L.topY - 1.0, 0.9, 0.9, 0.9],
      [L.topY, 0.9, 0.9, 0.9],
    ];
    return { name: `lock:pier${side}`, mesh: loftRings(levels.map(([y, dw, de, dout]) => pierRing(side, y, dw, de, dout, 0.6)), GH_SLOT.stone, 30) };
  });
}

/** Vault intrados height at lateral z. */
export function lockVaultY(z: number): number {
  const zh = L.passageHalf;
  const Rv = (zh * zh + (L.crownY - L.springY) ** 2) / (2 * (L.crownY - L.springY));
  return L.crownY - Rv + Math.sqrt(Rv * Rv - z * z);
}

function headsAndVault(): LockPart[] {
  const zh = L.passageHalf;
  const corn = 0.9;
  const west: Vec2[] = [[L.headWestX, L.clearTop], [L.vaultWestX, L.clearTop], [L.vaultWestX, L.topY], [L.headWestX - corn, L.topY], [L.headWestX - corn, L.topY - 1.0], [L.headWestX, L.topY - 1.6]];
  const east: Vec2[] = [[L.vaultEastX, L.clearTop], [L.eastX, L.clearTop], [L.eastX, L.topY - 1.6], [L.eastX + corn, L.topY - 1.0], [L.eastX + corn, L.topY], [L.vaultEastX, L.topY]];
  const Rv = (zh * zh + (L.crownY - L.springY) ** 2) / (2 * (L.crownY - L.springY));
  const yc = L.crownY - Rv;
  const vault: Vec2[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const z = zh - (2 * zh * i) / n;
    vault.push([z, yc + Math.sqrt(Rv * Rv - z * z)]);
  }
  vault.push([-zh, L.topY], [zh, L.topY]);
  return [
    { name: 'lock:head-west', mesh: extrudeZ(west, -zh, zh, GH_SLOT.stone) },
    { name: 'lock:head-east', mesh: extrudeZ(east, -zh, zh, GH_SLOT.stone) },
    { name: 'lock:vault', mesh: extrudeX(vault, L.vaultWestX, L.vaultEastX, GH_SLOT.stone) },
  ];
}

function hood(): LockPart {
  const xt = L.outerTrunnionX;
  const yt = L.trunnionY;
  const thAt = (r: number, x: number) => Math.acos((x - xt) / r);
  const xEast = L.headWestX + 0.4;
  const pts: Vec2[] = [];
  const n = 64;
  const oE = thAt(L.hoodOuter, xEast);
  const oW = thAt(L.hoodOuter, L.hoodEndX);
  const iE = thAt(L.hoodInner, xEast);
  const iW = thAt(L.hoodInner, L.hoodEndX);
  for (let i = 0; i <= n; i++) {
    const th = oE + ((oW - oE) * i) / n;
    pts.push([xt + L.hoodOuter * Math.cos(th), yt + L.hoodOuter * Math.sin(th)]);
  }
  for (let i = 0; i <= n; i++) {
    const th = iW + ((iE - iW) * i) / n;
    pts.push([xt + L.hoodInner * Math.cos(th), yt + L.hoodInner * Math.sin(th)]);
  }
  return { name: 'lock:hood', mesh: extrudeZ(pts, -L.passageHalf - 0.4, L.passageHalf + 0.4, GH_SLOT.stone) };
}

function floorAndSills(): LockPart[] {
  const out: LockPart[] = [];
  const zh = L.passageHalf - 0.004;
  const y0 = DOME.centreY - 0.02;
  const x0 = L.outerLipX + 0.45;
  const x1 = L.innerLipX + 0.35;
  const slab: Vec2[] = [[x0, y0], [x1, y0], [x1, L.floor - 0.04], [x1 - 0.04, L.floor], [x0 + 0.04, L.floor], [x0, L.floor - 0.04]];
  out.push({ name: 'lock:floor', mesh: extrudeZ(slab, -zh, zh, GH_SLOT.basalt) });
  for (const [name, lip] of [['outer', L.outerLipX], ['inner', L.innerLipX]] as const) {
    const w0 = 0.42;
    const w1 = 0.32;
    const plate: Vec2[] = [[lip - w0, y0 + 0.01], [lip + w1, y0 + 0.01], [lip + w1, L.seal - 0.006], [lip + w1 - 0.006, L.seal], [lip - w0 + 0.006, L.seal], [lip - w0, L.seal - 0.006]];
    out.push({ name: `lock:sill-${name}`, mesh: extrudeZ(plate, -(L.passageHalf - 0.01), L.passageHalf - 0.01, GH_SLOT.bronze) });
  }
  return out;
}

function sealTracks(): LockPart[] {
  const out: LockPart[] = [];
  for (const [name, xt] of [['outer', L.outerTrunnionX], ['inner', L.innerTrunnionX]] as const) {
    for (const side of [-1, 1]) {
      const th0 = L.thetaBottom - 2 * deg;
      const th1 = L.thetaTop + L.openAngle + 1 * deg;
      const r0 = L.R - 0.2;
      const r1 = L.R + 0.04;
      const pts: Vec2[] = [];
      const n = 96;
      for (let i = 0; i <= n; i++) {
        const th = th0 + ((th1 - th0) * i) / n;
        pts.push([xt + r1 * Math.cos(th), L.trunnionY + r1 * Math.sin(th)]);
      }
      for (let i = n; i >= 0; i--) {
        const th = th0 + ((th1 - th0) * i) / n;
        pts.push([xt + r0 * Math.cos(th), L.trunnionY + r0 * Math.sin(th)]);
      }
      // Tracks above the head's soffit (inner gate) or the vault are clipped by where they run.
      const zf = side * (L.passageHalf - 0.012);
      const zb = side * (L.passageHalf + 0.1);
      out.push({ name: `lock:track-${name}${side}`, mesh: extrudeZ(pts.filter(([, y]) => y > L.seal - 0.3), Math.min(zf, zb), Math.max(zf, zb), GH_SLOT.bronze) });
    }
  }
  return out;
}

function housings(): LockPart[] {
  const out: LockPart[] = [];
  const prof: Vec2[] = [[0, 0], [3.6, 0], [3.9, 0.15], [3.9, 0.7], [0, 0.7]];
  for (const [name, xt] of [['outer', L.outerTrunnionX], ['inner', L.innerTrunnionX]] as const) {
    for (const side of [-1, 1]) {
      const z0 = side * (L.passageHalf - 0.12);
      const frame = (x: number, y: number, h: number): Vec3 => (side > 0 ? [xt + x, L.trunnionY + y, z0 + h] : [xt + y, L.trunnionY + x, z0 - h]);
      out.push({ name: `lock:housing-${name}${side}`, mesh: revolve(prof, 64, frame, GH_SLOT.bronze) });
    }
  }
  return out;
}

/** Fixed hoist pivots (A) in the lock's frame. */
export function lockHoistPivotA(trunnionX: number, side: -1 | 1): Vec3 {
  return [trunnionX + L.hoistA.r * Math.cos(L.hoistA.theta), L.trunnionY + L.hoistA.r * Math.sin(L.hoistA.theta), side * L.hoistZ];
}

function hoistBrackets(): LockPart[] {
  const out: LockPart[] = [];
  for (const [name, xt] of [['outer', L.outerTrunnionX], ['inner', L.innerTrunnionX]] as const) {
    for (const side of [-1, 1] as const) {
      const A = lockHoistPivotA(xt, side);
      const radial: Vec3 = [Math.cos(L.hoistA.theta), Math.sin(L.hoistA.theta), 0];
      const top = name === 'outer' ? L.hoodInner + 0.12 - L.hoistA.r : (lockVaultY(side * L.hoistZ) + 0.12 - A[1]) / radial[1];
      const a = v3.add(A, v3.scale(radial, -0.9));
      const b = v3.add(A, v3.scale(radial, top));
      out.push({ name: `lock:bracket-${name}${side}`, mesh: straightSweep(a, b, [0, 0, 1], loopProfile(chamferRect(0.7, 0.85, 0.12)), { crease: 30 }) });
    }
  }
  return out;
}

function topSeals(): LockPart[] {
  const out: LockPart[] = [];
  for (const [name, xt, faceX] of [['outer', L.outerTrunnionX, L.headWestX], ['inner', L.innerTrunnionX, L.vaultEastX]] as const) {
    const r = L.R - 0.008;
    const y0 = L.clearTop - 0.12;
    const y1 = L.clearTop + 0.22;
    const pts: Vec2[] = [];
    for (let i = 0; i <= 8; i++) {
      const y = y0 + ((y1 - y0) * i) / 8;
      pts.push([xt + Math.sqrt(r * r - (y - L.trunnionY) ** 2), y]);
    }
    pts.push([faceX + 0.1, y1], [faceX + 0.1, y0]);
    out.push({ name: `lock:topseal-${name}`, mesh: extrudeZ(pts, -(L.passageHalf - 0.004), L.passageHalf - 0.004, GH_SLOT.rubber) });
  }
  return out;
}

/** Bronze trim the glass stops on round the gatehouse (in world coordinates, east side). */
function glassTrim(): LockPart[] {
  const out: LockPart[] = [];
  const zc = LOCK_OPENING.halfWidth + 0.03 + LOCK_OPENING.trim / 2;
  const half = LOCK_OPENING.trim / 2;
  const yTop = LOCK_OPENING.top + 0.03 + half;
  const prof: Profile = loopProfile(chamferRect(half, 0.055, 0.012).map(([b, t]) => [b, t + 0.065] as Vec2), GH_SLOT.bronze);
  const onS = (z: number, y: number): Vec3 => {
    const r = radiusAt(y);
    return [Math.sqrt(r * r - z * z), y, z];
  };
  for (const s of [-1, 1]) {
    const { p } = sampleCurve((y: number) => onS(s * zc, y), SILL.top - 0.005, L.topY - 1.6 - 0.32 - 0.01, 2, 4);
    out.push({ name: `lock:trim${s}`, mesh: sweep(framesFrom(p, p.map(normalAt)), prof, { crease: 30, capSlot: GH_SLOT.bronze }) });
  }
  const railIn = DOME.bandHalf - MEMBER.rail.halfWidth - 0.05;
  const railOut = DOME.bandHalf + MEMBER.rail.halfWidth + 0.05;
  const runs: [number, number][] = [[-(zc + half), -railOut], [-railIn, railIn], [railOut, zc + half]];
  runs.forEach(([z0, z1], i) => {
    const { p } = sampleCurve((z: number) => onS(z, yTop), z0, z1, 1, 2);
    out.push({ name: `lock:trim-top${i}`, mesh: sweep(framesFrom(p, p.map(normalAt)), prof, { crease: 30, capSlot: GH_SLOT.bronze }) });
  });
  return out;
}

/** The stone apron on the deck outside the outer gate (lock frame). */
function apron(): LockPart {
  const r = PAD_OUTER_RADIUS + 0.02;
  const zh = L.passageHalf - 0.01;
  const xf = L.westX - 0.36;
  const pts: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const z = -zh + (2 * zh * i) / 24;
    pts.push([-Math.sqrt(r * r - z * z), z]);
  }
  const far = L.westX - 40;
  pts.push([xf, zh], [xf, 44], [far, 44], [far, -44], [xf, -44], [xf, -zh]);
  const top = 0.015;
  const inset = (k: number): Vec2[] => pts.map(([x, z]) => [x <= far + 1e-6 ? x + k : x, Math.abs(Math.abs(z) - 44) < 1e-6 && x < xf - 1e-6 ? z - Math.sign(z) * k : z]);
  const ring = (loop: Vec2[], y: number): Vec3[] => {
    const rg = loop.map(([x, z]) => [x, y, z] as Vec3);
    return area2(loop.map(([x, z]) => [x, -z] as Vec2)) >= 0 ? rg : rg.reverse();
  };
  return { name: 'lock:apron', mesh: loftRings([ring(pts, -0.03), ring(pts, top - 0.008), ring(inset(0.008), top)], GH_SLOT.apron, 30) };
}

/** Every fixed part, in world coordinates. */
export function buildLockStructure(): LockPart[] {
  const local = [...piers(), ...headsAndVault(), hood(), ...floorAndSills(), ...sealTracks(), ...housings(), ...hoistBrackets(), ...topSeals(), apron()];
  return [...local.map((p) => ({ name: p.name, mesh: mirrorMesh(p.mesh) })), ...glassTrim()];
}
