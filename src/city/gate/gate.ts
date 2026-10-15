/**
 * The West Gate in the scene: the static gatehouse, the two leaves, their hoists and floor bolts,
 * the pressure dial's needle and the chamber's lamps, all driven by the airlock (airlock.ts) each
 * frame. Collision for the leaves follows their state.
 */
import { Group, Mesh, MeshPhysicalNodeMaterial, type Material, type RectAreaLight, type Texture, type Vector3 } from 'three/webgpu';
import { float, vec3, lights, positionWorld, length, atan, abs, smoothstep, fract, mix, select, max, fwidth } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { emitParts, PolyMesh, type Vec2 } from '../../geometry/polyMesh';
import { revolve } from '../../geometry/sweep';
import { createBronzeMaterial, createCeramicMaterial, BRONZE_F0 } from '../materials/ceramic';
import { createPadMaterial } from '../../ground/padMaterial';
import { Airlock } from './airlock';
import { buildGatehouse, DIAL, GH_SLOT, GH_SLOTS } from './gatehouse';
import { buildLeaf, LEAF_SLOT, LEAF_SLOTS } from './leaf';
import { boltPose, buildBolt, buildHoistBarrel, buildHoistRod, hoistPoses, leafPose, MECH_SLOT, type Pose } from './mechanism';
import { GATE } from './spec';
import { createChamberUniforms, createLamps, gateEnvironment, LAMP_COLOUR, LAMP_RADIANCE, openingHeight, type ChamberUniforms } from './lighting';
import { createChamberMist, type ChamberMist } from './mist';
import type { CollisionWorld } from '../../player/collision';
import { band } from '../../render/tsl/patterns';

type F = Node<'float'>;

export interface WestGate {
  readonly group: Group;
  readonly airlock: Airlock;
  /** Mist in the chamber, composited in post. */
  readonly mist: ChamberMist;
  /** The chamber's area lights (applied to the gate's materials only). */
  readonly lamps: readonly RectAreaLight[];
  /** Binds the environments once they exist (the gate's materials blend them by position). */
  bindEnvironments(outdoor: Texture, interior: Texture): void;
  update(dt: number, feet: Vector3, walls: CollisionWorld | undefined): void;
}

/** Lip height (m above the sill) at which a rising leaf stops blocking the passage. */
export const LEAF_CLEAR = 2.4;

/** Radiance of the lamp-lit chamber air (scene units): ~0.06 irradiance on 0.6 albedo, over π. */
const MIST_LAMP_AMBIENT = 0.012;

function setPose(m: Mesh, p: Pose): void {
  const r = p.r;
  m.matrix.set(r[0], r[1], r[2], p.t[0], r[3], r[4], r[5], p.t[1], r[6], r[7], r[8], p.t[2], 0, 0, 0, 1);
  m.matrixWorldNeedsUpdate = true;
}

function basaltMaterial(): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Gate.basalt';
  // Dark honed basalt in 1.2 × 0.6 m slabs (their joints a footprint-filtered line).
  const p = positionWorld.xz;
  const fp = max(length(fwidth(p)), 1e-5) as F;
  const jx = abs(fract(p.x.div(1.2)).sub(0.5)).mul(1.2).negate().add(0.6);
  const jz = abs(fract(p.y.div(0.6)).sub(0.5)).mul(0.6).negate().add(0.3);
  const joint = max(band(jx, 0.003, fp), band(jz, 0.003, fp));
  mat.colorNode = vec3(0.055, 0.052, 0.05).mul(float(1).sub(joint.mul(0.5)));
  mat.roughnessNode = mix(float(0.32), float(0.8), joint);
  mat.metalnessNode = float(0);
  return mat;
}

/** Black EPDM rubber: the gates' seals. */
function rubberMaterial(): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Gate.rubber';
  mat.colorNode = vec3(0.018, 0.018, 0.019);
  mat.roughnessNode = float(0.78);
  mat.metalnessNode = float(0);
  return mat;
}

function lampMaterial(): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Gate.diffuser';
  mat.colorNode = vec3(0.85);
  mat.roughnessNode = float(0.6);
  mat.emissiveNode = vec3(...LAMP_COLOUR).mul(LAMP_RADIANCE);
  return mat;
}

