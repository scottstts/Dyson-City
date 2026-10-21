/**
 * The Hand (docs/crew.md): the crew's humanoid, 1.78 m, for the work that was made for human
 * hands. A warm-white ceramic shell over a black core: fitted panels with fine seams, a smooth
 * helmet with a black glass visor band and no face, rubber soles and palms, and at every joint the
 * machinery that moves it.
 *
 * Every degree of freedom is a rotary actuator (joints.ts): a finned motor drum on one link, a
 * bolted bronze flange or a yoke on the next. Joints of several are gimbals, their axes crossing at
 * the joint's centre: the hip is yaw (a drum under the girdle), roll and pitch (two crossed drums in
 * yokes); the shoulder pitch (a drum in the chest's stub), roll (a drum in a yoke) and yaw (a drum
 * down the arm's axis); the waist and neck yaw then pitch; the wrist twists (a drum round the
 * forearm's end) then flexes; the ankle pitches and rolls on a cross. Knees and elbows are hinges:
 * a boss straddled by a clevis, carried on a web (a tongue thinner than the clevis's gap) down into
 * the limb; the palm hangs from its flex drum on a web the same way, the head stands on a turned
 * neck rising from its pitch drum. Every piece is joined to the next: nothing floats.
 *
 * Built in its rest pose (standing, arms hanging, palms in) in model space: metres, +y up, +z
 * forward, +x its left; origin on the ground between the feet. Left parts are modelled and mirrored
 * for the right.
 */
import { v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { extrudeBevel } from '../../geometry/solids';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigDef } from '../rig';
import { boss, constant, frame, mirrorX, panel, shell, shellSurface, track, turn as lathe, type ShellSpec } from '../kit/shapes';
import { clevis, clevisCaps, drum, flange } from './joints';

/** Rest-pose joint centres (left side; the right mirrors x). */
export const HAND_PIVOT = {
  pelvis: [0, 0.96, 0] as Vec3,
  // The leg's pivots share one sagittal plane: the knee's hinge is exactly x.
  hip: [0.095, 0.905, 0] as Vec3,
  knee: [0.095, 0.497, 0.012] as Vec3,
  ankle: [0.095, 0.088, -0.004] as Vec3,
  /** The waist's pitch axis (its yaw axis is the vertical through it). */
  waist: [0, 1.115, -0.005] as Vec3,
  /** The neck's pitch axis (its yaw axis is the vertical through it). */
  neck: [0, 1.575, -0.012] as Vec3,
  // The upper arm hangs plumb from the shoulder (its yaw axis is vertical); the forearm leans a
  // little forward, so the elbow's hinge is exactly x.
  shoulder: [0.195, 1.425, -0.012] as Vec3,
  elbow: [0.195, 1.13, -0.012] as Vec3,
  wrist: [0.195, 0.875, 0.006] as Vec3,
} as const;

/** Finger knuckles below the wrist, their offsets across the palm (+z: the thumb's side), and lengths. */
export const FINGERS = [
  { name: 'index', z: 0.028, L: 0.07 },
  { name: 'middle', z: 0.0095, L: 0.078 },
  { name: 'ring', z: -0.0095, L: 0.074 },
  { name: 'little', z: -0.027, L: 0.06 },
] as const;
const KNUCKLE_DROP = 0.104;
const FINGER_R = 0.0083;
export const THUMB = { drop: 0.05, out: -0.003, fwd: 0.03, L: 0.056, r: 0.0098, dir: v3.norm([-0.12, -0.9, 0.42]) as Vec3 } as const;

export const HAND_HEIGHT = 1.78;
/** Sole of the foot under the ankle (the rest-pose ankle height). */
export const ANKLE_HEIGHT = HAND_PIVOT.ankle[1];
/** Foot plan: heel and toe (z, from the model origin), half-width at the ball. */
export const FOOT = { heel: -0.072, toe: 0.19, half: 0.047, sole: 0.02 } as const;

