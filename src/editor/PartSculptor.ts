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
import { checkAntiFold, isNodeOnLockedHardpoint } from './constraints';

export class PartSculptor {
  public readonly root = new THREE.Group();
  public readonly transformControls: TransformControls;

  private readonly proxyAnchor = new THREE.Object3D();
  private readonly handleGroup = new THREE.Group();
  private readonly mirrorHandleGroup = new THREE.Group();
  private cageLines: THREE.LineSegments | null = null;
  private mirrorCageLines: THREE.LineSegments | null = null;

  private handleMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = new THREE.Vector2();

  private isDraggingGizmo = false;
  private dragStartGrid: Vec3[][] | null = null;
  private dragStartAnchorPos = new THREE.Vector3();
  private dragStartAnchorQuat = new THREE.Quaternion();
  private lastCfdUpdateMs = 0;

  private readonly macroSphereGeo = new THREE.SphereGeometry(0.024, 14, 12);
  private readonly detailSphereGeo = new THREE.SphereGeometry(0.013, 10, 8);
  private readonly mirrorMacroSphereGeo = new THREE.SphereGeometry(0.015, 10, 8);
  private readonly mirrorDetailSphereGeo = new THREE.SphereGeometry(0.009, 8, 6);

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
    this.transformControls.setSize(0.78);
    this.transformControls.setSpace('world');
    this.root.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.isDraggingGizmo = dragging;
      this.orbitControls.enabled = !dragging;

