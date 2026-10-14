import type { Object3D } from 'three';
export interface GeometryAuditReport {
  ms: number;
  meshes: number;
  triangles: number;
  compared: number;
  truncated: boolean;
  zfight: { a: string; b: string; areaCm2: number; [key: string]: unknown }[];
  zfightTotalCm2: number;
  backToBack: number;
  defects: Record<string, unknown>[];
  noMaterial: string[];
  clash: { a: string; b: string; crossings: number; [key: string]: unknown }[];
}
export interface GeometryAuditOptions {
  clash?: boolean;
  clashAllow?: [string, string][];
  maxTriangles?: number;
  top?: number;
  includeInstanced?: boolean;
  bounds?: { centerX: number; centerZ: number; radius: number } | null;
  skip?: (mesh: Object3D, name: string) => boolean;
  [key: string]: unknown;
}
export function auditGeometry(root: Object3D, opts?: GeometryAuditOptions): GeometryAuditReport;
export function logAuditReport(report: GeometryAuditReport): GeometryAuditReport;
