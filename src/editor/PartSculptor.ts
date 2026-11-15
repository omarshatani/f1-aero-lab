import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  clampPointToLegalityBoxes,
  cloneGrid,
  signedMarginInUnion,
} from '../regulations/fia2026';
import { CarProjectStore } from '../state/CarProjectStore';
import { AeroPartData, NodeIndex, PartId, PartSubZone, Vec3 } from '../types/aero';

export class PartSculptor {
  public readonly root = new THREE.Group();
  public readonly transformControls: TransformControls;

  private readonly proxyAnchor = new THREE.Object3D();
  private readonly handleGroup = new THREE.Group();
  private readonly mirrorHandleGroup = new THREE.Group();
  private cageLines: THREE.LineSegments | null = null;
  private mirrorCageLines: THREE.LineSegments | null = null;

  private handleMeshes: THREE.Mesh[] = [];
  private mirrorHandleMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = new THREE.Vector2();

  private hoveredNode: NodeIndex | null = null;
  private isDraggingGizmo = false;
  private isDraggingDot = false;
  private hasMovedDotDrag = false;
  private dragDotSide: 1 | -1 = 1;
  private activeDotPointerId: number | null = null;
  private readonly dotDragPlane = new THREE.Plane();
  private readonly dotDragStartWorld = new THREE.Vector3();

  private dragStartGrid: Vec3[][] | null = null;
  private dragStartAnchorPos = new THREE.Vector3();
  private dragStartAnchorQuat = new THREE.Quaternion();
  private lastCfdUpdateMs = 0;

  private readonly detailSphereGeo = new THREE.SphereGeometry(0.020, 14, 12);
  private readonly mirrorDetailSphereGeo = new THREE.SphereGeometry(0.016, 12, 10);

