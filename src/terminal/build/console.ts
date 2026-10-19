/**
 * The West Gate terminal (docs/terminal.md): a hooded instrument head carried on a bronze cradle
 * over a tapered ceramic pedestal, on the Stand's east rim, facing the deck.
 *
 *  - Base: a bronze plate bolted to the deck.
 *  - Pedestal: a ceramic column tapering from 0.58 × 0.36 m to 0.40 × 0.22 m, leaning back a
 *    little; the speaker's perforated bronze grille set into its front.
 *  - Cradle: two bronze arms rising from the pedestal's shoulders to trunnion bosses on the head's
 *    sides, so the head reads as held, tilted 15° back toward a standing user.
 *  - Head: a ceramic housing; round the screen a bronze bezel; round that a hood, deepest at the
 *    top (25 cm) where the star stands, shallowest at the bottom: under a 45° star a sunlit screen
 *    is unreadable, so the hood is what makes it a screen at all. It is black: matte inside (a light
 *    trap), glazed outside. A white hood framed the screen with the brightest thing in view, and
 *    its glare veiled the screen.
 *  - Keys: five glazed keys on a bronze ledge under the hood (arrows and enter, their glyphs bronze
 *    inlays), which go down as the player presses their keys.
 *  - A lamp lens in the hood's top lip: lit while the terminal is awake.
 *
 * Modelled in the head's own frame (x right, y up the screen, z out of it, origin at the screen's
 * centre) and the pedestal's (x right, y up, z toward the user, origin at the base on the deck),
 * then placed in the world by the terminal's frame (layout.ts).
 */
import { at, box, extrudeBevel, lathe, orientOutward, tube, filletPath, type Basis } from '../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { roundedRect } from '../../geometry/sweep';
import { Parts } from '../../field/kit/parts';
import { STAND_SLOT } from '../materials';
import { TERMINAL, terminalFrame } from '../layout';

const S = STAND_SLOT;

/** The head's pivot (the screen's centre) in the pedestal's frame, and the tilt. */
const PIVOT: Vec3 = [0, TERMINAL.screen.y, 0.04];
const TILT = TERMINAL.screen.tilt;

/** Head dimensions (head frame, metres). */
export const HEAD = {
  /** Screen glass, a little larger than the bezel's opening (its edge is hidden in the bezel). */
  glass: { hw: TERMINAL.screen.w / 2 + 0.01, hh: TERMINAL.screen.h / 2 + 0.01 },
  bezel: { inner: [TERMINAL.screen.w / 2, TERMINAL.screen.h / 2] as Vec2, outer: [0.6, 0.39] as Vec2, z: [-0.015, 0.013] as Vec2 },
  housing: { hw: 0.68, hh: 0.45, r: 0.07, z: [-0.17, -0.005] as Vec2 },
  /** The trunnion bosses: centre depth and radius (clear of the hood, which starts at z = −0.075). */
  boss: { z: -0.122, r: 0.042 },
  /** The hood's mouth: depth at the bottom and the top. */
  hood: { bottom: 0.085, top: 0.255, back: -0.04 },
  ledge: { y: [-0.505, -0.462] as Vec2, z: [0.015, 0.2] as Vec2, hw: 0.33 },
} as const;

/** The pedestal frame → world. */
function pedestalToWorld(): (p: Vec3) => Vec3 {
  const { base, inward, right } = terminalFrame();
  return ([x, y, z]) => [base[0] + right[0] * x + inward[0] * z, base[1] + y, base[2] + right[1] * x + inward[1] * z];
}

/** The head frame → the pedestal frame (tilted back about x through the pivot). */
export function headToPedestal([x, y, z]: Vec3): Vec3 {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  return [PIVOT[0] + x, PIVOT[1] + y * c + z * s, PIVOT[2] - y * s + z * c];
}

/** The head frame → world. */
export function headToWorld(p: Vec3): Vec3 {
  return pedestalToWorld()(headToPedestal(p));
}

/** The screen in the world: its centre, its normal (out of it), its up, its right, and its size. */
export function screenPose(): { centre: Vec3; normal: Vec3; up: Vec3; right: Vec3; w: number; h: number } {
  const o = headToWorld([0, 0, 0]);
  const d = (p: Vec3) => v3.norm(v3.sub(headToWorld(p), o));
  return { centre: o, normal: d([0, 0, 1]), up: d([0, 1, 0]), right: d([1, 0, 0]), w: TERMINAL.screen.w, h: TERMINAL.screen.h };
}

