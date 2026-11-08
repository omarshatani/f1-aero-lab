import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  clampPointToLegalityBoxes,
  cloneGrid,
  signedMarginInUnion,
} from '../regulations/fia2026';
import { CarProjectStore } from '../state/CarProjectStore';
import { NodeIndex, PartId, Vec3 } from '../types/aero';

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

  private readonly sphereGeo = new THREE.SphereGeometry(0.024, 14, 12);
  private readonly mirrorSphereGeo = new THREE.SphereGeometry(0.015, 10, 8);

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

      if (dragging) {
        this.store.pushUndoCheckpoint();
        const active = this.store.getActivePart();
        this.dragStartGrid = cloneGrid(active.grid);
        this.dragStartAnchorPos.copy(this.proxyAnchor.position);
        this.dragStartAnchorQuat.copy(this.proxyAnchor.quaternion);
      } else {
        this.dragStartGrid = null;
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

  private computeAnchorPosition(): THREE.Vector3 {
    const part = this.store.getActivePart();
    const sel = this.store.selectedNode;
    const mode = this.store.selectMode;

    if (mode === 'node') {
      const p = part.grid[sel.u][sel.v];
      return new THREE.Vector3(p.x, p.y, p.z);
    }

    const acc = new THREE.Vector3();
    let count = 0;
    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        if (mode === 'span_rib' && u !== sel.u) continue;
        if (mode === 'chord_edge' && v !== sel.v) continue;
        acc.x += part.grid[u][v].x;
        acc.y += part.grid[u][v].y;
        acc.z += part.grid[u][v].z;
        count++;
      }
    }
    if (count > 0) acc.divideScalar(count);
    return acc;
  }

  private getNodeWeight(partGrid: Vec3[][], u: number, v: number): number {
    const sel = this.store.selectedNode;
    const mode = this.store.selectMode;

    if (mode === 'whole_part') return 1.0;
    if (mode === 'span_rib') return u === sel.u ? 1.0 : 0.0;
    if (mode === 'chord_edge') return v === sel.v ? 1.0 : 0.0;

    // mode === 'node'
    if (u === sel.u && v === sel.v) return 1.0;
    const radius = this.store.softFalloffRadius;
    if (radius <= 0.005) return 0.0;

    const p0 = partGrid[sel.u][sel.v];
    const p = partGrid[u][v];
    const dist = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    if (dist >= radius) return 0.0;
    // Smooth raised-cosine bell curve
    return 0.5 * (1 + Math.cos((Math.PI * dist) / radius));
  }

  private applyGizmoTransform(): void {
    if (!this.dragStartGrid) return;
    const part = this.store.getActivePart();

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

    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        const w = this.getNodeWeight(this.dragStartGrid, u, v);
        const startPt = this.dragStartGrid[u][v];
        if (w <= 0.0001) {
          part.grid[u][v] = { ...startPt };
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

        part.grid[u][v] = candidate;
      }
    }

    // Keep proxy anchor visually synced to clamped primary node in single-node translate mode
    if (this.store.selectMode === 'node' && this.store.gizmoMode === 'translate') {
      const pClamped = part.grid[this.store.selectedNode.u][this.store.selectedNode.v];
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

    // Ensure selectedNode is valid for current part
    if (this.store.selectedNode.u >= part.cols || this.store.selectedNode.v >= part.rows) {
      this.store.selectedNode = { u: part.cols - 1, v: part.rows - 1 };
    }

    this.transformControls.setMode(this.store.gizmoMode);

    // Lock X gizmo arrow if only a centerline-locked u=0 node is affected
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
    // Clear existing handles
    for (const h of this.handleMeshes) {
      (h.material as THREE.Material).dispose();
    }
    this.handleMeshes = [];
    this.handleGroup.clear();
    this.mirrorHandleGroup.clear();

    const part = this.store.getActivePart();
    const mirrorMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
    });

    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const mesh = new THREE.Mesh(this.sphereGeo, mat);
        mesh.userData = { nodeIndex: { u, v } as NodeIndex };
        this.handleGroup.add(mesh);
        this.handleMeshes.push(mesh);

        if (!(part.centerlineLocked && u === 0)) {
          const mMesh = new THREE.Mesh(this.mirrorSphereGeo, mirrorMat);
          mMesh.userData = { mirrorOf: { u, v } };
          this.mirrorHandleGroup.add(mMesh);
        }
      }
    }
  }

  public updateCageAndHandles(): void {
    const part = this.store.getActivePart();
    let mirrorPtr = 0;

    for (let i = 0; i < this.handleMeshes.length; i++) {
      const mesh = this.handleMeshes[i];
      const { u, v } = mesh.userData.nodeIndex as NodeIndex;
      const pt = part.grid[u][v];
      mesh.position.set(pt.x, pt.y, pt.z);

      const w = this.getNodeWeight(part.grid, u, v);
      const isLegalNode = signedMarginInUnion(pt, part.legalityBoxes) >= -0.001;
      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (!isLegalNode) {
        mat.color.setHex(0xef4444);
        mesh.scale.setScalar(1.25);
      } else if (w >= 0.99) {
        mat.color.setHex(0xfacc15);
        mesh.scale.setScalar(1.3);
      } else if (w > 0.02) {
        mat.color.setHex(0xfb923c);
        mesh.scale.setScalar(1.0 + 0.25 * w);
      } else {
        mat.color.setHex(0x38bdf8);
        mesh.scale.setScalar(0.92);
      }

      if (!(part.centerlineLocked && u === 0)) {
        const mChild = this.mirrorHandleGroup.children[mirrorPtr++] as THREE.Mesh | undefined;
        if (mChild) {
          mChild.position.set(-pt.x, pt.y, pt.z);
        }
      }
    }

    // Update control lattice wireframe on +X and -X
    const buildLatticePositions = (side: 1 | -1): Float32Array => {
      const segs = part.cols * (part.rows - 1) + (part.cols - 1) * part.rows;
      const arr = new Float32Array(segs * 2 * 3);
      let k = 0;
      // Chordwise lines
      for (let u = 0; u < part.cols; u++) {
        for (let v = 0; v < part.rows - 1; v++) {
          const a = part.grid[u][v];
          const b = part.grid[u][v + 1];
          arr[k++] = a.x * side;
          arr[k++] = a.y;
          arr[k++] = a.z;
          arr[k++] = b.x * side;
          arr[k++] = b.y;
          arr[k++] = b.z;
        }
      }
      // Spanwise ribs
      for (let u = 0; u < part.cols - 1; u++) {
        for (let v = 0; v < part.rows; v++) {
          const a = part.grid[u][v];
          const b = part.grid[u + 1][v];
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
    if (!this.cageLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posPlus, 3));
      this.cageLines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.78 })
      );
      this.root.add(this.cageLines);
    } else {
      this.cageLines.geometry.setAttribute('position', new THREE.BufferAttribute(posPlus, 3));
    }

    const posMinus = buildLatticePositions(-1);
    if (!this.mirrorCageLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posMinus, 3));
      this.mirrorCageLines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.25 })
      );
      this.root.add(this.mirrorCageLines);
    } else {
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
    // Ignore camera orbit drags (> 5px movement)
    if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 5) {
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    // 1. First test control point handles on active part
    const handleHits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (handleHits.length > 0) {
      const node = handleHits[0].object.userData.nodeIndex as NodeIndex;
      this.store.setSelectedNode(node);
      return;
    }

    // 2. Test clicking another car part to switch active part directly in 3D!
    // Pre-filter by world/local boundingBox so high-poly FIA 2026 meshes raycast in < 2ms!
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
