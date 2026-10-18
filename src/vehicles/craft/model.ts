/**
 * The craft (docs/vehicles.md), ported exactly from refs/spacecraft.html: a gilded fuselage with a
 * glazed cockpit in one continuous loft, swept ivory wings over an open gold-ribbed bay, a tilted
 * elliptic halo on four buttresses, dorsal and ventral tail foils, three rear engines, ceramic
 * armour shells and its brightwork.
 *
 * Coordinates are the ref's: metres, x lateral, y up, −z the nose. The model is authored at about
 * 7.8 m long; the game flies it at CRAFT_SCALE (city_plan §6: craft up to ~50 m), applied to the
 * object, so everything here stays in the ref's numbers. The whole craft is one geometry with a
 * group per material slot.
 */
import { BufferGeometry, CircleGeometry, Float32BufferAttribute, ExtrudeGeometry, LatheGeometry, Matrix4, Quaternion, Shape, ShapeGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three/webgpu';
import { PartSink, capRing, curve, d, geometry, outward, weld, withDetail } from '../kit/loft';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The game's scale on the ref's model. */
export const CRAFT_SCALE = 4;

export const CRAFT_SLOT = {
  ivory: 0,
  gold: 1,
  paleGold: 2,
  dark: 3,
  glass: 4,
  seam: 5,
  glow: 6,
  core: 7,
  /** The intake throats (the ref's dark, drawn double-sided). */
  throat: 8,
} as const;
export const CRAFT_SLOTS = 9;

/** An engine in the ref's frame: nozzle centre (x, y), bell base z, bell radius. Exhaust leaves toward +z. */
export interface CraftEngine {
  x: number;
  y: number;
  z: number;
  r: number;
}
export const CRAFT_ENGINES: readonly CraftEngine[] = [
  { x: 0, y: 0, z: 3.0, r: 0.55 },
  { x: -1.15, y: -0.05, z: 2.73, r: 0.32 },
  { x: 1.15, y: -0.05, z: 2.73, r: 0.32 },
];
/** The bell's exit plane, over its base (the lathe profile's top). */
export const BELL_LENGTH = 0.52;

/** The craft's lowest point (the ventral foil's tip) and its other extents, in the ref's frame. */
export const CRAFT_BOUNDS = { bottom: -2.867, top: 2.867, halfSpan: 4.01, nose: -4.7, tail: 3.547 } as const;

export interface CraftModel {
  geometry: BufferGeometry;
  parts: PartSink;
  triangles: number;
}

type P3 = [number, number, number];
const S = CRAFT_SLOT;

/** Fuselage sections: z, half-width, half-height, centre height (refs/spacecraft.html `sections`). */
const SECTIONS: [number, number, number, number][] = [
  [-4.7, 0.025, 0.035, -0.12],
  [-4.3, 0.3, 0.18, -0.06],
  [-3.5, 0.64, 0.4, 0],
  [-2.5, 0.88, 0.64, 0.04],
  [-1.3, 0.99, 0.68, 0.02],
  [0, 0.92, 0.6, 0],
  [1.4, 0.78, 0.54, 0],
  [2.7, 0.62, 0.51, 0],
  [3.05, 0.52, 0.43, 0],
];

/** The fuselage's section at t ∈ [0, 1] along z ∈ [−4.7, 3.05]: (half-width, half-height, centre y). */
function section(t: number): Vector3 {
  const z = -4.7 + 7.75 * Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < SECTIONS.length - 2 && z > SECTIONS[i + 1][0]) i++;
  const a = SECTIONS[i];
  const b = SECTIONS[i + 1];
  const h = b[0] - a[0];
  const u = (z - a[0]) / h;
  const vals: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const prev = SECTIONS[Math.max(0, i - 1)];
    const next = SECTIONS[Math.min(SECTIONS.length - 1, i + 2)];
    let ma = (b[k] - prev[k]) / (b[0] - prev[0]);
    let mb = (next[k] - a[k]) / (next[0] - a[0]);
    const sec = (b[k] - a[k]) / h;
    if (sec === 0) {
      ma = 0;
      mb = 0;
    } else {
      ma = Math.sign(ma) === Math.sign(sec) ? Math.sign(sec) * Math.min(Math.abs(ma), 3 * Math.abs(sec)) : 0;
      mb = Math.sign(mb) === Math.sign(sec) ? Math.sign(sec) * Math.min(Math.abs(mb), 3 * Math.abs(sec)) : 0;
    }
    vals.push((2 * u ** 3 - 3 * u * u + 1) * a[k] + (u ** 3 - 2 * u * u + u) * h * ma + (-2 * u ** 3 + 3 * u * u) * b[k] + (u ** 3 - u * u) * h * mb);
  }
  return new Vector3(vals[0], vals[1], vals[2]);
}

/** A point on the fuselage at t along it and angle a round it. */
function body(t: number, a: number): P3 {
  const s = section(t);
  const z = -4.7 + 7.75 * t;
  return [s.x * Math.cos(a), s.z + s.y * Math.sin(a), z];
}

