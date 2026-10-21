/**
 * The Dray (docs/crew.md): a low autonomous flatbed that services the plant inside its precinct. Its
 * deck carries a cryogen dewar on saddles; under its tail a coupling probe drops into a bronze
 * service socket in the paving (fixtures.ts) when it parks over one. Four wheels on steering
 * knuckles (all-wheel steer, so it turns tight in a service lane), each on a kingpin drum under the
 * deck.
 *
 * Frame: origin on the ground under the deck's centre, +z forward, +y up.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { box, extrudeBevel } from '../../geometry/solids';
import { turn as lathe, pipe as tube } from '../kit/shapes';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigDef } from '../rig';
import { constant, frame, panel, shell, shellSurface, track, type ShellSpec } from '../kit/shapes';
import { clevis, clevisCaps, drum, flange } from './joints';

export const DRAY = {
  deck: { hx: 0.9, hz: 2.0, y0: 0.66, y1: 0.8 },
  wheel: { r: 0.3, half: 0.1, x: 0.72, z: 1.35 },
  /** The kingpins' drums under the deck. */
  kingpinY: 0.63,
  dewar: { r: 0.45, z0: -1.25, z1: 0.85, y: 1.28 },
  /** The coupling probe: its axis (x, z), housing bottom, travel. */
  probe: { x: 0, z: -0.7, y: 0.2, travel: 0.094 },
  /** Steering lock (rad). */
  lock: 0.55,
} as const;

const D = DRAY;
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

export const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;
export function wheelCentre(n: (typeof WHEELS)[number]): Vec3 {
  return [(n.endsWith('L') ? 1 : -1) * D.wheel.x, D.wheel.r, (n.startsWith('F') ? 1 : -1) * D.wheel.z];
}

