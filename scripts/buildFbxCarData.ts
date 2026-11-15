import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PART_ORDER, SEAM_LINKS } from '../src/regulations/fia2026';
import { PartId, Vec3 } from '../src/types/aero';

const FBX_PATH = 'public/2026-formula-1-car/source/222.fbx';
const OUT_PATH = 'src/surface/fbxCarData.ts';

const SHADE_BODY = 0;
const SHADE_STRUT = 2;
const SHADE_CAVITY = 3;

// Wheelbase scaling: FBX front axle Y = 4.8005, rear axle Y = 14.7005 (span 9.900 -> 3.400 m)
const SCALE_S = 3.4 / 9.9;

function fbxToWorld(v: THREE.Vector3): Vec3 {
  return {
    x: v.x * SCALE_S,
    y: (v.z + 1.25) * SCALE_S,
    z: (v.y - 9.7505) * SCALE_S,
  };
}

const PART_DENSE_DIMS: Record<PartId, { cols: number; rows: number; centerlineLocked: boolean; targetTris: number }> = {
  front_wing: { cols: 13, rows: 10, centerlineLocked: true, targetTris: 4700 },
  nosecone: { cols: 7, rows: 10, centerlineLocked: true, targetTris: 3600 },
  front_suspension: { cols: 7, rows: 7, centerlineLocked: false, targetTris: 3500 },
  monocoque: { cols: 7, rows: 10, centerlineLocked: true, targetTris: 4000 },
  floor_boards: { cols: 7, rows: 10, centerlineLocked: false, targetTris: 3500 },
  floor: { cols: 10, rows: 13, centerlineLocked: true, targetTris: 6000 },
  sidepods: { cols: 10, rows: 10, centerlineLocked: false, targetTris: 5300 },
  engine_cover: { cols: 7, rows: 10, centerlineLocked: true, targetTris: 5300 },
  rear_suspension: { cols: 7, rows: 7, centerlineLocked: false, targetTris: 3500 },
  diffuser: { cols: 10, rows: 10, centerlineLocked: true, targetTris: 4100 },
  rear_wing: { cols: 10, rows: 10, centerlineLocked: true, targetTris: 4500 },
};

type FixtureKey = 'wheel_front' | 'wheel_rear' | 'halo' | 'mirrors' | 'cockpit' | 'exhaust';

interface RawTri {
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  n0: Vec3;
  n1: Vec3;
  n2: Vec3;
  n: Vec3;
  area: number;
  shade: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeVec(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-10 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 1, z: 0 };
}

function computeTriNormal(p0: Vec3, p1: Vec3, p2: Vec3): { n: Vec3; area: number } {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const az = p1.z - p0.z;
  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const bz = p2.z - p0.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const len = Math.hypot(cx, cy, cz);
  return {
    n: len > 1e-12 ? { x: cx / len, y: cy / len, z: cz / len } : { x: 0, y: 1, z: 0 },
    area: 0.5 * len,
  };
}

const MESH_TO_PART: Record<string, PartId | FixtureKey> = {
  // Wheels
  Body433: 'wheel_front',
  Body537: 'wheel_front',
  Body579: 'wheel_front',
  Body391: 'wheel_rear',
  Body538: 'wheel_rear',
  Body580: 'wheel_rear',
  // Fixtures
  Body286: 'halo',
  Body185: 'mirrors',
  Body186: 'mirrors',
  Body187: 'mirrors',
  Body529: 'mirrors',
  Body442: 'cockpit',
  Body81: 'cockpit',
  Body18: 'exhaust',
  Body19: 'exhaust',
  Body449: 'exhaust',
  Body450: 'exhaust',
  // Front wing
  Body377: 'front_wing',
  Body464: 'front_wing',
  Body465: 'front_wing',
  Body466: 'front_wing',
  Body470: 'front_wing',
  Body472: 'front_wing',
  Body473: 'front_wing',
  Body474: 'front_wing',
  Body475: 'front_wing',
  // Nosecone
  Body418: 'nosecone',
  Body384: 'nosecone',
  Body486: 'nosecone',
  Body455: 'nosecone',
  Body516: 'nosecone',
  // Front suspension
  Body567: 'front_suspension',
  Body565: 'front_suspension',
  Body566: 'front_suspension',
  Body544: 'front_suspension',
  Body546: 'front_suspension',
  Body543: 'front_suspension',
  Body548: 'front_suspension',
  Body549: 'front_suspension',
  Body554: 'front_suspension',
  Body571: 'front_suspension',
  Body547: 'front_suspension',
  Body553: 'front_suspension',
  // Floor boards
  Body577: 'floor_boards',
  Body133: 'floor_boards',
  Body573: 'floor_boards',
  Body574: 'floor_boards',
  Body575: 'floor_boards',
  Body576: 'floor_boards',
  Body578: 'floor_boards',
  Body278: 'floor_boards',
  Body279: 'floor_boards',
  Body280: 'floor_boards',
  Body281: 'floor_boards',
  Body282: 'floor_boards',
  // Engine cover
  Body172: 'engine_cover',
  Body173: 'engine_cover',
  Body397: 'engine_cover',
  Body398: 'engine_cover',
  Body487: 'engine_cover',
  Body524: 'engine_cover',
  // Rear suspension
  Body568: 'rear_suspension',
  Body569: 'rear_suspension',
  Body555: 'rear_suspension',
  Body556: 'rear_suspension',
  Body557: 'rear_suspension',
  Body558: 'rear_suspension',
  Body559: 'rear_suspension',
  Body550: 'rear_suspension',
  Body551: 'rear_suspension',
  Body560: 'rear_suspension',
  Body563: 'rear_suspension',
  Body561: 'rear_suspension',
  Body570: 'rear_suspension',
  // Rear wing
  Body467: 'rear_wing',
  Body476: 'rear_wing',
  Body477: 'rear_wing',
  Body478: 'rear_wing',
  Body522: 'rear_wing',
  Body479: 'rear_wing',
  Body480: 'rear_wing',
  Body481: 'rear_wing',
  Body482: 'rear_wing',
  Body483: 'rear_wing',
  Body131: 'rear_wing',
  Body205: 'rear_wing',
  Body447: 'rear_wing',
  Body448: 'rear_wing',
  // Diffuser
  Body581: 'diffuser',
  Body582: 'diffuser',
  Body491: 'diffuser',
  Body552: 'diffuser',
  Body17: 'diffuser',
  Body260: 'diffuser',
  // Floor
  Body517: 'floor',
};

function classifyTriangleTarget(name: string, cx: number, cy: number, cz: number): PartId | FixtureKey {
  const direct = MESH_TO_PART[name];
  if (direct) return direct;
  if (name === 'Body572') {
    return cz > 1.32 ? 'diffuser' : 'floor';
  }
  if (name === 'FRONT_NOSE') {
    if (cz <= -1.35) return 'nosecone';
    if (cz <= -0.30 && cy <= 0.145) return 'floor';
    if (cz > -0.90 && cz <= 1.55 && Math.abs(cx) > 0.235 && cy < 0.685) return 'sidepods';
    if (cz <= 0.15) return 'monocoque';
    return 'engine_cover';
  }
  return 'monocoque';
}

function assignShade(target: PartId | FixtureKey, meshName: string): number {
  if (target === 'front_suspension' || target === 'rear_suspension') {
    return meshName === 'Body567' || meshName === 'Body568' || meshName === 'Body581' ? SHADE_CAVITY : SHADE_STRUT;
  }
  return SHADE_BODY;
}

interface ClusteredMesh {
  positions: Float32Array;
  normals: Float32Array;
  shades: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  triCount: number;
}

