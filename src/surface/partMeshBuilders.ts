import { ActiveAeroMode, AeroPartData, Vec3 } from '../types/aero';
import { FBX_CAR_PARTS } from './fbxCarData';
import { LODLevel } from './surfaceTypes';

export const SHADE_BODY = 0;
export const SHADE_LOWER = 1;
export const SHADE_STRUT = 2;
export const SHADE_CAVITY = 3;
export const SHADE_TRIM = 4;

/**
 * Reusable growable typed-array geometry builder preserved for API compatibility.
 */
export class MeshBuildBuffer {
  public positions = new Float32Array(4096 * 3);
  public normals = new Float32Array(4096 * 3);
  public shades = new Uint8Array(4096);
  public indices = new Uint32Array(8192 * 3);
  public vertexCount = 0;
  public indexCount = 0;

  private ensureVertCap(needed: number): void {
    if (needed <= this.shades.length) return;
    let cap = this.shades.length;
    while (cap < needed) cap *= 2;
    const p = new Float32Array(cap * 3);
    p.set(this.positions.subarray(0, this.vertexCount * 3));
    this.positions = p;
    const n = new Float32Array(cap * 3);
    n.set(this.normals.subarray(0, this.vertexCount * 3));
    this.normals = n;
    const s = new Uint8Array(cap);
    s.set(this.shades.subarray(0, this.vertexCount));
    this.shades = s;
  }

  private ensureIdxCap(needed: number): void {
    if (needed <= this.indices.length) return;
    let cap = this.indices.length;
    while (cap < needed) cap *= 2;
    const idx = new Uint32Array(cap);
    idx.set(this.indices.subarray(0, this.indexCount));
    this.indices = idx;
  }

  public addVertex(x: number, y: number, z: number, shade: number): number {
    const idx = this.vertexCount;
    this.ensureVertCap(idx + 1);
    const o = idx * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.normals[o] = 0;
    this.normals[o + 1] = 0;
    this.normals[o + 2] = 0;
    this.shades[idx] = shade;
    this.vertexCount = idx + 1;
    return idx;
  }

  public addTriangle(a: number, b: number, c: number): void {
    const idx = this.indexCount;
    this.ensureIdxCap(idx + 3);
    this.indices[idx] = a;
    this.indices[idx + 1] = b;
    this.indices[idx + 2] = c;
    this.indexCount = idx + 3;
  }

  /**
   * Computes smooth area-weighted vertex normals for a newly emitted submesh range
   * so intersecting/creased components maintain crisp shading edges.
   */
  public computeSmoothNormals(
    startVert: number,
    endVert: number,
    startIdx: number,
    endIdx: number
  ): void {
    const pos = this.positions;
    const norm = this.normals;
    const indices = this.indices;

    for (let v = startVert; v < endVert; v++) {
      const o = v * 3;
      norm[o] = 0;
      norm[o + 1] = 0;
      norm[o + 2] = 0;
    }

    for (let i = startIdx; i < endIdx; i += 3) {
      const ia = indices[i];
      const ib = indices[i + 1];
      const ic = indices[i + 2];
      const oa = ia * 3;
      const ob = ib * 3;
      const oc = ic * 3;

      const ax = pos[oa], ay = pos[oa + 1], az = pos[oa + 2];
      const e1x = pos[ob] - ax, e1y = pos[ob + 1] - ay, e1z = pos[ob + 2] - az;
      const e2x = pos[oc] - ax, e2y = pos[oc + 1] - ay, e2z = pos[oc + 2] - az;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      norm[oa] += nx; norm[oa + 1] += ny; norm[oa + 2] += nz;
      norm[ob] += nx; norm[ob + 1] += ny; norm[ob + 2] += nz;
      norm[oc] += nx; norm[oc + 1] += ny; norm[oc + 2] += nz;
    }

    for (let v = startVert; v < endVert; v++) {
      const o = v * 3;
      const len = Math.hypot(norm[o], norm[o + 1], norm[o + 2]);
      if (len > 1e-8) {
        norm[o] /= len;
        norm[o + 1] /= len;
        norm[o + 2] /= len;
      } else {
        norm[o] = 0;
        norm[o + 1] = 1;
        norm[o + 2] = 0;
      }
    }
  }
}

