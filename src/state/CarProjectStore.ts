import { runCFDSimulation } from '../cfd/CFDSolver';
import {
  applyParametricOffsetsToGrid,
  clampPointToLegalityBoxes,
  cloneCageV2,
  cloneGrid,
  cloneProceduralElements,
  createBaselineParts,
  createCageV2,
  createPresetGrids,
  DEFAULT_FIXTURES,
  DEFAULT_WHEEL_STANCE,
  FITTED_CAGES_V2,
  interpolateMacroToDetail,
  PART_ORDER,
  syncSharedSeamNodes,
} from '../regulations/fia2026';
import {
  AeroPartData,
  AppMode,
  CageV2,
  CarDesignSnapshot,
  CarDesignSnapshotAny,
  CarDesignSnapshotV2,
  CarModelId,
  CFDResult,
  FixtureId,
  MacroAeroPanel,
  NodeIndex,
  PartCategory,
  PartId,
  ProceduralElementConfig,
  SculptHandleLevel,
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
  cages: Record<PartId, CageV2>;
  enabledParts: Record<PartId, boolean>;
  paramValues: Record<PartId, Record<string, number>>;
  proceduralElements: Record<PartId, ProceduralElementConfig[]>;
  wheelStance: WheelStanceSettings;
  fixtures: Record<FixtureId, boolean>;
}

export class CarProjectStore {
  public carModelId: CarModelId = 'fia_2026_concept';
  public modelLoading = {
    active: false,
    pct: 100,
    label: '',
  };

  public parts: Record<PartId, AeroPartData> = createBaselineParts();
  /** Unmodified manual base grids before parametric slider macro offsets */
  private baseGrids: Record<PartId, Vec3[][]>;

  public activeCategory: 'all' | PartCategory = 'all';
  public activePartId: PartId = 'front_wing';
  public activeSubZoneId = 'all';
  public selectedNode: NodeIndex = { u: 2, v: 3 };
  public activeHandleLevel: SculptHandleLevel = 'detail';

  public fixtures: Record<FixtureId, boolean> = (() => {
    const res = {} as Record<FixtureId, boolean>;
    for (const f of DEFAULT_FIXTURES) {
      res[f.id] = f.visible;
    }
    return res;
  })();

  public migrationToast: string | null = null;

  public appMode: AppMode = 'sculpt';
  public selectMode: SculptSelectMode = 'node';
  public gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  public softFalloffRadius = 0.0;
  public clampToFiaBox = false;
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
  public baselineSnapshot: CarDesignSnapshotAny;

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

  public getActiveHandleLevel(): SculptHandleLevel {
    return this.activeHandleLevel;
  }

  public setActiveHandleLevel(level: SculptHandleLevel): void {
    if (this.activeHandleLevel === level) return;
    this.activeHandleLevel = level;
    this.emit();
  }

  public setFixtureVisible(id: FixtureId, visible: boolean): void {
    this.fixtures[id] = visible;
    this.emit();
  }

  public clearMigrationToast(): void {
    this.migrationToast = null;
    this.emit();
  }

  private cloneAllGrids(): Record<PartId, Vec3[][]> {
    const res = {} as Record<PartId, Vec3[][]>;
    for (const id of PART_ORDER) {
      res[id] = cloneGrid(this.parts[id].grid);
    }
    return res;
  }

  private cloneAllCages(): Record<PartId, CageV2> {
    const res = {} as Record<PartId, CageV2>;
    for (const id of PART_ORDER) {
      if (this.parts[id].cage) {
        res[id] = cloneCageV2(this.parts[id].cage!);
      } else {
        res[id] = createCageV2(this.parts[id].grid, this.parts[id].centerlineLocked);
      }
    }
    return res;
  }

  private captureUndoEntry(): UndoEntry {
    const paramValues = {} as Record<PartId, Record<string, number>>;
    const proceduralElements = {} as Record<PartId, ProceduralElementConfig[]>;
    const enabledParts = {} as Record<PartId, boolean>;
    for (const id of PART_ORDER) {
      paramValues[id] = { ...this.parts[id].paramValues };
      proceduralElements[id] = cloneProceduralElements(this.parts[id].proceduralElements);
      enabledParts[id] = this.parts[id].enabled !== false;
    }
    return {
      grids: this.cloneAllGrids(),
      cages: this.cloneAllCages(),
      enabledParts,
      paramValues,
      proceduralElements,
      wheelStance: { ...this.wheelStance },
      fixtures: { ...this.fixtures },
    };
  }

