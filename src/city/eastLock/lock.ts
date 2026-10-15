/**
 * The East Lock in the scene (docs/east-lock.md): the fixed gatehouse, the two leaves and their
 * hoists, posed from each gate's openness. It is the foundation the craft (step 4) will drive:
 * nothing here moves on its own and nothing responds to the walker; `setOpenness` is the whole
 * interface, and `?lock=closed|outer|inner|open` holds a pose for review.
 */
import { Group, Matrix4, Mesh, MeshPhysicalNodeMaterial, type Material, type Texture } from 'three/webgpu';
import { float, mix, positionWorld, pmremTexture, smoothstep, vec3, dot } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { emitParts, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { revolve } from '../../geometry/sweep';
import { createBronzeMaterial, createCeramicMaterial } from '../materials/ceramic';
import { createPadMaterial } from '../../ground/padMaterial';
import { basaltMaterial, rubberMaterial } from '../gate/gate';
import { GH_SLOT, GH_SLOTS } from '../gate/gatehouse';
import { LEAF_SLOT, LEAF_SLOTS } from '../gate/leaf';
import { MECH_SLOT } from '../gate/mechanism';
import { DOME } from '../dome/spec';
import { buildLockStructure, lockHoistPivotA } from './structure';
import { buildLockLeaf, lockLugPin } from './leaf';
import { LOCK, lockLeafAngle, mirrorMesh, toWorld } from './spec';

export interface EastLock {
  readonly group: Group;
  /** Poses both gates: openness 0 (shut) to 1 (open). */
  setOpenness(outer: number, inner: number): void;
  bindEnvironments(outdoor: Texture, interior: Texture): void;
}

/** Hoist cylinders (barrel from the fixed pivot, rod from the leaf's lug), lengths and radii. */
export const LOCK_HOIST = { barrelLength: 19.4, barrelR: 0.62, rodLength: 18.6, rodR: 0.3 } as const;

const axisY = (x: number, y: number, h: number): Vec3 => [x, h, -y];

export function lockHoistBarrel() {
  const { barrelLength: Lb, barrelR: R } = LOCK_HOIST;
  const prof: Vec2[] = [[0, -0.45], [0.34, -0.45], [0.45, -0.32], [0.45, 0.1], [R - 0.06, 0.25], [R, 0.33], [R, Lb - 0.85], [R + 0.12, Lb - 0.72], [R + 0.12, Lb - 0.12], [R + 0.06, Lb], [0, Lb]];
  return revolve(prof, 40, axisY, prof.slice(0, -1).map(() => MECH_SLOT.steel), 35);
}

export function lockHoistRod() {
  const { rodLength: Lr, rodR: r } = LOCK_HOIST;
  const prof: Vec2[] = [[0, -0.4], [0.3, -0.4], [0.42, -0.26], [0.42, 0.26], [r + 0.04, 0.38], [r, 0.46], [r, Lr], [0, Lr]];
  return revolve(prof, 28, axisY, MECH_SLOT.chrome, 35);
}

/** A leaf's pose (world) at openness s: rotation about its trunnion (mirrored onto the east: by −angle). */
export function lockLeafPose(xt: number, s: number): (p: Vec3) => Vec3 {
  const a = -lockLeafAngle(Math.min(1, Math.max(0, s)));
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const t = toWorld([xt, LOCK.trunnionY, 0]);
  return (p) => [t[0] + p[0] * c - p[1] * sn, t[1] + p[0] * sn + p[1] * c, p[2]];
}

/** A hoist's ends (world): the fixed pivot A and the leaf's lug pin B at openness s. */
export function lockHoistEnds(xt: number, side: -1 | 1, s: number): { A: Vec3; B: Vec3 } {
  const a = lockLeafAngle(Math.min(1, Math.max(0, s)));
  const pin = lockLugPin(side);
  const B = toWorld([xt + pin[0] * Math.cos(a) - pin[1] * Math.sin(a), LOCK.trunnionY + pin[0] * Math.sin(a) + pin[1] * Math.cos(a), pin[2]]);
  return { A: toWorld(lockHoistPivotA(xt, side)), B };
}

/** A matrix taking local +y onto the direction from `from` toward `to`, at `from`. */
export function aim(m: Matrix4, from: Vec3, to: Vec3): Matrix4 {
  const y = v3.norm(v3.sub(to, from));
  const x = v3.norm(v3.cross(y, [0, 0, 1]));
  const z = v3.cross(x, y);
  return m.set(x[0], y[0], z[0], from[0], x[1], y[1], z[1], from[1], x[2], y[2], z[2], from[2], 0, 0, 0, 1);
}

/** Lit by the outdoor sky outside the glass and the Dome's interior capture inside it. */
function lockEnvironment(outdoor: Texture, interior: Texture): Node<'vec3'> {
  const p = positionWorld.sub(vec3(0, DOME.centreY, 0));
  const s = dot(p.mul(vec3(1 / DOME.a, 1 / DOME.c, 1 / DOME.a)), p.mul(vec3(1 / DOME.a, 1 / DOME.c, 1 / DOME.a)));
  const inside = smoothstep(float(1.01), float(0.99), s);
  return mix(pmremTexture(outdoor), pmremTexture(interior), inside) as unknown as Node<'vec3'>;
}

export function buildEastLock(): EastLock {
  const group = new Group();
  group.name = 'EastLock';
  const stone = createCeramicMaterial('Lock.stone');
  const bronze = createBronzeMaterial('Lock.bronze');
  const basalt = basaltMaterial();
  const apron = createPadMaterial({ inlays: 'axis' });
  const rubber = rubberMaterial();
  const steel = createBronzeMaterial('Lock.steel', vec3(0.42, 0.36, 0.3), 0.38);
  const chrome = createBronzeMaterial('Lock.chrome', vec3(0.72, 0.72, 0.7), 0.14);
  const gh: Material[] = [];
  gh[GH_SLOT.stone] = stone;
  gh[GH_SLOT.bronze] = bronze;
  gh[GH_SLOT.basalt] = basalt;
  gh[GH_SLOT.lamp] = stone;
  gh[GH_SLOT.dial] = stone;
  gh[GH_SLOT.apron] = apron;
  gh[GH_SLOT.rubber] = rubber;
  const structure = new Mesh(emitParts(buildLockStructure().map((p) => p.mesh), { slots: GH_SLOTS }), gh);
  structure.name = 'EastLock.gatehouse';
  structure.matrixAutoUpdate = false;
  group.add(structure);

  const leafMats: Material[] = [];
  leafMats[LEAF_SLOT.steel] = steel;
  leafMats[LEAF_SLOT.bronze] = bronze;
  leafMats[LEAF_SLOT.rubber] = rubber;
  const leafGeo = emitParts(buildLockLeaf().map((p) => mirrorMesh(p.mesh)), { slots: LEAF_SLOTS });
  const mech: Material[] = [];
  mech[MECH_SLOT.steel] = steel;
  mech[MECH_SLOT.bronze] = bronze;
  mech[MECH_SLOT.chrome] = chrome;
  const barrelGeo = emitParts([lockHoistBarrel()], { slots: 3 });
  const rodGeo = emitParts([lockHoistRod()], { slots: 3 });
  const make = (geo: Mesh['geometry'], mats: Material[], name: string) => {
    const m = new Mesh(geo, mats);
    m.name = name;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  const gates = ([['outer', LOCK.outerTrunnionX], ['inner', LOCK.innerTrunnionX]] as const).map(([name, xt]) => ({
    xt,
    leaf: make(leafGeo, leafMats, `EastLock.leaf.${name}`),
    hoists: ([-1, 1] as const).map((side) => ({ side, barrel: make(barrelGeo, mech, `EastLock.hoist.${name}${side}`), rod: make(rodGeo, mech, `EastLock.rod.${name}${side}`) })),
  }));

  const rot = new Matrix4();
  const setOpenness = (outer: number, inner: number) => {
    [outer, inner].forEach((s, i) => {
      const g = gates[i];
      const a = lockLeafAngle(Math.min(1, Math.max(0, s)));
      // Mirrored onto the east: the lock frame's rotation by +a is a rotation by −a in the world.
      const t = toWorld([g.xt, LOCK.trunnionY, 0]);
      g.leaf.matrix.makeTranslation(t[0], t[1], t[2]).multiply(rot.makeRotationZ(-a));
      g.leaf.matrixWorldNeedsUpdate = true;
      for (const h of g.hoists) {
        const { A, B } = lockHoistEnds(g.xt, h.side, s);
        aim(h.barrel.matrix, A, B);
        aim(h.rod.matrix, B, A);
        h.barrel.matrixWorldNeedsUpdate = true;
        h.rod.matrixWorldNeedsUpdate = true;
      }
    });
  };
  setOpenness(0, 0);
  const all = [stone, bronze, basalt, rubber, steel, chrome] as MeshPhysicalNodeMaterial[];
  return {
    group,
    setOpenness,
    bindEnvironments(outdoor, interior) {
      for (const m of all) {
        m.envNode = lockEnvironment(outdoor, interior);
        m.needsUpdate = true;
      }
    },
  };
}
