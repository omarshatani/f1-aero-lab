import { createBaselineParts } from '../src/regulations/fia2026';
import { AeroPartData, Vec3 } from '../src/types/aero';

// Helper math
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

const parts = createBaselineParts();

// Check floor trailing edge vs diffuser leading edge
const floor = parts.floor;
const diffuser = parts.diffuser;

const uSteps = 50;
let maxGap = 0;

for (let iu = 0; iu <= uSteps; iu++) {
  const su = iu / uSteps;
  // Floor trailing edge: sv = 1
  const floorRowCtrl: Vec3[] = [];
  for (let u = 0; u < floor.grid.length; u++) {
    floorRowCtrl.push(floor.grid[u][floor.rows - 1]);
  }
  const ptFloor = evalCurveAlongArray(floorRowCtrl, su, true);

  // Diffuser leading edge: sv = 0
  const diffRowCtrl: Vec3[] = [];
  for (let u = 0; u < diffuser.grid.length; u++) {
    diffRowCtrl.push(diffuser.grid[u][0]);
  }
  const ptDiff = evalCurveAlongArray(diffRowCtrl, su, true);

  const d = Math.hypot(ptFloor.x - ptDiff.x, ptFloor.y - ptDiff.y, ptFloor.z - ptDiff.z);
  if (d > maxGap) maxGap = d;
}

console.log(`Floor <-> Diffuser evaluated boundary curve max gap: ${(maxGap * 1000).toFixed(6)} mm`);
