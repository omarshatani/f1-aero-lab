import { AeroPartData, CageV2, PartId, SurfaceVizMode } from '../types/aero';
import { evaluateAllSurfaces, evaluatePartSurface } from './PatchEvaluator';
import {
  EvaluatedPartSurface,
  SurfaceWorkerRequest,
  SurfaceWorkerResponse,
} from './surfaceTypes';

export type LODStatus = 'idle' | 'preview_active' | 'tessellating_full' | 'full_ready';
export type LODStatusListener = (status: LODStatus, durationMs?: number) => void;

export class LODManager {
  private worker: Worker | null = null;
  private requestIdCounter = 0;
  private pendingRequests = new Map<
    number,
    (surfaces: Partial<Record<PartId, EvaluatedPartSurface>>) => void
  >();
  private statusListeners = new Set<LODStatusListener>();
  private currentStatus: LODStatus = 'idle';

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./surfaceWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<SurfaceWorkerResponse>) => {
          this.handleWorkerResponse(event.data);
        };
        this.worker.onerror = (err) => {
          console.warn('[LODManager] WebWorker error, falling back to main thread:', err);
          this.worker = null;
        };
      } catch (e) {
        console.warn('[LODManager] WebWorker initialization failed, fallback active:', e);
        this.worker = null;
      }
    }
  }

  public subscribeStatus(listener: LODStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: LODStatus, durationMs?: number): void {
    this.currentStatus = status;
    for (const fn of this.statusListeners) {
      fn(status, durationMs);
    }
  }

  public getStatus(): LODStatus {
    return this.currentStatus;
  }

  /**
   * Immediately evaluates a lightweight preview surface on the main thread (< 1 ms).
   * Called on pointer-move during gizmo dragging.
   */
  public evaluatePreviewPart(
    part: AeroPartData,
    vizMode: SurfaceVizMode = 'carbon'
  ): EvaluatedPartSurface {
    this.setStatus('preview_active');
    return evaluatePartSurface(part, 'preview', vizMode);
  }

  /**
   * Immediately evaluates all 11 preview surfaces on the main thread (< 10 ms).
   */
  public evaluatePreviewAll(
    parts: Record<PartId, AeroPartData>,
    vizMode: SurfaceVizMode = 'carbon'
  ): Record<PartId, EvaluatedPartSurface> {
    this.setStatus('preview_active');
    return evaluateAllSurfaces(parts, 'preview', vizMode);
  }

  /**
   * Dispatches a high-resolution (~1M triangles) regeneration request to the WebWorker.
   * Resolves with the transferable evaluated surfaces on completion.
   */
  public requestFullLOD(
    parts: Record<PartId, AeroPartData>,
    vizMode: SurfaceVizMode = 'carbon'
  ): Promise<Partial<Record<PartId, EvaluatedPartSurface>>> {
    const requestId = ++this.requestIdCounter;
    this.setStatus('tessellating_full');

    const cages: Partial<Record<PartId, CageV2>> = {};
    for (const key of Object.keys(parts) as PartId[]) {
      if (parts[key].cage) {
        cages[key] = parts[key].cage;
      }
    }

    if (this.worker) {
      return new Promise((resolve) => {
        this.pendingRequests.set(requestId, resolve);
        const req: SurfaceWorkerRequest = {
          type: 'tessellate_all',
          requestId,
          lod: 'full',
          cages,
          vizMode,
        };
        this.worker!.postMessage(req);
      });
    }

    // Fallback if WebWorker unavailable (e.g. Node tests / SSR)
    const startTime = performance.now();
    const evaluated = evaluateAllSurfaces(parts, 'full', vizMode);
    const durationMs = performance.now() - startTime;
    this.setStatus('full_ready', durationMs);
    return Promise.resolve(evaluated);
  }

  private handleWorkerResponse(res: SurfaceWorkerResponse): void {
    const resolver = this.pendingRequests.get(res.requestId);
    if (resolver) {
      this.pendingRequests.delete(res.requestId);
      this.setStatus('full_ready', res.durationMs);
      resolver(res.surfaces);
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.statusListeners.clear();
  }
}
