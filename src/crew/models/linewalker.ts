/**
 * The Linewalker (docs/crew.md): a pipe crawler that rides the square main's cryogen supply line
 * (network.ts, VIADUCT_LINES) on two hourglass rollers, held on by four C-arms that hug the pipe
 * down past its equator onto guide rollers. A pan-tilt sensor head on a mast looks along the line.
 *
 * Frame: origin on the pipe's centreline at the crawler's middle, +z along the pipe (forward), +y up.
 * The rollers clear the pipe by 1 mm (rolling contact, never inside it).
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { box, extrudeBevel } from '../../geometry/solids';
import { turn as lathe, pipe as tube } from '../kit/shapes';
import { framesFrom, roundedRect, sweep } from '../../geometry/sweep';
import { VIADUCT_LINES } from '../../field/network';
import { CREW_SLOT as S } from '../materials';
import { RigBuilder, type RigDef } from '../rig';
import { constant, frame, shell, track } from '../kit/shapes';
import { clevis, clevisCaps, drum, flange } from './joints';

/** The pipe it rides (the supply line's jacket radius). */
export const LINE_R = VIADUCT_LINES.find((l) => l.from === 'supply')!.r;

export const LINEWALKER = {
  /** Bogies along the pipe, the top rollers' centre height over the pipe's centre, their waist radius. */
  bogieZ: 0.27,
  rollerY: LINE_R + 0.042,
  roller: 0.041,
  rollerHalf: 0.06,
  /** C-arms: their radius about the pipe, the angle (from the top) their guide rollers bear at, the guide roller's radius and half-length. */
  armR: LINE_R + 0.075,
  guideAngle: (104 * Math.PI) / 180,
  guide: 0.024,
  guideHalf: 0.022,
  /** The chassis's height band over the pipe's centre. */
  bodyY0: LINE_R + 0.098,
  bodyY1: LINE_R + 0.22,
  mastZ: 0.16,
  /** The head's tilt axis over the chassis's top, and how far the yoke's plates run down to its bridge. */
  headY: 0.23,
  yokeReach: 0.085,
} as const;

const L = LINEWALKER;
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/** The hourglass roller's radius at lateral offset x: tangent to the pipe, 1 mm off it. */
function rollerProfile(): Vec2[] {
  const out: Vec2[] = [[0, -L.rollerHalf]];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const x = -L.rollerHalf + (2 * L.rollerHalf * i) / n;
    const r = L.rollerY - Math.sqrt(LINE_R * LINE_R - x * x) - 0.001;
    out.push([r, x]);
  }
  out.push([0, L.rollerHalf]);
  return out;
}

