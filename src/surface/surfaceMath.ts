import { AeroPartData, Vec3 } from '../types/aero';

export function catmullRomScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
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

export function catmullRomVec3(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number
): Vec3 {
  return {
    x: catmullRomScalar(p0.x, p1.x, p2.x, p3.x, t),
    y: catmullRomScalar(p0.y, p1.y, p2.y, p3.y, t),
    z: catmullRomScalar(p0.z, p1.z, p2.z, p3.z, t),
  };
}

export function evalCurveAlongArray(
  pts: Vec3[],
  s: number,
  mirrorStartAcrossX = false
): Vec3 {
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

export function halfThicknessProfile(
  part: AeroPartData,
  sv: number,
  su: number
): number {
  const t = Math.max(0, Math.min(1, sv));
  const halfMax = part.thickness * 0.5;

  if (part.role === 'body_fairing') {
    const chordEnv = Math.sin(Math.PI * (0.06 + 0.88 * t));
    const edgeTaper = part.centerlineLocked ? 1.0 : Math.sin(Math.PI * (0.12 + 0.76 * su));
    return halfMax * chordEnv * edgeTaper;
  }

  const naca =
    5.0 *
    (0.2969 * Math.sqrt(t) -
      0.126 * t -
      0.3516 * t * t +
      0.2843 * t * t * t -
      0.1015 * t * t * t * t);
  return halfMax * Math.max(0.06, naca);
}

export function bilinearLookup(grid: number[][], su: number, sv: number): number {
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