/** Enamelled dial face: ticks every 0.05 bar from 0.5 to 1.05 over 270°, bold at 0.55 and 1.00. */
function dialFaceMaterial(): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = 'Gate.dial';
  const dx = positionWorld.x.sub(DIAL.x);
  const dy = positionWorld.y.sub(DIAL.y);
  const r = length(vec3(dx, dy, 0)).div(DIAL.radius);
  // Angle from the dial's start (−135° from up), clockwise.
  const a = atan(dx, dy).add(Math.PI * 0.75).div(Math.PI * 1.5);
  const step = 1 / 11;
  const tickPos = abs(fract(a.div(step).add(0.5)).sub(0.5)).mul(step);
  const ring = smoothstep(0.62, 0.64, r).mul(smoothstep(0.9, 0.88, r));
  const inRange = a.greaterThan(-0.01).and(a.lessThan(1.01));
  const tick = select(inRange, smoothstep(0.006, 0.003, tickPos).mul(ring), float(0));
  const bold = (v: number) => smoothstep(0.012, 0.007, abs(a.sub((v - 0.5) / 0.55))).mul(smoothstep(0.55, 0.57, r)).mul(smoothstep(0.92, 0.9, r));
  const marks = max(tick, max(bold(0.55), bold(1.0)));
  const arc = smoothstep(0.66, 0.665, r).mul(smoothstep(0.705, 0.7, r)).mul(select(a.greaterThan(0.09).and(a.lessThan(0.91)), float(1), float(0)));
  mat.colorNode = mix(mix(vec3(0.82, 0.79, 0.71), BRONZE_F0.mul(0.6), arc), vec3(0.03), marks);
  mat.roughnessNode = float(0.35);
  return mat;
}

function steelMaterial(name: string, f0: [number, number, number], rough: number): MeshPhysicalNodeMaterial {
  return createBronzeMaterial(name, vec3(...f0), rough);
}

/** The dial's needle: a tapered blade on a hub, pointing up (0.775 bar) at angle 0. */
function buildNeedle(): PolyMesh {
  const m = new PolyMesh(30);
  const R = DIAL.radius;
  const t0 = 0.205;
  const t1 = 0.22;
  const pts: Vec2[] = [[-0.03, -0.12], [0.03, -0.12], [0.012, R * 0.86], [0, R * 0.9], [-0.012, R * 0.86]];
  const lo = pts.map((p) => m.vert([p[0], p[1], t0]));
  const hi = pts.map((p) => m.vert([p[0], p[1], t1]));
  const n = pts.length;
  m.face([...lo].reverse(), 0);
  m.face([...hi], 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    m.face([lo[i], lo[j], hi[j], hi[i]], 0);
  }
  const hub = revolve([[0, t0 - 0.002], [0.06, t0 - 0.002], [0.06, t1 + 0.01], [0.04, t1 + 0.02], [0, t1 + 0.02]], 24, (x, y, h) => [x, y, h], 0);
  return m.append(hub);
}

