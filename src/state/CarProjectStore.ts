import { runCFDSimulation } from '../cfd/CFDSolver';
import {
  applyParametricOffsetsToGrid,
  clampPointToLegalityBoxes,
  cloneGrid,
  cloneProceduralElements,
  createBaselineParts,
  createPresetGrids,
  DEFAULT_WHEEL_STANCE,
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
  PartCategory,
  PartId,
  ProceduralElementConfig,
  SculptSelectMode,
  SurfaceVizMode,
  TunnelSettings,
  Vec3,
  WheelStanceSettings,
} from '../types/aero';

type Listener = () => void;

export interface MeshCFDData {
  panels: Partial<Record<PartId, MacroAeroPanel[]>>;
  legalityPts: Partial<Record<PartId, Vec3[]>>;
}

interface UndoEntry {
  grids: Record<PartId, Vec3[][]>;
  paramValues: Record<PartId, Record<string, number>>;
  proceduralElements: Record<PartId, ProceduralElementConfig[]>;
  wheelStance: WheelStanceSettings;
}

export class CarProjectStore {
  public carModelId: CarModelId = 'fia_2026_concept';
  public modelLoading = {
    active: true,
    pct: 0,
    label: 'Initializing Official FIA 2026 CAD Model...',
  };

  public parts: Record<PartId, AeroPartData> = createBaselineParts();
  /** Unmodified manual base grids before parametric slider macro offsets */
  private baseGrids: Record<PartId, Vec3[][]>;

  public activeCategory: 'all' | PartCategory = 'all';
  public activePartId: PartId = 'front_wing';
  public activeSubZoneId = 'all';
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

  public wheelStance: WheelStanceSettings = { ...DEFAULT_WHEEL_STANCE };

  public tunnelSettings: TunnelSettings = {
    windSpeedKmh: 250,
    frontRideHeightMm: 0,
    rearRideHeightMm: 0,
    yawAngleDeg: 0,
    activeAeroMode: 'z_mode',
    wheelStance: { ...DEFAULT_WHEEL_STANCE },
  };

  public cfdResult: CFDResult;
  public baselineSnapshot: CarDesignSnapshot;

  private meshDataProvider: (() => MeshCFDData | null) | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.baseGrids = this.cloneAllGrids();
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

  private captureUndoEntry(): UndoEntry {
    const paramValues = {} as Record<PartId, Record<string, number>>;
    const proceduralElements = {} as Record<PartId, ProceduralElementConfig[]>;
    for (const id of PART_ORDER) {
      paramValues[id] = { ...this.parts[id].paramValues };
      proceduralElements[id] = cloneProceduralElements(this.parts[id].proceduralElements);
    }
    return {
      grids: this.cloneAllGrids(),
      paramValues,
      proceduralElements,
      wheelStance: { ...this.wheelStance },
    };
  }

  private restoreUndoEntry(entry: UndoEntry): void {
    for (const id of PART_ORDER) {
      this.parts[id].grid = cloneGrid(entry.grids[id]);
      this.baseGrids[id] = cloneGrid(entry.grids[id]);
      this.parts[id].paramValues = { ...entry.paramValues[id] };
      this.parts[id].proceduralElements = cloneProceduralElements(entry.proceduralElements[id]);
    }
    this.wheelStance = { ...entry.wheelStance };
    this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
  }