export interface BuiltPartGeometry {
  positions: Float32Array;
  normals: Float32Array;
  shades: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Recomputes smooth crease-preserving area-weighted normals on the deformed +X half-mesh.
 */
function recomputeHalfNormals(
  positions: Float32Array,
  baseNormals: Float32Array,
  indices: Uint16Array | Uint32Array,
  normals: Float32Array,
  vertCount: number,
  movedVert: Uint8Array
): void {
  const touched = new Uint8Array(vertCount);
  normals.fill(0);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    if (!movedVert[ia] && !movedVert[ib] && !movedVert[ic]) continue;
    touched[ia] = 1;
    touched[ib] = 1;
    touched[ic] = 1;

    const oa = ia * 3;
    const ob = ib * 3;
    const oc = ic * 3;

    const ax = positions[oa], ay = positions[oa + 1], az = positions[oa + 2];
    const e1x = positions[ob] - ax, e1y = positions[ob + 1] - ay, e1z = positions[ob + 2] - az;
    const e2x = positions[oc] - ax, e2y = positions[oc + 1] - ay, e2z = positions[oc + 2] - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    normals[oa] += nx; normals[oa + 1] += ny; normals[oa + 2] += nz;
    normals[ob] += nx; normals[ob + 1] += ny; normals[ob + 2] += nz;
    normals[oc] += nx; normals[oc + 1] += ny; normals[oc + 2] += nz;
  }

  for (let v = 0; v < vertCount; v++) {
    const o = v * 3;
    if (!touched[v]) {
      normals[o] = baseNormals[o];
      normals[o + 1] = baseNormals[o + 1];
      normals[o + 2] = baseNormals[o + 2];
      continue;
    }
    const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]);
    if (len > 1e-8) {
      let nx = normals[o] / len;
      let ny = normals[o + 1] / len;
      let nz = normals[o + 2] / len;
      const bnx = baseNormals[o], bny = baseNormals[o + 1], bnz = baseNormals[o + 2];
      if (nx * bnx + ny * bny + nz * bnz < 0) {
        nx = bnx;
        ny = bny;
        nz = bnz;
      }
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
    } else {
      normals[o] = baseNormals[o];
      normals[o + 1] = baseNormals[o + 1];
      normals[o + 2] = baseNormals[o + 2];
    }
  }
}

/**
 * Emits a mirrored stereo (+X and -X) Indexed BufferGeometry tuple from a deformed +X half-mesh.
 */
function emitMirroredHalfMesh(
  halfPos: Float32Array,
  halfNorm: Float32Array,
  halfShades: Uint8Array,
  halfIndices: Uint16Array | Uint32Array,
  halfVertCount: number
): BuiltPartGeometry {
  const totalVerts = halfVertCount * 2;
  const halfIdxCount = halfIndices.length;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const shades = new Uint8Array(totalVerts);
  const indices = new Uint32Array(halfIdxCount * 2);

  positions.set(halfPos.subarray(0, halfVertCount * 3), 0);
  normals.set(halfNorm.subarray(0, halfVertCount * 3), 0);
  shades.set(halfShades.subarray(0, halfVertCount), 0);

  const posOff = halfVertCount * 3;
  for (let i = 0; i < halfVertCount; i++) {
    const src = i * 3;
    const dst = posOff + src;
    positions[dst] = -halfPos[src];
    positions[dst + 1] = halfPos[src + 1];
    positions[dst + 2] = halfPos[src + 2];

    normals[dst] = -halfNorm[src];
    normals[dst + 1] = halfNorm[src + 1];
    normals[dst + 2] = halfNorm[src + 2];
    shades[halfVertCount + i] = halfShades[i];
  }

  for (let i = 0; i < halfIdxCount; i += 3) {
    const a = halfIndices[i];
    const b = halfIndices[i + 1];
    const c = halfIndices[i + 2];
    indices[i] = a;
    indices[i + 1] = b;
    indices[i + 2] = c;

    const m = halfIdxCount + i;
    indices[m] = halfVertCount + a;
    indices[m + 1] = halfVertCount + c;
    indices[m + 2] = halfVertCount + b;
  }

  return {
    positions,
    normals,
    shades,
    indices,
    vertexCount: totalVerts,
    triangleCount: indices.length / 3,
  };
}