export function buildWestGate(): WestGate {
  const group = new Group();
  group.name = 'WestGate';
  const airlock = new Airlock();
  const uniforms: ChamberUniforms = createChamberUniforms();
  const lamps = createLamps();
  const lampLights = lights(lamps);
  const mist = createChamberMist();

  const stone = createCeramicMaterial('Gate.stone');
  const bronze = createBronzeMaterial('Gate.bronze');
  const basalt = basaltMaterial();
  const diffuser = lampMaterial();
  const dialFace = dialFaceMaterial();
  const apron = createPadMaterial({ inlays: 'axis' });
  const steel = steelMaterial('Gate.steel', [0.42, 0.36, 0.3], 0.38);
  const chrome = steelMaterial('Gate.chrome', [0.72, 0.72, 0.7], 0.14);
  const rubber = rubberMaterial();
  const lit: MeshPhysicalNodeMaterial[] = [stone, bronze, basalt, dialFace, steel, chrome, rubber];
  for (const m of lit) m.lightsNode = lampLights;

  const ghMats: Material[] = [];
  ghMats[GH_SLOT.stone] = stone;
  ghMats[GH_SLOT.bronze] = bronze;
  ghMats[GH_SLOT.basalt] = basalt;
  ghMats[GH_SLOT.lamp] = diffuser;
  ghMats[GH_SLOT.dial] = dialFace;
  ghMats[GH_SLOT.apron] = apron;
  ghMats[GH_SLOT.rubber] = rubber;
  const gatehouse = new Mesh(emitParts(buildGatehouse().map((p) => p.mesh), { slots: GH_SLOTS }), ghMats);
  gatehouse.name = 'WestGate.gatehouse';
  gatehouse.matrixAutoUpdate = false;
  group.add(gatehouse);

  const leafGeo = emitParts(buildLeaf().map((p) => p.mesh), { slots: LEAF_SLOTS });
  const leafMats: Material[] = [];
  leafMats[LEAF_SLOT.steel] = steel;
  leafMats[LEAF_SLOT.bronze] = bronze;
  leafMats[LEAF_SLOT.rubber] = rubber;
  const mech: Material[] = [];
  mech[MECH_SLOT.steel] = steel;
  mech[MECH_SLOT.bronze] = bronze;
  mech[MECH_SLOT.chrome] = chrome;
  const barrelGeo = emitParts([buildHoistBarrel()], { slots: 3 });
  const rodGeo = emitParts([buildHoistRod()], { slots: 3 });
  const boltGeo = emitParts([buildBolt()], { slots: 3 });

  const make = (geo: Mesh['geometry'], mats: Material[], name: string) => {
    const m = new Mesh(geo, mats);
    m.name = name;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  const gates = [
    { name: 'outer', xt: GATE.outerTrunnionX, lip: GATE.outerLipX, act: airlock.outer },
    { name: 'inner', xt: GATE.innerTrunnionX, lip: GATE.innerLipX, act: airlock.inner },
  ].map((g) => ({
    ...g,
    leaf: make(leafGeo, leafMats, `WestGate.leaf.${g.name}`),
    hoists: ([-1, 1] as const).map((side) => ({ side, barrel: make(barrelGeo, mech, `WestGate.hoist.${g.name}${side}`), rod: make(rodGeo, mech, `WestGate.rod.${g.name}${side}`) })),
    bolts: [-4.5, 4.5].map((z) => ({ z, mesh: make(boltGeo, mech, `WestGate.bolt.${g.name}${z}`) })),
  }));

  const needle = make(emitParts([buildNeedle()], { slots: 1 }), [steelMaterial('Gate.needle', [0.06, 0.05, 0.05], 0.3)], 'WestGate.needle');
  const pose = (s: number) => {
    for (const g of gates) {
      setPose(g.leaf, leafPose(g.xt, s >= 0 ? s : g.act.openness));
      for (const h of g.hoists) {
        const hp = hoistPoses(g.xt, h.side, g.act.openness);
        setPose(h.barrel, hp.barrel);
        setPose(h.rod, hp.rod);
      }
      for (const b of g.bolts) setPose(b.mesh, boltPose(g.lip, b.z, g.act.bolts));
    }
    // Needle: 0.5 bar at 135° anticlockwise of up, 1.05 bar at 135° clockwise (seen from the
    // chamber, where x is right and y up): a rotation about +z by −(clockwise angle).
    const clockwise = (-0.75 + ((airlock.bar - 0.5) / 0.55) * 1.5) * Math.PI;
    const c = Math.cos(-clockwise);
    const sn = Math.sin(-clockwise);
    // Dial on the north wall, facing +z.
    setPose(needle, { r: [c, -sn, 0, sn, c, 0, 0, 0, 1], t: [DIAL.x, DIAL.y, -GATE.passageHalf - 0.06] });
    uniforms.outerOpening.value = openingHeight(airlock.outer.openness);
    uniforms.innerOpening.value = openingHeight(airlock.inner.openness);
  };
  pose(-1);
  group.updateMatrixWorld(true);

  const all = [stone, bronze, basalt, dialFace, steel, chrome, rubber];
  return {
    group,
    airlock,
    mist,
    lamps,
    bindEnvironments(outdoor, interior) {
      for (const m of all) {
        m.envNode = gateEnvironment(outdoor, interior, uniforms);
        m.needsUpdate = true;
      }
    },
    update(dt, feet, walls) {
      airlock.update(dt, { x: feet.x, z: feet.z });
      pose(-1);
      // A leaf blocks only while its lip is below head height: you walk under it as soon as it
      // has lifted clear, not when it reaches its stop.
      walls?.setEnabled('gate:outer', openingHeight(airlock.outer.openness) < LEAF_CLEAR);
      walls?.setEnabled('gate:inner', openingHeight(airlock.inner.openness) < LEAF_CLEAR);
      // What the mist scatters: the lamps' ambient (≈500 lx on pale walls), plus daylight through
      // whichever gate is open.
      mist.level.value = airlock.mist;
      const amb = MIST_LAMP_AMBIENT + 0.5 * airlock.outer.openness + 0.35 * airlock.inner.openness;
      mist.ambient.value.set(amb, amb * 0.97, amb * 0.92);
    },
  };
}