const P = HAND_PIVOT;
/** The elbow's hinge (the plane of the resting arm is x = const). */
export const ELBOW_AXIS: Vec3 = [1, 0, 0];
/** The forearm's axis (the wrist's twist), from elbow to wrist. */
export const FOREARM_AXIS: Vec3 = v3.norm(v3.sub(P.wrist, P.elbow));
const mx = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
const sub = v3.sub;
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/**
 * Joint ranges (radians) per actuator, as the validator holds them (tests/crewHand.test.ts). Signs:
 * hip and shoulder pitch forward +, roll outward +; knee and elbow flexion +; ankle pitch toe-down +.
 */
export const HAND_LIMITS = {
  hipYaw: [-0.45, 0.45],
  hipRoll: [-0.2, 0.32],
  hipPitch: [-0.55, 1.7],
  knee: [0, 1.95],
  anklePitch: [-0.75, 0.62],
  ankleRoll: [-0.26, 0.26],
  waistYaw: [-0.55, 0.55],
  waistPitch: [-0.2, 0.62],
  neckYaw: [-1.05, 1.05],
  neckPitch: [-0.55, 0.6],
  shoulderPitch: [-0.7, 2.6],
  shoulderRoll: [-0.12, 1.6],
  shoulderYaw: [-1.1, 1.1],
  elbow: [0, 2.45],
  wristTwist: [-1.3, 1.3],
  wristFlex: [-1.0, 1.0],
  finger: [0, 1.5],
  thumb: [0, 1.0],
} as const;

/** A limb shell between two pivots: t runs from a toward b (metres), u along +x, v toward the front. */
function limb(a: Vec3, b: Vec3, spec: Omit<ShellSpec, 'slot'> & { slot?: number }) {
  const base = frame(a, sub(b, a), [1, 0, 0]);
  // frame(): v = w × u. For a limb pointing down, that is +z (front).
  const s: ShellSpec = { slot: S.shell, seamSlot: S.black, ...spec };
  return { mesh: shell(base, s), surf: shellSurface(base, s), base };
}

/**
 * The web that carries a hinge's boss into its limb (a clevis's tongue): a flat bar about the hinge's
 * axis, from inside the boss (`from`) to inside the limb's shell (`to`), its width across the limb
 * w0 at the boss and w1 at the limb, its thickness along the axis 2·half (inside the clevis's gap).
 */
function web(c: Vec3, axis: Vec3, along: Vec3, from: number, to: number, w0: number, w1: number, half: number, slot: number = S.graphite) {
  const b = frame(c, axis, along);
  // Outline in (u: along the limb, v: across it), corners rounded.
  const out: Vec2[] = [];
  const r = Math.min(w0, w1) * 0.35;
  const corner = (cu: number, cv: number, a0: number) => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (Math.PI / 2) * (i / 3);
      out.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]);
    }
  };
  corner(to - r, -w1 + r, -Math.PI / 2);
  corner(to - r, w1 - r, 0);
  corner(from + r, w0 - r, Math.PI / 2);
  corner(from + r, -w0 + r, Math.PI);
  return extrudeBevel(out, b, -half, half, Math.min(0.002, half * 0.2), slot);
}

/** A cover plate proud of a limb: axial span, centre angle, half-angle (5.5 mm proud, black sides). */
function plate(t0: number, t1: number, th: number, half: number) {
  return { t0, t1, th0: th - half, th1: th + half, d0: -0.005, d1: 0.0055, nt: 8, nth: 10, bevel: 0.0025, slot: S.shell, sideSlot: S.black };
}