  constructor(
    private camera: THREE.Camera,
    private domElement: HTMLElement,
    private orbitControls: OrbitControls,
    private store: CarProjectStore,
    private getPartMeshes: () => Map<PartId, THREE.Mesh>,
    private onLiveGeometryChange: (partId: PartId, recomputeCfd: boolean) => void
  ) {
    this.root.name = 'PartSculptor';
    this.root.add(this.proxyAnchor);
    this.root.add(this.handleGroup);
    this.root.add(this.mirrorHandleGroup);

    this.transformControls = new TransformControls(this.camera, this.domElement);
    this.transformControls.setSize(0.62);
    this.transformControls.setSpace('world');
    this.root.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.isDraggingGizmo = dragging;
      this.orbitControls.enabled = !dragging && !this.isDraggingDot;

      const active = this.store.getActivePart();
      if (dragging) {
        this.store.pushUndoCheckpoint();
        const activeGrid = this.getActiveGrid(active);
        this.dragStartGrid = cloneGrid(activeGrid);
        this.dragStartAnchorPos.copy(this.proxyAnchor.position);
        this.dragStartAnchorQuat.copy(this.proxyAnchor.quaternion);
        this.proxyAnchor.scale.set(1, 1, 1);
      } else {
        this.dragStartGrid = null;
        this.proxyAnchor.scale.set(1, 1, 1);
        this.store.syncBaseGridFromCurrent(active.id);
        this.onLiveGeometryChange(active.id, true);
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.isDraggingGizmo || !this.dragStartGrid) return;
      this.applyGizmoTransform();
    });

    this.domElement.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointercancel', this.onPointerUp);
  }

  public dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointercancel', this.onPointerUp);
    for (const h of this.handleMeshes) {
      (h.material as THREE.Material).dispose();
    }
    for (const mh of this.mirrorHandleMeshes) {
      (mh.material as THREE.Material).dispose();
    }
    this.cageLines?.geometry.dispose();
    (this.cageLines?.material as THREE.Material | undefined)?.dispose();
    this.mirrorCageLines?.geometry.dispose();
    (this.mirrorCageLines?.material as THREE.Material | undefined)?.dispose();
    this.detailSphereGeo.dispose();
    this.mirrorDetailSphereGeo.dispose();
  }

  public setCamera(cam: THREE.Camera): void {
    this.camera = cam;
    this.transformControls.camera = cam;
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.transformControls.enabled = visible;
    if (!visible) {
      this.endDotDrag(false);
      this.hoveredNode = null;
      this.domElement.style.cursor = '';
      this.transformControls.detach();
    } else {
      this.syncFromStore();
    }
  }

  private getActiveGrid(part: AeroPartData): Vec3[][] {
    return part.cage?.detail ?? part.grid;
  }

  private getActiveDimensions(part: AeroPartData): { cols: number; rows: number } {
    if (part.cage) {
      return { cols: part.cage.detailCols, rows: part.cage.detailRows };
    }
    return { cols: part.cols, rows: part.rows };
  }

  private resolveActiveSubZone(part: AeroPartData): PartSubZone | undefined {
    if (this.store.activeSubZoneId !== 'all') {
      const found = part.subZones.find((z) => z.id === this.store.activeSubZoneId);
      if (found) return found;
    }
    if (this.store.selectMode === 'sub_zone' && part.subZones.length > 0) {
      const sel = this.store.selectedNode;
      const isDetail = Boolean(part.cage);
      return (
        part.subZones.find((z) => {
          const uIdx = isDetail && z.detailUIndices ? z.detailUIndices : z.uIndices.map(u => isDetail ? u * 3 : u);
          const vIdx = isDetail && z.detailVIndices ? z.detailVIndices : z.vIndices.map(v => isDetail ? v * 3 : v);
          return uIdx.includes(sel.u) && vIdx.includes(sel.v);
        }) ?? part.subZones[0]
      );
    }
    return undefined;
  }

  private computeAnchorPosition(): THREE.Vector3 {
    const part = this.store.getActivePart();
    const activeGrid = this.getActiveGrid(part);
    const { cols, rows } = this.getActiveDimensions(part);
    const sel = this.store.selectedNode;
    const mode = this.store.selectMode;
    const isDetail = Boolean(part.cage);

    if (mode === 'sub_zone' || this.store.activeSubZoneId !== 'all') {
      const zone = this.resolveActiveSubZone(part);
      if (zone) {
        const uList = isDetail && zone.detailUIndices ? zone.detailUIndices : zone.uIndices.map(u => isDetail ? u * 3 : u);
        const vList = isDetail && zone.detailVIndices ? zone.detailVIndices : zone.vIndices.map(v => isDetail ? v * 3 : v);
        const acc = new THREE.Vector3();
        let count = 0;
        for (const u of uList) {
          if (u < 0 || u >= cols) continue;
          for (const v of vList) {
            if (v < 0 || v >= rows) continue;
            const p = activeGrid[u][v];
            acc.x += p.x;
            acc.y += p.y;
            acc.z += p.z;
            count++;
          }
        }
        if (count > 0) {
          return acc.divideScalar(count);
        }
      }
    }

    if (mode === 'node') {
      const validU = Math.min(cols - 1, Math.max(0, sel.u));
      const validV = Math.min(rows - 1, Math.max(0, sel.v));
      const p = activeGrid[validU][validV];
      return new THREE.Vector3(p.x, p.y, p.z);
    }

    const acc = new THREE.Vector3();
    let count = 0;
    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        if (mode === 'span_rib' && u !== sel.u) continue;
        if (mode === 'chord_edge' && v !== sel.v) continue;
        acc.x += activeGrid[u][v].x;
        acc.y += activeGrid[u][v].y;
        acc.z += activeGrid[u][v].z;
        count++;
      }
    }
    if (count > 0) acc.divideScalar(count);
    return acc;
  }

  private getNodeWeight(partGrid: Vec3[][], u: number, v: number): number {
    const sel = this.store.selectedNode;
    const mode = this.store.selectMode;
    const isDetail = Boolean(this.store.getActivePart().cage);

    if (mode === 'whole_part') return 1.0;
    if (mode === 'span_rib') return u === sel.u ? 1.0 : 0.0;
    if (mode === 'chord_edge') return v === sel.v ? 1.0 : 0.0;

    if (mode === 'sub_zone') {
      const part = this.store.getActivePart();
      const zone = this.resolveActiveSubZone(part);
      if (zone) {
        const uList = isDetail && zone.detailUIndices ? zone.detailUIndices : zone.uIndices.map(uz => isDetail ? uz * 3 : uz);
        const vList = isDetail && zone.detailVIndices ? zone.detailVIndices : zone.vIndices.map(vz => isDetail ? vz * 3 : vz);

        if (uList.includes(u) && vList.includes(v)) {
          return 1.0;
        }
        const radius = this.store.softFalloffRadius;
        if (radius <= 0.005) return 0.0;

        const p = partGrid[u][v];
        let minDist = Infinity;
        for (const zu of uList) {
          if (zu < 0 || zu >= partGrid.length) continue;
          for (const zv of vList) {
            if (zv < 0 || zv >= partGrid[zu].length) continue;
            const zp = partGrid[zu][zv];
            const d = Math.hypot(p.x - zp.x, p.y - zp.y, p.z - zp.z);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist >= radius) return 0.0;
        return 0.5 * (1 + Math.cos((Math.PI * minDist) / radius));
      }
    }

    // mode === 'node'
    if (u === sel.u && v === sel.v) return 1.0;
    const radius = this.store.softFalloffRadius;
    if (radius <= 0.005) return 0.0;

    const validSelU = Math.min(partGrid.length - 1, Math.max(0, sel.u));
    const validSelV = Math.min(partGrid[validSelU].length - 1, Math.max(0, sel.v));
    const p0 = partGrid[validSelU][validSelV];
    const p = partGrid[u][v];
    const dist = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    if (dist >= radius) return 0.0;
    return 0.5 * (1 + Math.cos((Math.PI * dist) / radius));
  }

  private applyGizmoTransform(): void {
    if (!this.dragStartGrid) return;
    const deltaPos = new THREE.Vector3().subVectors(
      this.proxyAnchor.position,
      this.dragStartAnchorPos
    );
    const invStartQuat = this.dragStartAnchorQuat.clone().invert();
    const deltaQuat = new THREE.Quaternion().multiplyQuaternions(
      this.proxyAnchor.quaternion,
      invStartQuat
    );
    this.applyGridDeformation(
      this.store.gizmoMode,
      deltaPos,
      deltaQuat,
      this.proxyAnchor.scale
    );
  }

  private applyGridDeformation(
    mode: 'translate' | 'rotate' | 'scale',
    deltaPos: THREE.Vector3,
    deltaQuat?: THREE.Quaternion,
    scaleVec?: THREE.Vector3
  ): void {
    if (!this.dragStartGrid) return;
    const part = this.store.getActivePart();
    const { cols, rows } = this.getActiveDimensions(part);

    const identityQuat = new THREE.Quaternion();
    const tempVec = new THREE.Vector3();
    const weightedQuat = new THREE.Quaternion();
    const pivot = this.dragStartAnchorPos;

    // Construct candidate grid
    const candidateGrid: Vec3[][] = cloneGrid(this.dragStartGrid);

    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        const w = this.getNodeWeight(this.dragStartGrid, u, v);
        const startPt = this.dragStartGrid[u][v];
        if (w <= 0.0001) {
          candidateGrid[u][v] = { ...startPt };
          continue;
        }

        if (mode === 'rotate' && deltaQuat) {
          weightedQuat.slerpQuaternions(identityQuat, deltaQuat, w);
          tempVec
            .set(startPt.x, startPt.y, startPt.z)
            .sub(pivot)
            .applyQuaternion(weightedQuat)
            .add(pivot);
        } else if (mode === 'scale' && scaleVec) {
          const sx = 1 + (scaleVec.x - 1) * w;
          const sy = 1 + (scaleVec.y - 1) * w;
          const sz = 1 + (scaleVec.z - 1) * w;
          tempVec.set(
            pivot.x + (startPt.x - pivot.x) * sx,
            pivot.y + (startPt.y - pivot.y) * sy,
            pivot.z + (startPt.z - pivot.z) * sz
          );
        } else {
          tempVec.set(
            startPt.x + deltaPos.x * w,
            startPt.y + deltaPos.y * w,
            startPt.z + deltaPos.z * w
          );
        }

        const lockCenter = part.centerlineLocked && u === 0;
        let candidate: Vec3 = {
          x: lockCenter ? 0 : Math.max(0, tempVec.x),
          y: tempVec.y,
          z: tempVec.z,
        };

        if (this.store.clampToFiaBox) {
          candidate = clampPointToLegalityBoxes(candidate, part.legalityBoxes, lockCenter);
        }

        candidateGrid[u][v] = candidate;
      }
    }

    // Apply candidate movement across the dense lattice with live seam synchronization
    this.store.updatePartGridBatch(part.id, candidateGrid, part.cage ? 'detail' : 'macro', false);

    // Keep proxy anchor visually synced to active node / anchor after clamping
    if (this.store.selectMode === 'node' && mode === 'translate') {
      const activeGrid = this.getActiveGrid(part);
      const selU = Math.min(cols - 1, Math.max(0, this.store.selectedNode.u));
      const selV = Math.min(rows - 1, Math.max(0, this.store.selectedNode.v));
      const pClamped = activeGrid[selU][selV];
      this.proxyAnchor.position.set(pClamped.x, pClamped.y, pClamped.z);
    } else if (!this.isDraggingGizmo) {
      this.proxyAnchor.position.copy(this.computeAnchorPosition());
    }

    this.updateCageAndHandles();

    const now = performance.now();
    const shouldRecomputeCfd =
      this.store.autoUpdateCfdInSculpt && now - this.lastCfdUpdateMs > 110;
    if (shouldRecomputeCfd) {
      this.lastCfdUpdateMs = now;
    }
    this.onLiveGeometryChange(part.id, shouldRecomputeCfd);
  }

  public syncFromStore(): void {
    if (!this.root.visible) return;
    const part = this.store.getActivePart();
    if (part.enabled === false) {
      this.endDotDrag(false);
      this.transformControls.enabled = false;
      this.transformControls.detach();
      this.handleGroup.visible = false;
      this.mirrorHandleGroup.visible = false;
      if (this.cageLines) this.cageLines.visible = false;
      if (this.mirrorCageLines) this.mirrorCageLines.visible = false;
      return;
    }

    this.transformControls.enabled = !this.isDraggingDot;
    this.handleGroup.visible = true;
    this.mirrorHandleGroup.visible = true;
    if (this.cageLines) this.cageLines.visible = true;
    if (this.mirrorCageLines) this.mirrorCageLines.visible = true;

    const { cols, rows } = this.getActiveDimensions(part);

    // Ensure selectedNode is valid for active handle level
    if (this.store.selectedNode.u >= cols || this.store.selectedNode.v >= rows) {
      this.store.selectedNode = { u: cols - 1, v: rows - 1 };
    }

    this.transformControls.setMode(this.store.gizmoMode);

    const onlyCenterNode =
      part.centerlineLocked &&
      this.store.selectMode === 'node' &&
      this.store.selectedNode.u === 0 &&
      this.store.softFalloffRadius <= 0.01;
    this.transformControls.showX = !onlyCenterNode;

    if (!this.isDraggingGizmo && !this.isDraggingDot) {
      const anchor = this.computeAnchorPosition();
      this.proxyAnchor.position.copy(anchor);
      this.proxyAnchor.quaternion.identity();
      this.proxyAnchor.scale.set(1, 1, 1);
      this.transformControls.attach(this.proxyAnchor);
    }

    this.rebuildHandles();
    this.updateCageAndHandles();
  }

  private rebuildHandles(): void {
    for (const h of this.handleMeshes) {
      (h.material as THREE.Material).dispose();
    }
    for (const mh of this.mirrorHandleMeshes) {
      (mh.material as THREE.Material).dispose();
    }
    this.handleMeshes = [];
    this.mirrorHandleMeshes = [];
    this.handleGroup.clear();
    this.mirrorHandleGroup.clear();

    const part = this.store.getActivePart();
    const { cols, rows } = this.getActiveDimensions(part);

    const sphereGeo = this.detailSphereGeo;
    const mirrorSphereGeo = this.mirrorDetailSphereGeo;
    const baseHex = 0xf59e0b;

    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        const mat = new THREE.MeshBasicMaterial({
          color: baseHex,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.renderOrder = 12;
        mesh.userData = { nodeIndex: { u, v } as NodeIndex, isMirror: false };
        this.handleGroup.add(mesh);
        this.handleMeshes.push(mesh);

        if (!(part.centerlineLocked && u === 0)) {
          const mirrorMat = new THREE.MeshBasicMaterial({
            color: baseHex,
            transparent: true,
            opacity: 0.52,
            depthTest: false,
            depthWrite: false,
          });
          const mMesh = new THREE.Mesh(mirrorSphereGeo, mirrorMat);
          mMesh.renderOrder = 12;
          mMesh.userData = { nodeIndex: { u, v } as NodeIndex, isMirror: true };
          this.mirrorHandleGroup.add(mMesh);
          this.mirrorHandleMeshes.push(mMesh);
        }
      }
    }
  }

  public updateCageAndHandles(): void {
    const part = this.store.getActivePart();
    const activeGrid = this.getActiveGrid(part);
    const { cols, rows } = this.getActiveDimensions(part);
    const isDetail = Boolean(part.cage);

    let mirrorPtr = 0;

    for (let i = 0; i < this.handleMeshes.length; i++) {
      const mesh = this.handleMeshes[i];
      const { u, v } = mesh.userData.nodeIndex as NodeIndex;
      if (u >= cols || v >= rows) continue;
      const pt = activeGrid[u][v];
      mesh.position.set(pt.x, pt.y, pt.z);

      if (!(part.centerlineLocked && u === 0)) {
        const mMesh = this.mirrorHandleMeshes[mirrorPtr++];
        if (mMesh) {
          mMesh.position.set(-pt.x, pt.y, pt.z);
        }
      }
    }

    this.updateHandleVisuals();

    // Build control lattice wireframe
    const buildLatticePositions = (side: 1 | -1): Float32Array => {
      const segs = cols * (rows - 1) + (cols - 1) * rows;
      const arr = new Float32Array(segs * 2 * 3);
      let k = 0;
      // Chordwise lines
      for (let u = 0; u < cols; u++) {
        for (let v = 0; v < rows - 1; v++) {
          const a = activeGrid[u][v];
          const b = activeGrid[u][v + 1];
          arr[k++] = a.x * side;
          arr[k++] = a.y;
          arr[k++] = a.z;
          arr[k++] = b.x * side;
          arr[k++] = b.y;
          arr[k++] = b.z;
        }
      }
      // Spanwise ribs
      for (let u = 0; u < cols - 1; u++) {
        for (let v = 0; v < rows; v++) {
          const a = activeGrid[u][v];
          const b = activeGrid[u + 1][v];
          arr[k++] = a.x * side;
          arr[k++] = a.y;
          arr[k++] = a.z;
          arr[k++] = b.x * side;
          arr[k++] = b.y;
          arr[k++] = b.z;
        }
      }
      return arr;
    };

    const posPlus = buildLatticePositions(1);
    const wireColor = isDetail ? 0xfbbf24 : 0x7dd3fc;
    const mirrorColor = isDetail ? 0xd97706 : 0x38bdf8;

    if (!this.cageLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posPlus, 3));
      this.cageLines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: wireColor,
          transparent: true,
          opacity: 0.78,
          depthTest: false,
          depthWrite: false,
        })
      );
      this.cageLines.renderOrder = 10;
      this.root.add(this.cageLines);
    } else {
      (this.cageLines.material as THREE.LineBasicMaterial).color.setHex(wireColor);
      this.cageLines.geometry.setAttribute('position', new THREE.BufferAttribute(posPlus, 3));
    }

    const posMinus = buildLatticePositions(-1);
    if (!this.mirrorCageLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posMinus, 3));
      this.mirrorCageLines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: mirrorColor,
          transparent: true,
          opacity: 0.34,
          depthTest: false,
          depthWrite: false,
        })
      );
      this.mirrorCageLines.renderOrder = 10;
      this.root.add(this.mirrorCageLines);
    } else {
      (this.mirrorCageLines.material as THREE.LineBasicMaterial).color.setHex(mirrorColor);
      this.mirrorCageLines.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(posMinus, 3)
      );
    }
  }

  private updateHandleVisuals(): void {
    const part = this.store.getActivePart();
    const activeGrid = this.getActiveGrid(part);
    const { cols, rows } = this.getActiveDimensions(part);
    const isDetail = Boolean(part.cage);

    const activeZone = this.resolveActiveSubZone(part);
    const activeUList = activeZone
      ? isDetail && activeZone.detailUIndices
        ? activeZone.detailUIndices
        : activeZone.uIndices.map(u => isDetail ? u * 3 : u)
      : [];
    const activeVList = activeZone
      ? isDetail && activeZone.detailVIndices
        ? activeZone.detailVIndices
        : activeZone.vIndices.map(v => isDetail ? v * 3 : v)
      : [];

    let mirrorPtr = 0;

    for (let i = 0; i < this.handleMeshes.length; i++) {
      const mesh = this.handleMeshes[i];
      const { u, v } = mesh.userData.nodeIndex as NodeIndex;
      if (u >= cols || v >= rows) continue;
      const pt = activeGrid[u][v];

      const w = this.getNodeWeight(activeGrid, u, v);
      const inActiveZone = activeZone && activeUList.includes(u) && activeVList.includes(v);
      const isLegalNode = signedMarginInUnion(pt, part.legalityBoxes) >= -0.001;
      const isHovered = this.hoveredNode !== null && this.hoveredNode.u === u && this.hoveredNode.v === v;

      let colorHex = isDetail ? 0xf59e0b : 0x38bdf8;
      let scale = 0.95;
      let opacity = 0.9;
      let mirrorOpacity = 0.52;

      if (isHovered) {
        colorHex = 0x38bdf8;
        scale = 1.48;
        opacity = 1.0;
        mirrorOpacity = 0.95;
      } else if (w >= 0.99 || inActiveZone) {
        colorHex = isDetail ? 0xfef08a : 0xfacc15;
        scale = w >= 0.99 ? 1.32 : 1.18;
        opacity = 1.0;
        mirrorOpacity = 0.78;
      } else if (!isLegalNode) {
        colorHex = 0xef4444;
        scale = 1.25;
        opacity = 0.95;
        mirrorOpacity = 0.62;
      } else if (w > 0.02) {
        colorHex = 0xfb923c;
        scale = 1.0 + 0.25 * w;
        opacity = 0.94;
        mirrorOpacity = 0.60;
      }

      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(colorHex);
      mat.opacity = opacity;
      mesh.scale.setScalar(scale);

      if (!(part.centerlineLocked && u === 0)) {
        const mMesh = this.mirrorHandleMeshes[mirrorPtr++];
        if (mMesh) {
          const mMat = mMesh.material as THREE.MeshBasicMaterial;
          mMat.color.setHex(colorHex);
          mMat.opacity = mirrorOpacity;
          mMesh.scale.setScalar(scale);
        }
      }
    }
  }

  private getDomCoords(e: PointerEvent): {
    localX: number;
    localY: number;
    ndc: THREE.Vector2;
  } {
    const rect = this.domElement.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    return {
      localX,
      localY,
      ndc: new THREE.Vector2((localX / w) * 2 - 1, -(localY / h) * 2 + 1),
    };
  }

  private sameNode(a: NodeIndex | null, b: NodeIndex | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.u === b.u && a.v === b.v;
  }

  private pickClosestHandleNode(
    e: PointerEvent
  ): { node: NodeIndex; side: 1 | -1; worldPt: THREE.Vector3; distPx: number } | null {
    const part = this.store.getActivePart();
    if (part.enabled === false) return null;

    const rect = this.domElement.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const activeGrid = this.getActiveGrid(part);
    const { cols, rows } = this.getActiveDimensions(part);

    const maxPickPx = 18;
    const candPos = new THREE.Vector3();
    const proj = new THREE.Vector3();

    const hits: Array<{
      node: NodeIndex;
      side: 1 | -1;
      worldPt: THREE.Vector3;
      distPx: number;
      camDist: number;
    }> = [];

    const tryCandidate = (u: number, v: number, side: 1 | -1, pt: Vec3): void => {
      candPos.set(pt.x * side, pt.y, pt.z);
      proj.copy(candPos).project(this.camera);
      if (proj.z < -1 || proj.z > 1) return;

      const px = (proj.x * 0.5 + 0.5) * w;
      const py = (-proj.y * 0.5 + 0.5) * h;
      const distPx = Math.hypot(px - localX, py - localY);
      if (distPx > maxPickPx) return;

      hits.push({
        node: { u, v },
        side,
        worldPt: candPos.clone(),
        distPx,
        camDist: this.camera.position.distanceTo(candPos),
      });
    };

    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        const pt = activeGrid[u][v];
        tryCandidate(u, v, 1, pt);
        if (!(part.centerlineLocked && u === 0)) {
          tryCandidate(u, v, -1, pt);
        }
      }
    }

    if (hits.length === 0) return null;

    // Pick smallest 2D pixel distance to cursor; only tie-break by 3D camera distance within 2.5px
    let minPx = Infinity;
    for (const c of hits) {
      if (c.distPx < minPx) minPx = c.distPx;
    }

    let best = hits[0];
    let bestScore = Infinity;
    for (const c of hits) {
      if (c.distPx <= minPx + 2.5) {
        if (c.camDist < bestScore) {
          bestScore = c.camDist;
          best = c;
        }
      }
    }

    return {
      node: best.node,
      side: best.side,
      worldPt: best.worldPt,
      distPx: best.distPx,
    };
  }

  private endDotDrag(commitChanges: boolean): void {
    if (!this.isDraggingDot) return;
    const active = this.store.getActivePart();
    const moved = this.hasMovedDotDrag;

    this.isDraggingDot = false;
    this.hasMovedDotDrag = false;
    this.dragStartGrid = null;
    this.orbitControls.enabled = true;
    this.transformControls.enabled = this.root.visible && active.enabled !== false;

    if (this.activeDotPointerId !== null) {
      try {
        this.domElement.releasePointerCapture(this.activeDotPointerId);
      } catch {
        // Ignore when capture wasn't active (e.g. synthetic PointerEvent)
      }
      this.activeDotPointerId = null;
    }

    this.domElement.style.cursor = this.hoveredNode ? 'grab' : '';

    if (commitChanges && moved) {
      this.store.syncBaseGridFromCurrent(active.id);
      this.onLiveGeometryChange(active.id, true);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos.set(e.clientX, e.clientY);
    if (!this.root.visible || e.button !== 0 || this.isDraggingGizmo) return;

    const { ndc } = this.getDomCoords(e);
    const gizmoAxis = (this.transformControls as unknown as { axis: string | null }).axis;
    const hit = this.pickClosestHandleNode(e);
    if (!hit) return;

    // Prioritize pressing an unselected dot or any mirrored (-X) dot even if +X TransformControls arrows overlap on screen
    const prioritizedDot =
      (!this.sameNode(hit.node, this.store.selectedNode) || hit.side === -1) && hit.distPx <= 14;

    if (!prioritizedDot) {
      const isSpecificGizmoHandle =
        gizmoAxis !== null && gizmoAxis !== 'XYZ' && gizmoAxis !== 'XYZE';
      if (isSpecificGizmoHandle) return;
      // If hovering XYZ/XYZE center gizmo on the already-selected +X dot, let TransformControls drag it natively
      if (gizmoAxis && this.sameNode(hit.node, this.store.selectedNode)) return;
    }

    const active = this.store.getActivePart();
    if (active.enabled === false) return;

    e.stopPropagation();
    (e as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();

    this.hoveredNode = hit.node;
    this.store.setSelectedNode(hit.node);

    this.isDraggingDot = true;
    this.hasMovedDotDrag = false;
    this.dragDotSide = hit.side;
    this.activeDotPointerId = e.pointerId;
    this.orbitControls.enabled = false;
    this.transformControls.enabled = false;
    this.domElement.style.cursor = 'grabbing';
    this.dragStartGrid = cloneGrid(this.getActiveGrid(active));
    this.dragStartAnchorPos.copy(this.proxyAnchor.position);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.dotDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.worldPt);

    this.raycaster.setFromCamera(ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.dotDragPlane, this.dotDragStartWorld)) {
      this.dotDragStartWorld.copy(hit.worldPt);
    }

    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in headless / synthetic PointerEvent environments
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.root.visible) return;
    const { ndc } = this.getDomCoords(e);

    if (this.isDraggingDot && this.dragStartGrid) {
      const movePx = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      if (!this.hasMovedDotDrag) {
        if (movePx <= 3) return;
        this.hasMovedDotDrag = true;
        this.store.pushUndoCheckpoint();
      }

      this.raycaster.setFromCamera(ndc, this.camera);
      const currWorld = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dotDragPlane, currWorld)) {
        const deltaPos = currWorld.sub(this.dotDragStartWorld);
        if (this.dragDotSide === -1) {
          deltaPos.x = -deltaPos.x;
        }
        this.applyGridDeformation('translate', deltaPos);
      }
      return;
    }

    if (this.isDraggingGizmo) return;

    const hit = this.pickClosestHandleNode(e);
    const prioritizedDot =
      hit !== null &&
      (!this.sameNode(hit.node, this.store.selectedNode) || hit.side === -1) &&
      hit.distPx <= 14;
    const gizmoAxis = (this.transformControls as unknown as { axis: string | null }).axis;
    if (gizmoAxis && !prioritizedDot) {
      if (this.hoveredNode !== null) {
        this.hoveredNode = null;
        this.updateHandleVisuals();
      }
      return;
    }

    const nextHover = hit ? hit.node : null;
    if (!this.sameNode(nextHover, this.hoveredNode)) {
      this.hoveredNode = nextHover;
      this.updateHandleVisuals();
    }
    this.domElement.style.cursor = hit ? 'grab' : '';
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isDraggingDot) {
      this.endDotDrag(true);
      return;
    }

    if (!this.root.visible || this.isDraggingGizmo) return;
    if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 5) {
      return;
    }

    const { ndc } = this.getDomCoords(e);
    const handleHit = this.pickClosestHandleNode(e);
    if (handleHit) {
      this.store.setSelectedNode(handleHit.node);
      return;
    }

    this.raycaster.setFromCamera(ndc, this.camera);

    // Test clicking any car surface (selects part AND moves gizmo to nearest dense node)
    const partMeshMap = this.getPartMeshes();
    const candidateMeshes: THREE.Mesh[] = [];
    for (const mesh of partMeshMap.values()) {
      if (!mesh.visible) continue;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox && this.raycaster.ray.intersectsBox(mesh.geometry.boundingBox)) {
        candidateMeshes.push(mesh);
      }
    }
    if (candidateMeshes.length > 0) {
      const partHits = this.raycaster.intersectObjects(candidateMeshes, false);
      if (partHits.length > 0) {
        const hit = partHits[0];
        const hitMesh = hit.object as THREE.Mesh;
        const hitPartId = hitMesh.userData.partId as PartId | undefined;
        if (hitPartId) {
          if (hitPartId !== this.store.activePartId) {
            this.store.setActivePart(hitPartId);
          }
          const targetPart = this.store.parts[hitPartId];
          const targetGrid = this.getActiveGrid(targetPart);
          const hx = Math.abs(hit.point.x);
          const hy = hit.point.y;
          const hz = hit.point.z;
          let bestU = 0;
          let bestV = 0;
          let bestD2 = Infinity;
          for (let u = 0; u < targetGrid.length; u++) {
            const col = targetGrid[u];
            for (let v = 0; v < col.length; v++) {
              const p = col[v];
              const dx = p.x - hx;
              const dy = p.y - hy;
              const dz = p.z - hz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bestD2) {
                bestD2 = d2;
                bestU = u;
                bestV = v;
              }
            }
          }
          this.store.setSelectedNode({ u: bestU, v: bestV });
        }
      }
    }
  };
}
