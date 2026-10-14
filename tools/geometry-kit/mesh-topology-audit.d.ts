export interface TopologyIssue {
  code: string;
  message: string;
  count?: number;
}
export interface TopologyReport {
  ok: boolean;
  issues: TopologyIssue[];
  components: number;
  volume: number;
  [key: string]: unknown;
}
export interface TopologyOptions {
  closed?: boolean;
  maxComponents?: number;
  duplicateDistance?: number;
  degenerateArea?: number;
  checkOrientation?: boolean;
}
export function auditMeshData(meshData: { verts: number[][]; faces: number[][]; faceMat?: number[] | null; uvs?: unknown }, options?: TopologyOptions): TopologyReport;
export function assertMeshAudit(report: TopologyReport, label?: string): void;
