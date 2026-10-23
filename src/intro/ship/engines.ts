/**
 * The engines (docs/intro-ship.md, "Engines"). Two mains, one in each nacelle's tail: a bell on a
 * gimbal collar in the throat of the aft plate, its burnt-metal skin heat-tinted, a glowing core
 * deep in it. Five lift engines for hovering and landing: a vent in each nacelle's floor fore and
 * aft of the gear bay and one in the belly under the cabin, each a recessed grille of vanes over a
 * glowing exit. Their jets are the craft's (vehicles/craft/plume.ts jetRadiance): hot, optically
 * thin gas, integrated in closed form per pixel.
 */
import { AdditiveBlending, BackSide, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Vector3, type Matrix4 } from 'three/webgpu';
import { color, float, mix, mrt, uniform, vec4, velocity } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { box, lathe, type Basis } from '../../geometry/solids';
import { PolyMesh, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { glowNode } from '../../sky/structure/thermal';
import { jetRadiance, PLUME } from '../../vehicles/craft/plume';
import { noContactNormal } from '../../vehicles/materials';
import { NACELLE, NOZZLE_CENTRE, SECTION, HULL_T } from './spec';
import { SHIP_SLOT as S } from './slots';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The main bell: from its throat in the aft plate out to its exit. */
export const BELL = { throat: 0.47, exit: 0.68, length: 1.05, wall: 0.035, inset: 0.22 } as const;

/** The lift vents: their centres in a floor (x, z), half-sizes, and the floor's height and wall. */
export interface Vent {
  name: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  skinY: number;
  wall: number;
}

export const VENTS: readonly Vent[] = [
  { name: 'belly', x: 5.9, z: 0, hx: 0.42, hz: 0.3, skinY: SECTION.belly, wall: HULL_T },
  ...([1, -1] as const).flatMap((s) => [
    { name: `fore-${s > 0 ? 's' : 'p'}`, x: -1.75, z: s * NACELLE.z, hx: 0.42, hz: 0.2, skinY: NACELLE.y - NACELLE.halfHeight, wall: NACELLE.wall },
    { name: `aft-${s > 0 ? 's' : 'p'}`, x: -10.0, z: s * NACELLE.z, hx: 0.42, hz: 0.2, skinY: NACELLE.y - NACELLE.halfHeight, wall: NACELLE.wall },
  ]),
];

/** A main bell (starboard; ship frame), its collar and its core. */
export function buildMainEngine(): { bell: PolyMesh; core: PolyMesh } {
  const B = BELL;
  const c = NOZZLE_CENTRE;
  // Along −x, out of the aft plate: a basis with w aft.
  const base: Basis = { o: [c[0] + B.inset, c[1], c[2]], u: [0, 1, 0], v: [0, 0, 1], w: [-1, 0, 0] };
  // The bell's wall as a closed (r, h) loop: outer contour out to the exit lip, back up the inside.
  const n = 10;
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = t * (B.length + B.inset);
    // A parabolic bell from the throat to the exit.
    const r = B.throat + (B.exit - B.throat) * Math.pow(t, 1.6);
    outer.push([r + B.wall, h]);
    inner.push([r, h]);
  }
  const loop: Vec2[] = [...inner, [B.exit + B.wall * 0.5, B.length + B.inset + 0.02], ...outer.reverse()];
  const bell = lathe(loop, 40, base, S.nozzle);
  // The core: a glowing disc deep in the throat.
  const core = lathe([[0, 0.02], [B.throat - 0.004, 0.02], [B.throat - 0.004, 0.05], [0, 0.05]], 32, base, S.engineGlow);
  return { bell, core };
}

