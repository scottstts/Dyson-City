/**
 * The Dome's primary frame: Axis Bands, coffer ribs, band ties, the Eave Ring, drum posts and the
 * four collars, joined by cast nodes and set on plinths on the platform's steps.
 *
 * Layout (docs/dome.md): every member is a section of S (surface.ts) swept as a fabricated girder
 * (girder.ts), offset outward from the glass. The frame is a graph: each run (a band rail, a rib
 * line, the Eave Ring, a post, a collar) is cut at every node it meets into members, and each
 * member ends on a bolted splice to its node's cast arm (nodes.ts, splice.ts); runs longer than a
 * shop length get field splices. Members taper to the sill depth over the lower drum so their outer
 * faces land on the bottom step, inside plinths with bolted base plates.
 */
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { arcTable, sweep, type Frame, type Plane, type Profile } from '../../geometry/sweep';
import { PAD_HEIGHT, SITE } from '../../ground/site';
import { pitchAlong, type Bolt } from './bolts';
import { buildGirder, buildStiffeners, memberT0, memberT1, sectionDims, type Kind } from './girder';
import { Node } from './nodes';
import { DOME, EAVE_Y, FOOT, FOOT_SINK, JOINT, LAYER, MEMBER, POST_T1_SILL } from './spec';
import { SLOT } from './slots';
import { spliceBolts, spliceFace, spliceMesh, spliceSite, type SpliceSite } from './splice';
import { CARDINALS, collarCurve, heightAt, meridian, meridianParam, planeSection, planeSectionParam, ring, type Curve } from './surface';

export { SLOT, FRAME_SLOTS } from './slots';

export interface Part {
  name: string;
  mesh: PolyMesh;
}

/** Height at which the West Gate's gatehouse receives the Spinward rails (gate.ts owns it). */
export const GATEHOUSE_RAIL_Y = 29.0;

/** One shop length of a member between two splices (or a splice and a free end). */
export interface MemberSpec {
  name: string;
  kind: Kind;
  curve: Curve;
  u0: number;
  u1: number;
  trimStart?: Plane;
  trimEnd?: Plane;
}

export interface FrameLayout {
  nodes: Node[];
  members: MemberSpec[];
  /** Field splices between shop lengths (node splices belong to their nodes). */
  splices: { name: string; site: SpliceSite }[];
  /** Feet: member bottoms standing on the steps (for plinths). */
  feet: { name: string; kind: Kind; curve: Curve; u: number }[];
}

/** A run's stop: a node (the run is cut there) or a free end (a foot, the gatehouse). */
type Stop = { u: number; node?: Node };

interface Link {
  name: string;
  kind: Kind;
  curve: Curve;
  a: Stop;
  b: Stop;
  armA: number;
  armB: number;
}