  public pushUndoCheckpoint(): void {
    this.undoStack.push(this.captureUndoEntry());
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
    this.redoStack.push(this.captureUndoEntry());
    this.restoreUndoEntry(prev);
    this.runCFD();
    this.emit();
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.captureUndoEntry());
    this.restoreUndoEntry(next);
    this.runCFD();
    this.emit();
  }

  public getActivePart(): AeroPartData {
    return this.parts[this.activePartId];
  }

  public setActiveCategory(cat: 'all' | PartCategory): void {
    this.activeCategory = cat;
    if (cat !== 'all' && this.parts[this.activePartId].category !== cat) {
      const firstMatch = PART_ORDER.find((id) => this.parts[id].category === cat);
      if (firstMatch) {
        this.setActivePart(firstMatch);
        return;
      }
    }
    this.emit();
  }

  public setActivePart(partId: PartId): void {
    if (this.activePartId === partId) return;
    this.activePartId = partId;
    this.activeSubZoneId = 'all';
    if (this.selectMode === 'sub_zone') {
      this.selectMode = 'node';
    }
    const p = this.parts[partId];
    this.selectedNode = {
      u: Math.min(p.cols - 1, Math.floor(p.cols / 2)),
      v: p.rows - 1,
    };
    this.emit();
  }

  public setActiveSubZone(zoneId: string): void {
    this.activeSubZoneId = zoneId;
    const p = this.getActivePart();
    if (zoneId === 'all') {
      if (this.selectMode === 'sub_zone') {
        this.selectMode = 'node';
      }
    } else {
      const z = p.subZones.find((s) => s.id === zoneId);
      if (z && z.uIndices.length > 0 && z.vIndices.length > 0) {
        this.selectedNode = {
          u: z.uIndices[Math.floor(z.uIndices.length / 2)],
          v: z.vIndices[Math.floor(z.vIndices.length / 2)],
        };
        this.selectMode = 'sub_zone';
      }
    }
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

  public setPartParamValue(partId: PartId, paramId: string, value: number): void {
    const part = this.parts[partId];
    part.paramValues[paramId] = value;
    part.grid = applyParametricOffsetsToGrid(
      this.baseGrids[partId],
      part,
      part.paramValues,
      this.clampToFiaBox
    );
    this.runCFD();
    this.emit();
  }

  public syncBaseGridFromCurrent(partId: PartId): void {
    this.baseGrids[partId] = cloneGrid(this.parts[partId].grid);
    for (const s of this.parts[partId].paramSliders) {
      this.parts[partId].paramValues[s.id] = s.defaultValue;
    }
  }

  public setProceduralElementConfig(
    partId: PartId,
    elementId: string,
    patch: Partial<ProceduralElementConfig>
  ): void {
    const part = this.parts[partId];
    const idx = part.proceduralElements.findIndex((el) => el.id === elementId);
    if (idx < 0) return;
    part.proceduralElements[idx] = { ...part.proceduralElements[idx], ...patch };
    this.runCFD();
    this.emit();
  }

  public updateWheelStance(patch: Partial<WheelStanceSettings>): void {
    this.wheelStance = { ...this.wheelStance, ...patch };
    this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
    this.runCFD();
    this.emit();
  }

  public resetWheelStance(): void {
    this.updateWheelStance({ ...DEFAULT_WHEEL_STANCE });
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
    this.baseGrids[partId] = cloneGrid(part.grid);
  }

  public resetActivePartToBaseline(): void {
    this.pushUndoCheckpoint();
    const defaults = createBaselineParts();
    const defPart = defaults[this.activePartId];
    this.parts[this.activePartId].grid = cloneGrid(defPart.grid);
    this.baseGrids[this.activePartId] = cloneGrid(defPart.grid);
    this.parts[this.activePartId].paramValues = { ...defPart.paramValues };
    this.parts[this.activePartId].proceduralElements = cloneProceduralElements(
      defPart.proceduralElements
    );
    this.runCFD();
    this.emit();
  }

  public applyConceptPreset(preset: 'baseline' | 'high_downforce' | 'low_drag'): void {
    this.pushUndoCheckpoint();
    const grids = createPresetGrids(preset);
    const defaults = createBaselineParts();
    for (const id of PART_ORDER) {
      this.parts[id].grid = grids[id];
      this.baseGrids[id] = cloneGrid(grids[id]);
      this.parts[id].paramValues = { ...defaults[id].paramValues };
      if (preset === 'baseline') {
        this.parts[id].proceduralElements = cloneProceduralElements(
          defaults[id].proceduralElements
        );
      }
    }
    if (preset === 'baseline') {
      this.wheelStance = { ...DEFAULT_WHEEL_STANCE };
      this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
    }
    this.runCFD();
    this.emit();
  }

  public updateTunnelSettings(patch: Partial<TunnelSettings>): void {
    this.tunnelSettings = {
      ...this.tunnelSettings,
      ...patch,
      wheelStance: patch.wheelStance ? { ...patch.wheelStance } : { ...this.wheelStance },
    };
    if (patch.wheelStance) {
      this.wheelStance = { ...patch.wheelStance };
    }
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
    const paramValues = {} as Record<PartId, Record<string, number>>;
    const proceduralElements = {} as Record<PartId, ProceduralElementConfig[]>;
    for (const id of PART_ORDER) {
      paramValues[id] = { ...this.parts[id].paramValues };
      proceduralElements[id] = cloneProceduralElements(this.parts[id].proceduralElements);
    }
    return {
      name,
      createdAt: Date.now(),
      carModelId: this.carModelId,
      parts: this.cloneAllGrids(),
      paramValues,
      proceduralElements,
      wheelStance: { ...this.wheelStance },
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
          this.baseGrids[id] = cloneGrid(incoming);
        }
        if (parsed.paramValues?.[id]) {
          part.paramValues = { ...part.paramValues, ...parsed.paramValues[id] };
        }
        if (Array.isArray(parsed.proceduralElements?.[id])) {
          part.proceduralElements = cloneProceduralElements(parsed.proceduralElements[id]!);
        }
      }
      if (parsed.wheelStance) {
        this.wheelStance = { ...DEFAULT_WHEEL_STANCE, ...parsed.wheelStance };
        this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
      }
      this.runCFD();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }
}
