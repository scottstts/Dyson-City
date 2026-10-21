/**
 * What the Hands carry (docs/crew.md, "Props"). Each is a small rig of its own, posed each frame by
 * the Hand that holds it: the slate rides on the left palm; the mower rolls on its own wheels
 * ahead of the Hand that pushes it; the hedge trimmer is swept by both hands. (The estate's
 * gardener works bare-handed.)
 *
 * Frames: each prop is modelled about its own origin (named below) in the Hand's rest axes (+y up,
 * +z forward, +x the Hand's left).
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { box, extrudeBevel } from '../../geometry/solids';
import { turn as lathe, pipe as tube } from '../kit/shapes';
import { roundedRect } from '../../geometry/sweep';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigDef } from '../rig';
import { constant, frame, shell, track } from '../kit/shapes';
import { drum } from './joints';

/**
 * The slate: a reading tablet, 240 × 170 × 12 mm, a ceramic frame round black glass. Origin at
 * its centre; its face toward −x, its long side along y (as held against the left palm at rest).
 */
export const SLATE = { h: 0.24, w: 0.17, t: 0.012 } as const;

export function buildSlate(): RigDef {
  const rb = new RigBuilder('slate');
  rb.segment('slate', null, [0, 0, 0]);
  const b = frame([0, 0, 0], [-1, 0, 0], [0, 0, 1]);
  rb.add('slate', 'frame', extrudeBevel(roundedRect(SLATE.w / 2, SLATE.h / 2, 0.012, 4), b, -SLATE.t / 2, SLATE.t / 2, 0.0025, S.shell));
  rb.add('slate', 'glass', extrudeBevel(roundedRect(SLATE.w / 2 - 0.012, SLATE.h / 2 - 0.016, 0.006, 3), b, SLATE.t / 2 - 0.002, SLATE.t / 2 + 0.0025, 0.0008, S.visor));
  return rb.def;
}

/**
 * The mower: a walk-behind cylinder mower, 0.56 m cut. Origin on the ground under the middle of its
 * rear roller; it faces +z. The handle rises back toward the Hand to grips at MOWER.grip.
 */
export const MOWER = {
  cut: 0.56,
  /** Grips (left, right) relative to the mower's origin. */
  grip: [[0.21, 0.9, -0.66], [-0.21, 0.9, -0.66]] as Vec3[],
  /** Front wheels' and rear roller's centres (z) and radii. */
  wheelZ: 0.4,
  wheelR: 0.09,
  rollerR: 0.075,
  /** How far behind the mower's origin the pushing Hand's root stands. */
  reach: 0.92,
} as const;

export function buildMower(): RigDef {
  const rb = new RigBuilder('mower');
  const M = MOWER;
  rb.segment('deck', null, [0, 0, 0]);
  // The deck: a shell hood over the cutting cylinder, black side plates carrying the wheels.
  rb.add('deck', 'hood', shell(frame([0, 0.2, 0.28], [0, 0, 1], [1, 0, 0]), {
    t0: -0.16,
    t1: 0.22,
    ap: track([[-0.16, 0.25], [0.02, 0.3], [0.22, 0.27]]),
    bp: track([[-0.16, 0.08], [0.05, 0.11], [0.22, 0.07]]),
    bn: constant(0.07),
    n: constant(3.6),
    sides: 32,
    ds: 0.06,
    cap0: 0.03,
    cap1: 0.04,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 0.06 }],
  }));
  for (const sx of [-1, 1]) {
    const x = sx * (M.cut / 2 + 0.025);
    rb.add('deck', `side${sx > 0 ? 'L' : 'R'}`, extrudeBevel(roundedRect(0.33, 0.11, 0.06, 4), frame([x, 0.16, 0.2], [sx, 0, 0], [0, 0, 1]), -0.012, 0.012, 0.003, S.black));
  }
  // The handle: two tubes from the deck's sides up and back to a cross bar with rubber grips.
  const g = M.grip;
  for (const sx of [-1, 1]) {
    const foot: Vec3 = [sx * (M.cut / 2 + 0.025), 0.24, 0.06];
    // Into the cross bar, outboard of the grips.
    const top: Vec3 = [sx * 0.275, g[0][1], g[0][2]];
    rb.add('deck', `bar${sx > 0 ? 'L' : 'R'}`, tube([{ p: foot, r: 0.014 }, { p: v3.lerp(foot, top, 0.5), r: 0.013 }, { p: top, r: 0.013 }], 14, S.graphite));
  }
  rb.add('deck', 'cross', tube([{ p: [-0.3, g[0][1], g[0][2]], r: 0.014 }, { p: [0.3, g[0][1], g[0][2]], r: 0.014 }], 14, S.graphite, { capSlot: S.black }));
  for (const [i, p] of g.entries()) rb.add('deck', `grip${i ? 'R' : 'L'}`, tube([{ p: [p[0] - 0.05, p[1], p[2]], r: 0.019 }, { p: [p[0] + 0.05, p[1], p[2]], r: 0.019 }], 16, S.rubber));
  rb.add('deck', 'motor', drum([0, 0.25, 0.02], [1, 0, 0], 0.07, -0.12, 0.12));
  // Wheels (front, either side) and the rear roller spin as it rolls.
  for (const sx of [-1, 1]) {
    const n = `wheel${sx > 0 ? 'L' : 'R'}`;
    const c: Vec3 = [sx * (M.cut / 2 + 0.06), M.wheelR, M.wheelZ];
    rb.segment(n, 'deck', c);
    rb.add(n, 'tyre', lathe([[M.wheelR - 0.02, -0.022], [M.wheelR - 0.004, -0.022], [M.wheelR, -0.016], [M.wheelR, 0.016], [M.wheelR - 0.004, 0.022], [M.wheelR - 0.02, 0.022]], 32, frame(c, [sx, 0, 0], [0, 1, 0]), S.rubber));
    rb.add(n, 'hub', lathe([[0, -0.018], [M.wheelR - 0.019, -0.018], [M.wheelR - 0.019, 0.018], [0, 0.018]], 24, frame(c, [sx, 0, 0], [0, 1, 0]), S.bronze));
  }
  // The roller's axle: stubs from the side plates to its ends (it turns on them, 2 mm off).
  const stub = (s: number) => tube([{ p: [s * 0.262, M.rollerR, 0], r: 0.014 }, { p: [s * (M.cut / 2 + 0.02), M.rollerR, 0], r: 0.014 }], 14, S.graphite);
  const axle = stub(-1);
  axle.append(stub(1));
  rb.add('deck', 'set:axle', axle);
  rb.segment('roller', 'deck', [0, M.rollerR, 0]);
  rb.add('roller', 'roller', lathe([[0, -0.26], [M.rollerR - 0.004, -0.26], [M.rollerR, -0.255], [M.rollerR, 0.255], [M.rollerR - 0.004, 0.26], [0, 0.26]], 32, frame([0, M.rollerR, 0], [1, 0, 0], [0, 1, 0]), S.graphite));
  return rb.def;
}

