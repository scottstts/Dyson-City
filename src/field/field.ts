/**
 * The Field (docs/field.md): the Halo and pad, the five heroes, the network. Each zone's static
 * parts are generated as named parts (audited by tests/), emitted as one mesh with a group per
 * material slot, and lit by the zone's own reflection probe. Moving assemblies (the Gyre's gimbals,
 * the Loom's carriage and spool, the Mast's heads) are separate meshes posed by `update`.
 */
import { Group, Matrix4, Mesh, type Material, type Object3D } from 'three/webgpu';
import { emitParts } from '../geometry/polyMesh';
import { createFieldMaterials, FIELD_SLOTS, type FieldLook } from './materials/materials';
import { buildHalo } from './halo';
import { buildGyre } from './heroes/gyre';
import { buildResonator } from './heroes/resonator';
import { buildMast } from './heroes/mast';
import { buildRadiators } from './heroes/spires';
import { buildTowers, clusterPlans } from './heroes/towers';
import { buildNetwork } from './network';
import { buildCordon } from './cordon';
import { buildPlant, PLANT_ZONES } from './plant/plant';
import { buildLoom } from './heroes/loom';
import type { Mover, Part } from './kit/parts';
import { ReliefVents } from './vents';
import { createVentVapour, type VentVapour } from './vapour';
import { buildColdHold, reliefStacks } from './heroes/coldHold';
import { COLD_HOLD, GYRE, FIELD_Y, LOOM, MAST, RESONATOR } from './layout';

export interface FieldZone {
  name: string;
  parts: Part[];
  movers: Mover[];
  /** Reflection probe: capture point and proxy radius. */
  probe: { centre: [number, number, number]; radius: number };
}

export interface Field {
  readonly group: Group;
  readonly zones: readonly FieldZone[];
  /** Static meshes, one per zone (captures and the star-shade raster). */
  readonly statics: readonly Mesh[];
  /** Moving meshes, posed each frame. */
  readonly moving: readonly Mesh[];
  /** Rebinds each zone's materials (its probe, the star-shade). */
  setLook(look: (zone: FieldZone) => FieldLook): void;
  /** Copies of the field's statics for a capture, lit by `look`. */
  captureCopies(look: FieldLook): Object3D[];
  /** The Cold Hold's relief stacks (lifting and reseating with game time). */
  readonly vents: ReliefVents;
  /** Game time of the last update. */
  readonly time: number;
  /** Vapour over venting stacks, composited in post. */
  readonly vapour: VentVapour;
  update(gameTime: number): void;
}

export function buildFieldZones(): FieldZone[] {
  const halo = buildHalo();
  const gyre = buildGyre();
  const mast = buildMast();
  const loom = buildLoom();
  const zones: FieldZone[] = [
    { name: 'halo', parts: halo.parts.list, movers: [], probe: { centre: [0, FIELD_Y + 12, 0], radius: 230 } },
    { name: 'net', parts: buildNetwork().list, movers: [], probe: { centre: [0, FIELD_Y + 12, 0], radius: 300 } },
    // The cordon shares the core's capture (a ring a kilometre round has no one place to stand).
    { name: 'cordon', parts: buildCordon().list, movers: [], probe: { centre: [0, FIELD_Y + 12, 0], radius: 460 } },
    { name: 'gyre', parts: gyre.parts.list, movers: gyre.movers, probe: { centre: [GYRE.x - 52, FIELD_Y + 30, GYRE.z + 40], radius: 170 } },
    { name: 'resonator', parts: buildResonator().list, movers: [], probe: { centre: [RESONATOR.x + 40, FIELD_Y + 40, RESONATOR.z - 60], radius: 200 } },
    { name: 'hold', parts: buildColdHold().parts.list, movers: [], probe: { centre: [COLD_HOLD.x, FIELD_Y + 26, COLD_HOLD.z], radius: 160 } },
    { name: 'mast', parts: mast.parts.list, movers: mast.movers, probe: { centre: [MAST.x + 24, FIELD_Y + 40, MAST.z + 22], radius: 160 } },
    { name: 'loom', parts: loom.parts.list, movers: loom.movers, probe: { centre: [190, FIELD_Y + 30, LOOM.zB + 34], radius: 230 } },
    { name: 'rad', parts: buildRadiators().list, movers: [], probe: { centre: [140, FIELD_Y + 30, 300], radius: 260 } },
    ...clusterPlans().map((c) => ({ name: c.name, parts: buildTowers(c.name, c).list, movers: [], probe: { centre: [c.x + c.podiumR + 30, FIELD_Y + 40, c.z] as [number, number, number], radius: 220 } })),
  ];
  // The secondary plant: a mesh per zone, lit by its hero's probe.
  const heroOf: Record<string, string> = { craft: 'mast', instruments: 'gyre', power: 'converter', cryo: 'hold', science: 'resonator', works: 'loom', heat: 'rad' };
  for (const z of PLANT_ZONES) {
    const hero = zones.find((x) => x.name === heroOf[z]) ?? zones[0];
    zones.push({ name: `plant-${z}`, parts: buildPlant(z).list, movers: [], probe: hero.probe });
  }
  return zones;
}

export function buildField(): Field {
  const group = new Group();
  group.name = 'Field';
  const zones = buildFieldZones();
  const statics: Mesh[] = [];
  const moving: { mesh: Mesh; mover: Mover; zone: number }[] = [];
  const materials: Material[][] = [];
  zones.forEach((z, zi) => {
    const mats = createFieldMaterials(z.name);
    materials.push(mats);
    const geo = emitParts(z.parts.map((p) => p.mesh), { slots: FIELD_SLOTS });
    const mesh = new Mesh(geo, mats);
    mesh.name = `Field.${z.name}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    statics.push(mesh);
    for (const mv of z.movers) {
      const g = emitParts(mv.parts.map((p) => p.mesh), { slots: FIELD_SLOTS });
      const m = new Mesh(g, mats);
      m.name = `Field.${z.name}.${mv.name}`;
      m.matrixAutoUpdate = false;
      group.add(m);
      moving.push({ mesh: m, mover: mv, zone: zi });
    }
  });
  const pose = (t: number) => {
    for (const { mesh, mover } of moving) {
      mover.pose(t, mesh.matrix as unknown as Matrix4);
      mesh.matrixWorldNeedsUpdate = true;
    }
  };
  pose(0);
  const vents = new ReliefVents(reliefStacks());
  const vapour = createVentVapour(vents);
  let time = 0;
  return {
    group,
    zones,
    statics,
    moving: moving.map((m) => m.mesh),
    setLook(look) {
      zones.forEach((z, i) => {
        const mats = createFieldMaterials(z.name, look(z));
        materials[i] = mats;
        statics[i].material = mats;
      });
      for (const m of moving) m.mesh.material = materials[m.zone];
    },
    captureCopies(look) {
      // One set for the Dome-ceramic zones; the plant's zones keep their own cladding colour.
      const shared = createFieldMaterials('capture', look);
      return statics.map((s, i) => {
        const name = zones[i].name;
        const m = new Mesh(s.geometry, name.startsWith('plant-') ? createFieldMaterials(name, look) : shared);
        m.name = `capture:${s.name}`;
        m.matrixAutoUpdate = false;
        return m;
      });
    },
    vents,
    vapour,
    get time() {
      return time;
    },
    update(t) {
      const dt = Math.min(0.25, Math.max(0, t - time));
      time = t;
      pose(t);
      vents.update(t);
      vapour.update(dt);
    },
  };
}
