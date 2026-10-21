/**
 * The crew's fliers (docs/crew.md): the Spotter, a small four-duct inspection drone with a
 * gimballed camera, and the Ferry, a large four-duct lift drone with a payload pod clamped under
 * its belly. Both are ducted fans: each duct is a ceramic ring of airfoil section round a motor hub
 * on three stator vanes, its rotor a black disc in the throat (spinning far too fast to see blades).
 * Their skids or legs carry them on their cradles and pads (fixtures.ts).
 *
 * Frame: origin at the body's centre, +z forward, +y up. `bottom` is how far below it the skids or
 * pads reach (where it stands on a cradle).
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { box } from '../../geometry/solids';
import { turn as lathe, pipe as tube } from '../kit/shapes';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigBuilder as RB, type RigDef } from '../rig';
import { constant, frame, panel, shell, shellSurface, track, type ShellSpec } from '../kit/shapes';
import { clevis, clevisCaps, drum, flange } from './joints';

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/** A ducted fan about a vertical axis at c: the duct ring (inner radius r), hub, vanes, rotor disc. */
function duct(rb: RB, seg: string, name: string, c: Vec3, r: number, h: number): void {
  const t = r * 0.22;
  // The duct's section: a rounded lip on top (the intake), tapering to a thin trailing edge below.
  const prof: Vec2[] = [
    [r, -h * 0.55],
    [r + t * 0.35, -h * 0.55],
    [r + t, -h * 0.2],
    [r + t, h * 0.25],
    [r + t * 0.8, h * 0.45],
    [r + t * 0.4, h * 0.52],
    [r - t * 0.1, h * 0.48],
    [r - t * 0.2, h * 0.38],
    [r, h * 0.2],
  ];
  rb.add(seg, `${name}:ring`, lathe(prof, 48, frame(c, Y, X), S.shell, 50));
  rb.add(seg, `${name}:hub`, drum(v3.add(c, [0, -h * 0.05, 0]), Y, r * 0.24, -h * 0.35, h * 0.15, { fins: 0 }));
  // Three stator vanes from the hub to the ring's wall, below the rotor.
  const vanes = new PolyMesh(36);
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + 0.3;
    const d: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const mid = v3.add(c, v3.add(v3.scale(d, r * 0.6), [0, -h * 0.28, 0]));
    vanes.append(box({ o: mid, u: d, v: [-d[2], 0, d[0]], w: Y }, r * 0.42, r * 0.025, h * 0.14, r * 0.01, S.graphite));
  }
  rb.add(seg, `set:${name}:vanes`, vanes);
  // The rotor: a black disc in the throat, 3 % clear of the wall.
  rb.add(seg, `${name}:rotor`, lathe([[0, h * 0.12], [r * 0.97, h * 0.12], [r * 0.97, h * 0.16], [0, h * 0.16]], 40, frame(c, Y, X), S.black));
  rb.add(seg, `${name}:spinner`, lathe([[0, h * 0.13], [r * 0.16, h * 0.13], [r * 0.15, h * 0.22], [r * 0.09, h * 0.3], [0, h * 0.33]], 24, frame(c, Y, X), S.bronze, 60));
  rb.add(seg, `${name}:lip`, lathe([[r + t * 0.26, h * 0.42], [r + t * 0.64, h * 0.42], [r + t * 0.64, h * 0.56], [r + t * 0.26, h * 0.56]], 48, frame(c, Y, X), S.bronze));
}

/** An arm from the body out to a duct: a lofted strut, tapering. */
function strut(a: Vec3, b: Vec3, wid: number, hgt: number) {
  // u across (horizontal), v up.
  const w = v3.norm(v3.sub(b, a));
  return shell({ o: a, w, u: v3.norm(v3.cross(Y, w)), v: Y }, {
    t0: 0,
    t1: v3.dist(a, b),
    ap: track([[0, wid], [v3.dist(a, b), wid * 0.75]]),
    bp: track([[0, hgt], [v3.dist(a, b), hgt * 0.8]]),
    n: constant(3),
    sides: 16,
    ds: 0.1,
    slot: S.shell,
  });
}

export const SPOTTER = {
  ducts: [[0.26, 0.012, 0.26], [-0.26, 0.012, 0.26], [0.26, 0.012, -0.26], [-0.26, 0.012, -0.26]] as Vec3[],
  ductR: 0.1,
  ductH: 0.09,
  /** The camera's yaw axis under the nose, its tilt axis. */
  gimbal: [0, -0.07, 0.11] as Vec3,
  tilt: [0, -0.136, 0.11] as Vec3,
  bottom: 0.19,
} as const;