/** The fuselage's outward normal at a point on it (the ref's `radial`). */
function radial(q: P3): P3 {
  const s = section((q[2] + 4.7) / 7.75);
  const n = new Vector3(q[0] / (s.x * s.x), (q[1] - s.z) / (s.y * s.y), 0).normalize();
  return [n.x, n.y, n.z];
}

/** Closed sectional loft with fan caps (the ref's `loft`): fn(u ∈ [0,1], angle) → point. */
function sectLoft(fn: (u: number, a: number) => P3, n0: number, m0: number): BufferGeometry {
  const n = d(n0, 8);
  const m = d(m0, 8);
  const p: number[] = [];
  const ix: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j < m; j++) p.push(...fn(i / n, (j / m) * Math.PI * 2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      ix.push(a, b, a + m, b, b + m, a + m);
    }
  }
  // A loft that closes on itself (the halo's band) is welded shut, not capped: its two caps would
  // meet back to back inside it.
  let loop = true;
  for (let j = 0; j < m * 3 && loop; j++) loop = Math.abs(p[j] - p[n * m * 3 + j]) < 1e-7;
  if (!loop) for (const [i, flip] of [[0, true], [n, false]] as const) capRing(p, ix, Array.from({ length: m }, (_, j) => i * m + j), flip);
  weld(p, ix);
  outward(p, ix);
  return geometry(p, ix);
}

function lineSample(fn: (t: number) => P3, n0 = 80): P3[] {
  const n = d(n0, 12);
  return Array.from({ length: n + 1 }, (_, i) => fn(i / n));
}

/**
 * A tube along a centripetal curve through points (the ref's `rail`). An open tube is closed at
 * both ends with flat caps (the ref left them hollow).
 */
function tube(points: readonly P3[], r: number, closed = false): BufferGeometry {
  const segs = d(Math.max(32, points.length * 9), 12);
  const radial = d(8, 6);
  const path = curve(points, closed);
  const g = new TubeGeometry(path, segs, r, radial, closed);
  g.deleteAttribute('uv');
  if (closed) return g;
  const pos = g.getAttribute('position');
  const caps = [0, segs].map((ring) => {
    const t = path.getTangent(ring / segs);
    const sign = ring === 0 ? -1 : 1;
    const c = path.getPoint(ring / segs);
    const q: number[] = [c.x, c.y, c.z];
    const nrm: number[] = [t.x * sign, t.y * sign, t.z * sign];
    for (let j = 0; j < radial; j++) {
      const v = ring * (radial + 1) + j;
      q.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      nrm.push(t.x * sign, t.y * sign, t.z * sign);
    }
    const ix: number[] = [];
    for (let j = 0; j < radial; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % radial);
      // Facing out along ±tangent (the tube's rings run clockwise about +tangent).
      if (sign > 0) ix.push(0, b, a);
      else ix.push(0, a, b);
    }
    const cap = new BufferGeometry();
    cap.setAttribute('position', new Float32BufferAttribute(q, 3));
    cap.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    cap.setIndex(ix);
    return cap;
  });
  return mergeGeometries([g, ...caps], false);
}

function torus(r: number, t: number): BufferGeometry {
  return new TorusGeometry(r, t, d(12, 6), d(96, 32));
}

const at = (x: number, y: number, z: number, q = new Quaternion(), s = new Vector3(1, 1, 1)) => new Matrix4().compose(new Vector3(x, y, z), q, s);

/**
 * Raised, softly crowned armour shell over a surface patch (the ref's `armor`): two layers offset
 * along the surface normal, closed round the rim.
 */
function armor(surface: (u: number, v: number) => P3, normal: (q: P3, u: number, v: number) => P3, nu0 = 24, nv0 = 12): BufferGeometry {
  const nu = d(nu0, 6);
  const nv = d(nv0, 4);
  const p: number[] = [];
  const idx: number[] = [];
  const stride = nv + 1;
  const layer = (nu + 1) * stride;
  for (let side = 0; side < 2; side++)
    for (let i = 0; i <= nu; i++)
      for (let j = 0; j <= nv; j++) {
        const u = i / nu;
        const v = j / nv;
        const q = surface(u, v);
        const n = normal(q, u, v);
        const dd = side === 0 ? 0.027 + 0.012 * Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.45) : 0.012;
        p.push(q[0] + n[0] * dd, q[1] + n[1] * dd, q[2] + n[2] * dd);
      }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride + 1;
      const e = a + stride;
      idx.push(a, e, b, b, e, c, a + layer, b + layer, e + layer, b + layer, c + layer, e + layer);
    }
  const rim: number[] = [];
  for (let j = 0; j <= nv; j++) rim.push(j);
  for (let i = 1; i <= nu; i++) rim.push(i * stride + nv);
  for (let j = nv - 1; j >= 0; j--) rim.push(nu * stride + j);
  for (let i = nu - 1; i > 0; i--) rim.push(i * stride);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % rim.length];
    idx.push(a, b, a + layer, b, b + layer, a + layer);
  }
  outward(p, idx);
  return geometry(p, idx);
}

