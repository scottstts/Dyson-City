/**
 * The ship as the review tool shows it (tools/ship-shots/shots.mjs): every part, the moving ones
 * posed t seconds into scene 3's opening (door, then stair) with the gear down, or (t < 0) with
 * the gear |t| of the way up.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import type { PolyMesh, Vec3 } from '../../src/geometry/polyMesh';
import { buildShipParts } from '../../src/intro/ship/ship';
import { buildDoorLeaf, doorOffset, DOOR_TIME } from '../../src/intro/ship/door';
import { buildFlight, buildHandrail, buildStanchion, buildTread, HANDRAIL, STANCHIONS, stairPose, stairState, stanchionTurn, TREADS } from '../../src/intro/ship/stair';
import { buildLeg, LEGS, poseLeg, COMPRESSION } from '../../src/intro/ship/gear';

function moved(m: PolyMesh, mat: Matrix4): PolyMesh {
  const v = new Vector3();
  const out = { ...m, verts: m.verts.map((p) => v.set(p[0], p[1], p[2]).applyMatrix4(mat).toArray() as Vec3) } as PolyMesh;
  Object.setPrototypeOf(out, Object.getPrototypeOf(m));
  return out;
}

export function reviewShip(t: number): PolyMesh[] {
  const out = buildShipParts().list.map((p) => p.mesh);
  const door = doorOffset(Math.max(Math.min(t, DOOR_TIME), 0));
  for (const m of buildDoorLeaf()) out.push(moved(m, new Matrix4().makeTranslation(...door.offset)));
  const st = stairState(Math.max(t - DOOR_TIME + 0.5, 0));
  if (t > 0) {
    const flight = stairPose(st.run, st.pitch);
    for (const m of buildFlight()) out.push(moved(m, flight));
    for (const y of TREADS) for (const m of buildTread()) out.push(moved(m, flight.clone().multiply(new Matrix4().makeRotationX(st.pitch).setPosition(0, y, 0))));
    const turn = stanchionTurn(st.pitch);
    for (const p of STANCHIONS) out.push(moved(buildStanchion(), flight.clone().multiply(new Matrix4().makeRotationX(turn).setPosition(p[0], p[1], p[2]))));
    for (const x of [HANDRAIL.x, -HANDRAIL.x]) out.push(moved(buildHandrail(), flight.clone().multiply(new Matrix4().makeTranslation(x, -HANDRAIL.height * Math.sin(turn), HANDRAIL.height * Math.cos(turn)))));
  }
  for (const l of LEGS) {
    const p = buildLeg(l);
    const q = poseLeg(l, t < 0 ? 1 + t : 1, t < 0 ? 0 : COMPRESSION);
    for (const k of ['strut', 'arm', 'foot'] as const) for (const m of p[k]) out.push(moved(m, q[k]));
    for (const k of ['shockBody', 'shockRod', 'actuatorBody', 'actuatorRod'] as const) out.push(moved(p[k], q[k]));
    out.push(moved(p.doors[0], q.doors[0]), moved(p.doors[1], q.doors[1]));
  }
  return out;
}