export function buildDrayRig(): RigDef {
  const rb = new RigBuilder('dray');
  rb.segment('body', null, [0, D.deck.y0, 0]);
  // The deck: a broad slab with rounded ends, black seams, a sensor band across its nose.
  const deckB = { ...frame([0, (D.deck.y0 + D.deck.y1) / 2, 0], Z, X), v: Y };
  const hy = (D.deck.y1 - D.deck.y0) / 2;
  const deckSpec: ShellSpec = {
    t0: -D.deck.hz + 0.12,
    t1: D.deck.hz - 0.16,
    ap: constant(D.deck.hx),
    bp: constant(hy),
    n: constant(5),
    sides: 56,
    ds: 0.25,
    cap0: 0.12,
    cap1: 0.16,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: -0.9 }, { t: 0.4 }, { t: 1.4 }],
  };
  rb.add('body', 'deck', shell(deckB, deckSpec));
  const deckSurf = shellSurface(deckB, deckSpec);
  void deckSurf;
  // The nose: a raised module across the front (sensors, drives' electronics), its sensor band.
  const noseB = { ...frame([0, 0.9, 0], Z, X), v: Y };
  const noseSpec: ShellSpec = {
    t0: 1.5,
    t1: 1.86,
    ap: track([[1.5, 0.84], [1.86, 0.8]]),
    bp: track([[1.5, 0.3], [1.86, 0.24]]),
    bn: constant(0.22),
    n: constant(4.2),
    sides: 48,
    ds: 0.12,
    cap0: 0.03,
    cap1: 0.1,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 1.6 }],
  };
  rb.add('body', 'nose', shell(noseB, noseSpec));
  rb.add('body', 'band', panel(shellSurface(noseB, noseSpec), { t0: 1.68, t1: 1.83, th0: Math.PI / 2 - 1.15, th1: Math.PI / 2 + 1.15, d0: -0.006, d1: 0.004, nt: 3, nth: 22, bevel: 0.002, slot: S.visor }));
  // The equipment box aft, a bronze service panel on its back.
  const aftB = { ...frame([0, 0.88, 0], Z, X), v: Y };
  const aftSpec: ShellSpec = { t0: -1.86, t1: -1.56, ap: constant(0.76), bp: constant(0.18), bn: constant(0.2), n: constant(4.4), sides: 48, ds: 0.1, cap0: 0.08, cap1: 0.03, slot: S.shell, seamSlot: S.black };
  rb.add('body', 'aft', shell(aftB, aftSpec));
  rb.add('body', 'aftPanel', panel(shellSurface(aftB, aftSpec), { t0: -1.84, t1: -1.62, th0: Math.PI / 2 - 0.9, th1: Math.PI / 2 + 0.9, d0: -0.005, d1: 0.004, nt: 4, nth: 12, bevel: 0.002, slot: S.bronze, sideSlot: S.black }));
  // Graphite skirts under the deck's edges, between the wheels.
  // (Their tops run up into the deck's rounded edge.)
  for (const sx of [-1, 1]) rb.add('body', `skirt${sx > 0 ? 'L' : 'R'}`, box({ o: [sx * 0.86, 0.5825, 0], u: X, v: Y, w: Z }, 0.016, 0.1175, 0.9, 0.012, S.graphite));
  // The spine under the deck between the axles: batteries and drives, graphite.
  rb.add('body', 'spine', shell({ ...frame([0, 0.46, 0], Z, X), v: Y }, {
    t0: -0.85,
    t1: 0.85,
    ap: constant(0.42),
    bp: constant(0.2),
    n: constant(4),
    sides: 36,
    ds: 0.3,
    cap0: 0.08,
    cap1: 0.08,
    slot: S.graphite,
    seamSlot: S.black,
    seams: [{ t: -0.3 }, { t: 0.3 }],
  }));
  // Kingpin drums under the deck, their knuckles' forks round the wheels.
  for (const n of WHEELS) {
    const c = wheelCentre(n);
    const kp: Vec3 = [c[0], D.kingpinY, c[2]];
    rb.add('body', `kingpin${n}`, drum(kp, Y, 0.06, -0.01, 0.05));
    rb.segment(`knuckle${n}`, 'body', kp);
    rb.add(`knuckle${n}`, 'set:flange', flange(kp, Y, 0.06, -0.022, -0.013, { face: -1 }));
    rb.add(`knuckle${n}`, 'set:fork', clevis({ c, axis: X, toward: Y, inner: D.wheel.half + 0.018, outer: D.wheel.half + 0.04, radius: 0.07, reach: D.kingpinY - c[1] - 0.021, flare: 0.08, slot: S.graphite }));
    rb.add(`knuckle${n}`, 'set:caps', clevisCaps(c, X, D.wheel.half + 0.04, 0.05, 0.008));
    // The fork's crown under the flange, joining its plates; the axle's stubs from the plates to the
    // hub motor's faces (the motor's rotor turns on them, 2.5 mm off).
    rb.add(`knuckle${n}`, 'crown', box({ o: [c[0], 0.6085, c[2]], u: X, v: Y, w: Z }, D.wheel.half + 0.044, 0.005, 0.085, 0.003, S.graphite));
    const stub = (s: number) => tube([{ p: [c[0] + s * (D.wheel.half + 0.009), c[1], c[2]], r: 0.035 }, { p: [c[0] + s * (D.wheel.half + 0.024), c[1], c[2]], r: 0.035 }], 20, S.graphite);
    const axle = stub(-1);
    axle.append(stub(1));
    rb.add(`knuckle${n}`, 'set:axle', axle);
    rb.segment(`wheel${n}`, `knuckle${n}`, c);
    rb.add(`wheel${n}`, 'tyre', tyre(c));
    rb.add(`wheel${n}`, 'hub', lathe([[0, -D.wheel.half + 0.01], [0.173, -D.wheel.half + 0.01], [0.193, -D.wheel.half + 0.02], [0.193, D.wheel.half - 0.02], [0.173, D.wheel.half - 0.01], [0, D.wheel.half - 0.01]], 40, frame(c, X, Y), S.bronze));
    rb.add(`wheel${n}`, 'motor', drum(c, X, 0.11, -D.wheel.half - 0.004, D.wheel.half + 0.004));
  }
  // The dewar on its saddles: a vessel with elliptical heads, bronze girth bands, a valve cluster aft.
  const dw = D.dewar;
  const len = dw.z1 - dw.z0;
  const prof: Vec2[] = [[0, -len / 2]];
  const head = dw.r * 0.45;
  for (let i = 1; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    prof.push([dw.r * Math.sin(a), -len / 2 + head * (1 - Math.cos(a))]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    prof.push([dw.r * Math.cos(a), len / 2 - head + head * Math.sin(a)]);
  }
  prof[prof.length - 1][0] = 0;
  const dc: Vec3 = [0, dw.y, (dw.z0 + dw.z1) / 2];
  rb.add('body', 'dewar', lathe(prof, 48, frame(dc, Z, Y), S.shell, 50));
  for (const z of [-0.62, 0.0, 0.62]) rb.add('body', `band${z < 0 ? 'A' : z > 0 ? 'F' : 'M'}`, lathe([[dw.r - 0.01, -0.03], [dw.r + 0.012, -0.03], [dw.r + 0.016, -0.026], [dw.r + 0.016, 0.026], [dw.r + 0.012, 0.03], [dw.r - 0.01, 0.03]], 48, frame(v3.add(dc, [0, 0, z]), Z, Y), S.bronze));
  for (const z of [dw.z0 + 0.45, dw.z1 - 0.45]) {
    rb.add('body', `saddle${z < 0 ? 'A' : 'F'}`, saddle(z));
  }
  const vz = dw.z0 - 0.02;
  const valveP: Vec3 = [0, dw.y + 0.05, vz];
  rb.add('body', 'valveStem', tube([{ p: [0, dw.y + 0.05, vz + 0.12], r: 0.04 }, { p: [0, dw.y + 0.05, vz - 0.06], r: 0.04 }], 18, S.bronze));
  rb.add('body', 'valveBody', box({ o: v3.add(valveP, [0, 0, -0.09]), u: X, v: Y, w: Z }, 0.07, 0.07, 0.04, 0.012, S.bronze));
  // The handwheel: its rim on four spokes from a hub on the stem.
  const wc = v3.add(valveP, [0, 0.11, -0.09]);
  const wheel = lathe([[0.052, -0.009], [0.07, -0.009], [0.075, -0.005], [0.075, 0.005], [0.07, 0.009], [0.052, 0.009]], 28, frame(wc, Y, X), S.graphite);
  wheel.append(lathe([[0, -0.014], [0.019, -0.014], [0.022, -0.011], [0.022, 0.011], [0.019, 0.014], [0, 0.014]], 20, frame(wc, Y, X), S.graphite));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const d: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    wheel.append(tube([{ p: v3.add(wc, v3.scale(d, 0.017)), r: 0.0055 }, { p: v3.add(wc, v3.scale(d, 0.058)), r: 0.0055 }], 10, S.graphite));
  }
  rb.add('body', 'set:valveWheel', wheel);
  rb.add('body', 'valveNeck', tube([{ p: v3.add(valveP, [0, 0.06, -0.09]), r: 0.014 }, { p: v3.add(valveP, [0, 0.105, -0.09]), r: 0.014 }], 12, S.graphite));
  // The coupling probe: its housing under the spine's tail; the probe slides down out of it.
  const pr = D.probe;
  // A sleeve (an open ring) hung from the spine: the rod slides through it with 3 mm clearance.
  rb.add('body', 'probeSleeve', lathe([[0.038, -0.06], [0.064, -0.06], [0.07, -0.054], [0.07, 0.062], [0.038, 0.062]], 32, frame([pr.x, pr.y, pr.z], Y, X), S.graphite));
  rb.segment('probe', 'body', [pr.x, pr.y, pr.z]);
  rb.add('probe', 'rod', tube([{ p: [pr.x, pr.y + 0.055, pr.z], r: 0.035 }, { p: [pr.x, pr.y - 0.072, pr.z], r: 0.035 }], 20, S.chrome));
  rb.add('probe', 'coupling', lathe([[0, -0.09], [0.05, -0.09], [0.056, -0.084], [0.056, -0.074], [0.045, -0.066], [0, -0.066]], 28, frame([pr.x, pr.y, pr.z], Y, X), S.bronze));
  return rb.def;
}

