import { CageV2, PartId, SurfaceVizMode } from '../types/aero';

export type LODLevel = 'preview' | 'full';

export interface SurfaceTessellationConfig {
  lod: LODLevel;
  /** Number of quad segments along u and v */
  uSegments: number;
  vSegments: number;
  computeNormals: boolean;
  computeTangents: boolean;
}

export interface EvaluatedPartSurface {
  partId: PartId;
  lod: LODLevel;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface SurfaceWorkerRequest {
  type: 'tessellate_all' | 'tessellate_part';
  requestId: number;
  lod: LODLevel;
  cages: Partial<Record<PartId, CageV2>>;
  vizMode?: SurfaceVizMode;
}

export interface SurfaceWorkerResponse {
  type: 'tessellation_complete';
  requestId: number;
  lod: LODLevel;
  surfaces: Partial<Record<PartId, EvaluatedPartSurface>>;
  durationMs: number;
}
