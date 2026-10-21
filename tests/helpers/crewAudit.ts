/**
 * Auditing a posed rig (docs/crew.md): every part placed by forward kinematics into one assembly,
 * then the geometry kit's audit (coplanar overlap, defects, clashes). Parts of one segment may seat
 * into each other (they are one rigid assembly); a seat across segments is declared per rig.
 */
import { Group, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { auditGeometry, type GeometryAuditReport } from '../../tools/geometry-kit/geometry-audit.js';
import { auditMeshData } from '../../tools/geometry-kit/mesh-topology-audit.js';
import { emitParts } from '../../src/geometry/polyMesh';
import { Pose, solveFK, type RigDef } from '../../src/crew/rig';
import { moved } from '../../src/crew/kit/shapes';
import { CREW_SLOTS } from '../../src/crew/materials';

export function topology(rig: RigDef): string[] {
  const bad: string[] = [];
  for (const s of rig.segments) {
    for (const p of s.parts) {
      // A `set:` part is several closed components (a clevis's two cheeks).
      const r = auditMeshData(p.mesh, { maxComponents: p.name.startsWith('set:') ? 24 : 1 });
      if (!r.ok) bad.push(`${s.name}:${p.name}: ${r.issues.map((i) => i.code + (i.count !== undefined ? `×${i.count}` : '')).join(', ')}`);
    }
  }
  return bad;
}

/** The rig posed (FK from `pose`, root at identity) as one group of named meshes. */
export function posed(rig: RigDef, pose: Pose = new Pose(rig.segments.length), root = new Matrix4()): Group {
  const world = rig.segments.map(() => new Matrix4());
  solveFK(rig, root, pose, world);
  const g = new Group();
  const mat = Array.from({ length: CREW_SLOTS }, () => new MeshBasicMaterial());
  rig.segments.forEach((s, i) => {
    for (const p of s.parts) {
      const local = moved(p.mesh, [-s.pivot[0], -s.pivot[1], -s.pivot[2]]);
      const m = new Mesh(emitParts([local], { slots: CREW_SLOTS }), mat);
      m.name = `${s.name}:${p.name}`;
      m.matrixAutoUpdate = false;
      m.matrix.copy(world[i]);
      g.add(m);
    }
  });
  g.updateMatrixWorld(true);
  return g;
}

/** Same-segment seats, plus the rig's declared cross-segment ones. */
export function crewAllow(rig: RigDef, extra: [string, string][]): [string, string][] {
  return [...rig.segments.map((s) => [`${s.name}:`, `${s.name}:`] as [string, string]), ...extra];
}

export function audit(rig: RigDef, pose: Pose | undefined, allow: [string, string][]): GeometryAuditReport {
  return auditGeometry(posed(rig, pose), { clashAllow: crewAllow(rig, allow), clashDepth: 0.0015, clashCellSize: 0.03, maxTriangles: 2_000_000, top: 30 });
}
