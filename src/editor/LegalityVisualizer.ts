import * as THREE from 'three';
import { LegalityBox } from '../types/aero';

/**
 * Renders 3D Official 2026 FIA Appendix 1 Reference Volumes (including tapered lateral
 * coke-bottle/nose frusta, sloped vertical planes, and wheel-clearance arcs)
 * for the currently selected aerodynamic component.
 */
export class LegalityVisualizer {
  public readonly root = new THREE.Group();

  private visibleFlag = true;

  constructor() {
    this.root.name = 'FIALegalityBoxes';
  }

  public setVisible(visible: boolean): void {
    this.visibleFlag = visible;
    this.root.visible = visible;
  }

  public isVisible(): boolean {
    return this.visibleFlag;
  }

  public clear(): void {
    while (this.root.children.length > 0) {
      const child = this.root.children.pop()!;
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
  }

  public rebuildForPart(boxes: LegalityBox[], isLegal: boolean): void {
    this.clear();

    const edgeColor = isLegal ? 0x10b981 : 0xef4444;
    const mirrorEdgeColor = isLegal ? 0x0d9488 : 0xb91c1c;
    const fillColor = isLegal ? 0x10b981 : 0xef4444;

    for (const box of boxes) {
      // Render primary +X sculpt box (bright wireframe + subtle translucent volume)
      this.addFrustumBoxMesh(box, 1, edgeColor, fillColor, 0.055, 0.88);
      // Render mirrored -X reference box (subtle wireframe so full 2026 car width envelope is clear)
      this.addFrustumBoxMesh(box, -1, mirrorEdgeColor, fillColor, 0.018, 0.30);
    }
  }

  private addFrustumBoxMesh(
    box: LegalityBox,
    side: 1 | -1,
    edgeHex: number,
    fillHex: number,
    fillOpacity: number,
    edgeOpacity: number
  ): void {
    const xf0 = (box.minXFront ?? box.minX) * side;
    const xf1 = (box.maxXFront ?? box.maxX) * side;
    const xr0 = (box.minXRear ?? box.minX) * side;
    const xr1 = (box.maxXRear ?? box.maxX) * side;

    const minXF = Math.min(xf0, xf1);
    const maxXF = Math.max(xf0, xf1);
    const minXR = Math.min(xr0, xr1);
    const maxXR = Math.max(xr0, xr1);

    const z0 = box.minZ;
    const z1 = box.maxZ;

    // 8 corners of the tapered & sloped FIA Reference Volume frustum
    const c = [
      new THREE.Vector3(minXF, box.minYFront, z0), // 0: front-bottom-left
      new THREE.Vector3(maxXF, box.minYFront, z0), // 1: front-bottom-right
      new THREE.Vector3(maxXF, box.maxYFront, z0), // 2: front-top-right
      new THREE.Vector3(minXF, box.maxYFront, z0), // 3: front-top-left
      new THREE.Vector3(minXR, box.minYRear, z1),  // 4: rear-bottom-left
      new THREE.Vector3(maxXR, box.minYRear, z1),  // 5: rear-bottom-right
      new THREE.Vector3(maxXR, box.maxYRear, z1),  // 6: rear-top-right
      new THREE.Vector3(minXR, box.maxYRear, z1),  // 7: rear-top-left
    ];

    const positions: number[] = [];
    for (const pt of c) {
      positions.push(pt.x, pt.y, pt.z);
    }

    const indices = [
      0, 2, 1, 0, 3, 2, // Front
      4, 5, 6, 4, 6, 7, // Rear
      0, 1, 5, 0, 5, 4, // Bottom
      3, 6, 2, 3, 7, 6, // Top
      1, 2, 6, 1, 6, 5, // Right
      0, 4, 7, 0, 7, 3, // Left
    ];

    const volGeo = new THREE.BufferGeometry();
    volGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    volGeo.setIndex(indices);
    volGeo.computeVertexNormals();

    const volMat = new THREE.MeshBasicMaterial({
      color: fillHex,
      transparent: true,
      opacity: fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.root.add(new THREE.Mesh(volGeo, volMat));

    // Crisp CAD 12-edge wireframe
    const edgePairs = [
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ];
    const linePos: number[] = [];
    for (const idx of edgePairs) {
      linePos.push(c[idx].x, c[idx].y, c[idx].z);
    }

    // Optional wheel exclusion arc wireframe (e.g. D=825mm front tire clearance in RV-FWEP)
    if (box.wheelCutout) {
      const wc = box.wheelCutout;
      const segs = 16;
      const xArc = maxXR;
      for (let s = 0; s < segs; s++) {
        const a0 = Math.PI * (0.85 + 0.55 * (s / segs));
        const a1 = Math.PI * (0.85 + 0.55 * ((s + 1) / segs));
        const zA = wc.axleZ + Math.cos(a0) * wc.radius;
        const yA = wc.axleY + Math.sin(a0) * wc.radius;
        const zB = wc.axleZ + Math.cos(a1) * wc.radius;
        const yB = wc.axleY + Math.sin(a1) * wc.radius;
        if (zA >= z0 - 0.02 && zA <= z1 + 0.02 && yA >= box.minYRear - 0.02 && yA <= box.maxYRear + 0.02) {
          linePos.push(xArc, yA, zA, xArc, yB, zB);
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: edgeHex,
      transparent: true,
      opacity: edgeOpacity,
    });
    this.root.add(new THREE.LineSegments(lineGeo, lineMat));
  }
}
