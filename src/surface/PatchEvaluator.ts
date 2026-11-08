import * as THREE from 'three';
import { cpToRgb, separationToRgb } from '../geometry/splineSurface';
import { AeroPartData, PartId, PartSurfaceCpMap, SurfaceVizMode, Vec3 } from '../types/aero';
import { EvaluatedPartSurface, LODLevel } from './surfaceTypes';

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function catmullRomVec3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  return {
    x: catmullRomScalar(p0.x, p1.x, p2.x, p3.x, t),
    y: catmullRomScalar(p0.y, p1.y, p2.y, p3.y, t),
    z: catmullRomScalar(p0.z, p1.z, p2.z, p3.z, t),
  };
}

function evalCurveAlongArray(pts: Vec3[], s: number, mirrorStartAcrossX = false): Vec3 {
  const n = pts.length;
  if (n === 1) return { ...pts[0] };
  const scaled = Math.max(0, Math.min(1, s)) * (n - 1);
  const idx = Math.min(n - 2, Math.floor(scaled));
  const frac = scaled - idx;

  const getPt = (i: number): Vec3 => {
    if (i < 0) {
      if (mirrorStartAcrossX && n > 1) {
        return { x: -pts[1].x, y: pts[1].y, z: pts[1].z };
      }
      return {
        x: 2 * pts[0].x - pts[1].x,
        y: 2 * pts[0].y - pts[1].y,
        z: 2 * pts[0].z - pts[1].z,
      };
    }
    if (i >= n) {
      return {
        x: 2 * pts[n - 1].x - pts[n - 2].x,
        y: 2 * pts[n - 1].y - pts[n - 2].y,
        z: 2 * pts[n - 1].z - pts[n - 2].z,
      };
    }
    return pts[i];
  };

  return catmullRomVec3(getPt(idx - 1), getPt(idx), getPt(idx + 1), getPt(idx + 2), frac);
}

function halfThicknessProfile(part: AeroPartData, sv: number, su: number): number {
  const t = Math.max(0, Math.min(1, sv));
  const halfMax = part.thickness * 0.5;

  if (part.role === 'body_fairing') {
    const chordEnv = Math.sin(Math.PI * (0.06 + 0.88 * t));
    const edgeTaper = part.centerlineLocked ? 1.0 : Math.sin(Math.PI * (0.12 + 0.76 * su));
    return halfMax * chordEnv * edgeTaper;
  }

  const naca =
    5.0 *
    (0.2969 * Math.sqrt(t) -
      0.126 * t -
      0.3516 * t * t +
      0.2843 * t * t * t -
      0.1015 * t * t * t * t);
  return halfMax * Math.max(0.06, naca);
}

function bilinearLookup(grid: number[][], su: number, sv: number): number {
  const nu = grid.length - 1;
  const nv = grid[0].length - 1;
  const fu = Math.max(0, Math.min(1, su)) * nu;
  const fv = Math.max(0, Math.min(1, sv)) * nv;
  const i0 = Math.min(nu - 1, Math.floor(fu));
  const j0 = Math.min(nv - 1, Math.floor(fv));
  const tu = fu - i0;
  const tv = fv - j0;

  const c00 = grid[i0][j0];
  const c10 = grid[i0 + 1][j0];
  const c01 = grid[i0][j0 + 1];
  const c11 = grid[i0 + 1][j0 + 1];
  return (1 - tu) * (1 - tv) * c00 + tu * (1 - tv) * c10 + (1 - tu) * tv * c01 + tu * tv * c11;
}

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
 * into zero-copy Float32Array and Uint32Array typed buffers.
 */
export function evaluatePartSurface(
  part: AeroPartData,
  lod: LODLevel,
  vizMode: SurfaceVizMode = 'carbon',
  cpMap?: PartSurfaceCpMap
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

  // 4. Exact pre-allocated buffer sizing
  const gridVerts = (uSteps + 1) * (vSteps + 1);
  const vertsPerHalf = gridVerts * 2; // Upper + Lower skins
  const totalVerts = vertsPerHalf * 2; // Starboard (+X) + Port (-X)

  const quadsPerSkin = uSteps * vSteps;
  const leQuads = uSteps;
  const teQuads = uSteps;
  const tipQuads = vSteps;
  const rootQuads = part.centerlineLocked ? 0 : vSteps;
  const trisPerHalf = (quadsPerSkin * 2 + leQuads + teQuads + tipQuads + rootQuads) * 2;
  const totalIndices = trisPerHalf * 2 * 3;

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
          const vy = p.y + n.y * h;
          const vz = p.z + n.z * h;

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

  return {
    partId: part.id,
    lod,
    positions,
    normals,
    colors,
    indices,
    vertexCount: totalVerts,
    triangleCount: idxOffset / 3,
  };
}

export function evaluateAllSurfaces(
  parts: Record<PartId, AeroPartData>,
  lod: LODLevel,
  vizMode: SurfaceVizMode = 'carbon',
  cpMaps?: Partial<Record<PartId, PartSurfaceCpMap>>
): Record<PartId, EvaluatedPartSurface> {
  const result = {} as Record<PartId, EvaluatedPartSurface>;
  for (const key of Object.keys(parts) as PartId[]) {
    result[key] = evaluatePartSurface(parts[key], lod, vizMode, cpMaps?.[key]);
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
