/**
 * A sector gate leaf (both West Gate leaves are identical), modelled in its trunnion frame: origin
 * on the trunnion axis, z along the axis, angles θ about it from +x (east) counter-clockwise up.
 * The leaf rotates about z as one rigid body.
 *
 *  - skin: a cylindrical plate of radius R, convex to the east (the high-pressure side);
 *  - ribs: T-section stiffeners on the skin's back, between the girders;
 *  - girders: two horizontal I-beams behind the skin, spanning between the arm frames;
 *  - arms: at each side, two radial struts from the hub to the girders' ends, braced diagonally;
 *  - hubs: cast bronze hubs turning on the trunnion pins;
 *  - lugs: where the hoists' rods take hold of the upper struts;
 *  - keepers: the sockets the floor bolts shoot up into, on the skin's back at its lip.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { chamferRect, framesFrom, loopProfile, revolve, sampleCurve, straightSweep, sweep, girderProfile, type Profile } from '../../geometry/sweep';
import { GATE } from './spec';

export const LEAF_SLOT = { steel: 0, bronze: 1, rubber: 2 } as const;
export const LEAF_SLOTS = 3;

export interface LeafPart {
  name: string;
  mesh: PolyMesh;
}

const { R, skin, leafHalf, armZ, armHalf, hubR } = GATE;
const SKIN_IN = R - skin;
/** Girder depth below the skin's inner face. */
const GIRDER_IN = 14.75;
const RIB_DEPTH = 0.4;
const RIB_Z = [-6.5, -3.25, 0, 3.25, 6.5];

const polar = (r: number, th: number, z: number): Vec3 => [r * Math.cos(th), r * Math.sin(th), z];
const radial = (th: number): Vec3 => [Math.cos(th), Math.sin(th), 0];

/** Points along an arc of radius r from θ0 to θ1 at height z (for sweeps). */
function arc(r: number, th0: number, th1: number, z: number, ds = 0.5): Vec3[] {
  return sampleCurve((t) => polar(r, t, z), th0, th1, ds, 4).p;
}

/** Lateral positions of the locking bolts (they rise from the sill into the lip's keepers). */
export const BOLT_Z = [-4.5, 4.5];
/** Keeper block at the lip: angular span on the skin's back and radial span. */
export const KEEPER = { th0: GATE.thetaBottom + 0.002, th1: GATE.thetaBottom + 0.035, r0: SKIN_IN - 0.34 };

