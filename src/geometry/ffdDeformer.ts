import * as THREE from 'three';
import {
  buildProceduralElementsForPart,
  computeProceduralSignature,
} from './proceduralElements';
import { cpToRgb, separationToRgb } from './splineSurface';
import {
  clampPointToLegalityBoxes,
  cloneGrid,
  signedMarginInUnion,
} from '../regulations/fia2026';
import {
  ActiveAeroMode,
  AeroPartData,
  LegalityBox,
  MacroAeroPanel,
  PartId,
  PartSurfaceCpMap,
  SurfaceVizMode,
  Vec3,
} from '../types/aero';

const K_WEIGHTS = 6;

interface RepBinEntry {
  i0: number;
  i1: number;
  i2: number;
  area: number;
  su: number;
  sv: number;
  tx: number;
  ty: number;
  tz: number;
}

function bilinearSample(grid: number[][], su: number, sv: number): number {
  const nu = grid.length - 1;
  const nv = grid[0].length - 1;
  const fu = Math.max(0, Math.min(1, su)) * nu;
  const fv = Math.max(0, Math.min(1, sv)) * nv;
  const i0 = Math.min(nu - 1, Math.floor(fu));
  const j0 = Math.min(nv - 1, Math.floor(fv));
  const tu = fu - i0;
  const tv = fv - j0;
  return (
    (1 - tu) * (1 - tv) * grid[i0][j0] +
    tu * (1 - tv) * grid[i0 + 1][j0] +
    (1 - tu) * tv * grid[i0][j0 + 1] +
    tu * tv * grid[i0 + 1][j0 + 1]
  );
}

/**
 * High-performance 3D Cage / Smooth Shepard-Gaussian Free-Form Deformer (FFD)
 * bound directly to the real welded vertices of a 2026 F1 aerodynamic component mesh
 * plus its spliced 3D procedural aerodynamic elements.
 */
export class PartFFDController {
  public readonly partId: PartId;
  public readonly geometry: THREE.BufferGeometry;
  public vertexCount = 0;

  private readonly baseRestPositions: Float32Array;
  private readonly baseIndices: Uint32Array;
  private readonly baseRestColors: Float32Array | null;
  private lastProcSig = '__uninitialized__';

  private restPositions!: Float32Array;
  private restNormals!: Float32Array;
  private restColors: Float32Array | null = null;
  private seamPinFactor!: Float32Array;
  private restMargins!: Float32Array;
  private vertexSu!: Float32Array;
  private vertexSv!: Float32Array;
  private centerlineFlags!: Uint8Array;

