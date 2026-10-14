/**
 * The Dome's primary frame: Axis Bands, coffer ribs, band ties, the Eave Ring, drum posts and the
 * four collars, joined by cast nodes and set on plinths on the platform's steps.
 *
 * Layout (docs/dome.md): every member is a section of S (surface.ts) swept with a dressed girder
 * profile, offset outward from the glass. Junctions follow nodes.ts: nothing crosses a band; ribs
 * end on band rails and on the Eave Ring; the drum posts carry the Eave Ring's nodes down to the
 * sill. Members taper to the sill depth over the lower drum so their outer faces land on the
 * bottom step.
 */
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { framesFrom, girderProfile, sampleCurve, sweep, type Frame, type Plane, type Profile } from '../../geometry/sweep';
import { PAD_HEIGHT, SITE } from '../../ground/site';
import { DOME, EAVE_Y, FOOT_SINK, GASKET_Y, LAYER, MEMBER, POST_T1_SILL } from './spec';
import { Node, type NodeMember } from './nodes';
import {
  CARDINALS, collarCurve, heightAt, lateralSection, meridian, meridianParam, normalAt, planeSection, planeSectionParam, ring, solve, tangent, type Curve,
} from './surface';

export const SLOT = { ceramic: 0, bronze: 1, black: 2 } as const;
export const FRAME_SLOTS = 3;

export interface Part {
  name: string;
  mesh: PolyMesh;
}

type Kind = keyof typeof MEMBER;

/** Members end this far below the sill inside their plinths. */
const FOOT_Y = 1.0;
/** Height over which drum members taper from the sill depth to their full depth. */
const TAPER_TOP = 40;
/** Plinth: margin around the member's base section and height above the bottom tread. */
const PLINTH_MARGIN = 0.08;
const PLINTH_TOP = 2.4;
/** Height at which the West Gate's gatehouse receives the Spinward rails (gate.ts owns it). */
export const GATEHOUSE_RAIL_Y = 29.0;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Outer offset of a member at height y: tapered to the sill depth near the base. */
function memberT1(kind: Kind, y: number, tapered: boolean): number {
  const full = MEMBER[kind].t1;
  if (!tapered) return full;
  const sill = POST_T1_SILL - PLINTH_MARGIN;
  return sill + (full - sill) * smooth(FOOT_Y + 1, TAPER_TOP, y);
}

/** Inner offset at height y: the gasket line, standing off further near the sill. */
function memberT0(y: number): number {
  return LAYER.memberT0Sill + (LAYER.memberT0 - LAYER.memberT0Sill) * smooth(PAD_HEIGHT + 1, GASKET_Y, y);
}

/**
 * The dressed section. Its shadow grooves are black linings (glazed black ceramic, inlaid): one along
 * each side of every member, two on the heavy members (bands, collars, the Eave Ring).
 */
function profileFor(kind: Kind, t1: number, t0: number): Profile {
  const hw = MEMBER[kind].halfWidth;
  const depth = t1 - t0;
  const top = Math.min(0.32, 0.09 * depth + 0.05);
  const heavy = kind === 'rail' || kind === 'arch' || kind === 'eave';
  const gd = heavy ? 0.08 : 0.05;
  const upper: [number, number, number] = [t1 - 0.62 - 0.08 * depth, t1 - 0.4 - 0.06 * depth, gd];
  const lower: [number, number, number] = [t0 + 0.28 + 0.05 * depth, t0 + 0.42 + 0.06 * depth, gd * 0.8];
  const grooves = heavy ? [lower, upper] : [upper];
  const p = girderProfile({ halfWidth: hw, t0, t1, chamferBottom: 0.06, chamferTop: top, grooves });
  if (p.slots) {
    // Every edge inside a groove (|b| < hw) is lining.
    const pts = p.pts;
    p.slots = p.slots.map((sl, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const inGroove = (q: number[]) => Math.abs(q[0]) < hw - 1e-6 && q[1] > t0 + 0.1 && q[1] < t1 - top - 1e-6;
      return inGroove(a) || inGroove(b) ? SLOT.black : sl;
    });
  }
  return p;
}

interface MemberSpec {
  name: string;
  kind: Kind;
  curve: Curve;
  u0: number;
  u1: number;
  trimStart?: Plane;
  trimEnd?: Plane;
  tapered?: boolean;
}