/** The speaker (the grille's centre) and the lamp, in the world. */
export function speakerPosition(): Vec3 {
  return pedestalToWorld()([0, GRILLE.y, pedestalFrontZ(GRILLE.y) + 0.01]);
}

// --- rounded-rect rings -------------------------------------------------------------------------------

/**
 * A rounded rectangle's perimeter as a ring of points (counter-clockwise seen from +z), with a
 * fixed count per corner and per edge, so rings of different sizes correspond point for point.
 */
function rrRing(hw: number, hh: number, r: number, z: (x: number, y: number) => number, corner = 6, edgeX = 8, edgeY = 6): Vec3[] {
  const out: Vec3[] = [];
  const cs: [number, number, number][] = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ];
  // Start mid-bottom, run right along the bottom edge, round each corner and along each edge.
  const edge = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      out.push([x, y, z(x, y)]);
    }
  };
  edge(0, -hh, hw - r, -hh, edgeX / 2);
  cs.forEach(([cx, cy, a0], k) => {
    for (let i = 0; i < corner; i++) {
      const a = a0 + (Math.PI / 2) * (i / corner);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      out.push([x, y, z(x, y)]);
    }
    const nx = cs[(k + 1) % 4];
    const ex = cx + r * Math.cos(a0 + Math.PI / 2);
    const ey = cy + r * Math.sin(a0 + Math.PI / 2);
    const tx = nx[0] + r * Math.cos(nx[2]);
    const ty = nx[1] + r * Math.sin(nx[2]);
    if (k === 3) edge(ex, ey, 0, -hh, edgeX / 2);
    else edge(ex, ey, tx, ty, k % 2 === 0 ? edgeY : edgeX);
  });
  return out;
}

/** A closed annular solid through a loop of rings (each ring's points correspond). */
function annulus(rings: Vec3[][], slots: number[]): PolyMesh {
  const m = new PolyMesh(34);
  const ids = rings.map((r) => r.map((p) => m.vert(p)));
  const n = rings[0].length;
  for (let i = 0; i < rings.length; i++) {
    const a = ids[i];
    const b = ids[(i + 1) % rings.length];
    let u = 0;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const e = v3.dist(rings[i][j], rings[i][j1]);
      const w = v3.dist(rings[i][j], rings[(i + 1) % rings.length][j]);
      m.face([a[j], a[j1], b[j1], b[j]], slots[i], [[u, 0], [u + e, 0], [u + e, w], [u, w]]);
      u += e;
    }
  }
  return orientOutward(m);
}

// --- the head ------------------------------------------------------------------------------------------

/** The hood's mouth depth at a height y on the head (deepest at the top, where the star is). */
function mouthZ(y: number): number {
  const t = Math.min(1, Math.max(0, (y / 0.47 + 1) / 2));
  return HEAD.hood.bottom + (HEAD.hood.top - HEAD.hood.bottom) * Math.pow(t, 1.6);
}