export function buildLinewalkerRig(): RigDef {
  const rb = new RigBuilder('linewalker');
  rb.segment('body', null, [0, 0, 0]);
  // The chassis: a low rounded shell along the pipe, a black seam and a bronze service hatch.
  const yc = (L.bodyY0 + L.bodyY1) / 2;
  const hh = (L.bodyY1 - L.bodyY0) / 2;
  rb.add('body', 'chassis', shell({ ...frame([0, yc, 0], Z, X), v: Y }, {
    t0: -0.34,
    t1: 0.34,
    ap: track([[-0.34, 0.12], [0, 0.145], [0.34, 0.12]]),
    bp: track([[-0.34, hh * 0.85], [0, hh], [0.34, hh * 0.8]]),
    bn: constant(hh),
    n: constant(3.2),
    sides: 36,
    ds: 0.06,
    cap0: 0.05,
    cap1: 0.06,
    slot: S.shell,
    seamSlot: S.black,
    seams: [{ t: -0.14 }, { t: 0.14 }],
  }));
  rb.add('body', 'hatch', box({ o: [0, L.bodyY1 - 0.004, -0.005], u: X, v: [0, 0, -1], w: Y }, 0.07, 0.11, 0.008, 0.003, S.bronze));
  // The bogies: under the chassis, a yoke either side of each top roller, and the C-arms off it.
  for (const bz of [-L.bogieZ, L.bogieZ]) {
    const c: Vec3 = [0, L.rollerY, bz];
    rb.add('body', `set:yoke${bz > 0 ? 'F' : 'R'}`, clevis({ c, axis: X, toward: Y, inner: L.rollerHalf + 0.006, outer: L.rollerHalf + 0.02, radius: 0.034, reach: L.bodyY0 - L.rollerY + 0.02, flare: 0.04, slot: S.graphite }));
    rb.add('body', `set:caps${bz > 0 ? 'F' : 'R'}`, clevisCaps(c, X, L.rollerHalf + 0.02, 0.018, 0.005));
    for (const sx of [-1, 1]) {
      // The C-arm: a bar swept round the pipe from the yoke's foot to below the equator.
      const a0 = Math.atan2(L.rollerHalf + 0.013, L.rollerY) + 0.02;
      const a1 = L.guideAngle + 0.06;
      const pts: Vec3[] = [];
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const a = a0 + ((a1 - a0) * k) / n;
        pts.push([sx * Math.sin(a) * L.armR, Math.cos(a) * L.armR, bz]);
      }
      // The arm rises into the yoke plate at its top.
      pts.unshift([sx * (L.rollerHalf + 0.013), L.rollerY + 0.03, bz]);
      const frames = framesFrom(pts, pts.map(() => Z));
      // A flat band, 24 mm thick round the pipe and 80 mm wide along it.
      const prof: Vec2[] = [[-0.009, -0.04], [0.009, -0.04], [0.012, -0.037], [0.012, 0.037], [0.009, 0.04], [-0.009, 0.04], [-0.012, 0.037], [-0.012, -0.037]];
      rb.add('body', `arm${bz > 0 ? 'F' : 'R'}${sx > 0 ? 'L' : 'R'}`, sweep(frames, { pts: prof, slots: prof.map(() => S.shell) }, { crease: 40, capSlot: S.black }));
      // The guide roller's bracket: from the arm's end in to the roller's axle.
      const ga = L.guideAngle;
      const gc: Vec3 = [sx * Math.sin(ga) * (LINE_R + L.guide + 0.001), Math.cos(ga) * (LINE_R + L.guide + 0.001), bz];
      const ae: Vec3 = [sx * Math.sin(ga) * L.armR, Math.cos(ga) * L.armR, bz];
      // The guide roller rolls along the pipe: its axle runs round the pipe (tangent to its section),
      // carried by two plates either side of it, from the arm's end in.
      const tan = guideAxis(sx);
      const radial = v3.norm(v3.sub(ae, gc));
      for (const dt of [-1, 1]) {
        const o = v3.add(v3.lerp(gc, ae, 0.5), v3.scale(tan, dt * (L.guideHalf + 0.01)));
        rb.add('body', `bracket${bz > 0 ? 'F' : 'R'}${sx > 0 ? 'L' : 'R'}${dt > 0 ? 'f' : 'b'}`, box({ o, u: radial, v: tan, w: v3.cross(radial, tan) }, v3.dist(gc, ae) / 2 + 0.012, 0.006, 0.016, 0.002, S.graphite));
      }
      const gn = `guide${bz > 0 ? 'F' : 'R'}${sx > 0 ? 'L' : 'R'}`;
      rb.segment(gn, 'body', gc);
      rb.add(gn, 'roller', lathe([[0, -L.guideHalf], [L.guide - 0.003, -L.guideHalf], [L.guide, -L.guideHalf + 0.003], [L.guide, L.guideHalf - 0.003], [L.guide - 0.003, L.guideHalf], [0, L.guideHalf]], 20, frame(gc, tan, Z), S.rubber));
    }
    const rn = `roller${bz > 0 ? 'F' : 'R'}`;
    rb.segment(rn, 'body', c);
    rb.add(rn, 'roller', lathe(rollerProfile(), 28, frame(c, X, Y), S.rubber));
    rb.add(rn, 'set:hubs', hubs(c));
  }
  // The mast and its pan-tilt head: a post up into a bridged yoke, the head tilting between its
  // plates on trunnions (capped outside). The bridge sits below the head's whole sweep (down 0.6 rad).
  const mb: Vec3 = [0, L.bodyY1, L.mastZ];
  rb.add('body', 'mastDrum', drum(mb, Y, 0.032, -0.01, 0.03));
  rb.segment('pan', 'body', [0, L.bodyY1 + 0.04, L.mastZ]);
  rb.add('pan', 'set:flange', flange(mb, Y, 0.032, 0.034, 0.04));
  const hc: Vec3 = [0, L.bodyY1 + L.headY, L.mastZ];
  const bridgeTop = hc[1] - L.yokeReach + 0.004;
  const bridgeH = 0.022;
  rb.add('pan', 'post', tube([{ p: [0, L.bodyY1 + 0.038, L.mastZ], r: 0.016 }, { p: [0, bridgeTop - bridgeH + 0.004, L.mastZ], r: 0.014 }], 14, S.graphite));
  rb.add('pan', 'bridge', extrudeBevel(roundedRect(0.066, bridgeH / 2, 0.007, 3), { o: [0, bridgeTop - bridgeH / 2, L.mastZ], u: X, v: Y, w: Z }, -0.03, 0.03, 0.003, S.graphite));
  rb.add('pan', 'set:yoke', clevis({ c: hc, axis: X, toward: [0, -1, 0], inner: 0.052, outer: 0.06, radius: 0.026, reach: L.yokeReach, flare: 0.026, slot: S.graphite }));
  rb.add('pan', 'set:caps', clevisCaps(hc, X, 0.06, 0.014, 0.004));
  rb.segment('tilt', 'pan', hc);
  rb.add('tilt', 'drum', drum(hc, X, 0.02, -0.05, 0.05, { fins: 0 }));
  rb.add('tilt', 'head', shell({ ...frame([0, hc[1], hc[2] - 0.02], Z, X), v: Y }, {
    t0: -0.03,
    t1: 0.09,
    ap: constant(0.046),
    bp: constant(0.034),
    n: constant(3.4),
    sides: 24,
    ds: 0.03,
    cap0: 0.01,
    cap1: 0.012,
    slot: S.foil,
    seamSlot: S.black,
    seams: [{ t: 0.0 }],
  }));
  rb.add('tilt', 'lens', lathe([[0, -0.006], [0.022, -0.006], [0.024, -0.003], [0.024, 0.004], [0.02, 0.008], [0, 0.008]], 24, frame([0, hc[1], hc[2] + 0.078], Z, X), S.visor));
  return rb.def;
}

/** A guide roller's axle: round the pipe at its bearing angle (sx: the left arms +1, the right −1). */
export function guideAxis(sx: number): Vec3 {
  return [sx * Math.cos(L.guideAngle), -Math.sin(L.guideAngle), 0];
}

/** The rollers' bronze hubs either end (one part of two components). */
function hubs(c: Vec3): PolyMesh {
  const m = new PolyMesh(38);
  for (const s of [-1, 1]) m.append(lathe([[0, -0.001], [0.022, -0.001], [0.022, 0.0035], [0.0205, 0.004], [0, 0.004]], 18, frame(v3.add(c, [s * (L.rollerHalf + 0.001), 0, 0]), [s, 0, 0], Y), S.bronze));
  return m;
}
