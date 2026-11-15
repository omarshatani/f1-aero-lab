import { evalCurveAlongArray } from './surfaceMath';
import {
  ActiveAeroMode,
  AeroPartData,
  PartId,
  Vec3,
} from '../types/aero';
import { LODLevel } from './surfaceTypes';

export const SHADE_BODY = 0;
export const SHADE_LOWER = 1;
export const SHADE_STRUT = 2;
export const SHADE_CAVITY = 3;
export const SHADE_TRIM = 4;

/**
 * Dynamically growing typed-array mesh accumulator for worker-safe procedural geometry.
 */
export class MeshBuildBuffer {
  public positions: Float32Array;
  public normals: Float32Array;
  public shades: Uint8Array;
  public indices: Uint32Array;
  public vertexCount = 0;
  public indexCount = 0;
  private vertCap: number;
  private idxCap: number;

  constructor(initVerts = 2048, initIndices = 8192) {
    this.vertCap = Math.max(64, initVerts);
    this.idxCap = Math.max(192, initIndices);
    this.positions = new Float32Array(this.vertCap * 3);
    this.normals = new Float32Array(this.vertCap * 3);
    this.shades = new Uint8Array(this.vertCap);
    this.indices = new Uint32Array(this.idxCap);
  }

  private ensureVertCap(needed: number): void {
    if (needed <= this.vertCap) return;
    let nextCap = this.vertCap * 2;
    while (nextCap < needed) nextCap *= 2;
    const nextPos = new Float32Array(nextCap * 3);
    nextPos.set(this.positions.subarray(0, this.vertexCount * 3));
    const nextNorm = new Float32Array(nextCap * 3);
    nextNorm.set(this.normals.subarray(0, this.vertexCount * 3));
    const nextShade = new Uint8Array(nextCap);
    nextShade.set(this.shades.subarray(0, this.vertexCount));
    this.positions = nextPos;
    this.normals = nextNorm;
    this.shades = nextShade;
    this.vertCap = nextCap;
  }

  private ensureIdxCap(needed: number): void {
    if (needed <= this.idxCap) return;
    let nextCap = this.idxCap * 2;
    while (nextCap < needed) nextCap *= 2;
    const nextIdx = new Uint32Array(nextCap);
    nextIdx.set(this.indices.subarray(0, this.indexCount));
    this.indices = nextIdx;
    this.idxCap = nextCap;
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

// ---------- Control-Grid Sampling Helpers ----------

function getPartGrid(part: AeroPartData): Vec3[][] {
  return part.cage?.detail ?? part.grid;
}

function preSampleColumns(grid: Vec3[][], vSteps: number): Vec3[][] {
  const cols = grid.length;
  const sampled: Vec3[][] = new Array(cols);
  for (let u = 0; u < cols; u++) {
    const col = new Array<Vec3>(vSteps + 1);
    for (let iv = 0; iv <= vSteps; iv++) {
      const sv = vSteps > 0 ? iv / vSteps : 0;
      col[iv] = evalCurveAlongArray(grid[u], sv, false);
    }
    sampled[u] = col;
  }
  return sampled;
}

function evalSampledColumnSlice(
  sampledCols: Vec3[][],
  iv: number,
  su: number,
  lockCenterX: boolean
): Vec3 {
  const cols = sampledCols.length;
  const row = new Array<Vec3>(cols);
  for (let u = 0; u < cols; u++) {
    row[u] = sampledCols[u][iv];
  }
  const pt = evalCurveAlongArray(row, su, lockCenterX && su < 1e-4);
  if (lockCenterX && su < 1e-4) {
    pt.x = 0;
  } else {
    pt.x = Math.max(0, pt.x);
  }
  return pt;
}

function evalGrid(
  grid: Vec3[][],
  su: number,
  sv: number,
  lockCenterX: boolean,
  maxUCol?: number
): Vec3 {
  const useCols = maxUCol !== undefined ? Math.min(grid.length, maxUCol + 1) : grid.length;
  const row = new Array<Vec3>(useCols);
  for (let u = 0; u < useCols; u++) {
    row[u] = evalCurveAlongArray(grid[u], sv, false);
  }
  const pt = evalCurveAlongArray(row, su, lockCenterX && su < 1e-4);
  if (lockCenterX && su < 1e-4) {
    pt.x = 0;
  } else {
    pt.x = Math.max(0, pt.x);
  }
  return pt;
}

function collectSampledRingColumns(
  sampled: Vec3[][],
  iv: number,
  lockFirstX: boolean
): { pts: Vec3[]; shades: number[] } {
  const cols = sampled.length;
  const pts: Vec3[] = [];
  const shades: number[] = [];
  for (let u = 0; u < cols; u++) {
    const p = sampled[u][iv];
    pts.push({
      x: lockFirstX && u === 0 ? 0 : Math.max(0, p.x),
      y: p.y,
      z: p.z,
    });
    shades.push(u === cols - 1 ? SHADE_STRUT : SHADE_BODY);
  }
  return { pts, shades };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Smoothly subdivides an open half-section profile [p0 .. pN] using cosine/quadratic corner
 * smoothing while preserving exact endpoints p0 and pN (for centerline x=0 continuity).
 */
function subdivideProfilePoints(
  pts: Vec3[],
  shades: number[],
  subdivsPerSeg: number
): { pts: Vec3[]; shades: number[] } {
  if (subdivsPerSeg <= 1 || pts.length < 3) {
    return { pts, shades };
  }
  const outPts: Vec3[] = [];
  const outShades: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const pPrev = pts[Math.max(0, i - 1)];
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const pNext = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < subdivsPerSeg; s++) {
      const t = s / subdivsPerSeg;
      // Gentle Catmull-Rom blend keeping corner crispness while rounding fuselage walls
      const t2 = t * t;
      const t3 = t2 * t;
      const interp = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      outPts.push({
        x: Math.max(0, interp(pPrev.x, p0.x, p1.x, pNext.x)),
        y: interp(pPrev.y, p0.y, p1.y, pNext.y),
        z: interp(pPrev.z, p0.z, p1.z, pNext.z),
      });
      outShades.push(shades[i]);
    }
  }
  outPts.push(pts[n - 1]);
  outShades.push(shades[n - 1]);
  return { pts: outPts, shades: outShades };
}

// ---------- Generic Solid & Wing Primitives (Mirrored +X / -X) ----------

/**
 * Appends a mirrored closed lofted solid defined by cross-section rings along stations.
 * Ring points for +X MUST be ordered clockwise looking toward +Z from -Z:
 * e.g., TopCenter -> UpperShoulder -> OuterFlank -> BottomOuter -> BottomCenter.
 */
function appendMirroredLoftedSolid(
  buf: MeshBuildBuffer,
  rings: Vec3[][],
  ringShades: number[],
  closeFrontCap: boolean,
  closeRearCap: boolean,
  skipCenterlineCap = false
): void {
  const nStations = rings.length;
  if (nStations < 2) return;
  const nRing = rings[0].length;
  if (nRing < 3) return;

  for (const mirrorX of [1, -1]) {
    const baseVert = buf.vertexCount;
    const baseIdx = buf.indexCount;

    for (let i = 0; i < nStations; i++) {
      for (let j = 0; j < nRing; j++) {
        const p = rings[i][j];
        const x = skipCenterlineCap && Math.abs(p.x) < 1e-5 ? 0 : p.x * mirrorX;
        buf.addVertex(x, p.y, p.z, ringShades[j] ?? SHADE_BODY);
      }
    }

    for (let i = 0; i < nStations - 1; i++) {
      for (let j = 0; j < nRing; j++) {
        const jNext = (j + 1) % nRing;
        const p00 = baseVert + i * nRing + j;
        const p10 = baseVert + (i + 1) * nRing + j;
        const p11 = baseVert + (i + 1) * nRing + jNext;
        const p01 = baseVert + i * nRing + jNext;
        if (mirrorX === 1) {
          buf.addTriangle(p00, p10, p11);
          buf.addTriangle(p00, p11, p01);
        } else {
          buf.addTriangle(p00, p11, p10);
          buf.addTriangle(p00, p01, p11);
        }
      }
    }

    buf.computeSmoothNormals(baseVert, buf.vertexCount, baseIdx, buf.indexCount);

    // Front cap (separate vertices for crisp rim normal)
    if (closeFrontCap) {
      const capStartV = buf.vertexCount;
      const capStartI = buf.indexCount;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < nRing; j++) {
        cx += rings[0][j].x * mirrorX;
        cy += rings[0][j].y;
        cz += rings[0][j].z;
      }
      const cIdx = buf.addVertex(cx / nRing, cy / nRing, cz / nRing, ringShades[0] ?? SHADE_BODY);
      const rStart = buf.vertexCount;
      for (let j = 0; j < nRing; j++) {
        const p = rings[0][j];
        buf.addVertex(p.x * mirrorX, p.y, p.z, ringShades[j] ?? SHADE_BODY);
      }
      for (let j = 0; j < nRing; j++) {
        const jNext = (j + 1) % nRing;
        if (mirrorX === 1) {
          buf.addTriangle(cIdx, rStart + j, rStart + jNext);
        } else {
          buf.addTriangle(cIdx, rStart + jNext, rStart + j);
        }
      }
      buf.computeSmoothNormals(capStartV, buf.vertexCount, capStartI, buf.indexCount);
    }

    // Rear cap
    if (closeRearCap) {
      const capStartV = buf.vertexCount;
      const capStartI = buf.indexCount;
      const last = nStations - 1;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < nRing; j++) {
        cx += rings[last][j].x * mirrorX;
        cy += rings[last][j].y;
        cz += rings[last][j].z;
      }
      const cIdx = buf.addVertex(cx / nRing, cy / nRing, cz / nRing, ringShades[1] ?? SHADE_LOWER);
      const rStart = buf.vertexCount;
      for (let j = 0; j < nRing; j++) {
        const p = rings[last][j];
        buf.addVertex(p.x * mirrorX, p.y, p.z, ringShades[j] ?? SHADE_LOWER);
      }
      for (let j = 0; j < nRing; j++) {
        const jNext = (j + 1) % nRing;
        if (mirrorX === 1) {
          buf.addTriangle(cIdx, rStart + jNext, rStart + j);
        } else {
          buf.addTriangle(cIdx, rStart + j, rStart + jNext);
        }
      }
      buf.computeSmoothNormals(capStartV, buf.vertexCount, capStartI, buf.indexCount);
    }
  }
}

