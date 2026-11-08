import { runCFDSimulation } from '../cfd/CFDSolver';
import {
  clampPointToLegalityBoxes,
  cloneGrid,
  createBaselineParts,
  createPresetGrids,
  PART_ORDER,
} from '../regulations/fia2026';
import {
  AeroPartData,
  AppMode,
  CarDesignSnapshot,
  CarModelId,
  CFDResult,
  MacroAeroPanel,
  NodeIndex,
  PartId,
  SculptSelectMode,
  SurfaceVizMode,
  TunnelSettings,
  Vec3,
} from '../types/aero';

type Listener = () => void;

export interface MeshCFDData {
  panels: Partial<Record<PartId, MacroAeroPanel[]>>;
  legalityPts: Partial<Record<PartId, Vec3[]>>;
}

export class CarProjectStore {
  public carModelId: CarModelId = 'fia_2026_concept';
  public modelLoading = {
    active: true,
    pct: 0,
    label: 'Initializing Official FIA 2026 CAD Model...',
  };

  public parts: Record<PartId, AeroPartData> = createBaselineParts();
  public activePartId: PartId = 'front_wing';
  public selectedNode: NodeIndex = { u: 2, v: 3 };

  public appMode: AppMode = 'sculpt';
  public selectMode: SculptSelectMode = 'node';
  public gizmoMode: 'translate' | 'rotate' = 'translate';
  public softFalloffRadius = 0.24;
  public clampToFiaBox = true;
  public ghostOtherParts = false;
  public showFiaBox = true;

  public surfaceVizMode: SurfaceVizMode = 'carbon';
  public autoUpdateCfdInSculpt = true;

  public tunnelSettings: TunnelSettings = {
    windSpeedKmh: 250,
    frontRideHeightMm: 0,
    rearRideHeightMm: 0,
    yawAngleDeg: 0,
    activeAeroMode: 'z_mode',
  };

  public cfdResult: CFDResult;
  public baselineSnapshot: CarDesignSnapshot;