export function buildSpotterRig(): RigDef {
  const rb = new RigBuilder('spotter');
  const P = SPOTTER;
  rb.segment('body', null, [0, 0, 0]);
  const bB = { ...frame([0, 0, 0], Z, X), v: Y };
  const bodySpec: ShellSpec = {
    t0: -0.17,
    t1: 0.17,
    ap: track([[-0.17, 0.09], [0, 0.12], [0.17, 0.1]]),
    bp: track([[-0.17, 0.05], [0, 0.07], [0.17, 0.055]]),
    bn: constant(0.06),
    n: constant(2.6),
    sides: 36,
    ds: 0.06,
    cap0: 0.05,
    cap1: 0.06,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: -0.06 }],
  };
  rb.add('body', 'pod', shell(bB, bodySpec));
  rb.add('body', 'plate', panel(shellSurface(bB, bodySpec), { t0: -0.02, t1: 0.12, th0: Math.PI / 2 - 0.7, th1: Math.PI / 2 + 0.7, d0: -0.004, d1: 0.004, nt: 4, nth: 10, bevel: 0.002, slot: S.bronze, sideSlot: S.black }));
  P.ducts.forEach((c, k) => {
    duct(rb, 'body', `duct${k}`, c, P.ductR, P.ductH);
    const d = v3.norm([c[0], 0, c[2]]);
    rb.add('body', `arm${k}`, strut(v3.add([0, 0.0, 0], v3.scale(d, 0.08)), v3.add(c, v3.scale(d, -P.ductR - 0.008)), 0.042, 0.02));
  });
  // Skids: two bent tubes under the pod.
  for (const sx of [-1, 1]) {
    const pts: Vec3[] = [
      [sx * 0.07, -0.04, 0.09],
      [sx * 0.12, -P.bottom + 0.015, 0.11],
      [sx * 0.12, -P.bottom + 0.015, -0.13],
      [sx * 0.07, -0.04, -0.11],
    ];
    rb.add('body', `skid${sx > 0 ? 'L' : 'R'}`, tube(filleted(pts, 0.03).map((p) => ({ p, r: 0.009 })), 10, S.graphite));
  }
  // The gimbal: a yaw drum under the nose, its flange and yoke, the camera on its tilt drum.
  rb.add('body', 'gimbalDrum', drum(P.gimbal, Y, 0.026, -0.006, 0.03));
  rb.segment('gimbalYaw', 'body', P.gimbal);
  // The yaw's turntable: a flange broad enough to carry the yoke's plates.
  rb.add('gimbalYaw', 'set:flange', flange(P.gimbal, Y, 0.045, -0.018, -0.011, { face: -1 }));
  rb.add('gimbalYaw', 'set:yoke', clevis({ c: P.tilt, axis: X, toward: Y, inner: 0.036, outer: 0.043, radius: 0.026, reach: P.gimbal[1] - P.tilt[1] - 0.014, flare: 0.026, slot: S.graphite }));
  rb.add('gimbalYaw', 'set:caps', clevisCaps(P.tilt, X, 0.043, 0.014, 0.004));
  rb.segment('camera', 'gimbalYaw', P.tilt);
  rb.add('camera', 'drum', drum(P.tilt, X, 0.016, -0.031, 0.031, { fins: 0 }));
  rb.add('camera', 'block', shell({ ...frame(v3.add(P.tilt, [0, 0, 0.0]), Z, X), v: Y }, { t0: -0.025, t1: 0.035, ap: constant(0.032), bp: constant(0.026), n: constant(3.4), sides: 24, ds: 0.03, cap0: 0.008, cap1: 0.01, slot: S.foil }));
  rb.add('camera', 'lens', lathe([[0, -0.005], [0.016, -0.005], [0.018, -0.002], [0.018, 0.004], [0.014, 0.008], [0, 0.008]], 24, frame(v3.add(P.tilt, [0, 0, 0.044]), Z, X), S.visor));
  return rb.def;
}

export const FERRY = {
  ducts: [[0.64, 0.06, 0.5], [-0.64, 0.06, 0.5], [0.64, 0.06, -0.5], [-0.64, 0.06, -0.5]] as Vec3[],
  ductR: 0.3,
  ductH: 0.16,
  pod: { y: -0.36, r: 0.21, half: 0.48 },
  bottom: 0.64,
} as const;