/** Half-width of the canopy's glazing at z (0 outside it). */
function canopyHalfWidth(z: number): number {
  return z > -4.15 && z < -1.33 ? 0.58 * Math.pow(Math.max(0, Math.sin(((z + 4.15) / 2.82) * Math.PI)), 0.65) : 0;
}

function canopyAngle(t: number): number {
  const z = -4.7 + 7.75 * t;
  const s = section(t);
  return Math.acos(Math.min(0.98, canopyHalfWidth(z) / s.x)) - 0.018;
}

/** The fuselage loft, split into its gilded and glazed regions (one continuous surface, shared vertices). */
function hull(sink: PartSink): void {
  const g = sectLoft(body, 180, 96);
  const pos = g.getAttribute('position');
  const ix = g.index!.array;
  const lists: [number[], number[]] = [[], []];
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k], b = ix[k + 1], c = ix[k + 2];
    const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const s = section(Math.max(0, Math.min(1, (z + 4.7) / 7.75)));
    const w = 0.58 * Math.pow(Math.max(0, Math.sin(((z + 4.15) / 2.82) * Math.PI)), 0.65);
    const slot = z > -4.15 && z < -1.33 && y > s.z + 0.12 && Math.abs(x) < w ? 1 : 0;
    lists[slot].push(a, b, c);
  }
  for (const [slot, list] of [[S.gold, lists[0]], [S.glass, lists[1]]] as const) {
    const part = new BufferGeometry();
    part.setAttribute('position', pos);
    part.setAttribute('normal', g.getAttribute('normal'));
    part.setIndex(list);
    sink.add(slot === S.glass ? 'glazed cockpit' : 'continuous gilded fuselage', slot, part);
  }
}

function wingPoint(s: number, u: number, a: number): P3 {
  const x = s * (0.7 + 3.2 * u);
  const lead = -1.75 + 2.78 * Math.pow(u, 0.6);
  const trail = lead + 1.05 * (1 - u) + 0.24;
  const mid = (lead + trail) / 2;
  const chord = (trail - lead) / 2;
  return [x, 0.045 + 0.09 * Math.sin(u * Math.PI) + (0.22 * (1 - u) + 0.035) * Math.sin(a), mid + chord * Math.cos(a)];
}

function halo(a: number, offset = 0, depth = 0): P3 {
  return [(3.78 + offset) * Math.cos(a), (1.6 + offset) * Math.sin(a), 0.55 + 1.03 * Math.sin(a) + depth];
}

function engine(sink: PartSink, x: number, y: number, z: number, r: number): void {
  const profile: [number, number][] = [[r * 0.84, 0], [r, 0.09], [r * 1.04, 0.19], [r * 1.04, 0.44], [r * 0.93, 0.52], [r * 0.77, 0.52], [r * 0.72, 0.42], [r * 0.7, 0.18]];
  const lathe = new LatheGeometry(profile.map((v) => new Vector2(...v)), d(80, 24));
  sink.add('machined engine bell', S.gold, lathe, at(x, y, z, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)));
  for (const dz of [0.1, 0.23, 0.39, 0.5]) sink.add('engine collar', S.paleGold, torus(r * 1.03, 0.024), at(x, y, z + dz));
  sink.add('nozzle dark recess', S.dark, torus(r * 0.72, 0.09), at(x, y, z + 0.22));
  sink.add('engine hot annulus', S.glow, torus(r * 0.62, 0.026), at(x, y, z + 0.43));
  sink.add('engine inner annulus', S.paleGold, torus(r * 0.43, 0.018), at(x, y, z + 0.44));
  sink.add('recessed engine core', S.core, new CircleGeometry(r * 0.35, d(64, 24)), at(x, y, z + 0.29));
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    sink.add('nozzle radial blade', S.gold, tube([[x + r * 0.39 * Math.cos(a), y + r * 0.39 * Math.sin(a), z + 0.32], [x + r * 0.68 * Math.cos(a + 0.08), y + r * 0.68 * Math.sin(a + 0.08), z + 0.43]], 0.012));
  }
}