function clusterTriangles(
  tris: RawTri[],
  cellM: number,
  clampCenterlineX = false,
  splitNormalDot = 0.0
): ClusteredMesh {
  // Step 1: Weld input corners by 0.1mm 3D position into topological vertices first
  interface TopoVert {
    x: number;
    y: number;
    z: number;
    sumW: number;
    sumNx: number;
    sumNy: number;
    sumNz: number;
    shade: number;
    centerLocked: boolean;
  }
  const topoMap = new Map<string, number>();
  const topoVerts: TopoVert[] = [];
  const triTopo = new Int32Array(tris.length * 3);

  const registerTopo = (p: Vec3, vn: Vec3, area: number, shade: number): number => {
    const isCenter = clampCenterlineX && p.x < 0.004;
    const px = isCenter ? 0 : p.x;
    const key = `${Math.round(px * 10000)},${Math.round(p.y * 10000)},${Math.round(p.z * 10000)}`;
    const w = Math.max(1e-7, area);
    let tv = topoMap.get(key);
    if (tv === undefined) {
      tv = topoVerts.length;
      topoMap.set(key, tv);
      topoVerts.push({
        x: px,
        y: p.y,
        z: p.z,
        sumW: w,
        sumNx: vn.x * w,
        sumNy: vn.y * w,
        sumNz: vn.z * w,
        shade,
        centerLocked: isCenter,
      });
    } else {
      const v = topoVerts[tv];
      v.sumW += w;
      v.sumNx += vn.x * w;
      v.sumNy += vn.y * w;
      v.sumNz += vn.z * w;
      if (isCenter) v.centerLocked = true;
    }
    return tv;
  };

  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    triTopo[t * 3] = registerTopo(tri.p0, tri.n0, tri.area, tri.shade);
    triTopo[t * 3 + 1] = registerTopo(tri.p1, tri.n1, tri.area, tri.shade);
    triTopo[t * 3 + 2] = registerTopo(tri.p2, tri.n2, tri.area, tri.shade);
  }

  // Step 2: Map each topological vertex ONCE into a voxel cluster slot (preventing edge cracks across creases)
  const inv = 1 / Math.max(0.001, cellM);
  interface ClusterSlot {
    sumX: number;
    sumY: number;
    sumZ: number;
    sumW: number;
    sumNx: number;
    sumNy: number;
    sumNz: number;
    shade: number;
    centerLocked: boolean;
    idx: number;
  }
  const voxelMap = new Map<string, ClusterSlot[]>();
  const slots: ClusterSlot[] = [];
  const topoToSlot = new Int32Array(topoVerts.length);

  for (let tv = 0; tv < topoVerts.length; tv++) {
    const v = topoVerts[tv];
    const nl = Math.hypot(v.sumNx, v.sumNy, v.sumNz) || 1;
    const vnx = v.sumNx / nl;
    const vny = v.sumNy / nl;
    const vnz = v.sumNz / nl;
    const key = `${Math.round(v.x * inv)},${Math.round(v.y * inv)},${Math.round(v.z * inv)}`;
    let bucket = voxelMap.get(key);
    if (!bucket) {
      bucket = [];
      voxelMap.set(key, bucket);
    }

    let matched: ClusterSlot | null = null;
    for (const s of bucket) {
      const snl = Math.hypot(s.sumNx, s.sumNy, s.sumNz) || 1;
      const dot = (s.sumNx * vnx + s.sumNy * vny + s.sumNz * vnz) / snl;
      if (dot >= splitNormalDot) {
        matched = s;
        break;
      }
    }

    if (matched) {
      matched.sumX += v.x * v.sumW;
      matched.sumY += v.y * v.sumW;
      matched.sumZ += v.z * v.sumW;
      matched.sumW += v.sumW;
      matched.sumNx += v.sumNx;
      matched.sumNy += v.sumNy;
      matched.sumNz += v.sumNz;
      if (v.centerLocked) matched.centerLocked = true;
      topoToSlot[tv] = matched.idx;
    } else {
      const slot: ClusterSlot = {
        sumX: v.x * v.sumW,
        sumY: v.y * v.sumW,
        sumZ: v.z * v.sumW,
        sumW: v.sumW,
        sumNx: v.sumNx,
        sumNy: v.sumNy,
        sumNz: v.sumNz,
        shade: v.shade,
        centerLocked: v.centerLocked,
        idx: slots.length,
      };
      slots.push(slot);
      bucket.push(slot);
      topoToSlot[tv] = slot.idx;
    }
  }

  const slotCount = slots.length;
  const initPos = new Float32Array(slotCount * 3);
  const initCadNorm = new Float32Array(slotCount * 3);
  const initShades = new Uint8Array(slotCount);

  for (let i = 0; i < slotCount; i++) {
    const s = slots[i];
    const iw = 1 / Math.max(1e-12, s.sumW);
    const x = s.sumX * iw;
    initPos[i * 3] = s.centerLocked ? 0 : Math.max(0, x);
    initPos[i * 3 + 1] = s.sumY * iw;
    initPos[i * 3 + 2] = s.sumZ * iw;
    const nl = Math.hypot(s.sumNx, s.sumNy, s.sumNz) || 1;
    initCadNorm[i * 3] = s.sumNx / nl;
    initCadNorm[i * 3 + 1] = s.sumNy / nl;
    initCadNorm[i * 3 + 2] = s.sumNz / nl;
    initShades[i] = s.shade;
  }

  // Deduplicate exact vertex triples & keep all non-degenerate triangles, aligning winding to CAD normals
  const seenTri = new Set<string>();
  const preCompactIdx: number[] = [];

  for (let t = 0; t < tris.length; t++) {
    const a = topoToSlot[triTopo[t * 3]];
    let b = topoToSlot[triTopo[t * 3 + 1]];
    let c = topoToSlot[triTopo[t * 3 + 2]];
    if (a === b || b === c || c === a) continue;

    const u = a < b ? (a < c ? a : c) : (b < c ? b : c);
    const w = a > b ? (a > c ? a : c) : (b > c ? b : c);
    const v = a + b + c - u - w;
    const key = `${u},${v},${w}`;
    if (seenTri.has(key)) continue;

    const oa = a * 3, ob = b * 3, oc = c * 3;
    const ux = initPos[ob] - initPos[oa];
    const uy = initPos[ob + 1] - initPos[oa + 1];
    const uz = initPos[ob + 2] - initPos[oa + 2];
    const vx = initPos[oc] - initPos[oa];
    const vy = initPos[oc + 1] - initPos[oa + 1];
    const vz = initPos[oc + 2] - initPos[oa + 2];
    const gnx = uy * vz - uz * vy;
    const gny = uz * vx - ux * vz;
    const gnz = ux * vy - uy * vx;
    const area2 = Math.hypot(gnx, gny, gnz);
    if (area2 < 1e-9) continue;

    const cnx = initCadNorm[oa] + initCadNorm[ob] + initCadNorm[oc];
    const cny = initCadNorm[oa + 1] + initCadNorm[ob + 1] + initCadNorm[oc + 1];
    const cnz = initCadNorm[oa + 2] + initCadNorm[ob + 2] + initCadNorm[oc + 2];
    if (gnx * cnx + gny * cny + gnz * cnz < 0) {
      const tmp = b;
      b = c;
      c = tmp;
    }

    seenTri.add(key);
    preCompactIdx.push(a, b, c);
  }

  // Compact unreferenced vertices
  const remap = new Int32Array(slotCount).fill(-1);
  let vCount = 0;
  for (let i = 0; i < preCompactIdx.length; i++) {
    const oldIdx = preCompactIdx[i];
    if (remap[oldIdx] === -1) {
      remap[oldIdx] = vCount++;
    }
  }

  const positions = new Float32Array(vCount * 3);
  const cadNorm = new Float32Array(vCount * 3);
  const faceNorm = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const shades = new Uint8Array(vCount);

  for (let oldIdx = 0; oldIdx < slotCount; oldIdx++) {
    const newIdx = remap[oldIdx];
    if (newIdx === -1) continue;
    const so = oldIdx * 3;
    const no = newIdx * 3;
    positions[no] = initPos[so];
    positions[no + 1] = initPos[so + 1];
    positions[no + 2] = initPos[so + 2];
    cadNorm[no] = initCadNorm[so];
    cadNorm[no + 1] = initCadNorm[so + 1];
    cadNorm[no + 2] = initCadNorm[so + 2];
    shades[newIdx] = initShades[oldIdx];
  }

  const keptIdx = new Uint32Array(preCompactIdx.length);
  for (let i = 0; i < preCompactIdx.length; i++) {
    keptIdx[i] = remap[preCompactIdx[i]];
  }

  // Accumulate area-weighted geometric face normals
  for (let i = 0; i < keptIdx.length; i += 3) {
    const a = keptIdx[i];
    const b = keptIdx[i + 1];
    const c = keptIdx[i + 2];
    const oa = a * 3, ob = b * 3, oc = c * 3;
    const ax = positions[oa], ay = positions[oa + 1], az = positions[oa + 2];
    const ux = positions[ob] - ax, uy = positions[ob + 1] - ay, uz = positions[ob + 2] - az;
    const vx = positions[oc] - ax, vy = positions[oc + 1] - ay, vz = positions[oc + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    faceNorm[oa] += nx; faceNorm[oa + 1] += ny; faceNorm[oa + 2] += nz;
    faceNorm[ob] += nx; faceNorm[ob + 1] += ny; faceNorm[ob + 2] += nz;
    faceNorm[oc] += nx; faceNorm[oc + 1] += ny; faceNorm[oc + 2] += nz;
  }

  // Blend 80% analytical CAD normal + 20% geometric face normal (strictly aligned with CAD normal)
  for (let i = 0; i < vCount; i++) {
    const o = i * 3;
    const cnx = cadNorm[o], cny = cadNorm[o + 1], cnz = cadNorm[o + 2];
    const fLen = Math.hypot(faceNorm[o], faceNorm[o + 1], faceNorm[o + 2]);
    let nx = cnx;
    let ny = cny;
    let nz = cnz;
    if (fLen > 1e-8) {
      const fnx = faceNorm[o] / fLen;
      const fny = faceNorm[o + 1] / fLen;
      const fnz = faceNorm[o + 2] / fLen;
      const dot = fnx * cnx + fny * cny + fnz * cnz;
      if (dot > 0) {
        const bx = 0.80 * cnx + 0.20 * fnx;
        const by = 0.80 * cny + 0.20 * fny;
        const bz = 0.80 * cnz + 0.20 * fnz;
        const bl = Math.hypot(bx, by, bz);
        if (bl > 1e-8) {
          nx = bx / bl;
          ny = by / bl;
          nz = bz / bl;
        }
      }
    }
    if (nx * cnx + ny * cny + nz * cnz < 0) {
      nx = cnx;
      ny = cny;
      nz = cnz;
    }
    normals[o] = nx;
    normals[o + 1] = ny;
    normals[o + 2] = nz;
  }

  return {
    positions,
    normals,
    shades,
    indices: keptIdx,
    vertexCount: vCount,
    triCount: Math.floor(keptIdx.length / 3),
  };
}

