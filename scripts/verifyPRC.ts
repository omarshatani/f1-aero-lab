import { createBaselineParts, PART_ORDER } from '../src/regulations/fia2026';
import { checkAntiFold, isNodeOnLockedHardpoint, validateDragMovement } from '../src/editor/constraints';
import { DragConstraintConfig } from '../src/editor/constraintTypes';
import { cloneGrid } from '../src/regulations/fia2026';

console.log('=== VERIFYING PR C: SCULPTOR, HANDLES & CONSTRAINTS ===\n');

const parts = createBaselineParts();

// 1. Anti-Fold Verification across all 11 parts at baseline
console.log('1. Anti-Fold Check on all 11 baseline parts:');
for (const id of PART_ORDER) {
  const p = parts[id];
  const res = checkAntiFold(p.grid);
  console.log(`   [${id.padEnd(16)}]: antiFold valid=${res.valid ? '✓' : '✗'}, minDet=${res.minDeterminant.toFixed(4)}`);
  if (!res.valid) throw new Error(`Baseline part ${id} failed anti-fold check!`);
}
console.log('   -> All 11 baseline parts have positive normal determinants (> 0.05)!\n');

// 2. Inversion / Fold Rejection Test
console.log('2. Inversion / Fold Rejection Simulation:');
const mono = parts.monocoque;
const startGrid = cloneGrid(mono.grid);
const invertedGrid = cloneGrid(mono.grid);

// Drastically invert a quad: pull rear node forward past the front node
invertedGrid[1][2].z = invertedGrid[1][0].z - 0.5;

const afRes = checkAntiFold(invertedGrid, startGrid);
console.log(`   Inverted Monocoque test: valid=${afRes.valid}, invertedCells=${afRes.invertedCells.length}`);
if (afRes.valid) throw new Error('Inverted quad was not caught by checkAntiFold!');

const dragConfig: DragConstraintConfig = {
  clampToFIA: true,
  preventFold: true,
  lockHardpoints: true,
};
const valRes = validateDragMovement(mono, invertedGrid, startGrid, dragConfig);
console.log(`   validateDragMovement result: allowed=${valRes.allowed}, reason="${valRes.reason}"`);
if (valRes.allowed) throw new Error('validateDragMovement allowed an inverted fold!');
console.log('   -> Anti-fold rejection verified!\n');

// 3. Locked Chassis Hardpoint Detection
console.log('3. Locked Chassis Hardpoint Detection:');
const isFrontBulkheadLocked = isNodeOnLockedHardpoint('monocoque', 0, 0, mono.cols, mono.rows);
const isMidTubLocked = isNodeOnLockedHardpoint('monocoque', 1, 1, mono.cols, mono.rows);
const isRearSuspArmLocked = isNodeOnLockedHardpoint('rear_suspension', 0, 0, 3, 3);

console.log(`   monocoque (0,0) [front bulkhead]: locked=${isFrontBulkheadLocked}`);
console.log(`   monocoque (1,1) [mid survival cell]: locked=${isMidTubLocked}`);
console.log(`   rear_suspension (0,0) [inboard pivot]: locked=${isRearSuspArmLocked}`);

if (!isFrontBulkheadLocked) throw new Error('Expected front bulkhead to be locked');
if (isMidTubLocked) throw new Error('Expected mid survival cell to be unlocked');
if (!isRearSuspArmLocked) throw new Error('Expected rear suspension inboard pivot to be locked');
console.log('   -> Locked hardpoint boundary enforcement verified!\n');

console.log('=== ALL PR C VERIFICATION CHECKS PASSED ===');
