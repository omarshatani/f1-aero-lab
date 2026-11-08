import * as THREE from 'three';
import { buildProceduralElementsForPart } from '../geometry/proceduralElements';
import { cpToRgb, separationToRgb } from '../geometry/splineSurface';
import {
  ActiveAeroMode,
  AeroPartData,
  MacroAeroPanel,
  PartId,
  PartSurfaceCpMap,
  SurfaceVizMode,
  Vec3,
} from '../types/aero';
import {
  bilinearLookup,
  evalCurveAlongArray,
  halfThicknessProfile,
} from './surfaceMath';
import { EvaluatedPartSurface, LODLevel } from './surfaceTypes';

export function getLODSteps(
  part: AeroPartData,
  lod: LODLevel
): { uSteps: number; vSteps: number } {
  if (lod === 'preview') {
    if (part.role === 'wing' || part.id === 'floor') {
      return { uSteps: 20, vSteps: 22 };
    }
    return { uSteps: 16, vSteps: 16 };
  }
  // Full high-resolution LOD target (~1,000,000 triangles total car)
  if (part.role === 'wing' || part.id === 'floor') {
    return { uSteps: 120, vSteps: 140 };
  }
  return { uSteps: 90, vSteps: 100 };
}

/**
 * High-performance bicubic Catmull-Rom patch evaluator producing watertight closed 3D shells
 * into zero-copy Float32Array and Uint32Array typed buffers, including welded procedural appendages
 * and 2026 FIA Active Aerodynamics flap deflections.
 */