/** A tyre on its rim: rounded rubber section about the wheel's axis (x). */
function tyre(c: Vec3) {
  const r = D.wheel.r;
  const h = D.wheel.half;
  const prof: Vec2[] = [[r - 0.11, -h + 0.005], [r - 0.03, -h], [r - 0.008, -h + 0.02], [r, -h + 0.045], [r, h - 0.045], [r - 0.008, h - 0.02], [r - 0.03, h], [r - 0.11, h - 0.005]];
  return lathe(prof, 48, frame(c, X, Y), S.rubber, 40);
}

/** A graphite saddle under the dewar at z: a block whose top is cut to the vessel's curve. */
function saddle(z: number) {
  const dw = D.dewar;
  const out: Vec2[] = [];
  const half = 0.42;
  out.push([-half, D.deck.y1 - 0.01], [half, D.deck.y1 - 0.01]);
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const x = half - (2 * half * i) / n;
    const y = dw.y - Math.sqrt(Math.max(0, dw.r * dw.r - x * x)) + 0.006 - 0.011;
    out.push([x, Math.max(y, D.deck.y1 + 0.04)]);
  }
  // (u = x, v = y) in a basis whose w is z.
  return extrudeBevel(out, { o: [0, 0, z], u: X, v: Y, w: Z }, -0.06, 0.06, 0.01, S.graphite);
}
