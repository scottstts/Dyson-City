/**
 * The Dome's members as fabricated plate girders (docs/dome.md): a glass-side bearing flange and an
 * outer cap flange, both full width, joined by a web set back from their edges; the fillets where web
 * meets flange are inlaid black linings. Web stiffeners cross the recess at panel points. Heavy
 * members (bands, collars, the Eave Ring) also carry a longitudinal web stiffener.
 *
 * A shop length is one sweep; its stiffeners are plates welded into the recess (seated 20 mm into
 * the web and both flanges, their web-side corners snipped clear of the fillets, as fabricated).
 */
import { PolyMesh, v3, type Vec2 } from '../../geometry/polyMesh';
import { arcTable, framesFrom, sweep, type ArcTable, type Frame, type Plane, type Profile } from '../../geometry/sweep';
import { PAD_HEIGHT } from '../../ground/site';
import { FOOT, GASKET_Y, GIRDER, LAYER, MEMBER, POST_T1_SILL } from './spec';
import { SLOT } from './slots';
import { normalAt, tangent, type Curve } from './surface';

export type Kind = keyof typeof MEMBER;

/** Height over which drum members taper from the sill depth to their full depth. */
const TAPER_TOP = 40;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** Outer offset of a member at height y: tapered to the sill depth near the base. */
export function memberT1(kind: Kind, y: number): number {
  const full = MEMBER[kind].t1;
  const sill = POST_T1_SILL - FOOT.radial;
  return sill + (full - sill) * smooth(FOOT.y + 1, TAPER_TOP, y);
}

/** Inner offset at height y: the gasket line, standing off further near the sill. */
export function memberT0(y: number): number {
  return LAYER.memberT0Sill + (LAYER.memberT0 - LAYER.memberT0Sill) * smooth(PAD_HEIGHT + 1, GASKET_Y, y);
}

const HEAVY: ReadonlySet<Kind> = new Set(['rail', 'arch', 'eave']);

/** Section proportions for a member of the given depth. */
export function sectionDims(kind: Kind, t0: number, t1: number) {
  const hw = MEMBER[kind].halfWidth;
  const depth = t1 - t0;
  const fb = clamp(0.075 * depth, 0.28, 0.55);
  const ft = clamp(0.085 * depth, 0.32, 0.65);
  const recess = clamp(0.2 * hw, 0.3, 0.55);
  const heavy = HEAVY.has(kind);
  // Longitudinal stiffener: centre height, half-thickness, projection from the web.
  const tl = t0 + fb + 0.62 * (depth - fb - ft);
  return { hw, depth, fb, ft, recess, web: hw - recess, heavy, tl, lh: 0.11, ls: 0.55 * recess };
}

/** The girder section, counter-clockwise in (b, t): ceramic, with the web's fillets inlaid as black linings. */
export function girderSection(kind: Kind, t0: number, t1: number): Profile {
  const d = sectionDims(kind, t0, t1);
  const { hw, fb, ft, web: w, tl, lh, ls } = d;
  const f = GIRDER.fillet;
  const e = 0.03;
  const cb = 0.05;
  const ct = Math.min(0.22, 0.05 + 0.03 * d.depth);
  // Right side, bottom to top: [b, t, starts a lining edge].
  const right: [number, number, boolean][] = [
    [hw - cb, t0, false],
    [hw, t0 + cb, false],
    [hw, t0 + fb - e, false],
    [hw - e, t0 + fb, false],
    [w + f, t0 + fb, true],
    [w, t0 + fb + f, false],
  ];
  if (d.heavy) right.push([w, tl - lh, false], [w + ls, tl - lh + 0.04, false], [w + ls, tl + lh - 0.04, false], [w, tl + lh, false]);
  right.push([w, t1 - ft - f, true], [w + f, t1 - ft, false], [hw - e, t1 - ft, false], [hw, t1 - ft + e, false], [hw, t1 - ct, false], [hw - ct, t1, false]);
  // Mirrored, the left side runs top to bottom: its lining edges start one point earlier.
  const left = [...right].reverse().map(([b, t], i, r) => [-b, t, i + 1 < r.length && r[i + 1][2]] as [number, number, boolean]);
  const all = [...right, ...left];
  const pts: Vec2[] = all.map(([b, t]) => [b, t]);
  const slots = all.map((p) => (p[2] ? SLOT.black : SLOT.ceramic));
  return { pts, slots };
}