function angDiff(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export function frameLayout(): FrameLayout {
  const H = DOME.bandHalf;
  const R = DOME.ribs;
  const signed = [...R.map((r) => -r).reverse(), ...R];
  const nodes: Node[] = [];
  const links: Link[] = [];
  const feet: FrameLayout['feet'] = [];

  const spinRail = (sz: number) => planeSection('z', sz * H);
  const merRail = (sx: number) => planeSection('x', sx * H);
  const xRib = (x: number) => planeSection('x', x);
  const zRib = (z: number) => planeSection('z', z);
  const th = (axis: 'x' | 'z', k: number, w: number) => planeSectionParam(axis, k, w);
  const node = (name: string, p: Vec3) => {
    const n = new Node(name, p);
    nodes.push(n);
    return n;
  };

  /** Cuts a run at its stops (sorted by u) into links; `kind` names each link's member. */
  const run = (name: string, curve: Curve, stops: Stop[], kind: (a: Stop, b: Stop) => Kind, skip?: (a: Stop, b: Stop) => boolean) => {
    const sorted = [...stops].sort((p, q) => p.u - q.u);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [a, b] = [sorted[i], sorted[i + 1]];
      if (skip?.(a, b)) continue;
      const k = kind(a, b);
      links.push({ name: `${name}:${i}`, kind: k, curve, a, b, armA: a.node?.addArm(k, curve, a.u, 1) ?? -1, armB: b.node?.addArm(k, curve, b.u, -1) ?? -1 });
    }
  };

  // --- Nodes ---------------------------------------------------------------------------------------
  const crown = new Map<string, Node>();
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) crown.set(`${sx}:${sz}`, node(`node:crown:${sx}:${sz}`, spinRail(sz)(th('z', sz * H, sx * H))));
  const spinBand = new Map<string, Node>();
  const merBand = new Map<string, Node>();
  for (const k of signed) {
    for (const s of [-1, 1]) {
      spinBand.set(`${k}:${s}`, node(`node:spinward:${k}:${s}`, spinRail(s)(th('z', s * H, k))));
      merBand.set(`${k}:${s}`, node(`node:meridian:${k}:${s}`, merRail(s)(th('x', s * H, k))));
    }
  }
  const inside = (x: number, z: number) => x * x + z * z < DOME.eaveR ** 2 - 1;
  const coffer = new Map<string, Node>();
  for (const x of signed) for (const z of signed) if (inside(x, z)) coffer.set(`${x}:${z}`, node(`node:coffer:${x}:${z}`, xRib(x)(th('x', x, z))));

  // Eave nodes: where ribs land on the Eave Ring (one or two ribs each); a drum post carries each down.
  const eaveRing = ring(DOME.eaveR);
  const phis: number[] = [];
  const addPhi = (x: number, z: number) => {
    const phi = Math.atan2(z, x);
    if (!phis.some((q) => angDiff(q, phi) < 1e-6)) phis.push(phi);
  };
  for (const k of signed) {
    const w = Math.sqrt(DOME.eaveR ** 2 - k * k);
    for (const s of [-1, 1]) {
      addPhi(k, s * w);
      addPhi(s * w, k);
    }
  }
  phis.sort((p, q) => p - q);
  const eave = phis.map((phi) => ({ phi, node: node(`node:eave:${((phi * 180) / Math.PI).toFixed(1)}`, eaveRing(phi)) }));
  const eaveAt = (x: number, z: number) => eave.find((e) => angDiff(e.phi, Math.atan2(z, x)) < 1e-6)!.node;

  // Collars: nodes where the band rails and the Eave Ring meet each arch.
  const { radius: AR, centreY: AY } = DOME.arch;
  const eaveLat = Math.sqrt(AR * AR - (EAVE_Y - AY) ** 2);
  const collars = CARDINALS.map((k) => {
    const info = collarCurve(k, FOOT.y);
    const at = (w: number, tag: string) => {
      const u = info.uOfPsi(Math.asin(w / AR));
      return { u, node: node(`node:collar:${k.name}:${tag}`, info.curve(u)) };
    };
    return { k, info, rail: [at(-H, 'rail-1'), at(H, 'rail1')], eave: [at(-eaveLat, 'eave-1'), at(eaveLat, 'eave1')] };
  });
  const collar = (name: string) => collars.find((c) => c.k.name === name)!;

  // --- Runs ----------------------------------------------------------------------------------------
  const rail = () => 'rail' as Kind;
  // Drum posts: foot → eave node.
  for (const e of eave) {
    const post = meridian(e.phi);
    const tag = e.node.name.slice('node:eave:'.length);
    run(`post:${tag}`, post, [{ u: meridianParam(FOOT.y) }, { u: meridianParam(e.node.p[1]), node: e.node }], () => 'post');
    feet.push({ name: `post:${tag}`, kind: 'post', curve: post, u: meridianParam(FOOT.y) });
  }
  // Collars: foot → eave → rail → rail → eave → foot.
  for (const c of collars) {
    run(`collar:${c.k.name}`, c.info.curve, [{ u: 0 }, ...c.eave, ...c.rail, { u: 1 }], () => 'arch');
    feet.push({ name: `collar:${c.k.name}:-`, kind: 'arch', curve: c.info.curve, u: 0 });
    feet.push({ name: `collar:${c.k.name}:+`, kind: 'arch', curve: c.info.curve, u: 1 });
  }
  // The Eave Ring: round through every eave node, framing into each collar's flanks from outside.
  const ringStops: Stop[] = [...eave.map((e) => ({ u: e.phi, node: e.node })), ...collars.flatMap((c) => c.eave.map((e) => ({ u: Math.atan2(e.node.p[2], e.node.p[0]), node: e.node })))];
  ringStops.sort((p, q) => p.u - q.u);
  ringStops.push({ ...ringStops[0], u: ringStops[0].u + 2 * Math.PI });
  const sameCollar = (a: Stop, b: Stop) => !!a.node && !!b.node && a.node.name.startsWith('node:collar:') && a.node.name.split(':')[2] === b.node.name.split(':')[2];
  run('eave', eaveRing, ringStops, () => 'eave', sameCollar);

  // Spinward rails: E foot → E collar → over the crown → W collar → onto the gatehouse.
  const C = (DOME.c * Math.sqrt(DOME.a ** 2 - H * H)) / DOME.a;
  const uFootLow = (FOOT.y - DOME.centreY) / C;
  const uFootHigh = Math.PI + (DOME.centreY - FOOT.y) / C;
  const uGate = GATEHOUSE_RAIL_Y >= DOME.centreY ? Math.PI - Math.asin((GATEHOUSE_RAIL_Y - DOME.centreY) / C) : Math.PI + (DOME.centreY - GATEHOUSE_RAIL_Y) / C;
  for (const sz of [-1, 1]) {
    const c = spinRail(sz);
    const along = (n: Node) => ({ u: th('z', sz * H, n.p[0]), node: n });
    const stops: Stop[] = [{ u: uFootLow }, { u: uGate }];
    for (const name of ['east', 'west']) stops.push(along(collar(name).rail.find((r) => Math.sign(r.node.p[2]) === sz)!.node));
    for (const x of signed) stops.push(along(spinBand.get(`${x}:${sz}`)!));
    for (const sx of [-1, 1]) stops.push(along(crown.get(`${sx}:${sz}`)!));
    run(`rail:spinward:${sz}`, c, stops, rail);
    feet.push({ name: `rail:spinward:${sz}:east`, kind: 'rail', curve: c, u: uFootLow });
  }
  // Meridian rails: S foot → S collar → over the crown → N collar → N foot.
  for (const sx of [-1, 1]) {
    const c = merRail(sx);
    const along = (n: Node) => ({ u: th('x', sx * H, n.p[2]), node: n });
    const stops: Stop[] = [{ u: uFootLow }, { u: uFootHigh }];
    for (const name of ['south', 'north']) stops.push(along(collar(name).rail.find((r) => Math.sign(r.node.p[0]) === sx)!.node));
    for (const z of signed) stops.push(along(merBand.get(`${z}:${sx}`)!));
    for (const sz of [-1, 1]) stops.push(along(crown.get(`${sx}:${sz}`)!));
    run(`rail:meridian:${sx}`, c, stops, rail);
    feet.push({ name: `rail:meridian:${sx}:south`, kind: 'rail', curve: c, u: uFootLow });
    feet.push({ name: `rail:meridian:${sx}:north`, kind: 'rail', curve: c, u: uFootHigh });
  }
  // Rib lines: eave → coffers → band rail, a tie across the band, → coffers → eave.
  const isBand = (s: Stop) => !!s.node && (s.node.name.startsWith('node:spinward:') || s.node.name.startsWith('node:meridian:'));
  const ribOrTie = (a: Stop, b: Stop): Kind => (isBand(a) && isBand(b) ? 'tie' : 'rib');
  for (const k of signed) {
    const w = Math.sqrt(DOME.eaveR ** 2 - k * k);
    const xs: Stop[] = [];
    const zs: Stop[] = [];
    for (const s of [-1, 1]) {
      xs.push({ u: th('x', k, s * w), node: eaveAt(k, s * w) }, { u: th('x', k, s * H), node: spinBand.get(`${k}:${s}`)! });
      zs.push({ u: th('z', k, s * w), node: eaveAt(s * w, k) }, { u: th('z', k, s * H), node: merBand.get(`${k}:${s}`)! });
    }
    for (const r of signed) {
      const cx = coffer.get(`${k}:${r}`);
      if (cx) xs.push({ u: th('x', k, r), node: cx });
      const cz = coffer.get(`${r}:${k}`);
      if (cz) zs.push({ u: th('z', k, r), node: cz });
    }
    run(`rib:x${k}`, xRib(k), xs, ribOrTie);
    run(`rib:z${k}`, zRib(k), zs, ribOrTie);
  }

  // --- Members ---------------------------------------------------------------------------------------
  for (const n of nodes) n.fit();
  const members: MemberSpec[] = [];
  const splices: FrameLayout['splices'] = [];
  for (const l of links) {
    const end = (s: Stop, arm: number): { u: number; trim?: Plane } =>
      s.node ? { u: s.node.memberU(arm), trim: spliceFace(s.node.splice(arm), 'b') } : { u: s.u, trim: undefined };
    const A = end(l.a, l.armA);
    const B = end(l.b, l.armB);
    // Shop lengths: field splices at equal spacing along anything longer than the longest length.
    const table = arcTable(l.curve, A.u, B.u, 2048);
    const pieces = Math.ceil(table.length / JOINT.fieldSpan);
    const sites: SpliceSite[] = [];
    for (let k = 1; k < pieces; k++) {
      const site = spliceSite(l.curve, table.uAt((table.length * k) / pieces), 1, l.kind, true, true);
      sites.push(site);
      splices.push({ name: `splice:${l.name}:${k}`, site });
    }
    const h = JOINT.plateHalf;
    for (let k = 0; k < pieces; k++) {
      const s0 = (table.length * k) / pieces;
      const s1 = (table.length * (k + 1)) / pieces;
      members.push({
        name: pieces > 1 ? `${l.name}:${k}` : l.name,
        kind: l.kind,
        curve: l.curve,
        u0: k === 0 ? A.u : table.uAt(s0 + h),
        u1: k === pieces - 1 ? B.u : table.uAt(s1 - h),
        trimStart: k === 0 ? A.trim : spliceFace(sites[k - 1], 'b'),
        trimEnd: k === pieces - 1 ? B.trim : spliceFace(sites[k], 'a'),
      });
    }
  }
  return { nodes, members, splices, feet };
}

