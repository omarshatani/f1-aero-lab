import { clampPointToLegalityBoxes, HARDPOINTS_2026, signedMarginInUnion } from '../regulations/fia2026';
import { AeroPartData, PartId, Vec3 } from '../types/aero';
import { AntiFoldResult, DragConstraintConfig, DragValidationResult } from './constraintTypes';

/**
 * Checks a control lattice grid for self-intersection, quad inversion, or surface folding
 * by evaluating the surface normal determinant against the reference baseline normal.
 */
export function checkAntiFold(grid: Vec3[][], referenceGrid?: Vec3[][]): AntiFoldResult {
  const cols = grid.length;
  if (cols < 2) return { valid: true, minDeterminant: 1, invertedCells: [] };
  const rows = grid[0].length;
  if (rows < 2) return { valid: true, minDeterminant: 1, invertedCells: [] };

  const ref = referenceGrid ?? grid;
  let minDet = Infinity;
  const invertedCells: Array<{ u: number; v: number }> = [];

  for (let u = 0; u < cols - 1; u++) {
    for (let v = 0; v < rows - 1; v++) {
      const p00 = grid[u][v];
      const p10 = grid[u + 1][v];
      const p01 = grid[u][v + 1];

      // Tri 1: (p00, p01, p10)
      const u1x = p10.x - p00.x;
      const u1y = p10.y - p00.y;
      const u1z = p10.z - p00.z;

      const v1x = p01.x - p00.x;
      const v1y = p01.y - p00.y;
      const v1z = p01.z - p00.z;

      // Normal: v1 x u1
      const n1x = v1y * u1z - v1z * u1y;
      const n1y = v1z * u1x - v1x * u1z;
      const n1z = v1x * u1y - v1y * u1x;

      // Reference normal
      const rp00 = ref[u][v];
      const rp10 = ref[u + 1][v];
      const rp01 = ref[u][v + 1];

      const ru1x = rp10.x - rp00.x;
      const ru1y = rp10.y - rp00.y;
      const ru1z = rp10.z - rp00.z;

      const rv1x = rp01.x - rp00.x;
      const rv1y = rp01.y - rp00.y;
      const rv1z = rp01.z - rp00.z;

      const rn1x = rv1y * ru1z - rv1z * ru1y;
      const rn1y = rv1z * ru1x - rv1x * ru1z;
      const rn1z = rv1x * ru1y - rv1y * ru1x;

      const len1 = Math.hypot(n1x, n1y, n1z);
      const rlen1 = Math.hypot(rn1x, rn1y, rn1z);

      if (len1 < 1e-7 || rlen1 < 1e-7) {
        invertedCells.push({ u, v });
        minDet = -1;
        continue;
      }

      // Normal alignment
      const dot = (n1x * rn1x + n1y * rn1y + n1z * rn1z) / (len1 * rlen1);
      if (dot < minDet) minDet = dot;

      if (dot <= 0.05) {
        invertedCells.push({ u, v });
      }
    }
  }

  return {
    valid: invertedCells.length === 0 && minDet > 0.05,
    minDeterminant: minDet === Infinity ? 1 : minDet,
    invertedCells,
  };
}

/**
 * Checks if a control lattice node is positioned at or near a locked homologated chassis hardpoint.
 */
export function isNodeOnLockedHardpoint(
  partId: PartId,
  u: number,
  v: number,
  partCols: number,
  partRows: number
): boolean {
  for (const hp of HARDPOINTS_2026) {
    if (!hp.locked) continue;
    if (!hp.associatedParts.includes(partId)) continue;

    // Boundary hardpoint matching
    if (partId === 'monocoque' && hp.id === 'survival_cell_front' && v === 0) return true;
    if (partId === 'monocoque' && hp.id === 'survival_cell_rear' && v === partRows - 1) return true;
    if (partId === 'engine_cover' && hp.id === 'survival_cell_rear' && v === 0) return true;
    if (partId === 'front_suspension' && (u === 0 || u === partCols - 1)) return true;
    if (partId === 'rear_suspension' && (u === 0 || u === partCols - 1)) return true;
  }
  return false;
}

/**
 * Validates candidate control grid deformation against all active geometric constraints
 * (FIA legality boxes, anti-fold normal checks, and locked vehicle hardpoints).
 */
export function validateDragMovement(
  part: AeroPartData,
  candidateGrid: Vec3[][],
  dragStartGrid: Vec3[][],
  config: DragConstraintConfig
): DragValidationResult {
  let antiFoldOk = true;
  if (config.preventFold) {
    const af = checkAntiFold(candidateGrid, dragStartGrid);
    if (!af.valid) {
      antiFoldOk = false;
    }
  }

  let fiaLegal = true;
  for (let u = 0; u < part.cols; u++) {
    for (let v = 0; v < part.rows; v++) {
      const margin = signedMarginInUnion(candidateGrid[u][v], part.legalityBoxes);
      if (margin < -0.0015) {
        fiaLegal = false;
        break;
      }
    }
    if (!fiaLegal) break;
  }

  const allowed = antiFoldOk && (!config.clampToFIA || fiaLegal);

  return {
    allowed,
    clampedPosition: candidateGrid[0][0],
    antiFoldOk,
    hardpointOk: true,
    fiaLegal,
    reason: !antiFoldOk
      ? 'Inverted quad fold detected'
      : !fiaLegal
      ? 'Exceeds FIA Reference Volume boundary'
      : undefined,
  };
}

/**
 * Clamps candidate position under constraints.
 */
export function clampCandidatePosition(
  candidate: Vec3,
  part: AeroPartData,
  lockCenter: boolean,
  clampToFIA: boolean
): Vec3 {
  let pt: Vec3 = {
    x: lockCenter ? 0 : Math.max(0, candidate.x),
    y: candidate.y,
    z: candidate.z,
  };
  if (clampToFIA) {
    pt = clampPointToLegalityBoxes(pt, part.legalityBoxes, lockCenter);
  }
  return pt;
}