      const active = this.store.getActivePart();
      if (dragging) {
        this.store.pushUndoCheckpoint();
        const activeGrid = this.getActiveGrid(active);
        this.dragStartGrid = cloneGrid(activeGrid);
        this.dragStartAnchorPos.copy(this.proxyAnchor.position);
        this.dragStartAnchorQuat.copy(this.proxyAnchor.quaternion);
      } else {
        this.dragStartGrid = null;
        this.store.syncBaseGridFromCurrent(active.id);
        this.store.runCFD();
        this.store.emit();
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.isDraggingGizmo || !this.dragStartGrid) return;
      this.applyGizmoTransform();
    });

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
  }

  public setCamera(cam: THREE.Camera): void {
    this.camera = cam;
    this.transformControls.camera = cam;
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.transformControls.enabled = visible;
    if (!visible) {
      this.transformControls.detach();
    } else {
      this.syncFromStore();
    }
  }

  private getActiveGrid(part: AeroPartData): Vec3[][] {
    if (this.store.activeHandleLevel === 'detail' && part.cage) {
      return part.cage.detail;
    }
    return part.cage?.macro ?? part.grid;
  }

  private getActiveDimensions(part: AeroPartData): { cols: number; rows: number } {
    if (this.store.activeHandleLevel === 'detail' && part.cage) {
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
      const isDetail = this.store.activeHandleLevel === 'detail';
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
    const isDetail = this.store.activeHandleLevel === 'detail';

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
    const isDetail = this.store.activeHandleLevel === 'detail';

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
    const part = this.store.getActivePart();
    const { cols, rows } = this.getActiveDimensions(part);

    const deltaPos = new THREE.Vector3().subVectors(
      this.proxyAnchor.position,
      this.dragStartAnchorPos
    );
    const invStartQuat = this.dragStartAnchorQuat.clone().invert();
    const deltaQuat = new THREE.Quaternion().multiplyQuaternions(
      this.proxyAnchor.quaternion,
      invStartQuat
    );

    const identityQuat = new THREE.Quaternion();
    const tempVec = new THREE.Vector3();
    const weightedQuat = new THREE.Quaternion();

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

        // Prevent dragging locked chassis hardpoint anchors
        if (isNodeOnLockedHardpoint(part.id, u, v, cols, rows)) {
          candidateGrid[u][v] = { ...startPt };
          continue;
        }

        if (this.store.gizmoMode === 'rotate') {
          weightedQuat.slerpQuaternions(identityQuat, deltaQuat, w);
          tempVec
            .set(startPt.x, startPt.y, startPt.z)
            .sub(this.dragStartAnchorPos)
            .applyQuaternion(weightedQuat)
            .add(this.dragStartAnchorPos);
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

    // Anti-fold surface verification: reject if inverted
    const antiFold = checkAntiFold(candidateGrid, this.dragStartGrid);
    if (!antiFold.valid) {
      // Quad fold or self-intersection prevented: keep current
      return;
    }

    // Apply valid candidate movement through store with seam synchronization
    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        const candidate = candidateGrid[u][v];
        this.store.updatePartGridNode(part.id, u, v, candidate, this.store.activeHandleLevel);
      }
    }

    // Keep proxy anchor visually synced to clamped primary node in single-node translate mode
    if (this.store.selectMode === 'node' && this.store.gizmoMode === 'translate') {
      const activeGrid = this.getActiveGrid(part);
      const selU = Math.min(cols - 1, Math.max(0, this.store.selectedNode.u));
      const selV = Math.min(rows - 1, Math.max(0, this.store.selectedNode.v));
      const pClamped = activeGrid[selU][selV];
      this.proxyAnchor.position.set(pClamped.x, pClamped.y, pClamped.z);
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

    if (!this.isDraggingGizmo) {
      const anchor = this.computeAnchorPosition();
      this.proxyAnchor.position.copy(anchor);
      this.proxyAnchor.quaternion.identity();
      this.transformControls.attach(this.proxyAnchor);
    }

    this.rebuildHandles();
    this.updateCageAndHandles();
  }

  private rebuildHandles(): void {
    for (const h of this.handleMeshes) {
      (h.material as THREE.Material).dispose();
    }
    this.handleMeshes = [];
    this.handleGroup.clear();
    this.mirrorHandleGroup.clear();

    const part = this.store.getActivePart();
    const { cols, rows } = this.getActiveDimensions(part);
    const isDetail = this.store.activeHandleLevel === 'detail';

    const sphereGeo = isDetail ? this.detailSphereGeo : this.macroSphereGeo;
    const mirrorSphereGeo = isDetail ? this.mirrorDetailSphereGeo : this.mirrorMacroSphereGeo;

    const baseHex = isDetail ? 0xf59e0b : 0x38bdf8;
    const mirrorMat = new THREE.MeshBasicMaterial({
      color: baseHex,
      transparent: true,
      opacity: 0.35,
    });

    for (let u = 0; u < cols; u++) {
      for (let v = 0; v < rows; v++) {
        const mat = new THREE.MeshBasicMaterial({ color: baseHex });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.userData = { nodeIndex: { u, v } as NodeIndex };
        this.handleGroup.add(mesh);
        this.handleMeshes.push(mesh);

        if (!(part.centerlineLocked && u === 0)) {
          const mMesh = new THREE.Mesh(mirrorSphereGeo, mirrorMat);
          mMesh.userData = { mirrorOf: { u, v } };
          this.mirrorHandleGroup.add(mMesh);
        }
      }
    }
  }

  public updateCageAndHandles(): void {
    const part = this.store.getActivePart();
    const activeGrid = this.getActiveGrid(part);
    const { cols, rows } = this.getActiveDimensions(part);
    const isDetail = this.store.activeHandleLevel === 'detail';

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
      mesh.position.set(pt.x, pt.y, pt.z);

      const w = this.getNodeWeight(activeGrid, u, v);
      const inActiveZone = activeZone && activeUList.includes(u) && activeVList.includes(v);
      const isLegalNode = signedMarginInUnion(pt, part.legalityBoxes) >= -0.001;
      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (!isLegalNode) {
        mat.color.setHex(0xef4444);
        mesh.scale.setScalar(1.25);
      } else if (w >= 0.99 || inActiveZone) {
        mat.color.setHex(isDetail ? 0xfef08a : 0xfacc15);
        mesh.scale.setScalar(w >= 0.99 ? 1.3 : 1.18);
      } else if (w > 0.02) {
        mat.color.setHex(0xfb923c);
        mesh.scale.setScalar(1.0 + 0.25 * w);
      } else {
        mat.color.setHex(isDetail ? 0xf59e0b : 0x38bdf8);
        mesh.scale.setScalar(0.92);
      }

      if (!(part.centerlineLocked && u === 0)) {
        const mChild = this.mirrorHandleGroup.children[mirrorPtr++] as THREE.Mesh | undefined;
        if (mChild) {
          mChild.position.set(-pt.x, pt.y, pt.z);
        }
      }
    }

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
        new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: 0.78 })
      );
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
        new THREE.LineBasicMaterial({ color: mirrorColor, transparent: true, opacity: 0.25 })
      );
      this.root.add(this.mirrorCageLines);
    } else {
      (this.mirrorCageLines.material as THREE.LineBasicMaterial).color.setHex(mirrorColor);
      this.mirrorCageLines.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(posMinus, 3)
      );
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos.set(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.root.visible || this.isDraggingGizmo) return;
    if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 5) {
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    // Test control point handles on active part
    const handleHits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (handleHits.length > 0) {
      const node = handleHits[0].object.userData.nodeIndex as NodeIndex;
      this.store.setSelectedNode(node);
      return;
    }

    // Test clicking another car part
    const partMeshMap = this.getPartMeshes();
    const candidateMeshes: THREE.Mesh[] = [];
    for (const mesh of partMeshMap.values()) {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }
      if (mesh.geometry.boundingBox && this.raycaster.ray.intersectsBox(mesh.geometry.boundingBox)) {
        candidateMeshes.push(mesh);
      }
    }
    if (candidateMeshes.length > 0) {
      const partHits = this.raycaster.intersectObjects(candidateMeshes, false);
      if (partHits.length > 0) {
        const hitMesh = partHits[0].object as THREE.Mesh;
        const hitPartId = hitMesh.userData.partId as PartId | undefined;
        if (hitPartId && hitPartId !== this.store.activePartId) {
          this.store.setActivePart(hitPartId);
        }
      }
    }
  };
}
