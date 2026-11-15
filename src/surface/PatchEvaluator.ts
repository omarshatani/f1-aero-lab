import * as THREE from 'three';
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
  buildPartBodyGeometry,
  SHADE_BODY,
  SHADE_CAVITY,
  SHADE_LOWER,
  SHADE_STRUT,
  SHADE_TRIM,
} from './partMeshBuilders';
import { bilinearLookup } from './surfaceMath';
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
  if (part.role === 'wing' || part.id === 'floor') {
    return { uSteps: 120, vSteps: 140 };
  }
  return { uSteps: 90, vSteps: 100 };
}

function parseAccentRgb(accentHex: string): [number, number, number] {
  const hex = parseInt(accentHex.replace('#', ''), 16);
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function fillVertexColors(
  positions: Float32Array,
  normals: Float32Array,
  outColors: Float32Array,
  part: AeroPartData,
  vizMode: SurfaceVizMode,
  cpMap?: PartSurfaceCpMap,
  shades?: Uint8Array,
  isSelectedPart = false
): void {
  const count = positions.length / 3;
  if (vizMode === 'carbon' || !cpMap) {
    const [rAcc, gAcc, bAcc] = parseAccentRgb(part.accentHex);
    const tint = isSelectedPart ? 0.16 : 0.0;
    const trimTint = Math.min(0.45, tint * 1.45);

    const bodyR = 0.13 + rAcc * tint;
    const bodyG = 0.15 + gAcc * tint;
    const bodyB = 0.18 + bAcc * tint;

    const lowerR = 0.08 + rAcc * tint * 0.35;
    const lowerG = 0.09 + gAcc * tint * 0.35;
    const lowerB = 0.11 + bAcc * tint * 0.35;

    const strutR = 0.095 + rAcc * tint * 0.25;
    const strutG = 0.10 + gAcc * tint * 0.25;
    const strutB = 0.115 + bAcc * tint * 0.25;

    const trimR = 0.18 + rAcc * trimTint;
    const trimG = 0.20 + gAcc * trimTint;
    const trimB = 0.23 + bAcc * trimTint;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const sh = shades ? shades[i] : SHADE_BODY;
      if (sh === SHADE_CAVITY) {
        outColors[o] = 0.025;
        outColors[o + 1] = 0.028;
        outColors[o + 2] = 0.034;
      } else if (sh === SHADE_LOWER) {
        outColors[o] = lowerR;
        outColors[o + 1] = lowerG;
        outColors[o + 2] = lowerB;
      } else if (sh === SHADE_STRUT) {
        outColors[o] = strutR;
        outColors[o + 1] = strutG;
        outColors[o + 2] = strutB;
      } else if (sh === SHADE_TRIM) {
        outColors[o] = trimR;
        outColors[o + 1] = trimG;
        outColors[o + 2] = trimB;
      } else {
        outColors[o] = bodyR;
        outColors[o + 1] = bodyG;
        outColors[o + 2] = bodyB;
      }
    }
    return;
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const ax = Math.abs(positions[i * 3]);
    const z = positions[i * 3 + 2];
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
      const su = Math.max(0, Math.min(1, (Math.abs(positions[o]) - minX) / spanX));
      const sv = Math.max(0, Math.min(1, (positions[o + 2] - minZ) / spanZ));
      const sep = bilinearLookup(cpMap.separation, su, sv);
      const [sr, sg, sb] = separationToRgb(sep);
      outColors[o] = sr;
      outColors[o + 1] = sg;
      outColors[o + 2] = sb;
    }
    return;
  }

  // vizMode === 'cp'
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const su = Math.max(0, Math.min(1, (Math.abs(positions[o]) - minX) / spanX));
    const sv = Math.max(0, Math.min(1, (positions[o + 2] - minZ) / spanZ));
    const ny = normals[o + 1];
    const nx = Math.abs(normals[o]);
    const upperBlend = Math.max(0, Math.min(1, 0.5 + 0.65 * ny + 0.2 * nx));
    const cpUp = bilinearLookup(cpMap.upperCp, su, sv);
    const cpLo = bilinearLookup(cpMap.lowerCp, su, sv);
    const [cr, cg, cb] = cpToRgb(cpLo + (cpUp - cpLo) * upperBlend);
    outColors[o] = cr;
    outColors[o + 1] = cg;
    outColors[o + 2] = cb;
  }
}