function leg(rb: RigBuilder, side: 'L' | 'R'): void {
  const m = side === 'L' ? (p: Vec3) => p : mx;
  const add = (seg: string, name: string, mesh: ReturnType<typeof shell>) => rb.add(seg, name, side === 'L' ? mesh : mirrorX(mesh));
  const H = P.hip;
  const K = P.knee;
  const A = P.ankle;
  rb.segment(`hipYaw${side}`, 'pelvis', m(H));
  rb.segment(`hipRoll${side}`, `hipYaw${side}`, m(H));
  rb.segment(`thigh${side}`, `hipRoll${side}`, m(H));
  rb.segment(`shin${side}`, `thigh${side}`, m(K));
  rb.segment(`ankle${side}`, `shin${side}`, m(A));
  rb.segment(`foot${side}`, `ankle${side}`, m(A));
  // The pelvis carries the hip's yaw drum (pelvis.ts adds it); its flange and the roll yoke turn on it.
  add(`hipYaw${side}`, 'set:flange', flange(H, Y, 0.04, 0.056, 0.064, { face: -1 }));
  add(`hipYaw${side}`, 'set:yoke', clevis({ c: H, axis: Z, toward: Y, inner: 0.04, outer: 0.051, radius: 0.036, reach: 0.06, flare: 0.04, slot: S.shell }));
  add(`hipYaw${side}`, 'set:caps', clevisCaps(H, Z, 0.051, 0.021));
  // Roll and pitch: two crossed drums.
  add(`hipRoll${side}`, 'roll', drum(H, Z, 0.032, -0.035, 0.035));
  add(`hipRoll${side}`, 'pitch', drum(H, X, 0.032, -0.037, 0.037));
  // Thigh: the pitch clevis, the shell (fuller in front), its plate, the knee's clevis.
  add(`thigh${side}`, 'set:clevis', clevis({ c: H, axis: X, toward: v3.norm(sub(K, H)), inner: 0.041, outer: 0.052, radius: 0.036, reach: 0.1, flare: 0.046, slot: S.graphite }));
  add(`thigh${side}`, 'set:caps', clevisCaps(H, X, 0.052, 0.021));
  const thigh = limb(H, K, {
    t0: 0.094,
    t1: 0.345,
    ap: track([[0.094, 0.056], [0.15, 0.066], [0.26, 0.06], [0.345, 0.049]]),
    an: track([[0.094, 0.05], [0.15, 0.058], [0.26, 0.053], [0.345, 0.045]]),
    bp: track([[0.094, 0.058], [0.16, 0.072], [0.27, 0.062], [0.345, 0.05]]),
    bn: track([[0.094, 0.058], [0.16, 0.066], [0.27, 0.056], [0.345, 0.047]]),
    n: constant(2.5),
    sides: 32,
    ds: 0.028,
    cap0: 0.016,
    cap1: 0.012,
    seams: [{ t: 0.31 }],
  });
  add(`thigh${side}`, 'shell', thigh.mesh);
  add(`thigh${side}`, 'plate', panel(thigh.surf, plate(0.12, 0.285, Math.PI / 2, 0.85)));
  add(`thigh${side}`, 'set:knee', clevis({ c: K, axis: X, toward: v3.norm(sub(H, K)), inner: 0.036, outer: 0.052, radius: 0.05, reach: 0.11, flare: 0.052, slot: S.graphite }));
  add(`thigh${side}`, 'set:kneeCaps', clevisCaps(K, X, 0.052, 0.024));
  // Shin: the knee's boss on its web, the shell (the calf behind), its guard, the ankle's clevis.
  add(`shin${side}`, 'knee', boss({ ...frame(K, X, Y) }, 0.044, 0.03, S.black, { hubSlot: S.bronze, segments: 28 }));
  add(`shin${side}`, 'web', web(K, X, sub(A, K), 0.03, 0.095, 0.03, 0.036, 0.024));
  const shin = limb(K, A, {
    t0: 0.068,
    t1: 0.29,
    ap: track([[0.068, 0.043], [0.12, 0.049], [0.2, 0.046], [0.29, 0.035]]),
    an: track([[0.068, 0.039], [0.12, 0.045], [0.2, 0.042], [0.29, 0.032]]),
    bp: track([[0.068, 0.042], [0.29, 0.034]]),
    bn: track([[0.068, 0.048], [0.12, 0.064], [0.21, 0.054], [0.29, 0.036]]),
    n: constant(2.4),
    sides: 32,
    ds: 0.028,
    cap0: 0.009,
    cap1: 0.012,
    seams: [{ t: 0.27 }],
  });
  add(`shin${side}`, 'shell', shin.mesh);
  add(`shin${side}`, 'guard', panel(shin.surf, plate(0.088, 0.252, Math.PI / 2, 0.78)));
  add(`shin${side}`, 'set:clevis', clevis({ c: A, axis: X, toward: v3.norm(sub(K, A)), inner: 0.031, outer: 0.041, radius: 0.03, reach: 0.12, flare: 0.036, slot: S.graphite }));
  add(`shin${side}`, 'set:caps', clevisCaps(A, X, 0.041, 0.016));
  // Ankle: pitch and roll on a cross.
  add(`ankle${side}`, 'pitch', drum(A, X, 0.025, -0.027, 0.027));
  add(`ankle${side}`, 'roll', drum(A, Z, 0.021, -0.026, 0.026));
  // Foot: a rubber sole, a low shell over it, the roll yoke rising to the cross.
  add(`foot${side}`, 'sole', extrudeBevel(footOutline(), { o: [A[0], 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, 0, FOOT.sole, 0.004, S.rubber));
  add(
    `foot${side}`,
    'shell',
    shell(frame([A[0], 0.026, 0], [0, 0, 1], [1, 0, 0]), {
      t0: FOOT.heel + 0.008,
      t1: FOOT.toe - 0.012,
      // frame(): v = w × u = z × x = +y (up).
      ap: track([[FOOT.heel, 0.036], [0.0, 0.04], [0.12, 0.044], [FOOT.toe, 0.036]]),
      bp: track([[FOOT.heel, 0.016], [0.0, 0.02], [0.1, 0.016], [FOOT.toe, 0.009]]),
      bn: constant(0.0075),
      n: constant(3.2),
      sides: 24,
      ds: 0.025,
      cap0: 0.008,
      cap1: 0.01,
      slot: S.shell,
      seamSlot: S.black,
      seams: [{ t: 0.085 }],
    }),
  );
  add(`foot${side}`, 'set:yoke', clevis({ c: A, axis: Z, toward: [0, -1, 0], inner: 0.031, outer: 0.039, radius: 0.027, reach: A[1] - 0.035, flare: 0.032, slot: S.shell }));
  add(`foot${side}`, 'set:caps', clevisCaps(A, Z, 0.039, 0.015));
}

/** The sole's outline in plan about the ankle's x: a tapering superellipse, heel narrow. */
function footOutline(): Vec2[] {
  const n = 48;
  const zc = (FOOT.heel + FOOT.toe) / 2;
  const a = (FOOT.toe - FOOT.heel) / 2;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const z = zc + Math.sign(c) * Math.abs(c) ** (2 / 2.6) * a;
    const k = 0.84 + 0.2 * Math.min(1, Math.max(0, (z - FOOT.heel) / (0.12 - FOOT.heel)));
    const x = Math.sign(s) * Math.abs(s) ** (2 / 2.6) * FOOT.half * k;
    // Basis (u = +x, v = −z): plan (x, z) → (x, −z).
    out.push([x, -z]);
  }
  return out;
}

function arm(rb: RigBuilder, side: 'L' | 'R'): void {
  const m = side === 'L' ? (p: Vec3) => p : mx;
  const add = (seg: string, name: string, mesh: ReturnType<typeof shell>) => rb.add(seg, name, side === 'L' ? mesh : mirrorX(mesh));
  const Sh = P.shoulder;
  const E = P.elbow;
  const W = P.wrist;
  rb.segment(`shoulderPitch${side}`, 'torso', m(Sh));
  rb.segment(`shoulderRoll${side}`, `shoulderPitch${side}`, m(Sh));
  rb.segment(`upperArm${side}`, `shoulderRoll${side}`, m(Sh));
  rb.segment(`forearm${side}`, `upperArm${side}`, m(E));
  rb.segment(`wrist${side}`, `forearm${side}`, m(W));
  rb.segment(`palm${side}`, `wrist${side}`, m(W));
  // Pitch: the chest's stub carries the drum (trunk()); its flange and the roll yoke turn on it.
  add(`shoulderPitch${side}`, 'set:flange', flange(Sh, X, 0.042, -0.044, -0.037));
  add(`shoulderPitch${side}`, 'set:yoke', clevis({ c: Sh, axis: Z, toward: [-1, 0, 0], inner: 0.039, outer: 0.05, radius: 0.036, reach: 0.044, flare: 0.042, slot: S.shell }));
  add(`shoulderPitch${side}`, 'set:caps', clevisCaps(Sh, Z, 0.05, 0.02));
  // Roll: a drum in the yoke; under it the yaw drum, down the arm's axis.
  add(`shoulderRoll${side}`, 'roll', drum(Sh, Z, 0.03, -0.034, 0.034));
  add(`shoulderRoll${side}`, 'yaw', drum(Sh, Y, 0.029, -0.074, -0.02));
  // The upper arm: the yaw's flange, the shell, the deltoid cover, the elbow's clevis.
  add(`upperArm${side}`, 'set:flange', flange(Sh, Y, 0.033, -0.084, -0.077, { face: -1 }));
  const upper = limb(Sh, E, {
    t0: 0.094,
    t1: 0.232,
    ap: track([[0.094, 0.044], [0.15, 0.044], [0.232, 0.038]]),
    an: track([[0.094, 0.041], [0.15, 0.041], [0.232, 0.036]]),
    bp: track([[0.094, 0.044], [0.15, 0.046], [0.232, 0.037]]),
    bn: track([[0.094, 0.042], [0.15, 0.043], [0.232, 0.036]]),
    n: constant(2.4),
    sides: 28,
    ds: 0.028,
    cap0: 0.012,
    cap1: 0.01,
    seams: [{ t: 0.205 }],
  });
  add(`upperArm${side}`, 'shell', upper.mesh);
  add(`upperArm${side}`, 'plate', panel(upper.surf, plate(0.108, 0.188, 0, 0.95)));
  add(`upperArm${side}`, 'set:clevis', clevis({ c: E, axis: X, toward: v3.norm(sub(Sh, E)), inner: 0.027, outer: 0.041, radius: 0.036, reach: 0.085, flare: 0.04, slot: S.graphite }));
  add(`upperArm${side}`, 'set:caps', clevisCaps(E, X, 0.041, 0.018));
  // The forearm: the elbow's boss on its web, the shell, its cover, the wrist's twist drum.
  add(`forearm${side}`, 'elbow', boss({ ...frame(E, X, Y) }, 0.033, 0.021, S.black, { hubSlot: S.bronze }));
  add(`forearm${side}`, 'web', web(E, X, FOREARM_AXIS, 0.022, 0.07, 0.022, 0.026, 0.016));
  const fore = limb(E, W, {
    t0: 0.05,
    t1: 0.196,
    ap: track([[0.05, 0.037], [0.12, 0.036], [0.196, 0.03]]),
    an: track([[0.05, 0.035], [0.12, 0.034], [0.196, 0.028]]),
    bp: track([[0.05, 0.038], [0.12, 0.037], [0.196, 0.029]]),
    bn: track([[0.05, 0.036], [0.12, 0.035], [0.196, 0.028]]),
    n: constant(2.5),
    sides: 28,
    ds: 0.028,
    cap0: 0.008,
    cap1: 0.01,
    seams: [{ t: 0.178 }],
  });
  add(`forearm${side}`, 'shell', fore.mesh);
  add(`forearm${side}`, 'plate', panel(fore.surf, plate(0.07, 0.165, 0, 0.9)));
  add(`forearm${side}`, 'twist', drum(E, FOREARM_AXIS, 0.025, 0.198, 0.226));
  // The wrist: the twist's flange, the flex yoke.
  const wa = v3.dist(E, W);
  add(`wrist${side}`, 'set:flange', flange(E, FOREARM_AXIS, 0.025, wa - 0.026, wa - 0.02, { face: -1 }));
  add(`wrist${side}`, 'set:yoke', clevis({ c: W, axis: Z, toward: v3.scale(FOREARM_AXIS, -1), inner: 0.021, outer: 0.029, radius: 0.019, reach: 0.022, flare: 0.022, slot: S.graphite }));
  add(`wrist${side}`, 'set:caps', clevisCaps(W, Z, 0.029, 0.012, 0.004));
  // The palm: its flex drum and the web down from it, the hand's back in shell, its palm face rubber.
  add(`palm${side}`, 'flex', drum(W, Z, 0.016, -0.017, 0.017, { fins: 0 }));
  add(`palm${side}`, 'web', web([W[0] + 0.0015, W[1], W[2]], Z, [0, -1, 0], 0.008, 0.056, 0.0085, 0.0095, 0.0135));
  const palmB = frame(W, [0, -1, 0], [1, 0, 0]);
  add(
    `palm${side}`,
    'body',
    shell(palmB, {
      t0: 0.04,
      t1: 0.098,
      ap: track([[0.04, 0.015], [0.068, 0.017], [0.098, 0.015]]),
      an: track([[0.04, 0.012], [0.068, 0.014], [0.098, 0.012]]),
      bp: track([[0.04, 0.032], [0.068, 0.041], [0.098, 0.04]]),
      bn: track([[0.04, 0.03], [0.068, 0.038], [0.098, 0.037]]),
      n: constant(3.4),
      sides: 24,
      ds: 0.02,
      cap0: 0.006,
      cap1: 0.006,
      slot: S.shell,
      seamSlot: S.black,
      // The palm's face (−u, toward the body at rest) is a rubber pad.
      slotAt: (_t, th) => (Math.cos(th) < -0.35 ? S.rubber : S.shell),
    }),
  );
  for (const f of FINGERS) {
    const k: Vec3 = [W[0] - 0.001, W[1] - KNUCKLE_DROP, W[2] + f.z];
    rb.segment(`${f.name}${side}`, `palm${side}`, m(k));
    add(`${f.name}${side}`, 'finger', fingerMesh(k, [0, -1, 0], f.L, FINGER_R));
  }
  const t: Vec3 = [W[0] + THUMB.out, W[1] - THUMB.drop, W[2] + THUMB.fwd];
  rb.segment(`thumb${side}`, `palm${side}`, m(t));
  add(`thumb${side}`, 'knuckle', drum(t, Z, 0.0105, -0.008, 0.008, { fins: 0, segments: 18 }));
  add(`thumb${side}`, 'finger', fingerMesh(t, THUMB.dir, THUMB.L, THUMB.r));
}

/** A finger: a slim graphite loft from its knuckle, black joint seams, a shell-white tip. */
function fingerMesh(k: Vec3, dir: Vec3, L: number, r: number) {
  return shell(frame(k, dir, [1, 0, 0]), {
    t0: 0.004,
    t1: L - 0.006,
    ap: track([[0, r], [L, r * 0.86]]),
    bp: track([[0, r * 1.02], [L, r * 0.9]]),
    n: constant(2.6),
    sides: 12,
    ds: 0.012,
    cap0: 0.006,
    cap1: 0.006,
    slot: S.graphite,
    seamSlot: S.black,
    seams: [{ t: L * 0.42, w: 0.0018, d: 0.0012 }, { t: L * 0.72, w: 0.0018, d: 0.0012 }],
    slotAt: (t) => (t > L * 0.76 ? S.shell : S.graphite),
  });
}

function trunk(rb: RigBuilder): void {
  rb.segment('pelvis', null, P.pelvis);
  // The girdle: a broad, flattened band; the hips' yaw drums under it, the waist's on it.
  const gB = { ...frame([0, 0, -0.005], [0, 1, 0], [1, 0, 0]), v: [0, 0, 1] as Vec3 };
  const girdleSpec: ShellSpec = {
    t0: 0.99,
    t1: 1.04,
    ap: track([[0.99, 0.12], [1.015, 0.13], [1.04, 0.122]]),
    bp: track([[0.99, 0.084], [1.015, 0.09], [1.04, 0.086]]),
    bn: track([[0.99, 0.092], [1.015, 0.098], [1.04, 0.094]]),
    n: constant(3.2),
    sides: 40,
    ds: 0.018,
    cap0: 0.011,
    cap1: 0.011,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 1.017 }],
  };
  rb.add('pelvis', 'girdle', shell(gB, girdleSpec));
  rb.add('pelvis', 'plate', panel(shellSurface(gB, girdleSpec), { t0: 0.995, t1: 1.035, th0: Math.PI / 2 - 0.62, th1: Math.PI / 2 + 0.62, d0: -0.005, d1: 0.005, nt: 4, nth: 12, bevel: 0.0025, slot: S.shell, sideSlot: S.black }));
  for (const sx of [-1, 1]) rb.add('pelvis', `hipDrum${sx > 0 ? 'L' : 'R'}`, drum([sx * P.hip[0], P.hip[1], P.hip[2]], Y, 0.04, 0.068, 0.098));
  const axisW: Vec3 = [0, 0, P.waist[2]];
  rb.add('pelvis', 'waistDrum', drum(axisW, Y, 0.068, 1.03, 1.054, { segments: 40 }));
  // The waist: yaw (a flange on the pelvis's drum, a yoke rising to the pitch drum), then pitch.
  rb.segment('waistYaw', 'pelvis', P.waist);
  rb.add('waistYaw', 'set:flange', flange(axisW, Y, 0.068, 1.056, 1.064, { segments: 40 }));
  rb.add('waistYaw', 'set:yoke', clevis({ c: P.waist, axis: X, toward: [0, -1, 0], inner: 0.068, outer: 0.08, radius: 0.046, reach: 0.057, flare: 0.05, slot: S.shell }));
  rb.add('waistYaw', 'set:caps', clevisCaps(P.waist, X, 0.08, 0.026));
  rb.segment('torso', 'waistYaw', P.waist);
  rb.add('torso', 'pitch', drum(P.waist, X, 0.042, -0.064, 0.064, { segments: 32 }));
  const tB = { ...frame([0, 0, -0.008], [0, 1, 0], [1, 0, 0]), v: [0, 0, 1] as Vec3 };
  rb.add('torso', 'core', shell(tB, {
    t0: 1.14,
    t1: 1.21,
    ap: track([[1.14, 0.058], [1.17, 0.062], [1.21, 0.094]]),
    bp: track([[1.14, 0.05], [1.21, 0.07]]),
    bn: track([[1.14, 0.05], [1.21, 0.072]]),
    n: constant(2.8),
    sides: 32,
    ds: 0.02,
    cap0: 0.02,
    slot: S.black,
  }));
  const chestSpec: ShellSpec = {
    t0: 1.19,
    t1: 1.492,
    ap: track([[1.19, 0.104], [1.27, 0.124], [1.34, 0.138], [1.41, 0.148], [1.45, 0.146], [1.492, 0.11]]),
    bp: track([[1.19, 0.084], [1.3, 0.112], [1.4, 0.11], [1.492, 0.08]]),
    bn: track([[1.19, 0.086], [1.3, 0.1], [1.492, 0.085]]),
    n: constant(2.9),
    sides: 40,
    ds: 0.025,
    cap0: 0.022,
    cap1: 0.028,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 1.302 }],
  };
  rb.add('torso', 'chest', shell(tB, chestSpec));
  const chestSurf = shellSurface(tB, chestSpec);
  // A pectoral plate in front and the power pack behind: panels proud of the chest, black-sided.
  rb.add('torso', 'plate', panel(chestSurf, { t0: 1.32, t1: 1.452, th0: Math.PI / 2 - 0.78, th1: Math.PI / 2 + 0.78, d0: -0.006, d1: 0.006, nt: 6, nth: 12, bevel: 0.003, slot: S.shell, sideSlot: S.black }));
  rb.add('torso', 'pack', panel(chestSurf, { t0: 1.225, t1: 1.43, th0: (3 * Math.PI) / 2 - 0.62, th1: (3 * Math.PI) / 2 + 0.62, d0: -0.006, d1: 0.017, nt: 8, nth: 10, bevel: 0.004, slot: S.shell, sideSlot: S.black }));
  // Shoulder stubs: from the chest out to each shoulder's pitch drum.
  for (const sx of [-1, 1]) {
    const yb = frame([sx * 0.09, P.shoulder[1] + 0.004, P.shoulder[2]], [sx, 0, 0], [0, 1, 0]);
    rb.add('torso', `stub${sx > 0 ? 'L' : 'R'}`, shell(yb, {
      t0: 0,
      t1: 0.049,
      ap: track([[0, 0.052], [0.049, 0.047]]),
      bp: track([[0, 0.056], [0.049, 0.05]]),
      n: constant(2.6),
      sides: 28,
      ds: 0.013,
      cap1: 0.006,
      slot: S.shell,
      seamSlot: S.black,
    }));
    rb.add('torso', `shoulderDrum${sx > 0 ? 'L' : 'R'}`, drum([sx * P.shoulder[0], P.shoulder[1], P.shoulder[2]], [sx, 0, 0], 0.042, -0.07, -0.048));
  }
  rb.add('torso', 'neckDrum', drum([0, 0, P.neck[2]], Y, 0.03, 1.506, 1.536));
  // The neck: yaw (a flange and a yoke), then the head's pitch drum.
  rb.segment('neckYaw', 'torso', P.neck);
  rb.add('neckYaw', 'set:flange', flange([0, 0, P.neck[2]], Y, 0.03, 1.538, 1.544));
  rb.add('neckYaw', 'set:yoke', clevis({ c: P.neck, axis: X, toward: [0, -1, 0], inner: 0.026, outer: 0.035, radius: 0.026, reach: 0.034, flare: 0.028, slot: S.graphite }));
  rb.add('neckYaw', 'set:caps', clevisCaps(P.neck, X, 0.035, 0.016, 0.004));
  rb.segment('head', 'neckYaw', P.neck);
  rb.add('head', 'pitch', drum(P.neck, X, 0.021, -0.022, 0.022, { fins: 0 }));
  // The neck: turned from the pitch drum's middle up into the helmet, flaring under it.
  rb.add('head', 'neck', lathe([[0, P.neck[1]], [0.016, P.neck[1]], [0.016, 1.612], [0.019, 1.628], [0.027, 1.646], [0.03, 1.666], [0, 1.666]], 28, frame([0, 0, P.neck[2]], Y, X), S.graphite));
  const hB = { ...frame([0, 0, -0.012], [0, 1, 0], [1, 0, 0]), v: [0, 0, 1] as Vec3 };
  const headSpec: ShellSpec = {
    t0: 1.64,
    t1: 1.715,
    ap: track([[1.64, 0.07], [1.68, 0.078], [1.715, 0.075]]),
    bp: track([[1.64, 0.083], [1.69, 0.094], [1.715, 0.09]]),
    bn: track([[1.64, 0.078], [1.69, 0.09], [1.715, 0.087]]),
    n: constant(2.2),
    sides: 40,
    ds: 0.015,
    cap0: 0.025,
    cap1: 0.062,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: 1.652 }],
  };
  rb.add('head', 'shell', shell(hB, headSpec));
  rb.add('head', 'visor', panel(shellSurface(hB, headSpec), { t0: 1.664, t1: 1.71, th0: Math.PI / 2 - 1.02, th1: Math.PI / 2 + 1.02, d0: -0.004, d1: 0.0035, nt: 4, nth: 18, bevel: 0.0018, slot: S.visor }));
  for (const sx of [-1, 1]) {
    const c: Vec3 = [sx * 0.076, 1.686, -0.016];
    rb.add('head', `pod${sx > 0 ? 'L' : 'R'}`, boss({ ...frame(c, [sx, 0, 0], [0, 1, 0]) }, 0.022, 0.009, S.black, { hubSlot: S.bronze, hub: 0.011 }));
  }
}

export function buildHandRig(): RigDef {
  const rb = new RigBuilder('hand');
  trunk(rb);
  arm(rb, 'L');
  arm(rb, 'R');
  leg(rb, 'L');
  leg(rb, 'R');
  return rb.def;
}
