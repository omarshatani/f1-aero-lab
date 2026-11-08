import * as THREE from 'three';
import { runCFDSimulation } from '../src/cfd/CFDSolver';
import { createBaselineParts, PART_ORDER } from '../src/regulations/fia2026';
import {
  createBufferGeometryFromSurface,
  evaluateAllSurfaces,
  extractMeshPanelsAndLegality,
} from '../src/surface/PatchEvaluator';
import { MacroAeroPanel, TunnelSettings, Vec3 } from '../src/types/aero';

console.log('=== CFD CALIBRATION & BENCHMARK SUITE ===\n');

const parts = createBaselineParts();

const zModeSettings: TunnelSettings = {
  windSpeedKmh: 250,
  yawAngleDeg: 0,
  frontRideHeightMm: 0,
  rearRideHeightMm: 0,
  activeAeroMode: 'z_mode',
  rollingRoad: true,
};

const xModeSettings: TunnelSettings = {
  windSpeedKmh: 250,
  yawAngleDeg: 0,
  frontRideHeightMm: 0,
  rearRideHeightMm: 0,
  activeAeroMode: 'x_mode',
  rollingRoad: true,
};

// Pure spline baseline
const pureZ = runCFDSimulation(parts, zModeSettings);
const pureX = runCFDSimulation(parts, xModeSettings);

console.log('--- PURE SPLINE BASELINE (no mesh panels) ---');
console.log(`Z-Mode: CL = ${pureZ.cl.toFixed(3)}, CD = ${pureZ.cd.toFixed(3)}, L/D = ${pureZ.ldRatio.toFixed(2)}, CoP = ${pureZ.copFrontPct.toFixed(1)}%, TopSpeed = ${pureZ.topSpeedEstKmh.toFixed(1)} km/h`);
console.log(`X-Mode: CL = ${pureX.cl.toFixed(3)}, CD = ${pureX.cd.toFixed(3)}, L/D = ${pureX.ldRatio.toFixed(2)}, CoP = ${pureX.copFrontPct.toFixed(1)}%, TopSpeed = ${pureX.topSpeedEstKmh.toFixed(1)} km/h\n`);

// Extract procedural mesh panels & legality points as SceneManager does
const surfaces = evaluateAllSurfaces(parts, 'preview', 'carbon');
const realMeshPanels: Partial<Record<string, MacroAeroPanel[]>> = {};
const realLegalityPoints: Partial<Record<string, Vec3[]>> = {};

for (const id of PART_ORDER) {
  const geom = createBufferGeometryFromSurface(surfaces[id]);
  const mesh = new THREE.Mesh(geom);
  const extracted = extractMeshPanelsAndLegality(mesh);
  realMeshPanels[id] = extracted.panels;
  realLegalityPoints[id] = extracted.legalityPts;
}

// 1. Benchmark Z-Mode solve with procedural mesh panels
const t0 = performance.now();
const zResult = runCFDSimulation(parts, zModeSettings, realMeshPanels, realLegalityPoints);
const tZ = performance.now() - t0;

console.log('--- PROCEDURAL MESH PANELS: Z-MODE (Cornering High-Downforce) ---');
console.log(`Solve Time:     ${tZ.toFixed(2)} ms`);
console.log(`CL:             ${zResult.cl.toFixed(3)}  (Target: ~3.750)`);
console.log(`CD:             ${zResult.cd.toFixed(3)}  (Target: ~0.994)`);
console.log(`L/D:            ${zResult.ldRatio.toFixed(2)}  (Target: ~3.77)`);
console.log(`Downforce:      ${zResult.totalDownforceN.toFixed(0)} N`);
console.log(`Drag:           ${zResult.totalDragN.toFixed(0)} N`);
console.log(`CoP % Front:    ${zResult.copFrontPct.toFixed(1)}%  (Target: ~45.8%, window: 44.0% - 47.5%)`);
console.log(`Top Speed:      ${zResult.topSpeedEstKmh.toFixed(1)} km/h`);
console.log(`Cornering G:    ${zResult.highSpeedCornerG.toFixed(2)} G`);
console.log(`All Legal:      ${zResult.allLegal}`);

console.log('\n--- PROCEDURAL MESH PANELS: X-MODE (Straight-Line Low-Drag) ---');
const t1 = performance.now();
const xResult = runCFDSimulation(parts, xModeSettings, realMeshPanels, realLegalityPoints);
const tX = performance.now() - t1;

console.log(`Solve Time:     ${tX.toFixed(2)} ms`);
console.log(`CL:             ${xResult.cl.toFixed(3)}  (Target: ~3.166)`);
console.log(`CD:             ${xResult.cd.toFixed(3)}  (Target: ~0.706)`);
console.log(`L/D:            ${xResult.ldRatio.toFixed(2)}  (Target: ~4.48)`);
console.log(`Downforce:      ${xResult.totalDownforceN.toFixed(0)} N`);
console.log(`Drag:           ${xResult.totalDragN.toFixed(0)} N`);
console.log(`CoP % Front:    ${xResult.copFrontPct.toFixed(1)}%  (Target: ~47.3%)`);
console.log(`Top Speed:      ${xResult.topSpeedEstKmh.toFixed(1)} km/h  (Target: ~370 km/h)`);
console.log(`All Legal:      ${xResult.allLegal}`);