function buildMember(m: MemberSpec): PolyMesh {
  const { p } = sampleCurve(m.curve, m.u0, m.u1, 2.0, 2);
  const frames = framesFrom(p, p.map(normalAt));
  return sweep(frames, (f: Frame) => profileFor(m.kind, memberT1(m.kind, f.p[1], !!m.tapered), memberT0(f.p[1])), { trimStart: m.trimStart, trimEnd: m.trimEnd, crease: 28 });
}

// --- bindings ------------------------------------------------------------------------------------

/** Binding collars: width along the member, how far proud of it, and the spacing between joints. */
const BINDING = { width: 0.9, proud: 0.07, under: 0.03, bevel: 0.05, spacing: 18, endClear: 2.6, nodeClear: 0.7 } as const;

/** Arc-length ↔ parameter table along a curve. */
function arcTable(curve: Curve, u0: number, u1: number, n = 1024): { length: number; uAt(s: number): number; sAt(u: number): number } {
  const us: number[] = [];
  const ss: number[] = [0];
  let prev = curve(u0);
  us.push(u0);
  for (let i = 1; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const q = curve(u);
    ss.push(ss[i - 1] + v3.dist(q, prev));
    us.push(u);
    prev = q;
  }
  const look = (xs: number[], ys: number[], x: number) => {
    let j = 0;
    while (j < n - 1 && xs[j + 1] < x) j++;
    const f = xs[j + 1] > xs[j] ? (x - xs[j]) / (xs[j + 1] - xs[j]) : 0;
    return ys[j] + (ys[j + 1] - ys[j]) * Math.min(Math.max(f, 0), 1);
  };
  const inc = u1 >= u0;
  return {
    length: ss[n],
    uAt: (sv) => look(ss, us, sv),
    sAt: (u) => (inc ? look(us, ss, u) : look(us.map((x) => -x), ss, -u)),
  };
}

/**
 * Where a member's bindings go: a pair flanking every joint (its ends and every node it passes
 * through), then evenly between them at about BINDING.spacing. Returns band centres (arc length).
 */
function bindingCentres(m: MemberSpec, nodes: Node[], table: ReturnType<typeof arcTable>): number[] {
  const L = table.length;
  const half = BINDING.width / 2;
  // Joints as [arc position, clearance either side]. A node the member ends in lies beyond its
  // end, so that end keeps the node's whole extent clear.
  const joints: [number, number][] = [[0, BINDING.endClear], [L, BINDING.endClear]];
  const ends = [m.curve(table.uAt(0)), m.curve(table.uAt(L))];
  const samples = 2048;
  for (const n of nodes) {
    const reach = Math.hypot(n.h1, n.h2) + BINDING.nodeClear;
    for (const [ei, e] of ends.entries()) {
      if (v3.dist(e, n.p) < reach + 1) joints[ei][1] = Math.max(joints[ei][1], reach);
    }
    // Nearest point of the curve to the node's centre (coarse, then refined).
    let best = Infinity;
    let bs = 0;
    for (let i = 0; i <= samples; i++) {
      const sv = (L * i) / samples;
      const d = v3.dist(m.curve(table.uAt(sv)), n.p);
      if (d < best) {
        best = d;
        bs = sv;
      }
    }
    let step = L / samples;
    for (let k = 0; k < 20; k++) {
      step *= 0.5;
      for (const sv of [bs - step, bs + step]) {
        if (sv < 0 || sv > L) continue;
        const d = v3.dist(m.curve(table.uAt(sv)), n.p);
        if (d < best) {
          best = d;
          bs = sv;
        }
      }
    }
    if (best > 0.25 || bs < 0.5 || bs > L - 0.5) continue;
    joints.push([bs, reach]);
  }
  joints.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (let i = 0; i + 1 < joints.length; i++) {
    const a = joints[i][0] + joints[i][1] + half;
    const b = joints[i + 1][0] - joints[i + 1][1] - half;
    if (b - a < BINDING.width * 1.5) {
      if (b - a > -BINDING.width * 0.2 && b > a - 0.1) out.push((a + b) / 2);
      continue;
    }
    const gaps = Math.max(1, Math.round((b - a) / BINDING.spacing));
    for (let k = 0; k <= gaps; k++) out.push(a + ((b - a) * k) / gaps);
  }
  return out.filter((c) => c - half > 0.2 && c + half < L - 0.2);
}