function adaptivelyCluster(
  tris: RawTri[],
  targetTris: number,
  clampCenterlineX: boolean,
  splitNormalDot = 0.0
): ClusteredMesh {
  let lo = 0.002;
  let hi = 0.080;
  let best = clusterTriangles(tris, 0.012, clampCenterlineX, splitNormalDot);
  for (let iter = 0; iter < 12; iter++) {
    const mid = 0.5 * (lo + hi);
    const cand = clusterTriangles(tris, mid, clampCenterlineX, splitNormalDot);
    if (Math.abs(cand.triCount - targetTris) < Math.abs(best.triCount - targetTris)) {
      best = cand;
    }
    if (cand.triCount > targetTris) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function computeInitialPartUV(
  partId: PartId,
  positions: Float32Array
): Float32Array {
  const count = positions.length / 3;
  const uvs = new Float32Array(count * 2);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const spanX = Math.max(0.02, maxX - minX);
  const spanY = Math.max(0.02, maxY - minY);
  const spanZ = Math.max(0.02, maxZ - minZ);

  if (partId === 'sidepods') {
    const nBins = 16;
    const binZMin = new Array(nBins).fill(Infinity);
    const binZMax = new Array(nBins).fill(-Infinity);
    const rawU = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const tZ = clamp((z - minZ) / spanZ, 0, 1);
      const cySpine = 0.44 - 0.04 * tZ;
      const dx = Math.max(0.001, x - 0.235);
      const dy = y - cySpine;
      const theta = Math.atan2(dy, dx); // +PI/2 (upper shoulder) .. 0 (outer edge) .. -PI/2 (bottom lip/undercut)
      const su = clamp((Math.PI * 0.5 - theta) / Math.PI, 0, 1);
      rawU[i] = su;

      const bi = Math.min(nBins - 1, Math.floor(su * nBins));
      if (z < binZMin[bi]) binZMin[bi] = z;
      if (z > binZMax[bi]) binZMax[bi] = z;
    }

    // Fill empty bins smoothly from neighbors
    for (let b = 0; b < nBins; b++) {
      if (!Number.isFinite(binZMin[b])) {
        binZMin[b] = minZ;
        binZMax[b] = maxZ;
      }
    }
    const smoothMinZ = [...binZMin];
    const smoothMaxZ = [...binZMax];
    for (let b = 0; b < nBins; b++) {
      const prev = Math.max(0, b - 1);
      const next = Math.min(nBins - 1, b + 1);
      smoothMinZ[b] = 0.25 * binZMin[prev] + 0.5 * binZMin[b] + 0.25 * binZMin[next];
      smoothMaxZ[b] = 0.25 * binZMax[prev] + 0.5 * binZMax[b] + 0.25 * binZMax[next];
    }

    for (let i = 0; i < count; i++) {
      const su = rawU[i];
      const z = positions[i * 3 + 2];
      const fBin = su * (nBins - 1);
      const b0 = Math.min(nBins - 2, Math.floor(fBin));
      const t = fBin - b0;
      const zF = smoothMinZ[b0] * (1 - t) + smoothMinZ[b0 + 1] * t;
      const zR = smoothMaxZ[b0] * (1 - t) + smoothMaxZ[b0 + 1] * t;
      const sv = clamp((z - zF) / Math.max(0.25, zR - zF), 0, 1);
      uvs[i * 2] = su;
      uvs[i * 2 + 1] = sv;
    }
    return uvs;
  }

  if (partId === 'nosecone' || partId === 'monocoque' || partId === 'engine_cover') {
    const nBins = 16;
    const yMidBin = new Array(nBins).fill(0);
    const yMinBin = new Array(nBins).fill(Infinity);
    const yMaxBin = new Array(nBins).fill(-Infinity);

    for (let i = 0; i < count; i++) {
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const bi = Math.min(nBins - 1, Math.max(0, Math.floor(((z - minZ) / spanZ) * nBins)));
      if (y < yMinBin[bi]) yMinBin[bi] = y;
      if (y > yMaxBin[bi]) yMaxBin[bi] = y;
    }
    for (let b = 0; b < nBins; b++) {
      if (!Number.isFinite(yMinBin[b])) {
        yMinBin[b] = minY;
        yMaxBin[b] = maxY;
      }
      yMidBin[b] = 0.45 * yMinBin[b] + 0.55 * yMaxBin[b];
    }

    for (let i = 0; i < count; i++) {
      const x = Math.max(0, positions[i * 3]);
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const sv = clamp((z - minZ) / spanZ, 0, 1);
      const b = Math.min(nBins - 1, Math.max(0, Math.floor(sv * (nBins - 1))));
      const ang = Math.atan2(x, y - yMidBin[b]); // 0 at top centerline -> PI at belly centerline
      const su = x <= 0.004 && y >= yMidBin[b] ? 0 : clamp(ang / Math.PI, 0, 1);
      uvs[i * 2] = su;
      uvs[i * 2 + 1] = sv;
    }
    return uvs;
  }

  if (partId === 'floor_boards') {
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const sv = clamp((z - minZ) / spanZ, 0, 1);
      const tY = clamp((y - minY) / spanY, 0, 1);
      const tX = clamp((x - minX) / spanX, 0, 1);
      const su = clamp(0.60 * tY + 0.40 * tX, 0, 1);
      uvs[i * 2] = su;
      uvs[i * 2 + 1] = sv;
    }
    return uvs;
  }

  if (partId === 'front_suspension' || partId === 'rear_suspension') {
    const orderX = Array.from({ length: count }, (_, i) => i).sort((a, b) => positions[a * 3] - positions[b * 3]);
    const rankX = new Float32Array(count);
    for (let k = 0; k < count; k++) rankX[orderX[k]] = count > 1 ? k / (count - 1) : 0;

    const suArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const linX = clamp((positions[i * 3] - minX) / spanX, 0, 1);
      suArr[i] = clamp(0.60 * linX + 0.40 * rankX[i], 0, 1);
    }

    const nBins = 7;
    for (let b = 0; b < nBins; b++) {
      const lo = b / nBins;
      const hi = (b + 1) / nBins + 1e-6;
      const idxList: number[] = [];
      let bMinZ = Infinity, bMaxZ = -Infinity;
      for (let i = 0; i < count; i++) {
        if (suArr[i] >= lo && suArr[i] < hi) {
          idxList.push(i);
          const z = positions[i * 3 + 2];
          if (z < bMinZ) bMinZ = z;
          if (z > bMaxZ) bMaxZ = z;
        }
      }
      idxList.sort((a, c) => positions[a * 3 + 2] - positions[c * 3 + 2]);
      const bSpanZ = Math.max(0.05, bMaxZ - bMinZ);
      for (let k = 0; k < idxList.length; k++) {
        const idx = idxList[k];
        const linZ = clamp((positions[idx * 3 + 2] - bMinZ) / bSpanZ, 0, 1);
        const rZ = idxList.length > 1 ? k / (idxList.length - 1) : 0.5;
        uvs[idx * 2] = suArr[idx];
        uvs[idx * 2 + 1] = clamp(0.55 * linZ + 0.45 * rZ, 0, 1);
      }
    }
    return uvs;
  }

  // Planar/swept wing & underbody parts: front_wing, floor, diffuser, rear_wing
  const nBins = 14;
  const binMinZ = new Array(nBins).fill(Infinity);
  const binMaxZ = new Array(nBins).fill(-Infinity);
  const suArr = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const su = clamp((positions[i * 3] - minX) / spanX, 0, 1);
    suArr[i] = su;
    const z = positions[i * 3 + 2];
    const b = Math.min(nBins - 1, Math.floor(su * nBins));
    if (z < binMinZ[b]) binMinZ[b] = z;
    if (z > binMaxZ[b]) binMaxZ[b] = z;
  }
  for (let b = 0; b < nBins; b++) {
    if (!Number.isFinite(binMinZ[b])) {
      binMinZ[b] = minZ;
      binMaxZ[b] = maxZ;
    }
  }
  for (let i = 0; i < count; i++) {
    const su = suArr[i];
    const z = positions[i * 3 + 2];
    const fBin = su * (nBins - 1);
    const b0 = Math.min(nBins - 2, Math.floor(fBin));
    const t = fBin - b0;
    const zF = binMinZ[b0] * (1 - t) + binMinZ[b0 + 1] * t;
    const zR = binMaxZ[b0] * (1 - t) + binMaxZ[b0 + 1] * t;
    uvs[i * 2] = su;
    uvs[i * 2 + 1] = clamp((z - zF) / Math.max(0.08, zR - zF), 0, 1);
  }
  return uvs;
}