export function evaluatePartSurface(
  part: AeroPartData,
  lod: LODLevel,
  vizMode: SurfaceVizMode = 'carbon',
  cpMap?: PartSurfaceCpMap,
  aeroMode: ActiveAeroMode = 'z_mode'
): EvaluatedPartSurface {
  const { uSteps, vSteps } = getLODSteps(part, lod);
  const grid = part.cage?.detail ?? part.grid;
  const macroCols = grid.length;

  // 1. Evaluate along v for each column u
  const colSampled: Vec3[][] = [];
  for (let u = 0; u < macroCols; u++) {
    const col: Vec3[] = [];
    for (let iv = 0; iv <= vSteps; iv++) {
      const sv = iv / vSteps;
      col.push(evalCurveAlongArray(grid[u], sv, false));
    }
    colSampled.push(col);
  }

  // 2. Evaluate across u for each iv slice
  const camberPoints: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );

  for (let iv = 0; iv <= vSteps; iv++) {
    const rowCtrl: Vec3[] = [];
    for (let u = 0; u < macroCols; u++) {
      rowCtrl.push(colSampled[u][iv]);
    }
    for (let iu = 0; iu <= uSteps; iu++) {
      const su = iu / uSteps;
      const pt = evalCurveAlongArray(rowCtrl, su, part.centerlineLocked && iu === 0);
      if (part.centerlineLocked && iu === 0) {
        pt.x = 0;
      } else {
        pt.x = Math.max(0, pt.x);
      }
      camberPoints[iu][iv] = pt;
    }
  }

  // 3. Compute surface normals via central differences
  const camberNormals: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );

  for (let iu = 0; iu <= uSteps; iu++) {
    const iuPrev = Math.max(0, iu - 1);
    const iuNext = Math.min(uSteps, iu + 1);
    for (let iv = 0; iv <= vSteps; iv++) {
      const ivPrev = Math.max(0, iv - 1);
      const ivNext = Math.min(vSteps, iv + 1);

      const puX = camberPoints[iuNext][iv].x - camberPoints[iuPrev][iv].x;
      const puY = camberPoints[iuNext][iv].y - camberPoints[iuPrev][iv].y;
      const puZ = camberPoints[iuNext][iv].z - camberPoints[iuPrev][iv].z;

      const pvX = camberPoints[iu][ivNext].x - camberPoints[iu][ivPrev].x;
      const pvY = camberPoints[iu][ivNext].y - camberPoints[iu][ivPrev].y;
      const pvZ = camberPoints[iu][ivNext].z - camberPoints[iu][ivPrev].z;

      const lu = Math.hypot(puX, puY, puZ) || 1;
      const lv = Math.hypot(pvX, pvY, pvZ) || 1;
      const tuX = puX / lu;
      const tuY = puY / lu;
      const tuZ = puZ / lu;

      const tvX = pvX / lv;
      const tvY = pvY / lv;
      const tvZ = pvZ / lv;

      // Right-hand cross product tv x tu -> +Y upward
      let nx = tvY * tuZ - tvZ * tuY;
      let ny = tvZ * tuX - tvX * tuZ;
      let nz = tvX * tuY - tvY * tuX;
      const ln = Math.hypot(nx, ny, nz) || 1;
      camberNormals[iu][iv] = { x: nx / ln, y: ny / ln, z: nz / ln };
    }
  }

  // 4. Shell vertex and index calculations
  const gridVerts = (uSteps + 1) * (vSteps + 1);
  const vertsPerHalf = gridVerts * 2; // Upper + Lower skins
  const shellVerts = vertsPerHalf * 2; // Starboard (+X) + Port (-X)

  const quadsPerSkin = uSteps * vSteps;
  const leQuads = uSteps;
  const teQuads = uSteps;
  const tipQuads = vSteps;
  const rootQuads = part.centerlineLocked ? 0 : vSteps;
  const trisPerHalf = (quadsPerSkin * 2 + leQuads + teQuads + tipQuads + rootQuads) * 2;
  const shellIndices = trisPerHalf * 2 * 3;

  // 5. Append welded procedural aerodynamic elements if active
  const proc = buildProceduralElementsForPart(part);
  const totalVerts = shellVerts + proc.vertexCount;
  const totalIndices = shellIndices + proc.indices.length;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  const hex = parseInt(part.accentHex.replace('#', ''), 16);
  const rAcc = ((hex >> 16) & 255) / 255;
  const gAcc = ((hex >> 8) & 255) / 255;
  const bAcc = (hex & 255) / 255;

  const carbonUpperR = 0.13 + rAcc * 0.22;
  const carbonUpperG = 0.15 + gAcc * 0.22;
  const carbonUpperB = 0.18 + bAcc * 0.22;
  const carbonLowerR = 0.1;
  const carbonLowerG = 0.11;
  const carbonLowerB = 0.13;

  const isXMode = aeroMode === 'x_mode';

  let posIdx = 0;
  let normIdx = 0;
  let colIdx = 0;
  let idxOffset = 0;

  const buildHalf = (mirrorX: number) => {
    const baseVert = posIdx / 3;
    const strideV = vSteps + 1;

    for (const skinSign of [1, -1]) {
      for (let iu = 0; iu <= uSteps; iu++) {
        const su = iu / uSteps;
        for (let iv = 0; iv <= vSteps; iv++) {
          const sv = iv / vSteps;
          const p = camberPoints[iu][iv];
          const n = camberNormals[iu][iv];
          const h = halfThicknessProfile(part, sv, su) * skinSign;

          let vx = (p.x + n.x * h) * mirrorX;
          if (part.centerlineLocked && iu === 0) {
            vx = 0;
          }
          let vy = p.y + n.y * h;
          let vz = p.z + n.z * h;

          // 2026 Active Aerodynamics X-Mode flap deflection
          if (isXMode) {
            const ax = Math.abs(vx);
            if (part.id === 'rear_wing' && ax <= 0.535 && vy >= 0.72 && sv > 0.30) {
              const flapBlend =
                Math.min(1, (sv - 0.30) / 0.25) * Math.min(1, (0.545 - ax) / 0.04);
              const theta = -0.27 * flapBlend;
              const pivotY = 0.785;
              const pivotZ = 2.08;
              const dyP = vy - pivotY;
              const dzP = vz - pivotZ;
              const cosT = Math.cos(theta);
              const sinT = Math.sin(theta);
              vy = pivotY + dyP * cosT + dzP * sinT;
              vz = pivotZ - dyP * sinT + dzP * cosT;
            } else if (part.id === 'front_wing' && ax <= 0.580 && vy >= 0.135 && sv > 0.38) {
              const flapBlend =
                Math.min(1, (sv - 0.38) / 0.25) * Math.min(1, (0.590 - ax) / 0.04);
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

          positions[posIdx++] = vx;
          positions[posIdx++] = vy;
          positions[posIdx++] = vz;

          normals[normIdx++] = n.x * skinSign * mirrorX;
          normals[normIdx++] = n.y * skinSign;
          normals[normIdx++] = n.z * skinSign;

          if (vizMode === 'cp' && cpMap) {
            const cpGrid = skinSign === 1 ? cpMap.upperCp : cpMap.lowerCp;
            const [cr, cg, cb] = cpToRgb(bilinearLookup(cpGrid, su, sv));
            colors[colIdx++] = cr;
            colors[colIdx++] = cg;
            colors[colIdx++] = cb;
          } else if (vizMode === 'stall' && cpMap) {
            const [sr, sg, sb] = separationToRgb(bilinearLookup(cpMap.separation, su, sv));
            colors[colIdx++] = sr;
            colors[colIdx++] = sg;
            colors[colIdx++] = sb;
          } else {
            if (skinSign === 1) {
              colors[colIdx++] = carbonUpperR;
              colors[colIdx++] = carbonUpperG;
              colors[colIdx++] = carbonUpperB;
            } else {
              colors[colIdx++] = carbonLowerR;
              colors[colIdx++] = carbonLowerG;
              colors[colIdx++] = carbonLowerB;
            }
          }
        }
      }
    }

    const upperIdx = (iu: number, iv: number) => baseVert + iu * strideV + iv;
    const lowerIdx = (iu: number, iv: number) => baseVert + gridVerts + iu * strideV + iv;

    const pushTri = (a: number, b: number, c: number) => {
      if (mirrorX === 1) {
        indices[idxOffset++] = a;
        indices[idxOffset++] = b;
        indices[idxOffset++] = c;
      } else {
        indices[idxOffset++] = a;
        indices[idxOffset++] = c;
        indices[idxOffset++] = b;
      }
    };

    // Upper & Lower skins
    for (let iu = 0; iu < uSteps; iu++) {
      for (let iv = 0; iv < vSteps; iv++) {
        // Upper skin
        const u00 = upperIdx(iu, iv);
        const u10 = upperIdx(iu + 1, iv);
        const u01 = upperIdx(iu, iv + 1);
        const u11 = upperIdx(iu + 1, iv + 1);
        pushTri(u00, u01, u11);
        pushTri(u00, u11, u10);

        // Lower skin
        const l00 = lowerIdx(iu, iv);
        const l10 = lowerIdx(iu + 1, iv);
        const l01 = lowerIdx(iu, iv + 1);
        const l11 = lowerIdx(iu + 1, iv + 1);
        pushTri(l00, l11, l01);
        pushTri(l00, l10, l11);
      }
    }

    // Leading edge stitch (iv = 0)
    for (let iu = 0; iu < uSteps; iu++) {
      pushTri(upperIdx(iu, 0), upperIdx(iu + 1, 0), lowerIdx(iu + 1, 0));
      pushTri(upperIdx(iu, 0), lowerIdx(iu + 1, 0), lowerIdx(iu, 0));
    }

    // Trailing edge stitch (iv = vSteps)
    for (let iu = 0; iu < uSteps; iu++) {
      pushTri(upperIdx(iu, vSteps), lowerIdx(iu + 1, vSteps), upperIdx(iu + 1, vSteps));
      pushTri(upperIdx(iu, vSteps), lowerIdx(iu, vSteps), lowerIdx(iu + 1, vSteps));
    }

    // Outer spanwise tip cap (iu = uSteps)
    for (let iv = 0; iv < vSteps; iv++) {
      pushTri(upperIdx(uSteps, iv), upperIdx(uSteps, iv + 1), lowerIdx(uSteps, iv + 1));
      pushTri(upperIdx(uSteps, iv), lowerIdx(uSteps, iv + 1), lowerIdx(uSteps, iv));
    }

    // Inner root cap if detached
    if (!part.centerlineLocked) {
      for (let iv = 0; iv < vSteps; iv++) {
        pushTri(upperIdx(0, iv), lowerIdx(0, iv + 1), upperIdx(0, iv + 1));
        pushTri(upperIdx(0, iv), lowerIdx(0, iv), lowerIdx(0, iv + 1));
      }
    }
  };

  buildHalf(1);
  buildHalf(-1);

  // Merge procedural element buffers if present
  if (proc.vertexCount > 0) {
    positions.set(proc.positions, posIdx);
    normals.set(proc.normals, normIdx);
    colors.set(proc.colors, colIdx);
    const baseOffset = shellVerts;
    for (let i = 0; i < proc.indices.length; i++) {
      indices[idxOffset++] = proc.indices[i] + baseOffset;
    }
  }

  return {
    partId: part.id,
    lod,
    positions,
    normals,
    colors,
    indices,
    vertexCount: totalVerts,
    triangleCount: totalIndices / 3,
  };
}

export function evaluateAllSurfaces(
  parts: Record<PartId, AeroPartData>,
  lod: LODLevel,
  vizMode: SurfaceVizMode = 'carbon',
  cpMaps?: Partial<Record<PartId, PartSurfaceCpMap>>,
  aeroMode: ActiveAeroMode = 'z_mode'
): Record<PartId, EvaluatedPartSurface> {
  const result = {} as Record<PartId, EvaluatedPartSurface>;
  for (const key of Object.keys(parts) as PartId[]) {
    result[key] = evaluatePartSurface(parts[key], lod, vizMode, cpMaps?.[key], aeroMode);
  }
  return result;
}

/**
 * Creates a Three.js BufferGeometry directly from an evaluated surface with zero memory duplication.
 */
export function createBufferGeometryFromSurface(
  surface: EvaluatedPartSurface
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(surface.colors, 3));
  geom.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Updates an existing Three.js BufferGeometry in-place, avoiding reallocation if buffer lengths match.
 */
export function updateBufferGeometryFromSurface(
  geom: THREE.BufferGeometry,
  surface: EvaluatedPartSurface
): void {
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  const idxAttr = geom.getIndex();

  if (
    posAttr &&
    posAttr.array.length === surface.positions.length &&
    normAttr &&
    normAttr.array.length === surface.normals.length &&
    colAttr &&
    colAttr.array.length === surface.colors.length &&
    idxAttr &&
    idxAttr.array.length === surface.indices.length
  ) {
    (posAttr.array as Float32Array).set(surface.positions);
    (normAttr.array as Float32Array).set(surface.normals);
    (colAttr.array as Float32Array).set(surface.colors);
    (idxAttr.array as Uint32Array).set(surface.indices);
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    idxAttr.needsUpdate = true;
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
  } else {
    geom.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(surface.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(surface.indices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
  }
}

/**
 * Updates vertex colors in-place on an existing Three.js BufferGeometry.
 */
export function updateSurfaceColors(
  geom: THREE.BufferGeometry,
  part: AeroPartData,
  vizMode: SurfaceVizMode,
  cpMap?: PartSurfaceCpMap,
  isSelectedPart = false
): void {
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!colAttr || !posAttr) return;

  const outCol = colAttr.array as Float32Array;
  const pos = posAttr.array as Float32Array;
  const count = posAttr.count;

  if (vizMode === 'carbon' || !cpMap) {
    const hex = parseInt(part.accentHex.replace('#', ''), 16);
    const rAcc = ((hex >> 16) & 255) / 255;
    const gAcc = ((hex >> 8) & 255) / 255;
    const bAcc = (hex & 255) / 255;
    const tintAmt = isSelectedPart ? 0.22 : 0.08;
    const baseR = 0.13 + rAcc * tintAmt;
    const baseG = 0.15 + gAcc * tintAmt;
    const baseB = 0.18 + bAcc * tintAmt;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      outCol[o] = baseR;
      outCol[o + 1] = baseG;
      outCol[o + 2] = baseB;
    }
    colAttr.needsUpdate = true;
    return;
  }

  // Derive bounding range for normalized su, sv mapping
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const ax = Math.abs(pos[i * 3]);
    const z = pos[i * 3 + 2];
    if (ax < minX) minX = ax;
    if (ax > maxX) maxX = ax;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanX = Math.max(0.01, maxX - minX);
  const spanZ = Math.max(0.01, maxZ - minZ);

  if (vizMode === 'stall') {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const su = Math.max(0, Math.min(1, (Math.abs(pos[o]) - minX) / spanX));
      const sv = Math.max(0, Math.min(1, (pos[o + 2] - minZ) / spanZ));
      const sep = bilinearLookup(cpMap.separation, su, sv);
      const [sr, sg, sb] = separationToRgb(sep);
      outCol[o] = sr;
      outCol[o + 1] = sg;
      outCol[o + 2] = sb;
    }
    colAttr.needsUpdate = true;
    return;
  }

  // vizMode === 'cp'
  const normAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const norms = normAttr ? (normAttr.array as Float32Array) : null;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const su = Math.max(0, Math.min(1, (Math.abs(pos[o]) - minX) / spanX));
    const sv = Math.max(0, Math.min(1, (pos[o + 2] - minZ) / spanZ));
    const ny = norms ? norms[o + 1] : 1;
    const nx = norms ? Math.abs(norms[o]) : 0;
    const upperBlend = Math.max(0, Math.min(1, 0.5 + 0.65 * ny + 0.2 * nx));

    const cpUp = bilinearLookup(cpMap.upperCp, su, sv);
    const cpLo = bilinearLookup(cpMap.lowerCp, su, sv);
    const cp = cpLo + (cpUp - cpLo) * upperBlend;
    const [cr, cg, cb] = cpToRgb(cp);
    outCol[o] = cr;
    outCol[o + 1] = cg;
    outCol[o + 2] = cb;
  }
  colAttr.needsUpdate = true;
}

