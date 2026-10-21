/**
 * The Rigger (docs/crew.md): the field's heavy hand, a four-legged works robot carrying a
 * telescoping boom. Insect legs splay from the body's underside: each a yaw drum on the body, a
 * femur on a pitch drum in the coxa's yoke, a tibia on a knee drum, a self-levelling rubber pad on
 * an ankle drum. The boom stands on a yaw drum on the body's back: its pitch drum in a yoke, a
 * hollow outer stage, an inner stage sliding inside it, and at its tip a sensor-and-gripper head
 * on a wrist drum.
 *
 * Frame: origin on the ground under the body's centre, +z forward, +y up, +x its left.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { turn as lathe, pipe as tube } from '../kit/shapes';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigDef } from '../rig';
import { constant, frame, hollowBox, panel, shell, shellSurface, track, type ShellSpec } from '../kit/shapes';
import { clevis, clevisCaps, drum, flange } from './joints';

export const RIGGER = {
  body: { hx: 0.34, hy: 0.17, hz: 0.8, y: 0.97 },
  /** The legs' yaw axes (left front; the others mirror), their resting yaw out from +x (rad). */
  hip: [0.36, 0.74, 0.5] as Vec3,
  splay: 0.55,
  /** In the leg's own plane (u out, v up) from the yaw axis: the femur's pitch axis, the knee, the ankle. */
  femur: [0.17, -0.07] as Vec2,
  knee: [0.524, 0.351] as Vec2,
  ankle: [0.663, -0.639] as Vec2,
  /** The foot pad: radius and thickness (its sole on the ground under the ankle). */
  pad: { r: 0.1, t: 0.05 },
  /** The boom: its yaw axis and pitch axis on the back, its stages' lengths. */
  boomYaw: [0, 1.14, -0.42] as Vec3,
  boomPivot: [0, 1.3, -0.42] as Vec3,
  outer: 1.9,
  inner: 1.8,
  /** The boom's resting elevation (rad). */
  boomRest: 0.07,
} as const;

const R = RIGGER;
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

export const LEGS = ['FL', 'FR', 'RL', 'RR'] as const;
export type LegName = (typeof LEGS)[number];

/** A leg's yaw axis (model space) and resting outward direction. */
export function legFrame(name: LegName): { hip: Vec3; out: Vec3; side: 1 | -1; front: 1 | -1 } {
  const side = name.endsWith('L') ? 1 : -1;
  const front = name.startsWith('F') ? 1 : -1;
  const a = front * R.splay;
  // The left legs point out along +x, turned toward their end of the body.
  const out: Vec3 = [side * Math.cos(a), 0, Math.sin(a)];
  return { hip: [side * R.hip[0], R.hip[1], front * R.hip[2]], out, side: side as 1 | -1, front: front as 1 | -1 };
}

/** A point in a leg's plane (u along `out`, v up) to model space. */
export function legPoint(name: LegName, p: Vec2): Vec3 {
  const f = legFrame(name);
  return [f.hip[0] + f.out[0] * p[0], f.hip[1] + p[1], f.hip[2] + f.out[2] * p[0]];
}

