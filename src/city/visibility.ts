/**
 * How much of the star's disc the eye sees from where it stands (render/glarePass.ts scales the
 * star's analytic glare and halation by it): 1 in the open; under the Dome, what its frame and
 * glass let through; under the gatehouse's hood or roof, less or none.
 *
 * The star fills the 45° cone about the zenith; the share is estimated over fixed cosine-weighted
 * directions in that cone (the disc's irradiance weighting), against the frame's footprints on the
 * glass and the gatehouse's solids.
 */
import { DOME, MEMBER } from './dome/spec';
import { GATE } from './gate/spec';
import { STAR_ANGULAR_RADIUS } from '../world/constants';
import { EYE_HEIGHT } from '../world/constants';

type V = [number, number, number];

const SAMPLES = 96;

/** Fixed cosine-weighted directions in the star's cone (golden-angle spiral). */
export function capDirections(n = SAMPLES): V[] {
  const out: V[] = [];
  const s2 = Math.sin(STAR_ANGULAR_RADIUS) ** 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const sinT = Math.sqrt((s2 * (i + 0.5)) / n);
    const cosT = Math.sqrt(1 - sinT * sinT);
    const phi = golden * i;
    out.push([sinT * Math.cos(phi), cosT, sinT * Math.sin(phi)]);
  }
  return out;
}

const DIRS = capDirections();

function insideDome(p: V): boolean {
  const y = Math.max(p[1] - DOME.centreY, 0);
  return (p[0] * p[0] + p[2] * p[2]) / DOME.a ** 2 + (y * y) / DOME.c ** 2 < 1;
}

/** Where a ray from inside the Dome leaves through the glass (S). */
function exitPoint(o: V, d: V): V {
  const a = DOME.a;
  const c = DOME.c;
  const oy = o[1] - DOME.centreY;
  const A = (d[0] * d[0] + d[2] * d[2]) / (a * a) + (d[1] * d[1]) / (c * c);
  const B = (o[0] * d[0] + o[2] * d[2]) / (a * a) + (oy * d[1]) / (c * c);
  const C = (o[0] * o[0] + o[2] * o[2]) / (a * a) + (oy * oy) / (c * c) - 1;
  const t = (-B + Math.sqrt(Math.max(B * B - A * C, 0))) / A;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

/** Is a point on the glass behind a frame member (in plan, by the members' footprints)? */
function behindFrame(p: V): boolean {
  const [x, , z] = p;
  const H = DOME.bandHalf;
  const r2 = x * x + z * z;
  if (Math.abs(Math.abs(z) - H) < MEMBER.rail.halfWidth || Math.abs(Math.abs(x) - H) < MEMBER.rail.halfWidth) return true;
  if (r2 > DOME.eaveR ** 2) return false;
  for (const k of DOME.ribs) {
    for (const s of [-1, 1]) {
      const w = Math.abs(z) < H ? MEMBER.tie.halfWidth : MEMBER.rib.halfWidth;
      if (Math.abs(x - s * k) < w) return true;
      const w2 = Math.abs(x) < H ? MEMBER.tie.halfWidth : MEMBER.rib.halfWidth;
      if (Math.abs(z - s * k) < w2) return true;
    }
  }
  return false;
}

/** Inside one of the gatehouse's solids (coarse: piers, roof and heads, the hood). */
function inGatehouse(p: V): boolean {
  const [x, y, z] = p;
  if (y > GATE.topY || x < GATE.westX - 0.2 || x > GATE.eastX + 0.5 || Math.abs(z) > GATE.outerHalf + 0.5) return false;
  if (Math.abs(z) >= GATE.passageHalf) return true;
  if (x >= GATE.headWestX && y >= GATE.clearTop && (x <= GATE.vaultWestX || x >= GATE.vaultEastX)) return true;
  if (x > GATE.vaultWestX && x < GATE.vaultEastX && y >= GATE.springY) return true;
  if (x >= GATE.hoodEndX && x < GATE.headWestX) {
    const r = Math.hypot(x - GATE.outerTrunnionX, y - GATE.trunnionY);
    if (r >= GATE.hoodInner && r <= GATE.hoodOuter) return true;
  }
  return false;
}

function blockedByGatehouse(o: V, d: V): boolean {
  for (let t = 0.2; t < 40; t += 0.4) {
    const p: V = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (p[1] > GATE.topY) return false;
    if (inGatehouse(p)) return true;
  }
  return false;
}

/** Share of the cap seen between the Dome's frame members from the platform's centre. */
export function domeStarVisibility(): number {
  const eye: V = [0, DOME.centreY + EYE_HEIGHT, 0];
  let seen = 0;
  for (const d of DIRS) if (!behindFrame(exitPoint(eye, d))) seen++;
  return seen / DIRS.length;
}

/** What the eye sees of the star: the share of its disc in view, and the glass it is seen through. */
export interface StarView {
  /** Share of the disc not hidden (the frame's members, a roof): scales glare and halation. */
  visible: number;
  /** Transmission of anything in between (the Dome's tinted glass): scales the glare only. */
  transmission: number;
}

export class StarVisibility {
  private readonly dome = domeStarVisibility();
  private readonly glass: number;
  private last: V = [Infinity, 0, 0];
  private value: StarView = { visible: 1, transmission: 1 };

  constructor(glassTransmission: number) {
    this.glass = glassTransmission;
  }

  /** The star as seen from an eye position (cached until the eye moves 0.25 m). */
  at(eye: { x: number; y: number; z: number }): StarView {
    const e: V = [eye.x, eye.y, eye.z];
    if (Math.hypot(e[0] - this.last[0], e[1] - this.last[1], e[2] - this.last[2]) < 0.25) return this.value;
    this.last = e;
    const inside = insideDome(e);
    let v = inside ? this.dome : 1;
    const nearGate = e[0] > GATE.westX - 45 && e[0] < GATE.eastX + 45 && Math.abs(e[2]) < GATE.outerHalf + 45;
    if (nearGate) {
      let seen = 0;
      for (const d of DIRS) if (!blockedByGatehouse(e, d)) seen++;
      v *= seen / DIRS.length;
    }
    this.value = { visible: v, transmission: inside ? this.glass : 1 };
    return this.value;
  }
}