/**
 * Extracts area-weighted macro-panels and FIA legality sample points directly from
 * a Three.js procedural car mesh (+X half-car).
 */
export function extractMeshPanelsAndLegality(
  mesh: THREE.Mesh
): { panels: MacroAeroPanel[]; legalityPts: Vec3[] } {
  const geom = mesh.geometry;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  const idxAttr = geom.getIndex();

  if (!posAttr) {
    return { panels: [], legalityPts: [] };
  }

  const pos = posAttr.array as Float32Array;
  const indices = idxAttr ? (idxAttr.array as Uint32Array) : null;
  const totalTris = indices ? indices.length / 3 : pos.length / 9;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const ax = Math.abs(pos[i * 3]);
    const z = pos[i * 3 + 2];
    if (ax < minX) minX = ax;
    if (ax > maxX) maxX = ax;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanX = Math.max(0.01, maxX - minX);
  const spanZ = Math.max(0.01, maxZ - minZ);

  // Target ~48 representative macro-panels per part for responsive CFD solve (< 10 ms)
  const targetPanels = 48;
  const stride = Math.max(1, Math.floor(totalTris / targetPanels));

  const panels: MacroAeroPanel[] = [];
  for (let t = 0; t < totalTris; t += stride) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;

    const o0 = i0 * 3, o1 = i1 * 3, o2 = i2 * 3;
    const x0 = pos[o0], y0 = pos[o0 + 1], z0 = pos[o0 + 2];
    const x1 = pos[o1], y1 = pos[o1 + 1], z1 = pos[o1 + 2];
    const x2 = pos[o2], y2 = pos[o2 + 1], z2 = pos[o2 + 2];

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    // Only process +X half-car (CFDSolver handles bilateral symmetry)
    if (cx < -0.001) continue;

    const d1x = x1 - x0, d1y = y1 - y0, d1z = z1 - z0;
    const d2x = x2 - x0, d2y = y2 - y0, d2z = z2 - z0;
    const crx = d1y * d2z - d1z * d2y;
    const cry = d1z * d2x - d1x * d2z;
    const crz = d1x * d2y - d1y * d2x;
    const triArea = 0.5 * Math.hypot(crx, cry, crz);
    if (triArea < 1e-6) continue;

    const lenN = Math.hypot(crx, cry, crz) || 1;
    const nx = crx / lenN;
    const ny = cry / lenN;
    const nz = crz / lenN;

    const su = Math.max(0, Math.min(1, (Math.abs(cx) - minX) / spanX));
    const sv = Math.max(0, Math.min(1, (cz - minZ) / spanZ));

    panels.push({
      cx,
      cy,
      cz,
      nx,
      ny,
      nz,
      tx: 0,
      ty: 0,
      tz: 1,
      area: triArea * stride,
      su,
      sv,
    });
  }

  // Sample +X vertices for legality checks (target ~60 points)
  const legalityPts: Vec3[] = [];
  const vertStride = Math.max(1, Math.floor(posAttr.count / 60));
  for (let i = 0; i < posAttr.count; i += vertStride) {
    const x = pos[i * 3];
    if (x >= -0.001) {
      legalityPts.push({
        x: Math.max(0, x),
        y: pos[i * 3 + 1],
        z: pos[i * 3 + 2],
      });
    }
  }

  return { panels, legalityPts };
}