export function buildLeaf(): LeafPart[] {
  const parts: LeafPart[] = [];
  const th0 = GATE.thetaBottom;
  const th1 = GATE.thetaTop;

  // Skin: the profile's t axis is radial (outward), b is +z.
  {
    const pts = arc(R - skin / 2, th0, th1, 0, 0.4);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const prof = girderProfile({ halfWidth: leafHalf, t0: -skin / 2, t1: skin / 2, chamferBottom: 0.012, chamferTop: 0.02 });
    parts.push({ name: 'leaf:skin', mesh: sweep(frames, { pts: prof.pts }, { crease: 30, capSlot: LEAF_SLOT.steel }) });
  }

  // Girders: I-beams along z behind the skin, top flange 5 mm into the skin.
  const flangeHalf = 0.25;
  for (const [gi, g] of GATE.girders.entries()) {
    const r0 = GIRDER_IN;
    const r1 = SKIN_IN + 0.005;
    const h = r1 - r0;
    const rc = (r0 + r1) / 2;
    const ft = 0.05;
    const web = 0.02;
    const ipts: Vec2[] = [
      [-flangeHalf, -h / 2], [flangeHalf, -h / 2], [flangeHalf, -h / 2 + ft], [web, -h / 2 + ft], [web, h / 2 - ft], [flangeHalf, h / 2 - ft],
      [flangeHalf, h / 2], [-flangeHalf, h / 2], [-flangeHalf, h / 2 - ft], [-web, h / 2 - ft], [-web, -h / 2 + ft], [-flangeHalf, -h / 2 + ft],
    ];
    const c = v3.scale(radial(g), rc);
    const zEnd = armZ + armHalf + 0.01;
    parts.push({ name: `leaf:girder${gi}`, mesh: straightSweep([c[0], c[1], -zEnd], [c[0], c[1], zEnd], radial(g), loopProfile(ipts), { crease: 30 }) });
  }

  // Ribs: T stiffeners on the skin's back, in three runs split by the girders (10 mm reveals).
  const gap = (flangeHalf + 0.01) / SKIN_IN;
  const runs: [number, number][] = [
    [th0 + 0.02 / R, GATE.girders[0] - gap],
    [GATE.girders[0] + gap, GATE.girders[1] - gap],
    [GATE.girders[1] + gap, th1 - 0.02 / R],
  ];
  const tpts: Vec2[] = [[0.015, 0.005], [-0.015, 0.005], [-0.015, -RIB_DEPTH + 0.03], [-0.09, -RIB_DEPTH + 0.03], [-0.09, -RIB_DEPTH], [0.09, -RIB_DEPTH], [0.09, -RIB_DEPTH + 0.03], [0.015, -RIB_DEPTH + 0.03]];
  for (const z of RIB_Z) {
    runs.forEach(([a, b], ri) => {
      const pts = arc(SKIN_IN, a, b, z, 0.4);
      // Profile t is radial outward, b is +z: rib web points inward from the skin.
      const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
      parts.push({ name: `leaf:rib${z}:${ri}`, mesh: sweep(frames, loopProfile(tpts), { crease: 30 }) });
    });
  }

  // Arms: two struts per side from the hub's rim to the girders, and a diagonal brace.
  // Narrower than the girder flanges they bear on (0.5 m), so no side runs flush with a flange edge.
  const strutProf = loopProfile(chamferRect(0.21, armHalf, 0.04));
  for (const side of [-1, 1]) {
    const z = side * armZ;
    GATE.girders.forEach((g, si) => {
      const a = v3.add(v3.scale(radial(g), hubR - 0.05), [0, 0, z]);
      const b = v3.add(v3.scale(radial(g), GIRDER_IN + 0.005), [0, 0, z]);
      parts.push({ name: `leaf:strut${side}:${si}`, mesh: straightSweep(a, b, [0, 0, 1], strutProf, { crease: 30 }) });
    });
    // Brace: from the lower strut near the girder to the upper strut near the hub.
    const g0 = GATE.girders[0];
    const g1 = GATE.girders[1];
    const pa = v3.add(v3.scale(radial(g0), 12.6), [0, 0, z]);
    const pb = v3.add(v3.scale(radial(g1), 6.2), [0, 0, z]);
    const dir = v3.norm(v3.sub(pb, pa));
    // Ends sunk 0.12 into each strut.
    const ea = v3.add(pa, v3.scale(dir, -0.12 + armHalf));
    const eb = v3.add(pb, v3.scale(dir, 0.12 - armHalf));
    parts.push({ name: `leaf:brace${side}`, mesh: straightSweep(ea, eb, [0, 0, 1], loopProfile(chamferRect(0.16, 0.16, 0.03)), { crease: 30 }) });
  }

  // Hubs: cast bronze, a disc on the pin with a boss toward the passage.
  for (const side of [-1, 1]) {
    const zOut = side * (armZ + armHalf + 0.05);
    const zIn = side * (armZ - armHalf - 0.05);
    // Local h runs from the passage side (boss) to the wall side.
    const hubProfile: Vec2[] = [
      [0, -0.35], [0.38, -0.35], [0.42, -0.31], [0.42, -0.24], [0.62, -0.24], [0.66, -0.2], [0.66, 0], [hubR - 0.05, 0], [hubR, 0.05], [hubR, (zOut - zIn) * side - 0.05], [hubR - 0.05, (zOut - zIn) * side], [0, (zOut - zIn) * side],
    ];
    const frame = (x: number, y: number, h: number): Vec3 => (side > 0 ? [x, y, zIn + h] : [y, x, zIn - h]);
    parts.push({ name: `leaf:hub${side}`, mesh: revolve(hubProfile, 48, frame, LEAF_SLOT.bronze) });
  }

  // Hoist lugs on the upper struts.
  const g1 = GATE.girders[1];
  for (const side of [-1, 1]) {
    const c = v3.scale(radial(g1), GATE.hoistB);
    const z0 = side * (armZ - armHalf + 0.02);
    const z1 = side * (GATE.hoistZ - 0.3);
    const a: Vec3 = [c[0], c[1], z0];
    const b: Vec3 = [c[0], c[1], z1];
    parts.push({ name: `leaf:lug${side}`, mesh: straightSweep(a, b, radial(g1), loopProfile(chamferRect(0.22, 0.32, 0.05)), { crease: 30 }) });
  }

  // Keepers for the floor bolts, on the skin's back at the lip (between the ribs).
  for (const z of BOLT_Z) {
    const pts = arc(KEEPER.r0 + 0.17, KEEPER.th0, KEEPER.th1, z, 0.1);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const prof: Profile = loopProfile(chamferRect(0.32, 0.17 + 0.0025, 0.03));
    parts.push({ name: `leaf:keeper${z}`, mesh: sweep(frames, prof, { crease: 30 }) });
  }

  // Seals (black rubber), so a shut leaf closes the opening completely:
  //  - the lip seal runs 11 mm below the lip and bears into the bronze sill when shut;
  //  - side seals run along both edges, 4 mm into the jambs' seal tracks, at every opening;
  //  (the top seal is fixed under the head and the skin bears on it: gatehouse.ts).
  {
    const pts = arc(SKIN_IN + 0.04, th0 - 0.0007, th0 + 0.004, 0, 0.002);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const prof = loopProfile(chamferRect(GATE.passageHalf - 0.004, 0.034, 0.004), LEAF_SLOT.rubber);
    parts.push({ name: 'leaf:seal-lip', mesh: sweep(frames, prof, { crease: 30, capSlot: LEAF_SLOT.rubber }) });
  }
  for (const side of [-1, 1]) {
    // Past the skin's top edge by 2 mm of arc (no end flush with the skin's), into the top seal.
    const pts = arc(SKIN_IN + 0.04, th0 + 0.0045, th1 + 0.002, 0, 0.4);
    const frames = framesFrom(pts, pts.map((p) => v3.norm([p[0], p[1], 0])));
    const z0 = leafHalf - 0.02;
    const z1 = GATE.passageHalf - 0.004;
    const loop: Vec2[] = side > 0 ? [[z0, -0.034], [z1, -0.034], [z1, 0.034], [z0, 0.034]] : [[-z1, -0.034], [-z0, -0.034], [-z0, 0.034], [-z1, 0.034]];
    parts.push({ name: `leaf:seal-side${side}`, mesh: sweep(frames, loopProfile(loop, LEAF_SLOT.rubber), { crease: 30, capSlot: LEAF_SLOT.rubber }) });
  }

  return parts;
}

/** Hub axis point and lug pin (hoist pivot B) in the trunnion frame, closed pose. */
export function lugPin(side: -1 | 1): Vec3 {
  const g1 = GATE.girders[1];
  return [GATE.hoistB * Math.cos(g1), GATE.hoistB * Math.sin(g1), side * GATE.hoistZ];
}

export const LEAF = { SKIN_IN, GIRDER_IN, RIB_DEPTH, RIB_Z };
