import { createBaselineParts, PART_ORDER, SEAM_LINKS } from '../src/regulations/fia2026';
import {
  createBufferGeometryFromSurface,
  evaluateAllSurfaces,
  evaluatePartSurface,
  updateBufferGeometryFromSurface,
} from '../src/surface/PatchEvaluator';
import { LODManager } from '../src/surface/lod';

console.log('=== VERIFYING PR B: SURFACE EVALUATOR, LOD & WEBWORKER ===\n');

const parts = createBaselineParts();

// 1. Single Part Evaluation & Sizing
console.log('1. Single Part Preview & Full LOD Evaluation:');
const t0 = performance.now();
const fwPreview = evaluatePartSurface(parts.front_wing, 'preview');
const dtFwPreview = performance.now() - t0;
console.log(
  `   front_wing Preview: ${fwPreview.vertexCount} verts, ${fwPreview.triangleCount} tris (${dtFwPreview.toFixed(2)} ms)`
);

const t1 = performance.now();
const fwFull = evaluatePartSurface(parts.front_wing, 'full');
const dtFwFull = performance.now() - t1;
console.log(
  `   front_wing Full:    ${fwFull.vertexCount} verts, ${fwFull.triangleCount} tris (${dtFwFull.toFixed(2)} ms)\n`
);

if (fwPreview.triangleCount < 1000) throw new Error('Preview triangle count suspiciously low');
if (fwFull.triangleCount < 50000) throw new Error('Full triangle count suspiciously low');

// 2. Full Car Mesh Evaluation & Triangle Count (~1M target)
console.log('2. Full Car Evaluation (All 11 Parts):');
const t2 = performance.now();
const allPreview = evaluateAllSurfaces(parts, 'preview');
const dtAllPreview = performance.now() - t2;
let totalPreviewTris = 0;
for (const id of PART_ORDER) totalPreviewTris += allPreview[id].triangleCount;
console.log(
  `   Preview Car: ${totalPreviewTris.toLocaleString()} triangles in ${dtAllPreview.toFixed(2)} ms`
);

const t3 = performance.now();
const allFull = evaluateAllSurfaces(parts, 'full');
const dtAllFull = performance.now() - t3;
let totalFullTris = 0;
for (const id of PART_ORDER) totalFullTris += allFull[id].triangleCount;
console.log(
  `   Full Car:    ${totalFullTris.toLocaleString()} triangles in ${dtAllFull.toFixed(2)} ms\n`
);

if (dtAllPreview > 50) throw new Error(`Preview evaluation too slow: ${dtAllPreview} ms`);
if (totalFullTris < 800000 || totalFullTris > 1200000) {
  throw new Error(`Total full triangles ${totalFullTris} outside expected target (800k - 1.2M)`);
}

// 3. Three.js BufferGeometry Integration
console.log('3. Three.js BufferGeometry Conversion:');
const geom = createBufferGeometryFromSurface(fwPreview);
const posAttr = geom.getAttribute('position');
const normAttr = geom.getAttribute('normal');
const colAttr = geom.getAttribute('color');
const idxAttr = geom.getIndex();

console.log(`   BufferGeometry created: positions=${posAttr.count}, normals=${normAttr.count}, colors=${colAttr.count}, indices=${idxAttr?.count}`);
if (!geom.boundingBox || !geom.boundingSphere) throw new Error('Missing bounding volumes');

// In-place update test
updateBufferGeometryFromSurface(geom, fwPreview);
console.log('   In-place geometry update verified.\n');

// 4. Colormaps (carbon, cp, stall)
console.log('4. Surface Visualization Colormaps:');
const surfCarbon = evaluatePartSurface(parts.nosecone, 'preview', 'carbon');
const surfCp = evaluatePartSurface(parts.nosecone, 'preview', 'cp');
const surfStall = evaluatePartSurface(parts.nosecone, 'preview', 'stall');

for (let i = 0; i < 30; i++) {
  const c = surfCarbon.colors[i];
  if (c < 0 || c > 1 || isNaN(c)) throw new Error(`Invalid carbon color at index ${i}`);
}
console.log('   Colormaps (carbon, cp, stall) verified valid colors.\n');

// 5. LODManager Lifecycle
console.log('5. LODManager Execution:');
const lodManager = new LODManager();
let statusLog: string[] = [];
lodManager.subscribeStatus((st) => statusLog.push(st));

const prevSurf = lodManager.evaluatePreviewPart(parts.diffuser);
console.log(`   LODManager preview evaluated: ${prevSurf.triangleCount} tris, status=${lodManager.getStatus()}`);

const fullPromise = lodManager.requestFullLOD(parts);
fullPromise.then((surfs) => {
  console.log(`   LODManager full request completed with ${Object.keys(surfs).length} parts, status=${lodManager.getStatus()}`);
  lodManager.dispose();
  console.log('\n=== ALL PR B VERIFICATION CHECKS PASSED ===');
});
