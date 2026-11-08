import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CFDVisualizer } from '../cfd/CFDVisualizer';
import { CarModelLoader, LoadedCarAssembly } from '../geometry/CarModelLoader';
import {
  createReferenceChassis,
  ReferenceChassisBuild,
} from '../geometry/referenceChassis';
import { buildPartGeometry } from '../geometry/splineSurface';
import { checkPartLegality, PART_ORDER } from '../regulations/fia2026';
import { CarProjectStore, MeshCFDData } from '../state/CarProjectStore';
import { ActiveAeroMode, CarModelId, PartId, Vec3 } from '../types/aero';
import { LegalityVisualizer } from './LegalityVisualizer';
import { PartSculptor } from './PartSculptor';

export type CameraPreset =
  | 'iso_front'
  | 'side_profile'
  | 'front_throat'
  | 'rear_diffuser'
  | 'top_plan'
  | 'underfloor';

type CameraMoveAction = 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down';

function computeGridSignature(
  grid: Vec3[][],
  clamp: boolean,
  aeroMode: ActiveAeroMode
): string {
  let s = `${clamp ? 1 : 0}:${aeroMode}:`;
  for (let u = 0; u < grid.length; u++) {
    const col = grid[u];
    for (let v = 0; v < col.length; v++) {
      const p = col[v];
      s += `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)};`;
    }
  }
  return s;
}

export class SceneManager {
  public readonly scene = new THREE.Scene();
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly orbitControls: OrbitControls;

  public readonly legalityViz = new LegalityVisualizer();
  public readonly cfdViz = new CFDVisualizer();
  public readonly sculptor: PartSculptor;

  private readonly carAssembly = new THREE.Group();
  private readonly fallbackChassis: ReferenceChassisBuild;
  private readonly modelLoader = new CarModelLoader();
  private readonly loadedModels = new Map<CarModelId, LoadedCarAssembly>();
  private activeLoadedCar: LoadedCarAssembly | null = null;
  private loadingModelToken = 0;
  private activeCarModelId: CarModelId | null = null;

  private readonly partMeshes = new Map<PartId, THREE.Mesh>();
  private readonly partMaterials = new Map<PartId, THREE.MeshStandardMaterial>();
  private readonly lastPartSignatures = new Map<PartId, string>();

  private readonly groundPlane: THREE.Mesh;
  private readonly groundGrid: THREE.GridHelper;

  private targetCamPos: THREE.Vector3 | null = null;
  private targetLookAt: THREE.Vector3 | null = null;
  private clock = new THREE.Clock();

  private readonly pressedMoveActions = new Set<CameraMoveAction>();
  private shiftHeld = false;
  private readonly moveVelocity = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpDesiredDir = new THREE.Vector3();
  private readonly tmpDelta = new THREE.Vector3();

  constructor(private container: HTMLElement, private store: CarProjectStore) {
    this.scene.background = new THREE.Color(0x090d14);
    this.scene.fog = new THREE.FogExp2(0x090d14, 0.038);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 80);
    this.camera.position.set(2.95, 1.48, -3.55);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.07;
    this.orbitControls.target.set(0, 0.36, -0.15);
    this.orbitControls.maxPolarAngle = Math.PI * 0.68;
    this.orbitControls.minDistance = 0.65;
    this.orbitControls.maxDistance = 14;

