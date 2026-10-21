/**
 * The world the crew is planned in, built in Node as the game builds it (minus the GPU): the field's
 * meshes (movers at time 0), their body-height occupancy, the height map, the estate's walk mesh,
 * and a wall world. Built once per test file (it takes a few seconds).
 */
import { Matrix4, Mesh } from 'three';
import { buildFieldZones } from '../../src/field/field';
import { emitParts } from '../../src/geometry/polyMesh';
import { FIELD_SLOTS } from '../../src/field/materials/materials';
import { occupancy } from '../../src/field/walk';
import { rasterOccluders, SHADE } from '../../src/lighting/starShade';
import { estateGeometry, estateWalk } from '../../src/estate/build';
import { CollisionWorld } from '../../src/player/collision';
import type { CrewInputs } from '../../src/crew/crew';

let cache: { inputs: CrewInputs; meshes: Mesh[] } | null = null;

export function crewWorld(): { inputs: CrewInputs; meshes: Mesh[] } {
  if (cache) return cache;
  const meshes: Mesh[] = [];
  for (const z of buildFieldZones()) {
    meshes.push(new Mesh(emitParts(z.parts.map((p) => p.mesh), { slots: FIELD_SLOTS })));
    for (const mv of z.movers) {
      const m = new Mesh(emitParts(mv.parts.map((p) => p.mesh), { slots: FIELD_SLOTS }));
      m.matrixAutoUpdate = false;
      mv.pose(0, m.matrix as Matrix4);
      // As the field does: the posed matrix is the world's (no parent).
      m.matrixWorldNeedsUpdate = true;
      meshes.push(m);
    }
  }
  const occ = occupancy(meshes as never);
  const lohi = rasterOccluders(meshes as never);
  const walk = estateWalk(estateGeometry());
  cache = { inputs: { occupancy: occ, heights: { N: SHADE.N, origin: SHADE.origin, cell: SHADE.extent / SHADE.N, lohi }, estateWalk: walk, walls: new CollisionWorld() }, meshes };
  return cache;
}