/**
 * The hedge trimmer: a long-reach cutter, 1.6 m. Origin at its rear grip (the right hand's); its
 * shaft runs along +z to the cutter bar; the forward grip (the left hand's) at TRIMMER.front.
 */
export const TRIMMER = { length: 1.6, front: 0.62, bar: 0.55 } as const;

export function buildTrimmer(): RigDef {
  const rb = new RigBuilder('trimmer');
  const T = TRIMMER;
  rb.segment('trimmer', null, [0, 0, 0]);
  // The motor housing behind the rear grip, the shaft, the forward grip, the gearbox and the bar.
  rb.add('trimmer', 'motor', shell(frame([0, 0, -0.12], [0, 0, 1], [1, 0, 0]), {
    t0: 0,
    t1: 0.16,
    ap: track([[0, 0.045], [0.16, 0.035]]),
    bp: track([[0, 0.06], [0.16, 0.04]]),
    n: constant(3),
    sides: 24,
    ds: 0.04,
    cap0: 0.02,
    slot: S.shell,
    seamSlot: S.black,
  }));
  rb.add('trimmer', 'rearGrip', tube([{ p: [0, 0, -0.06], r: 0.019 }, { p: [0, 0, 0.07], r: 0.019 }], 16, S.rubber));
  rb.add('trimmer', 'shaft', tube([{ p: [0, 0, 0.06], r: 0.015 }, { p: [0, 0, T.length - T.bar - 0.04], r: 0.015 }], 16, S.graphite));
  rb.add('trimmer', 'frontGrip', tube([{ p: [0, 0, T.front - 0.07], r: 0.02 }, { p: [0, 0, T.front + 0.07], r: 0.02 }], 16, S.rubber));
  const gz = T.length - T.bar - 0.05;
  rb.add('trimmer', 'gearbox', box({ o: [0, 0, gz], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, 0.035, 0.03, 0.05, 0.01, S.black));
  // The cutter bar: a chrome blade with teeth, flat in the shaft's plane.
  const teeth: Vec2[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const z = gz + 0.035 + (T.bar * i) / n;
    teeth.push([0.03, z], [0.044, z + (T.bar / n) * 0.5]);
  }
  const mirrored = teeth.map(([x, z]) => [-x, z] as Vec2).reverse();
  const full: Vec2[] = [[0.03, gz + 0.01], ...teeth, [0.024, gz + 0.035 + T.bar + 0.01], [0, gz + 0.035 + T.bar + 0.03], [-0.024, gz + 0.035 + T.bar + 0.01], ...mirrored, [-0.03, gz + 0.01]];
  rb.add('trimmer', 'bar', extrudeBevel(full.map(([x, z]) => [x, -z] as Vec2), { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, -0.004, 0.004, 0, S.chrome));
  return rb.def;
}

/** Copies of a prop's parts (for audits): every part as one closed, outward solid. */
export function propParts(def: RigDef): { name: string; mesh: PolyMesh }[] {
  return def.segments.flatMap((s) => s.parts.map((p) => ({ name: `${def.name}:${s.name}:${p.name}`, mesh: p.mesh })));
}