/** A binding collar round the member at arc position c: a bevelled black sleeve, proud all round. */
function binding(m: MemberSpec, table: ReturnType<typeof arcTable>, c: number): PolyMesh {
  const half = BINDING.width / 2;
  const at = [c - half, c - half + BINDING.bevel, c + half - BINDING.bevel, c + half];
  const pts = at.map((sv) => m.curve(table.uAt(sv)));
  const frames = framesFrom(pts, pts.map(normalAt));
  return sweep(
    frames,
    (fr: Frame, i: number) => {
      const t1 = memberT1(m.kind, fr.p[1], !!m.tapered);
      const t0 = memberT0(fr.p[1]);
      const k = i === 0 || i === 3 ? 0.45 : 1;
      const hw = MEMBER[m.kind].halfWidth + BINDING.proud * k;
      const pr = girderProfile({ halfWidth: hw, t0: t0 - BINDING.under * k, t1: t1 + BINDING.proud * k, chamferBottom: 0.04, chamferTop: Math.min(0.32, 0.09 * (t1 - t0) + 0.05) + 0.02 });
      return { pts: pr.pts, slots: pr.pts.map(() => SLOT.black) };
    },
    { crease: 28, capSlot: SLOT.black },
  );
}

export function buildBindings(layout: FrameLayout): Part[] {
  const out: Part[] = [];
  for (const m of layout.members) {
    const table = arcTable(m.curve, m.u0, m.u1);
    bindingCentres(m, layout.nodes, table).forEach((c, i) => out.push({ name: `binding:${m.name}:${i}`, mesh: binding(m, table, c) }));
  }
  return out;
}

/** u at which a curve crosses a plane, between u0 (one side) and u1 (other side). */
function crossing(curve: Curve, u0: number, u1: number, plane: Plane): number {
  return solve(curve, u0, u1, (q) => v3.dot(v3.sub(q, plane.point), plane.normal));
}

/**
 * A member segment between two junctions. `a`/`b` give the node and family at each end (or none:
 * the curve's own end). The member is trimmed on each node's plane.
 */
function segment(name: string, kind: Kind, curve: Curve, uA: number, uB: number, a: { node: Node; family: 1 | 2 } | null, b: { node: Node; family: 1 | 2 } | null, tapered = false): MemberSpec {
  const mid = curve(0.5 * (uA + uB));
  let u0 = uA;
  let u1 = uB;
  let trimStart: Plane | undefined;
  let trimEnd: Plane | undefined;
  if (a) {
    trimStart = a.node.trim(a.family, mid);
    u0 = crossing(curve, uA, 0.5 * (uA + uB), trimStart);
  }
  if (b) {
    trimEnd = b.node.trim(b.family, mid);
    u1 = crossing(curve, 0.5 * (uA + uB), uB, trimEnd);
  }
  return { name, kind, curve, u0, u1, trimStart, trimEnd, tapered };
}

/** Direction of a curve at u, pointing toward increasing u (sign = +1) or decreasing u (−1). */
function dirAt(curve: Curve, u: number, sign: 1 | -1): Vec3 {
  return v3.scale(tangent(curve, u), sign);
}

export interface FrameLayout {
  nodes: Node[];
  members: MemberSpec[];
  /** Feet: member bottoms standing on the steps (for plinths). */
  feet: { name: string; kind: Kind; curve: Curve; u: number }[];
}

