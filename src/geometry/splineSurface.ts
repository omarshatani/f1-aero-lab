import * as THREE from 'three';
import { AeroPartData, PartSurfaceCpMap, SurfaceVizMode, Vec3 } from '../types/aero';

export interface SampledSurfaceGrid {
  uSteps: number;
  vSteps: number;
  /** World +X camber points [iu][iv] */
  points: Vec3[][];
  /** Unit surface normals [iu][iv] (pointing generally +Y / outward on upper side) */
  normals: Vec3[][];
  /** Unit chordwise tangents [iu][iv] (front -Z -> rear +Z) */
  tangentsV: Vec3[][];
  /** Unit spanwise tangents [iu][iv] (inboard -> outboard +X) */
  tangentsU: Vec3[][];
}

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function catmullRomVec3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  return {
    x: catmullRomScalar(p0.x, p1.x, p2.x, p3.x, t),
    y: catmullRomScalar(p0.y, p1.y, p2.y, p3.y, t),
    z: catmullRomScalar(p0.z, p1.z, p2.z, p3.z, t),
  };
}

function evalCurveAlongArray(pts: Vec3[], s: number, mirrorStartAcrossX = false): Vec3 {
  const n = pts.length;
  if (n === 1) return { ...pts[0] };
  const scaled = Math.max(0, Math.min(1, s)) * (n - 1);
  const idx = Math.min(n - 2, Math.floor(scaled));
  const frac = scaled - idx;

  const getPt = (i: number): Vec3 => {
    if (i < 0) {
      if (mirrorStartAcrossX && n > 1) {
        return { x: -pts[1].x, y: pts[1].y, z: pts[1].z };
      }
      // Linear extrapolation clamped gently
      return {
        x: 2 * pts[0].x - pts[1].x,
        y: 2 * pts[0].y - pts[1].y,
        z: 2 * pts[0].z - pts[1].z,
      };
    }
    if (i >= n) {
      return {
        x: 2 * pts[n - 1].x - pts[n - 2].x,
        y: 2 * pts[n - 1].y - pts[n - 2].y,
        z: 2 * pts[n - 1].z - pts[n - 2].z,
      };
    }
    return pts[i];
  };

  return catmullRomVec3(getPt(idx - 1), getPt(idx), getPt(idx + 1), getPt(idx + 2), frac);
}

/**
 * Evaluate the smooth bicubic Catmull-Rom camber surface of an AeroPartData on the +X half-car.
 */
export function sampleSplineSurface(
  part: AeroPartData,
  uSteps = 22,
  vSteps = 18
): SampledSurfaceGrid {
  // First evaluate v-curves along each control column u
  const colSampled: Vec3[][] = [];
  for (let u = 0; u < part.cols; u++) {
    const col: Vec3[] = [];
    for (let iv = 0; iv <= vSteps; iv++) {
      const sv = iv / vSteps;
      col.push(evalCurveAlongArray(part.grid[u], sv, false));
    }
    colSampled.push(col);
  }

  // Next evaluate across u for each iv slice
  const points: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );

  for (let iv = 0; iv <= vSteps; iv++) {
    const rowCtrl: Vec3[] = [];
    for (let u = 0; u < part.cols; u++) {
      rowCtrl.push(colSampled[u][iv]);
    }
    for (let iu = 0; iu <= uSteps; iu++) {
      const su = iu / uSteps;
      const pt = evalCurveAlongArray(rowCtrl, su, part.centerlineLocked);
      if (part.centerlineLocked && iu === 0) {
        pt.x = 0;
      } else {
        pt.x = Math.max(0, pt.x);
      }
      points[iu][iv] = pt;
    }
  }

  // Compute tangents & surface normals via central differences
  const normals: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );
  const tangentsV: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );
  const tangentsU: Vec3[][] = Array.from({ length: uSteps + 1 }, () =>
    new Array<Vec3>(vSteps + 1)
  );

  for (let iu = 0; iu <= uSteps; iu++) {
    const iuPrev = Math.max(0, iu - 1);
    const iuNext = Math.min(uSteps, iu + 1);
    for (let iv = 0; iv <= vSteps; iv++) {
      const ivPrev = Math.max(0, iv - 1);
      const ivNext = Math.min(vSteps, iv + 1);

      const pu = {
        x: points[iuNext][iv].x - points[iuPrev][iv].x,
        y: points[iuNext][iv].y - points[iuPrev][iv].y,
        z: points[iuNext][iv].z - points[iuPrev][iv].z,
      };
      const pv = {
        x: points[iu][ivNext].x - points[iu][ivPrev].x,
        y: points[iu][ivNext].y - points[iu][ivPrev].y,
        z: points[iu][ivNext].z - points[iu][ivPrev].z,
      };

      const lu = Math.hypot(pu.x, pu.y, pu.z) || 1;
      const lv = Math.hypot(pv.x, pv.y, pv.z) || 1;
      const tu = { x: pu.x / lu, y: pu.y / lu, z: pu.z / lu };
      const tv = { x: pv.x / lv, y: pv.y / lv, z: pv.z / lv };

      // Right-hand cross product tv x tu -> +Y upward when tv=+Z and tu=+X
      let nx = tv.y * tu.z - tv.z * tu.y;
      let ny = tv.z * tu.x - tv.x * tu.z;
      let nz = tv.x * tu.y - tv.y * tu.x;
      const ln = Math.hypot(nx, ny, nz) || 1;
      nx /= ln;
      ny /= ln;
      nz /= ln;

      tangentsU[iu][iv] = tu;
      tangentsV[iu][iv] = tv;
      normals[iu][iv] = { x: nx, y: ny, z: nz };
    }
  }

  return { uSteps, vSteps, points, normals, tangentsV, tangentsU };
}

