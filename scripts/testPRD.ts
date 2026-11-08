import {
  checkPartLegality,
  createBaselineParts,
  PART_ORDER,
} from '../src/regulations/fia2026';
import {
  evaluateAllSurfaces,
  evaluatePartSurface,
  extractMeshPanelsAndLegality,
} from '../src/surface/PatchEvaluator';
import { buildProceduralElementsForPart } from '../src/geometry/proceduralElements';
import { ProceduralFixturesManager } from '../src/geometry/fixtures';
import * as THREE from 'three';

console.log('=== TEST PR D: PROCEDURAL FIXTURES & ANCHORED APPENDAGES ===\n');

// 1. Test ProceduralFixturesManager
console.log('1. Testing ProceduralFixturesManager...');
const fixtures = new ProceduralFixturesManager();
console.log(`- Fixtures root children count: ${fixtures.root.children.length}`);
console.log(`- Wheel groups count: ${fixtures.wheelGroups.length}`);

fixtures.applyWheelStance({
  frontTrackOffsetMm: 15,
  rearTrackOffsetMm: -10,
  frontCamberDeg: -3.5,
  rearCamberDeg: -1.8,
  frontToeDeg: 0.8,
  rimCoverDishMm: 25,
});
fixtures.updateWheelSpin(0.016, 250, true);
fixtures.setGhostMode(true);
fixtures.setGhostMode(false);
fixtures.setFixtureVisible('halo_structure', false);
fixtures.setFixtureVisible('halo_structure', true);
console.log('✓ ProceduralFixturesManager tested successfully!\n');

// 2. Test Procedural Car Evaluation with Appendages
console.log('2. Testing Procedural Car Component Surfaces with Appendages...');
const parts = createBaselineParts();

// Enable appendages on key parts
parts.front_wing.proceduralElements.forEach(e => e.enabled = true);
parts.diffuser.proceduralElements.forEach(e => e.enabled = true);
parts.floor.proceduralElements.forEach(e => e.enabled = true);
parts.sidepods.proceduralElements.forEach(e => e.enabled = true);
parts.rear_wing.proceduralElements.forEach(e => e.enabled = true);
parts.engine_cover.proceduralElements.forEach(e => e.enabled = true);

const t0 = performance.now();
const previewSurfaces = evaluateAllSurfaces(parts, 'preview', 'carbon');
const tPreview = performance.now() - t0;

let totalPreviewTris = 0;
let totalPreviewVerts = 0;
for (const id of PART_ORDER) {
  const surf = previewSurfaces[id];
  totalPreviewVerts += surf.vertexCount;
  totalPreviewTris += surf.triangleCount;
  console.log(`- ${id.padEnd(18)}: ${surf.vertexCount.toString().padStart(6)} verts | ${surf.triangleCount.toString().padStart(6)} tris`);
}
console.log(`Total Preview LOD: ${totalPreviewVerts} verts | ${totalPreviewTris} tris (evaluated in ${tPreview.toFixed(2)} ms)`);

if (tPreview > 25) {
  throw new Error(`Preview evaluation took ${tPreview.toFixed(2)} ms (> 25 ms budget)`);
}
console.log('✓ Preview LOD performance budget met!\n');

// 3. Test Anchored Appendages Riding Along with Surface Deformation
console.log('3. Testing Anchored Appendages Deformation Tracking...');
const fwBase = evaluatePartSurface(parts.front_wing, 'preview', 'carbon');
// Proc element vertices start right after the main shell
const proc = buildProceduralElementsForPart(parts.front_wing);
const diveplaneStart = (fwBase.vertexCount - proc.vertexCount) * 3;
const fwBaseDiveplaneY = fwBase.positions[diveplaneStart + 1];
const fwBaseDiveplaneZ = fwBase.positions[diveplaneStart + 2];

// Pitch the front wing cage (simulated deformation across full detail cage)
const detailGrid = parts.front_wing.cage?.detail ?? parts.front_wing.grid;
for (let u = 0; u < detailGrid.length; u++) {
  for (let v = 0; v < detailGrid[u].length; v++) {
    const dy = (v / detailGrid[u].length) * 0.05;
    const dz = (v / detailGrid[u].length) * 0.02;
    detailGrid[u][v].y += dy;
    detailGrid[u][v].z += dz;
  }
}
const fwPitched = evaluatePartSurface(parts.front_wing, 'preview', 'carbon');
const fwPitchedDiveplaneY = fwPitched.positions[diveplaneStart + 1];
const fwPitchedDiveplaneZ = fwPitched.positions[diveplaneStart + 2];

console.log(`- Base diveplane reference vertex:    Y = ${fwBaseDiveplaneY.toFixed(4)} m, Z = ${fwBaseDiveplaneZ.toFixed(4)} m`);
console.log(`- Pitched diveplane reference vertex: Y = ${fwPitchedDiveplaneY.toFixed(4)} m, Z = ${fwPitchedDiveplaneZ.toFixed(4)} m`);
const deltaY = Math.abs(fwPitchedDiveplaneY - fwBaseDiveplaneY);
const deltaZ = Math.abs(fwPitchedDiveplaneZ - fwBaseDiveplaneZ);
console.log(`- Diveplane moved with wing by:       dY = ${(deltaY * 1000).toFixed(2)} mm, dZ = ${(deltaZ * 1000).toFixed(2)} mm`);
if (deltaY < 0.001 && deltaZ < 0.001) {
  throw new Error('Appendage did not ride along with parent surface deformation!');
}
console.log('✓ Anchored appendage deformed seamlessly with parent surface!\n');

// 4. Test Macro Aero Panel Extraction for CFDSolver
console.log('4. Testing Macro Aero Panel & Legality Point Extraction...');
let totalPanels = 0;
let totalLegalityPoints = 0;
for (const id of PART_ORDER) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(previewSurfaces[id].positions, 3));
  geom.setIndex(new THREE.BufferAttribute(previewSurfaces[id].indices, 1));
  const mesh = new THREE.Mesh(geom);

  const { panels, legalityPts } = extractMeshPanelsAndLegality(mesh);
  totalPanels += panels.length;
  totalLegalityPoints += legalityPts.length;

  // Verify legality check against FIA reference volumes
  const check = checkPartLegality(parts[id], legalityPts);
  if (!check.isLegal) {
    throw new Error(`Part ${id} is illegal at baseline! ${check.violations.join(', ')}`);
  }
}
console.log(`- Total extracted CFD macro-panels across car: ${totalPanels}`);
console.log(`- Total sampled FIA legality points across car: ${totalLegalityPoints}`);
console.log('✓ All 11 parts 100% legal within FIA Reference Volumes!\n');

// Clean up
fixtures.dispose();

console.log('=== ALL PR D TESTS PASSED PERFECTLY! ===');