function fitSurfaceLattice(
  partId: PartId,
  mesh: ClusteredMesh,
  uvs: Float32Array,
  cols: number,
  rows: number,
  centerlineLocked: boolean
): Vec3[][] {
  const pos = mesh.positions;
  const count = mesh.vertexCount;
  const grid: Vec3[][] = Array.from({ length: cols }, () => new Array<Vec3>(rows));

  for (let u = 0; u < cols; u++) {
    const tu = cols > 1 ? u / (cols - 1) : 0;
    for (let v = 0; v < rows; v++) {
      const tv = rows > 1 ? v / (rows - 1) : 0;
      let bestI = 0;
      let bestScore = Infinity;

      // Pick the mesh vertex matching target (tu, tv), preferring lip extremes at v=0 or v=rows-1
      for (let i = 0; i < count; i++) {
        const vx = pos[i * 3];
        const vz = pos[i * 3 + 2];
        const su = uvs[i * 2];
        const sv = uvs[i * 2 + 1];
        if (centerlineLocked && u === 0 && vx > 0.04) continue;
        let d2 = (su - tu) * (su - tu) * 1.1 + (sv - tv) * (sv - tv);
        if (partId === 'sidepods' && v === 0) {
          // Bias v=0 cleanly onto the forward-most intake lip edge at this angular band
          d2 += Math.max(0, vz + 0.45) * 0.08;
        }
        if (d2 < bestScore) {
          bestScore = d2;
          bestI = i;
        }
      }

      const px = pos[bestI * 3];
      const py = pos[bestI * 3 + 1];
      const pz = pos[bestI * 3 + 2];
      grid[u][v] = {
        x: centerlineLocked && u === 0 ? 0 : Math.max(0, px),
        y: py,
        z: pz,
      };
    }
  }
  return grid;
}

function closestPointOnSegmentQuad(
  p: Vec3,
  p00: Vec3,
  p10: Vec3,
  p01: Vec3,
  p11: Vec3
): { tx: number; ty: number; dist2: number } {
  // Fast 2x2 Gauss-Newton projection onto bilinear quad B(tx, ty)
  let tx = 0.5;
  let ty = 0.5;
  for (let it = 0; it < 5; it++) {
    const bx = (1 - tx) * (1 - ty) * p00.x + tx * (1 - ty) * p10.x + (1 - tx) * ty * p01.x + tx * ty * p11.x - p.x;
    const by = (1 - tx) * (1 - ty) * p00.y + tx * (1 - ty) * p10.y + (1 - tx) * ty * p01.y + tx * ty * p11.y - p.y;
    const bz = (1 - tx) * (1 - ty) * p00.z + tx * (1 - ty) * p10.z + (1 - tx) * ty * p01.z + tx * ty * p11.z - p.z;

    const dux = (1 - ty) * (p10.x - p00.x) + ty * (p11.x - p01.x);
    const duy = (1 - ty) * (p10.y - p00.y) + ty * (p11.y - p01.y);
    const duz = (1 - ty) * (p10.z - p00.z) + ty * (p11.z - p01.z);

    const dvx = (1 - tx) * (p01.x - p00.x) + tx * (p11.x - p10.x);
    const dvy = (1 - tx) * (p01.y - p00.y) + tx * (p11.y - p10.y);
    const dvz = (1 - tx) * (p01.z - p00.z) + tx * (p11.z - p10.z);

    const g00 = dux * dux + duy * duy + duz * duz + 1e-6;
    const g01 = dux * dvx + duy * dvy + duz * dvz;
    const g11 = dvx * dvx + dvy * dvy + dvz * dvz + 1e-6;
    const r0 = -(bx * dux + by * duy + bz * duz);
    const r1 = -(bx * dvx + by * dvy + bz * dvz);

    const det = g00 * g11 - g01 * g01;
    if (Math.abs(det) > 1e-12) {
      tx = clamp(tx + (r0 * g11 - r1 * g01) / det, 0, 1);
      ty = clamp(ty + (g00 * r1 - g01 * r0) / det, 0, 1);
    }
  }
  const qx = (1 - tx) * (1 - ty) * p00.x + tx * (1 - ty) * p10.x + (1 - tx) * ty * p01.x + tx * ty * p11.x - p.x;
  const qy = (1 - tx) * (1 - ty) * p00.y + tx * (1 - ty) * p10.y + (1 - tx) * ty * p01.y + tx * ty * p11.y - p.y;
  const qz = (1 - tx) * (1 - ty) * p00.z + tx * (1 - ty) * p10.z + (1 - tx) * ty * p01.z + tx * ty * p11.z - p.z;
  return { tx, ty, dist2: qx * qx + qy * qy + qz * qz };
}

