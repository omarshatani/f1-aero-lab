import { sampleSplineSurface } from '../geometry/splineSurface';
import {
  checkPartLegality,
  PART_ORDER,
  WORLD_FRONT_AXLE_Z,
  WORLD_REAR_AXLE_Z,
} from '../regulations/fia2026';
import {
  AeroDiagnostic,
  AeroPartData,
  CFDGridField,
  CFDResult,
  MacroAeroPanel,
  PartCFDMetrics,
  PartId,
  PartSurfaceCpMap,
  TunnelSettings,
  Vec3,
} from '../types/aero';

const AIR_DENSITY = 1.225; // kg/m^3 (sea level ISA)
const REF_AREA = 1.45; // m^2 nominal narrower 2026 F1 frontal reference area (1.90m max width)
const FRONT_AXLE_Z = WORLD_FRONT_AXLE_Z; // -1.70 m (X_F = 0)
const REAR_AXLE_Z = WORLD_REAR_AXLE_Z; // +1.70 m (X_R = 0, X_F = 3400)
const WHEELBASE = REAR_AXLE_Z - FRONT_AXLE_Z; // 3.40 m

// Official 2026 FIA Narrower Tire & Rim Envelopes (Art. 10.7.2 & 10.10.1)
const FIA_2026_WHEELS = {
  front: { x: 0.764, y: 0.359, z: FRONT_AXLE_Z, radius: 0.359, width: 0.335 },
  rear: { x: 0.728, y: 0.359, z: REAR_AXLE_Z, radius: 0.359, width: 0.426 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Apply Wind Tunnel Ride Height & Rake offset to a 3D car coordinate.
 */
export function applyRideHeightTransform(
  p: Vec3,
  frontOffsetM: number,
  rearOffsetM: number
): Vec3 {
  const t = (p.z - FRONT_AXLE_Z) / WHEELBASE;
  const dy = frontOffsetM + (rearOffsetM - frontOffsetM) * t;
  return { x: p.x, y: p.y + dy, z: p.z };
}

/**
 * Trilinear sample of velocity, Cp & wake turbulence from the 3D CFD grid.
 */
export function sampleCFDField(
  field: CFDGridField,
  x: number,
  y: number,
  z: number
): { vx: number; vy: number; vz: number; cp: number; turb: number } {
  const fx = clamp((x - field.minX) / (field.maxX - field.minX), 0, 0.9999) * (field.nx - 1);
  const fy = clamp((y - field.minY) / (field.maxY - field.minY), 0, 0.9999) * (field.ny - 1);
  const fz = clamp((z - field.minZ) / (field.maxZ - field.minZ), 0, 0.9999) * (field.nz - 1);

  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const k0 = Math.floor(fz);
  const i1 = Math.min(field.nx - 1, i0 + 1);
  const j1 = Math.min(field.ny - 1, j0 + 1);
  const k1 = Math.min(field.nz - 1, k0 + 1);

  const tx = fx - i0;
  const ty = fy - j0;
  const tz = fz - k0;

  const idx = (i: number, j: number, k: number) => (k * field.ny + j) * field.nx + i;

  const i000 = idx(i0, j0, k0);
  const i100 = idx(i1, j0, k0);
  const i010 = idx(i0, j1, k0);
  const i110 = idx(i1, j1, k0);
  const i001 = idx(i0, j0, k1);
  const i101 = idx(i1, j0, k1);
  const i011 = idx(i0, j1, k1);
  const i111 = idx(i1, j1, k1);

  const bilerpZ = (arr: Float32Array) => {
    const c00 = arr[i000] * (1 - tx) + arr[i100] * tx;
    const c10 = arr[i010] * (1 - tx) + arr[i110] * tx;
    const c01 = arr[i001] * (1 - tx) + arr[i101] * tx;
    const c11 = arr[i011] * (1 - tx) + arr[i111] * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  };

  return {
    vx: bilerpZ(field.vx),
    vy: bilerpZ(field.vy),
    vz: bilerpZ(field.vz),
    cp: bilerpZ(field.cp),
    turb: bilerpZ(field.turbulence),
  };
}

interface PanelInfluence {
  x: number;
  y: number;
  z: number;
  dvx: number;
  dvy: number;
  dvz: number;
  dcp: number;
  dturb: number;
  radius: number;
}

/**
 * Executes a coupled 3D Surface-Panel + Space-Marching Semi-Lagrangian Wake CFD solve
 * calibrated to the 2026 FIA Formula 1 Technical Regulations (including narrower 1.9m track,
 * 2026 Floor Boards, flatter ground-effect floor, beamless rear wing, and X-Mode / Z-Mode Active Aero).
 */
export function runCFDSimulation(
  parts: Record<PartId, AeroPartData>,
  settings: TunnelSettings,
  realMeshPanels?: Partial<Record<PartId, MacroAeroPanel[]>>,
  realLegalityPoints?: Partial<Record<PartId, Vec3[]>>
): CFDResult {
  const vInf = Math.max(10, settings.windSpeedKmh / 3.6);
  const yawRad = (settings.yawAngleDeg * Math.PI) / 180;
  const vInfX = vInf * Math.sin(yawRad);
  const vInfZ = vInf * Math.cos(yawRad);
  const qInf = 0.5 * AIR_DENSITY * vInf * vInf;

  const frontRideM = settings.frontRideHeightMm * 0.001;
  const rearRideM = settings.rearRideHeightMm * 0.001;
  const isXMode = settings.activeAeroMode === 'x_mode';

  // 1. Initialize 3D Wind Tunnel Grid covering full FIA 2026 length [-3.28m .. +3.28m]
  const nx = 34;
  const ny = 22;
  const nz = 64;
  const minX = -1.30;
  const maxX = 1.30;
  const minY = 0.0;
  const maxY = 1.35;
  const minZ = -3.28;
  const maxZ = 3.28;

  const dx = (maxX - minX) / (nx - 1);
  const dy = (maxY - minY) / (ny - 1);
  const dz = (maxZ - minZ) / (nz - 1);

  const totalCells = nx * ny * nz;
  const field: CFDGridField = {
    nx,
    ny,
    nz,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    vx: new Float32Array(totalCells),
    vy: new Float32Array(totalCells),
    vz: new Float32Array(totalCells),
    cp: new Float32Array(totalCells),
    turbulence: new Float32Array(totalCells),
    solid: new Uint8Array(totalCells),
  };

  const cellIdx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = cellIdx(i, j, k);
        field.vx[c] = vInfX;
        field.vy[c] = 0;
        field.vz[c] = vInfZ;
        field.cp[c] = 0;
        field.turbulence[c] = 0;
      }
    }
  }

  // Mark homologated survival cell & 4 narrower 2026 rotating wheels into solid mask
  const wheels = [
    { ...FIA_2026_WHEELS.front, sx: 1 },
    { ...FIA_2026_WHEELS.front, sx: -1 },
    { ...FIA_2026_WHEELS.rear, sx: 1 },
    { ...FIA_2026_WHEELS.rear, sx: -1 },
  ];

  for (let k = 0; k < nz; k++) {
    const z = minZ + k * dz;
    for (let j = 0; j < ny; j++) {
      const y = minY + j * dy;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * dx;
        const c = cellIdx(i, j, k);

        // Survival cell / roll hoop solid core (X_F = 50 .. 3100 -> z = -1.65 .. +1.40)
        if (z >= -1.65 && z <= 1.40) {
          const halfW = z < 0.25 ? 0.24 : 0.24 * (1 - (z - 0.25) / 1.35);
          const topY = (z > 0.05 && z < 0.85 ? 0.86 : 0.60) + frontRideM * 0.5;
          if (Math.abs(x) < halfW && y > 0.16 && y < topY) {
            field.solid[c] = 1;
          }
        }

        // 4 Rotating 2026 Wheels
        for (const w of wheels) {
          const wx = w.sx * w.x;
          const dr = Math.hypot(y - w.y, z - w.z);
          if (Math.abs(x - wx) <= w.width * 0.52 && dr <= w.radius) {
            field.solid[c] = 1;
          }
        }
      }
    }
  }

  const stampSliceImpulse = (kSlice: number, inf: PanelInfluence) => {
    if (kSlice < 0 || kSlice >= nz) return;
    const radCellsX = Math.ceil(inf.radius / dx);
    const radCellsY = Math.ceil(inf.radius / dy);
    const ic = Math.round((inf.x - minX) / dx);
    const jc = Math.round((inf.y - minY) / dy);
    const invR2 = 1 / (inf.radius * inf.radius);

    for (let j = Math.max(0, jc - radCellsY); j <= Math.min(ny - 1, jc + radCellsY); j++) {
      const py = minY + j * dy;
      for (let i = Math.max(0, ic - radCellsX); i <= Math.min(nx - 1, ic + radCellsX); i++) {
        const px = minX + i * dx;
        const d2 = (px - inf.x) * (px - inf.x) + (py - inf.y) * (py - inf.y);
        if (d2 > inf.radius * inf.radius) continue;
        const w = Math.exp(-2.2 * d2 * invR2);
        const c = cellIdx(i, j, kSlice);
        field.vx[c] += inf.dvx * w;
        field.vy[c] += inf.dvy * w;
        field.vz[c] = clamp(field.vz[c] + inf.dvz * w, 0.18 * vInf, 1.85 * vInf);
        field.cp[c] = clamp(field.cp[c] + inf.dcp * w, -2.0, 1.1);
        field.turbulence[c] = clamp(field.turbulence[c] + inf.dturb * w, 0, 0.95);
      }
    }
  };

  const marchFlowSlices = (
    kStart: number,
    kEnd: number,
    impulsesByK: Map<number, PanelInfluence[]>
  ) => {
    for (let k = Math.max(1, kStart); k <= Math.min(nz - 1, kEnd); k++) {
      const z = minZ + k * dz;

      for (let j = 0; j < ny; j++) {
        const y = minY + j * dy;
        for (let i = 0; i < nx; i++) {
          const x = minX + i * dx;
          const c = cellIdx(i, j, k);
          const cPrev = cellIdx(i, j, k - 1);

          const vzPrev = Math.max(0.25 * vInf, field.vz[cPrev]);
          const dt = dz / vzPrev;
          const xUp = clamp(x - field.vx[cPrev] * dt, minX, maxX - 0.001);
          const yUp = clamp(y - field.vy[cPrev] * dt, minY, maxY - 0.001);

          const fx = ((xUp - minX) / (maxX - minX)) * (nx - 1);
          const fy = ((yUp - minY) / (maxY - minY)) * (ny - 1);
          const i0 = Math.floor(fx);
          const j0 = Math.floor(fy);
          const i1 = Math.min(nx - 1, i0 + 1);
          const j1 = Math.min(ny - 1, j0 + 1);
          const tx = fx - i0;
          const ty = fy - j0;

          const bilerpPrev = (arr: Float32Array) => {
            const v00 = arr[cellIdx(i0, j0, k - 1)];
            const v10 = arr[cellIdx(i1, j0, k - 1)];
            const v01 = arr[cellIdx(i0, j1, k - 1)];
            const v11 = arr[cellIdx(i1, j1, k - 1)];
            return (
              (1 - tx) * (1 - ty) * v00 +
              tx * (1 - ty) * v10 +
              (1 - tx) * ty * v01 +
              tx * ty * v11
            );
          };

          const advVx = bilerpPrev(field.vx);
          const advVy = bilerpPrev(field.vy);
          const advVz = bilerpPrev(field.vz);
          const advCp = bilerpPrev(field.cp);
          const advTurb = bilerpPrev(field.turbulence);

          field.vx[c] = vInfX + (advVx - vInfX) * 0.93;
          field.vy[c] = advVy * 0.92;
          if (j === 0 && field.vy[c] < 0) field.vy[c] = 0;

          field.vz[c] = vInfZ + (advVz - vInfZ) * 0.95;
          field.cp[c] = advCp * 0.82;
          field.turbulence[c] = advTurb * 0.965;

          if (field.solid[c]) {
            field.vz[c] = 0.22 * vInf;
            field.cp[c] = 0.65;
            field.turbulence[c] = Math.max(field.turbulence[c], 0.42);
          }

          // Rotating 2026 wheel bow deflection & tire squirt wake
          for (const w of wheels) {
            const wx = w.sx * w.x;
            const dxW = x - wx;
            const dyW = y - w.y;
            const dzW = z - w.z;

            if (Math.abs(dzW) < w.radius * 1.35 && y < w.y + w.radius * 1.3) {
              const distLat = Math.hypot(dxW / (w.width * 0.85), dyW / (w.radius * 1.1));
              if (distLat < 1.35) {
                const strength = (1.35 - distLat) * 0.21 * vInf;
                if (dzW < 0) {
                  field.vx[c] += Math.sign(dxW || w.sx) * strength * 0.55;
                  field.vy[c] += strength * 0.48;
                  field.cp[c] += 0.22 * (1.35 - distLat);
                } else {
                  const squirt = y < 0.16 ? 1.32 : 1.0;
                  field.turbulence[c] = clamp(
                    field.turbulence[c] + 0.23 * (1.35 - distLat) * squirt,
                    0,
                    0.92
                  );
                  field.vz[c] = Math.max(
                    0.28 * vInf,
                    field.vz[c] - 0.15 * vInf * (1.35 - distLat)
                  );
                  field.cp[c] -= 0.12 * (1.35 - distLat);
                }
              }
            }
          }
        }
      }

      const sliceImpulses = impulsesByK.get(k);
      if (sliceImpulses) {
        for (const imp of sliceImpulses) {
          stampSliceImpulse(k, imp);
        }
      }
    }
  };

  // 2. Front-to-rear physical marching across all 7 FIA 2026 Aero Parts
  const uSamples = 16;
  const vSamples = 14;

  const partMetrics = {} as Record<PartId, PartCFDMetrics>;
  const partSurfaceMaps = {} as Record<PartId, PartSurfaceCpMap>;
  const impulsesByK = new Map<number, PanelInfluence[]>();

  const addImpulse = (inf: PanelInfluence) => {
    const k = clamp(Math.round((inf.z - minZ) / dz), 1, nz - 1);
    let list = impulsesByK.get(k);
    if (!list) {
      list = [];
      impulsesByK.set(k, list);
    }
    list.push(inf);
  };

  const kFrontWingStart = Math.floor((-3.02 - minZ) / dz);
  marchFlowSlices(1, kFrontWingStart, impulsesByK);
  let currentMarchedK = kFrontWingStart;

  let sumDownforceN = 0;
  let sumRearAxleMoment = 0;
  // Narrower 2026 tires & wheel scoops reduce open-wheel parasitic drag (~0.37 Cd_base)
  const baseChassisDragN = 0.37 * qInf * REF_AREA;
  let sumDragN = baseChassisDragN;

  let frontWingOutwashScore = 0;
  let floorBoardWakeScore = 0;
  let sidepodInletAreaM2 = 0;
  let sidepodDownwashScore = 0;
  let floorMinGroundClearanceM = 1.0;

  // Physical longitudinal marching sequence (Front -> Rear)
  const sequence: PartId[] = [
    'front_wing',
    'nosecone',
    'floor_boards',
    'sidepods',
    'floor',
    'diffuser',
    'rear_wing',
  ];

  for (const partId of sequence) {
    const part = parts[partId];
    const surf = sampleSplineSurface(part, uSamples, vSamples);
    const meshPanels = realMeshPanels?.[partId];

    // Measure real 3D mesh area ratio relative to control spline so distinct 3D models (FIA vs Ferrari) scale genuinely
    let splineHalfArea = 0;
    const flatSplinePoints: Vec3[] = [];
    let partMinZ = Infinity;
    let partMaxZ = -Infinity;

    for (let iu = 0; iu <= uSamples; iu++) {
      for (let iv = 0; iv <= vSamples; iv++) {
        const pt = surf.points[iu][iv];
        flatSplinePoints.push(pt);
        if (pt.z < partMinZ) partMinZ = pt.z;
        if (pt.z > partMaxZ) partMaxZ = pt.z;
      }
    }

    for (let iu = 0; iu < uSamples; iu++) {
      for (let iv = 0; iv < vSamples; iv++) {
        const p00 = surf.points[iu][iv];
        const p11 = surf.points[iu + 1][iv + 1];
        const p10 = surf.points[iu + 1][iv];
        const p01 = surf.points[iu][iv + 1];
        const d1x = p11.x - p00.x, d1y = p11.y - p00.y, d1z = p11.z - p00.z;
        const d2x = p01.x - p10.x, d2y = p01.y - p10.y, d2z = p01.z - p10.z;
        const crx = d1y * d2z - d1z * d2y;
        const cry = d1z * d2x - d1x * d2z;
        const crz = d1x * d2y - d1y * d2x;
        splineHalfArea += 0.5 * Math.hypot(crx, cry, crz);
      }
    }

    let meshAreaScale = 1.0;
    if (meshPanels && meshPanels.length > 0 && splineHalfArea > 1e-4) {
      let realHalfArea = 0;
      for (const mp of meshPanels) {
        realHalfArea += mp.area;
        if (mp.cz < partMinZ) partMinZ = mp.cz;
        if (mp.cz > partMaxZ) partMaxZ = mp.cz;
      }
      meshAreaScale = clamp(realHalfArea / splineHalfArea, 0.78, 1.28);
    }

    // March CFD field up to the leading edge of this part
    const kPartLead = clamp(Math.floor((partMinZ - minZ) / dz), 1, nz - 1);
    if (kPartLead > currentMarchedK) {
      marchFlowSlices(currentMarchedK + 1, kPartLead, impulsesByK);
      currentMarchedK = kPartLead;
    }

    // Verify FIA 2026 Reference Volume compliance using real deformed 3D mesh points when loaded!
    const legalityPts = realLegalityPoints?.[partId] ?? flatSplinePoints;
    const legality = checkPartLegality(part, legalityPts);

    const upperCp: number[][] = Array.from({ length: uSamples + 1 }, () =>
      new Array<number>(vSamples + 1).fill(0)
    );
    const lowerCp: number[][] = Array.from({ length: uSamples + 1 }, () =>
      new Array<number>(vSamples + 1).fill(0)
    );
    const separation: number[][] = Array.from({ length: uSamples + 1 }, () =>
      new Array<number>(vSamples + 1).fill(0)
    );

    let partDownforceN = 0;
    let partDragN = 0;
    let totalPanelArea = 0;
    let stalledArea = 0;
    let wakeWeightedSum = 0;

    if (partId === 'sidepods') {
      const topInletY = Math.max(part.grid[0][0].y, part.grid[1][0].y);
      const botInletY = part.grid[3][0].y;
      const inX = part.grid[0][0].x;
      const outX = part.grid[2][0].x;
      sidepodInletAreaM2 = Math.max(0, (topInletY - botInletY) * (outX - inX));
    }

    const stripInletH: number[] = [];
    for (let iu = 0; iu <= uSamples; iu++) {
      const pIn = applyRideHeightTransform(surf.points[iu][0], frontRideM, rearRideM);
      stripInletH.push(Math.max(0.01, pIn.y));
    }

    for (let iu = 0; iu < uSamples; iu++) {
      const su = (iu + 0.5) / uSamples;
      for (let iv = 0; iv < vSamples; iv++) {
        const sv = (iv + 0.5) / vSamples;

        const p00 = applyRideHeightTransform(surf.points[iu][iv], frontRideM, rearRideM);
        const p10 = applyRideHeightTransform(surf.points[iu + 1][iv], frontRideM, rearRideM);
        const p01 = applyRideHeightTransform(surf.points[iu][iv + 1], frontRideM, rearRideM);
        const p11 = applyRideHeightTransform(surf.points[iu + 1][iv + 1], frontRideM, rearRideM);

        const cx = 0.25 * (p00.x + p10.x + p01.x + p11.x);
        const cy = 0.25 * (p00.y + p10.y + p01.y + p11.y);
        const cz = 0.25 * (p00.z + p10.z + p01.z + p11.z);

        const d1x = p11.x - p00.x, d1y = p11.y - p00.y, d1z = p11.z - p00.z;
        const d2x = p01.x - p10.x, d2y = p01.y - p10.y, d2z = p01.z - p10.z;
        const crx = d1y * d2z - d1z * d2y;
        const cry = d1z * d2x - d1x * d2z;
        const crz = d1x * d2y - d1y * d2x;
        const quadArea = 0.5 * Math.hypot(crx, cry, crz) * meshAreaScale;
        if (quadArea < 1e-6) continue;

        const tv = surf.tangentsV[iu][iv];
        const n = surf.normals[iu][iv];

        let avgCpUp = 0;
        let avgCpLo = 0;
        let avgSep = 0;

        for (const side of [1, -1] as const) {
          const wx = cx * side;
          const localFlow = sampleCFDField(field, wx, Math.max(0.02, cy), cz);
          const vLocMag = Math.hypot(localFlow.vx, localFlow.vy, localFlow.vz) || vInf;
          const qRatio = clamp((vLocMag * vLocMag) / (vInf * vInf), 0.2, 2.2);
          const wakeEta = clamp(1.0 - 0.60 * localFlow.turb, 0.34, 1.0);

          let cpUpper = 0;
          let cpLower = 0;
          let sep = 0;
          let panelDownforce = 0;
          let panelDrag = 0;

          if (part.role === 'wing') {
            const absNy = Math.abs(n.y);
            const absNx = Math.abs(n.x);

            if (absNx > 0.56 && absNx > absNy) {
              // Vertical Endplate / Footplate Fence panel
              const flareAngle = Math.asin(clamp(tv.x, -0.65, 0.65));
              const localYaw = Math.atan2(localFlow.vx * side, localFlow.vz);
              const effSideAoA = flareAngle - localYaw;

              const sideLoad = clamp(3.3 * effSideAoA, -1.1, 1.1) * wakeEta * qRatio;
              cpUpper = -0.5 * sideLoad;
              cpLower = 0.5 * sideLoad;
              sep =
                Math.abs(effSideAoA) > 0.38
                  ? clamp((Math.abs(effSideAoA) - 0.38) / 0.2, 0, 1)
                  : 0;
              panelDrag =
                quadArea * qInf * (0.026 + 0.30 * effSideAoA * effSideAoA + 0.68 * sep);

              if (partId === 'front_wing' && iu >= uSamples - 4) {
                frontWingOutwashScore += flareAngle * quadArea;
              }

              addImpulse({
                x: wx,
                y: cy,
                z: cz,
                dvx: side * vInf * clamp(0.95 * flareAngle, -0.35, 0.42),
                dvy: 0.035 * vInf,
                dvz: -0.035 * vInf * (1 + 2 * sep),
                dcp: -0.15 * Math.abs(sideLoad),
                dturb: 0.05 + 0.35 * sep,
                radius: 0.18,
              });
            } else {
              // Horizontal / Multi-Element Slotted 2026 Wing Cascade
              const flowPitch = Math.atan2(localFlow.vy, localFlow.vz);
              const chordSlope = Math.asin(clamp(tv.y, -0.82, 0.82));
              const tvNext = surf.tangentsV[iu][Math.min(vSamples, iv + 1)];
              const camberKick = Math.max(0, tvNext.y - tv.y) * 0.65;

              // 2026 FIA Active Aerodynamics X-Mode flap flattening (Art. 3.10.9 & 3.11.6)
              let activeFlapDeltaRad = 0;
              let xModeDragFactor = 1.0;
              if (isXMode) {
                if (partId === 'rear_wing' && cx <= 0.535 && sv > 0.32) {
                  activeFlapDeltaRad = -0.25 * clamp((sv - 0.32) / 0.35, 0, 1);
                  xModeDragFactor = 0.52;
                } else if (partId === 'front_wing' && cx <= 0.580 && sv > 0.38) {
                  activeFlapDeltaRad = -0.195 * clamp((sv - 0.38) / 0.35, 0, 1);
                  xModeDragFactor = 0.62;
                }
              }

              const effAoA = chordSlope + camberKick + activeFlapDeltaRad - flowPitch;
              const groundBoost =
                partId === 'front_wing'
                  ? 1.0 + 0.42 * Math.exp(-Math.max(0.02, cy) / 0.18)
                  : 1.0;

              const stallAngle = partId === 'front_wing' ? 0.45 : 0.56;
              const absAoA = Math.abs(effAoA);
              if (absAoA > stallAngle) {
                sep = clamp((absAoA - stallAngle) / 0.18, 0, 1);
              }

              const liftSlope = partId === 'front_wing' ? 4.58 : 8.65;
              const rawCn =
                liftSlope *
                Math.sin(clamp(effAoA, -0.62, 0.62)) *
                groundBoost *
                wakeEta *
                qRatio *
                (1 - 0.58 * sep);

              cpUpper = clamp(0.42 * rawCn, -0.8, 0.95);
              cpLower = clamp(-0.78 * rawCn, -1.85, 0.65);

              panelDownforce = quadArea * qInf * rawCn * Math.max(0.35, absNy);
              const inducedFactor = (partId === 'rear_wing' ? 0.105 : 0.088) * xModeDragFactor;
              panelDrag =
                quadArea *
                qInf *
                (0.025 * qRatio * xModeDragFactor +
                  inducedFactor * rawCn * rawCn +
                  1.42 * sep * Math.sin(absAoA));

              addImpulse({
                x: wx,
                y: cy,
                z: cz,
                dvx: side * 0.035 * vInf * su,
                dvy: vInf * clamp(0.22 * rawCn, -0.22, 0.44),
                dvz: -vInf * (0.035 * xModeDragFactor + 0.28 * sep),
                dcp: -0.25 * rawCn,
                dturb: 0.035 * xModeDragFactor + 0.52 * sep,
                radius: 0.20,
              });
            }
          } else if (part.role === 'wake_board') {
            // Signature 2026 Wake-Control Floor Boards (Art. 3.5.4, RV-FLOOR-BOARD)
            // Conditions turbulent front-tire wake before it hits the sidepods & floor edge!
            const vaneFlare = Math.asin(clamp(tv.x, -0.65, 0.65));
            const localYaw = Math.atan2(localFlow.vx * side, localFlow.vz);
            const effVaneAngle = vaneFlare - localYaw;

            if (Math.abs(effVaneAngle) > 0.42) {
              sep = clamp((Math.abs(effVaneAngle) - 0.42) / 0.18, 0, 1);
            }

            const vaneLoad = clamp(3.6 * effVaneAngle, -1.15, 1.15) * qRatio * (1 - 0.55 * sep);
            cpUpper = -0.45 * vaneLoad;
            cpLower = 0.45 * vaneLoad;

            // Footplate horizontal shelf also generates localized vortex downforce
            const footLift = iu === 0 ? 0.38 * qRatio * wakeEta : 0.08 * qRatio;
            panelDownforce = quadArea * qInf * footLift;
            panelDrag =
              quadArea * qInf * (0.024 + 0.26 * effVaneAngle * effVaneAngle + 0.65 * sep);

            floorBoardWakeScore += (0.08 + Math.abs(vaneFlare)) * (1 - sep) * quadArea;

            // Actively scrubs upstream front-tire turbulence (-dturb) and redirects flow cleanly!
            addImpulse({
              x: wx,
              y: cy,
              z: cz,
              dvx: side * vInf * clamp(0.85 * vaneFlare, -0.30, 0.35),
              dvy: -0.03 * vInf,
              dvz: 0.03 * vInf * (1 - sep),
              dcp: -0.18 * Math.abs(vaneLoad),
              dturb: sep > 0.25 ? 0.32 * sep : -0.14 * (1 - sep),
              radius: 0.21,
            });
          } else if (part.role === 'ground_effect') {
            // 2026 Flatter Step-Plane Underbody Floor & Bib Physics
            const hLocal = Math.max(0.004, cy);
            if (hLocal < floorMinGroundClearanceM) {
              floorMinGroundClearanceM = hLocal;
            }
            const hInlet = stripInletH[iu];
            const pEdge = applyRideHeightTransform(
              surf.points[uSamples][iv],
              frontRideM,
              rearRideM
            );
            const hEdge = Math.max(0.005, pEdge.y);

            // Ground choking stall if floor bottoms out (< 22mm)
            if (hLocal < 0.022) {
              sep = clamp((0.022 - hLocal) / 0.015, 0, 1);
            }

            const edgeLeakPenalty =
              hEdge > 0.072 ? clamp(1.0 - (hEdge - 0.072) * 3.8, 0.55, 1.0) : 1.04;

            const venturiRatio = clamp(
              (hInlet - hLocal) / (hLocal + 0.048) + 0.082 / (hLocal + 0.055),
              -0.15,
              1.30
            );
            const accel =
              1.0 + 0.56 * venturiRatio * edgeLeakPenalty * wakeEta * (1.0 - 0.8 * sep);

            cpLower = clamp(1.0 - accel * accel * qRatio, -1.80, 0.35);
            cpUpper = clamp(-0.08 * qRatio + 0.22 * Math.max(0, -tv.y), -0.45, 0.35);

            const netSuction = cpUpper - cpLower;
            panelDownforce = quadArea * qInf * netSuction * 0.90;
            panelDrag =
              quadArea * qInf * (0.014 * qRatio + 0.022 * Math.max(0, netSuction) + 0.36 * sep);

            addImpulse({
              x: wx,
              y: Math.max(0.02, cy),
              z: cz,
              dvx: side * (iu >= uSamples - 2 ? 0.045 * vInf : -0.02 * vInf),
              dvy: -0.02 * vInf,
              dvz: vInf * clamp((accel - 1.0) * 0.32, -0.15, 0.35),
              dcp: cpLower * 0.45,
              dturb: 0.018 + 0.48 * sep,
              radius: 0.19,
            });
          } else if (part.role === 'diffuser') {
            // 2026 Beainless Rear Underbody Diffuser & Boat-Tail
            const expAngle = Math.atan2(tv.y, Math.max(0.1, tv.z));
            const upperDeckFlow = sampleCFDField(field, wx, cy + 0.18, cz);
            const downwashBonus = clamp(-upperDeckFlow.vy / vInf, -0.05, 0.22);

            const critAngle = 0.255 + 0.32 * Math.max(0, downwashBonus);
            if (expAngle > critAngle) {
              sep = clamp((expAngle - critAngle) / 0.14, 0, 1);
            } else if (expAngle < 0.015) {
              sep = 0.14;
            }

            const optRatio = Math.sin(clamp(expAngle, -0.1, 0.38)) * 4.7;
            const suction =
              (0.44 + optRatio + 1.45 * Math.max(0, downwashBonus)) *
              wakeEta *
              qRatio *
              (1.0 - 0.68 * sep);

            cpLower = clamp(-suction, -1.75, 0.25);
            cpUpper = clamp(-0.12 - 0.4 * Math.max(0, downwashBonus), -0.55, 0.25);

            const absNy = Math.max(0.35, Math.abs(n.y));
            panelDownforce = quadArea * qInf * (cpUpper - cpLower) * absNy * 1.22;
            panelDrag =
              quadArea *
              qInf *
              (0.025 +
                0.085 * suction * suction * 0.25 +
                0.92 * sep * Math.sin(Math.max(0, expAngle)));

            addImpulse({
              x: wx,
              y: cy,
              z: cz,
              dvx: 0,
              dvy: vInf * clamp(0.36 * Math.sin(expAngle) * (1 - 0.5 * sep), -0.08, 0.32),
              dvz: -vInf * (0.045 + 0.26 * sep),
              dcp: cpLower * 0.35,
              dturb: 0.045 + 0.55 * sep,
              radius: 0.22,
            });
          } else {
            // Body Fairing (Nosecone & Sidepods / Coke-Bottle)
            const nWorldX = n.x * side;
            const vDotN =
              (localFlow.vx * nWorldX + localFlow.vy * n.y + localFlow.vz * n.z) / vLocMag;
            const impact = clamp(-vDotN, -0.8, 0.95);

            const slopeMag = Math.hypot(tv.x, tv.y);
            if (slopeMag > 0.64) {
              sep = clamp((slopeMag - 0.64) / 0.25, 0, 1);
            }

            cpUpper = clamp(0.85 * impact - 0.22 * (1 - Math.abs(impact)), -0.65, 0.92);
            cpLower = clamp(-0.18 * qRatio, -0.55, 0.25);

            if (partId === 'sidepods') {
              if (iu <= 2 && tv.y < 0) {
                sidepodDownwashScore += -tv.y * quadArea;
              }
              const undercutClearance = clamp(0.70 - cx, 0, 0.35);
              addImpulse({
                x: side * (cx + 0.05),
                y: Math.max(0.05, cy - 0.05),
                z: cz,
                dvx: side * vInf * clamp(tv.x * 0.35, -0.22, 0.22),
                dvy: vInf * clamp(tv.y * 0.48, -0.28, 0.18),
                dvz: vInf * (0.06 * undercutClearance - 0.11 * sep),
                dcp: cpUpper * 0.28,
                dturb: Math.max(-0.06 * undercutClearance, 0.025 + 0.35 * sep),
                radius: 0.22,
              });
            } else {
              addImpulse({
                x: wx,
                y: cy,
                z: cz,
                dvx: side * 0.055 * vInf,
                dvy: vInf * clamp(tv.y * 0.32, -0.1, 0.24),
                dvz: 0.02 * vInf,
                dcp: cpUpper * 0.25,
                dturb: 0.02 + 0.25 * sep,
                radius: 0.16,
              });
            }

            panelDownforce = quadArea * qInf * (cpUpper * n.y) * 0.52;
            panelDrag =
              quadArea *
              qInf *
              (0.020 + 0.38 * Math.max(0, impact) * Math.max(0, impact) + 0.52 * sep);
          }

          partDownforceN += panelDownforce;
          partDragN += Math.max(0, panelDrag);
          totalPanelArea += quadArea;
          if (sep > 0.35) {
            stalledArea += quadArea;
          }
          wakeWeightedSum += localFlow.turb * quadArea;

          avgCpUp += cpUpper * 0.5;
          avgCpLo += cpLower * 0.5;
          avgSep += sep * 0.5;

          sumDownforceN += panelDownforce;
          sumRearAxleMoment += panelDownforce * (cz - FRONT_AXLE_Z);
          sumDragN += Math.max(0, panelDrag);
        }

        upperCp[iu][iv] = avgCpUp;
        lowerCp[iu][iv] = avgCpLo;
        separation[iu][iv] = avgSep;
        upperCp[iu + 1][iv] = avgCpUp;
        lowerCp[iu + 1][iv] = avgCpLo;
        separation[iu + 1][iv] = avgSep;
        upperCp[iu][iv + 1] = avgCpUp;
        lowerCp[iu][iv + 1] = avgCpLo;
        separation[iu][iv + 1] = avgSep;
        upperCp[iu + 1][iv + 1] = avgCpUp;
        lowerCp[iu + 1][iv + 1] = avgCpLo;
        separation[iu + 1][iv + 1] = avgSep;
      }
    }

    // Also stamp spatial impulses from real deformed 3D mesh macro-panels when loaded so streamlines hug the true CAD contour!
    if (meshPanels && meshPanels.length > 0) {
      const step = Math.max(1, Math.floor(meshPanels.length / 45));
      for (let idx = 0; idx < meshPanels.length; idx += step) {
        const mp = meshPanels[idx];
        const pRide = applyRideHeightTransform(
          { x: mp.cx, y: mp.cy, z: mp.cz },
          frontRideM,
          rearRideM
        );
        for (const side of [1, -1] as const) {
          addImpulse({
            x: pRide.x * side,
            y: Math.max(0.02, pRide.y),
            z: pRide.z,
            dvx: side * mp.nx * 0.035 * vInf,
            dvy: mp.ny * 0.035 * vInf,
            dvz: 0,
            dcp: 0,
            dturb: 0,
            radius: 0.14,
          });
        }
      }
    }

    // Cooling louver penalty if 2026 sidepod radiator inlet is pinched below 750 cm^2
    if (partId === 'sidepods' && sidepodInletAreaM2 < 0.075) {
      const pinchDeficit = (0.075 - sidepodInletAreaM2) / 0.075;
      partDragN += qInf * REF_AREA * 0.14 * pinchDeficit;
      sumDragN += qInf * REF_AREA * 0.14 * pinchDeficit;
    }

    const clPart = partDownforceN / (qInf * REF_AREA);
    const cdPart = partDragN / (qInf * REF_AREA);
    partMetrics[partId] = {
      partId,
      name: part.shortName,
      downforceN: Math.round(partDownforceN),
      dragN: Math.round(partDragN),
      cl: Math.round(clPart * 1000) / 1000,
      cd: Math.round(cdPart * 1000) / 1000,
      ldRatio: cdPart > 0.001 ? Math.round((clPart / cdPart) * 100) / 100 : 0,
      stalledAreaPct:
        totalPanelArea > 0 ? Math.round((stalledArea / totalPanelArea) * 1000) / 10 : 0,
      wakeExposurePct:
        totalPanelArea > 0 ? Math.round((wakeWeightedSum / totalPanelArea) * 1000) / 10 : 0,
      isLegal: legality.isLegal,
      minClearanceMm: legality.minClearanceMm,
    };

    partSurfaceMaps[partId] = { upperCp, lowerCp, separation };

    const kPartTrail = clamp(Math.ceil((partMaxZ - minZ) / dz) + 1, 1, nz - 1);
    if (kPartTrail > currentMarchedK) {
      marchFlowSlices(currentMarchedK + 1, kPartTrail, impulsesByK);
      currentMarchedK = kPartTrail;
    }
  }

  if (currentMarchedK < nz - 1) {
    marchFlowSlices(currentMarchedK + 1, nz - 1, impulsesByK);
  }

  // 3. Global 2026 F1 Vehicle Performance Metrics
  const cl = sumDownforceN / (qInf * REF_AREA);
  const cd = sumDragN / (qInf * REF_AREA);
  const ldRatio = cd > 0.01 ? cl / cd : 0;

  const rearShare =
    Math.abs(sumDownforceN) > 50 ? sumRearAxleMoment / (sumDownforceN * WHEELBASE) : 0.54;
  const copFrontPct = clamp((1.0 - rearShare) * 100, 10, 90);

  // 2026 PU (~750 kW = 350kW MGU-K + ~400kW ICE) straight-line terminal speed
  const effectiveCdA = Math.max(0.38, cd * REF_AREA);
  const topSpeedMs = Math.cbrt((750000 * 0.91) / (0.5 * AIR_DENSITY * effectiveCdA));
  const topSpeedEstKmh = Math.round(topSpeedMs * 3.6 * 10) / 10;

  // Sustained cornering G at 240 km/h using 2026 FIA Art. 4.2 minimum mass (768 kg incl. tires)
  const q240 = 0.5 * AIR_DENSITY * 66.67 * 66.67;
  const df240 = cl * q240 * REF_AREA;
  const massKg = 768;
  const weightN = massKg * 9.81;
  const balancePenalty = Math.max(0.72, 1.0 - Math.abs(copFrontPct - 45.8) * 0.014);
  const normalLoadN = Math.max(weightN * 0.5, weightN + df240);
  const highSpeedCornerG =
    Math.round(((normalLoadN * 1.60 * balancePenalty) / weightN) * 100) / 100;

  const allLegal = PART_ORDER.every((id) => partMetrics[id].isLegal);

  // 4. Automated 2026 FIA Engineering Diagnostics & Improvement Advisor
  const diagnostics: AeroDiagnostic[] = [];

  if (isXMode) {
    diagnostics.push({
      id: 'active_aero_xmode',
      severity: 'info',
      title: '2026 Active Aero: X-Mode Engaged (Straight-Line)',
      detail: `Front & Rear movable flaps flattened per FIA Art. 3.10.9 & 3.11.6. Projected top speed: ${topSpeedEstKmh.toFixed(
        0
      )} km/h.`,
      suggestion:
        'Verify that X-Mode CoP stays within 43%–48% Front for stable 340+ km/h braking zones, then switch back to Z-Mode for cornering grip.',
    });
  }

  for (const id of PART_ORDER) {
    const m = partMetrics[id];
    if (!m.isLegal) {
      diagnostics.push({
        id: `legality_${id}`,
        severity: 'critical',
        partId: id,
        title: `${m.name}: FIA 2026 Volume Violation`,
        detail: `Bodywork exceeds ${parts[id].articleRef} by ${Math.abs(
          m.minClearanceMm
        ).toFixed(1)} mm.`,
        suggestion:
          'Enable "Clamp Bending to FIA Legality Box" or pull red control nodes back inside the Appendix 1 wireframe volume.',
      });
    }
    if (m.stalledAreaPct > 12) {
      diagnostics.push({
        id: `stall_${id}`,
        severity: m.stalledAreaPct > 28 ? 'critical' : 'warning',
        partId: id,
        title: `${m.name}: Flow Separation (${m.stalledAreaPct.toFixed(0)}% stalled)`,
        detail:
          id === 'floor'
            ? `Step-plane clearance (${Math.round(
                floorMinGroundClearanceM * 1000
              )} mm) is choking the underbody boundary layer.`
            : id === 'diffuser'
            ? 'Diffuser ramp kicks up too steeply for the beamless 2026 rear end, detaching flow.'
            : `Local angle of attack exceeds stall limit, shedding high-drag turbulent wake.`,
        suggestion:
          id === 'floor'
            ? 'Raise the lowest Floor nodes above 24 mm or increase Wind Tunnel Ride Height.'
            : id === 'diffuser'
            ? 'Lower the Diffuser trailing kick slightly or steepen Sidepod Coanda downwash to energize the diffuser roof.'
            : 'Reduce trailing flap camber or smooth abrupt spanwise bends.',
      });
    }
  }

  if (copFrontPct > 48.0) {
    diagnostics.push({
      id: 'cop_oversteer',
      severity: copFrontPct > 51.5 ? 'critical' : 'warning',
      title: `Aero Balance Too Forward (${copFrontPct.toFixed(1)}% Front)`,
      detail:
        'Excessive front Center of Pressure causes high-speed entry oversteer and rear instability under braking.',
      suggestion:
        'Increase Rear Wing / Diffuser load, or flatten the Front Wing trailing flap to bring CoP into 44.0%–47.5%.',
    });
  } else if (copFrontPct < 43.5) {
    diagnostics.push({
      id: 'cop_understeer',
      severity: copFrontPct < 40.0 ? 'critical' : 'warning',
      title: `Aero Balance Too Rearward (${copFrontPct.toFixed(1)}% Front)`,
      detail:
        'Rear-heavy Center of Pressure causes high-speed understeer through fast sweepers.',
      suggestion:
        'Steepen Front Wing flap camber or lower forward Floor bib/tunnel nodes toward ~45.8% Front.',
    });
  } else {
    diagnostics.push({
      id: 'cop_optimal',
      severity: 'positive',
      title: `Balanced 2026 Aero Window (${copFrontPct.toFixed(1)}% Front)`,
      detail:
        'Center of Pressure sits squarely inside the neutral 44.0%–47.5% FIA 2026 weight-distribution window.',
      suggestion: 'Maintain this front/rear balance while optimizing L/D in both Z-Mode and X-Mode.',
    });
  }

  if (partMetrics.floor.wakeExposurePct > 21 && floorBoardWakeScore < 0.014) {
    diagnostics.push({
      id: 'fb_wake',
      severity: 'info',
      partId: 'floor_boards',
      title: 'Front Tire Wake Hitting Floor Edge',
      detail: `Main Floor sees ${partMetrics.floor.wakeExposurePct.toFixed(
        1
      )}% tire wake turbulence.`,
      suggestion:
        'Sculpt the 2026 Floor Boards (3) trailing edges or flare Front Wing endplates (1) to deflect tire squirt away from the floor.',
    });
  } else if (floorBoardWakeScore >= 0.018 || frontWingOutwashScore >= 0.010) {
    diagnostics.push({
      id: 'wake_control_good',
      severity: 'positive',
      partId: 'floor_boards',
      title: 'Effective 2026 Tire-Wake Conditioning',
      detail:
        'Front Wing footplates and 2026 Floor Boards are keeping turbulent front-wheel wake off the sidepod undercut and floor edge.',
      suggestion: 'Capitalize on this clean airflow by carving a tighter Sidepod undercut.',
    });
  }

  if (sidepodInletAreaM2 < 0.075) {
    diagnostics.push({
      id: 'sidepod_cooling',
      severity: 'warning',
      partId: 'sidepods',
      title: 'Pinched Sidepod Radiator Intake',
      detail: `Capture area (${Math.round(
        sidepodInletAreaM2 * 10000
      )} cm²) is below the 750 cm² 2026 PU/ERS cooling minimum, adding louver drag.`,
      suggestion:
        'Increase the vertical opening between Sidepod upper shoulder (u=1) and lower undercut lip (u=3) at the leading edge.',
    });
  } else if (sidepodDownwashScore > 0.055) {
    diagnostics.push({
      id: 'sidepod_downwash',
      severity: 'positive',
      partId: 'sidepods',
      title: 'Strong Coke-Bottle & Coanda Downwash',
      detail:
        'Tapered RV-EC sidepod ramp is energizing airflow over the beamless 2026 diffuser roof.',
      suggestion: 'Pair with a crisp Diffuser expansion ramp for low-drag rear suction.',
    });
  }

  return {
    timestamp: performance.now(),
    settings: { ...settings },
    totalDownforceN: Math.round(sumDownforceN),
    totalDragN: Math.round(sumDragN),
    cl: Math.round(cl * 1000) / 1000,
    cd: Math.round(cd * 1000) / 1000,
    ldRatio: Math.round(ldRatio * 100) / 100,
    copFrontPct: Math.round(copFrontPct * 10) / 10,
    topSpeedEstKmh,
    highSpeedCornerG,
    allLegal,
    partMetrics,
    partSurfaceMaps,
    diagnostics,
    field,
  };
}