export interface GirderSpec {
  kind: Kind;
  curve: Curve;
  u0: number;
  u1: number;
  trimStart?: Plane;
  trimEnd?: Plane;
}

/** Sweep ring spacing: the collars' arches are tight (r = 48 m); everything else is gently curved. */
const RING_STEP: Record<Kind, number> = { rail: 6, rib: 6, tie: 6, eave: 6, post: 6, arch: 2 };

interface Shop {
  table: ArcTable;
  length: number;
}

function shop(g: GirderSpec): Shop {
  const table = arcTable(g.curve, g.u0, g.u1, 2048);
  return { table, length: table.length };
}

/** One shop length's girder, swept along its curve on S. */
export function buildGirder(g: GirderSpec): PolyMesh {
  const { table, length } = shop(g);
  const n = Math.max(2, Math.ceil(length / RING_STEP[g.kind]));
  const pts = Array.from({ length: n + 1 }, (_, i) => g.curve(table.uAt((length * i) / n)));
  const frames = framesFrom(pts, pts.map(normalAt));
  return sweep(frames, (f: Frame) => girderSection(g.kind, memberT0(f.p[1]), memberT1(g.kind, f.p[1])), { trimStart: g.trimStart, trimEnd: g.trimEnd, crease: 28 });
}

/** Arc positions of a shop length's stiffeners: panels about GIRDER.panel × its depth long. */
export function stiffenerPositions(g: GirderSpec): number[] {
  const { table, length } = shop(g);
  const y = g.curve(table.uAt(length / 2))[1];
  const panels = Math.max(1, Math.round(length / (GIRDER.panel * (memberT1(g.kind, y) - memberT0(y)))));
  return Array.from({ length: panels - 1 }, (_, k) => (length * (k + 1)) / panels);
}

/**
 * A shop length's web stiffeners, a pair at each panel point, as one part (one closed plate per
 * component). Each plate fills the recess from the web to just inside the flange edges.
 */
export function buildStiffeners(g: GirderSpec): PolyMesh | null {
  const { table } = shop(g);
  const at = stiffenerPositions(g);
  if (!at.length) return null;
  const mesh = new PolyMesh(30);
  const half = GIRDER.stiffenerWidth / 2;
  const snip = 0.16;
  for (const s of at) {
    const u = table.uAt(s);
    const p = g.curve(u);
    const N = normalAt(p);
    const t = tangent(g.curve, u);
    const T = v3.norm(v3.sub(t, v3.scale(N, v3.dot(t, N))));
    const B = v3.cross(N, T);
    const t0 = memberT0(p[1]);
    const t1 = memberT1(g.kind, p[1]);
    const d = sectionDims(g.kind, t0, t1);
    const ta = t0 + d.fb - GIRDER.seat;
    const tb = t1 - d.ft + GIRDER.seat;
    const b0 = d.web - GIRDER.seat;
    const b1 = d.hw - GIRDER.stiffenerInset;
    for (const side of [-1, 1]) {
      // Counter-clockwise in (b, t) for the +b plate; mirrored (and reversed) for the −b plate.
      let pl: Vec2[] = [[b0 + snip, ta], [b1, ta], [b1, tb], [b0 + snip, tb], [b0, tb - snip], [b0, ta + snip]];
      if (side < 0) pl = pl.map(([b, tt]) => [-b, tt] as Vec2).reverse();
      const frames: Frame[] = [-half, half].map((o) => ({ p: v3.add(p, v3.scale(T, o)), t: T, n: N, b: B, s: o + half }));
      mesh.append(sweep(frames, { pts: pl, slots: pl.map(() => SLOT.ceramic) }));
    }
  }
  return mesh;
}