function projectVerticesOntoLattice(
  partId: PartId,
  mesh: ClusteredMesh,
  initUvs: Float32Array,
  grid: Vec3[][],
  cols: number,
  rows: number
): Float32Array {
  const pos = mesh.positions;
  const count = mesh.vertexCount;
  const outUvs = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const p: Vec3 = { x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] };
    const su0 = initUvs[i * 2];
    const sv0 = initUvs[i * 2 + 1];

    let bestSu = su0;
    let bestSv = sv0;
    let bestCost = Infinity;

    for (let u = 0; u < cols - 1; u++) {
      for (let v = 0; v < rows - 1; v++) {
        const res = closestPointOnSegmentQuad(
          p,
          grid[u][v],
          grid[u + 1][v],
          grid[u][v + 1],
          grid[u + 1][v + 1]
        );
        const suCand = (u + res.tx) / (cols - 1);
        const svCand = (v + res.ty) / (rows - 1);
        const d3 = Math.sqrt(res.dist2);
        const dUv = Math.hypot(suCand - su0, svCand - sv0);
        // On sidepods/fuselage shells, keep upper/lower lips strictly separated by blending initial (su0,sv0) penalty
        const uvWeight = partId === 'sidepods' ? 0.16 : 0.08;
        const cost = d3 + uvWeight * dUv;
        if (cost < bestCost) {
          bestCost = cost;
          bestSu = suCand;
          bestSv = svCand;
        }
      }
    }

    outUvs[i * 2] = clamp(bestSu, 0, 1);
    outUvs[i * 2 + 1] = clamp(bestSv, 0, 1);
  }
  return outUvs;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function verifyAllNodesMoveMesh(
  partId: PartId,
  mesh: ClusteredMesh,
  uvs: Float32Array,
  grid: Vec3[][],
  cols: number,
  rows: number
): void {
  let deadCount = 0;
  for (let u = 0; u < cols; u++) {
    for (let v = 0; v < rows; v++) {
      let maxW = 0;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const fu = uvs[i * 2] * (cols - 1);
        const fv = uvs[i * 2 + 1] * (rows - 1);
        const du = Math.abs(fu - u);
        const dv = Math.abs(fv - v);
        if (du < 1 && dv < 1) {
          const w = (1 - smoothstep(du)) * (1 - smoothstep(dv));
          if (w > maxW) maxW = w;
        }
      }
      if (maxW < 0.35) {
        deadCount++;
        // Bind closest local vertices around node center if none mapped directly inside cell
        const nodePt = grid[u][v];
        let bestIdx = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < mesh.vertexCount; i++) {
          const dx = mesh.positions[i * 3] - nodePt.x;
          const dy = mesh.positions[i * 3 + 1] - nodePt.y;
          const dz = mesh.positions[i * 3 + 2] - nodePt.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = i;
          }
        }
        uvs[bestIdx * 2] = u / (cols - 1);
        uvs[bestIdx * 2 + 1] = v / (rows - 1);
      }
    }
  }
  if (deadCount > 0) {
    console.log(`   [${partId}] pinned ${deadCount} sparse corner/edge nodes directly to nearest mesh vertex.`);
  }
}