/**
 * Subdivides each deformed +X base triangle into a 3x3 smooth micro-patch mesh
 * with shared canonical edge vertices so Full LOD reaches ~690k crisp triangles.
 */
function buildSubdividedFullHalf(
  basePos: Float32Array,
  baseNorm: Float32Array,
  baseShades: Uint8Array,
  baseIndices: Uint16Array,
  baseVertCount: number,
  centerlineLocked: boolean
): BuiltPartGeometry {
  const S = 3;
  const triCount = baseIndices.length / 3;
  // Upper-bound estimate: corners + edge samples (<=3*triCount/2 * (S-1)) + 1 interior vert per tri (for S=3)
  const estEdgeMax = Math.ceil(triCount * 1.6) * (S - 1);
  const estHalfVerts = baseVertCount + estEdgeMax + triCount + 64;

  let capV = estHalfVerts;
  let pos = new Float32Array(capV * 3);
  let norm = new Float32Array(capV * 3);
  let shades = new Uint8Array(capV);

  pos.set(basePos.subarray(0, baseVertCount * 3), 0);
  norm.set(baseNorm.subarray(0, baseVertCount * 3), 0);
  shades.set(baseShades.subarray(0, baseVertCount), 0);
  let vCount = baseVertCount;

  const ensureV = (need: number) => {
    if (need <= capV) return;
    while (capV < need) capV *= 2;
    const np = new Float32Array(capV * 3);
    np.set(pos.subarray(0, vCount * 3));
    pos = np;
    const nn = new Float32Array(capV * 3);
    nn.set(norm.subarray(0, vCount * 3));
    norm = nn;
    const ns = new Uint8Array(capV);
    ns.set(shades.subarray(0, vCount));
    shades = ns;
  };

  const outIndices = new Uint32Array(triCount * S * S * 3);
  let idxOut = 0;

  const edgeCache = new Map<number, Int32Array>();

  const pushSample = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    shade: number,
    lockCenter: boolean
  ): number => {
    const len = Math.hypot(nx, ny, nz) || 1;
    ensureV(vCount + 1);
    const id = vCount++;
    const o = id * 3;
    pos[o] = lockCenter ? 0 : Math.max(0, x);
    pos[o + 1] = y;
    pos[o + 2] = z;
    norm[o] = nx / len;
    norm[o + 1] = ny / len;
    norm[o + 2] = nz / len;
    shades[id] = shade;
    return id;
  };

  const getEdgeIndices = (a: number, b: number): { arr: Int32Array; reversed: boolean } => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * 65536 + hi;
    let arr = edgeCache.get(key);
    if (!arr) {
      arr = new Int32Array(S - 1);
      const oa = lo * 3;
      const ob = hi * 3;
      const ax = basePos[oa], ay = basePos[oa + 1], az = basePos[oa + 2];
      const bx = basePos[ob], by = basePos[ob + 1], bz = basePos[ob + 2];
      const nax = baseNorm[oa], nay = baseNorm[oa + 1], naz = baseNorm[oa + 2];
      const nbx = baseNorm[ob], nby = baseNorm[ob + 1], nbz = baseNorm[ob + 2];
      const edgeCenterLocked = centerlineLocked && ax <= 1e-4 && bx <= 1e-4;
      const shade = baseShades[lo];

      for (let k = 1; k < S; k++) {
        const t = k / S;
        const wA = 1 - t;
        const wB = t;
        arr[k - 1] = pushSample(
          wA * ax + wB * bx,
          wA * ay + wB * by,
          wA * az + wB * bz,
          wA * nax + wB * nbx,
          wA * nay + wB * nby,
          wA * naz + wB * nbz,
          shade,
          edgeCenterLocked
        );
      }
      edgeCache.set(key, arr);
    }
    return { arr, reversed: a > b };
  };

  const loc: number[][] = Array.from({ length: S + 1 }, (_, r) => new Array<number>(S + 1 - r));

  for (let t = 0; t < triCount; t++) {
    const ia = baseIndices[t * 3];
    const ib = baseIndices[t * 3 + 1];
    const ic = baseIndices[t * 3 + 2];

    const oa = ia * 3, ob = ib * 3, oc = ic * 3;
    const ax = basePos[oa], ay = basePos[oa + 1], az = basePos[oa + 2];
    const bx = basePos[ob], by = basePos[ob + 1], bz = basePos[ob + 2];
    const cx = basePos[oc], cy = basePos[oc + 1], cz = basePos[oc + 2];
    const nax = baseNorm[oa], nay = baseNorm[oa + 1], naz = baseNorm[oa + 2];
    const nbx = baseNorm[ob], nby = baseNorm[ob + 1], nbz = baseNorm[ob + 2];
    const ncx = baseNorm[oc], ncy = baseNorm[oc + 1], ncz = baseNorm[oc + 2];
    const shade = baseShades[ia];

    loc[0][0] = ia;
    loc[0][S] = ib;
    loc[S][0] = ic;

    const eAB = getEdgeIndices(ia, ib);
    const eAC = getEdgeIndices(ia, ic);
    const eBC = getEdgeIndices(ib, ic);
    for (let k = 1; k < S; k++) {
      loc[0][k] = eAB.reversed ? eAB.arr[S - 1 - k] : eAB.arr[k - 1];
      loc[k][0] = eAC.reversed ? eAC.arr[S - 1 - k] : eAC.arr[k - 1];
      loc[k][S - k] = eBC.reversed ? eBC.arr[S - 1 - k] : eBC.arr[k - 1];
    }

    for (let r = 1; r < S - 1; r++) {
      for (let c = 1; c < S - r; c++) {
        const wC = r / S;
        const wB = c / S;
        const wA = 1 - wB - wC;
        loc[r][c] = pushSample(
          wA * ax + wB * bx + wC * cx,
          wA * ay + wB * by + wC * cy,
          wA * az + wB * bz + wC * cz,
          wA * nax + wB * nbx + wC * ncx,
          wA * nay + wB * nby + wC * ncy,
          wA * naz + wB * nbz + wC * ncz,
          shade,
          false
        );
      }
    }

    for (let r = 0; r < S; r++) {
      const maxC = S - 1 - r;
      for (let c = 0; c <= maxC; c++) {
        outIndices[idxOut++] = loc[r][c];
        outIndices[idxOut++] = loc[r][c + 1];
        outIndices[idxOut++] = loc[r + 1][c];
        if (c < maxC) {
          outIndices[idxOut++] = loc[r][c + 1];
          outIndices[idxOut++] = loc[r + 1][c + 1];
          outIndices[idxOut++] = loc[r + 1][c];
        }
      }
    }
  }

  return emitMirroredHalfMesh(pos, norm, shades, outIndices, vCount);
}