/**
 * Generates a closed NACA-style cambered airfoil blade along a span array of (lePt, tePt) pairs.
 * Each span station builds a closed chordwise loop (LE -> upper -> TE -> lower -> LE) so upper
 * and lower skins meet smoothly at the leading edge and form a finite crisp trailing edge.
 */
function appendMirroredAirfoilElement(
  buf: MeshBuildBuffer,
  stations: Array<{
    le: Vec3;
    te: Vec3;
    midOffset?: Vec3;
    camberM: number;
    maxHalfThickM: number;
    shadeUpper?: number;
    shadeLower?: number;
  }>,
  cSteps: number,
  capRoot: boolean,
  capTip: boolean
): void {
  const nU = stations.length;
  if (nU < 2 || cSteps < 3) return;
  const nLoop = cSteps * 2; // 0=LE, 1..cSteps=upper->TE, cSteps+1..2*cSteps-1=lower->LE

  for (const mirrorX of [1, -1]) {
    const baseVert = buf.vertexCount;
    const baseIdx = buf.indexCount;

    for (let iu = 0; iu < nU; iu++) {
      const st = stations[iu];
      const shadeUp = st.shadeUpper ?? SHADE_BODY;
      const shadeLo = st.shadeLower ?? SHADE_LOWER;

      const dz = st.te.z - st.le.z;
      const dy = st.te.y - st.le.y;
      const lenYZ = Math.hypot(dy, dz) || 1;
      // Upward normal in YZ plane perpendicular to chord (+Y direction)
      const nyChord = dz / lenYZ;
      const nzChord = -dy / lenYZ;

      // Upper surface: iv = 0..cSteps (t = 0..1)
      // Lower surface: iv = cSteps+1..2*cSteps-1 (t = 1-step..step back toward LE)
      for (let k = 0; k < nLoop; k++) {
        const isUpper = k <= cSteps;
        const frac = isUpper ? k / cSteps : (nLoop - k) / cSteps;
        // Cosine spacing bunches vertices cleanly at leading & trailing edges
        const s = 0.5 * (1 - Math.cos(Math.PI * frac));

        // Parabolic / sinusoidal airfoil camber + NACA 4-digit thickness envelope
        const camber = st.camberM * Math.sin(Math.PI * Math.pow(s, 0.85));
        const halfThick =
          st.maxHalfThickM *
          3.4 *
          (0.2969 * Math.sqrt(Math.max(1e-5, s)) -
            0.126 * s -
            0.3516 * s * s +
            0.2843 * s * s * s -
            0.098 * s * s * s * s);
        const signedThick = isUpper ? halfThick : -halfThick;

        const midBlend = st.midOffset ? Math.sin(Math.PI * s) : 0;
        const baseX = lerp(st.le.x, st.te.x, s) + (st.midOffset ? st.midOffset.x * midBlend : 0);
        const baseY =
          lerp(st.le.y, st.te.y, s) +
          (st.midOffset ? st.midOffset.y * midBlend : 0) +
          nyChord * (camber + signedThick);
        const baseZ =
          lerp(st.le.z, st.te.z, s) +
          (st.midOffset ? st.midOffset.z * midBlend : 0) +
          nzChord * (camber + signedThick);

        const vx = capRoot ? baseX * mirrorX : (iu === 0 ? 0 : baseX * mirrorX);
        buf.addVertex(vx, baseY, baseZ, isUpper || k === 0 ? shadeUp : shadeLo);
      }
    }

    // Winding check for (iu -> iu+1 along +X, k -> k+1 clockwise from LE over top toward TE):
    // Viewed from Front looking +Z/top: (base -> +X) x (+TE) = +Y! Wait: e1=+Z, e2=+X => (+Z)x(+X) = +Y.
    // Along chord k->k+1 is +Z; along span iu->iu+1 is +X. So tri(p00, p01, p11) has e1=+Z, e2=+X => +Y!
    for (let iu = 0; iu < nU - 1; iu++) {
      for (let k = 0; k < nLoop; k++) {
        const kNext = (k + 1) % nLoop;
        const p00 = baseVert + iu * nLoop + k;
        const p01 = baseVert + iu * nLoop + kNext;
        const p11 = baseVert + (iu + 1) * nLoop + kNext;
        const p10 = baseVert + (iu + 1) * nLoop + k;

        if (mirrorX === 1) {
          buf.addTriangle(p00, p01, p11);
          buf.addTriangle(p00, p11, p10);
        } else {
          buf.addTriangle(p00, p11, p01);
          buf.addTriangle(p00, p10, p11);
        }
      }
    }

    buf.computeSmoothNormals(baseVert, buf.vertexCount, baseIdx, buf.indexCount);

    // Optional tip cap (+X outer end) and root cap (detached inner end)
    const addSpanCap = (iuIdx: number, outwardPlusX: boolean) => {
      const capV = buf.vertexCount;
      const capI = buf.indexCount;
      const srcBase = baseVert + iuIdx * nLoop;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < nLoop; k++) {
        const o = (srcBase + k) * 3;
        cx += buf.positions[o];
        cy += buf.positions[o + 1];
        cz += buf.positions[o + 2];
      }
      const cIdx = buf.addVertex(cx / nLoop, cy / nLoop, cz / nLoop, SHADE_STRUT);
      const rStart = buf.vertexCount;
      for (let k = 0; k < nLoop; k++) {
        const o = (srcBase + k) * 3;
        buf.addVertex(buf.positions[o], buf.positions[o + 1], buf.positions[o + 2], SHADE_STRUT);
      }
      const flip = mirrorX === 1 ? outwardPlusX : !outwardPlusX;
      for (let k = 0; k < nLoop; k++) {
        const kNext = (k + 1) % nLoop;
        if (flip) {
          buf.addTriangle(cIdx, rStart + k, rStart + kNext);
        } else {
          buf.addTriangle(cIdx, rStart + kNext, rStart + k);
        }
      }
      buf.computeSmoothNormals(capV, buf.vertexCount, capI, buf.indexCount);
    };

    if (capTip) addSpanCap(nU - 1, true);
    if (capRoot) addSpanCap(0, false);
  }
}

/**
 * Generates a bilateral streamlined elliptical wishbone/pushrod strut connecting all control stations `pts`.
 */
function appendMirroredPolylineStrut(
  buf: MeshBuildBuffer,
  pts: Vec3[],
  radiusChordZ: number,
  radiusThickY: number,
  segSteps = 8,
  segRing = 8,
  shade = SHADE_STRUT
): void {
  if (pts.length < 2) return;
  const totalSteps = Math.max(pts.length - 1, segSteps);
  const rings: Vec3[][] = [];
  const shades = new Array<number>(segRing).fill(shade);

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const center = evalCurveAlongArray(pts, t, false);
    const centerPrev = evalCurveAlongArray(pts, Math.max(0, t - 0.02), false);
    const centerNext = evalCurveAlongArray(pts, Math.min(1, t + 0.02), false);

    const dx = centerNext.x - centerPrev.x;
    const dy = centerNext.y - centerPrev.y;
    const dz = centerNext.z - centerPrev.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;

    const ax = dx / len, ay = dy / len, az = dz / len;
    let bx = -az, by = 0, bz = ax;
    let blen = Math.hypot(bx, by, bz);
    if (blen < 1e-4) {
      bx = 0; by = 1; bz = 0; blen = 1;
    }
    bx /= blen; by /= blen; bz /= blen;
    const cx = by * az - bz * ay;
    const cy = bz * ax - bx * az;
    const cz = bx * ay - by * ax;

    const taper = 1 - 0.14 * Math.abs(t - 0.5) * 2;
    const ring: Vec3[] = [];
    for (let j = 0; j < segRing; j++) {
      const ang = (j / segRing) * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      ring.push({
        x: center.x + (bx * cosA * radiusChordZ + cx * sinA * radiusThickY) * taper,
        y: center.y + (by * cosA * radiusChordZ + cy * sinA * radiusThickY) * taper,
        z: center.z + (bz * cosA * radiusChordZ + cz * sinA * radiusThickY) * taper,
      });
    }
    rings.push(ring);
  }
  appendMirroredLoftedSolid(buf, rings, shades, true, true, false);
}