// --- Feet --------------------------------------------------------------------------------------------

/** Horizontal frame at a foot: out = S's normal there, across = along the sill. */
function footFrame(curve: Curve, u: number) {
  const p = curve(u);
  const out = v3.norm([p[0], 0, p[2]]);
  const across: Vec3 = [-out[2], 0, out[0]];
  return { p, out, across };
}

/** Radial extent of a plinth (plan radius) and its top's chamfer. */
const PLINTH_R0 = DOME.a + LAYER.memberT0Sill - 0.07;
const PLINTH_R1 = DOME.a + POST_T1_SILL;
const PLINTH_CAP = 0.22;

/**
 * A plinth under a member's foot: a dressed block standing on the two lower treads (and tucked
 * into the platform edge), its outer face a reveal inside the bottom riser, crowned by chamfers;
 * the member's base plate is bolted down on its top.
 */
function plinth(name: string, kind: Kind, curve: Curve, u: number): Part {
  const { out, across } = footFrame(curve, u);
  const hw = MEMBER[kind].halfWidth + FOOT.lateral;
  const rIn = PLINTH_R0;
  const rOut = PLINTH_R1;
  const rStep = SITE.padRadius + SITE.stepTread - FOOT_SINK; // the bottom tread starts here (inside the middle riser)
  const yMid = PAD_HEIGHT - SITE.stepRise - FOOT_SINK; // seat on the middle tread
  const yLow = PAD_HEIGHT - 2 * SITE.stepRise - FOOT_SINK; // seat on the bottom tread
  const top = FOOT.top;
  const cap = PLINTH_CAP;
  // Section in (r, y); the inner face drops through the platform's edge stone to the middle tread.
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
  // End rings are inset on the exposed faces (radial faces and the top): arrised vertical and top edges.
  const ch = 0.08;
  const mesh = new PolyMesh(25);
  const at = (r: number, y: number, s: number): Vec3 => [out[0] * r + across[0] * s, y, out[2] * r + across[2] * s];
  const ringAt = (s: number, inset: number) =>
    sec.map(([r, y]) => {
      let rr = r;
      let yy = y;
      if (Math.abs(r - rOut) < 1e-9 || Math.abs(r - (rOut - cap)) < 1e-9) rr = r - inset;
      if (Math.abs(r - rIn) < 1e-9 || Math.abs(r - (rIn + cap)) < 1e-9) rr = r + inset;
      if (y > top - cap - 1e-9) yy = y - inset;
      return mesh.vert(at(rr, yy, s));
    });
  const rings = [ringAt(-hw, ch), ringAt(-hw + ch, 0), ringAt(hw - ch, 0), ringAt(hw, ch)];
  const n = sec.length;
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

/** Base plate on the plinth's top: wings either side of the member, held down by anchor nuts. */
const BASE = { r0: PLINTH_R0 + PLINTH_CAP + 0.04, r1: PLINTH_R1 - PLINTH_CAP - 0.04 } as const;

function basePlate(name: string, kind: Kind, curve: Curve, u: number): Part {
  const { out, across } = footFrame(curve, u);
  const hw = MEMBER[kind].halfWidth + FOOT.plateWing;
  const y0 = FOOT.top - FOOT_SINK;
  const y1 = FOOT.top + FOOT.plateThickness;
  const c = 0.03;
  const prof = (d: number): Profile => {
    const pts: [number, number][] = [[BASE.r0 + d, y0], [BASE.r1 - d, y0], [BASE.r1 - d, y1 - c - d], [BASE.r1 - c - d, y1 - d], [BASE.r0 + c + d, y1 - d], [BASE.r0 + d, y1 - c - d]];
    return { pts, slots: pts.map(() => SLOT.black) };
  };
  // Frames along `across`: b = up × across = out, so the profile's (b, t) is (r, y).
  const rings: [number, number][] = [[-hw, c], [-hw + c, 0], [hw - c, 0], [hw, c]];
  const frames: Frame[] = rings.map(([s]) => ({ p: v3.scale(across, s), t: across, n: [0, 1, 0], b: out, s: s + hw }));
  return { name: `footplate:${name}`, mesh: sweep(frames, (_f, i) => prof(rings[i][1]), { crease: 30, capSlot: SLOT.black }) };
}

function basePlateBolts(kind: Kind, curve: Curve, u: number, out: Bolt[]): void {
  const f = footFrame(curve, u);
  const b = MEMBER[kind].halfWidth + FOOT.plateWing / 2 + 0.02;
  const y = FOOT.top + FOOT.plateThickness;
  for (const s of [-1, 1]) {
    for (const [r] of pitchAlong([[BASE.r0 + 0.3, 0], [BASE.r1 - 0.3, 0]], 0.55)) {
      out.push({ p: [f.out[0] * r + f.across[0] * s * b, y, f.out[2] * r + f.across[2] * s * b], axis: [0, 1, 0], spin: f.out });
    }
  }
}

// --- Emission ------------------------------------------------------------------------------------------

/** Builds every frame part (members, nodes, splices, plinths) as named meshes for audit and emission. */
export function buildFrameParts(layout = frameLayout()): Part[] {
  const parts: Part[] = [];
  for (const m of layout.members) {
    parts.push({ name: `member:${m.name}`, mesh: buildGirder(m) });
    const st = buildStiffeners(m);
    if (st) parts.push({ name: `stiffeners:${m.name}`, mesh: st });
  }
  for (const n of layout.nodes) {
    parts.push(...n.parts());
    n.arms.forEach((_, i) => parts.push({ name: `splice:${n.name.slice(5)}:${i}`, mesh: spliceMesh(n.splice(i)) }));
  }
  for (const s of layout.splices) parts.push({ name: s.name, mesh: spliceMesh(s.site) });
  for (const f of layout.feet) parts.push(plinth(f.name, f.kind, f.curve, f.u), basePlate(f.name, f.kind, f.curve, f.u));
  return parts;
}

/** Every bolt of the frame: splices, node crowns, base plates. */
export function frameBolts(layout: FrameLayout): Bolt[] {
  const out: Bolt[] = [];
  for (const n of layout.nodes) {
    n.bolts(out);
    n.arms.forEach((_, i) => spliceBolts(n.splice(i), out));
  }
  for (const s of layout.splices) spliceBolts(s.site, out);
  for (const f of layout.feet) basePlateBolts(f.kind, f.curve, f.u, out);
  return out;
}

export { heightAt, memberT0, memberT1, sectionDims };