  private restoreUndoEntry(entry: UndoEntry): void {
    for (const id of PART_ORDER) {
      this.parts[id].grid = cloneGrid(entry.grids[id]);
      this.baseGrids[id] = cloneGrid(entry.grids[id]);
      if (entry.cages && entry.cages[id]) {
        this.parts[id].cage = cloneCageV2(entry.cages[id]);
      } else {
        this.parts[id].cage = createCageV2(this.parts[id].grid, this.parts[id].centerlineLocked);
      }
      this.parts[id].enabled = entry.enabledParts ? entry.enabledParts[id] !== false : true;
      this.parts[id].paramValues = { ...entry.paramValues[id] };
      this.parts[id].proceduralElements = cloneProceduralElements(entry.proceduralElements[id]);
    }
    this.wheelStance = { ...entry.wheelStance };
    if (entry.fixtures) {
      this.fixtures = { ...entry.fixtures };
    }
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
    const cols = p.cage?.detailCols ?? p.cols;
    const rows = p.cage?.detailRows ?? p.rows;
    this.selectedNode = {
      u: Math.min(cols - 1, Math.floor(cols / 2)),
      v: rows - 1,
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
      const isDetail = Boolean(p.cage);
      const uList = z ? (isDetail && z.detailUIndices ? z.detailUIndices : z.uIndices.map((u) => (isDetail ? u * 3 : u))) : [];
      const vList = z ? (isDetail && z.detailVIndices ? z.detailVIndices : z.vIndices.map((v) => (isDetail ? v * 3 : v))) : [];
      if (uList.length > 0 && vList.length > 0) {
        this.selectedNode = {
          u: uList[Math.floor(uList.length / 2)],
          v: vList[Math.floor(vList.length / 2)],
        };
        this.selectMode = 'sub_zone';
      }
    }
    this.emit();
  }

  public setSelectedNode(node: NodeIndex): void {
    const p = this.getActivePart();
    const maxU = (p.cage?.detailCols ?? p.cols) - 1;
    const maxV = (p.cage?.detailRows ?? p.rows) - 1;
    this.selectedNode = {
      u: Math.max(0, Math.min(maxU, node.u)),
      v: Math.max(0, Math.min(maxV, node.v)),
    };
    this.emit();
  }

  public setPartEnabled(partId: PartId, enabled: boolean): void {
    const part = this.parts[partId];
    if (!part) return;
    if ((part.enabled !== false) === enabled) return;
    this.pushUndoCheckpoint();
    part.enabled = enabled;
    this.runCFD();
    this.emit();
  }

  public togglePartEnabled(partId: PartId): boolean {
    const part = this.parts[partId];
    const next = part ? part.enabled === false : true;
    this.setPartEnabled(partId, next);
    return next;
  }