function halfThicknessProfile(part: AeroPartData, sv: number, su: number): number {
  const t = Math.max(0, Math.min(1, sv));
  const halfMax = part.thickness * 0.5;

  if (part.role === 'body_fairing') {
    // Smooth tapered carbon fairing shell
    const chordEnv = Math.sin(Math.PI * (0.06 + 0.88 * t));
    const edgeTaper = part.centerlineLocked ? 1.0 : Math.sin(Math.PI * (0.12 + 0.76 * su));
    return halfMax * chordEnv * edgeTaper;
  }

  // NACA-style symmetric thickness envelope (peaks at 30% chord, rounded LE, sharp TE)
  const naca =
    5.0 *
    (0.2969 * Math.sqrt(t) -
      0.126 * t -
      0.3516 * t * t +
      0.2843 * t * t * t -
      0.1015 * t * t * t * t);
  return halfMax * Math.max(0.06, naca);
}

/**
 * Scientific CFD Pressure Coefficient (Cp) colormap:
 * Deep Violet/Blue (-1.8 strong suction) -> Cyan (-0.8) -> Green (0.0 ambient) -> Yellow (+0.45) -> Red (+0.95 stagnation)
 */
export function cpToRgb(cp: number): [number, number, number] {
  const clamped = Math.max(-1.8, Math.min(1.0, cp));
  // Normalize [-1.8 .. +1.0] -> [0 .. 1] with 0.0 around 0.64
  const stops: Array<{ v: number; r: number; g: number; b: number }> = [
    { v: -1.8, r: 0.14, g: 0.08, b: 0.68 },
    { v: -1.1, r: 0.04, g: 0.42, b: 0.96 },
    { v: -0.45, r: 0.04, g: 0.82, b: 0.88 },
    { v: 0.0, r: 0.16, g: 0.84, b: 0.38 },
    { v: 0.45, r: 0.96, g: 0.82, b: 0.12 },
    { v: 1.0, r: 0.94, g: 0.16, b: 0.16 },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.v && clamped <= b.v) {
      const f = (clamped - a.v) / (b.v - a.v);
      return [a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

export function separationToRgb(sep: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, sep));
  if (s < 0.25) {
    const f = s / 0.25;
    return [0.08 + 0.06 * f, 0.55 + 0.2 * f, 0.52 - 0.1 * f];
  }
  const f = (s - 0.25) / 0.75;
  return [0.22 + 0.76 * f, 0.65 - 0.5 * f, 0.35 + 0.35 * f];
}

function bilinearLookup(grid: number[][], su: number, sv: number): number {
  const nu = grid.length - 1;
  const nv = grid[0].length - 1;
  const fu = Math.max(0, Math.min(1, su)) * nu;
  const fv = Math.max(0, Math.min(1, sv)) * nv;
  const i0 = Math.min(nu - 1, Math.floor(fu));
  const j0 = Math.min(nv - 1, Math.floor(fv));
  const tu = fu - i0;
  const tv = fv - j0;

  const c00 = grid[i0][j0];
  const c10 = grid[i0 + 1][j0];
  const c01 = grid[i0][j0 + 1];
  const c11 = grid[i0 + 1][j0 + 1];
  return (1 - tu) * (1 - tv) * c00 + tu * (1 - tv) * c10 + (1 - tu) * tv * c01 + tu * tv * c11;
}

/**
 * Build a complete mirrored closed 3D BufferGeometry (Starboard +X & Port -X) for an AeroPartData.
 */
export function buildPartGeometry(
  part: AeroPartData,
  vizMode: SurfaceVizMode = 'carbon',
  cpMap?: PartSurfaceCpMap,
  uSteps = 24,
  vSteps = 20
): { geometry: THREE.BufferGeometry; sampled: SampledSurfaceGrid } {
  const sampled = sampleSplineSurface(part, uSteps, vSteps);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const baseColor = new THREE.Color(part.accentHex);
  const carbonUpper: [number, number, number] = [
    0.13 + baseColor.r * 0.22,
    0.15 + baseColor.g * 0.22,
    0.18 + baseColor.b * 0.22,
  ];
  const carbonLower: [number, number, number] = [0.1, 0.11, 0.13];

  const buildHalf = (mirrorX: 1 | -1) => {
    const baseVertexOffset = positions.length / 3;
    const strideV = vSteps + 1;
    const gridVertexCount = (uSteps + 1) * (vSteps + 1);

    // Push Upper skin vertices [0 .. gridVertexCount-1], then Lower skin vertices [gridVertexCount .. 2*gridVertexCount-1]
    for (const skinSign of [1, -1] as const) {
      for (let iu = 0; iu <= uSteps; iu++) {
        const su = iu / uSteps;
        for (let iv = 0; iv <= vSteps; iv++) {
          const sv = iv / vSteps;
          const p = sampled.points[iu][iv];
          const n = sampled.normals[iu][iv];
          const h = halfThicknessProfile(part, sv, su) * skinSign;

          let vx = (p.x + n.x * h) * mirrorX;
          if (part.centerlineLocked && iu === 0) {
            vx = 0;
          }
          const vy = p.y + n.y * h;
          const vz = p.z + n.z * h;
          positions.push(vx, vy, vz);

          let rgb: [number, number, number];
          if (vizMode === 'cp' && cpMap) {
            const cpGrid = skinSign === 1 ? cpMap.upperCp : cpMap.lowerCp;
            rgb = cpToRgb(bilinearLookup(cpGrid, su, sv));
          } else if (vizMode === 'stall' && cpMap) {
            rgb = separationToRgb(bilinearLookup(cpMap.separation, su, sv));
          } else {
            rgb = skinSign === 1 ? carbonUpper : carbonLower;
          }
          colors.push(rgb[0], rgb[1], rgb[2]);
        }
      }
    }

    const upperIdx = (iu: number, iv: number) => baseVertexOffset + iu * strideV + iv;
    const lowerIdx = (iu: number, iv: number) =>
      baseVertexOffset + gridVertexCount + iu * strideV + iv;

    const pushTri = (a: number, b: number, c: number) => {
      if (mirrorX === 1) {
        indices.push(a, b, c);
      } else {
        indices.push(a, c, b);
      }
    };

    // Upper & Lower skin quads
    for (let iu = 0; iu < uSteps; iu++) {
      for (let iv = 0; iv < vSteps; iv++) {
        // Upper skin (normal +n)
        const u00 = upperIdx(iu, iv);
        const u10 = upperIdx(iu + 1, iv);
        const u01 = upperIdx(iu, iv + 1);
        const u11 = upperIdx(iu + 1, iv + 1);
        pushTri(u00, u01, u11);
        pushTri(u00, u11, u10);

        // Lower skin (normal -n)
        const l00 = lowerIdx(iu, iv);
        const l10 = lowerIdx(iu + 1, iv);
        const l01 = lowerIdx(iu, iv + 1);
        const l11 = lowerIdx(iu + 1, iv + 1);
        pushTri(l00, l11, l01);
        pushTri(l00, l10, l11);
      }
    }

    // Leading edge stitch (iv = 0) & Trailing edge stitch (iv = vSteps)
    for (let iu = 0; iu < uSteps; iu++) {
      // Leading edge
      pushTri(upperIdx(iu, 0), upperIdx(iu + 1, 0), lowerIdx(iu + 1, 0));
      pushTri(upperIdx(iu, 0), lowerIdx(iu + 1, 0), lowerIdx(iu, 0));

      // Trailing edge
      pushTri(upperIdx(iu, vSteps), lowerIdx(iu + 1, vSteps), upperIdx(iu + 1, vSteps));
      pushTri(upperIdx(iu, vSteps), lowerIdx(iu, vSteps), lowerIdx(iu + 1, vSteps));
    }

    // Outer spanwise tip cap (iu = uSteps)
    for (let iv = 0; iv < vSteps; iv++) {
      pushTri(upperIdx(uSteps, iv), upperIdx(uSteps, iv + 1), lowerIdx(uSteps, iv + 1));
      pushTri(upperIdx(uSteps, iv), lowerIdx(uSteps, iv + 1), lowerIdx(uSteps, iv));
    }

    // Inner spanwise cap only if detached from centerline (e.g. Sidepods)
    if (!part.centerlineLocked) {
      for (let iv = 0; iv < vSteps; iv++) {
        pushTri(upperIdx(0, iv), lowerIdx(0, iv + 1), upperIdx(0, iv + 1));
        pushTri(upperIdx(0, iv), lowerIdx(0, iv), lowerIdx(0, iv + 1));
      }
    }
  };

  buildHalf(1);
  buildHalf(-1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, sampled };
}