export function buildFerryRig(): RigDef {
  const rb = new RigBuilder('ferry');
  const P = FERRY;
  rb.segment('body', null, [0, 0, 0]);
  const bB = { ...frame([0, 0, 0], Z, X), v: Y };
  const bodySpec: ShellSpec = {
    t0: -0.55,
    t1: 0.55,
    ap: track([[-0.55, 0.22], [0, 0.3], [0.55, 0.24]]),
    bp: track([[-0.55, 0.12], [0, 0.16], [0.55, 0.12]]),
    bn: constant(0.14),
    n: constant(2.8),
    sides: 48,
    ds: 0.12,
    cap0: 0.12,
    cap1: 0.14,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: -0.25 }, { t: 0.25 }],
  };
  rb.add('body', 'hull', shell(bB, bodySpec));
  const surf = shellSurface(bB, bodySpec);
  rb.add('body', 'band', panel(surf, { t0: 0.42, t1: 0.52, th0: Math.PI / 2 - 1.0, th1: Math.PI / 2 + 1.0, d0: -0.006, d1: 0.004, nt: 3, nth: 16, bevel: 0.002, slot: S.visor }));
  P.ducts.forEach((c, k) => {
    duct(rb, 'body', `duct${k}`, c, P.ductR, P.ductH);
    const d = v3.norm([c[0], 0, c[2]]);
    rb.add('body', `arm${k}`, strut(v3.scale(d, 0.2), v3.add(c, v3.scale(d, -P.ductR - 0.02)), 0.11, 0.05));
  });
  // The pod: a capsule clamped under the belly by two graphite straps.
  const pod = P.pod;
  const prof: Vec2[] = [[0, -pod.half]];
  for (let i = 1; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    prof.push([pod.r * Math.sin(a), -pod.half + pod.r * (1 - Math.cos(a))]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    prof.push([pod.r * Math.cos(a), pod.half - pod.r + pod.r * Math.sin(a)]);
  }
  prof[prof.length - 1][0] = 0;
  rb.add('body', 'pod', lathe(prof, 40, frame([0, pod.y, 0], Z, Y), S.shell, 50));
  for (const z of [-0.26, 0.26]) {
    rb.add('body', `strap${z > 0 ? 'F' : 'A'}`, lathe([[pod.r - 0.01, -0.03], [pod.r + 0.016, -0.03], [pod.r + 0.02, -0.026], [pod.r + 0.02, 0.026], [pod.r + 0.016, 0.03], [pod.r - 0.01, 0.03]], 40, frame([0, pod.y, z], Z, Y), S.graphite));
  }
  rb.add('body', 'bands', lathe([[pod.r - 0.01, -0.02], [pod.r + 0.008, -0.02], [pod.r + 0.008, 0.02], [pod.r - 0.01, 0.02]], 40, frame([0, pod.y, 0], Z, Y), S.bronze));
  // Four legs from the hull's underside to rubber pads on the ground (when landed).
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const top: Vec3 = [sx * 0.2, -0.08, sz * 0.36];
    const foot: Vec3 = [sx * 0.36, -P.bottom + 0.03, sz * 0.5];
    rb.add('body', `leg${sx > 0 ? 'L' : 'R'}${sz > 0 ? 'F' : 'A'}`, tube([{ p: top, r: 0.022 }, { p: v3.lerp(top, foot, 0.5), r: 0.02 }, { p: foot, r: 0.018 }], 14, S.graphite));
    rb.add('body', `pad${sx > 0 ? 'L' : 'R'}${sz > 0 ? 'F' : 'A'}`, lathe([[0, -P.bottom], [0.05, -P.bottom], [0.055, -P.bottom + 0.008], [0.05, -P.bottom + 0.03], [0, -P.bottom + 0.03]], 24, frame([foot[0], 0, foot[2]], Y, X), S.rubber));
  }
  return rb.def;
}

/** A polyline with its corners rounded (radius r): points along it. */
function filleted(pts: Vec3[], r: number): Vec3[] {
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = v3.norm(v3.sub(pts[i - 1], pts[i]));
    const b = v3.norm(v3.sub(pts[i + 1], pts[i]));
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      // A quadratic Bézier from r back along a to r along b, through the corner.
      const p0 = v3.add(pts[i], v3.scale(a, r));
      const p2 = v3.add(pts[i], v3.scale(b, r));
      const q = v3.add(v3.add(v3.scale(p0, (1 - u) * (1 - u)), v3.scale(pts[i], 2 * u * (1 - u))), v3.scale(p2, u * u));
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
