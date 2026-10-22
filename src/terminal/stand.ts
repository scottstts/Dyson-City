/**
 * The Stand and its terminal in the scene (docs/terminal.md): built at boot from the plan
 * (layout.ts → build/), merged by material slot into one mesh; the screen, the lamp and the keys are
 * their own small meshes. Owns the terminal's OS and its screen; the walker's walk mesh and the
 * car's walls come from walk.ts.
 */
import { BufferAttribute, Group, Mesh, type Material, type Vector3 } from 'three/webgpu';
import { emitParts } from '../geometry/polyMesh';
import type { CollisionWorld } from '../player/collision';
import type { WalkMesh } from '../player/walkMesh';
import type { GroundSurface } from '../city/walk';
import { buildPlatform } from './build/platform';
import { buildConsole, screenPose } from './build/console';
import { createStandMaterials, STAND_SLOTS, type StandLook } from './materials';
import { createLampMaterial, createScreenMaterial, keyTravel } from './screenMaterial';
import { addStandCarWalls, standSurface, standWalk } from './walk';
import { TerminalOS, type TerminalKey } from './os/os';
import { TerminalScreen, type Peaks, type TerminalLive } from './os/screen';
import { StandSilencer } from './silencer';

/** The order of the keys on the ledge (build/console.ts) as the OS names them. */
const KEY_ORDER: TerminalKey[] = ['left', 'down', 'right', 'up', 'enter'];
/** Beyond this distance (m) the screen is not redrawn: no one can read it. */
const READ_DISTANCE = 45;

export interface Stand {
  readonly group: Group;
  readonly walk: WalkMesh;
  /** Statics for the star-shade's raster. */
  readonly occluders: readonly Mesh[];
  /** Meshes the house's indoor culling may hide. */
  readonly outdoorMeshes: readonly Mesh[];
  readonly os: TerminalOS;
  readonly screen: TerminalScreen;
  addCarWalls(walls: CollisionWorld): void;
  setLook(look: StandLook): void;
  captureCopies(): Mesh[];
  surfaceAt(x: number, z: number, y: number): GroundSurface | null;
  /** The share of the field's sound let through by the Stand's silencer (silencer.ts): 1 off it, 0 on its deck. */
  readonly fieldGain: number;
  /** Per frame: where the player is (their feet, or the car they drive), for the silencer. */
  listen(dt: number, x: number, y: number, z: number): void;
  /**
   * Per frame: the OS's clock, the screen (if anyone is near), the lamp and the keys. `adaptation`
   * is the eye's (render/adaptation.ts): the screen's auto-brightness divides it out.
   */
  update(t: number, eye: Vector3, live: TerminalLive, peaks: Peaks, adaptation: number): void;
}

/** A key's travel after a press at t0: down in 30 ms, held 90 ms, back up over 120 ms. */
function keyCurve(dt: number): number {
  if (dt < 0) return 0;
  if (dt < 0.03) return dt / 0.03;
  if (dt < 0.12) return 1;
  return Math.max(0, 1 - (dt - 0.12) / 0.12);
}

export function buildStand(): Stand {
  const group = new Group();
  group.name = 'Stand';
  const platform = buildPlatform();
  const term = buildConsole();
  const parts = [...platform.parts.list, ...term.parts.list];
  const geometry = emitParts(parts.map((p) => p.mesh), { slots: STAND_SLOTS });
  const body = new Mesh(geometry, createStandMaterials());
  body.name = 'Stand.body';
  body.matrixAutoUpdate = false;
  group.add(body);

  // The screen and its lamp.
  const os = new TerminalOS();
  const screen = new TerminalScreen();
  const glass = createScreenMaterial(screen.texture);
  const screenMesh = new Mesh(emitParts([term.screen], { slots: 1 }), glass.material);
  screenMesh.name = 'Terminal.screen';
  screenMesh.matrixAutoUpdate = false;
  const lamp = createLampMaterial();
  const lampMesh = new Mesh(emitParts([term.lamp], { slots: 1 }), lamp.material);
  lampMesh.name = 'Terminal.lamp';
  lampMesh.matrixAutoUpdate = false;
  group.add(screenMesh, lampMesh);

  // The keys: one mesh, each vertex tagged with its key by the nearest key's centre.
  const keyGeo = emitParts(term.keys, { slots: STAND_SLOTS });
  const centres = term.keys.map((k) => {
    const c = [0, 0, 0];
    for (const v of k.verts) for (let i = 0; i < 3; i++) c[i] += v[i] / k.verts.length;
    return c;
  });
  const pos = keyGeo.getAttribute('position').array as Float32Array;
  const ids = new Float32Array(pos.length / 3);
  for (let i = 0; i < ids.length; i++) {
    let best = 0;
    let bd = Infinity;
    centres.forEach((c, k) => {
      const d = (pos[3 * i] - c[0]) ** 2 + (pos[3 * i + 1] - c[1]) ** 2 + (pos[3 * i + 2] - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    ids[i] = best;
  }
  keyGeo.setAttribute('keyId', new BufferAttribute(ids, 1));
  const travel = keyTravel(term.keyDown as [number, number, number], term.keys.length);
  const keyMaterials = (look: StandLook = {}): Material[] => {
    const mats = createStandMaterials(look);
    for (const m of mats) (m as unknown as { positionNode: unknown }).positionNode = travel.position;
    return mats;
  };
  const keys = new Mesh(keyGeo, keyMaterials());
  keys.name = 'Terminal.keys';
  keys.matrixAutoUpdate = false;
  group.add(keys);

  const walk = standWalk(parts, platform.proxies, term.footprint);
  const pose = screenPose();
  const silencer = new StandSilencer();

  return {
    group,
    walk,
    occluders: [body],
    outdoorMeshes: [body, screenMesh, lampMesh, keys],
    os,
    screen,
    addCarWalls: (walls) => addStandCarWalls(walls, term.carFootprint),
    setLook(look) {
      body.material = createStandMaterials(look);
      keys.material = keyMaterials(look);
      if (look.env) glass.material.envNode = look.env;
      glass.material.needsUpdate = true;
    },
    captureCopies: () => [new Mesh(geometry, createStandMaterials())],
    surfaceAt: standSurface,
    get fieldGain() {
      return silencer.gain;
    },
    listen: (dt, x, y, z) => void silencer.update(dt, x, y, z),
    update(t, eye, live, peaks, adaptation) {
      os.update(t);
      const d = Math.hypot(eye.x - pose.centre[0], eye.y - pose.centre[1], eye.z - pose.centre[2]);
      if (d < READ_DISTANCE * 1.5) screen.preload();
      screen.update(os, live, t, d < READ_DISTANCE, peaks);
      glass.power.value = screen.power / Math.max(1, adaptation);
      lamp.power.value = os.awake ? Math.min(1, (t - os.wokeAt) * 3) : Math.max(0, 1 - (t - os.sleptAt) * 3);
      KEY_ORDER.forEach((k, i) => {
        travel.travel.array[i] = keyCurve(t - os.pressed[k]);
      });
    },
  };
}
