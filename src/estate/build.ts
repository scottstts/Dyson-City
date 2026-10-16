/**
 * The estate's geometry, without materials (tests and the site-plan tool build it too): the ground
 * regions and meshes, the named parts by group, the instanced repeats, the special surfaces (water,
 * glass) and the walker's proxies.
 */
import { emitParts, PolyMesh, type Vec3 } from '../geometry/polyMesh';
import { WalkMesh } from '../player/walkMesh';
import type { Part } from '../field/kit/parts';
import type { Matrix4 } from 'three';
import { groundRegions, type Region } from './regions';
import { groundMeshes, kerbs, type GroundMesh } from './ground';
import { buildTerraceWall, type Instances } from './terraceWall';
import { buildGateway } from './gateway';
import { buildHedges } from './hedges';
import { buildPond, lilyMesh, padMesh, POND } from './pond';
import { buildKitchenGarden } from './kitchen';
import { buildGlasshouse } from './glasshouse';
import { buildCarriageHouse } from './carriageHouse';
import { buildFurniture } from './furniture';
import { TERRACE_Y, type GroundClass } from './layout';
import { buildPlanting, type Planting } from './plants/plants';
import type { V2 } from './sdf2';

export interface EstateGeometry {
  regions: Record<GroundClass, Region[]>;
  ground: GroundMesh[];
  /** Named parts by group (one draw per group, a geometry group per slot). Hedge groups: `hedge-yew`, `hedge-box`. */
  parts: Record<string, Part[]>;
  /** Repeated elements (one geometry, many instances). */
  instances: Record<string, Instances>;
  /** Single-surface meshes with their own materials: the pool's water, the glasshouse's glass, the carriage house's windows. */
  surfaces: { water: PolyMesh; glass: PolyMesh; darkGlass: PolyMesh };
  /** Simplified solids for the walker (balustrade bays, piers, the carriage house, the pool's edge, the beds, the trunks). */
  proxies: PolyMesh[];
  /** Trees, beds and topiary (plants/). */
  planting: Planting;
}

/** A flat polygon (plan) at height y, facing up. */
function flat(outline: V2[], y: number): PolyMesh {
  const m = new PolyMesh(10);
  const ids = outline.map(([x, z]) => m.vert([x, y, z] as Vec3));
  // The outline turns anticlockwise in x-right, z-down plan: reversed it faces up.
  m.face([...ids].reverse(), 0);
  return m;
}

/** An invisible fence along a loop (thin vertical quads), for the walker only. */
function fence(loop: V2[], y0: number, y1: number): PolyMesh {
  const m = new PolyMesh();
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const ids = [m.vert([a[0], y0, a[1]]), m.vert([b[0], y0, b[1]]), m.vert([b[0], y1, b[1]]), m.vert([a[0], y1, a[1]])];
    m.face(ids, 0);
  }
  return m;
}

export function estateGeometry(): EstateGeometry {
  const regions = groundRegions();
  const ground = groundMeshes(regions);
  const wall = buildTerraceWall();
  const gate = buildGateway();
  const hedges = buildHedges();
  const pond = buildPond();
  const kitchen = buildKitchenGarden();
  const glasshouse = buildGlasshouse();
  const carriage = buildCarriageHouse();
  const planting = buildPlanting(regions.soil);
  const parts: Record<string, Part[]> = {
    kerbs: kerbs(regions),
    wall: wall.parts.list,
    gateway: gate.parts.list,
    pond: pond.parts.list,
    kitchen: kitchen.parts.list,
    glasshouse: glasshouse.parts.list,
    carriage: carriage.parts.list,
    furniture: buildFurniture().list,
    'hedge-yew': [...hedges.parts.list.filter((_, i) => hedges.specs[i].kind === 'yew'), ...planting.topiary.list],
    'hedge-box': hedges.parts.list.filter((_, i) => hedges.specs[i].kind === 'box'),
  };
  const instances: Record<string, Instances> = {
    balusters: { mesh: wall.balusters.mesh, matrices: [...wall.balusters.matrices, ...gate.out.balusters] },
    piers: { mesh: wall.piers.mesh, matrices: [...wall.piers.matrices, ...gate.out.piers] },
    finials: { mesh: wall.finials.mesh, matrices: [...wall.finials.matrices, ...gate.out.finials] },
    'lily-pads': { mesh: padMesh(), matrices: pond.pads },
    lilies: { mesh: lilyMesh(), matrices: pond.flowers },
  };
  // The walker keeps out of the pool and off the beds (plants grow there: city memory "plants in beds").
  const proxies = [...wall.proxies, ...gate.proxies, ...gate.out.proxies, ...carriage.proxies, fence(pond.water, POND.water - 1, TERRACE_Y + 1), ...planting.trunks];
  for (const reg of regions.soil) for (const loop of [reg.outer, ...reg.holes]) proxies.push(fence(loop, TERRACE_Y - 0.2, TERRACE_Y + 1.0));
  const darkGlass = carriage.panes;
  return { regions, ground, parts, instances, surfaces: { water: flat(pond.water, POND.water), glass: glasshouse.panes, darkGlass }, proxies, planting };
}

/** Adds a mesh's triangles (optionally transformed) to the walk mesh. */
export function walkAdd(walk: WalkMesh, m: PolyMesh, matrix?: Matrix4): void {
  const g = emitParts([m], { slots: 64 });
  const pos = g.getAttribute('position').array as Float32Array;
  let p = pos;
  if (matrix) {
    p = new Float32Array(pos.length);
    const e = matrix.elements;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
  }
  walk.add(p, g.getIndex()!.array as Uint32Array);
}

/** Groups whose parts are too fine to walk against: their proxies stand in (or nothing does). */
const NOT_WALLS = new Set(['furniture', 'glasshouse', 'carriage']);

/**
 * The estate's walkable world: the ground (floors only), the parts (kerbs are steps, walls are
 * walls), the proxies, and the instanced piers. Balusters are inside their bays' proxies; the
 * glasshouse walks as its outer frame's footprint (its door is shut).
 */
export function estateWalk(geo: EstateGeometry): WalkMesh {
  const walk = new WalkMesh();
  for (const g of geo.ground) walk.add(g.position, g.index, { walls: false });
  for (const [name, list] of Object.entries(geo.parts)) {
    if (NOT_WALLS.has(name)) continue;
    for (const p of list) walkAdd(walk, p.mesh);
  }
  for (const p of geo.proxies) walkAdd(walk, p);
  for (const name of ['piers', 'finials']) for (const m of geo.instances[name].matrices) walkAdd(walk, geo.instances[name].mesh, m);
  // The glasshouse and benches as their parts' footprints: their dwarf walls and frames block.
  for (const p of [...geo.parts.glasshouse.filter((q) => /dwarf|door/.test(q.name)), ...geo.parts.furniture]) walkAdd(walk, p.mesh);
  return walk;
}