export function frameLayout(): FrameLayout {
  const H = DOME.bandHalf;
  const R = DOME.ribs;
  const signed = [...R.map((r) => -r).reverse(), ...R];
  const nodes: Node[] = [];
  const members: MemberSpec[] = [];
  const feet: FrameLayout['feet'] = [];
  const W = MEMBER;

  const spinRail = (sz: number) => planeSection('z', sz * H);
  const merRail = (sx: number) => planeSection('x', sx * H);
  const xRib = (x: number) => planeSection('x', x);
  const zRib = (z: number) => planeSection('z', z);
  // θ along a plane section where the in-plane coordinate is w.
  const th = (axis: 'x' | 'z', k: number, w: number) => planeSectionParam(axis, k, w);

  // --- Crown: Spinward rails continuous, Meridian rails end. -----------------------------------
  const crown = new Map<string, Node>();
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const p = spinRail(sz)(th('z', sz * H, sx * H));
      const n = new Node(`node:crown:${sx}:${sz}`, p, tangent(spinRail(sz), th('z', sz * H, sx * H)), tangent(merRail(sx), th('x', sx * H, sz * H)), W.rail.halfWidth, W.rail.halfWidth);
      const uS = th('z', sz * H, sx * H);
      const uM = th('x', sx * H, sz * H);
      n.fit([
        { dir: dirAt(spinRail(sz), uS, 1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 1, continuous: true },
        { dir: dirAt(merRail(sx), uM, 1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 2, continuous: false },
        { dir: dirAt(merRail(sx), uM, -1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      crown.set(`${sx}:${sz}`, n);
    }
  }

  // --- Band nodes: a rib and a tie meet each rail. ----------------------------------------------
  const spinBand = new Map<string, Node>();
  const merBand = new Map<string, Node>();
  for (const x of signed) {
    for (const sz of [-1, 1]) {
      const uR = th('z', sz * H, x);
      const uX = th('x', x, sz * H);
      const n = new Node(`node:spinward:${x}:${sz}`, spinRail(sz)(uR), tangent(spinRail(sz), uR), tangent(xRib(x), uX), W.rail.halfWidth, W.rib.halfWidth);
      // Increasing θ on an x-section decreases z: the rib lies on the |z| > H side.
      const ribSign: 1 | -1 = sz > 0 ? -1 : 1;
      n.fit([
        { dir: dirAt(spinRail(sz), uR, 1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 1, continuous: true },
        { dir: dirAt(xRib(x), uX, ribSign), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 2, continuous: false },
        { dir: dirAt(xRib(x), uX, (-ribSign) as 1 | -1), halfWidth: W.tie.halfWidth, t1: W.tie.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      spinBand.set(`${x}:${sz}`, n);
    }
  }
  for (const z of signed) {
    for (const sx of [-1, 1]) {
      const uR = th('x', sx * H, z);
      const uZ = th('z', z, sx * H);
      const n = new Node(`node:meridian:${z}:${sx}`, merRail(sx)(uR), tangent(merRail(sx), uR), tangent(zRib(z), uZ), W.rail.halfWidth, W.rib.halfWidth);
      const ribSign: 1 | -1 = sx > 0 ? -1 : 1;
      n.fit([
        { dir: dirAt(merRail(sx), uR, 1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 1, continuous: true },
        { dir: dirAt(zRib(z), uZ, ribSign), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 2, continuous: false },
        { dir: dirAt(zRib(z), uZ, (-ribSign) as 1 | -1), halfWidth: W.tie.halfWidth, t1: W.tie.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      merBand.set(`${z}:${sx}`, n);
    }
  }

  // --- Coffer crossings inside each quadrant. ----------------------------------------------------
  const inside = (x: number, z: number) => x * x + z * z < DOME.eaveR ** 2 - 1;
  const quad = new Map<string, Node>();
  for (const x of signed) {
    for (const z of signed) {
      if (!inside(x, z)) continue;
      const uX = th('x', x, z);
      const uZ = th('z', z, x);
      const n = new Node(`node:coffer:${x}:${z}`, xRib(x)(uX), tangent(xRib(x), uX), tangent(zRib(z), uZ), W.rib.halfWidth, W.rib.halfWidth);
      n.fit([
        { dir: dirAt(xRib(x), uX, 1), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 1, continuous: false },
        { dir: dirAt(xRib(x), uX, -1), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 1, continuous: false },
        { dir: dirAt(zRib(z), uZ, 1), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 2, continuous: false },
        { dir: dirAt(zRib(z), uZ, -1), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      quad.set(`${x}:${z}`, n);
    }
  }

  // --- Eave nodes: where ribs land on the Eave Ring; a drum post continues each down. -----------
  const eaveRing = ring(DOME.eaveR);
  interface EaveLanding {
    phi: number;
    ribs: { curve: Curve; u: number; sign: 1 | -1; name: string }[];
  }
  const landings: EaveLanding[] = [];
  const addLanding = (x: number, z: number, rib: { curve: Curve; u: number; sign: 1 | -1; name: string }) => {
    const phi = Math.atan2(z, x);
    const hit = landings.find((l) => Math.abs(Math.atan2(Math.sin(l.phi - phi), Math.cos(l.phi - phi))) < 1e-6);
    if (hit) hit.ribs.push(rib);
    else landings.push({ phi, ribs: [rib] });
  };
  for (const x of signed) {
    const Z = Math.sqrt(DOME.eaveR ** 2 - x * x);
    for (const sz of [-1, 1]) {
      const u = th('x', x, sz * Z);
      // Toward the crown: increasing θ when z > 0.
      addLanding(x, sz * Z, { curve: xRib(x), u, sign: sz > 0 ? 1 : -1, name: `x${x}` });
    }
  }
  for (const z of signed) {
    const X = Math.sqrt(DOME.eaveR ** 2 - z * z);
    for (const sx of [-1, 1]) {
      const u = th('z', z, sx * X);
      addLanding(sx * X, z, { curve: zRib(z), u, sign: sx > 0 ? 1 : -1, name: `z${z}` });
    }
  }
  landings.sort((p, q) => p.phi - q.phi);
  const eaveNodes: { phi: number; node: Node }[] = [];
  for (const l of landings) {
    const p = eaveRing(l.phi);
    const post = meridian(l.phi);
    const uP = meridianParam(p[1]);
    const n = new Node(`node:eave:${((l.phi * 180) / Math.PI).toFixed(1)}`, p, tangent(eaveRing, l.phi), tangent(post, uP), W.eave.halfWidth, W.post.halfWidth);
    n.fit([
      { dir: dirAt(eaveRing, l.phi, 1), halfWidth: W.eave.halfWidth, t1: W.eave.t1, family: 1, continuous: true },
      { dir: dirAt(post, uP, -1), halfWidth: W.post.halfWidth, t1: W.post.t1, family: 2, continuous: false },
      ...l.ribs.map((r): NodeMember => ({ dir: dirAt(r.curve, r.u, r.sign), halfWidth: W.rib.halfWidth, t1: W.rib.t1, family: 2, continuous: false })),
    ]);
    nodes.push(n);
    eaveNodes.push({ phi: l.phi, node: n });
    // The drum post: from inside its plinth up to the eave node.
    members.push(segment(`post:${n.name.slice(10)}`, 'post', post, meridianParam(FOOT_Y), uP, null, { node: n, family: 2 }, true));
    feet.push({ name: `post:${n.name.slice(10)}`, kind: 'post', curve: post, u: meridianParam(FOOT_Y) });
  }

  // --- Collars: arch nodes with the rails and the Eave Ring. -------------------------------------
  const archNodes = new Map<string, { rail: Node[]; eave: Node[] }>();
  const archInfo = new Map<string, ReturnType<typeof collarCurve>>();
  const { radius: AR, centreY: AY } = DOME.arch;
  const eaveLat = Math.sqrt(AR * AR - (EAVE_Y - AY) ** 2);
  for (const k of CARDINALS) {
    const info = collarCurve(k, FOOT_Y);
    archInfo.set(k.name, info);
    const psiAt = (w: number) => Math.asin(w / AR);
    const railNodes: Node[] = [];
    for (const s of [-1, 1]) {
      const psi = psiAt(s * H);
      const u = info.uOfPsi(psi);
      const rail = lateralSection(k, s * H);
      const p = info.curve(u);
      const n = new Node(`node:collar:${k.name}:rail${s}`, p, tangent(info.curve, u), tangent(rail, p[1]), W.arch.halfWidth, W.rail.halfWidth);
      n.fit([
        { dir: dirAt(info.curve, u, 1), halfWidth: W.arch.halfWidth, t1: W.arch.t1, family: 1, continuous: true },
        { dir: dirAt(rail, p[1], 1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 2, continuous: false },
        { dir: dirAt(rail, p[1], -1), halfWidth: W.rail.halfWidth, t1: W.rail.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      railNodes.push(n);
    }
    const eaveN: Node[] = [];
    for (const s of [-1, 1]) {
      const psi = psiAt(s * eaveLat);
      const u = info.uOfPsi(psi);
      const p = info.curve(u);
      const phi = Math.atan2(p[2], p[0]);
      const n = new Node(`node:collar:${k.name}:eave${s}`, p, tangent(info.curve, u), tangent(eaveRing, phi), W.arch.halfWidth, W.eave.halfWidth);
      // The Eave Ring arrives from outside the collar (larger |lateral|).
      const outward = v3.sub(eaveRing(phi + 0.01), eaveRing(phi - 0.01));
      const latDir: Vec3 = [k.lat[0] * s, 0, k.lat[1] * s];
      const eaveSign: 1 | -1 = v3.dot(outward, latDir) > 0 ? 1 : -1;
      n.fit([
        { dir: dirAt(info.curve, u, 1), halfWidth: W.arch.halfWidth, t1: W.arch.t1, family: 1, continuous: true },
        { dir: dirAt(eaveRing, phi, eaveSign), halfWidth: W.eave.halfWidth, t1: W.eave.t1, family: 2, continuous: false },
      ]);
      nodes.push(n);
      eaveN.push(n);
    }
    archNodes.set(k.name, { rail: railNodes, eave: eaveN });
    members.push({ name: `collar:${k.name}`, kind: 'arch', curve: info.curve, u0: 0, u1: 1, tapered: true });
    feet.push({ name: `collar:${k.name}:-`, kind: 'arch', curve: info.curve, u: 0 });
    feet.push({ name: `collar:${k.name}:+`, kind: 'arch', curve: info.curve, u: 1 });
  }

  // --- Eave Ring: four arcs, collar to collar, continuous through the eave nodes. ----------------
  for (let i = 0; i < 4; i++) {
    const k0 = CARDINALS[i];
    const k1 = CARDINALS[(i + 1) % 4];
    const n0 = archNodes.get(k0.name)!.eave;
    const n1 = archNodes.get(k1.name)!.eave;
    // The collar-eave node on k0's side facing k1, and k1's facing k0.
    const phiOf = (n: Node) => Math.atan2(n.p[2], n.p[0]);
    const start = n0.reduce((best, n) => (angDiff(phiOf(n), k1.phi) < angDiff(phiOf(best), k1.phi) ? n : best));
    const end = n1.reduce((best, n) => (angDiff(phiOf(n), k0.phi) < angDiff(phiOf(best), k0.phi) ? n : best));
    const p0 = phiOf(start);
    let p1 = phiOf(end);
    while (p1 < p0) p1 += 2 * Math.PI;
    while (p1 - p0 > 2 * Math.PI) p1 -= 2 * Math.PI;
    members.push(segment(`eave:${k0.name}-${k1.name}`, 'eave', eaveRing, p0, p1, { node: start, family: 2 }, { node: end, family: 2 }));
  }

  // --- Spinward rails: W foot (gatehouse) → W collar → over the crown → E collar → E foot. -------
  for (const sz of [-1, 1]) {
    const c = spinRail(sz);
    const east = archNodes.get('east')!.rail.find((n) => Math.sign(n.p[2]) === sz)!;
    const west = archNodes.get('west')!.rail.find((n) => Math.sign(n.p[2]) === sz)!;
    const uE = th('z', sz * H, east.p[0]);
    const uW = th('z', sz * H, west.p[0]);
    const uFootE = (FOOT_Y - DOME.centreY) / ((DOME.c * Math.sqrt(DOME.a ** 2 - H * H)) / DOME.a);
    const C = (DOME.c * Math.sqrt(DOME.a ** 2 - H * H)) / DOME.a;
    const uGate = Math.PI + (DOME.centreY - GATEHOUSE_RAIL_Y) / C;
    const uGateUpper = Math.PI - Math.asin((GATEHOUSE_RAIL_Y - DOME.centreY) / C);
    const uWest = GATEHOUSE_RAIL_Y >= DOME.centreY ? uGateUpper : uGate;
    members.push(segment(`rail:spinward:${sz}:east-foot`, 'rail', c, uFootE, uE, null, { node: east, family: 2 }, true));
    feet.push({ name: `rail:spinward:${sz}:east`, kind: 'rail', curve: c, u: uFootE });
    members.push(segment(`rail:spinward:${sz}`, 'rail', c, uE, uW, { node: east, family: 2 }, { node: west, family: 2 }));
    members.push(segment(`rail:spinward:${sz}:west-foot`, 'rail', c, uW, uWest, { node: west, family: 2 }, null, true));
  }

  // --- Meridian rails: S foot → S collar → crown nodes → N collar → N foot. -----------------------
  for (const sx of [-1, 1]) {
    const c = merRail(sx);
    const south = archNodes.get('south')!.rail.find((n) => Math.sign(n.p[0]) === sx)!;
    const north = archNodes.get('north')!.rail.find((n) => Math.sign(n.p[0]) === sx)!;
    const cs = crown.get(`${sx}:1`)!;
    const cn = crown.get(`${sx}:-1`)!;
    const C = (DOME.c * Math.sqrt(DOME.a ** 2 - H * H)) / DOME.a;
    const uFootS = (FOOT_Y - DOME.centreY) / C;
    const uFootN = Math.PI + (DOME.centreY - FOOT_Y) / C;
    const uS = th('x', sx * H, south.p[2]);
    const uN = th('x', sx * H, north.p[2]);
    const uCS = th('x', sx * H, cs.p[2]);
    const uCN = th('x', sx * H, cn.p[2]);
    members.push(segment(`rail:meridian:${sx}:south-foot`, 'rail', c, uFootS, uS, null, { node: south, family: 2 }, true));
    feet.push({ name: `rail:meridian:${sx}:south`, kind: 'rail', curve: c, u: uFootS });
    members.push(segment(`rail:meridian:${sx}:south`, 'rail', c, uS, uCS, { node: south, family: 2 }, { node: cs, family: 2 }));
    members.push(segment(`rail:meridian:${sx}:crown`, 'rail', c, uCS, uCN, { node: cs, family: 2 }, { node: cn, family: 2 }));
    members.push(segment(`rail:meridian:${sx}:north`, 'rail', c, uCN, uN, { node: cn, family: 2 }, { node: north, family: 2 }));
    members.push(segment(`rail:meridian:${sx}:north-foot`, 'rail', c, uN, uFootN, { node: north, family: 2 }, null, true));
    feet.push({ name: `rail:meridian:${sx}:north`, kind: 'rail', curve: c, u: uFootN });
  }

  // --- Ribs: eave → coffer nodes → band rail, on both sides of each band. ------------------------
  const eaveNodeAt = (x: number, z: number) => {
    const phi = Math.atan2(z, x);
    return eaveNodes.find((e) => angDiff(e.phi, phi) < 1e-6)!.node;
  };
  const ribRun = (axis: 'x' | 'z', k: number, side: -1 | 1) => {
    const curve = axis === 'x' ? xRib(k) : zRib(k);
    const along = Math.sqrt(DOME.eaveR ** 2 - k * k);
    // Stops from the eave inward: (in-plane coordinate, node, family at that node).
    const stops: { w: number; node: Node; family: 1 | 2 }[] = [];
    stops.push({ w: side * along, node: axis === 'x' ? eaveNodeAt(k, side * along) : eaveNodeAt(side * along, k), family: 2 });
    const cross = [...R].reverse().filter((r) => r < along - 1e-6);
    for (const r of cross) {
      const node = axis === 'x' ? quad.get(`${k}:${side * r}`) : quad.get(`${side * r}:${k}`);
      if (node) stops.push({ w: side * r, node, family: axis === 'x' ? 1 : 2 });
    }
    const bandNode = axis === 'x' ? spinBand.get(`${k}:${side}`)! : merBand.get(`${k}:${side}`)!;
    stops.push({ w: side * H, node: bandNode, family: 2 });
    for (let i = 0; i + 1 < stops.length; i++) {
      const A = stops[i];
      const B = stops[i + 1];
      const uA = th(axis, k, A.w);
      const uB = th(axis, k, B.w);
      members.push(segment(`rib:${axis}${k}:${side}:${i}`, 'rib', curve, uA, uB, { node: A.node, family: A.family }, { node: B.node, family: B.family }));
    }
  };
  for (const k of signed) {
    for (const side of [-1, 1] as const) {
      ribRun('x', k, side);
      ribRun('z', k, side);
    }
  }

  // --- Band ties: across each band at every rib. ---------------------------------------------------
  for (const x of signed) {
    const curve = xRib(x);
    const nA = spinBand.get(`${x}:1`)!;
    const nB = spinBand.get(`${x}:-1`)!;
    members.push(segment(`tie:spinward:${x}`, 'tie', curve, th('x', x, H), th('x', x, -H), { node: nA, family: 2 }, { node: nB, family: 2 }));
  }
  for (const z of signed) {
    const curve = zRib(z);
    const nA = merBand.get(`${z}:1`)!;
    const nB = merBand.get(`${z}:-1`)!;
    members.push(segment(`tie:meridian:${z}`, 'tie', curve, th('z', z, H), th('z', z, -H), { node: nA, family: 2 }, { node: nB, family: 2 }));
  }

  return { nodes, members, feet };
}

function angDiff(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * A plinth under a member's foot: a dressed block standing on the two lower treads (and tucked
 * into the platform edge), its outer face a reveal inside the bottom riser, crowned by a chamfer
 * the member rises out of.
 */
function plinth(name: string, kind: Kind, curve: Curve, u: number): Part {
  const p = curve(u);
  // Horizontal frame at the foot: out = S's normal there (horizontal), across = along the sill.
  const out = v3.norm([p[0], 0, p[2]]);
  const across: Vec3 = [-out[2], 0, out[0]];
  const hw = MEMBER[kind].halfWidth + PLINTH_MARGIN;
  // Inner face 70 mm proud of the member, 30 mm clear of the glass's sill channel.
  const rIn = DOME.a + LAYER.memberT0Sill - 0.07;
  const rOut = DOME.a + POST_T1_SILL;
  const tread = SITE.stepTread;
  const rise = SITE.stepRise;
  const rStep = SITE.padRadius + tread - FOOT_SINK; // the bottom tread starts here (inside the middle riser)
  const yMid = PAD_HEIGHT - rise - FOOT_SINK; // seat on the middle tread
  const yLow = PAD_HEIGHT - 2 * rise - FOOT_SINK; // seat on the bottom tread
  const top = PLINTH_TOP;
  const cap = 0.22;
  // Section in (r, y), counter-clockwise seen from +across... built as a closed polygon and
  // extruded along `across`.
  // The inner face drops through the platform's edge stone to the middle tread's seat.
  const sec: [number, number][] = [
    [rIn, yMid],
    [rStep, yMid],
    [rStep, yLow],
    [rOut, yLow],
    [rOut, top - cap],
    [rOut - cap, top],
    [rIn + cap, top],
    [rIn, top - cap],
  ];
  const mesh = new PolyMesh(25);
  const at = (r: number, y: number, s: number): Vec3 => [out[0] * r + across[0] * s, y, out[2] * r + across[2] * s];
  // Chamfer the vertical edges of the block by stepping the across-extent at the outer corners.
  const ch = 0.1;
  const ringAt = (s: number, inset: number) => sec.map(([r, y]) => {
    // Inset only the outermost and innermost faces toward the block's ends (vertical edge chamfer).
    let rr = r;
    if (Math.abs(r - rOut) < 1e-9 || Math.abs(r - (rOut - cap)) < 1e-9) rr = r - inset;
    if (Math.abs(r - rIn) < 1e-9 || Math.abs(r - (rIn + cap)) < 1e-9) rr = r + inset;
    return mesh.vert(at(rr, y, s));
  });
  const rings = [ringAt(-hw, ch), ringAt(-hw + ch, 0), ringAt(hw - ch, 0), ringAt(hw, ch)];
  const n = sec.length;
  // sec is counter-clockwise in (out, up); sweeping along +across, quads face outward when
  // (out, up, across) is right-handed.
  const flip = v3.dot(v3.cross(out, [0, 1, 0]), across) < 0;
  const orient = (q: number[]) => (flip ? q.reverse() : q);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      mesh.face(orient([rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]]), SLOT.ceramic);
    }
  }
  mesh.face(orient([...rings[0]].reverse()), SLOT.ceramic);
  mesh.face(orient([...rings[rings.length - 1]]), SLOT.ceramic);
  return { name: `plinth:${name}`, mesh };
}

/** Builds every frame part (members, nodes, plinths) as named meshes for audit and emission. */
export function buildFrameParts(layout = frameLayout()): Part[] {
  const parts: Part[] = [];
  for (const m of layout.members) parts.push({ name: `member:${m.name}`, mesh: buildMember(m) });
  for (const n of layout.nodes) parts.push({ name: n.name, mesh: n.mesh(SLOT.bronze) });
  for (const f of layout.feet) parts.push(plinth(f.name, f.kind, f.curve, f.u));
  parts.push(...buildBindings(layout));
  return parts;
}

export { heightAt };
