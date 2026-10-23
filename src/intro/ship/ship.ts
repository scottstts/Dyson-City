/**
 * The intro's ship in the scene (docs/intro-ship.md): its fixed parts merged by material slot into
 * two meshes (the outside and the cabin, each lit its own way: materials.ts), its moving parts
 * (the door, the airstair, the gear) as their own meshes posed each frame, its engines' cores
 * glowing with their thrust and their jets. It exists only for the intro: built at boot, removed
 * and disposed once the intro ends.
 */
import { Group, InstancedMesh, Matrix4, Mesh, type BufferGeometry, type Material, type Object3D } from 'three/webgpu';
import { emitParts, PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { buildHull } from './hull';
import { buildFin, buildNacelle, buildWing, mirrorZ } from './nacelle';
import { buildCabin, CEILING_LIGHTS, CEILING_LIGHT } from './cabin/cabin';
import { buildCockpit, dashFace, overheadFace, COCKPIT_LAMPS, DASH, MONITOR } from './cabin/cockpit';
import { createShipMaterials, LAMP_RADIANCE, SCREEN_RADIANCE, SPOT_RADIANCE, type ShipLook, type ShipMaterials } from './materials';
import type { ShipScreens } from './screens';
import { bakeCabinLight, type CabinEmitter } from './cabinLight';
import { SHIP_SLOT, SHIP_SLOTS, isCabinSlot } from './slots';
import { EYE } from './spec';
import { buildDoorFairing, buildDoorLeaf, doorOffset } from './door';
import { buildFlight, buildHandrail, buildStanchion, buildTread, HANDRAIL, STANCHIONS, stairPose, stairState, stanchionTurn, TREADS } from './stair';
import { buildLeg, LEGS, poseLeg, type LegPose } from './gear';
import { ShipParts } from './parts';
import { buildExteriorDetails } from './details/exterior';
import { buildCockpitDetails } from './details/cockpit';
import { buildCabinDetails } from './details/cabin';
import { createShipLights } from './lights';
import { buildMainEngine, buildVentGrille, createEngineGlowMaterial, createShipJets, VENTS, type ShipJets } from './engines';

/** Every fixed part of the ship, named (tests/introShip.test.ts audits them). */
export function buildShipParts(): ShipParts {
  const parts = new ShipParts();
  parts.add('hull', buildHull());
  const main = buildMainEngine();
  const side: [string, PolyMesh][] = [
    ['nacelle', buildNacelle()],
    ['wing', buildWing()],
    ['fin', buildFin()],
    ['bell', main.bell],
    ['core', main.core],
  ];
  for (const [name, mesh] of side) {
    parts.add(`${name}-s`, mesh);
    parts.add(`${name}-p`, mirrorZ(mesh));
  }
  parts.add('door-fairing', buildDoorFairing());
  for (const v of VENTS) parts.addSet(`vent-vanes-${v.name}`, buildVentGrille(v).vanes);
  for (const l of LEGS) parts.add(`gear-well-${l.name}`, buildLeg(l).well[0]);
  buildExteriorDetails(parts);
  buildCabin(parts);
  buildCockpit(parts);
  buildCockpitDetails(parts);
  buildCabinDetails(parts);
  return parts;
}

/** The faces of a part in the slots `keep` admits (vertices shared; unused ones are not emitted). */
function slotsOf(m: PolyMesh, keep: (slot: number) => boolean): PolyMesh {
  const out = new PolyMesh(m.crease);
  out.verts = m.verts;
  m.faces.forEach((f, i) => {
    if (keep(m.faceMat[i])) out.face(f, m.faceMat[i], m.uvs[i]);
  });
  return out;
}

/** The cabin's emitters for its light bake: the ceiling's light line, the cockpit's lamps, the screens. */
export function cabinEmitters(): CabinEmitter[] {
  const out: CabinEmitter[] = CEILING_LIGHTS.map(([x0, x1]) => ({
    centre: [(x0 + x1) / 2, CEILING_LIGHT.y, 0] as Vec3,
    a: [(x1 - x0) / 2 - 0.06, 0, 0] as Vec3,
    b: [0, 0, CEILING_LIGHT.halfWidth] as Vec3,
    n: [0, -1, 0] as Vec3,
    radiance: LAMP_RADIANCE,
    group: 0 as const,
  }));
  const face = dashFace();
  const midV = ((DASH.top + DASH.bottom) / 2 - DASH.face.y) / Math.cos(DASH.face.rake);
  for (const z of DASH.displays.z) {
    out.push({
      centre: v3.add(face.o, v3.add(v3.add(v3.scale(face.u, z), v3.scale(face.v, midV)), v3.scale(face.w, 0.02))),
      a: v3.scale(face.u, DASH.displays.hw),
      b: v3.scale(face.v, DASH.displays.hh),
      n: face.w,
      radiance: SCREEN_RADIANCE * 0.2,
      group: 1,
    });
  }
  // The map lights (small discs, as squares of the same area) and the footwell strip.
  const oh = overheadFace();
  const L = COCKPIT_LAMPS.overhead;
  const side = (L.r * Math.sqrt(Math.PI)) / 2;
  for (const z of L.lights) {
    const c = v3.add(oh.o, v3.add(v3.add(v3.scale(oh.u, z), v3.scale(oh.v, L.back)), v3.scale(oh.w, 0.016)));
    out.push({ centre: c, a: v3.scale(oh.u, side), b: v3.scale(oh.v, side), n: oh.w, radiance: SPOT_RADIANCE, group: 0 });
  }
  const F = COCKPIT_LAMPS.footwell;
  out.push({ centre: [F.x - 0.06, F.y - F.depth, 0], a: [0, 0, F.halfWidth], b: [0.022, 0, 0], n: [0, -1, 0], radiance: LAMP_RADIANCE * 0.5, group: 0 });
  const w = v3.norm(v3.sub(EYE, MONITOR.centre));
  const u = v3.norm(v3.cross([0, 1, 0], w));
  out.push({ centre: MONITOR.centre, a: v3.scale(u, MONITOR.hw), b: v3.scale(v3.cross(w, u), MONITOR.hh), n: w, radiance: SCREEN_RADIANCE * 0.5, group: 1 });
  return out;
}

/** What moves this frame. */
export interface ShipState {
  /** Seconds into the door's opening (0 shut … DOOR_TIME open), and into the stair's deploying. */
  door: number;
  stair: number;
  /** Gear (0 stowed … 1 down), the struts' compression (m), the mains' and the lifts' thrust (0…1). */
  gear: number;
  compression: number;
  main: number;
  lift: number;
}

interface LegMeshes {
  strut: Mesh;
  arm: Mesh;
  foot: Mesh;
  shockBody: Mesh;
  shockRod: Mesh;
  actuatorBody: Mesh;
  actuatorRod: Mesh;
  doors: [Mesh, Mesh];
  pose: LegPose;
}

export class Ship {
  readonly group = new Group();
  readonly materials: ShipMaterials;
  readonly jets: ShipJets;
  readonly triangles: number;
  /** How much of the door's opening is uncovered (0…1): the cabin's light and air through it. */
  doorOpen = 0;
  private readonly door: Mesh;
  private readonly flight: Mesh;
  private readonly treads: InstancedMesh;
  private readonly stanchions: InstancedMesh;
  private readonly rails: Mesh[];
  private readonly legs: LegMeshes[];
  private readonly ventGlow: Mesh;
  private readonly mainLevel: { value: number };
  private readonly lights = createShipLights();
  private readonly liftLevel: { value: number };
  private readonly geometries: BufferGeometry[] = [];
  private readonly extraMaterials: Material[] = [];

  constructor(screens: ShipScreens) {
    this.group.name = 'IntroShip';
    this.group.matrixAutoUpdate = false;
    this.materials = createShipMaterials({
      monitor: screens.monitor,
      dash: screens.dash,
      monitorHalf: [MONITOR.hw, MONITOR.hh],
      displayHalf: [DASH.displays.hw, DASH.displays.hh],
      displayPitch: DASH.displays.z[2],
    });
    const mats = this.materials.list;
    const mainGlow = createEngineGlowMaterial();
    mats[SHIP_SLOT.engineGlow] = mainGlow.material;
    this.mainLevel = mainGlow.level;
    for (const [slot, m] of Object.entries(this.lights.materials)) mats[Number(slot)] = m;
    const emit = (parts: PolyMesh[]) => {
      const g = emitParts(parts, { slots: SHIP_SLOTS });
      this.geometries.push(g);
      return g;
    };
    const mesh = (name: string, parts: PolyMesh[], list: Material[] = mats) => {
      const m = new Mesh(emit(parts), list);
      m.name = `IntroShip.${name}`;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };
    const emitters = cabinEmitters();

    // Fixed: the outside and the cabin, each lit its own way.
    const parts = buildShipParts();
    this.triangles = parts.triangles;
    const fixed = parts.list.map((p) => p.mesh);
    mesh('outside', fixed.map((m) => slotsOf(m, (s) => !isCabinSlot(s))));
    bakeCabinLight(mesh('cabin', fixed.map((m) => slotsOf(m, isCabinSlot))).geometry, emitters);

    // The lift vents' glow, on the lifts' thrust.
    const ventMats = [...mats];
    const liftGlow = createEngineGlowMaterial();
    ventMats[SHIP_SLOT.engineGlow] = liftGlow.material;
    this.liftLevel = liftGlow.level;
    this.extraMaterials.push(liftGlow.material);
    this.ventGlow = mesh('vent-glow', VENTS.map((v) => buildVentGrille(v).glow), ventMats);

    // The door: its inner face lit as the cabin (baked shut).
    this.door = mesh('door', buildDoorLeaf());
    bakeCabinLight(this.door.geometry, emitters);

    // The stair: the flight, its treads and stanchions (instanced), its rails.
    this.flight = mesh('stair', buildFlight());
    this.treads = new InstancedMesh(emit(buildTread()), mats, TREADS.length);
    this.stanchions = new InstancedMesh(emit([buildStanchion()]), mats, STANCHIONS.length);
    for (const im of [this.treads, this.stanchions]) {
      im.matrixAutoUpdate = false;
      im.frustumCulled = false;
      this.group.add(im);
    }
    this.rails = [mesh('rail-s', [buildHandrail()]), mesh('rail-p', [buildHandrail()])];

    // The gear.
    this.legs = LEGS.map((l) => {
      const p = buildLeg(l);
      return {
        strut: mesh(`${l.name}-strut`, p.strut),
        arm: mesh(`${l.name}-arm`, p.arm),
        foot: mesh(`${l.name}-foot`, p.foot),
        shockBody: mesh(`${l.name}-shock`, [p.shockBody]),
        shockRod: mesh(`${l.name}-shock-rod`, [p.shockRod]),
        actuatorBody: mesh(`${l.name}-actuator`, [p.actuatorBody]),
        actuatorRod: mesh(`${l.name}-actuator-rod`, [p.actuatorRod]),
        doors: [mesh(`${l.name}-door-s`, [p.doors[0]]), mesh(`${l.name}-door-p`, [p.doors[1]])],
        pose: poseLeg(l, 1, 0),
      };
    });
    this.jets = createShipJets();
    this.pose({ door: 0, stair: 0, gear: 1, compression: 0, main: 0, lift: 0 });
  }

  setLook(look: ShipLook): void {
    this.materials.setLook(look);
  }

  /** What the scene must hold besides the ship's group (its jets are posed in the world). */
  get extras(): Object3D[] {
    return [this.jets.group];
  }

  /** Places the ship (its frame in the world). */
  setPose(m: Matrix4): void {
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  /** Poses the moving parts and the engines; the jets follow the ship's world matrix. */
  update(s: ShipState, time: number): void {
    this.pose(s);
    // The lights: on while the engines run; the landing lights while the gear is down too.
    const power = Math.max(s.main, s.lift) > 0.01 ? 1 : 0;
    this.lights.set(time, power, power && s.gear > 0.5 && s.lift > 0.01 ? 1 : 0);
    this.group.updateMatrixWorld(true);
    this.jets.update(this.group.matrixWorld, s.main, s.lift, time);
  }

  private pose(s: ShipState): void {
    const d = doorOffset(s.door);
    this.doorOpen = d.open;
    this.door.matrix.makeTranslation(d.offset[0], d.offset[1], d.offset[2]);
    const st = stairState(s.stair);
    const flight = stairPose(st.run, st.pitch, M0);
    this.flight.matrix.copy(flight);
    // Treads level, turned by the flight's pitch about their pivots.
    TREADS.forEach((y, i) => {
      M1.makeRotationX(st.pitch).setPosition(0, y, 0);
      this.treads.setMatrixAt(i, M2.multiplyMatrices(flight, M1));
    });
    this.treads.instanceMatrix.needsUpdate = true;
    const turn = stanchionTurn(st.pitch);
    STANCHIONS.forEach((p, i) => {
      M1.makeRotationX(turn).setPosition(p[0], p[1], p[2]);
      this.stanchions.setMatrixAt(i, M2.multiplyMatrices(flight, M1));
    });
    this.stanchions.instanceMatrix.needsUpdate = true;
    // The rails ride the stanchions' tops: parallel to the flight, carried by the turn.
    const ry = -HANDRAIL.height * Math.sin(turn);
    const rz = HANDRAIL.height * Math.cos(turn);
    this.rails.forEach((r, i) => r.matrix.multiplyMatrices(flight, M1.makeTranslation(i === 0 ? HANDRAIL.x : -HANDRAIL.x, ry, rz)));
    const out = s.stair > 0;
    for (const m of [this.flight, ...this.rails, this.treads, this.stanchions]) m.visible = out;

    // The gear: every piece posed in the ship frame (gear.ts poseLeg).
    LEGS.forEach((l, i) => {
      const m = this.legs[i];
      const p = poseLeg(l, s.gear, s.compression, m.pose);
      for (const k of ['strut', 'arm', 'foot', 'shockBody', 'shockRod', 'actuatorBody', 'actuatorRod'] as const) m[k].matrix.copy(p[k]);
      m.doors[0].matrix.copy(p.doors[0]);
      m.doors[1].matrix.copy(p.doors[1]);
    });
    this.mainLevel.value = s.main;
    this.liftLevel.value = s.lift;
    this.ventGlow.visible = s.lift > 0.01;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.jets.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of [...this.materials.list, ...this.extraMaterials]) m.dispose();
  }
}

const M0 = new Matrix4();
const M1 = new Matrix4();
const M2 = new Matrix4();