function head(parts: Parts, toWorld: (p: Vec3) => Vec3): { screen: PolyMesh; lamp: PolyMesh; keys: PolyMesh[]; ledgeTop: number } {
  const H = HEAD;
  const W = (m: PolyMesh) => m.transform(toWorld);
  // Housing: a rounded box behind the screen.
  const hb: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
  parts.add('housing', W(extrudeBevel(roundedRect(H.housing.hw, H.housing.hh, H.housing.r, 6), hb, H.housing.z[0], H.housing.z[1], 0.012, S.ceramic)));
  // Bezel: bronze, its inner edge chamfered toward the glass.
  const [bi, bo] = [H.bezel.inner, H.bezel.outer];
  const [z0, z1] = H.bezel.z;
  const bezel = annulus(
    [
      rrRing(bi[0], bi[1], 0.02, () => z0),
      rrRing(bi[0], bi[1], 0.02, () => z1 - 0.006),
      rrRing(bi[0] + 0.006, bi[1] + 0.006, 0.026, () => z1),
      rrRing(bo[0] - 0.004, bo[1] - 0.004, 0.046, () => z1),
      rrRing(bo[0], bo[1], 0.05, () => z1 - 0.004),
      rrRing(bo[0], bo[1], 0.05, () => z0),
    ],
    [S.bezel, S.bezel, S.bezel, S.bezel, S.bezel, S.bezel],
  );
  parts.add('bezel', W(bezel));
  // Hood: inner wall (black), lip (ceramic), outer wall (ceramic), back (inside the housing).
  const back = H.hood.back - 0.035;
  const hood = annulus(
    [
      rrRing(0.614, 0.404, 0.055, () => back),
      rrRing(0.64, 0.43, 0.07, (_, y) => mouthZ(y)),
      rrRing(0.672, 0.462, 0.085, (_, y) => mouthZ(y) - 0.004),
      rrRing(0.686, 0.47, 0.09, (_, y) => mouthZ(y) - 0.016),
      rrRing(0.686, 0.456, 0.08, () => back),
    ],
    [S.hood, S.black, S.black, S.black, S.black],
  );
  parts.add('hood', W(hood));
  // Trunnion bosses on the housing's sides.
  for (const s of [-1, 1]) {
    const r = H.boss.r;
    const b: Basis = { o: [s * (H.housing.hw - 0.005), 0, H.boss.z], u: [0, 1, 0], v: [0, 0, s], w: [s, 0, 0] };
    parts.add(`boss${s < 0 ? 'L' : 'R'}`, W(lathe([[0, 0], [r, 0], [r, 0.022], [r - 0.009, 0.034], [0, 0.034]], 28, b, S.bronze, 40)));
  }
  // Back: a service panel, vent slots and bolts.
  const rear: Basis = { o: [0, -0.04, H.housing.z[0]], u: [-1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] };
  parts.add('service-panel', W(extrudeBevel(roundedRect(0.26, 0.16, 0.025, 4), rear, -0.004, 0.005, 0.0025, S.bronze)));
  const vents = new PolyMesh();
  for (let i = 0; i < 5; i++) vents.append(box({ ...rear, o: at(rear, 0, 0.27 + i * 0.026, 0) }, 0.2, 0.006, 0.006, 0.002, S.black));
  parts.addSet('vents', W(vents));
  const bolts = new PolyMesh();
  for (const [x, y] of [[-0.23, -0.13], [0.23, -0.13], [-0.23, 0.13], [0.23, 0.13]] as Vec2[]) bolts.append(lathe([[0, 0], [0.008, 0], [0.008, 0.004], [0.005, 0.006], [0, 0.006]], 12, { ...rear, o: at(rear, x, y, 0.004) }, S.steel, 40));
  parts.addSet('panel-bolts', W(bolts));
  // The key ledge under the hood.
  const [ly0, ly1] = H.ledge.y;
  const [lz0, lz1] = H.ledge.z;
  parts.add('ledge', W(box({ o: [0, (ly0 + ly1) / 2, (lz0 + lz1) / 2], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, H.ledge.hw, (ly1 - ly0) / 2, (lz1 - lz0) / 2, 0.006, S.bronze)));
  // Screen glass: a single face, uv over the visible area.
  const screen = new PolyMesh(10);
  const g = H.glass;
  const corners: Vec3[] = [
    [-g.hw, -g.hh, 0],
    [g.hw, -g.hh, 0],
    [g.hw, g.hh, 0],
    [-g.hw, g.hh, 0],
  ];
  screen.face(
    corners.map((p) => screen.vert(p)),
    0,
    corners.map(([x, y]) => [x / TERMINAL.screen.w + 0.5, y / TERMINAL.screen.h + 0.5] as Vec2),
  );
  W(screen);
  // The lamp: a lens set into the hood's top lip.
  const lb: Basis = { o: [0, 0.446, mouthZ(0.446) - 0.006], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
  const lamp = W(lathe([[0, 0], [0.009, 0], [0.009, 0.006], [0.006, 0.0085], [0, 0.0095]], 16, lb, 0, 50));
  // Keys: ← ↓ → in a row, ↑ behind ↓, enter on the right; glazed black, their glyphs bronze.
  const keys: PolyMesh[] = [];
  const kTop = ly1;
  const key = (x: number, z: number, hw: number, glyph: (b: Basis, top: number) => PolyMesh | null) => {
    const m = new PolyMesh();
    const b: Basis = { o: [x, kTop + 0.006, z], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
    m.append(box(b, hw, 0.016, 0.009, 0.003, S.black));
    const gl = glyph(b, 0.009);
    if (gl) m.append(gl);
    keys.push(W(m));
  };
  const arrow = (deg: number) => (b: Basis, top: number) => {
    const a = (deg * Math.PI) / 180;
    const pts: Vec2[] = [
      [0.008, 0],
      [-0.005, 0.007],
      [-0.005, -0.007],
    ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as Vec2);
    return extrudeBevel(pts, { ...b, o: at(b, 0, 0, top - 0.0015) }, 0, 0.0025, 0, S.bronze);
  };
  const zRow = 0.165;
  key(-0.22, zRow, 0.016, arrow(180));
  key(-0.18, zRow, 0.016, arrow(-90));
  key(-0.14, zRow, 0.016, arrow(0));
  key(-0.18, zRow - 0.038, 0.016, arrow(90));
  key(0.17, zRow - 0.019, 0.05, (b, top) => extrudeBevel(roundedRect(0.026, 0.004, 0.002, 2), { ...b, o: at(b, 0, 0, top - 0.0015) }, 0, 0.0025, 0, S.bronze));
  return { screen, lamp, keys, ledgeTop: kTop };
}

// --- the pedestal ------------------------------------------------------------------------------------

const PED = { y0: 0.03, y1: 0.88, base: [0.29, 0.18] as Vec2, top: [0.2, 0.11] as Vec2, zTop: -0.03 } as const;
const GRILLE = { y: 0.68, hw: 0.12, hh: 0.075 } as const;

/** The pedestal's front face (z) at a height: the sections' front edges, lofted straight. */
function pedestalFrontZ(y: number): number {
  const t = (y - PED.y0) / (PED.y1 - PED.y0);
  return PED.base[1] + (PED.zTop + PED.top[1] - PED.base[1]) * t;
}

function pedestal(parts: Parts, toWorld: (p: Vec3) => Vec3): void {
  const W = (m: PolyMesh) => m.transform(toWorld);
  // Base plate and its bolts.
  const plan: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
  parts.add('base', W(extrudeBevel(roundedRect(0.43, 0.28, 0.08, 6), plan, -0.004, 0.035, 0.006, S.bronze)));
  const bolts = new PolyMesh();
  for (const [x, z] of [[-0.36, -0.2], [0, -0.22], [0.36, -0.2], [-0.36, 0.2], [0, 0.22], [0.36, 0.2]] as Vec2[]) {
    bolts.append(lathe([[0, 0], [0.014, 0], [0.014, 0.006], [0.009, 0.01], [0, 0.01]], 12, { ...plan, o: [x, 0.033, z] }, S.steel, 40));
  }
  parts.addSet('base-bolts', W(bolts));
  // Column: rounded sections lofted from the base to the shoulders.
  const ring = (y: number, hw: number, hd: number, zc: number) => rrRing(hw, hd, Math.min(hw, hd) * 0.42, () => 0, 5, 6, 4).map(([x, zz]) => [x, y, zc + zz] as Vec3);
  const rings: Vec3[][] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = PED.y0 - 0.01 + (PED.y1 - PED.y0 + 0.01) * t;
    rings.push(ring(y, PED.base[0] + (PED.top[0] - PED.base[0]) * t, PED.base[1] + (PED.top[1] - PED.base[1]) * t, PED.zTop * t));
  }
  parts.add('pedestal', W(loftClosed(rings, S.ceramic)));
  // Shoulder cap: a black glazed plate on the column's top.
  const capRing = ring(PED.y1, PED.top[0] - 0.012, PED.top[1] - 0.012, PED.zTop);
  const capTop = capRing.map(([x, , z]) => [x, PED.y1 + 0.012, z] as Vec3);
  const capBot = capRing.map(([x, , z]) => [x, PED.y1 - 0.01, z] as Vec3);
  parts.add('shoulder', W(loftClosed([capBot, capTop], S.black)));
  // The speaker grille, set into the front face.
  const yA = GRILLE.y - 0.1;
  const yB = GRILLE.y + 0.1;
  const t = v3.norm([0, yB - yA, pedestalFrontZ(yB) - pedestalFrontZ(yA)]);
  const nrm = v3.cross([1, 0, 0], t);
  const gb: Basis = { o: [0, GRILLE.y, pedestalFrontZ(GRILLE.y)], u: [1, 0, 0], v: t, w: nrm };
  parts.add('grille', W(extrudeBevel(roundedRect(GRILLE.hw, GRILLE.hh, 0.018, 4), gb, -0.006, 0.003, 0.0015, S.bronze, S.grille)));
  // The cradle: two arms from the shoulders to the head's bosses.
  // They run in the bosses' plane, behind the housing and the hood, outside the housing's sides,
  // and turn in at the top to enter the bosses.
  for (const s of [-1, 1]) {
    const hub = headToPedestal([0, 0, HEAD.boss.z]);
    const x = s * (HEAD.housing.hw + 0.05);
    const z = hub[2];
    const pts = filletPath(
      [
        [s * 0.12, PED.y1 - 0.06, z],
        [s * 0.32, PED.y1 + 0.02, z],
        [x, hub[1] - 0.23, z],
        [x, hub[1], z],
        [s * (HEAD.housing.hw + 0.01), hub[1], z],
      ],
      0.05,
      0.015,
      10,
    );
    parts.add(`arm${s < 0 ? 'L' : 'R'}`, W(tube(pts.map((p) => ({ p, r: 0.028 })), 16, S.bronze, { capSlot: S.bronze, crease: 50 })));
  }
}

/** Closed loft through rings with flat end caps (outward). */
function loftClosed(rings: Vec3[][], slot: number): PolyMesh {
  const m = new PolyMesh(36);
  const ids = rings.map((r) => r.map((p) => m.vert(p)));
  const n = rings[0].length;
  let v = 0;
  for (let i = 0; i + 1 < rings.length; i++) {
    const h = v3.dist(rings[i][0], rings[i + 1][0]);
    let u = 0;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const e = v3.dist(rings[i][j], rings[i][j1]);
      m.face([ids[i][j], ids[i][j1], ids[i + 1][j1], ids[i + 1][j]], slot, [[u, v], [u + e, v], [u + e, v + h], [u, v + h]]);
      u += e;
    }
    v += h;
  }
  // Caps as fans about their centres: the rings carry collinear points along their straight
  // edges, which a polygon triangulation would turn into slivers.
  const cap = (ring: Vec3[], idx: number[], flip: boolean) => {
    const c = ring.reduce((a, p) => v3.add(a, v3.scale(p, 1 / ring.length)), [0, 0, 0] as Vec3);
    const ci = m.vert(c);
    for (let j = 0; j < n; j++) {
      const a = idx[j];
      const b = idx[(j + 1) % n];
      const uvs: Vec2[] = [[c[0], c[2]], [ring[j][0], ring[j][2]], [ring[(j + 1) % n][0], ring[(j + 1) % n][2]]];
      if (flip) m.face([ci, b, a], slot, [uvs[0], uvs[2], uvs[1]]);
      else m.face([ci, a, b], slot, uvs);
    }
  };
  cap(rings[0], ids[0], true);
  cap(rings[rings.length - 1], ids[rings.length - 1], false);
  return orientOutward(m);
}

export interface ConsoleBuild {
  parts: Parts;
  /** The screen's glass (its own material), the lamp's lens, and the keys (in order ← ↓ → ↑ ⏎). */
  screen: PolyMesh;
  lamp: PolyMesh;
  keys: PolyMesh[];
  /** Each key's travel direction (world, down into the ledge). */
  keyDown: Vec3;
  /** The walker's block: the terminal's base and pedestal in plan (world, a loop). */
  footprint: [number, number][];
  /** The car's: wide enough to close the balustrade's gap and reach under the hood and ledge. */
  carFootprint: [number, number][];
}

export function buildConsole(): ConsoleBuild {
  const parts = new Parts('terminal');
  const toWorld = pedestalToWorld();
  pedestal(parts, toWorld);
  const h = head(parts, (p) => toWorld(headToPedestal(p)));
  const o = headToWorld([0, 0, 0]);
  const keyDown = v3.norm(v3.sub(headToWorld([0, -1, 0]), o));
  const plan = (loop: Vec2[]) =>
    loop.map(([x, z]) => {
      const p = toWorld([x, 0, z]);
      return [p[0], p[2]] as [number, number];
    });
  const footprint = plan([[-0.5, -0.32], [0.5, -0.32], [0.5, 0.3], [-0.5, 0.3]]);
  const carFootprint = plan([[-0.95, -0.45], [0.95, -0.45], [0.95, 0.42], [-0.95, 0.42]]);
  return { parts, screen: h.screen, lamp: h.lamp, keys: h.keys, keyDown, footprint, carFootprint };
}