console.log('=== BUILDING FBX CAR DATA FROM', FBX_PATH, '===');
const buf = fs.readFileSync(FBX_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const rootGroup = new FBXLoader().parse(ab, '');
rootGroup.updateMatrixWorld(true);

const partTris: Record<PartId, RawTri[]> = {
  front_wing: [],
  nosecone: [],
  front_suspension: [],
  monocoque: [],
  floor_boards: [],
  floor: [],
  sidepods: [],
  engine_cover: [],
  rear_suspension: [],
  diffuser: [],
  rear_wing: [],
};

const fixtureTris: Record<FixtureKey, RawTri[]> = {
  wheel_front: [],
  wheel_rear: [],
  halo: [],
  mirrors: [],
  cockpit: [],
  exhaust: [],
};

const vTmp = new THREE.Vector3();
const nTmp = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

interface WorldRawTri {
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  n0: Vec3;
  n1: Vec3;
  n2: Vec3;
}

function extractCadNormal(normAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, idx: number): Vec3 {
  if (!normAttr) return { x: 0, y: 1, z: 0 };
  nTmp.fromBufferAttribute(normAttr, idx).applyMatrix3(normalMatrix);
  // Apply Y <-> Z swap to match fbxToWorld
  return normalizeVec({ x: nTmp.x, y: nTmp.z, z: nTmp.y });
}

rootGroup.traverse((obj) => {
  if (!(obj as THREE.Mesh).isMesh) return;
  const geom: THREE.BufferGeometry = obj.geometry;
  const meshName = obj.name;

  const posAttr = geom.attributes.position;
  if (!posAttr) return;
  const normAttr = geom.attributes.normal;
  const idxAttr = geom.index;
  const triTotal = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
  normalMatrix.getNormalMatrix(obj.matrixWorld);

  let rawMeshTris: WorldRawTri[] = [];
  let plusCount = 0;
  for (let t = 0; t < triTotal; t++) {
    const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
    const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;

    vTmp.fromBufferAttribute(posAttr, i0).applyMatrix4(obj.matrixWorld);
    const p0 = fbxToWorld(vTmp);
    // fbxToWorld swaps Y <-> Z (det = -1), so swap (i1, i2) to restore right-handed winding
    vTmp.fromBufferAttribute(posAttr, i2).applyMatrix4(obj.matrixWorld);
    let p1 = fbxToWorld(vTmp);
    vTmp.fromBufferAttribute(posAttr, i1).applyMatrix4(obj.matrixWorld);
    let p2 = fbxToWorld(vTmp);

    let n0: Vec3;
    let n1: Vec3;
    let n2: Vec3;
    if (normAttr) {
      n0 = extractCadNormal(normAttr, i0);
      n1 = extractCadNormal(normAttr, i2);
      n2 = extractCadNormal(normAttr, i1);
      const { n } = computeTriNormal(p0, p1, p2);
      const sx = n0.x + n1.x + n2.x;
      const sy = n0.y + n1.y + n2.y;
      const sz = n0.z + n1.z + n2.z;
      if (n.x * sx + n.y * sy + n.z * sz < 0) {
        const tmpP = p1; p1 = p2; p2 = tmpP;
        const tmpN = n1; n1 = n2; n2 = tmpN;
      }
    } else {
      const { n } = computeTriNormal(p0, p1, p2);
      n0 = n; n1 = n; n2 = n;
    }

    rawMeshTris.push({ p0, p1, p2, n0, n1, n2 });
    if ((p0.x + p1.x + p2.x) / 3 >= -0.002) plusCount++;
  }

  // On FRONT_NOSE, strip disconnected internal radiator honeycomb / baffle micro-components in world space
  if (meshName === 'FRONT_NOSE') {
    const vMap = new Map<string, number>();
    const triVerts = new Int32Array(rawMeshTris.length * 3);
    const cornerPts: Vec3[] = [];
    const registerCorner = (p: Vec3, n: Vec3): number => {
      const key = `${Math.round(p.x * 5000)},${Math.round(p.y * 5000)},${Math.round(p.z * 5000)}|${Math.round(n.x * 100)},${Math.round(n.y * 100)},${Math.round(n.z * 100)}`;
      let id = vMap.get(key);
      if (id === undefined) {
        id = cornerPts.length;
        vMap.set(key, id);
        cornerPts.push(p);
      }
      return id;
    };
    for (let t = 0; t < rawMeshTris.length; t++) {
      const rt = rawMeshTris[t];
      triVerts[t * 3] = registerCorner(rt.p0, rt.n0);
      triVerts[t * 3 + 1] = registerCorner(rt.p1, rt.n1);
      triVerts[t * 3 + 2] = registerCorner(rt.p2, rt.n2);
    }

    const V = cornerPts.length;
    const parent = new Int32Array(V).fill(-1);
    const findRoot = (x: number): number => {
      while (parent[x] >= 0) {
        if (parent[parent[x]] >= 0) parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const unionRoots = (a: number, b: number) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) {
        if (parent[ra] < parent[rb]) {
          parent[ra] += parent[rb];
          parent[rb] = ra;
        } else {
          parent[rb] += parent[ra];
          parent[ra] = rb;
        }
      }
    };
    for (let t = 0; t < rawMeshTris.length; t++) {
      unionRoots(triVerts[t * 3], triVerts[t * 3 + 1]);
      unionRoots(triVerts[t * 3 + 1], triVerts[t * 3 + 2]);
    }

    interface CompBox { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; }
    const compBoxes = new Map<number, CompBox>();
    for (let t = 0; t < rawMeshTris.length; t++) {
      const r = findRoot(triVerts[t * 3]);
      let b = compBoxes.get(r);
      if (!b) {
        b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
        compBoxes.set(r, b);
      }
      for (let k = 0; k < 3; k++) {
        const pt = cornerPts[triVerts[t * 3 + k]];
        if (pt.x < b.minX) b.minX = pt.x;
        if (pt.x > b.maxX) b.maxX = pt.x;
        if (pt.y < b.minY) b.minY = pt.y;
        if (pt.y > b.maxY) b.maxY = pt.y;
        if (pt.z < b.minZ) b.minZ = pt.z;
        if (pt.z > b.maxZ) b.maxZ = pt.z;
      }
    }

    const filteredTris: WorldRawTri[] = [];
    for (let t = 0; t < rawMeshTris.length; t++) {
      const r = findRoot(triVerts[t * 3]);
      const b = compBoxes.get(r)!;
      const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      if (diag > 0.50) {
        filteredTris.push(rawMeshTris[t]);
      }
    }
    rawMeshTris = filteredTris;
    console.log(`Filtered FRONT_NOSE exterior shell (>0.50m diag): ${rawMeshTris.length} tris`);
  }

  const mirrorFromMinusX = plusCount < rawMeshTris.length * 0.05;

  for (const rt of rawMeshTris) {
    let p0 = rt.p0, p1 = rt.p1, p2 = rt.p2;
    let n0 = rt.n0, n1 = rt.n1, n2 = rt.n2;
    if (mirrorFromMinusX) {
      p0 = { x: -p0.x, y: p0.y, z: p0.z };
      p1 = { x: -rt.p2.x, y: rt.p2.y, z: rt.p2.z };
      p2 = { x: -rt.p1.x, y: rt.p1.y, z: rt.p1.z };
      n0 = { x: -n0.x, y: n0.y, z: n0.z };
      n1 = { x: -rt.n2.x, y: rt.n2.y, z: rt.n2.z };
      n2 = { x: -rt.n1.x, y: rt.n1.y, z: rt.n1.z };
    }

    const cx = (p0.x + p1.x + p2.x) / 3;
    const cy = (p0.y + p1.y + p2.y) / 3;
    const cz = (p0.z + p1.z + p2.z) / 3;
    const target = classifyTriangleTarget(meshName, cx, cy, cz);

    if (target in fixtureTris) {
      const fKey = target as FixtureKey;
      const isBilateralFixture = fKey === 'halo' || fKey === 'cockpit' || fKey === 'exhaust';
      if (!isBilateralFixture && cx < -0.002) continue;
      const { n, area } = computeTriNormal(p0, p1, p2);
      if (area > 1e-9) {
        fixtureTris[fKey].push({ p0, p1, p2, n0, n1, n2, n, area, shade: SHADE_BODY });
      }
      continue;
    }

    if (cx < -0.002) continue;
    const { n, area } = computeTriNormal(p0, p1, p2);
    if (area <= 1e-9) continue;

    const pId = target as PartId;
    partTris[pId].push({
      p0,
      p1,
      p2,
      n0,
      n1,
      n2,
      n,
      area,
      shade: assignShade(pId, meshName),
    });
  }
});

// Cluster parts to target Preview counts (~48,000 +X tris => ~96,000 Preview => ~864k Full at S=3)
const partMeshes = {} as Record<PartId, ClusteredMesh>;
for (const id of PART_ORDER) {
  const cfg = PART_DENSE_DIMS[id];
  partMeshes[id] = adaptivelyCluster(partTris[id], cfg.targetTris, cfg.centerlineLocked, 0.0);
}

// Weld open boundary vertices across split cuts on FRONT_NOSE and Body572 so seams have 0.000mm gap & continuous normals
{
  const CUT_SEAM_PAIRS: Array<[PartId, PartId]> = [
    ['nosecone', 'monocoque'],
    ['monocoque', 'sidepods'],
    ['monocoque', 'engine_cover'],
    ['sidepods', 'engine_cover'],
    ['nosecone', 'floor'],
    ['monocoque', 'floor'],
    ['sidepods', 'floor'],
    ['engine_cover', 'floor'],
    ['floor', 'diffuser'],
  ];

  const boundaryVertsByPart = {} as Partial<Record<PartId, number[]>>;
  const involvedParts = new Set<PartId>();
  for (const [a, b] of CUT_SEAM_PAIRS) {
    involvedParts.add(a);
    involvedParts.add(b);
  }

  for (const id of involvedParts) {
    const m = partMeshes[id];
    const edgeCount = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      const i0 = m.indices[t], i1 = m.indices[t + 1], i2 = m.indices[t + 2];
      const edges: Array<[number, number]> = [[i0, i1], [i1, i2], [i2, i0]];
      for (const [u, v] of edges) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }
    const bSet = new Set<number>();
    for (const [k, cnt] of edgeCount.entries()) {
      if (cnt === 1) {
        const comma = k.indexOf(',');
        bSet.add(Number(k.slice(0, comma)));
        bSet.add(Number(k.slice(comma + 1)));
      }
    }
    boundaryVertsByPart[id] = Array.from(bSet);
  }

  // Global union-find over boundary vertices of involved parts
  interface BoundaryRef { partId: PartId; vIdx: number; }
  const bRefs: BoundaryRef[] = [];
  const refLookup = new Map<string, number>();
  for (const id of involvedParts) {
    for (const vIdx of boundaryVertsByPart[id] ?? []) {
      const idx = bRefs.length;
      bRefs.push({ partId: id, vIdx });
      refLookup.set(`${id}:${vIdx}`, idx);
    }
  }

  const bParent = new Int32Array(bRefs.length).fill(-1);
  const findB = (x: number): number => {
    while (bParent[x] >= 0) {
      if (bParent[bParent[x]] >= 0) bParent[x] = bParent[bParent[x]];
      x = bParent[x];
    }
    return x;
  };
  const uniteB = (a: number, b: number) => {
    const ra = findB(a);
    const rb = findB(b);
    if (ra !== rb) {
      if (bParent[ra] < bParent[rb]) {
        bParent[ra] += bParent[rb];
        bParent[rb] = ra;
      } else {
        bParent[rb] += bParent[ra];
        bParent[ra] = rb;
      }
    }
  };

  let weldedPairs = 0;
  for (const [partA, partB] of CUT_SEAM_PAIRS) {
    const mA = partMeshes[partA];
    const mB = partMeshes[partB];
    const bA = boundaryVertsByPart[partA] ?? [];
    const bB = boundaryVertsByPart[partB] ?? [];
    const cell = 0.016;
    const gridB = new Map<string, number[]>();
    for (const vb of bB) {
      const ox = Math.floor(mB.positions[vb * 3] / cell);
      const oy = Math.floor(mB.positions[vb * 3 + 1] / cell);
      const oz = Math.floor(mB.positions[vb * 3 + 2] / cell);
      const k = `${ox},${oy},${oz}`;
      let arr = gridB.get(k);
      if (!arr) { arr = []; gridB.set(k, arr); }
      arr.push(vb);
    }
    for (const va of bA) {
      const oa = va * 3;
      const ax = mA.positions[oa], ay = mA.positions[oa + 1], az = mA.positions[oa + 2];
      const nax = mA.normals[oa], nay = mA.normals[oa + 1], naz = mA.normals[oa + 2];
      const gx = Math.floor(ax / cell), gy = Math.floor(ay / cell), gz = Math.floor(az / cell);
      let bestVb = -1;
      let bestD2 = 0.015 * 0.015;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = gridB.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!list) continue;
            for (const vb of list) {
              const ob = vb * 3;
              const nDot = nax * mB.normals[ob] + nay * mB.normals[ob + 1] + naz * mB.normals[ob + 2];
              if (nDot < 0.75) continue;
              const ddx = mB.positions[ob] - ax;
              const ddy = mB.positions[ob + 1] - ay;
              const ddz = mB.positions[ob + 2] - az;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 < bestD2) {
                bestD2 = d2;
                bestVb = vb;
              }
            }
          }
        }
      }
      if (bestVb >= 0) {
        const ra = refLookup.get(`${partA}:${va}`);
        const rb = refLookup.get(`${partB}:${bestVb}`);
        if (ra !== undefined && rb !== undefined) {
          uniteB(ra, rb);
          weldedPairs++;
        }
      }
    }
  }

  const groups = new Map<number, BoundaryRef[]>();
  for (let i = 0; i < bRefs.length; i++) {
    const r = findB(i);
    if (bParent[r] < -1) {
      let arr = groups.get(r);
      if (!arr) { arr = []; groups.set(r, arr); }
      arr.push(bRefs[i]);
    }
  }
  for (const members of groups.values()) {
    let sx = 0, sy = 0, sz = 0;
    let snx = 0, sny = 0, snz = 0;
    let lockX = false;
    for (const mb of members) {
      const m = partMeshes[mb.partId];
      const o = mb.vIdx * 3;
      if (PART_DENSE_DIMS[mb.partId].centerlineLocked && m.positions[o] <= 0.002) {
        lockX = true;
      }
      sx += m.positions[o]; sy += m.positions[o + 1]; sz += m.positions[o + 2];
      snx += m.normals[o]; sny += m.normals[o + 1]; snz += m.normals[o + 2];
    }
    const invN = 1 / members.length;
    const ax = lockX ? 0 : sx * invN;
    const ay = sy * invN;
    const az = sz * invN;
    const nl = Math.hypot(snx, sny, snz) || 1;
    const anx = snx / nl, any = sny / nl, anz = snz / nl;
    for (const mb of members) {
      const m = partMeshes[mb.partId];
      const o = mb.vIdx * 3;
      m.positions[o] = ax; m.positions[o + 1] = ay; m.positions[o + 2] = az;
      m.normals[o] = anx; m.normals[o + 1] = any; m.normals[o + 2] = anz;
    }
  }
  console.log(`Welded ${groups.size} cut-seam clusters (${weldedPairs} boundary matches) across FRONT_NOSE & Body572 cuts.`);
}