/** A lift vent's grille: vanes across it, in its frame (centre on the skin, y up into the ship). */
export function buildVentGrille(v: Vent): { vanes: PolyMesh; glow: PolyMesh } {
  const vanes = new PolyMesh(40);
  const count = 7;
  const pitch = (2 * v.hx) / count;
  for (let i = 0; i < count; i++) {
    const x = -v.hx + pitch * (i + 0.5);
    vanes.append(box({ o: [v.x + x, v.skinY + v.wall * 0.55, v.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, pitch * 0.18, v.hz - 0.01, v.wall * 0.4, 0.004, S.titanium));
  }
  // The engine's exit above the vanes: a glowing plate in the vent's throat.
  const glow = box({ o: [v.x, v.skinY + v.wall + 0.03, v.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, v.hx - 0.01, v.hz - 0.01, 0.012, 0.003, S.engineGlow);
  return { vanes, glow };
}

/** The engine core's material: glowing at its temperature, which follows the thrust. */
export function createEngineGlowMaterial(): { material: MeshStandardNodeMaterial; level: { value: number } } {
  const level = uniform(0);
  const m = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.4 });
  m.name = 'Ship.engineGlow';
  m.colorNode = color('#3a2a22');
  m.emissiveNode = glowNode(mix(float(900), float(4300), level)).mul(level.greaterThan(0.01).select(float(1), float(0)));
  return { material: m, level: level as unknown as { value: number } };
}

/** The jets: one per engine, each a shell bounding it (vehicles/craft/plume.ts). */
export interface ShipJets {
  readonly group: Group;
  /** Per frame, after the ship is posed (its world matrix): the mains' and the lifts' thrust, the time. */
  update(ship: Matrix4, main: number, lift: number, time: number): void;
}

export function createShipJets(): ShipJets {
  const group = new Group();
  group.name = 'IntroShip.jets';
  const time = uniform(0);
  interface Jet {
    mesh: Mesh;
    origin: { value: Vector3 };
    axis: { value: Vector3 };
    len: { value: number };
    burn: { value: number };
    at: Vector3;
    dir: Vector3;
    re: number;
    kind: 'main' | 'lift';
  }
  const jets: Jet[] = [];
  const make = (kind: 'main' | 'lift', at: Vec3, dir: Vec3, re: number) => {
    const L = PLUME.length * re;
    const r0 = re * PLUME.margin;
    const r1 = re * (1 + PLUME.spread) * PLUME.margin;
    const g = new CylinderGeometry(r1, r0, L, 32, 1, false);
    g.translate(0, L / 2, 0);
    const origin = uniform(new Vector3());
    const axis = uniform(new Vector3(0, -1, 0));
    const len = uniform(L);
    const burn = uniform(0);
    const mat = new MeshBasicNodeMaterial();
    mat.name = `Ship.jet.${kind}`;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = BackSide;
    mat.fog = false;
    mat.outputNode = vec4(jetRadiance(origin as unknown as V3, axis as unknown as V3, float(re), len as unknown as F, burn as unknown as F, time as unknown as F, float(L)), 1);
    mat.mrtNode = mrt({ normal: noContactNormal(), velocity });
    const mesh = new Mesh(g, mat);
    mesh.name = `IntroShip.jet.${kind}`;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 10;
    mesh.visible = false;
    group.add(mesh);
    jets.push({ mesh, origin: origin as unknown as { value: Vector3 }, axis: axis as unknown as { value: Vector3 }, len: len as unknown as { value: number }, burn: burn as unknown as { value: number }, at: new Vector3(...at), dir: new Vector3(...dir), re, kind });
  };
  for (const s of [1, -1]) {
    const c = NOZZLE_CENTRE;
    make('main', [c[0] - BELL.length + 0.04, c[1], s * c[2]], [-1, 0, 0], BELL.exit * 0.94);
  }
  for (const v of VENTS) make('lift', [v.x, v.skinY - 0.02, v.z], [0, -1, 0], Math.min(v.hx, v.hz) * 1.1);
  const ref = new Vector3();
  const a = new Vector3();
  const c = new Vector3();
  return {
    group,
    update(ship, main, lift, t) {
      (time as unknown as { value: number }).value = t;
      for (const j of jets) {
        const b = j.kind === 'main' ? main : lift;
        j.mesh.visible = b > 0.01;
        if (!j.mesh.visible) continue;
        j.burn.value = b;
        j.origin.value.copy(j.at).applyMatrix4(ship);
        j.axis.value.copy(j.dir).transformDirection(ship);
        j.len.value = PLUME.length * j.re * (0.22 + 0.78 * b);
        // The shell: its cylinder (built along +y from its base) turned onto the jet's axis.
        const axis = j.axis.value;
        ref.set(Math.abs(axis.y) > 0.9 ? 1 : 0, Math.abs(axis.y) > 0.9 ? 0 : 1, 0);
        a.crossVectors(axis, ref).normalize();
        c.crossVectors(a, axis);
        j.mesh.matrix.makeBasis(a, axis, c).setPosition(j.origin.value);
        j.mesh.matrixWorldNeedsUpdate = true;
      }
    },
  };
}