  private readonly baselineGrid: Vec3[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly restNodesX: Float32Array;
  private readonly restNodesY: Float32Array;
  private readonly restNodesZ: Float32Array;
  private readonly invScaleX: number;
  private readonly invScaleY: number;
  private readonly invScaleZ: number;

  private weightNodeIdx!: Uint8Array;
  private weightNodeVal!: Float32Array;

  private repBins: RepBinEntry[] = [];
  private legalitySampleIndices!: Uint32Array;

  private minAbsX = Infinity;
  private maxAbsX = -Infinity;
  private minZ = Infinity;
  private maxZ = -Infinity;

  constructor(
    baselinePart: AeroPartData,
    restPositions: Float32Array,
    indices: Uint32Array,
    _seamPinFactor: Float32Array,
    restColors: Float32Array | null = null
  ) {
    this.partId = baselinePart.id;
    this.baseRestPositions = restPositions;
    this.baseIndices = indices;
    this.baseRestColors = restColors;

    this.cols = baselinePart.cols;
    this.rows = baselinePart.rows;
    this.baselineGrid = cloneGrid(baselinePart.grid);

    const numNodes = this.cols * this.rows;
    this.restNodesX = new Float32Array(numNodes);
    this.restNodesY = new Float32Array(numNodes);
    this.restNodesZ = new Float32Array(numNodes);

    let gMinX = Infinity, gMaxX = -Infinity;
    let gMinY = Infinity, gMaxY = -Infinity;
    let gMinZ = Infinity, gMaxZ = -Infinity;

    let ptr = 0;
    for (let u = 0; u < this.cols; u++) {
      for (let v = 0; v < this.rows; v++) {
        const pt = this.baselineGrid[u][v];
        this.restNodesX[ptr] = pt.x;
        this.restNodesY[ptr] = pt.y;
        this.restNodesZ[ptr] = pt.z;
        if (pt.x < gMinX) gMinX = pt.x;
        if (pt.x > gMaxX) gMaxX = pt.x;
        if (pt.y < gMinY) gMinY = pt.y;
        if (pt.y > gMaxY) gMaxY = pt.y;
        if (pt.z < gMinZ) gMinZ = pt.z;
        if (pt.z > gMaxZ) gMaxZ = pt.z;
        ptr++;
      }
    }

    // Anisotropic kernel scales matching control lattice spacing so 3D features
    // (e.g., sidepod undercut vs upper deck, wing cascade vs lower endplate) decouple cleanly
    this.invScaleX = 1.0 / Math.max(0.11, ((gMaxX - gMinX) / Math.max(1, this.cols - 1)) * 0.95);
    this.invScaleY = 1.0 / Math.max(0.10, (gMaxY - gMinY) * 0.45);
    this.invScaleZ = 1.0 / Math.max(0.13, ((gMaxZ - gMinZ) / Math.max(1, this.rows - 1)) * 0.95);

    this.geometry = new THREE.BufferGeometry();
    this.syncProceduralGeometry(baselinePart);
  }

  /**
   * Synchronize enabled 3D procedural aero elements into the welded part geometry,
   * FFD weight tables, CFD macro-panel bins, and FIA legality sample points.
   * Returns true if the procedural mesh was rebuilt, or false if unchanged.
   */
  public syncProceduralGeometry(part: AeroPartData): boolean {
    const sig = computeProceduralSignature(part);
    if (sig === this.lastProcSig) {
      return false;
    }
    this.lastProcSig = sig;

    const proc = buildProceduralElementsForPart(part);
    const baseVertCount = this.baseRestPositions.length / 3;
    const procVertCount = proc.positions.length / 3;
    const totalVerts = baseVertCount + procVertCount;

    let mergedPos: Float32Array;
    let mergedIdx: Uint32Array;
    let mergedCol: Float32Array | null = null;

    if (procVertCount === 0) {
      mergedPos = this.baseRestPositions;
      mergedIdx = this.baseIndices;
      mergedCol = this.baseRestColors;
    } else {
      mergedPos = new Float32Array(totalVerts * 3);
      mergedPos.set(this.baseRestPositions, 0);
      mergedPos.set(proc.positions, this.baseRestPositions.length);

      mergedIdx = new Uint32Array(this.baseIndices.length + proc.indices.length);
      mergedIdx.set(this.baseIndices, 0);
      const idxOffset = this.baseIndices.length;
      for (let i = 0; i < proc.indices.length; i++) {
        mergedIdx[idxOffset + i] = proc.indices[i] + baseVertCount;
      }

      if (this.baseRestColors) {
        mergedCol = new Float32Array(totalVerts * 3);
        mergedCol.set(this.baseRestColors, 0);
        for (let i = baseVertCount * 3; i < totalVerts * 3; i += 3) {
          mergedCol[i] = 0.14;
          mergedCol[i + 1] = 0.16;
          mergedCol[i + 2] = 0.19;
        }
      }
    }

    this.vertexCount = totalVerts;
    this.restPositions = mergedPos;
    this.restColors = mergedCol;
    this.seamPinFactor = new Float32Array(totalVerts);
    this.seamPinFactor.fill(1.0);

    // Compute mesh bounds on +X
    this.minAbsX = Infinity;
    this.maxAbsX = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    for (let i = 0; i < this.vertexCount; i++) {
      const ax = Math.abs(mergedPos[i * 3]);
      const z = mergedPos[i * 3 + 2];
      if (ax < this.minAbsX) this.minAbsX = ax;
      if (ax > this.maxAbsX) this.maxAbsX = ax;
      if (z < this.minZ) this.minZ = z;
      if (z > this.maxZ) this.maxZ = z;
    }

    const spanX = Math.max(0.08, this.maxAbsX - this.minAbsX);
    const spanZ = Math.max(0.12, this.maxZ - this.minZ);
    const numNodes = this.cols * this.rows;

    this.weightNodeIdx = new Uint8Array(this.vertexCount * K_WEIGHTS);
    this.weightNodeVal = new Float32Array(this.vertexCount * K_WEIGHTS);
    this.restMargins = new Float32Array(this.vertexCount);
    this.vertexSu = new Float32Array(this.vertexCount);
    this.vertexSv = new Float32Array(this.vertexCount);
    this.centerlineFlags = new Uint8Array(this.vertexCount);

    const tmpDist2 = new Float32Array(numNodes);
    const topIdx = new Int32Array(K_WEIGHTS);
    const topW = new Float32Array(K_WEIGHTS);

    for (let i = 0; i < this.vertexCount; i++) {
      const o = i * 3;
      const x = mergedPos[o];
      const ax = Math.abs(x);
      const y = mergedPos[o + 1];
      const z = mergedPos[o + 2];

      if (part.centerlineLocked && ax < 0.0025) {
        this.centerlineFlags[i] = 1;
      }

      this.vertexSu[i] = Math.max(0, Math.min(1, (ax - this.minAbsX) / spanX));
      this.vertexSv[i] = Math.max(0, Math.min(1, (z - this.minZ) / spanZ));
      this.restMargins[i] = signedMarginInUnion(
        { x: ax, y, z },
        part.legalityBoxes
      );

      for (let m = 0; m < numNodes; m++) {
        const dx = (ax - this.restNodesX[m]) * this.invScaleX;
        const dy = (y - this.restNodesY[m]) * this.invScaleY;
        const dz = (z - this.restNodesZ[m]) * this.invScaleZ;
        tmpDist2[m] = dx * dx + dy * dy + dz * dz;
      }

      topIdx.fill(0);
      topW.fill(0);

      // Select K_WEIGHTS closest nodes and compute smooth Shepard-Gaussian weights
      for (let k = 0; k < Math.min(K_WEIGHTS, numNodes); k++) {
        let bestM = -1;
        let bestD2 = Infinity;
        for (let m = 0; m < numNodes; m++) {
          if (tmpDist2[m] < bestD2) {
            bestD2 = tmpDist2[m];
            bestM = m;
          }
        }
        if (bestM < 0) break;
        tmpDist2[bestM] = Infinity; // mark visited
        topIdx[k] = bestM;
        // Smooth inverse-quadratic + Gaussian decay prevents kinks & long-range bleed
        topW[k] = Math.exp(-0.55 * bestD2) / (0.08 + bestD2 * 0.85);
      }

      let wSum = 0;
      for (let k = 0; k < K_WEIGHTS; k++) wSum += topW[k];
      const invSum = wSum > 1e-8 ? 1.0 / wSum : 0;

      const baseK = i * K_WEIGHTS;
      for (let k = 0; k < K_WEIGHTS; k++) {
        this.weightNodeIdx[baseK + k] = topIdx[k];
        this.weightNodeVal[baseK + k] = topW[k] * invSum;
      }
    }

    // Update Three.js BufferGeometry in-place with dynamic position/color/normal buffers
    const livePos = new Float32Array(mergedPos);
    const liveCol = new Float32Array(this.vertexCount * 3);
    const posAttr = new THREE.BufferAttribute(livePos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(liveCol, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.deleteAttribute('normal');
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('color', colAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    normAttr.setUsage(THREE.DynamicDrawUsage);
    this.restNormals = new Float32Array(normAttr.array as Float32Array);

    // Precompute area-weighted representative CFD macro-panels from +X mesh triangles
    this.repBins = [];
    this.buildRepresentativePanels(mergedIdx, spanX, spanZ);

    // Precompute ~420 legality sample vertex indices on +X
    const candidates: number[] = [];
    const step = Math.max(1, Math.floor(this.vertexCount / 900));
    for (let i = 0; i < this.vertexCount; i += step) {
      if (mergedPos[i * 3] >= -0.001 && this.seamPinFactor[i] > 0.35) {
        candidates.push(i);
      }
    }
    this.legalitySampleIndices = new Uint32Array(candidates);

    return true;
  }

  private buildRepresentativePanels(
    indices: Uint32Array,
    spanX: number,
    spanZ: number
  ): void {
    const uBins = 14;
    const vBins = 12;
    const orientBins = 2; // 0 = lower/inboard facing, 1 = upper/outboard facing
    const totalBins = uBins * vBins * orientBins;

    const sumArea = new Float32Array(totalBins);
    const bestTriArea = new Float32Array(totalBins);
    const bestI0 = new Uint32Array(totalBins);
    const bestI1 = new Uint32Array(totalBins);
    const bestI2 = new Uint32Array(totalBins);
    const hasTri = new Uint8Array(totalBins);

    const pos = this.restPositions;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t];
      const i1 = indices[t + 1];
      const i2 = indices[t + 2];

      const x0 = pos[i0 * 3], y0 = pos[i0 * 3 + 1], z0 = pos[i0 * 3 + 2];
      const x1 = pos[i1 * 3], y1 = pos[i1 * 3 + 1], z1 = pos[i1 * 3 + 2];
      const x2 = pos[i2 * 3], y2 = pos[i2 * 3 + 1], z2 = pos[i2 * 3 + 2];

      const cx = (x0 + x1 + x2) / 3;
      if (cx < -0.0005) continue; // Only bin +X half-car (CFDSolver mirrors to -X for yaw!)

      const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
      const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
      const crx = e1y * e2z - e1z * e2y;
      const cry = e1z * e2x - e1x * e2z;
      const crz = e1x * e2y - e1y * e2x;
      const area = 0.5 * Math.hypot(crx, cry, crz);
      if (area < 1e-8) continue;

      const cz = (z0 + z1 + z2) / 3;
      const su = Math.max(0, Math.min(0.999, (Math.max(0, cx) - this.minAbsX) / spanX));
      const sv = Math.max(0, Math.min(0.999, (cz - this.minZ) / spanZ));

      const bu = Math.floor(su * uBins);
      const bv = Math.floor(sv * vBins);
      const bo = cry + 0.35 * crx >= 0 ? 1 : 0;
      const bIdx = (bo * uBins + bu) * vBins + bv;

      sumArea[bIdx] += area;
      if (!hasTri[bIdx] || area > bestTriArea[bIdx]) {
        hasTri[bIdx] = 1;
        bestTriArea[bIdx] = area;
        bestI0[bIdx] = i0;
        bestI1[bIdx] = i1;
        bestI2[bIdx] = i2;
      }
    }

    for (let b = 0; b < totalBins; b++) {
      if (!hasTri[b] || sumArea[b] < 1e-6) continue;
      const bo = Math.floor(b / (uBins * vBins));
      const rem = b % (uBins * vBins);
      const bu = Math.floor(rem / vBins);
      const bv = rem % vBins;
      // Note: closed manifold shells have both upper & lower skins; scale area by 0.52 so projected planform matches single-camber force laws cleanly
      this.repBins.push({
        i0: bestI0[b],
        i1: bestI1[b],
        i2: bestI2[b],
        area: sumArea[b] * 0.52,
        su: (bu + 0.5) / uBins,
        sv: (bv + 0.5) / vBins,
        tx: 0,
        ty: bo === 1 ? 0.05 : -0.05,
        tz: 1,
      });
    }
  }

  /**
   * Deform the real 3D mesh in-place from the current FFD control lattice.
   */
  public applyDeformation(
    currentGrid: Vec3[][],
    legalityBoxes: LegalityBox[],
    clampToFia: boolean,
    activeAeroMode: ActiveAeroMode
  ): void {
    const numNodes = this.cols * this.rows;
    const dxArr = new Float32Array(numNodes);
    const dyArr = new Float32Array(numNodes);
    const dzArr = new Float32Array(numNodes);

    let maxDelta = 0;
    let ptr = 0;
    for (let u = 0; u < this.cols; u++) {
      for (let v = 0; v < this.rows; v++) {
        const cur = currentGrid[u][v];
        const dx = cur.x - this.restNodesX[ptr];
        const dy = cur.y - this.restNodesY[ptr];
        const dz = cur.z - this.restNodesZ[ptr];
        dxArr[ptr] = dx;
        dyArr[ptr] = dy;
        dzArr[ptr] = dz;
        const mag = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (mag > maxDelta) maxDelta = mag;
        ptr++;
      }
    }

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const outPos = posAttr.array as Float32Array;
    const restPos = this.restPositions;
    const isXMode =
      activeAeroMode === 'x_mode' &&
      (this.partId === 'front_wing' || this.partId === 'rear_wing');

    // Fast shortcut if untouched baseline in Z-Mode
    if (maxDelta < 1e-5 && !isXMode) {
      outPos.set(restPos);
      posAttr.needsUpdate = true;
      const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
      (normAttr.array as Float32Array).set(this.restNormals);
      normAttr.needsUpdate = true;
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
      return;
    }

    const wIdx = this.weightNodeIdx;
    const wVal = this.weightNodeVal;
    const pins = this.seamPinFactor;
    const cFlags = this.centerlineFlags;
    const rMargins = this.restMargins;
    const vSv = this.vertexSv;

    for (let i = 0; i < this.vertexCount; i++) {
      const o = i * 3;
      const x0 = restPos[o];
      const y0 = restPos[o + 1];
      const z0 = restPos[o + 2];

      const pin = pins[i];
      let vx = x0;
      let vy = y0;
      let vz = z0;

      if (pin > 0.001 && maxDelta >= 1e-5) {
        const baseK = i * K_WEIGHTS;
        let ddx = 0;
        let ddy = 0;
        let ddz = 0;
        for (let k = 0; k < K_WEIGHTS; k++) {
          const m = wIdx[baseK + k];
          const w = wVal[baseK + k];
          ddx += dxArr[m] * w;
          ddy += dyArr[m] * w;
          ddz += dzArr[m] * w;
        }

        const side = x0 >= 0 ? 1 : -1;
        if (cFlags[i]) {
          vx = 0;
        } else {
          const newAbsX = Math.max(0.001, Math.abs(x0) + ddx * pin);
          vx = side * newAbsX;
        }
        vy = y0 + ddy * pin;
        vz = z0 + ddz * pin;

        // Enforce official FIA 2026 Reference Volume surface wall clamping on user deformations
        if (clampToFia && Math.abs(ddx) + Math.abs(ddy) + Math.abs(ddz) > 0.0004) {
          const ax = Math.abs(vx);
          const allowedFloor = Math.min(0, rMargins[i]) - 0.001;
          const mNow = signedMarginInUnion({ x: ax, y: vy, z: vz }, legalityBoxes);
          if (mNow < allowedFloor) {
            const clamped = clampPointToLegalityBoxes(
              { x: ax, y: vy, z: vz },
              legalityBoxes,
              cFlags[i] === 1
            );
            vx = cFlags[i] ? 0 : (vx >= 0 ? clamped.x : -clamped.x);
            vy = clamped.y;
            vz = clamped.z;
          }
        }
      }

      // 2026 FIA Active Aerodynamics X-Mode visual actuator deflection (Art. 3.10.9 & 3.11.6)
      if (isXMode) {
        const ax = Math.abs(vx);
        const sv = vSv[i];
        if (this.partId === 'rear_wing' && ax <= 0.535 && vy >= 0.72 && sv > 0.30) {
          // Upper active rear wing flaps rotate trailing-edge-down (-16 deg max) around front flap pivot
          const flapBlend = Math.min(1, (sv - 0.30) / 0.25) * Math.min(1, (0.545 - ax) / 0.04);
          const theta = -0.27 * flapBlend; // radians
          const pivotY = 0.785;
          const pivotZ = 2.08;
          const dyP = vy - pivotY;
          const dzP = vz - pivotZ;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          vy = pivotY + dyP * cosT + dzP * sinT;
          vz = pivotZ - dyP * sinT + dzP * cosT;
        } else if (this.partId === 'front_wing' && ax <= 0.580 && vy >= 0.135 && sv > 0.38) {
          // Movable front wing upper flaps flatten trailing-edge-down (-9.5 deg max)
          const flapBlend = Math.min(1, (sv - 0.38) / 0.25) * Math.min(1, (0.590 - ax) / 0.04);
          const theta = -0.165 * flapBlend;
          const pivotY = 0.165;
          const pivotZ = -2.42;
          const dyP = vy - pivotY;
          const dzP = vz - pivotZ;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          vy = pivotY + dyP * cosT + dzP * sinT;
          vz = pivotZ - dyP * sinT + dzP * cosT;
        }
      }

      outPos[o] = vx;
      outPos[o + 1] = vy;
      outPos[o + 2] = vz;
    }

    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  /**
   * Paint Carbon/Livery, Live Cp Pressure Coefficient, or Boundary-Layer Separation colors
   * directly onto the real 2026 car mesh vertices.
   */
  public applySurfaceColors(
    vizMode: SurfaceVizMode,
    accentHex: string,
    cpMap?: PartSurfaceCpMap,
    isSelectedPart = false
  ): void {
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const outCol = colAttr.array as Float32Array;
    const norms = normAttr.array as Float32Array;
    const vSu = this.vertexSu;
    const vSv = this.vertexSv;

    if (vizMode === 'carbon' || !cpMap) {
      if (this.restColors) {
        // Authentic PBR / baked vertex colors
        const boost = isSelectedPart ? 1.08 : 1.0;
        for (let i = 0; i < outCol.length; i++) {
          outCol[i] = Math.min(1, this.restColors[i] * boost);
        }
      } else {
        // Sleek FIA 2026 Wind-Tunnel Satin Carbon / Titanium CAD Shading
        const accent = new THREE.Color(accentHex);
        const tintAmt = isSelectedPart ? 0.20 : 0.09;
        const baseR = 0.135 + accent.r * tintAmt;
        const baseG = 0.150 + accent.g * tintAmt;
        const baseB = 0.175 + accent.b * tintAmt;

        for (let i = 0; i < this.vertexCount; i++) {
          const o = i * 3;
          const ny = norms[o + 1];
          const shade = 0.82 + 0.24 * Math.max(-0.5, ny);
          outCol[o] = Math.min(1, baseR * shade);
          outCol[o + 1] = Math.min(1, baseG * shade);
          outCol[o + 2] = Math.min(1, baseB * shade);
        }
      }
      colAttr.needsUpdate = true;
      return;
    }

    if (vizMode === 'stall') {
      for (let i = 0; i < this.vertexCount; i++) {
        const sep = bilinearSample(cpMap.separation, vSu[i], vSv[i]);
        const rgb = separationToRgb(sep);
        const o = i * 3;
        outCol[o] = rgb[0];
        outCol[o + 1] = rgb[1];
        outCol[o + 2] = rgb[2];
      }
      colAttr.needsUpdate = true;
      return;
    }

    // vizMode === 'cp': blend upper & lower surface Cp using real 3D vertex normal!
    for (let i = 0; i < this.vertexCount; i++) {
      const o = i * 3;
      const su = vSu[i];
      const sv = vSv[i];
      const ny = norms[o + 1];
      const nx = Math.abs(norms[o]);
      const upperBlend = Math.max(0, Math.min(1, 0.5 + 0.65 * ny + 0.2 * nx));
      const cpUp = bilinearSample(cpMap.upperCp, su, sv);
      const cpLo = bilinearSample(cpMap.lowerCp, su, sv);
      const cp = cpLo + (cpUp - cpLo) * upperBlend;
      const rgb = cpToRgb(cp);
      outCol[o] = rgb[0];
      outCol[o + 1] = rgb[1];
      outCol[o + 2] = rgb[2];
    }
    colAttr.needsUpdate = true;
  }

  /**
   * Extract real deformed 3D surface macro-panels (centroids, areas, and normals) for CFDSolver.
   */
  public extractDeformedMacroPanels(): MacroAeroPanel[] {
    const pos = (this.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    const panels: MacroAeroPanel[] = new Array(this.repBins.length);

    for (let b = 0; b < this.repBins.length; b++) {
      const bin = this.repBins[b];
      const o0 = bin.i0 * 3;
      const o1 = bin.i1 * 3;
      const o2 = bin.i2 * 3;

      const x0 = pos[o0], y0 = pos[o0 + 1], z0 = pos[o0 + 2];
      const x1 = pos[o1], y1 = pos[o1 + 1], z1 = pos[o1 + 2];
      const x2 = pos[o2], y2 = pos[o2 + 1], z2 = pos[o2 + 2];

      const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
      const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;

      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      // Local streamwise tangent projected onto the deformed triangle plane: T = normalize((0,0,1) - nz * N)
      let tx = -nz * nx;
      let ty = -nz * ny;
      let tz = 1.0 - nz * nz;
      const tLen = Math.hypot(tx, ty, tz);
      if (tLen > 1e-4) {
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;
      } else {
        tx = 0;
        ty = ny >= 0 ? 0.1 : -0.1;
        tz = 0.995;
      }

      panels[b] = {
        cx: Math.max(0, (x0 + x1 + x2) / 3),
        cy: (y0 + y1 + y2) / 3,
        cz: (z0 + z1 + z2) / 3,
        nx,
        ny,
        nz,
        tx,
        ty,
        tz,
        area: bin.area,
        su: bin.su,
        sv: bin.sv,
      };
    }

    return panels;
  }

  /**
   * Sample deformed +X mesh vertices for real-time FIA Reference Volume compliance verification.
   */
  public sampleDeformedPointsForLegality(): Vec3[] {
    const pos = (this.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    const pts: Vec3[] = new Array(this.legalitySampleIndices.length);
    for (let k = 0; k < this.legalitySampleIndices.length; k++) {
      const o = this.legalitySampleIndices[k] * 3;
      pts[k] = {
        x: Math.abs(pos[o]),
        y: pos[o + 1],
        z: pos[o + 2],
      };
    }
    return pts;
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}