    // Wind Tunnel & CAD Studio Lighting
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.15);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.95);
    keyLight.position.set(4.5, 6.8, -3.8);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    rimLight.position.set(-4.8, 3.2, 4.8);
    this.scene.add(rimLight);

    const underLight = new THREE.DirectionalLight(0x94a3b8, 0.82);
    underLight.position.set(0, -3.5, 0);
    this.scene.add(underLight);

    // Wind Tunnel Overhead Light Strips
    const stripGeo = new THREE.BoxGeometry(0.08, 0.03, 6.6);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
    for (const sx of [-1.15, 1.15]) {
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(sx, 1.78, 0);
      this.scene.add(strip);
    }

    // Rolling Road Belt & Metric Reference Grid
    const beltGeo = new THREE.PlaneGeometry(2.6, 7.6);
    beltGeo.rotateX(-Math.PI / 2);
    const beltMat = new THREE.MeshStandardMaterial({
      color: 0x0f1520,
      roughness: 0.75,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
      side: THREE.FrontSide,
    });
    this.groundPlane = new THREE.Mesh(beltGeo, beltMat);
    this.groundPlane.position.y = -0.002;
    this.scene.add(this.groundPlane);

    this.groundGrid = new THREE.GridHelper(8.5, 34, 0x1e3a5f, 0x162032);
    (this.groundGrid.material as THREE.Material).transparent = true;
    (this.groundGrid.material as THREE.Material).opacity = 0.65;
    this.scene.add(this.groundGrid);

    this.scene.add(this.carAssembly);

    // Temporary lightweight fallback shown only during initial ~250ms GLB stream
    this.fallbackChassis = createReferenceChassis();
    this.carAssembly.add(this.fallbackChassis.root);

    for (const id of PART_ORDER) {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.34,
        metalness: 0.30,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
      });
      this.partMaterials.set(id, mat);

      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.userData = { partId: id };
      this.partMeshes.set(id, mesh);
      this.carAssembly.add(mesh);
    }

    // Register real deformed 3D mesh provider for CFDSolver
    this.store.setMeshCFDDataProvider(() => this.extractActiveMeshCFDData());

    this.scene.add(this.legalityViz.root);
    this.scene.add(this.cfdViz.root);

    this.sculptor = new PartSculptor(
      this.camera,
      this.renderer.domElement,
      this.orbitControls,
      this.store,
      () => this.partMeshes,
      (partId, recomputeCfd) => {
        this.deformSinglePart(partId, true);
        this.updateActiveLegalityVisuals();
        if (recomputeCfd) {
          this.store.runCFD();
          this.recolorAllParts();
          this.store.emit();
        }
      }
    );
    this.scene.add(this.sculptor.root);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearMovementState);
    this.renderer.domElement.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.orbitControls.addEventListener('start', () => {
      this.targetCamPos = null;
      this.targetLookAt = null;
    });

    this.store.subscribe(() => this.syncFromStore());
    this.syncFromStore();

    // Immediately load the Official FIA 2026 Concept Model as default car!
    void this.ensureCarModelLoaded(this.store.carModelId, true);

    this.animate();
  }

  private extractActiveMeshCFDData(): MeshCFDData | null {
    if (!this.activeLoadedCar) return null;
    const panels: MeshCFDData['panels'] = {};
    const legalityPts: MeshCFDData['legalityPts'] = {};
    for (const id of PART_ORDER) {
      const ctrl = this.activeLoadedCar.partControllers[id];
      panels[id] = ctrl.extractDeformedMacroPanels();
      legalityPts[id] = ctrl.sampleDeformedPointsForLegality();
    }
    return { panels, legalityPts };
  }

  private async ensureCarModelLoaded(
    modelId: CarModelId,
    isInitialStartup = false
  ): Promise<void> {
    if (this.activeCarModelId === modelId && this.activeLoadedCar) return;
    this.activeCarModelId = modelId;
    const token = ++this.loadingModelToken;

    let car = this.loadedModels.get(modelId);
    if (!car) {
      this.store.setModelLoading(true, 5, 'Loading 2026 F1 3D Model...');
      try {
        car = await this.modelLoader.loadCarModel(modelId, (pct, label) => {
          if (token === this.loadingModelToken) {
            this.store.setModelLoading(true, pct, label);
          }
        });
        this.loadedModels.set(modelId, car);
      } catch (err) {
        console.error('Failed to load GLTF/GLB car model:', err);
        if (token === this.loadingModelToken) {
          this.store.setModelLoading(false, 100, '');
        }
        return;
      }
    }

    if (token !== this.loadingModelToken) return;

    // Detach previous car static/wheel groups if switching models
    if (this.activeLoadedCar) {
      this.carAssembly.remove(this.activeLoadedCar.staticChassisGroup);
      for (const wg of this.activeLoadedCar.wheelGroups) {
        this.carAssembly.remove(wg);
      }
    }

    // Hide procedural placeholder chassis permanently once real 2026 car is mounted!
    this.fallbackChassis.root.visible = false;

    this.activeLoadedCar = car;
    this.carAssembly.add(car.staticChassisGroup);
    for (const wg of car.wheelGroups) {
      this.carAssembly.add(wg);
    }

    // Bind each PartId's THREE.Mesh directly to its welded PartFFDController BufferGeometry
    this.lastPartSignatures.clear();
    for (const id of PART_ORDER) {
      const mesh = this.partMeshes.get(id)!;
      const oldGeo = mesh.geometry;
      mesh.geometry = car.partControllers[id].geometry;
      // Only dispose oldGeo if it wasn't owned by a cached PartFFDController
      let ownedByCachedModel = false;
      for (const cached of this.loadedModels.values()) {
        if (cached.partControllers[id].geometry === oldGeo) {
          ownedByCachedModel = true;
          break;
        }
      }
      if (!ownedByCachedModel) {
        oldGeo.dispose();
      }
    }

    // Apply current FFD deformations to all 7 parts, solve CFD on real 3D mesh, and refresh baseline if startup
    for (const id of PART_ORDER) {
      this.deformSinglePart(id, true);
    }
    this.store.runCFD();
    if (isInitialStartup && !this.store.canUndo()) {
      this.store.setCurrentAsBaseline('Official FIA 2026 Spec');
    }
    this.store.setModelLoading(false, 100, '');
    this.syncFromStore();
  }

  public syncFromStore(): void {
    // Check if user switched 3D Car Model (FIA 2026 Concept vs Ferrari SF-26)
    if (this.store.carModelId !== this.activeCarModelId) {
      void this.ensureCarModelLoaded(this.store.carModelId, false);
    }

    const isCfd = this.store.appMode === 'cfd';

    if (isCfd) {
      const fM = this.store.tunnelSettings.frontRideHeightMm * 0.001;
      const rM = this.store.tunnelSettings.rearRideHeightMm * 0.001;
      const pitchRad = Math.atan2(fM - rM, 3.4);
      const midY = 0.5 * (fM + rM);
      this.carAssembly.position.set(0, midY, 0);
      this.carAssembly.rotation.set(pitchRad, 0, 0);
    } else {
      this.carAssembly.position.set(0, 0, 0);
      this.carAssembly.rotation.set(0, 0, 0);
    }

    for (const id of PART_ORDER) {
      this.deformSinglePart(id, false);

      const mat = this.partMaterials.get(id)!;
      const ghost = !isCfd && this.store.ghostOtherParts && id !== this.store.activePartId;
      mat.opacity = ghost ? 0.16 : 1.0;
      mat.depthWrite = !ghost;
      mat.roughness = this.store.surfaceVizMode === 'carbon' ? 0.34 : 0.56;
      mat.metalness = this.store.surfaceVizMode === 'carbon' ? 0.30 : 0.06;
    }

    this.recolorAllParts();

    const ghostStatic = !isCfd && this.store.ghostOtherParts;
    if (this.activeLoadedCar) {
      this.activeLoadedCar.setGhostMode(ghostStatic);
    } else {
      this.fallbackChassis.setGhostMode(ghostStatic);
    }

    this.legalityViz.setVisible(!isCfd && this.store.showFiaBox);
    if (!isCfd) {
      this.updateActiveLegalityVisuals();
    }

    this.sculptor.setVisible(!isCfd);
    if (!isCfd) {
      this.sculptor.syncFromStore();
    }

    this.cfdViz.setVisible(isCfd);
    if (isCfd) {
      this.cfdViz.updateFromResult(this.store.cfdResult);
    }
  }

  private deformSinglePart(partId: PartId, force: boolean): void {
    const part = this.store.parts[partId];
    // Visually show X-Mode flap deflection in Wind Tunnel CFD mode; keep CAD datum Z-Mode in Sculpt Studio!
    const visualAeroMode: ActiveAeroMode =
      this.store.appMode === 'cfd' ? this.store.tunnelSettings.activeAeroMode : 'z_mode';

    if (this.activeLoadedCar) {
      const sig = computeGridSignature(part.grid, this.store.clampToFiaBox, visualAeroMode);
      if (!force && this.lastPartSignatures.get(partId) === sig) {
        return;
      }
      this.lastPartSignatures.set(partId, sig);

      const ctrl = this.activeLoadedCar.partControllers[partId];
      ctrl.applyDeformation(
        part.grid,
        part.legalityBoxes,
        this.store.clampToFiaBox,
        visualAeroMode
      );
      ctrl.applySurfaceColors(
        this.store.surfaceVizMode,
        part.accentHex,
        this.store.cfdResult.partSurfaceMaps[partId],
        this.store.appMode === 'sculpt' && partId === this.store.activePartId
      );
    } else {
      // Fallback spline shell only during initial ~250ms stream
      const cpMap = this.store.cfdResult.partSurfaceMaps[partId];
      const { geometry } = buildPartGeometry(part, this.store.surfaceVizMode, cpMap);
      const mesh = this.partMeshes.get(partId)!;
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
  }

  private recolorAllParts(): void {
    if (!this.activeLoadedCar) return;
    for (const id of PART_ORDER) {
      const part = this.store.parts[id];
      const ctrl = this.activeLoadedCar.partControllers[id];
      ctrl.applySurfaceColors(
        this.store.surfaceVizMode,
        part.accentHex,
        this.store.cfdResult.partSurfaceMaps[id],
        this.store.appMode === 'sculpt' && id === this.store.activePartId
      );
    }
  }

  private updateActiveLegalityVisuals(): void {
    const active = this.store.getActivePart();
    let samplePts: Vec3[];
    if (this.activeLoadedCar) {
      samplePts =
        this.activeLoadedCar.partControllers[active.id].sampleDeformedPointsForLegality();
    } else {
      const mesh = this.partMeshes.get(active.id)!;
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      samplePts = [];
      for (let i = 0; i < posAttr.count; i += 4) {
        const x = posAttr.getX(i);
        if (x >= -0.001) {
          samplePts.push({ x: Math.max(0, x), y: posAttr.getY(i), z: posAttr.getZ(i) });
        }
      }
    }
    const check = checkPartLegality(active, samplePts);
    this.legalityViz.rebuildForPart(active.legalityBoxes, check.isLegal);
  }

  public focusPart(partId: PartId): void {
    const presets: Record<
      PartId,
      { cam: [number, number, number]; look: [number, number, number] }
    > = {
      front_wing: { cam: [1.55, 0.72, -3.65], look: [0.35, 0.20, -2.50] },
      nosecone: { cam: [1.45, 0.85, -3.15], look: [0.05, 0.34, -2.15] },
      floor_boards: { cam: [1.65, 0.58, -1.45], look: [0.68, 0.22, -0.62] },
      floor: { cam: [1.85, -0.48, -0.75], look: [0.25, 0.08, 0.05] },
      sidepods: { cam: [2.05, 0.88, -1.25], look: [0.42, 0.36, 0.25] },
      diffuser: { cam: [1.48, 0.44, 3.15], look: [0.20, 0.16, 1.65] },
      rear_wing: { cam: [1.50, 1.18, 3.35], look: [0.20, 0.80, 2.20] },
    };
    const p = presets[partId];
    this.targetCamPos = new THREE.Vector3(...p.cam);
    this.targetLookAt = new THREE.Vector3(...p.look);
  }

  public setCameraPreset(preset: CameraPreset): void {
    const map: Record<
      CameraPreset,
      { cam: [number, number, number]; look: [number, number, number] }
    > = {
      iso_front: { cam: [2.95, 1.48, -3.55], look: [0, 0.36, -0.15] },
      side_profile: { cam: [4.55, 0.62, 0.05], look: [0, 0.42, 0.05] },
      front_throat: { cam: [0.0, 0.52, -4.35], look: [0, 0.36, -1.3] },
      rear_diffuser: { cam: [0.98, 0.68, 4.15], look: [0, 0.42, 1.35] },
      top_plan: { cam: [0.01, 5.3, 0.0], look: [0, 0.2, 0.0] },
      underfloor: { cam: [1.28, -1.40, -0.35], look: [0, 0.08, 0.2] },
    };
    const m = map[preset];
    this.targetCamPos = new THREE.Vector3(...m.cam);
    this.targetLookAt = new THREE.Vector3(...m.look);
  }

  private onResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onCanvasPointerDown = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active !== this.renderer.domElement) {
      active.blur();
    }
  };

  private mapKeyToMoveAction(
    e: KeyboardEvent
  ): { action: CameraMoveAction; isArrowLike: boolean } | null {
    switch (e.key.toLowerCase()) {
      case 'w':
        return { action: 'forward', isArrowLike: false };
      case 'arrowup':
        return { action: 'forward', isArrowLike: true };
      case 's':
        return { action: 'backward', isArrowLike: false };
      case 'arrowdown':
        return { action: 'backward', isArrowLike: true };
      case 'a':
        return { action: 'left', isArrowLike: false };
      case 'arrowleft':
        return { action: 'left', isArrowLike: true };
      case 'd':
        return { action: 'right', isArrowLike: false };
      case 'arrowright':
        return { action: 'right', isArrowLike: true };
      case 'e':
        return { action: 'up', isArrowLike: false };
      case 'pageup':
        return { action: 'up', isArrowLike: true };
      case 'q':
        return { action: 'down', isArrowLike: false };
      case 'pagedown':
        return { action: 'down', isArrowLike: true };
      default:
        return null;
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.shiftHeld = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const mapped = this.mapKeyToMoveAction(e);
    if (!mapped) return;

    const target = e.target;
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
      return;
    }
    if (target instanceof HTMLInputElement) {
      const t = target.type;
      if (t !== 'range' && t !== 'checkbox' && t !== 'button') {
        return;
      }
      if (t === 'range' && mapped.isArrowLike) {
        return;
      }
    }
    if (target instanceof HTMLSelectElement && mapped.isArrowLike) {
      return;
    }

    if (mapped.isArrowLike) {
      e.preventDefault();
    }

    this.pressedMoveActions.add(mapped.action);
    this.targetCamPos = null;
    this.targetLookAt = null;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.shiftHeld = e.shiftKey;
    const mapped = this.mapKeyToMoveAction(e);
    if (mapped) {
      this.pressedMoveActions.delete(mapped.action);
    }
  };

  private clearMovementState = (): void => {
    this.pressedMoveActions.clear();
    this.shiftHeld = false;
    this.moveVelocity.set(0, 0, 0);
  };

  private updateKeyboardCameraMovement(dt: number): void {
    this.tmpDesiredDir.set(0, 0, 0);

    if (this.pressedMoveActions.size > 0) {
      this.camera.updateMatrixWorld();
      this.tmpRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.tmpRight.y = 0;
      if (this.tmpRight.lengthSq() < 1e-6) {
        this.tmpRight.set(1, 0, 0);
      } else {
        this.tmpRight.normalize();
      }
      this.tmpForward.crossVectors(THREE.Object3D.DEFAULT_UP, this.tmpRight).normalize();

      const fwd =
        (this.pressedMoveActions.has('forward') ? 1 : 0) -
        (this.pressedMoveActions.has('backward') ? 1 : 0);
      const strafe =
        (this.pressedMoveActions.has('right') ? 1 : 0) -
        (this.pressedMoveActions.has('left') ? 1 : 0);
      const lift =
        (this.pressedMoveActions.has('up') ? 1 : 0) -
        (this.pressedMoveActions.has('down') ? 1 : 0);

      this.tmpDesiredDir.addScaledVector(this.tmpForward, fwd).addScaledVector(this.tmpRight, strafe);
      this.tmpDesiredDir.y += lift;

      if (this.tmpDesiredDir.lengthSq() > 1e-6) {
        this.tmpDesiredDir.normalize();
      }

      const orbitDist = this.camera.position.distanceTo(this.orbitControls.target);
      const speed =
        THREE.MathUtils.clamp(orbitDist * 0.85, 1.25, 6.8) * (this.shiftHeld ? 2.25 : 1.0);
      this.tmpDesiredDir.multiplyScalar(speed);
    }

    const blend = 1 - Math.exp(-18 * dt);
    this.moveVelocity.lerp(this.tmpDesiredDir, blend);

    if (this.pressedMoveActions.size === 0 && this.moveVelocity.lengthSq() < 1e-5) {
      this.moveVelocity.set(0, 0, 0);
      return;
    }

    this.tmpDelta.copy(this.moveVelocity).multiplyScalar(dt);

    const oldTx = this.orbitControls.target.x;
    const oldTy = this.orbitControls.target.y;
    const oldTz = this.orbitControls.target.z;

    const newTx = THREE.MathUtils.clamp(oldTx + this.tmpDelta.x, -8, 8);
    const newTy = THREE.MathUtils.clamp(oldTy + this.tmpDelta.y, -2.2, 5.5);
    const newTz = THREE.MathUtils.clamp(oldTz + this.tmpDelta.z, -10, 10);

    const dx = newTx - oldTx;
    const dy = newTy - oldTy;
    const dz = newTz - oldTz;

    this.orbitControls.target.set(newTx, newTy, newTz);
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());

    this.updateKeyboardCameraMovement(dt);

    if (this.targetCamPos && this.targetLookAt) {
      const alpha = 1 - Math.exp(-7.5 * dt);
      this.camera.position.lerp(this.targetCamPos, alpha);
      this.orbitControls.target.lerp(this.targetLookAt, alpha);
      if (
        this.camera.position.distanceTo(this.targetCamPos) < 0.015 &&
        this.orbitControls.target.distanceTo(this.targetLookAt) < 0.015
      ) {
        this.targetCamPos = null;
        this.targetLookAt = null;
      }
    }

    const gridMat = this.groundGrid.material as THREE.Material;
    gridMat.opacity = this.camera.position.y < 0.05 ? 0.18 : 0.65;

    this.orbitControls.update();

    const spinActive = this.store.appMode === 'cfd';
    if (this.activeLoadedCar) {
      this.activeLoadedCar.updateWheelSpin(
        dt,
        this.store.tunnelSettings.windSpeedKmh,
        spinActive
      );
    } else {
      this.fallbackChassis.updateWheelSpin(
        dt,
        this.store.tunnelSettings.windSpeedKmh,
        spinActive
      );
    }

    this.cfdViz.updateAnimation(dt);
    this.renderer.render(this.scene, this.camera);
  };
}
