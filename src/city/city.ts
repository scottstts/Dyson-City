/**
 * The city's shared structure (docs/dome.md, docs/gate.md, docs/east-lock.md): the Dome, the West
 * Gate and the East Lock. Places are
 * built on top of this later. Every part is generated as named parts (audited by tests/), then
 * emitted here as one draw mesh per material.
 */
import { DataTexture, FloatType, Group, Mesh, NearestFilter, RedFormat, RepeatWrapping, RectAreaLightNode, type Material, type Object3D, type Texture, type Vector3 } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { emitParts } from '../geometry/polyMesh';
import { buildFrameParts, frameBolts, frameLayout, FRAME_SLOTS, SLOT } from './dome/frame';
import { buildBoltMeshes } from './dome/bolts';
import { bayTable, buildSill } from './dome/glazing';
import { createDomeGlass, GLASS_TRANSMISSION, type GlassComposite } from './dome/glass';
import { createBlackGlazeMaterial, createBronzeMaterial, createCeramicMaterial, domeEnvironment } from './materials/ceramic';
import { buildWestGate, type WestGate } from './gate/gate';
import { buildEastLock, type EastLock } from './eastLock/lock';
import { buildWalk, type CityWalk } from './walk';
import { StarVisibility, type StarView } from './visibility';

export interface City {
  readonly group: Group;
  /** Copies of the Dome's frame for the interior environment capture. */
  captureExtras(): Object3D[];
  /**
   * Lights the city with the outdoor sky and the interior capture, and returns its post
   * composites (the Dome's glass, then the gate chamber's mist).
   */
  bindEnvironments(outdoor: Texture, interior: Texture): GlassComposite[];
  /** What the eye sees of the star from a position (glare scaling). */
  starVisibility(eye: Vector3): StarView;
  readonly gate: WestGate;
  /** The craft airlock in the East Collar (posed by the craft, step 4). */
  readonly lock: EastLock;
  /** Walls and walkable surfaces for the player. */
  readonly walk: CityWalk;
  /** Per frame: runs the airlock for a player standing at `feet`. */
  update(dt: number, feet: Vector3): void;
}

export function buildCity(): City {
  const group = new Group();
  group.name = 'City';
  // Area lights (the gate chamber's luminaires) need their LTC tables once.
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const ceramic = createCeramicMaterial();
  const bronze = createBronzeMaterial();
  const materials: Material[] = [];
  materials[SLOT.ceramic] = ceramic;
  materials[SLOT.bronze] = bronze;
  const black = createBlackGlazeMaterial();
  materials[SLOT.black] = black;

  const t0 = performance.now();
  const layout = frameLayout();
  const frameParts = buildFrameParts(layout);
  const frame = new Mesh(emitParts(frameParts.map((p) => p.mesh), { slots: FRAME_SLOTS }), materials);
  frame.name = 'Dome.frame';
  group.add(frame);
  const bolts = frameBolts(layout);
  for (const m of buildBoltMeshes(bolts, bronze, 'Dome.bolts')) group.add(m);

  const sill = new Mesh(emitParts(buildSill(), { slots: FRAME_SLOTS }), materials);
  sill.name = 'Dome.sill';
  group.add(sill);

  console.info(`[Dyson] dome: ${frameParts.length} parts, ${bolts.length} bolts, ${((frame.geometry.index?.count ?? 0) / 3).toFixed(0)} tris, ${(performance.now() - t0).toFixed(0)} ms`);

  for (const m of group.children) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }
  const gate = buildWestGate();
  group.add(gate.group);
  const lock = buildEastLock();
  group.add(lock.group);
  group.updateMatrixWorld(true);
  const walk = buildWalk(layout);
  const star = new StarVisibility(GLASS_TRANSMISSION);

  const bays = new DataTexture(bayTable(layout, 2048), 2048, 1, RedFormat, FloatType);
  bays.wrapS = RepeatWrapping;
  bays.magFilter = NearestFilter;
  bays.minFilter = NearestFilter;
  bays.needsUpdate = true;

  return {
    group,
    captureExtras: () => {
      const f = new Mesh(frame.geometry, materials);
      f.name = 'capture:Dome.frame';
      f.matrixAutoUpdate = false;
      return [f];
    },
    bindEnvironments(outdoor, interior) {
      for (const m of [ceramic, bronze, black]) {
        m.envNode = domeEnvironment(outdoor, interior);
        m.needsUpdate = true;
      }
      gate.bindEnvironments(outdoor, interior);
      lock.bindEnvironments(outdoor, interior);
      return [createDomeGlass({ outdoor, interior, bays }), gate.mist.composite];
    },
    starVisibility: (eye) => star.at(eye),
    gate,
    lock,
    walk,
    update(dt, feet) {
      gate.update(dt, feet, walk.walls);
      gate.group.updateMatrixWorld();
    },
  };
}