/**
 * Evaluates a car aero part mesh via compact-support Hermite Lattice-Delta skinning over
 * the segmented 222.fbx template, applying 2026 X-Mode active-aero flap deflections and
 * stereo mirroring across X = 0.
 */
export function buildPartBodyGeometry(
  part: AeroPartData,
  lod: LODLevel,
  aeroMode: ActiveAeroMode = 'z_mode'
): BuiltPartGeometry {
  const tpl = FBX_CAR_PARTS[part.id];
  const basePos = tpl.positions;
  const baseUv = tpl.uvs;
  const baseShades = tpl.shades;
  const baseIndices = tpl.indices;
  const baseDetail = tpl.baseDetail;
  const vCount = basePos.length / 3;

  const detail = part.cage?.detail ?? baseDetail;
  const cols = detail.length;
  const rows = detail[0]?.length ?? 0;

  // Compute node displacement field relative to undeformed FBX skin
  let maxDeltaSq = 0;
  const deltas: Vec3[][] = new Array(cols);
  for (let u = 0; u < cols; u++) {
    const col = new Array<Vec3>(rows);
    for (let v = 0; v < rows; v++) {
      const cur = detail[u][v];
      const base = baseDetail[u][v];
      const dx = cur.x - base.x;
      const dy = cur.y - base.y;
      const dz = cur.z - base.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDeltaSq) maxDeltaSq = d2;
      col[v] = { x: dx, y: dy, z: dz };
    }
    deltas[u] = col;
  }

  const hasLatticeDelta = maxDeltaSq > 1e-10;
  const hasActiveFlap =
    aeroMode === 'x_mode' && (part.id === 'front_wing' || part.id === 'rear_wing');

  const deformedPos = new Float32Array(basePos.length);
  const movedVert = new Uint8Array(vCount);
  if (!hasLatticeDelta && !hasActiveFlap) {
    deformedPos.set(basePos);
  } else {
    const isFrontWing = part.id === 'front_wing';
    const isRearWing = part.id === 'rear_wing';
    // Hinge references calibrated to the normalized 222.fbx wing boxes
    const fwHingeZ = -2.53;
    const fwHingeY = 0.21;
    const rwHingeZ = 2.15;
    const rwHingeY = 0.85;

    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const bx = basePos[o];
      const by = basePos[o + 1];
      const bz = basePos[o + 2];
      let px = bx;
      let py = by;
      let pz = bz;
      const su = baseUv[i * 2];
      const sv = baseUv[i * 2 + 1];

      if (hasLatticeDelta) {
        const fu = su * (cols - 1);
        const fv = sv * (rows - 1);
        const u0 = clamp(Math.floor(fu), 0, cols - 2);
        const v0 = clamp(Math.floor(fv), 0, rows - 2);
        const u1 = u0 + 1;
        const v1 = v0 + 1;
        const tu = clamp(fu - u0, 0, 1);
        const tv = clamp(fv - v0, 0, 1);
        const hu = tu * tu * (3 - 2 * tu);
        const hv = tv * tv * (3 - 2 * tv);

        const w00 = (1 - hu) * (1 - hv);
        const w10 = hu * (1 - hv);
        const w01 = (1 - hu) * hv;
        const w11 = hu * hv;

        const d00 = deltas[u0][v0];
        const d10 = deltas[u1][v0];
        const d01 = deltas[u0][v1];
        const d11 = deltas[u1][v1];

        px += w00 * d00.x + w10 * d10.x + w01 * d01.x + w11 * d11.x;
        py += w00 * d00.y + w10 * d10.y + w01 * d01.y + w11 * d11.y;
        pz += w00 * d00.z + w10 * d10.z + w01 * d01.z + w11 * d11.z;
      }

      if (hasActiveFlap) {
        if (isFrontWing && sv >= 0.45 && px < 0.62) {
          const blend = smoothstep(0.45, 0.56, sv) * smoothstep(0.62, 0.56, px);
          if (blend > 1e-4) {
            const theta = -0.22 * blend;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            const dy = py - fwHingeY;
            const dz = pz - fwHingeZ;
            py = fwHingeY + dy * cosT + dz * sinT;
            pz = fwHingeZ - dy * sinT + dz * cosT;
          }
        } else if (isRearWing && sv >= 0.42 && px < 0.53 && py > 0.58) {
          const blend =
            smoothstep(0.42, 0.52, sv) *
            smoothstep(0.53, 0.48, px) *
            smoothstep(0.58, 0.66, py);
          if (blend > 1e-4) {
            const theta = -0.32 * blend;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            const dy = py - rwHingeY;
            const dz = pz - rwHingeZ;
            py = rwHingeY + dy * cosT + dz * sinT;
            pz = rwHingeZ - dy * sinT + dz * cosT;
          }
        }
      }

      const fx = part.centerlineLocked && bx <= 1e-4 ? 0 : Math.max(0, px);
      deformedPos[o] = fx;
      deformedPos[o + 1] = py;
      deformedPos[o + 2] = pz;
      if (fx !== bx || py !== by || pz !== bz) {
        movedVert[i] = 1;
      }
    }
  }

  let deformedNorm: Float32Array;
  if (!hasLatticeDelta && !hasActiveFlap) {
    deformedNorm = tpl.normals;
  } else {
    deformedNorm = new Float32Array(tpl.normals.length);
    recomputeHalfNormals(deformedPos, tpl.normals, baseIndices, deformedNorm, vCount, movedVert);
  }

  if (lod === 'full') {
    return buildSubdividedFullHalf(
      deformedPos,
      deformedNorm,
      baseShades,
      baseIndices,
      vCount,
      part.centerlineLocked
    );
  }

  return emitMirroredHalfMesh(deformedPos, deformedNorm, baseShades, baseIndices, vCount);
}