  public setPartParamValue(partId: PartId, paramId: string, value: number): void {
    const part = this.parts[partId];
    part.paramValues[paramId] = value;
    const deformed = applyParametricOffsetsToGrid(
      this.baseGrids[partId],
      part,
      part.paramValues,
      this.clampToFiaBox
    );
    if (!part.cage) {
      part.cage = createCageV2(deformed, part.centerlineLocked);
    } else {
      part.cage.macro = cloneGrid(deformed);
      part.cage.detail = interpolateMacroToDetail(
        part.cage.macro,
        part.cage.detailCols,
        part.cage.detailRows,
        part.cage.detailOffsets,
        part.centerlineLocked
      );
    }
    part.grid = part.cage.macro;

    // Sync shared seam neighbors when parametric deformation shifts boundary nodes
    const allCages: Partial<Record<PartId, CageV2>> = {};
    for (const id of PART_ORDER) {
      if (this.parts[id].cage) allCages[id] = this.parts[id].cage;
    }
    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        syncSharedSeamNodes(partId, u, v, part.cage.macro[u][v], allCages, 'macro');
      }
    }
    for (const id of PART_ORDER) {
      const c = this.parts[id].cage;
      if (c && id !== partId) {
        this.parts[id].grid = c.macro;
      }
    }

    this.runCFD();
    this.emit();
  }

  public syncBaseGridFromCurrent(partId: PartId): void {
    this.baseGrids[partId] = cloneGrid(this.parts[partId].cage?.macro ?? this.parts[partId].grid);
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
    } else {
      this.emit();
    }
  }

  private getAllCagesMap(): Partial<Record<PartId, CageV2>> {
    const allCages: Partial<Record<PartId, CageV2>> = {};
    for (const id of PART_ORDER) {
      if (this.parts[id].cage) allCages[id] = this.parts[id].cage;
    }
    return allCages;
  }

  private syncMacroAndOffsetsFromDetail(partId: PartId): void {
    const part = this.parts[partId];
    const cage = part?.cage;
    if (!cage) return;
    for (let mu = 0; mu < cage.macroCols; mu++) {
      const du = mu * 3;
      if (!cage.detail[du]) continue;
      for (let mv = 0; mv < cage.macroRows; mv++) {
        const dv = mv * 3;
        if (cage.detail[du][dv]) {
          cage.macro[mu][mv] = { ...cage.detail[du][dv] };
        }
      }
    }
    const macroInterp = interpolateMacroToDetail(
      cage.macro,
      cage.detailCols,
      cage.detailRows,
      undefined,
      part.centerlineLocked
    );
    for (let u = 0; u < cage.detailCols; u++) {
      if (!cage.detailOffsets[u]) {
        cage.detailOffsets[u] = [];
      }
      for (let v = 0; v < cage.detailRows; v++) {
        const dPt = cage.detail[u]?.[v];
        const mPt = macroInterp[u]?.[v];
        if (dPt && mPt) {
          cage.detailOffsets[u][v] = {
            x: dPt.x - mPt.x,
            y: dPt.y - mPt.y,
            z: dPt.z - mPt.z,
          };
        }
      }
    }
    part.grid = cage.macro;
  }

  public updatePartGridNode(
    partId: PartId,
    u: number,
    v: number,
    position: Vec3,
    handleLevel: SculptHandleLevel = this.activeHandleLevel
  ): void {
    const part = this.parts[partId];
    const lockCenter = part.centerlineLocked && u === 0;

    let targetPos: Vec3 = {
      x: lockCenter ? 0 : Math.max(0, position.x),
      y: position.y,
      z: position.z,
    };

    if (this.clampToFiaBox) {
      targetPos = clampPointToLegalityBoxes(targetPos, part.legalityBoxes, lockCenter);
    }

    if (!part.cage) {
      part.cage = createCageV2(part.grid, part.centerlineLocked);
    }

    if (handleLevel === 'macro') {
      part.cage.macro[u][v] = { ...targetPos };
      part.grid[u][v] = { ...targetPos };
      this.baseGrids[partId][u][v] = { ...targetPos };

      // Propagate across shared seams
      const allCages = this.getAllCagesMap();
      syncSharedSeamNodes(partId, u, v, targetPos, allCages, 'macro');

      // Update grids and detail cages for all parts
      for (const id of PART_ORDER) {
        const c = this.parts[id].cage;
        if (c) {
          c.detail = interpolateMacroToDetail(
            c.macro,
            c.detailCols,
            c.detailRows,
            c.detailOffsets,
            this.parts[id].centerlineLocked
          );
          this.parts[id].grid = c.macro;
          this.baseGrids[id] = cloneGrid(c.macro);
        }
      }
    } else {
      if (part.cage.detail[u]?.[v]) {
        part.cage.detail[u][v] = { ...targetPos };
        const allCages = this.getAllCagesMap();
        syncSharedSeamNodes(partId, u, v, targetPos, allCages, 'detail');
        for (const id of PART_ORDER) {
          this.syncMacroAndOffsetsFromDetail(id);
        }
      }
    }

    if (this.autoUpdateCfdInSculpt) {
      this.runCFD();
    }
    this.emit();
  }

  public updatePartGridBatch(
    partId: PartId,
    newGrid: Vec3[][],
    handleLevel: SculptHandleLevel = this.activeHandleLevel,
    triggerCfd = this.autoUpdateCfdInSculpt
  ): void {
    const part = this.parts[partId];
    if (!part) return;
    if (!part.cage) {
      part.cage = createCageV2(part.grid, part.centerlineLocked);
    }

    const cols = newGrid.length;
    const rows = newGrid[0]?.length ?? 0;

    if (handleLevel === 'macro') {
      const allCages = this.getAllCagesMap();

      for (let u = 0; u < Math.min(cols, part.cols); u++) {
        for (let v = 0; v < Math.min(rows, part.rows); v++) {
          let targetPos = { ...newGrid[u][v] };
          if (part.centerlineLocked && u === 0) {
            targetPos.x = 0;
          } else {
            targetPos.x = Math.max(0.001, targetPos.x);
          }
          if (this.clampToFiaBox) {
            targetPos = clampPointToLegalityBoxes(
              targetPos,
              part.legalityBoxes,
              part.centerlineLocked && u === 0
            );
          }
          part.cage.macro[u][v] = targetPos;
          syncSharedSeamNodes(partId, u, v, targetPos, allCages, 'macro');
        }
      }

      for (const id of PART_ORDER) {
        const c = this.parts[id].cage;
        if (c) {
          c.detail = interpolateMacroToDetail(
            c.macro,
            c.detailCols,
            c.detailRows,
            c.detailOffsets,
            this.parts[id].centerlineLocked
          );
          this.parts[id].grid = c.macro;
          this.baseGrids[id] = cloneGrid(c.macro);
        }
      }
    } else {
      const allCages = this.getAllCagesMap();
      for (let u = 0; u < Math.min(cols, part.cage.detailCols); u++) {
        for (let v = 0; v < Math.min(rows, part.cage.detailRows); v++) {
          let targetPos = { ...newGrid[u][v] };
          const lockCenter = part.centerlineLocked && u === 0;
          if (lockCenter) {
            targetPos.x = 0;
          } else {
            targetPos.x = Math.max(0.001, targetPos.x);
          }
          if (this.clampToFiaBox) {
            targetPos = clampPointToLegalityBoxes(targetPos, part.legalityBoxes, lockCenter);
          }
          part.cage.detail[u][v] = targetPos;
          syncSharedSeamNodes(partId, u, v, targetPos, allCages, 'detail');
        }
      }
      for (const id of PART_ORDER) {
        this.syncMacroAndOffsetsFromDetail(id);
      }
    }

    if (triggerCfd) {
      this.runCFD();
    }
    this.emit();
  }

  public clampPartToLegality(partId: PartId): void {
    const part = this.parts[partId];
    if (!part) return;
    if (!part.cage) {
      part.cage = createCageV2(part.grid, part.centerlineLocked);
    }
    const allCages = this.getAllCagesMap();
    for (let u = 0; u < part.cage.detailCols; u++) {
      const lockCenter = part.centerlineLocked && u === 0;
      for (let v = 0; v < part.cage.detailRows; v++) {
        const clamped = clampPointToLegalityBoxes(
          part.cage.detail[u][v],
          part.legalityBoxes,
          lockCenter
        );
        part.cage.detail[u][v] = clamped;
        syncSharedSeamNodes(partId, u, v, clamped, allCages, 'detail');
      }
    }
    for (const id of PART_ORDER) {
      this.syncMacroAndOffsetsFromDetail(id);
    }
    this.baseGrids[partId] = cloneGrid(part.grid);
    this.runCFD();
    this.emit();
  }

  public resetActivePartToBaseline(): void {
    this.pushUndoCheckpoint();
    const defaults = createBaselineParts();
    const defPart = defaults[this.activePartId];
    this.parts[this.activePartId].enabled = true;
    this.parts[this.activePartId].grid = cloneGrid(defPart.grid);
    this.parts[this.activePartId].cage = cloneCageV2(FITTED_CAGES_V2[this.activePartId]);
    this.baseGrids[this.activePartId] = cloneGrid(defPart.grid);
    this.parts[this.activePartId].paramValues = { ...defPart.paramValues };
    this.parts[this.activePartId].proceduralElements = cloneProceduralElements(
      defPart.proceduralElements
    );
    this.runCFD();
    this.emit();
  }

  public resetCarToBaseline(): void {
    this.applyConceptPreset('baseline');
  }

  public applyConceptPreset(preset: 'baseline' | 'high_downforce' | 'low_drag'): void {
    this.pushUndoCheckpoint();
    const grids = createPresetGrids(preset);
    const defaults = createBaselineParts();
    for (const id of PART_ORDER) {
      if (preset === 'baseline') {
        this.parts[id].enabled = true;
      }
      this.parts[id].grid = grids[id];
      this.parts[id].cage = createCageV2(grids[id], this.parts[id].centerlineLocked);
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

  public captureSnapshot(name: string): CarDesignSnapshotV2 {
    const paramValues = {} as Record<PartId, Record<string, number>>;
    const proceduralElements = {} as Record<PartId, ProceduralElementConfig[]>;
    const cages = {} as Partial<Record<PartId, { macro: Vec3[][]; detailOffsets?: Vec3[][] }>>;
    const enabledParts = {} as Partial<Record<PartId, boolean>>;
    const partMetrics = {} as Partial<
      Record<PartId, { downforceN: number; dragN: number; cl: number; cd: number }>
    >;

    for (const id of PART_ORDER) {
      enabledParts[id] = this.parts[id].enabled !== false;
      paramValues[id] = { ...this.parts[id].paramValues };
      proceduralElements[id] = cloneProceduralElements(this.parts[id].proceduralElements);
      if (this.parts[id].cage) {
        cages[id] = {
          macro: cloneGrid(this.parts[id].cage!.macro),
          detailOffsets: cloneGrid(this.parts[id].cage!.detailOffsets),
        };
      }
      const pm = this.cfdResult.partMetrics[id];
      if (pm) {
        partMetrics[id] = {
          downforceN: pm.downforceN,
          dragN: pm.dragN,
          cl: pm.cl,
          cd: pm.cd,
        };
      }
    }

    return {
      version: 2,
      name,
      createdAt: Date.now(),
      carModelId: this.carModelId,
      enabledParts,
      cages,
      paramValues,
      proceduralElements,
      wheelStance: { ...this.wheelStance },
      fixtures: { ...this.fixtures },
      summary: {
        cl: this.cfdResult.cl,
        cd: this.cfdResult.cd,
        ldRatio: this.cfdResult.ldRatio,
        copFrontPct: this.cfdResult.copFrontPct,
        downforceN: this.cfdResult.totalDownforceN,
        dragN: this.cfdResult.totalDragN,
        topSpeedEstKmh: this.cfdResult.topSpeedEstKmh,
        highSpeedCornerG: this.cfdResult.highSpeedCornerG,
        partMetrics,
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

  public loadDesignSnapshot(snapshot: CarDesignSnapshotAny): boolean {
    try {
      this.pushUndoCheckpoint();

      if ((snapshot as CarDesignSnapshotV2).version === 2) {
        const snapV2 = snapshot as CarDesignSnapshotV2;
        for (const id of PART_ORDER) {
          const part = this.parts[id];
          part.enabled = snapV2.enabledParts ? snapV2.enabledParts[id] !== false : true;
          const cageData = snapV2.cages?.[id];
          if (cageData && Array.isArray(cageData.macro)) {
            part.grid = cloneGrid(cageData.macro);
            this.baseGrids[id] = cloneGrid(cageData.macro);
            part.cage = createCageV2(part.grid, part.centerlineLocked);
            if (cageData.detailOffsets && Array.isArray(cageData.detailOffsets)) {
              part.cage.detailOffsets = cloneGrid(cageData.detailOffsets);
              part.cage.detail = interpolateMacroToDetail(
                part.cage.macro,
                part.cage.detailCols,
                part.cage.detailRows,
                part.cage.detailOffsets,
                part.centerlineLocked
              );
            }
          }
          if (snapV2.paramValues?.[id]) {
            part.paramValues = { ...part.paramValues, ...snapV2.paramValues[id] };
          }
          if (Array.isArray(snapV2.proceduralElements?.[id])) {
            part.proceduralElements = cloneProceduralElements(snapV2.proceduralElements[id]!);
          }
        }
        if (snapV2.wheelStance) {
          this.wheelStance = { ...DEFAULT_WHEEL_STANCE, ...snapV2.wheelStance };
          this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
        }
        if (snapV2.fixtures) {
          this.fixtures = { ...this.fixtures, ...snapV2.fixtures };
        }
      } else {
        // V1 snapshot transparent migration
        const snapV1 = snapshot as CarDesignSnapshot;
        if (!snapV1.parts) return false;
        for (const id of PART_ORDER) {
          const incoming = snapV1.parts[id];
          const part = this.parts[id];
          part.enabled = true;
          if (
            Array.isArray(incoming) &&
            incoming.length === part.cols &&
            Array.isArray(incoming[0]) &&
            incoming[0].length === part.rows
          ) {
            part.grid = cloneGrid(incoming);
            this.baseGrids[id] = cloneGrid(incoming);
            part.cage = createCageV2(part.grid, part.centerlineLocked);
          }
          if (snapV1.paramValues?.[id]) {
            part.paramValues = { ...part.paramValues, ...snapV1.paramValues[id] };
          }
          if (Array.isArray(snapV1.proceduralElements?.[id])) {
            part.proceduralElements = cloneProceduralElements(snapV1.proceduralElements[id]!);
          }
        }
        if (snapV1.wheelStance) {
          this.wheelStance = { ...DEFAULT_WHEEL_STANCE, ...snapV1.wheelStance };
          this.tunnelSettings = { ...this.tunnelSettings, wheelStance: { ...this.wheelStance } };
        }
        this.migrationToast = 'Migrated legacy V1 design to V2 procedural cages';
      }

      this.runCFD();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  public importDesignJson(rawJson: string): boolean {
    try {
      const parsed = JSON.parse(rawJson) as CarDesignSnapshotAny;
      return this.loadDesignSnapshot(parsed);
    } catch {
      return false;
    }
  }
}