function build(sink: PartSink): void {
  hull(sink);
  for (const sign of [-1, 1])
    sink.add(
      'canopy gold perimeter',
      S.paleGold,
      tube(
        lineSample((t) => {
          const z = -4.14 + 2.8 * t;
          const s = section((z + 4.7) / 7.75);
          const x = sign * 0.58 * Math.pow(Math.max(0, Math.sin(((z + 4.15) / 2.82) * Math.PI)), 0.65);
          return [x, s.z + s.y * Math.sqrt(Math.max(0, 1 - (x / s.x) ** 2)) + 0.012, z];
        }),
        0.022,
      ),
    );
  sink.add(
    'canopy centre mullion',
    S.gold,
    tube(
      lineSample((t) => {
        const z = -4.14 + 2.8 * t;
        const s = section((z + 4.7) / 7.75);
        return [0, s.z + s.y + 0.016, z];
      }),
      0.014,
    ),
  );
  for (const z of [-3.4, -2.15]) {
    const s = section((z + 4.7) / 7.75);
    const w = 0.58 * Math.pow(Math.sin(((z + 4.15) / 2.82) * Math.PI), 0.65);
    sink.add(
      'canopy arch',
      S.paleGold,
      tube(
        lineSample((t) => {
          const x = (t * 2 - 1) * w;
          return [x, s.z + s.y * Math.sqrt(Math.max(0, 1 - (x / s.x) ** 2)) + 0.013, z];
        }, 32),
        0.012,
      ),
    );
  }
  for (const a of [0, 0.48, 2.66, Math.PI, 3.7, 5.72])
    sink.add(
      'longitudinal hull inlay',
      S.gold,
      tube(
        lineSample((t) => {
          const p = body(0.025 + t * 0.95, a);
          return [p[0] * 1.008, p[1] * 1.008, p[2]];
        }),
        0.012,
      ),
    );
  for (const t of [0.17, 0.44, 0.57, 0.7, 0.86]) sink.add('hull panel joint', S.seam, tube(lineSample((u) => body(t, u * Math.PI * 2), 96), 0.007, true));

  // Sculpted spanwise airfoil wings.
  for (const s of [-1, 1]) {
    sink.add(`swept ivory wing ${s}`, S.ivory, sectLoft((u, a) => wingPoint(s, u, a), 64, 48));
    for (const a of [0, Math.PI]) sink.add('wing gold edge', S.gold, tube(lineSample((u) => wingPoint(s, u, a)), 0.033));
    for (const u of [0.34, 0.63, 0.87]) sink.add('wing panel division', S.seam, tube(lineSample((v) => wingPoint(s, u, v * Math.PI * 2), 48), 0.007, true));
    sink.add(
      'wing inset gold fillet',
      S.paleGold,
      tube(
        lineSample((u) => {
          const p = wingPoint(s, u, 2.4);
          p[1] += 0.012;
          return p;
        }),
        0.012,
      ),
    );
    // Outboard nacelle scallop and gilded spine, attached to the wing roots.
    sink.add(
      `side nacelle ${s}`,
      S.ivory,
      sectLoft((u, a) => {
        const z = -2.8 + 5.5 * u;
        const bulge = Math.pow(Math.sin(Math.PI * u), 0.75);
        return [s * (0.73 + 0.36 * bulge) + 0.27 * bulge * Math.cos(a), -0.27 + 0.27 * bulge * Math.sin(a), z];
      }, 88, 40),
    );
    sink.add('side nacelle lower sweep', S.gold, tube([[s * 0.37, -0.15, -3.8], [s * 0.87, -0.49, -2.3], [s * 1.25, -0.47, -0.6], [s * 1.22, -0.35, 1.2], [s * 0.8, -0.22, 2.7]], 0.043));
    // An open duct with a rolled lip and internal louvres.
    const ductPts: P3[] = [[s * 0.75, -0.02, -2.75], [s * 1.05, 0.03, -1.6], [s * 1.48, 0.0, -0.1], [s * 1.65, -0.05, 0.9], [s * 1.23, -0.22, 0.6], [s * 0.95, -0.22, -1.1]];
    sink.add('intake lip', S.gold, tube(ductPts, 0.033, true));
    const shape = new Shape(ductPts.map((p) => new Vector2(p[2], p[0])));
    const ductg = new ShapeGeometry(shape, d(12, 6));
    const dpos = ductg.getAttribute('position');
    for (let i = 0; i < dpos.count; i++) {
      const z = dpos.getX(i);
      const x = dpos.getY(i);
      dpos.setXYZ(i, x, -0.17, z);
    }
    ductg.computeVertexNormals();
    sink.add('recessed intake throat', S.throat, ductg);
    for (let i = 0; i < 12; i++) {
      const z = -1.95 + i * 0.19;
      sink.add('intake louvre', S.paleGold, tube([[s * (1.0 + (z + 1.95) * 0.19), -0.14, z], [s * (1.14 + (z + 1.95) * 0.19), -0.035, z + 0.1]], 0.025));
    }
  }

  // The halo: a tilted elliptic structural band.
  sink.add(
    'ivory halo band',
    S.ivory,
    sectLoft((u, a) => {
      const t = u * Math.PI * 2;
      const c = halo(t);
      return [c[0] + 0.085 * Math.cos(t) * Math.cos(a), c[1] + 0.085 * Math.sin(t) * Math.cos(a), c[2] + 0.19 * Math.sin(a)];
    }, 256, 20),
  );
  for (const dz of [-0.2, 0.2]) sink.add('halo polished rim', S.gold, tube(lineSample((u) => halo(u * Math.PI * 2, 0, dz), 192), 0.042, true));
  sink.add('halo luminous channel', S.glow, tube(lineSample((u) => halo(u * Math.PI * 2, -0.06, -0.055), 192), 0.016, true));
  sink.add('halo inner gold rim', S.paleGold, tube(lineSample((u) => halo(u * Math.PI * 2, -0.09, 0.04), 192), 0.026, true));
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    sink.add('halo segment clasp', S.gold, tube(lineSample((t) => halo(a, -0.008, -0.2 + t * 0.4), 6), 0.019));
  }
  // Four curved buttresses tie the halo to the fuselage.
  const haloAngle = (s: number, sy: number) => (sy > 0 ? (s > 0 ? 0.9 : Math.PI - 0.9) : s > 0 ? -0.9 : Math.PI + 0.9);
  for (const s of [-1, 1])
    for (const sy of [-1, 1]) {
      const h = halo(haloAngle(s, sy));
      sink.add('halo structural buttress', S.gold, tube([[s * 0.75, sy * 0.36, 1.9], [s * 1.12, sy * 0.66, 1.5], [h[0] * 0.84, h[1] * 0.86, h[2] + 0.1], h], 0.045));
    }
  // Swept dorsal and ventral foils.
  for (const sy of [-1, 1]) {
    const fin = (u: number, a: number): P3 => {
      const y = sy * (0.42 + 2.43 * u);
      const lead = -0.3 + 3.0 * Math.pow(u, 0.67);
      const trail = 3.2 - 0.28 * u;
      const th = 0.12 * (1 - u) + 0.016;
      return [th * Math.sin(a), y, (lead + trail) / 2 + ((trail - lead) / 2) * Math.cos(a)];
    };
    sink.add(`vertical tail foil ${sy}`, S.ivory, sectLoft(fin, 72, 40));
    for (const a of [0, Math.PI]) sink.add('tail gold leading and trailing edges', S.gold, tube(lineSample((u) => fin(u, a)), 0.026));
    for (const side of [-1, 1])
      sink.add(
        'tail inset sweep',
        S.paleGold,
        tube(
          lineSample((u) => {
            const p = fin(0.06 + 0.9 * u, 2.6);
            p[0] = side * (0.12 * (1 - (0.06 + 0.9 * u)) + 0.018);
            return p;
          }),
          0.012,
        ),
      );
  }
  // Three rear engines.
  engine(sink, 0, 0, 3.0, 0.55);
  for (const s of [-1, 1]) {
    sink.add(
      `auxiliary engine fairing ${s}`,
      S.ivory,
      sectLoft((u, a) => {
        const r = 0.16 + 0.2 * Math.sin((u * Math.PI) / 2);
        return [s * 1.15 + r * Math.cos(a), -0.05 + r * Math.sin(a), 1.1 + 1.65 * u];
      }, 40, 40),
    );
    engine(sink, s * 1.15, -0.05, 2.73, 0.32);
  }
  // Fasteners tied to seams and mounts.
  for (const s of [-1, 1])
    for (const z of [-1.0, -0.2, 0.65, 1.5, 2.2]) {
      const p = body((z + 4.7) / 7.75, s > 0 ? 0.65 : Math.PI - 0.65);
      sink.add('flush gold fastener', S.gold, new SphereGeometry(0.026, d(10, 6), d(6, 4)), at(p[0], p[1], p[2], undefined, new Vector3(1, 0.3, 1)));
    }
  // Raised, softly crowned armour shells.
  const panelStations = [0.013, 0.13, 0.265, 0.435, 0.57, 0.72, 0.86, 0.995];
  for (let k = 0; k < panelStations.length - 1; k++)
    for (const s of [-1, 1]) {
      const t0 = panelStations[k] + 0.002;
      const t1 = panelStations[k + 1] - 0.002;
      sink.add(
        `upper ceramic armor ${s} / ${k}`,
        S.ivory,
        armor((u, v) => {
          const t = t0 + (t1 - t0) * u;
          const a = 0.025 + v * (canopyAngle(t) - 0.025);
          return body(t, s > 0 ? a : Math.PI - a);
        }, radial, 32, 16),
      );
      sink.add(
        `lower ceramic armor ${s} / ${k}`,
        S.ivory,
        armor((u, v) => {
          const t = t0 + (t1 - t0) * u;
          const a = 0.035 + v * (Math.PI / 2 - 0.065);
          return body(t, s > 0 ? -a : Math.PI + a);
        }, radial, 28, 14),
      );
    }
  // A central plated keel with an inset luminous nose guide.
  sink.add(
    'nose keel gold ridge',
    S.gold,
    tube(
      lineSample((u) => {
        const p = body(0.005 + u * 0.1, Math.PI / 2);
        return [p[0], p[1] + 0.042, p[2]];
      }),
      0.028,
    ),
  );
  sink.add(
    'nose guidance filament',
    S.glow,
    tube(
      lineSample((u) => {
        const p = body(0.012 + u * 0.052, Math.PI / 2);
        return [p[0], p[1] + 0.07, p[2]];
      }),
      0.009,
    ),
  );
  for (const s of [-1, 1]) {
    // A curved aft spar completes the wing round an open mechanical bay.
    const spar = (u: number, a: number): P3 => {
      const x = s * (0.82 + 3.08 * u);
      const z = 2.3 - 0.82 * u - 0.18 * Math.sin(Math.PI * u);
      return [x, -0.06 + 0.08 * Math.sin(Math.PI * u) + (0.12 * (1 - u) + 0.035) * Math.sin(a), z + (0.21 * (1 - u) + 0.09) * Math.cos(a)];
    };
    sink.add(`swept rear wing spar ${s}`, S.ivory, sectLoft(spar, 64, 24));
    for (const a of [0, Math.PI]) sink.add('aft spar golden edge', S.gold, tube(lineSample((u) => spar(u, a)), 0.025));
    sink.add('wing bay lower structural sweep', S.paleGold, tube([[s * 0.87, -0.38, -0.45], [s * 1.35, -0.46, 0.12], [s * 2.1, -0.27, 0.7], [s * 3.15, -0.06, 1.32], [s * 3.85, 0, 1.37]], 0.055));
    for (let i = 0; i < 7; i++) {
      const u = 0.18 + i * 0.105;
      const front = wingPoint(s, u, 0);
      const back = spar(u, Math.PI);
      sink.add(`exposed wing rib ${s} ${i}`, S.gold, tube([[front[0], front[1] - 0.055, front[2]], [front[0], -0.13, (front[2] + back[2]) / 2], [back[0], back[1], back[2]]], 0.025));
    }
    // Sculpted root armour bridges over the open gold framework.
    sink.add(
      `shoulder armor blade ${s}`,
      S.ivory,
      sectLoft((u, a) => {
        const b = Math.sin(Math.PI * u);
        const x = s * (0.72 + 0.7 * b);
        const z = -1.6 + 4.05 * u;
        return [x + 0.17 * b * Math.cos(a), 0.29 + 0.1 * b + 0.11 * b * Math.sin(a), z];
      }, 70, 32),
    );
    sink.add('shoulder raised gold bevel', S.gold, tube([[s * 0.72, 0.3, -1.6], [s * 1.15, 0.49, -0.6], [s * 1.43, 0.49, 0.5], [s * 1.13, 0.38, 1.8], [s * 0.72, 0.3, 2.45]], 0.019));
    sink.add('cheek brightwork upper', S.paleGold, tube([[s * 0.46, 0.12, -3.85], [s * 0.82, 0.2, -2.8], [s * 1.12, 0.15, -1.5], [s * 1.61, 0.05, 0.5], [s * 1.48, -0.1, 1.1]], 0.02));
    sink.add('cheek brightwork lower', S.gold, tube([[s * 0.46, 0.08, -3.85], [s * 0.87, -0.3, -2.8], [s * 1.15, -0.38, -1.5], [s * 1.42, -0.25, 0.5], [s * 1.48, -0.1, 1.1]], 0.022));
    // Ring-to-wing saddles: milled collars, bright screws.
    sink.add(`halo wing saddle ${s}`, S.gold, sectLoft((u, a) => [s * (3.54 + 0.47 * u), 0.075 * Math.sin(a), 0.55 + 0.28 * Math.cos(a)], 20, 32));
    for (const x of [s * 3.61, s * 3.88])
      for (const z of [0.4, 0.69]) {
        sink.add('ring saddle flush screw', S.paleGold, new SphereGeometry(0.038, d(12, 6), d(8, 4)), at(x, 0.083, z, undefined, new Vector3(1, 0.35, 1)));
        sink.add('screw slot', S.dark, tube([[x - 0.017, 0.098, z], [x + 0.017, 0.098, z]], 0.004));
      }
    // Front shoulder service ports in annular housings.
    for (let j = 0; j < 2; j++) {
      const z = 0.25 + j * 0.64;
      const t = (z + 4.7) / 7.75;
      const a = s > 0 ? 0.83 : Math.PI - 0.83;
      const base = new Vector3(...body(t, a));
      const normal = new Vector3(...radial(base.toArray() as P3));
      const tangent = new Vector3(normal.y, -normal.x, 0).normalize();
      const along = new Vector3(0, 0, 1);
      const collarProfile: [number, number][] = [[0.152, -0.045], [0.166, -0.018], [0.166, 0.015], [0.155, 0.042], [0.135, 0.052], [0.118, 0.052], [0.118, 0.008], [0.13, -0.045], [0.152, -0.045]];
      const cp = base.clone().addScaledVector(normal, 0.031);
      sink.add('hull seated service-port collar', S.gold, new LatheGeometry(collarProfile.map((p) => new Vector2(...p)), d(64, 20)), at(cp.x, cp.y, cp.z, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal)));
      const rq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal);
      const rp = base.clone().addScaledVector(normal, 0.087);
      sink.add('shoulder service port', S.paleGold, torus(0.135, 0.018), at(rp.x, rp.y, rp.z, rq));
      const pp = base.clone().addScaledVector(normal, 0.058);
      sink.add('shoulder port recess', S.dark, new CircleGeometry(0.119, d(48, 16)), at(pp.x, pp.y, pp.z, rq));
      for (let q = -1; q <= 1; q++) {
        const c = base.clone().addScaledVector(normal, 0.074).addScaledVector(along, q * 0.045);
        sink.add('service port grille', S.paleGold, tube([c.clone().addScaledVector(tangent, -0.1).toArray() as P3, c.clone().addScaledVector(tangent, 0.1).toArray() as P3], 0.008));
      }
    }
    // Tail root ribs follow the fin sweep, tied to the aft hull.
    for (const sy of [-1, 1]) {
      sink.add('tail flying buttress', S.paleGold, tube([[s * 0.57, sy * 0.4, 0.1], [s * 0.48, sy * 0.67, 0.72], [s * 0.31, sy * 1.15, 1.42], [s * 0.1, sy * 2.29, 2.5]], 0.038));
      sink.add(
        'tail root ceramic fairing',
        S.ivory,
        sectLoft((u, a) => {
          const z = 0.15 + 2.5 * u;
          const b = Math.sin(Math.PI * u);
          return [s * (0.2 + 0.18 * (1 - u)) + 0.075 * b * Math.cos(a), sy * (0.43 + 0.5 * b) + 0.11 * b * Math.sin(a), z];
        }, 44, 24),
      );
    }
  }
  // Layered tail skins expose the central brass spine and slender relief channels.
  for (const sy of [-1, 1])
    for (const s of [-1, 1]) {
      sink.add(
        'tail inset ceramic field',
        S.ivory,
        armor((u, v) => {
          const h = 0.15 + 0.8 * u;
          const y = sy * (0.42 + 2.43 * h);
          const lead = -0.3 + 3.0 * Math.pow(h, 0.67);
          const trail = 3.2 - 0.28 * h;
          const a = 0.22 + v * 2.7;
          return [s * ((0.12 * (1 - h) + 0.016) * Math.sin(a)), y, (lead + trail) / 2 + ((trail - lead) / 2) * Math.cos(a)];
        }, () => [s, 0, 0], 36, 16),
      );
      sink.add('fin face engraved contour', S.seam, tube([[s * 0.15, sy * 0.66, 0.4], [s * 0.13, sy * 1.1, 1.32], [s * 0.085, sy * 1.82, 2.16], [s * 0.044, sy * 2.65, 2.77]], 0.008));
    }
  // Engine shrouds, cooling petals, collar bolts and plumbing.
  for (const e of CRAFT_ENGINES) {
    const { x: cx, y: cy, z, r } = e;
    for (let j = 0; j < 16; j++) {
      const a = (j * Math.PI * 2) / 16;
      sink.add(
        'nozzle cooling petal',
        S.paleGold,
        sectLoft((u, b) => {
          const rr = r * (1.045 + 0.035 * Math.sin(Math.PI * u));
          return [cx + rr * Math.cos(a) + 0.018 * Math.cos(b), cy + rr * Math.sin(a) + 0.018 * Math.sin(b), z + 0.09 + 0.36 * u];
        }, 8, 8),
      );
      sink.add('engine collar bolt', S.dark, new SphereGeometry(r * 0.035, d(8, 5), d(6, 4)), at(cx + r * 0.9 * Math.cos(a), cy + r * 0.9 * Math.sin(a), z + 0.51));
    }
    for (const a of [0.3, 2.5, 3.8, 5.4])
      sink.add('engine feed tube', S.gold, tube([[cx + r * 0.72 * Math.cos(a), cy + r * 0.72 * Math.sin(a), z - 0.6], [cx + r * 1.12 * Math.cos(a), cy + r * 1.12 * Math.sin(a), z - 0.22], [cx + r * 1.06 * Math.cos(a), cy + r * 1.06 * Math.sin(a), z + 0.08]], 0.02));
    sink.add('rear bell outer heat ring', S.dark, torus(r * 0.87, 0.018), at(cx, cy, z + 0.525));
    sink.add('rear bell luminous rim', S.glow, torus(r * 0.8, 0.012), at(cx, cy, z + 0.535));
  }
  // Fine panel graphics: paired gold registration ticks.
  for (const s of [-1, 1])
    for (const t of [0.3, 0.48, 0.61, 0.79, 0.91]) {
      const a = s > 0 ? 0.52 : Math.PI - 0.52;
      for (let j = 0; j < 3; j++) {
        const q = body(t + j * 0.009, a);
        const n = radial(q);
        sink.add('armor registration tick', S.gold, tube([[q[0] + n[0] * 0.047, q[1] + n[1] * 0.047, q[2]], [q[0] + n[0] * 0.047, q[1] + n[1] * 0.047, q[2] + 0.032]], 0.006));
      }
    }
  // Paired scimitar vanes below the wing roots, with real thickness and bevelled rims.
  for (const s of [-1, 1]) {
    const shape = new Shape();
    shape.moveTo(-1.1, -0.27);
    shape.bezierCurveTo(-0.45, -0.55, 0.65, -0.78, 1.86, -0.74);
    shape.bezierCurveTo(2.22, -0.7, 2.44, -0.44, 2.58, -0.35);
    shape.lineTo(2.31, -0.8);
    shape.bezierCurveTo(2.04, -1.29, 1.75, -1.35, 1.51, -1.07);
    shape.bezierCurveTo(0.9, -0.78, -0.52, -0.64, -1.1, -0.27);
    const g = new ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelSegments: d(3, 2), steps: 1, bevelSize: 0.018, bevelThickness: 0.018, curveSegments: d(32, 10) });
    // Authored profile is (z along, y up); the extrusion maps to lateral x.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getX(i);
      const y = pos.getY(i);
      const x = pos.getZ(i);
      pos.setXYZ(i, s * (1.13 + x + 0.1 * Math.sin(((z + 1.1) / 3.7) * Math.PI)), y, z);
    }
    if (s > 0) {
      for (let i = 0; i < pos.count; i += 3) {
        const b = new Vector3().fromBufferAttribute(pos, i + 1);
        const c = new Vector3().fromBufferAttribute(pos, i + 2);
        pos.setXYZ(i + 1, c.x, c.y, c.z);
        pos.setXYZ(i + 2, b.x, b.y, b.z);
      }
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    sink.add(`curved ventral ceramic vane ${s}`, S.ivory, g);
    sink.add('ventral vane gold lip', S.gold, tube([[s * 1.17, -0.3, -1.04], [s * 1.25, -0.63, 0.1], [s * 1.28, -0.78, 1.1], [s * 1.24, -0.76, 1.85], [s * 1.19, -0.4, 2.51]], 0.025));
    // Its root drops 1.5 cm under the ref's, so it does not run coincident with the lip above it.
    sink.add('ventral vane lower gilded edge', S.paleGold, tube([[s * 1.17, -0.335, -1.03], [s * 1.25, -0.65, 0.2], [s * 1.27, -0.94, 1.36], [s * 1.25, -1.22, 1.8], [s * 1.22, -1.03, 2.14], [s * 1.19, -0.43, 2.5]], 0.022));
    for (const z of [0.15, 1.4]) sink.add('ventral vane mounting fork', S.gold, tube([[s * 0.78, -0.39, z - 0.12], [s * 0.96, -0.58, z], [s * 1.23, -0.71, z + 0.1]], 0.034));
    // Gold branching junctions where armour sections meet.
    for (const t of [0.265, 0.435, 0.57, 0.72, 0.86]) {
      const a = s > 0 ? 0.44 : Math.PI - 0.44;
      const offset = (tt: number, aa: number): P3 => {
        const q = body(tt, aa);
        const n = radial(q);
        return [q[0] + n[0] * 0.045, q[1] + n[1] * 0.045, q[2] + n[2] * 0.045];
      };
      sink.add('branching inlaid seam', S.paleGold, tube([offset(t - 0.022, a - s * 0.12), offset(t - 0.004, a), offset(t + 0.004, a + s * 0.09), offset(t + 0.022, a + s * 0.13)], 0.009));
      sink.add('branching inlay spur', S.gold, tube([offset(t, a + s * 0.04), offset(t + 0.006, a - s * 0.09), offset(t + 0.024, a - s * 0.16)], 0.007));
      const q = offset(t, a);
      sink.add('armor joint rosette', S.gold, new SphereGeometry(0.038, d(12, 6), d(8, 4)), at(q[0], q[1], q[2], undefined, new Vector3(1, 1, 0.5)));
    }
  }
  // The rear centre housing is clad in ceramic petals, separated by narrow brass reveals.
  for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * Math.PI * 2 + 0.045;
    const a1 = ((k + 1) / 10) * Math.PI * 2 - 0.045;
    sink.add(
      `engine ceramic petal ${k}`,
      S.ivory,
      armor((u, v) => {
        const z = 2.31 + 0.72 * u;
        const a = a0 + (a1 - a0) * v;
        const r = 0.56 + 0.055 * Math.sin(u * Math.PI);
        return [r * Math.cos(a), r * Math.sin(a), z];
      }, (q) => {
        const n = new Vector3(q[0], q[1], 0).normalize();
        return [n.x, n.y, n.z];
      }, 18, 10),
    );
  }
  // Mechanical collars at the halo support joints.
  for (const s of [-1, 1])
    for (const sy of [-1, 1]) {
      const p = halo(haloAngle(s, sy));
      sink.add('halo support pivot', S.gold, new SphereGeometry(0.075, d(20, 8), d(12, 6)), at(p[0], p[1], p[2], undefined, new Vector3(1, 1, 0.65)));
      sink.add('halo pivot inset', S.dark, torus(0.034, 0.007), at(p[0], p[1], p[2] - 0.056));
    }
}

/** Builds the craft's geometry (deterministic) at a tessellation level (1: the ref's). */
export function buildCraftModel(level = 1): CraftModel {
  return withDetail(level, () => {
    const parts = new PartSink();
    build(parts);
    return { geometry: parts.merge(), parts, triangles: parts.triangles };
  });
}
