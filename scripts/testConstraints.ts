import { createBaselineParts } from '../src/regulations/fia2026';
import { Vec3 } from '../src/types/aero';

interface AntiFoldResult {
  valid: boolean;
  minDeterminant: number;
  invertedCells: Array<{ u: number; v: number }>;
}

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
      const p11 = grid[u + 1][v + 1];

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

      // Dot product between current normal and reference normal
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

console.log('=== TESTING ANTI-FOLD CONSTRAINT ===\n');

const parts = createBaselineParts();
const fw = parts.front_wing;

// Test baseline grid: should be 100% valid
const baselineCheck = checkAntiFold(fw.grid);
console.log(`Baseline Front Wing anti-fold check: valid=${baselineCheck.valid}, minDet=${baselineCheck.minDeterminant.toFixed(4)}`);
if (!baselineCheck.valid) throw new Error('Baseline front wing failed anti-fold check!');

// Test deliberately inverted/folded cell: move p10 behind p00
const foldedGrid = fw.grid.map(col => col.map(pt => ({ ...pt })));
foldedGrid[1][1].x = foldedGrid[0][1].x - 0.5; // fold spanwise inwards across centerline!
const foldedCheck = checkAntiFold(foldedGrid, fw.grid);
console.log(`Folded Front Wing check: valid=${foldedCheck.valid}, minDet=${foldedCheck.minDeterminant.toFixed(4)}, inverted=${foldedCheck.invertedCells.length}`);
if (foldedCheck.valid) throw new Error('Folded grid unexpectedly passed anti-fold check!');

console.log('\n-> Anti-fold check math verified successfully!');