/**
 * Generates a bilateral thin curved carbon plate / vertical wall / fin given a 2D quad sheet
 * of centerline control samples `sheet[iu][iv]` and half-thickness `halfT`.
 */
function appendMirroredCurvedPlate(
  buf: MeshBuildBuffer,
  sheet: Vec3[][],
  normalAxis: 'x' | 'y' | 'auto',
  halfT: number,
  shadeFront = SHADE_BODY,
  shadeBack = SHADE_LOWER,
  skipInnerCap = false
): void {
  const nU = sheet.length;
  const nV = sheet[0].length;
  if (nU < 2 || nV < 2) return;

  // Precompute unit offset normals for each grid vertex
  const normalsGrid: Vec3[][] = Array.from({ length: nU }, () => new Array<Vec3>(nV));
  for (let iu = 0; iu < nU; iu++) {
    const ip = Math.max(0, iu - 1);
    const inx = Math.min(nU - 1, iu + 1);
    for (let iv = 0; iv < nV; iv++) {
      const jp = Math.max(0, iv - 1);
      const jnx = Math.min(nV - 1, iv + 1);
      if (normalAxis === 'x') {
        normalsGrid[iu][iv] = { x: 1, y: 0, z: 0 };
      } else if (normalAxis === 'y') {
        normalsGrid[iu][iv] = { x: 0, y: 1, z: 0 };
      } else {
        const ux = sheet[inx][iv].x - sheet[ip][iv].x;
        const uy = sheet[inx][iv].y - sheet[ip][iv].y;
        const uz = sheet[inx][iv].z - sheet[ip][iv].z;
        const vx = sheet[iu][jnx].x - sheet[iu][jp].x;
        const vy = sheet[iu][jnx].y - sheet[iu][jp].y;
        const vz = sheet[iu][jnx].z - sheet[iu][jp].z;
        const nx = vy * uz - vz * uy;
        const ny = vz * ux - vx * uz;
        const nz = vx * uy - vy * ux;
        const l = Math.hypot(nx, ny, nz) || 1;
        normalsGrid[iu][iv] = { x: nx / l, y: ny / l, z: nz / l };
      }
    }
  }

  for (const mirrorX of [1, -1]) {
    const buildSkinFace = (sign: number, shade: number, flipWinding: boolean) => {
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let iu = 0; iu < nU; iu++) {
        for (let iv = 0; iv < nV; iv++) {
          const p = sheet[iu][iv];
          const n = normalsGrid[iu][iv];
          let x = p.x + n.x * halfT * sign;
          if (skipInnerCap && iu === 0 && Math.abs(p.x) < 1e-4) x = 0;
          buf.addVertex(x * mirrorX, p.y + n.y * halfT * sign, p.z + n.z * halfT * sign, shade);
        }
      }
      for (let iu = 0; iu < nU - 1; iu++) {
        for (let iv = 0; iv < nV - 1; iv++) {
          const a = vStart + iu * nV + iv;
          const b = vStart + iu * nV + (iv + 1);
          const c = vStart + (iu + 1) * nV + (iv + 1);
          const d = vStart + (iu + 1) * nV + iv;
          const ccw = mirrorX === 1 ? !flipWinding : flipWinding;
          if (ccw) {
            buf.addTriangle(a, b, c);
            buf.addTriangle(a, c, d);
          } else {
            buf.addTriangle(a, c, b);
            buf.addTriangle(a, d, c);
          }
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };

    buildSkinFace(1, shadeFront, false);
    buildSkinFace(-1, shadeBack, true);

    // Perimeter rim stitch using duplicate flat-normal edge strips
    const stitchRim = (ptsA: Vec3[], ptsB: Vec3[], reverse: boolean) => {
      const m = ptsA.length;
      if (m < 2) return;
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let i = 0; i < m; i++) {
        buf.addVertex(ptsA[i].x * mirrorX, ptsA[i].y, ptsA[i].z, SHADE_STRUT);
      }
      for (let i = 0; i < m; i++) {
        buf.addVertex(ptsB[i].x * mirrorX, ptsB[i].y, ptsB[i].z, SHADE_STRUT);
      }
      const flip = mirrorX === 1 ? reverse : !reverse;
      for (let i = 0; i < m - 1; i++) {
        const a0 = vStart + i;
        const a1 = vStart + i + 1;
        const b1 = vStart + m + i + 1;
        const b0 = vStart + m + i;
        if (!flip) {
          buf.addTriangle(a0, a1, b1);
          buf.addTriangle(a0, b1, b0);
        } else {
          buf.addTriangle(a0, b1, a1);
          buf.addTriangle(a0, b0, b1);
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };

    const getOffsetPt = (iu: number, iv: number, s: number): Vec3 => {
      const p = sheet[iu][iv];
      const n = normalsGrid[iu][iv];
      return {
        x: skipInnerCap && iu === 0 && Math.abs(p.x) < 1e-4 ? 0 : p.x + n.x * halfT * s,
        y: p.y + n.y * halfT * s,
        z: p.z + n.z * halfT * s,
      };
    };

    // Edge iv = 0
    stitchRim(
      Array.from({ length: nU }, (_, iu) => getOffsetPt(iu, 0, 1)),
      Array.from({ length: nU }, (_, iu) => getOffsetPt(iu, 0, -1)),
      false
    );
    // Edge iv = nV - 1
    stitchRim(
      Array.from({ length: nU }, (_, iu) => getOffsetPt(iu, nV - 1, 1)),
      Array.from({ length: nU }, (_, iu) => getOffsetPt(iu, nV - 1, -1)),
      true
    );
    // Edge iu = nU - 1
    stitchRim(
      Array.from({ length: nV }, (_, iv) => getOffsetPt(nU - 1, iv, 1)),
      Array.from({ length: nV }, (_, iv) => getOffsetPt(nU - 1, iv, -1)),
      true
    );
    // Edge iu = 0
    if (!skipInnerCap) {
      stitchRim(
        Array.from({ length: nV }, (_, iv) => getOffsetPt(0, iv, 1)),
        Array.from({ length: nV }, (_, iv) => getOffsetPt(0, iv, -1)),
        false
      );
    }
  }
}

// =========================================================================
// 11-PART PURPOSE-BUILT FIA 2026 F1 CAR GEOMETRY BUILDERS
// =========================================================================

function buildFrontWing(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel,
  aeroMode: ActiveAeroMode
): void {
  const grid = getPartGrid(part);
  const cols = grid.length;
  // Wing span resides in u = 0..(cols-2); endplate resides in last column
  const wingEndCol = Math.max(1, cols - 2);
  const endCol = grid[cols - 1];

  const uSteps = lod === 'full' ? 120 : 16;
  const cSteps = lod === 'full' ? 26 : 6;
  const isXMode = aeroMode === 'x_mode';

  // Build 3 distinct slotted wing elements across u = 0..wingEndCol
  const elements: Array<{
    sv0: number;
    sv1: number;
    liftY: number;
    camberM: number;
    halfThickM: number;
    xModeAngleRad: number;
  }> = [
    { sv0: 0.00, sv1: 0.34, liftY: -0.002, camberM: 0.014, halfThickM: 0.011, xModeAngleRad: 0 },
    { sv0: 0.35, sv1: 0.67, liftY: 0.014, camberM: 0.016, halfThickM: 0.009, xModeAngleRad: -0.075 },
    { sv0: 0.68, sv1: 1.00, liftY: 0.026, camberM: 0.018, halfThickM: 0.0085, xModeAngleRad: -0.17 },
  ];

  // Endplate inner attachment X curve so elements bridge cleanly from wing tip into endplate
  const endMidPt = evalCurveAlongArray(endCol, 0.4, false);
  const wingTipEnd = evalGrid(grid, 1, 0.4, true, wingEndCol);
  const bridgeSpanX = Math.max(0.02, endMidPt.x - 0.015 - wingTipEnd.x);

  for (let eIdx = 0; eIdx < elements.length; eIdx++) {
    const el = elements[eIdx];
    const stations: Array<{
      le: Vec3;
      te: Vec3;
      midOffset?: Vec3;
      camberM: number;
      maxHalfThickM: number;
      shadeUpper: number;
      shadeLower: number;
    }> = [];

    for (let iu = 0; iu <= uSteps; iu++) {
      const suSpan = iu / uSteps;
      const spoonDip = -0.012 * Math.exp(-Math.pow(suSpan / 0.28, 2));
      const pLe = evalGrid(grid, suSpan, el.sv0, true, wingEndCol);
      const pTe = evalGrid(grid, suSpan, el.sv1, true, wingEndCol);
      const pMid = evalGrid(grid, suSpan, 0.5 * (el.sv0 + el.sv1), true, wingEndCol);

      const midOffset: Vec3 = {
        x: pMid.x - 0.5 * (pLe.x + pTe.x),
        y: pMid.y - 0.5 * (pLe.y + pTe.y),
        z: pMid.z - 0.5 * (pLe.z + pTe.z),
      };

      // Taper last 10% smoothly out into the endplate wall without leaving a gap
      if (suSpan > 0.85) {
        const blend = smoothstep(0.85, 1.0, suSpan);
        const endLe = evalCurveAlongArray(endCol, el.sv0, false);
        const endTe = evalCurveAlongArray(endCol, el.sv1, false);
        pLe.x = Math.min(endLe.x - 0.006, pLe.x + bridgeSpanX * blend);
        pTe.x = Math.min(endTe.x - 0.006, pTe.x + bridgeSpanX * blend);
      }

      pLe.y += el.liftY + spoonDip;
      pTe.y += el.liftY + spoonDip + 0.008 * eIdx;

      // Active Aero X-Mode deflects inboard/mid movable flap panels downward
      if (isXMode && Math.abs(el.xModeAngleRad) > 1e-4) {
        const flapBlend = smoothstep(0.62, 0.50, pLe.x);
        if (flapBlend > 0.01) {
          const theta = el.xModeAngleRad * flapBlend;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          const dy = pTe.y - pLe.y;
          const dz = pTe.z - pLe.z;
          pTe.y = pLe.y + dy * cosT + dz * sinT;
          pTe.z = pLe.z - dy * sinT + dz * cosT;
          const my = midOffset.y * cosT + midOffset.z * sinT;
          const mz = -midOffset.y * sinT + midOffset.z * cosT;
          midOffset.y = my;
          midOffset.z = mz;
        }
      }

      stations.push({
        le: pLe,
        te: pTe,
        midOffset,
        camberM: el.camberM * (1 - 0.22 * suSpan),
        maxHalfThickM: el.halfThickM * (iu === uSteps ? 0.85 : 1),
        shadeUpper: eIdx === 2 ? SHADE_TRIM : SHADE_BODY,
        shadeLower: SHADE_LOWER,
      });
    }

    appendMirroredAirfoilElement(buf, stations, cSteps, false, true);
  }

  // Sculpted FIA 2026 Front Wing Endplate (following last grid column + curved bottom footplate)
  const epZSteps = lod === 'full' ? 56 : 8;
  const epYSteps = lod === 'full' ? 40 : 6;
  const epSheet: Vec3[][] = Array.from({ length: epYSteps + 1 }, () =>
    new Array<Vec3>(epZSteps + 1)
  );

  for (let iv = 0; iv <= epZSteps; iv++) {
    const sv = iv / epZSteps;
    const spine = evalCurveAlongArray(endCol, sv, false);
    const topY = spine.y + 0.016 * (1 - 0.15 * sv);
    const botY = spine.y - 0.165 - 0.105 * sv;

    for (let iu = 0; iu <= epYSteps; iu++) {
      const hu = iu / epYSteps; // 0 = bottom edge, 1 = top rim
      const flareOut = -0.022 * (1 - hu) + 0.012 * Math.sin(Math.PI * hu);
      const y = lerp(botY, topY, hu);
      const sweptZ = spine.z + 0.055 * (1 - hu) * (1 - sv) - 0.045 * (1 - hu) * sv;
      epSheet[iu][iv] = {
        x: Math.max(0.02, spine.x + flareOut),
        y,
        z: sweptZ,
      };
    }
  }
  appendMirroredCurvedPlate(buf, epSheet, 'x', 0.006, SHADE_BODY, SHADE_STRUT, false);

  // Horizontal Footplate / Outer Strake Shelf under endplate (rv_fwep_body_and_ofp y[590..904])
  const fpSteps = lod === 'full' ? 24 : 6;
  const fpLatSteps = lod === 'full' ? 10 : 3;
  const fpSheet: Vec3[][] = Array.from({ length: fpLatSteps + 1 }, () =>
    new Array<Vec3>(fpSteps + 1)
  );
  for (let iu = 0; iu <= fpLatSteps; iu++) {
    const lat = iu / fpLatSteps;
    for (let iv = 0; iv <= fpSteps; iv++) {
      const sv = iv / fpSteps;
      const spine = evalCurveAlongArray(endCol, sv, false);
      const outerX = spine.x + 0.012;
      const innerX = outerX - 0.115;
      fpSheet[iu][iv] = {
        x: lerp(innerX, outerX, lat),
        y: spine.y - 0.168 - 0.108 * sv + 0.006 * lat,
        z: spine.z - 0.035 * (1 - sv),
      };
    }
  }
  appendMirroredCurvedPlate(buf, fpSheet, 'y', 0.0045, SHADE_TRIM, SHADE_LOWER, false);
}

function buildNosecone(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const vSteps = lod === 'full' ? 140 : 16;
  const ringSub = lod === 'full' ? 4 : 1;
  const sampled = preSampleColumns(grid, vSteps);

  const rings: Vec3[][] = [];
  let ringShades: number[] = [];

  for (let iv = 0; iv <= vSteps; iv++) {
    const sv = iv / vSteps;
    const { pts, shades } = collectSampledRingColumns(sampled, iv, true);
    const pLo = pts[pts.length - 1];

    // Smooth bottom keel staying strictly above FIA zMin curve (rv_nose_main)
    const keelDrop = 0.004 + 0.032 * smoothstep(0.08, 0.9, sv);
    const pBotOuter: Vec3 = {
      x: Math.max(0.02, pLo.x * 0.72),
      y: pLo.y - keelDrop * 0.55,
      z: pLo.z,
    };
    const pBotCenter: Vec3 = {
      x: 0,
      y: pLo.y - keelDrop,
      z: pLo.z,
    };
    pts.push(pBotOuter, pBotCenter);
    shades.push(SHADE_LOWER, SHADE_LOWER);

    const sub = subdivideProfilePoints(pts, shades, ringSub);
    ringShades = sub.shades;
    rings.push(sub.pts);
  }
  // Rounded nose tip dome station extending forward by 28mm
  const tipRing = rings[0].map((pt, idx) => ({
    x: idx === 0 || idx === rings[0].length - 1 ? 0 : pt.x * 0.35,
    y: lerp(rings[0][0].y, rings[0][rings[0].length - 1].y, 0.48),
    z: rings[0][0].z - 0.028,
  }));
  const allRings = [tipRing, ...rings];
  appendMirroredLoftedSolid(buf, allRings, ringShades, true, false, true);

  // Twin aerodynamic under-nose front wing mounting pylons (rv_fw_pylon)
  const pyZSteps = lod === 'full' ? 32 : 5;
  const pyYSteps = lod === 'full' ? 24 : 4;
  const pySheet: Vec3[][] = Array.from({ length: pyYSteps + 1 }, () =>
    new Array<Vec3>(pyZSteps + 1)
  );
  for (let iy = 0; iy <= pyYSteps; iy++) {
    const hy = iy / pyYSteps;
    for (let iz = 0; iz <= pyZSteps; iz++) {
      const hz = iz / pyZSteps;
      const svNose = lerp(0.12, 0.36, hz);
      const topAttach = evalGrid(grid, 0.65, svNose, false);
      const zChord = lerp(-2.74, -2.42, hz);
      const botY = 0.132 + 0.035 * hz;
      const topY = topAttach.y - 0.02;
      pySheet[iy][iz] = {
        x: lerp(0.068, Math.max(0.065, topAttach.x * 0.65), hy),
        y: lerp(botY, topY, hy),
        z: zChord,
      };
    }
  }
  appendMirroredCurvedPlate(buf, pySheet, 'x', 0.008, SHADE_STRUT, SHADE_STRUT, false);
}

function buildMonocoque(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const vSteps = lod === 'full' ? 165 : 18;
  const ringSub = lod === 'full' ? 4 : 1;
  const sampled = preSampleColumns(grid, vSteps);

  // Survival cell outer closed hull with sculpted recessed open cockpit across all dense columns
  const rings: Vec3[][] = [];
  let ringShades: number[] = [];

  for (let iv = 0; iv <= vSteps; iv++) {
    const sv = iv / vSteps;
    const { pts, shades } = collectSampledRingColumns(sampled, iv, true);
    const pTop = pts[0];
    const pOuterWaist = pts[pts.length - 1];

    // Open cockpit depression between sv=0.36 (front coaming) and sv=0.88 (rollhoop headrest)
    const cockpitWindow =
      smoothstep(0.32, 0.46, sv) * (1 - smoothstep(0.84, 0.96, sv));

    pts[0] = {
      x: 0,
      y: pTop.y - 0.22 * cockpitWindow,
      z: pTop.z,
    };
    shades[0] = SHADE_CAVITY;

    const pLowerCorner: Vec3 = {
      x: Math.max(0.10, pOuterWaist.x * 0.78),
      y: Math.max(0.078, pOuterWaist.y - 0.175),
      z: pOuterWaist.z,
    };
    const pFloorKeel: Vec3 = {
      x: 0,
      y: Math.max(0.068, pOuterWaist.y - 0.205),
      z: pOuterWaist.z,
    };

    pts.push(pLowerCorner, pFloorKeel);
    shades.push(SHADE_LOWER, SHADE_LOWER);

    const sub = subdivideProfilePoints(pts, shades, ringSub);
    ringShades = sub.shades;
    rings.push(sub.pts);
  }
  appendMirroredLoftedSolid(buf, rings, ringShades, false, false, true);
}

function buildSuspensionPart(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel,
  isFront: boolean
): void {
  const grid = getPartGrid(part);
  const cols = grid.length;
  const segSteps = lod === 'full' ? 84 : Math.max(2, cols - 1);
  const segRing = lod === 'full' ? 56 : 6;

  // Evaluate inboard, mid & outboard pick-ups for brake duct housing
  const outC = evalGrid(grid, 1.0, 0.48, false);

  const upIn = isFront ? 0.082 : 0.088;
  const loIn = isFront ? -0.088 : -0.092;
  const upOut = isFront ? 0.085 : 0.092;
  const loOut = isFront ? -0.095 : -0.096;

  const addPolyStrut = (
    svStart: number,
    svEnd: number,
    offStart: Vec3,
    offEnd: Vec3,
    rChord: number,
    rThick: number
  ) => {
    const pts: Vec3[] = [];
    for (let u = 0; u < cols; u++) {
      const su = cols > 1 ? u / (cols - 1) : 0;
      const sv = lerp(svStart, svEnd, su);
      const base = evalCurveAlongArray(grid[u], sv, false);
      pts.push({
        x: Math.max(0.02, base.x + lerp(offStart.x, offEnd.x, su)),
        y: base.y + lerp(offStart.y, offEnd.y, su),
        z: base.z + lerp(offStart.z, offEnd.z, su),
      });
    }
    appendMirroredPolylineStrut(buf, pts, rChord, rThick, segSteps, segRing, SHADE_STRUT);
  };

  // Upper Wishbone (Front & Rear legs)
  addPolyStrut(0.0, 0.48, { x: 0, y: upIn, z: -0.03 }, { x: 0, y: upOut, z: 0 }, 0.017, 0.0075);
  addPolyStrut(1.0, 0.48, { x: 0, y: upIn - 0.01, z: 0.04 }, { x: 0, y: upOut, z: 0.012 }, 0.017, 0.0075);

  // Lower Wishbone (Front & Rear legs)
  addPolyStrut(0.0, 0.48, { x: 0, y: loIn, z: -0.04 }, { x: 0, y: loOut, z: -0.01 }, 0.019, 0.0085);
  addPolyStrut(1.0, 0.48, { x: 0, y: loIn, z: 0.05 }, { x: 0, y: loOut, z: 0.015 }, 0.019, 0.0085);

  // Pushrod (Front) / Pullrod (Rear) diagonal strut
  if (isFront) {
    addPolyStrut(0.5, 0.48, { x: 0, y: 0.125, z: -0.02 }, { x: 0, y: loOut + 0.018, z: 0.01 }, 0.015, 0.0075);
    // Steering Trackrod
    addPolyStrut(0.32, 0.36, { x: 0, y: 0.01, z: -0.01 }, { x: 0, y: 0.012, z: 0 }, 0.013, 0.0065);
  } else {
    addPolyStrut(0.5, 0.48, { x: 0, y: -0.095, z: 0.03 }, { x: 0, y: upOut - 0.015, z: 0 }, 0.015, 0.0075);
    // Driveshaft streamlined shroud
    addPolyStrut(0.5, 0.48, { x: 0, y: -0.01, z: 0 }, { x: 0, y: -0.015, z: 0.01 }, 0.022, 0.016);
  }

  // Outboard Sculpted Carbon Brake Duct & Scoop Housing
  const bdSteps = lod === 'full' ? 48 : 8;
  const bdRings: Vec3[][] = [];
  const xDuctIn = Math.max(0.05, outC.x - 0.022);
  const xDuctOut = Math.max(0.08, outC.x + 0.024);
  const cy = outC.y - 0.025;
  const cz = outC.z + 0.015;

  for (let i = 0; i <= bdSteps; i++) {
    const t = i / bdSteps;
    const rx = lerp(xDuctIn, xDuctOut, t);
    const radiusZ = 0.148 * Math.sqrt(Math.max(0.08, 1 - Math.pow((t - 0.45) * 1.1, 2)));
    const radiusY = 0.155 * Math.sqrt(Math.max(0.08, 1 - Math.pow((t - 0.45) * 1.1, 2)));
    const nLoop = lod === 'full' ? 56 : 10;
    const ring: Vec3[] = [];
    for (let j = 0; j < nLoop; j++) {
      const ang = (j / nLoop) * Math.PI * 2;
      // Flatten slightly at forward scoop opening
      const scaleZ = Math.sin(ang) < 0 ? 1.08 : 0.92;
      ring.push({
        x: rx,
        y: cy + Math.cos(ang) * radiusY,
        z: cz - Math.sin(ang) * radiusZ * scaleZ,
      });
    }
    bdRings.push(ring);
  }
  const nBdLoop = bdRings[0].length;
  const bdShades = Array.from({ length: nBdLoop }, (_, j) =>
    j > nBdLoop * 0.68 && j < nBdLoop * 0.88 ? SHADE_CAVITY : SHADE_STRUT
  );
  appendMirroredLoftedSolid(buf, bdRings, bdShades, true, true, false);
}

function buildFloorBoards(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);

  // 1. Horizontal lower footplate edge (u = 0 -> u = 0.25)
  const fpU = lod === 'full' ? 14 : 4;
  const fpV = lod === 'full' ? 42 : 10;
  const fpSheet: Vec3[][] = Array.from({ length: fpU + 1 }, () => new Array<Vec3>(fpV + 1));
  for (let iu = 0; iu <= fpU; iu++) {
    const lat = iu / fpU;
    for (let iv = 0; iv <= fpV; iv++) {
      const sv = iv / fpV;
      const pBase = evalGrid(grid, 0.0, sv, false);
      const pMid = evalGrid(grid, 0.4, sv, false);
      fpSheet[iu][iv] = {
        x: Math.max(0.05, lerp(pBase.x - 0.015, pBase.x + Math.max(0.08, (pMid.x - pBase.x) * 1.15), lat)),
        y: lerp(pBase.y, pBase.y + 0.008, lat),
        z: pBase.z,
      };
    }
  }
  appendMirroredCurvedPlate(buf, fpSheet, 'y', 0.0055, SHADE_TRIM, SHADE_LOWER, false);

  // 2. Three staggered aerodynamic wake-control slats rising from footplate (su=0 -> su=1)
  const slats: Array<{ sv0: number; sv1: number; flareOutX: number }> = [
    { sv0: 0.02, sv1: 0.35, flareOutX: 0.000 },
    { sv0: 0.32, sv1: 0.67, flareOutX: 0.016 },
    { sv0: 0.62, sv1: 0.98, flareOutX: 0.030 },
  ];

  const slatHSteps = lod === 'full' ? 56 : 7;
  const slatZSteps = lod === 'full' ? 56 : 7;

  for (let sIdx = 0; sIdx < slats.length; sIdx++) {
    const slat = slats[sIdx];
    const sheet: Vec3[][] = Array.from({ length: slatHSteps + 1 }, () =>
      new Array<Vec3>(slatZSteps + 1)
    );
    for (let ih = 0; ih <= slatHSteps; ih++) {
      const su = ih / slatHSteps; // height along vane from u=0 up to u=2
      for (let iz = 0; iz <= slatZSteps; iz++) {
        const lz = iz / slatZSteps;
        const sv = lerp(slat.sv0, slat.sv1, lz);
        const pt = evalGrid(grid, su, sv, false);
        const camberOut = 0.014 * Math.sin(Math.PI * lz) * (0.3 + 0.7 * su);
        sheet[ih][iz] = {
          x: Math.max(0.05, pt.x + slat.flareOutX * su + camberOut),
          y: pt.y,
          z: pt.z + 0.012 * sIdx * su,
        };
      }
    }
    appendMirroredCurvedPlate(buf, sheet, 'x', 0.005, SHADE_BODY, SHADE_STRUT, false);
  }
}

function buildFloor(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const uSteps = lod === 'full' ? 132 : 14;
  const vSteps = lod === 'full' ? 185 : 20;
  const sampled = preSampleColumns(grid, vSteps);

  // Build volumetric step-plane & Venturi underbody solid (top deck -> outer edge -> concave bottom)
  // Upper and lower grid sheets stitched into a watertight edge loop
  const upSheet: Vec3[][] = Array.from({ length: uSteps + 1 }, () => new Array<Vec3>(vSteps + 1));
  const loSheet: Vec3[][] = Array.from({ length: uSteps + 1 }, () => new Array<Vec3>(vSteps + 1));

  for (let iv = 0; iv <= vSteps; iv++) {
    const sv = iv / vSteps;
    const bibBoost = 0.022 * Math.exp(-Math.pow(sv / 0.14, 2));
    for (let iu = 0; iu <= uSteps; iu++) {
      const su = iu / uSteps;
      const p = evalSampledColumnSlice(sampled, iv, su, true);
      const halfT = 0.008 + 0.014 * (1 - su) + bibBoost * (1 - 0.8 * su);
      // Slight Venturi roof arch on bottom skin across mid-span su in [0.15..0.75]
      const venturiArch = 0.016 * Math.sin(Math.PI * clamp((su - 0.1) / 0.75, 0, 1)) * smoothstep(0.1, 0.35, sv);

      upSheet[iu][iv] = {
        x: p.x,
        y: p.y + halfT,
        z: p.z,
      };
      loSheet[iu][iv] = {
        x: p.x,
        y: Math.max(0.032, p.y - halfT * 0.45 + venturiArch),
        z: p.z,
      };
    }
  }

  for (const mirrorX of [1, -1]) {
    // Upper surface (+Y normal) & Lower Venturi surface (-Y normal)
    const addFloorSkin = (sheet: Vec3[][], shade: number, isLower: boolean) => {
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let iu = 0; iu <= uSteps; iu++) {
        for (let iv = 0; iv <= vSteps; iv++) {
          const p = sheet[iu][iv];
          buf.addVertex(iu === 0 ? 0 : p.x * mirrorX, p.y, p.z, shade);
        }
      }
      const stride = vSteps + 1;
      for (let iu = 0; iu < uSteps; iu++) {
        for (let iv = 0; iv < vSteps; iv++) {
          const a = vStart + iu * stride + iv;
          const b = vStart + iu * stride + iv + 1;
          const c = vStart + (iu + 1) * stride + iv + 1;
          const d = vStart + (iu + 1) * stride + iv;
          const flip = mirrorX === 1 ? isLower : !isLower;
          if (!flip) {
            buf.addTriangle(a, b, c);
            buf.addTriangle(a, c, d);
          } else {
            buf.addTriangle(a, c, b);
            buf.addTriangle(a, d, c);
          }
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };

    addFloorSkin(upSheet, SHADE_BODY, false);
    addFloorSkin(loSheet, SHADE_LOWER, true);

    const stitchBoundary = (aPts: Vec3[], bPts: Vec3[], rev: boolean) => {
      const m = aPts.length;
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let i = 0; i < m; i++) buf.addVertex(aPts[i].x * mirrorX, aPts[i].y, aPts[i].z, SHADE_STRUT);
      for (let i = 0; i < m; i++) buf.addVertex(bPts[i].x * mirrorX, bPts[i].y, bPts[i].z, SHADE_STRUT);
      const flip = mirrorX === 1 ? rev : !rev;
      for (let i = 0; i < m - 1; i++) {
        const a0 = vStart + i, a1 = vStart + i + 1, b1 = vStart + m + i + 1, b0 = vStart + m + i;
        if (!flip) {
          buf.addTriangle(a0, a1, b1);
          buf.addTriangle(a0, b1, b0);
        } else {
          buf.addTriangle(a0, b1, a1);
          buf.addTriangle(a0, b0, b1);
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };

    // Leading edge (iv=0), Trailing edge (iv=vSteps), Outer edge (iu=uSteps)
    stitchBoundary(
      Array.from({ length: uSteps + 1 }, (_, iu) => upSheet[iu][0]),
      Array.from({ length: uSteps + 1 }, (_, iu) => loSheet[iu][0]),
      false
    );
    stitchBoundary(
      Array.from({ length: uSteps + 1 }, (_, iu) => upSheet[iu][vSteps]),
      Array.from({ length: uSteps + 1 }, (_, iu) => loSheet[iu][vSteps]),
      true
    );
    stitchBoundary(
      Array.from({ length: vSteps + 1 }, (_, iv) => upSheet[uSteps][iv]),
      Array.from({ length: vSteps + 1 }, (_, iv) => loSheet[uSteps][iv]),
      true
    );
  }

  // Distinct Rolled Longitudinal Edge Wing strip along outboard floor skirt
  const ewV = lod === 'full' ? 40 : 10;
  const ewU = lod === 'full' ? 10 : 3;
  const ewSheet: Vec3[][] = Array.from({ length: ewU + 1 }, () => new Array<Vec3>(ewV + 1));
  for (let iu = 0; iu <= ewU; iu++) {
    const lat = iu / ewU;
    for (let iv = 0; iv <= ewV; iv++) {
      const sv = lerp(0.18, 0.90, iv / ewV);
      const edgePt = evalGrid(grid, 1.0, sv, false);
      ewSheet[iu][iv] = {
        x: edgePt.x - 0.015 + 0.028 * lat,
        y: edgePt.y + 0.018 + 0.012 * Math.sin(Math.PI * lat),
        z: edgePt.z,
      };
    }
  }
  appendMirroredCurvedPlate(buf, ewSheet, 'y', 0.004, SHADE_TRIM, SHADE_STRUT, false);
}

function buildSidepods(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const vSteps = lod === 'full' ? 175 : 18;
  const ringSub = lod === 'full' ? 5 : 1;
  const sampled = preSampleColumns(grid, vSteps);

  // Outer closed bodywork directly anchored at every dense column (upper lip -> outer edge -> bottom lip)
  const rings: Vec3[][] = [];
  let ringShades: number[] = [];

  for (let iv = 0; iv <= vSteps; iv++) {
    const sv = iv / vSteps;
    const { pts, shades } = collectSampledRingColumns(sampled, iv, false);
    const pTop = pts[0];
    const pBot = pts[pts.length - 1];

    // Inner chassis-side wall closing the bottom lip cleanly back up to the upper shoulder
    const pInnerLower: Vec3 = {
      x: Math.max(0.055, lerp(Math.min(pBot.x * 0.65, pTop.x * 0.85), pTop.x * 0.78, sv)),
      y: pBot.y - 0.014,
      z: pBot.z,
    };
    const pInnerWall: Vec3 = {
      x: Math.max(0.045, pTop.x * 0.72),
      y: lerp(pInnerLower.y, pTop.y, 0.45),
      z: pTop.z,
    };

    shades[shades.length - 1] = SHADE_LOWER;
    pts.push(pInnerLower, pInnerWall);
    shades.push(SHADE_LOWER, SHADE_STRUT);

    const sub = subdivideProfilePoints(pts, shades, ringSub);
    ringShades = sub.shades;
    rings.push(sub.pts);
  }

  // Build outer shell & rear cap; front rim rings[0] sits directly on v = 0 control nodes
  appendMirroredLoftedSolid(buf, rings, ringShades, false, true, false);

  // Recessed Dark Carbon Radiator Inlet Cavity Funnel extending +Z from rings[0] using local inward normals
  const nRim = rings[0].length;
  const inlCore: Vec3[] = rings[0].map((pt, j) => {
    const pPrev = rings[0][(j - 1 + nRim) % nRim];
    const pNext = rings[0][(j + 1) % nRim];
    const tx = pNext.x - pPrev.x;
    const ty = pNext.y - pPrev.y;
    const tLen = Math.hypot(tx, ty) || 1;
    // Clockwise ring tangent (tx, ty) -> inward normal (ty, -tx)
    const inX = ty / tLen;
    const inY = -tx / tLen;
    return {
      x: Math.max(0.03, pt.x + inX * 0.045),
      y: pt.y + inY * 0.045,
      z: pt.z + 0.145,
    };
  });
  appendMirroredLoftedSolid(
    buf,
    [inlCore, rings[0]],
    new Array(nRim).fill(SHADE_CAVITY),
    true,
    false,
    false
  );
}

function buildEngineCover(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const vSteps = lod === 'full' ? 165 : 16;
  const ringSub = lod === 'full' ? 4 : 1;
  const sampled = preSampleColumns(grid, vSteps);

  // 1. Closed aerodynamic cowling & hot-air cooling cannon body across all dense columns
  const rings: Vec3[][] = [];
  let ringShades: number[] = [];
  for (let iv = 0; iv <= vSteps; iv++) {
    const sv = iv / vSteps;
    const { pts, shades } = collectSampledRingColumns(sampled, iv, true);
    const pLast = pts[pts.length - 1];

    const pBotOuter: Vec3 = {
      x: Math.max(0.025, pLast.x * 0.65),
      y: Math.max(0.095, pLast.y - 0.08 * (1 - 0.25 * sv)),
      z: pLast.z,
    };
    const pBotCenter: Vec3 = {
      x: 0,
      y: Math.max(0.085, pLast.y - 0.095 * (1 - 0.25 * sv)),
      z: pLast.z,
    };
    pts.push(pBotOuter, pBotCenter);
    shades.push(SHADE_LOWER, SHADE_LOWER);

    const sub = subdivideProfilePoints(pts, shades, ringSub);
    ringShades = sub.shades;
    rings.push(sub.pts);
  }
  appendMirroredLoftedSolid(buf, rings, ringShades, true, true, true);

  // 2. Sculpted Overhead Airbox Intake Scoop Cavity at rollhoop front (inward/forward normals)
  const scoopOuter = [
    { x: 0, y: rings[0][0].y - 0.015, z: rings[0][0].z - 0.004 },
    { x: 0.092, y: rings[0][0].y - 0.055, z: rings[0][0].z - 0.002 },
    { x: 0.072, y: rings[0][0].y - 0.125, z: rings[0][0].z },
    { x: 0, y: rings[0][0].y - 0.135, z: rings[0][0].z },
  ];
  const scoopInner = scoopOuter.map((pt) => ({
    x: pt.x * 0.68,
    y: pt.y - 0.006,
    z: pt.z + 0.125,
  }));
  appendMirroredLoftedSolid(buf, [scoopInner, scoopOuter], new Array(4).fill(SHADE_CAVITY), true, false, true);

  // 3. Tall Knife-Edge Dorsal Sharkfin Spine (rv_ec_sharkfin_spine zMax=1075mm -> yMax~1.09m)
  const finV = lod === 'full' ? 72 : 10;
  const finH = lod === 'full' ? 20 : 3;
  const finSheet: Vec3[][] = Array.from({ length: finH + 1 }, () => new Array<Vec3>(finV + 1));
  for (let iv = 0; iv <= finV; iv++) {
    const sv = lerp(0.14, 0.96, iv / finV);
    const spine = evalGrid(grid, 0.0, sv, true);
    const heightEnv = Math.sin(Math.PI * smoothstep(0.14, 0.96, sv));
    const finHgt = 0.145 * Math.pow(heightEnv, 0.65);
    for (let ih = 0; ih <= finH; ih++) {
      const h = ih / finH;
      finSheet[ih][iv] = {
        x: 0,
        y: spine.y - 0.01 + finHgt * h,
        z: spine.z + 0.04 * (1 - h) * (1 - sv),
      };
    }
  }
  appendMirroredCurvedPlate(buf, finSheet, 'x', 0.0045, SHADE_TRIM, SHADE_TRIM, false);
}

function buildDiffuser(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel
): void {
  const grid = getPartGrid(part);
  const uSteps = lod === 'full' ? 96 : 12;
  const vSteps = lod === 'full' ? 110 : 12;
  const sampled = preSampleColumns(grid, vSteps);

  // 1. Thickened Diffuser Expansion Ramp & Central Keel Shell
  const upSheet: Vec3[][] = Array.from({ length: uSteps + 1 }, () => new Array<Vec3>(vSteps + 1));
  const loSheet: Vec3[][] = Array.from({ length: uSteps + 1 }, () => new Array<Vec3>(vSteps + 1));

  for (let iv = 0; iv <= vSteps; iv++) {
    for (let iu = 0; iu <= uSteps; iu++) {
      const su = iu / uSteps;
      const p = evalSampledColumnSlice(sampled, iv, su, true);
      const thickTop = 0.012 + 0.024 * Math.exp(-Math.pow(su / 0.28, 2));
      const thickBot = 0.008;
      upSheet[iu][iv] = { x: p.x, y: p.y + thickTop, z: p.z };
      loSheet[iu][iv] = { x: p.x, y: Math.max(0.034, p.y - thickBot), z: p.z };
    }
  }

  for (const mirrorX of [1, -1]) {
    const addSkin = (sheet: Vec3[][], shade: number, isLower: boolean) => {
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let iu = 0; iu <= uSteps; iu++) {
        for (let iv = 0; iv <= vSteps; iv++) {
          const p = sheet[iu][iv];
          buf.addVertex(iu === 0 ? 0 : p.x * mirrorX, p.y, p.z, shade);
        }
      }
      const stride = vSteps + 1;
      for (let iu = 0; iu < uSteps; iu++) {
        for (let iv = 0; iv < vSteps; iv++) {
          const a = vStart + iu * stride + iv;
          const b = vStart + iu * stride + iv + 1;
          const c = vStart + (iu + 1) * stride + iv + 1;
          const d = vStart + (iu + 1) * stride + iv;
          const flip = mirrorX === 1 ? isLower : !isLower;
          if (!flip) {
            buf.addTriangle(a, b, c);
            buf.addTriangle(a, c, d);
          } else {
            buf.addTriangle(a, c, b);
            buf.addTriangle(a, d, c);
          }
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };
    addSkin(upSheet, SHADE_BODY, false);
    addSkin(loSheet, SHADE_LOWER, true);

    const stitchRim = (aPts: Vec3[], bPts: Vec3[], rev: boolean) => {
      const m = aPts.length;
      const vStart = buf.vertexCount;
      const iStart = buf.indexCount;
      for (let i = 0; i < m; i++) buf.addVertex(aPts[i].x * mirrorX, aPts[i].y, aPts[i].z, SHADE_STRUT);
      for (let i = 0; i < m; i++) buf.addVertex(bPts[i].x * mirrorX, bPts[i].y, bPts[i].z, SHADE_STRUT);
      const flip = mirrorX === 1 ? rev : !rev;
      for (let i = 0; i < m - 1; i++) {
        const a0 = vStart + i, a1 = vStart + i + 1, b1 = vStart + m + i + 1, b0 = vStart + m + i;
        if (!flip) {
          buf.addTriangle(a0, a1, b1);
          buf.addTriangle(a0, b1, b0);
        } else {
          buf.addTriangle(a0, b1, a1);
          buf.addTriangle(a0, b0, b1);
        }
      }
      buf.computeSmoothNormals(vStart, buf.vertexCount, iStart, buf.indexCount);
    };

    stitchRim(
      Array.from({ length: uSteps + 1 }, (_, iu) => upSheet[iu][0]),
      Array.from({ length: uSteps + 1 }, (_, iu) => loSheet[iu][0]),
      false
    );
    stitchRim(
      Array.from({ length: uSteps + 1 }, (_, iu) => upSheet[iu][vSteps]),
      Array.from({ length: uSteps + 1 }, (_, iu) => loSheet[iu][vSteps]),
      true
    );
    stitchRim(
      Array.from({ length: vSteps + 1 }, (_, iv) => upSheet[uSteps][iv]),
      Array.from({ length: vSteps + 1 }, (_, iv) => loSheet[uSteps][iv]),
      true
    );
  }

  // 2. Vertical Outer Diffuser Sidewall Skirt (u=1.0 dropping down toward Z_FIA ~ 12..35mm)
  const swH = lod === 'full' ? 14 : 4;
  const swV = lod === 'full' ? 36 : 8;
  const swSheet: Vec3[][] = Array.from({ length: swH + 1 }, () => new Array<Vec3>(swV + 1));
  for (let ih = 0; ih <= swH; ih++) {
    const hy = ih / swH;
    for (let iv = 0; iv <= swV; iv++) {
      const sv = iv / swV;
      const topEdge = evalGrid(grid, 1.0, sv, false);
      const botY = topEdge.y - 0.038 - 0.129 * sv;
      swSheet[ih][iv] = {
        x: Math.max(0.02, topEdge.x),
        y: lerp(botY, topEdge.y + 0.006, hy),
        z: topEdge.z,
      };
    }
  }
  appendMirroredCurvedPlate(buf, swSheet, 'x', 0.0055, SHADE_STRUT, SHADE_LOWER, false);

  // 3. Central Rear Impact Crash Structure & Boat-Tail Cone (rv_tail_structure)
  const btSteps = lod === 'full' ? 24 : 7;
  const pRearCtr = evalGrid(grid, 0.0, 1.0, true);
  const btRings: Vec3[][] = [];
  const nBtRing = 8;
  for (let i = 0; i <= btSteps; i++) {
    const t = i / btSteps;
    const zPos = lerp(pRearCtr.z - 0.16, pRearCtr.z + 0.34, t);
    const cy = pRearCtr.y + 0.032 + 0.025 * t;
    const rx = lerp(0.088, 0.034, t);
    const ry = lerp(0.056, 0.028, t);
    const ring: Vec3[] = [];
    for (let j = 0; j < nBtRing; j++) {
      const ang = (j / nBtRing) * Math.PI * 2;
      ring.push({
        x: Math.max(0, Math.sin(ang) * rx),
        y: cy + Math.cos(ang) * ry,
        z: zPos,
      });
    }
    btRings.push(ring);
  }
  appendMirroredLoftedSolid(buf, btRings, new Array(nBtRing).fill(SHADE_STRUT), true, true, true);
}

function buildRearWing(
  buf: MeshBuildBuffer,
  part: AeroPartData,
  lod: LODLevel,
  aeroMode: ActiveAeroMode
): void {
  const grid = getPartGrid(part);
  const cols = grid.length;
  // Upper lifting span uses columns 0..(cols-2); endplate skirt uses last column
  const wingEndCol = Math.max(1, cols - 2);
  const endCol = grid[cols - 1];

  const uSteps = lod === 'full' ? 120 : 16;
  const cSteps = lod === 'full' ? 24 : 6;
  const isXMode = aeroMode === 'x_mode';

  const elements: Array<{
    sv0: number;
    sv1: number;
    liftY: number;
    camberM: number;
    halfThickM: number;
    xModeAngleRad: number;
  }> = [
    { sv0: 0.00, sv1: 0.44, liftY: -0.004, camberM: 0.018, halfThickM: 0.011, xModeAngleRad: 0 },
    { sv0: 0.46, sv1: 0.74, liftY: 0.008, camberM: 0.014, halfThickM: 0.0085, xModeAngleRad: -0.15 },
    { sv0: 0.75, sv1: 1.00, liftY: 0.007, camberM: 0.013, halfThickM: 0.008, xModeAngleRad: -0.34 },
  ];

  for (let eIdx = 0; eIdx < elements.length; eIdx++) {
    const el = elements[eIdx];
    const stations: Array<{
      le: Vec3;
      te: Vec3;
      midOffset?: Vec3;
      camberM: number;
      maxHalfThickM: number;
      shadeUpper: number;
      shadeLower: number;
    }> = [];

    for (let iu = 0; iu <= uSteps; iu++) {
      const suSpan = iu / uSteps;
      const spoonDip = eIdx === 0 ? -0.016 * Math.exp(-Math.pow(suSpan / 0.35, 2)) : 0;
      const pLe = evalGrid(grid, suSpan, el.sv0, true, wingEndCol);
      const pTe = evalGrid(grid, suSpan, el.sv1, true, wingEndCol);
      const pMid = evalGrid(grid, suSpan, 0.5 * (el.sv0 + el.sv1), true, wingEndCol);

      const midOffset: Vec3 = {
        x: pMid.x - 0.5 * (pLe.x + pTe.x),
        y: pMid.y - 0.5 * (pLe.y + pTe.y),
        z: pMid.z - 0.5 * (pLe.z + pTe.z),
      };

      pLe.y = pLe.y + el.liftY + spoonDip;
      pTe.y = pTe.y + el.liftY + spoonDip;

      // X-Mode active flap opening around front chord hinge
      if (isXMode && Math.abs(el.xModeAngleRad) > 1e-4) {
        const flapBlend = smoothstep(0.525, 0.485, pLe.x);
        if (flapBlend > 0.01) {
          const theta = el.xModeAngleRad * flapBlend;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          const dy = pTe.y - pLe.y;
          const dz = pTe.z - pLe.z;
          pTe.y = pLe.y + dy * cosT + dz * sinT;
          pTe.z = pLe.z - dy * sinT + dz * cosT;
          const my = midOffset.y * cosT + midOffset.z * sinT;
          const mz = -midOffset.y * sinT + midOffset.z * cosT;
          midOffset.y = my;
          midOffset.z = mz;
        }
      }

      stations.push({
        le: pLe,
        te: pTe,
        midOffset,
        camberM: el.camberM * (1 - 0.15 * suSpan),
        maxHalfThickM: el.halfThickM,
        shadeUpper: eIdx === 2 ? SHADE_TRIM : SHADE_BODY,
        shadeLower: SHADE_LOWER,
      });
    }

    appendMirroredAirfoilElement(buf, stations, cSteps, false, true);
  }

  // Sculpted Curved 2026 Rear Wing Endplates (bridging wing tip down to lower endplate skirt)
  const epZSteps = lod === 'full' ? 60 : 8;
  const epYSteps = lod === 'full' ? 52 : 8;
  const epSheet: Vec3[][] = Array.from({ length: epYSteps + 1 }, () =>
    new Array<Vec3>(epZSteps + 1)
  );
  const tipCol = grid[wingEndCol];

  for (let iv = 0; iv <= epZSteps; iv++) {
    const sv = iv / epZSteps;
    const pTop = evalCurveAlongArray(tipCol, sv, false);
    const pBot = evalCurveAlongArray(endCol, sv, false);

    for (let iu = 0; iu <= epYSteps; iu++) {
      const hu = iu / epYSteps; // 0 = lower skirt edge -> 1 = top wing tip rim
      const curvedSweep = 0.036 * Math.sin(Math.PI * hu) * (1 - sv);
      epSheet[iu][iv] = {
        x: Math.max(0.02, lerp(pBot.x, pTop.x + 0.008, hu)),
        y: lerp(pBot.y - 0.085, pTop.y + 0.008, hu),
        z: lerp(pBot.z, pTop.z, hu) - curvedSweep,
      };
    }
  }
  appendMirroredCurvedPlate(buf, epSheet, 'x', 0.006, SHADE_BODY, SHADE_STRUT, false);

  // Twin Slim Central Swan-Neck Rear Wing Pylon Mounting Pillars (rv_rw_pylon)
  const pyYSteps = lod === 'full' ? 24 : 7;
  const pyZSteps = lod === 'full' ? 14 : 4;
  const pySheet: Vec3[][] = Array.from({ length: pyYSteps + 1 }, () =>
    new Array<Vec3>(pyZSteps + 1)
  );
  const topCtrLe = evalGrid(grid, 0.0, 0.05, true, wingEndCol);
  for (let iy = 0; iy <= pyYSteps; iy++) {
    const hy = iy / pyYSteps;
    for (let iz = 0; iz <= pyZSteps; iz++) {
      const hz = iz / pyZSteps;
      // Curve forward like a swan-neck over the upper mainplane edge
      const swanForward = -0.105 * Math.pow(Math.sin(Math.PI * Math.pow(hy, 0.85)), 1.2);
      const chordLen = lerp(0.22, 0.14, hy);
      const zCenter = lerp(topCtrLe.z - 0.04, topCtrLe.z + 0.03, Math.pow(hy, 0.8)) + swanForward;
      pySheet[iy][iz] = {
        x: 0.022,
        y: lerp(topCtrLe.y - 0.40, topCtrLe.y + 0.018, hy),
        z: zCenter + (hz - 0.5) * chordLen,
      };
    }
  }
  appendMirroredCurvedPlate(buf, pySheet, 'x', 0.006, SHADE_STRUT, SHADE_STRUT, false);
}

/**
 * Dispatcher building purpose-crafted volumetric/multi-element geometry for all 11 F1 2026 parts.
 */
export function buildPartBodyGeometry(
  part: AeroPartData,
  lod: LODLevel,
  aeroMode: ActiveAeroMode
): BuiltPartGeometry {
  const initVerts = lod === 'full' ? 65536 : 4096;
  const initIndices = lod === 'full' ? 240000 : 12000;
  const buf = new MeshBuildBuffer(initVerts, initIndices);

  const id: PartId = part.id;
  switch (id) {
    case 'front_wing':
      buildFrontWing(buf, part, lod, aeroMode);
      break;
    case 'nosecone':
      buildNosecone(buf, part, lod);
      break;
    case 'front_suspension':
      buildSuspensionPart(buf, part, lod, true);
      break;
    case 'monocoque':
      buildMonocoque(buf, part, lod);
      break;
    case 'floor_boards':
      buildFloorBoards(buf, part, lod);
      break;
    case 'floor':
      buildFloor(buf, part, lod);
      break;
    case 'sidepods':
      buildSidepods(buf, part, lod);
      break;
    case 'engine_cover':
      buildEngineCover(buf, part, lod);
      break;
    case 'rear_suspension':
      buildSuspensionPart(buf, part, lod, false);
      break;
    case 'diffuser':
      buildDiffuser(buf, part, lod);
      break;
    case 'rear_wing':
      buildRearWing(buf, part, lod, aeroMode);
      break;
  }

  return {
    positions: buf.positions.slice(0, buf.vertexCount * 3),
    normals: buf.normals.slice(0, buf.vertexCount * 3),
    shades: buf.shades.slice(0, buf.vertexCount),
    indices: buf.indices.slice(0, buf.indexCount),
    vertexCount: buf.vertexCount,
    triangleCount: Math.floor(buf.indexCount / 3),
  };
}
