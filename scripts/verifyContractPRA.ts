import {
  checkPartLegality,
  createBaselineParts,
  DEFAULT_FIXTURES,
  FITTED_CAGES_V2,
  HARDPOINTS_2026,
  PART_ORDER,
  SEAM_LINKS,
  worldToFiaMm,
} from '../src/regulations/fia2026';
import { CarProjectStore } from '../src/state/CarProjectStore';
import { CarDesignSnapshot, PartId, Vec3 } from '../src/types/aero';

console.log('=== VERIFYING PR A CONTRACT: PROCEDURAL CAR OVERHAUL ===\n');

// 1. Verify SEAM_LINKS and HARDPOINTS_2026
console.log(`1. Verification of Topology Constants:`);
console.log(`   - SEAM_LINKS: ${SEAM_LINKS.length} registered shared boundaries`);
console.log(`   - HARDPOINTS_2026: ${HARDPOINTS_2026.length} homologated hardpoints`);
console.log(`   - DEFAULT_FIXTURES: ${DEFAULT_FIXTURES.length} vehicle fixtures\n`);

if (SEAM_LINKS.length < 5) throw new Error('Expected at least 5 shared seams');
if (HARDPOINTS_2026.length !== 11) throw new Error('Expected 11 hardpoints');
if (DEFAULT_FIXTURES.length !== 10) throw new Error('Expected 10 fixtures');

// 2. Baseline Legality & Clearance
console.log(`2. Baseline Part Legality & Seam Coincidence:`);
const store = new CarProjectStore();
let allPartsLegal = true;

for (const id of PART_ORDER) {
  const part = store.parts[id];
  const leg = checkPartLegality(part, part.grid.flat());
  console.log(
    `   Part [${id.padEnd(16)}]: isLegal=${leg.isLegal ? '✓' : '✗'}, minClearance=${leg.minClearanceMm.toFixed(1).padStart(5)} mm, oobNodes=${leg.violatingNodes.length}`
  );
  if (!leg.isLegal) allPartsLegal = false;
}

if (!allPartsLegal) throw new Error('One or more parts failed baseline legality!');
console.log('   -> All 11 baseline parts are 100% legal!\n');

// 3. Shared seam gap verification
console.log(`3. Shared Seam Zero-Gap Verification:`);
for (const seam of SEAM_LINKS) {
  const partA = store.parts[seam.partA];
  const partB = store.parts[seam.partB];
  let maxGapMm = 0;
  for (let i = 0; i < seam.nodesA.length; i++) {
    const nA = partA.grid[seam.nodesA[i].u][seam.nodesA[i].v];
    const nB = partB.grid[seam.nodesB[i].u][seam.nodesB[i].v];
    const dist = Math.hypot(nA.x - nB.x, nA.y - nB.y, nA.z - nB.z) * 1000;
    if (dist > maxGapMm) maxGapMm = dist;
  }
  console.log(`   Seam "${seam.id.padEnd(28)}": max gap = ${maxGapMm.toFixed(6)} mm`);
  if (maxGapMm > 0.001) throw new Error(`Seam ${seam.id} has gap of ${maxGapMm} mm!`);
}
console.log('   -> All shared seams have 0.000000 mm gap (watertight mathematical coincidence)!\n');

// 4. Seam Synchronization on Node Edit
console.log(`4. Interactive Seam Synchronization Test:`);
const testSeam = SEAM_LINKS[0]; // nosecone <-> monocoque
const nodeA = testSeam.nodesA[1]; // u=1, v=3 on nosecone
const nodeB = testSeam.nodesB[1]; // u=1, v=0 on monocoque

const originalPt = { ...store.parts[testSeam.partA].grid[nodeA.u][nodeA.v] };
const editedPt: Vec3 = { x: originalPt.x + 0.01, y: originalPt.y + 0.015, z: originalPt.z };

store.updatePartGridNode(testSeam.partA, nodeA.u, nodeA.v, editedPt, 'macro');

const afterA = store.parts[testSeam.partA].grid[nodeA.u][nodeA.v];
const afterB = store.parts[testSeam.partB].grid[nodeB.u][nodeB.v];
const deltaSeam = Math.hypot(afterA.x - afterB.x, afterA.y - afterB.y, afterA.z - afterB.z) * 1000;

console.log(`   Moved nosecone node (${nodeA.u},${nodeA.v}) -> monocoque node (${nodeB.u},${nodeB.v}) gap: ${deltaSeam.toFixed(6)} mm`);
if (deltaSeam > 0.001) throw new Error(`Seam sync failed, gap: ${deltaSeam} mm`);
console.log('   -> Seam synchronization across components verified!\n');

// 5. V2 Snapshot Export & Round-Trip Import
console.log(`5. V2 Snapshot & Legacy V1 Migration Test:`);
const exportedJson = store.exportDesignJson();
const parsedV2 = JSON.parse(exportedJson);
if (parsedV2.version !== 2) throw new Error('Expected snapshot version === 2');
if (!parsedV2.cages) throw new Error('Expected snapshot to contain cages');
console.log(`   Exported V2 Snapshot: version=${parsedV2.version}, cages=${Object.keys(parsedV2.cages).length} parts`);

// Re-import V2
const importV2Success = store.importDesignJson(exportedJson);
if (!importV2Success) throw new Error('Failed to import V2 snapshot');
console.log(`   V2 Snapshot re-import: success=true`);

// Import legacy V1 snapshot
const legacyV1Snapshot: CarDesignSnapshot = {
  name: 'Legacy V1 Test Spec',
  createdAt: 1000000,
  carModelId: 'fia_2026_concept',
  parts: {} as Record<PartId, Vec3[][]>,
};
for (const id of PART_ORDER) {
  legacyV1Snapshot.parts[id] = store.parts[id].grid.map(col => col.map(pt => ({ ...pt })));
}
const legacyV1Json = JSON.stringify(legacyV1Snapshot);
const importV1Success = store.importDesignJson(legacyV1Json);
if (!importV1Success) throw new Error('Failed to import legacy V1 snapshot');
if (!store.migrationToast) throw new Error('Expected migration toast for V1 snapshot import');
console.log(`   Legacy V1 Snapshot transparent import: success=true, toast="${store.migrationToast}"\n`);

// 6. Fixtures and Handle Level
console.log(`6. Fixture Toggle and Sculpt Handle Level:`);
store.setActiveHandleLevel('detail');
if (store.getActiveHandleLevel() !== 'detail') throw new Error('Failed to set activeHandleLevel');
store.setActiveHandleLevel('macro');
if (store.getActiveHandleLevel() !== 'macro') throw new Error('Failed to reset activeHandleLevel');

store.setFixtureVisible('wheel_fl', false);
if (store.fixtures.wheel_fl !== false) throw new Error('Failed to set fixture visibility');
store.setFixtureVisible('wheel_fl', true);
if (store.fixtures.wheel_fl !== true) throw new Error('Failed to restore fixture visibility');
console.log(`   ActiveHandleLevel and Fixtures: verified!\n`);

console.log('=== ALL PR A CONTRACT CHECKS PASSED SUCCESSFULLY ===');