function leg(rb: RigBuilder, name: LegName): void {
  const f = legFrame(name);
  const H = f.hip;
  const F = legPoint(name, R.femur);
  const K = legPoint(name, R.knee);
  const A = legPoint(name, R.ankle);
  // The pitch axis is horizontal, ⟂ the leg's plane.
  const pitch = v3.norm(v3.cross(Y, f.out));
  // The hip's housing: a pod out of the hull's flank over the yaw drum (the hip's axis stands just
  // outside the hull), domed into it.
  rb.add('body', `hipPod${name}`, lathe([[0, 0.07], [0.068, 0.07], [0.078, 0.08], [0.078, 0.15], [0.07, 0.19], [0.05, 0.215], [0, 0.225]], 32, frame(H, Y, X), S.shell));
  rb.add('body', `hipDrum${name}`, drum(H, Y, 0.065, 0, 0.09));
  rb.segment(`coxa${name}`, 'body', H);
  rb.add(`coxa${name}`, 'set:flange', flange(H, Y, 0.065, -0.014, -0.004, { face: -1 }));
  rb.add(`coxa${name}`, 'set:yoke', clevis({ c: F, axis: pitch, toward: v3.norm(v3.sub(H, F)), inner: 0.056, outer: 0.07, radius: 0.06, reach: v3.dist(H, F) - 0.008, flare: 0.065, slot: S.shell }));
  rb.add(`coxa${name}`, 'set:caps', clevisCaps(F, pitch, 0.07, 0.034));
  rb.segment(`femur${name}`, `coxa${name}`, F);
  rb.add(`femur${name}`, 'drum', drum(F, pitch, 0.052, -0.05, 0.05));
  const femurSpec: ShellSpec = {
    t0: 0.04,
    t1: v3.dist(F, K) - 0.02,
    ap: constant(0.044),
    bp: track([[0, 0.05], [0.3, 0.062], [0.55, 0.045]]),
    n: constant(3.4),
    sides: 28,
    ds: 0.05,
    cap0: 0.02,
    cap1: 0.02,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 0.12 }, { t: 0.42 }],
  };
  // Beams: u across the leg's plane (along the pitch axis), v in it.
  const femurB = { ...frame(F, v3.sub(K, F), pitch) };
  rb.add(`femur${name}`, 'beam', shell(femurB, femurSpec));
  rb.add(`femur${name}`, 'knee', drum(K, pitch, 0.045, -0.044, 0.044));
  rb.segment(`tibia${name}`, `femur${name}`, K);
  rb.add(`tibia${name}`, 'set:yoke', clevis({ c: K, axis: pitch, toward: v3.norm(v3.sub(A, K)), inner: 0.05, outer: 0.064, radius: 0.055, reach: 0.26, flare: 0.058, slot: S.graphite }));
  rb.add(`tibia${name}`, 'set:caps', clevisCaps(K, pitch, 0.064, 0.03));
  const tibiaLen = v3.dist(K, A);
  rb.add(`tibia${name}`, 'beam', shell(frame(K, v3.sub(A, K), pitch), {
    t0: 0.22,
    t1: tibiaLen - 0.07,
    ap: track([[0.22, 0.048], [tibiaLen, 0.03]]),
    bp: track([[0.22, 0.056], [0.5, 0.05], [tibiaLen, 0.03]]),
    n: constant(3),
    sides: 28,
    ds: 0.06,
    cap0: 0.03,
    cap1: 0.02,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 0.3 }, { t: tibiaLen - 0.2 }],
  }));
  rb.add(`tibia${name}`, 'set:ankle', clevis({ c: A, axis: pitch, toward: v3.norm(v3.sub(K, A)), inner: 0.03, outer: 0.04, radius: 0.03, reach: 0.1, flare: 0.032, slot: S.graphite }));
  rb.segment(`foot${name}`, `tibia${name}`, A);
  rb.add(`foot${name}`, 'drum', drum(A, pitch, 0.026, -0.027, 0.027, { fins: 0 }));
  rb.add(`foot${name}`, 'stem', tube([{ p: [A[0], R.pad.t - 0.01, A[2]], r: 0.022 }, { p: [A[0], A[1] - 0.012, A[2]], r: 0.02 }], 16, S.graphite));
  rb.add(`foot${name}`, 'pad', lathe([[0, 0], [R.pad.r - 0.012, 0], [R.pad.r, 0.012], [R.pad.r, R.pad.t - 0.014], [R.pad.r - 0.016, R.pad.t], [0, R.pad.t]], 36, frame([A[0], 0, A[2]], Y, X), S.rubber));
  rb.add(`foot${name}`, 'hub', lathe([[0, R.pad.t - 0.002], [0.05, R.pad.t - 0.002], [0.048, R.pad.t + 0.008], [0, R.pad.t + 0.008]], 28, frame([A[0], 0, A[2]], Y, X), S.bronze));
}

