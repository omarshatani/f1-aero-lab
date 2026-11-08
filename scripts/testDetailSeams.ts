import {
  checkPartLegality,
  createBaselineParts,
  fiaMmToWorld,
  PART_ORDER,
  worldToFiaMm,
} from '../src/regulations/fia2026';
import { CageV2, NodeIndex, PartId, Vec3 } from '../src/types/aero';

// Bicubic Catmull-Rom interpolation functions
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

export function interpolateMacroToDetail(
  macro: Vec3[][],
  detailCols: number,
  detailRows: number,
  detailOffsets?: Vec3[][],
  lockCenterline = false
): Vec3[][] {
  const macroCols = macro.length;
  const macroRows = macro[0].length;

  // 1. Evaluate along v for each macro column u
  const colSampled: Vec3[][] = [];
  for (let u = 0; u < macroCols; u++) {
    const col: Vec3[] = [];
    for (let iv = 0; iv < detailRows; iv++) {
      const sv = detailRows > 1 ? iv / (detailRows - 1) : 0;
      col.push(evalCurveAlongArray(macro[u], sv, false));
    }
    colSampled.push(col);
  }

  // 2. Evaluate across u for each iv slice
  const out: Vec3[][] = [];
  for (let iu = 0; iu < detailCols; iu++) {
    const col: Vec3[] = [];
    const su = detailCols > 1 ? iu / (detailCols - 1) : 0;
    for (let iv = 0; iv < detailRows; iv++) {
      const rowCtrl: Vec3[] = [];
      for (let u = 0; u < macroCols; u++) {
        rowCtrl.push(colSampled[u][iv]);
      }
      const pt = evalCurveAlongArray(rowCtrl, su, lockCenterline && iu === 0);
      if (detailOffsets && detailOffsets[iu] && detailOffsets[iu][iv]) {
        const off = detailOffsets[iu][iv];
        pt.x += off.x;
        pt.y += off.y;
        pt.z += off.z;
      }
      if (lockCenterline && iu === 0) {
        pt.x = 0;
      }
      col.push(pt);
    }
    out.push(col);
  }

  return out;
}

// Test with parts
const parts = createBaselineParts();

// Apply welded seams
const physicalSeams = [
  {
    partA: 'nosecone' as PartId,
    partB: 'monocoque' as PartId,
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    coords: [[-50, 0, 540], [-50, 215, 500], [-50, 240, 300]],
  },
  {
    partA: 'monocoque' as PartId,
    partB: 'engine_cover' as PartId,
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    coords: [[1550, 0, 860], [1550, 200, 720], [1550, 270, 500]],
  },
  {
    partA: 'floor' as PartId,
    partB: 'diffuser' as PartId,
    nodesA: [{ u: 0, v: 4 }, { u: 1, v: 4 }, { u: 2, v: 4 }, { u: 3, v: 4 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 3, v: 0 }],
    coords: [[2720, 0, 22], [2720, 200, 68], [2720, 380, 65], [2720, 495, 51]],
  },
];

for (const seam of physicalSeams) {
  const pA = parts[seam.partA];
  const pB = parts[seam.partB];
  for (let i = 0; i < seam.nodesA.length; i++) {
    const [xF, yFia, zFia] = seam.coords[i];
    const wPt = fiaMmToWorld(xF, yFia, zFia);
    pA.grid[seam.nodesA[i].u][seam.nodesA[i].v] = { ...wPt };
    pB.grid[seam.nodesB[i].u][seam.nodesB[i].v] = { ...wPt };
  }
}

// Generate CageV2 for each part
const cages: Partial<Record<PartId, CageV2>> = {};
for (const id of PART_ORDER) {
  const p = parts[id];
  const detailCols = (p.cols - 1) * 3 + 1;
  const detailRows = (p.rows - 1) * 3 + 1;
  const detailOffsets = Array.from({ length: detailCols }, () =>
    Array.from({ length: detailRows }, () => ({ x: 0, y: 0, z: 0 }))
  );
  const detail = interpolateMacroToDetail(
    p.grid,
    detailCols,
    detailRows,
    detailOffsets,
    p.centerlineLocked
  );
  cages[id] = {
    macroCols: p.cols,
    macroRows: p.rows,
    detailCols,
    detailRows,
    macro: p.grid,
    detail,
    detailOffsets,
  };
}

// Verify seam gap at detail level
console.log('--- TESTING DETAIL CAGE SEAM WATERTIGHTNESS ---');

// 1. Floor <-> Diffuser
{
  const floorCage = cages['floor']!;
  const diffCage = cages['diffuser']!;
  let maxGap = 0;
  for (let iu = 0; iu < floorCage.detailCols; iu++) {
    const ptFloor = floorCage.detail[iu][floorCage.detailRows - 1];
    const ptDiff = diffCage.detail[iu][0];
    const d = Math.hypot(ptFloor.x - ptDiff.x, ptFloor.y - ptDiff.y, ptFloor.z - ptDiff.z);
    if (d > maxGap) maxGap = d;
  }
  console.log(`Floor <-> Diffuser seam max detail gap: ${(maxGap * 1000).toFixed(6)} mm`);
}

// 2. Nosecone <-> Monocoque
{
  const noseCage = cages['nosecone']!;
  const monoCage = cages['monocoque']!;
  let maxGap = 0;
  for (let iu = 0; iu < noseCage.detailCols; iu++) {
    const ptNose = noseCage.detail[iu][noseCage.detailRows - 1];
    const ptMono = monoCage.detail[iu][0];
    const d = Math.hypot(ptNose.x - ptMono.x, ptNose.y - ptMono.y, ptNose.z - ptMono.z);
    if (d > maxGap) maxGap = d;
  }
  console.log(`Nosecone <-> Monocoque seam max detail gap: ${(maxGap * 1000).toFixed(6)} mm`);
}

// 3. Monocoque <-> Engine Cover
{
  const monoCage = cages['monocoque']!;
  const ecCage = cages['engine_cover']!;
  let maxGap = 0;
  for (let iu = 0; iu < monoCage.detailCols; iu++) {
    const ptMono = monoCage.detail[iu][monoCage.detailRows - 1];
    const ptEc = ecCage.detail[iu][0];
    const d = Math.hypot(ptMono.x - ptEc.x, ptMono.y - ptEc.y, ptMono.z - ptEc.z);
    if (d > maxGap) maxGap = d;
  }
  console.log(`Monocoque <-> Engine Cover seam max detail gap: ${(maxGap * 1000).toFixed(6)} mm`);
}