  private meshDataProvider: (() => MeshCFDData | null) | null = null;
  private undoStack: Array<Record<PartId, Vec3[][]>> = [];
  private redoStack: Array<Record<PartId, Vec3[][]>> = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.cfdResult = runCFDSimulation(this.parts, this.tunnelSettings);
    this.baselineSnapshot = this.captureSnapshot('FIA 2026 Baseline Spec');
  }

  public setMeshCFDDataProvider(provider: () => MeshCFDData | null): void {
    this.meshDataProvider = provider;
  }

  public setModelLoading(active: boolean, pct = 100, label = ''): void {
    this.modelLoading = { active, pct, label };
    this.emit();
  }

  public setCarModelId(modelId: CarModelId): void {
    if (this.carModelId === modelId) return;
    this.carModelId = modelId;
    this.emit();
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public emit(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  private cloneAllGrids(): Record<PartId, Vec3[][]> {
    const res = {} as Record<PartId, Vec3[][]>;
    for (const id of PART_ORDER) {
      res[id] = cloneGrid(this.parts[id].grid);
    }
    return res;
  }

  public pushUndoCheckpoint(): void {
    this.undoStack.push(this.cloneAllGrids());
    if (this.undoStack.length > 40) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.cloneAllGrids());
    for (const id of PART_ORDER) {
      this.parts[id].grid = prev[id];
    }
    this.runCFD();
    this.emit();
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.cloneAllGrids());
    for (const id of PART_ORDER) {
      this.parts[id].grid = next[id];
    }
    this.runCFD();
    this.emit();
  }

  public getActivePart(): AeroPartData {
    return this.parts[this.activePartId];
  }

  public setActivePart(partId: PartId): void {
    if (this.activePartId === partId) return;
    this.activePartId = partId;
    const p = this.parts[partId];
    this.selectedNode = {
      u: Math.min(p.cols - 1, Math.floor(p.cols / 2)),
      v: p.rows - 1,
    };
    this.emit();
  }

  public setSelectedNode(node: NodeIndex): void {
    const p = this.getActivePart();
    this.selectedNode = {
      u: Math.max(0, Math.min(p.cols - 1, node.u)),
      v: Math.max(0, Math.min(p.rows - 1, node.v)),
    };
    this.emit();
  }

  public setAppMode(mode: AppMode): void {
    this.appMode = mode;
    if (mode === 'cfd') {
      if (this.surfaceVizMode === 'carbon') {
        this.surfaceVizMode = 'cp';
      }
      this.runCFD();
    } else {
      if (this.surfaceVizMode === 'cp') {
        this.surfaceVizMode = 'carbon';
      }
    }
    this.emit();
  }

  public setClampToFiaBox(clamp: boolean): void {
    this.clampToFiaBox = clamp;
    if (clamp) {
      this.pushUndoCheckpoint();
      this.clampPartToLegality(this.activePartId);
      this.runCFD();
    }
    this.emit();
  }

  public clampPartToLegality(partId: PartId): void {
    const part = this.parts[partId];
    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        part.grid[u][v] = clampPointToLegalityBoxes(
          part.grid[u][v],
          part.legalityBoxes,
          part.centerlineLocked && u === 0
        );
      }
    }
  }

  public resetActivePartToBaseline(): void {
    this.pushUndoCheckpoint();
    const defaults = createBaselineParts();
    this.parts[this.activePartId].grid = cloneGrid(defaults[this.activePartId].grid);
    this.runCFD();
    this.emit();
  }

  public applyConceptPreset(preset: 'baseline' | 'high_downforce' | 'low_drag'): void {
    this.pushUndoCheckpoint();
    const grids = createPresetGrids(preset);
    for (const id of PART_ORDER) {
      this.parts[id].grid = grids[id];
    }
    this.runCFD();
    this.emit();
  }

  public updateTunnelSettings(patch: Partial<TunnelSettings>): void {
    this.tunnelSettings = { ...this.tunnelSettings, ...patch };
    this.runCFD();
    this.emit();
  }

  public runCFD(): void {
    const meshData = this.meshDataProvider ? this.meshDataProvider() : null;
    this.cfdResult = runCFDSimulation(
      this.parts,
      this.tunnelSettings,
      meshData?.panels,
      meshData?.legalityPts
    );
  }

  public captureSnapshot(name: string): CarDesignSnapshot {
    return {
      name,
      createdAt: Date.now(),
      carModelId: this.carModelId,
      parts: this.cloneAllGrids(),
      summary: {
        cl: this.cfdResult.cl,
        cd: this.cfdResult.cd,
        ldRatio: this.cfdResult.ldRatio,
        copFrontPct: this.cfdResult.copFrontPct,
        downforceN: this.cfdResult.totalDownforceN,
        dragN: this.cfdResult.totalDragN,
      },
    };
  }

  public setCurrentAsBaseline(name = 'Pinned Wind-Tunnel Ref'): void {
    this.baselineSnapshot = this.captureSnapshot(name);
    this.emit();
  }

  public exportDesignJson(): string {
    return JSON.stringify(this.captureSnapshot('Custom 2026 F1 Aero Package'), null, 2);
  }

  public importDesignJson(rawJson: string): boolean {
    try {
      const parsed = JSON.parse(rawJson) as CarDesignSnapshot;
      if (!parsed || !parsed.parts) return false;
      this.pushUndoCheckpoint();
      if (
        parsed.carModelId === 'fia_2026_concept' ||
        parsed.carModelId === 'ferrari_sf26'
      ) {
        this.carModelId = parsed.carModelId;
      }
      for (const id of PART_ORDER) {
        const incoming = parsed.parts[id];
        const part = this.parts[id];
        if (
          Array.isArray(incoming) &&
          incoming.length === part.cols &&
          Array.isArray(incoming[0]) &&
          incoming[0].length === part.rows
        ) {
          part.grid = cloneGrid(incoming);
        }
      }
      this.runCFD();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }
}