export function buildRiggerRig(): RigDef {
  const rb = new RigBuilder('rigger');
  rb.segment('body', null, [0, R.body.y, 0]);
  const B = R.body;
  const bodyB = { ...frame([0, B.y, 0], Z, X), v: Y };
  const bodySpec: ShellSpec = {
    t0: -B.hz + 0.08,
    t1: B.hz - 0.1,
    ap: track([[-B.hz, B.hx - 0.02], [0, B.hx], [B.hz, B.hx - 0.03]]),
    bp: track([[-B.hz, B.hy - 0.02], [0, B.hy], [B.hz, B.hy - 0.02]]),
    n: constant(4),
    sides: 48,
    ds: 0.12,
    cap0: 0.08,
    cap1: 0.1,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: -0.36 }, { t: 0.18 }],
  };
  rb.add('body', 'hull', shell(bodyB, bodySpec));
  const surf = shellSurface(bodyB, bodySpec);
  // A black sensor band across the nose, bronze service plates on the flanks.
  rb.add('body', 'band', panel(surf, { t0: B.hz - 0.24, t1: B.hz - 0.12, th0: Math.PI / 2 - 0.9, th1: Math.PI / 2 + 0.9, d0: -0.006, d1: 0.004, nt: 4, nth: 16, bevel: 0.002, slot: S.visor }));
  const plate = (th: number) => ({ t0: -0.32, t1: 0.1, th0: th - 0.42, th1: th + 0.42, d0: -0.006, d1: 0.005, nt: 6, nth: 8, bevel: 0.0025, slot: S.bronze, sideSlot: S.black });
  rb.add('body', 'plateL', panel(surf, plate(0)));
  rb.add('body', 'plateR', panel(surf, plate(Math.PI)));
  for (const n of LEGS) leg(rb, n);
  // The boom: its yaw drum on the back, the yaw's flange and yoke, the pitch drum and stages.
  rb.add('body', 'boomDrum', drum(R.boomYaw, Y, 0.08, -0.03, 0.04));
  rb.segment('boomYaw', 'body', R.boomYaw);
  rb.add('boomYaw', 'set:flange', flange(R.boomYaw, Y, 0.08, 0.044, 0.054));
  rb.add('boomYaw', 'set:yoke', clevis({ c: R.boomPivot, axis: X, toward: [0, -1, 0], inner: 0.086, outer: 0.1, radius: 0.075, reach: R.boomPivot[1] - R.boomYaw[1] - 0.05, flare: 0.08, slot: S.shell }));
  rb.add('boomYaw', 'set:caps', clevisCaps(R.boomPivot, X, 0.1, 0.042));
  rb.segment('boom', 'boomYaw', R.boomPivot);
  rb.add('boom', 'drum', drum(R.boomPivot, X, 0.065, -0.082, 0.082));
  const dir: Vec3 = [0, Math.sin(R.boomRest), Math.cos(R.boomRest)];
  const sb = { ...frame(R.boomPivot, dir, X) };
  rb.add('boom', 'stage', hollowBox(sb, 0.07, R.outer, 0.058, 0.054, 0.008, 0.016, S.shell, S.black));
  rb.add('boom', 'root', shell(sb, { t0: -0.02, t1: 0.08, ap: constant(0.058), bp: constant(0.054), n: constant(4), sides: 24, ds: 0.05, cap0: 0.015, slot: S.shell }));
  // Collars at the stage's mouth and its middle (bronze).
  for (const t of [R.outer - 0.03, 0.95]) rb.add('boom', `collar${t > 1 ? 'Mouth' : 'Mid'}`, hollowBox(sb, t - 0.022, t + 0.022, 0.066, 0.062, 0.012, 0.02, S.bronze));
  rb.segment('inner', 'boom', R.boomPivot);
  // The inner stage: inside the outer with 4 mm running clearance; it slides along the boom.
  const ib = { ...frame(R.boomPivot, dir, X) };
  rb.add('inner', 'stage', shell(ib, { t0: R.outer - R.inner + 0.06, t1: R.outer + 0.06, ap: constant(0.044), bp: constant(0.04), n: constant(5), sides: 28, ds: 0.2, cap0: 0.01, cap1: 0.01, slot: S.chrome }));
  const tip = v3.add(R.boomPivot, v3.scale(dir, R.outer + 0.12));
  rb.add('inner', 'set:wrist', clevis({ c: tip, axis: X, toward: v3.scale(dir, -1), inner: 0.036, outer: 0.046, radius: 0.04, reach: 0.06, flare: 0.04, slot: S.graphite }));
  rb.add('inner', 'set:caps', clevisCaps(tip, X, 0.046, 0.022));
  rb.segment('tool', 'inner', tip);
  rb.add('tool', 'drum', drum(tip, X, 0.034, -0.032, 0.032));
  // The head: a foil-wrapped sensor block with a black lens, two bronze-tipped gripper fingers.
  const hb = { ...frame(v3.add(tip, v3.scale(dir, 0.13)), dir, X), v: v3.cross(dir, X) };
  rb.add('tool', 'head', shell(hb, { t0: -0.06, t1: 0.08, ap: constant(0.062), bp: constant(0.05), n: constant(3.6), sides: 28, ds: 0.04, cap0: 0.015, cap1: 0.015, slot: S.foil, seamSlot: S.black, seams: [{ t: 0 }] }));
  rb.add('tool', 'neck', tube([{ p: v3.add(tip, v3.scale(dir, 0.02)), r: 0.026 }, { p: v3.add(tip, v3.scale(dir, 0.06)), r: 0.03 }], 18, S.graphite));
  const lensC = v3.add(tip, v3.scale(dir, 0.23));
  rb.add('tool', 'lens', lathe([[0, -0.006], [0.03, -0.006], [0.032, -0.002], [0.032, 0.006], [0.026, 0.011], [0, 0.011]], 28, frame(v3.add(lensC, [0, 0.018, 0]), dir, X), S.visor));
  for (const sx of [-1, 1]) {
    const base = v3.add(v3.add(lensC, [sx * 0.048, -0.03, 0]), v3.scale(dir, -0.02));
    const end = v3.add(base, v3.add(v3.scale(dir, 0.1), [-sx * 0.012, -0.012, 0]));
    rb.add('tool', `finger${sx > 0 ? 'L' : 'R'}`, tube([{ p: base, r: 0.012 }, { p: v3.lerp(base, end, 0.6), r: 0.011 }, { p: end, r: 0.009 }], 14, (i) => (i > 0 ? S.bronze : S.graphite)));
  }
  return rb.def;
}
