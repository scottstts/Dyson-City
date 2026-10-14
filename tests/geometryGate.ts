/**
 * Shared geometry gate for procedural parts: per-part polygon topology (closed, outward, one
 * component, no loose/duplicate vertices) and a world-space audit of the named assembly for
 * coplanar overlap and solid clashes (tools/geometry-kit).
 */
import { Group, Mesh, MeshBasicMaterial } from 'three';
import { auditMeshData, type TopologyReport } from '../tools/geometry-kit/mesh-topology-audit.js';
import { auditGeometry, type GeometryAuditReport } from '../tools/geometry-kit/geometry-audit.js';
import { emitParts, type PolyMesh } from '../src/geometry/polyMesh';

export interface NamedPart {
  name: string;
  mesh: PolyMesh;
}

export function topologyFailures(parts: NamedPart[], options: Parameters<typeof auditMeshData>[1] = {}): { name: string; report: TopologyReport }[] {
  const out: { name: string; report: TopologyReport }[] = [];
  for (const p of parts) {
    const report = auditMeshData(p.mesh, options);
    if (!report.ok) out.push({ name: p.name, report });
  }
  return out;
}

export function assemblyAudit(parts: NamedPart[], slots: number, clashAllow: [string, string][] = [], extra: Mesh[] = []): GeometryAuditReport {
  const root = new Group();
  const mats = Array.from({ length: slots }, () => new MeshBasicMaterial());
  for (const p of parts) {
    const m = new Mesh(emitParts([p.mesh], { slots }), mats);
    m.name = p.name;
    root.add(m);
  }
  for (const m of extra) root.add(m);
  root.updateMatrixWorld(true);
  return auditGeometry(root, { clashAllow, maxTriangles: 4_000_000, top: 40 });
}

export function describeTopology(f: { name: string; report: TopologyReport }[]): string {
  return f
    .slice(0, 12)
    .map((x) => `${x.name}: ${x.report.issues.map((i) => i.code + (i.count !== undefined ? `×${i.count}` : '')).join(', ')}`)
    .join('\n');
}

/**
 * The world-space audit on a large assembly, run per plan tile (parts go to every tile their
 * bounds touch, so pairs straddling a tile edge are still compared): the coplanar pass keeps a map
 * of plane cells that overflows on a few million triangles at once.
 */
export function assemblyAuditTiled(parts: NamedPart[], slots: number, clashAllow: [string, string][] = [], tile = 260): GeometryAuditReport {
  const bounds = parts.map((p) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of p.mesh.verts) {
      x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
      z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]);
    }
    return [x0, x1, z0, z1];
  });
  const tiles = new Map<string, NamedPart[]>();
  parts.forEach((p, i) => {
    const [x0, x1, z0, z1] = bounds[i];
    for (let tx = Math.floor(x0 / tile); tx <= Math.floor(x1 / tile); tx++) {
      for (let tz = Math.floor(z0 / tile); tz <= Math.floor(z1 / tile); tz++) {
        const k = `${tx}:${tz}`;
        if (!tiles.has(k)) tiles.set(k, []);
        tiles.get(k)!.push(p);
      }
    }
  });
  const merged: GeometryAuditReport = { ms: 0, meshes: 0, triangles: 0, compared: 0, truncated: false, zfight: [], zfightTotalCm2: 0, backToBack: 0, defects: [], noMaterial: [], clash: [] };
  const seen = new Set<string>();
  for (const group of tiles.values()) {
    const r = assemblyAudit(group, slots, clashAllow);
    merged.ms += r.ms;
    merged.triangles += r.triangles;
    merged.truncated ||= r.truncated;
    for (const z of r.zfight) {
      const k = `z${z.a}|${z.b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.zfight.push(z);
    }
    for (const c of r.clash) {
      const k = `c${c.a}|${c.b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.clash.push(c);
    }
    merged.defects.push(...r.defects);
    merged.noMaterial.push(...r.noMaterial);
  }
  return merged;
}