// Post-weld cleanup: remove degenerate boundary triangles created by seam snapping & align winding with normals
let totalPlusTris = 0;
for (const id of PART_ORDER) {
  const m = partMeshes[id];
  const kept: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t];
    let b = m.indices[t + 1];
    let c = m.indices[t + 2];
    const oa = a * 3, ob = b * 3, oc = c * 3;
    const ux = m.positions[ob] - m.positions[oa];
    const uy = m.positions[ob + 1] - m.positions[oa + 1];
    const uz = m.positions[ob + 2] - m.positions[oa + 2];
    const vx = m.positions[oc] - m.positions[oa];
    const vy = m.positions[oc + 1] - m.positions[oa + 1];
    const vz = m.positions[oc + 2] - m.positions[oa + 2];
    const gnx = uy * vz - uz * vy;
    const gny = uz * vx - ux * vz;
    const gnz = ux * vy - uy * vx;
    const area2 = Math.hypot(gnx, gny, gnz);
    if (area2 < 1e-10) continue;

    const vnx = m.normals[oa] + m.normals[ob] + m.normals[oc];
    const vny = m.normals[oa + 1] + m.normals[ob + 1] + m.normals[oc + 1];
    const vnz = m.normals[oa + 2] + m.normals[ob + 2] + m.normals[oc + 2];
    if (gnx * vnx + gny * vny + gnz * vnz < 0) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    kept.push(a, b, c);
  }
  m.indices = new Uint32Array(kept);
  m.triCount = Math.floor(kept.length / 3);
  totalPlusTris += m.triCount;
}

const initUvsMap = {} as Record<PartId, Float32Array>;
const baseGrids = {} as Record<PartId, Vec3[][]>;

for (const id of PART_ORDER) {
  const cfg = PART_DENSE_DIMS[id];
  const cm = partMeshes[id];
  initUvsMap[id] = computeInitialPartUV(id, cm.positions);
  baseGrids[id] = fitSurfaceLattice(id, cm, initUvsMap[id], cfg.cols, cfg.rows, cfg.centerlineLocked);
  console.log(
    `Part ${id.padEnd(16)}: verts=${String(cm.vertexCount).padStart(5)}, +X tris=${String(cm.triCount).padStart(5)} (Full~${(cm.triCount * 2 * 9).toLocaleString()})`
  );
}
console.log(`Total +X tris: ${totalPlusTris}, Preview car: ${(totalPlusTris * 2).toLocaleString()}, Full LOD (3x): ${(totalPlusTris * 2 * 9).toLocaleString()}`);

// Weld SEAM_LINKS on dense grids so adjacent boundaries have 0.000000mm gap
for (const seam of SEAM_LINKS) {
  const len = Math.min(seam.nodesA.length, seam.nodesB.length);
  for (let i = 0; i < len - 1; i++) {
    const a0 = seam.nodesA[i];
    const a1 = seam.nodesA[i + 1];
    const b0 = seam.nodesB[i];
    const b1 = seam.nodesB[i + 1];
    for (let step = i === 0 ? 0 : 1; step <= 3; step++) {
      const au = a0.u * 3 + step * (a1.u - a0.u);
      const av = a0.v * 3 + step * (a1.v - a0.v);
      const bu = b0.u * 3 + step * (b1.u - b0.u);
      const bv = b0.v * 3 + step * (b1.v - b0.v);
      const pa = baseGrids[seam.partA][au][av];
      const pb = baseGrids[seam.partB][bu][bv];
      const lockX =
        (PART_DENSE_DIMS[seam.partA].centerlineLocked && au === 0) ||
        (PART_DENSE_DIMS[seam.partB].centerlineLocked && bu === 0);
      const avg: Vec3 = {
        x: lockX ? 0 : 0.5 * (pa.x + pb.x),
        y: 0.5 * (pa.y + pb.y),
        z: 0.5 * (pa.z + pb.z),
      };
      baseGrids[seam.partA][au][av] = { ...avg };
      baseGrids[seam.partB][bu][bv] = { ...avg };
    }
  }
}

// Re-project every vertex onto final surface lattice & ensure zero dead dots
const finalUvsMap = {} as Record<PartId, Float32Array>;
for (const id of PART_ORDER) {
  const cfg = PART_DENSE_DIMS[id];
  const uvs = projectVerticesOntoLattice(
    id,
    partMeshes[id],
    initUvsMap[id],
    baseGrids[id],
    cfg.cols,
    cfg.rows
  );
  verifyAllNodesMoveMesh(id, partMeshes[id], uvs, baseGrids[id], cfg.cols, cfg.rows);
  finalUvsMap[id] = uvs;
}

// Verify Sidepods (5, 0) & (8, 0) isolation directly before writing output
{
  const spMesh = partMeshes.sidepods;
  const spUv = finalUvsMap.sidepods;
  let upper5Count = 0;
  let bot8Count = 0;
  let upperBleed = 0;
  for (let i = 0; i < spMesh.vertexCount; i++) {
    const fu = spUv[i * 2] * 9;
    const fv = spUv[i * 2 + 1] * 9;
    if (Math.abs(fu - 5) < 0.9 && fv < 0.9) upper5Count++;
    if (Math.abs(fu - 8) < 0.9 && fv < 0.9) bot8Count++;
    if (fu <= 2.9 && fv < 1.0 && Math.abs(fu - 5) < 1.0) upperBleed++;
  }
  console.log(`Sidepod verification: (5,0) verts=${upper5Count}, (8,0) verts=${bot8Count}, upper-lip bleed=${upperBleed}`);
}

// Print exact FIA mm bounds for all 11 parts so fia2026.ts boxes match 100%
console.log('\n--- BASELINE PART BOUNDS IN FIA MM ---');
for (const id of PART_ORDER) {
  const pos = partMeshes[id].positions;
  let minXF = Infinity, maxXF = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < partMeshes[id].vertexCount; i++) {
    const xF = pos[i * 3 + 2] * 1000 + 1700;
    const yFia = pos[i * 3] * 1000;
    const zFia = pos[i * 3 + 1] * 1000 - 30.8;
    if (xF < minXF) minXF = xF;
    if (xF > maxXF) maxXF = xF;
    if (yFia > maxY) maxY = yFia;
    if (zFia < minZ) minZ = zFia;
    if (zFia > maxZ) maxZ = zFia;
  }
  for (const col of baseGrids[id]) {
    for (const p of col) {
      const xF = p.z * 1000 + 1700;
      const yFia = p.x * 1000;
      const zFia = p.y * 1000 - 30.8;
      if (xF < minXF) minXF = xF;
      if (xF > maxXF) maxXF = xF;
      if (yFia > maxY) maxY = yFia;
      if (zFia < minZ) minZ = zFia;
      if (zFia > maxZ) maxZ = zFia;
    }
  }
  console.log(`${id.padEnd(16)}: xF=[${Math.floor(minXF)}, ${Math.ceil(maxXF)}], yMax=${Math.ceil(maxY)}, z=[${Math.floor(minZ)}, ${Math.ceil(maxZ)}]`);
}

// Cluster fixtures
const fixtureTargets: Record<FixtureKey, number> = {
  wheel_front: 1800,
  wheel_rear: 2000,
  halo: 700,
  mirrors: 500,
  cockpit: 350,
  exhaust: 400,
};

