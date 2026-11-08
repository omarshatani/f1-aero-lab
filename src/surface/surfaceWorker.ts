import { createBaselineParts, PART_ORDER } from '../regulations/fia2026';
import { PartId } from '../types/aero';
import { evaluatePartSurface } from './PatchEvaluator';
import {
  EvaluatedPartSurface,
  SurfaceWorkerRequest,
  SurfaceWorkerResponse,
} from './surfaceTypes';

// Pre-create baseline parts template for role/thickness/accent attributes
const templateParts = createBaselineParts();

interface WorkerScope {
  onmessage: ((event: MessageEvent<SurfaceWorkerRequest>) => void) | null;
  postMessage: (message: SurfaceWorkerResponse, transfer?: Transferable[]) => void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event: MessageEvent<SurfaceWorkerRequest>) => {
  const req = event.data;
  const startTime = performance.now();
  const surfaces: Partial<Record<PartId, EvaluatedPartSurface>> = {};
  const transferables: Transferable[] = [];

  const targetPartIds: PartId[] =
    req.type === 'tessellate_part' && req.partId ? [req.partId] : PART_ORDER;

  for (const partId of targetPartIds) {
    let partData = req.parts?.[partId];
    if (!partData) {
      partData = { ...templateParts[partId] };
      if (req.cages?.[partId]) {
        partData.cage = req.cages[partId];
        partData.grid = req.cages[partId]!.macro;
      }
    }

    const surface = evaluatePartSurface(partData, req.lod, req.vizMode);
    surfaces[partId] = surface;

    transferables.push(
      surface.positions.buffer as Transferable,
      surface.normals.buffer as Transferable,
      surface.colors.buffer as Transferable,
      surface.indices.buffer as Transferable
    );
  }

  const durationMs = performance.now() - startTime;
  const response: SurfaceWorkerResponse = {
    type: 'tessellation_complete',
    requestId: req.requestId,
    lod: req.lod,
    surfaces,
    durationMs,
  };

  ctx.postMessage(response, transferables);
};