/**
 * Evaluates volumetric multi-element F1 2026 bodywork geometry and welded procedural
 * aerodynamic appendages into zero-copy typed buffers.
 */
export function evaluatePartSurface(
  part: AeroPartData,
  lod: LODLevel,
  vizMode: SurfaceVizMode = 'carbon',
  cpMap?: PartSurfaceCpMap,
  aeroMode: ActiveAeroMode = 'z_mode'
): EvaluatedPartSurface {
  const body = buildPartBodyGeometry(part, lod, aeroMode);
  const colors = new Float32Array(body.positions.length);

  fillVertexColors(body.positions, body.normals, colors, part, vizMode, cpMap, body.shades, false);

  return {
    partId: part.id,
    lod,
    positions: body.positions,
    normals: body.normals,
    colors,
    shades: body.shades,
    indices: body.indices,
    vertexCount: body.vertexCount,
    triangleCount: body.triangleCount,
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
  geom.userData.shades = surface.shades;
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

  geom.userData.shades = surface.shades;

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
  const normAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!colAttr || !posAttr || !normAttr) return;

  const outCol = colAttr.array as Float32Array;
  const pos = posAttr.array as Float32Array;
  const norms = normAttr.array as Float32Array;
  const shades = geom.userData.shades as Uint8Array | undefined;

  fillVertexColors(pos, norms, outCol, part, vizMode, cpMap, shades, isSelectedPart);
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

  // Filter +X half-car triangles and compute single-skin planform aerodynamic area
  const plusXTris: Array<{
    cx: number;
    cy: number;
    cz: number;
    nx: number;
    ny: number;
    nz: number;
  }> = [];
  let totalPlanformArea = 0;

  for (let t = 0; t < totalTris; t++) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;

    const o0 = i0 * 3, o1 = i1 * 3, o2 = i2 * 3;
    const x0 = pos[o0], y0 = pos[o0 + 1], z0 = pos[o0 + 2];
    const x1 = pos[o1], y1 = pos[o1 + 1], z1 = pos[o1 + 2];
    const x2 = pos[o2], y2 = pos[o2 + 1], z2 = pos[o2 + 2];

    const cx = (x0 + x1 + x2) / 3;
    if (cx < -0.001) continue;

    const cy = (y0 + y1 + y2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    const d1x = x1 - x0, d1y = y1 - y0, d1z = z1 - z0;
    const d2x = x2 - x0, d2y = y2 - y0, d2z = z2 - z0;
    const crx = d1y * d2z - d1z * d2y;
    const cry = d1z * d2x - d1x * d2z;
    const crz = d1x * d2y - d1y * d2x;
    const len = Math.hypot(crx, cry, crz);
    if (len < 1e-6) continue;

    // Single-skin planform area (half of closed 2-skin 3D shell)
    const triArea = 0.5 * len * 0.5;
    totalPlanformArea += triArea;

    plusXTris.push({
      cx,
      cy,
      cz,
      nx: crx / len,
      ny: cry / len,
      nz: crz / len,
    });
  }

  // Target ~48 representative macro-panels per part for responsive CFD solve (< 10 ms)
  const targetPanels = 48;
  const numPanels = Math.min(plusXTris.length, Math.max(12, Math.min(targetPanels, plusXTris.length)));
  const stride = Math.max(1, Math.floor(plusXTris.length / numPanels));
  const actualPanels = Math.floor(plusXTris.length / stride);
  const areaPerPanel = actualPanels > 0 ? totalPlanformArea / actualPanels : 0;

  const panels: MacroAeroPanel[] = [];
  for (let k = 0; k < actualPanels; k++) {
    const tri = plusXTris[k * stride];
    const su = Math.max(0, Math.min(1, (Math.abs(tri.cx) - minX) / spanX));
    const sv = Math.max(0, Math.min(1, (tri.cz - minZ) / spanZ));

    panels.push({
      cx: tri.cx,
      cy: tri.cy,
      cz: tri.cz,
      nx: tri.nx,
      ny: tri.ny,
      nz: tri.nz,
      tx: 0,
      ty: 0,
      tz: 1,
      area: areaPerPanel,
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