const fixtureMeshes = {} as Record<FixtureKey, ClusteredMesh>;
const wheelCenters = {
  front: { x: 0.788, y: 0.35, z: -1.70 },
  rear: { x: 0.734, y: 0.35, z: 1.70 },
};

for (const fk of Object.keys(fixtureTris) as FixtureKey[]) {
  const cm = adaptivelyCluster(fixtureTris[fk], fixtureTargets[fk], false, 0.0);
  if (fk === 'wheel_front' || fk === 'wheel_rear') {
    const c = fk === 'wheel_front' ? wheelCenters.front : wheelCenters.rear;
    for (let i = 0; i < cm.vertexCount; i++) {
      cm.positions[i * 3] -= c.x;
      cm.positions[i * 3 + 1] -= c.y;
      cm.positions[i * 3 + 2] -= c.z;
    }
  }
  fixtureMeshes[fk] = cm;
  console.log(`Fixture ${fk.padEnd(12)}: verts=${cm.vertexCount}, tris=${cm.triCount}`);
}

// Emit src/surface/fbxCarData.ts
const lines: string[] = [];
lines.push('// Auto-generated by scripts/buildFbxCarData.ts from public/2026-formula-1-car/source/222.fbx');
lines.push('// Do not edit manually.');
lines.push("import { PartId, Vec3 } from '../types/aero';");
lines.push('');
lines.push('export interface FbxPartTemplate {');
lines.push('  positions: Float32Array;');
lines.push('  normals: Float32Array;');
lines.push('  uvs: Float32Array;');
lines.push('  shades: Uint8Array;');
lines.push('  indices: Uint16Array;');
lines.push('  baseDetail: Vec3[][];');
lines.push('}');
lines.push('');
lines.push('export interface FbxFixtureTemplate {');
lines.push('  positions: Float32Array;');
lines.push('  normals: Float32Array;');
lines.push('  indices: Uint16Array;');
lines.push('}');
lines.push('');
lines.push('function decodeB64(b64: string): Uint8Array {');
lines.push('  const bin = atob(b64);');
lines.push('  const out = new Uint8Array(bin.length);');
lines.push('  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);');
lines.push('  return out;');
lines.push('}');
lines.push('');
lines.push('function decodePart(');
lines.push('  posB64: string,');
lines.push('  normB64: string,');
lines.push('  uvB64: string,');
lines.push('  shadeB64: string,');
lines.push('  idxB64: string,');
lines.push('  rawGrid: number[][][]');
lines.push('): FbxPartTemplate {');
lines.push('  const pb = decodeB64(posB64);');
lines.push('  const positions = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);');
lines.push('  const nb = decodeB64(normB64);');
lines.push('  const nInt = new Int16Array(nb.buffer, nb.byteOffset, nb.byteLength / 2);');
lines.push('  const normals = new Float32Array(nInt.length);');
lines.push('  for (let i = 0; i < nInt.length; i++) normals[i] = nInt[i] / 32767;');
lines.push('  const ub = decodeB64(uvB64);');
lines.push('  const uInt = new Uint16Array(ub.buffer, ub.byteOffset, ub.byteLength / 2);');
lines.push('  const uvs = new Float32Array(uInt.length);');
lines.push('  for (let i = 0; i < uInt.length; i++) uvs[i] = uInt[i] / 65535;');
lines.push('  const shades = decodeB64(shadeB64);');
lines.push('  const ib = decodeB64(idxB64);');
lines.push('  const indices = new Uint16Array(ib.buffer, ib.byteOffset, ib.byteLength / 2);');
lines.push('  const baseDetail = rawGrid.map((col) => col.map(([x, y, z]) => ({ x, y, z })));');
lines.push('  return { positions, normals, uvs, shades, indices, baseDetail };');
lines.push('}');
lines.push('');
lines.push('function decodeFixture(posB64: string, normB64: string, idxB64: string): FbxFixtureTemplate {');
lines.push('  const pb = decodeB64(posB64);');
lines.push('  const positions = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);');
lines.push('  const nb = decodeB64(normB64);');
lines.push('  const nInt = new Int16Array(nb.buffer, nb.byteOffset, nb.byteLength / 2);');
lines.push('  const normals = new Float32Array(nInt.length);');
lines.push('  for (let i = 0; i < nInt.length; i++) normals[i] = nInt[i] / 32767;');
lines.push('  const ib = decodeB64(idxB64);');
lines.push('  const indices = new Uint16Array(ib.buffer, ib.byteOffset, ib.byteLength / 2);');
lines.push('  return { positions, normals, indices };');
lines.push('}');
lines.push('');
lines.push('export const FBX_WHEEL_CENTERS = {');
lines.push(`  front: { x: ${wheelCenters.front.x}, y: ${wheelCenters.front.y}, z: ${wheelCenters.front.z} },`);
lines.push(`  rear: { x: ${wheelCenters.rear.x}, y: ${wheelCenters.rear.y}, z: ${wheelCenters.rear.z} },`);
lines.push('} as const;');
lines.push('');
lines.push('export const FBX_CAR_PARTS: Record<PartId, FbxPartTemplate> = {');

for (const id of PART_ORDER) {
  const cm = partMeshes[id];
  if (cm.vertexCount >= 65535) throw new Error(`Part ${id} vertex count ${cm.vertexCount} exceeds Uint16`);
  const nInt = new Int16Array(cm.normals.length);
  for (let i = 0; i < cm.normals.length; i++) {
    nInt[i] = Math.round(clamp(cm.normals[i], -1, 1) * 32767);
  }
  const uv = finalUvsMap[id];
  const uvInt = new Uint16Array(uv.length);
  for (let i = 0; i < uv.length; i++) {
    uvInt[i] = Math.round(clamp(uv[i], 0, 1) * 65535);
  }
  const idx16 = new Uint16Array(cm.indices);

  const posB64 = encodeBase64(new Uint8Array(cm.positions.buffer, cm.positions.byteOffset, cm.positions.byteLength));
  const normB64 = encodeBase64(new Uint8Array(nInt.buffer, nInt.byteOffset, nInt.byteLength));
  const uvB64 = encodeBase64(new Uint8Array(uvInt.buffer, uvInt.byteOffset, uvInt.byteLength));
  const shadeB64 = encodeBase64(cm.shades);
  const idxB64 = encodeBase64(new Uint8Array(idx16.buffer, idx16.byteOffset, idx16.byteLength));
  const rawGrid = baseGrids[id].map((col) =>
    col.map((p) => [Math.round(p.x * 1e5) / 1e5, Math.round(p.y * 1e5) / 1e5, Math.round(p.z * 1e5) / 1e5])
  );

  lines.push(`  ${id}: decodePart(`);
  lines.push(`    '${posB64}',`);
  lines.push(`    '${normB64}',`);
  lines.push(`    '${uvB64}',`);
  lines.push(`    '${shadeB64}',`);
  lines.push(`    '${idxB64}',`);
  lines.push(`    ${JSON.stringify(rawGrid)}`);
  lines.push('  ),');
}
lines.push('};');
lines.push('');
lines.push('export const FBX_FIXTURES = {');
for (const fk of Object.keys(fixtureMeshes) as FixtureKey[]) {
  const cm = fixtureMeshes[fk];
  if (cm.vertexCount >= 65535) throw new Error(`Fixture ${fk} vertex count ${cm.vertexCount} exceeds Uint16`);
  const nInt = new Int16Array(cm.normals.length);
  for (let i = 0; i < cm.normals.length; i++) {
    nInt[i] = Math.round(clamp(cm.normals[i], -1, 1) * 32767);
  }
  const idx16 = new Uint16Array(cm.indices);
  const posB64 = encodeBase64(new Uint8Array(cm.positions.buffer, cm.positions.byteOffset, cm.positions.byteLength));
  const normB64 = encodeBase64(new Uint8Array(nInt.buffer, nInt.byteOffset, nInt.byteLength));
  const idxB64 = encodeBase64(new Uint8Array(idx16.buffer, idx16.byteOffset, idx16.byteLength));
  lines.push(`  ${fk}: decodeFixture('${posB64}', '${normB64}', '${idxB64}'),`);
}
lines.push('} as const;');
lines.push('');

fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
const stat = fs.statSync(OUT_PATH);
console.log(`\nWrote ${path.resolve(OUT_PATH)} (${(stat.size / 1024).toFixed(1)} KB)`);
