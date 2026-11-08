import {
  AeroPartData,
  CageV2,
  Hardpoint,
  LegalityBox,
  LegalityCheckResult,
  NodeIndex,
  PartId,
  PartParamSlider,
  ProceduralElementConfig,
  ProceduralFixtureConfig,
  SculptHandleLevel,
  SeamLink,
  Vec3,
  WheelStanceSettings,
} from '../types/aero';

export const PART_ORDER: PartId[] = [
  'front_wing',
  'nosecone',
  'front_suspension',
  'monocoque',
  'floor_boards',
  'floor',
  'sidepods',
  'engine_cover',
  'rear_suspension',
  'diffuser',
  'rear_wing',
];

export const DEFAULT_WHEEL_STANCE: WheelStanceSettings = {
  frontTrackOffsetMm: 0,
  rearTrackOffsetMm: 0,
  frontCamberDeg: -3.0,
  rearCamberDeg: -2.0,
  frontToeDeg: 0.15,
  rimCoverDishMm: 0,
};

/**
 * Official 2026 FIA Technical Regulations (Art. 2.6 - 2.8) Datum Constants:
 * - X_F = 0 mm: Front Wheel Centerline Plane (maps to World Z = -1.700 m)
 * - X_R = 0 mm (X_F = 3400 mm): Rear Wheel Centerline Plane (maps to World Z = +1.700 m)
 * - Y_FIA = 0 mm: Car Symmetry Plane (+Y_FIA = Starboard / Driver Right -> World +X)
 * - Z_FIA = 0 mm: FIA Reference Plane (+30.8 mm above Wind Tunnel Rolling Road Y = 0)
 */
export const FIA_WHEELBASE_MM = 3400.0;
export const FIA_TIRE_CONTACT_Z_MM = -30.8;
export const WORLD_FRONT_AXLE_Z = -1.70;
export const WORLD_REAR_AXLE_Z = 1.70;

export function fiaMmToWorld(xF: number, yFia: number, zFia: number): Vec3 {
  return {
    x: yFia * 0.001,
    y: (zFia - FIA_TIRE_CONTACT_Z_MM) * 0.001,
    z: (xF - 1700.0) * 0.001,
  };
}

export function worldToFiaMm(p: Vec3): { xF: number; yFia: number; zFia: number } {
  return {
    xF: p.z * 1000.0 + 1700.0,
    yFia: p.x * 1000.0,
    zFia: p.y * 1000.0 + FIA_TIRE_CONTACT_Z_MM,
  };
}

/**
 * Shared boundary control node links between adjacent components.
 * When a node in nodesA is edited, the corresponding node in nodesB is updated identically.
 */
export const SEAM_LINKS: SeamLink[] = [
  {
    id: 'seam_nose_monocoque',
    label: 'Nosecone to Monocoque Bulkhead',
    partA: 'nosecone',
    partB: 'monocoque',
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    type: 'shared_boundary',
  },
  {
    id: 'seam_monocoque_engine_cover',
    label: 'Monocoque Cockpit Rear to Engine Cover',
    partA: 'monocoque',
    partB: 'engine_cover',
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    type: 'shared_boundary',
  },
  {
    id: 'seam_floor_diffuser',
    label: 'Underbody Floor to Diffuser Ramp Kickline',
    partA: 'floor',
    partB: 'diffuser',
    nodesA: [{ u: 0, v: 4 }, { u: 1, v: 4 }, { u: 2, v: 4 }, { u: 3, v: 4 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 3, v: 0 }],
    type: 'shared_boundary',
  },
  {
    id: 'seam_sidepods_engine_cover',
    label: 'Sidepod Shoulder to Engine Cover Flank',
    partA: 'sidepods',
    partB: 'engine_cover',
    nodesA: [{ u: 0, v: 1 }, { u: 0, v: 2 }],
    nodesB: [{ u: 2, v: 0 }, { u: 2, v: 1 }],
    type: 'shared_boundary',
  },
  {
    id: 'seam_floor_boards_floor',
    label: 'Floor Board Footplate to Floor Edge',
    partA: 'floor_boards',
    partB: 'floor',
    nodesA: [{ u: 0, v: 1 }, { u: 0, v: 2 }],
    nodesB: [{ u: 3, v: 0 }, { u: 3, v: 1 }],
    type: 'shared_boundary',
  },
];

/**
 * Homologated 2026 chassis, crash structure & suspension hardpoints.
 */
export const HARDPOINTS_2026: Hardpoint[] = [
  {
    id: 'front_axle_fl',
    label: 'Front Left Axle Hub',
    position: fiaMmToWorld(0, -820, 330),
    locked: true,
    associatedParts: ['front_suspension'],
  },
  {
    id: 'front_axle_fr',
    label: 'Front Right Axle Hub',
    position: fiaMmToWorld(0, 820, 330),
    locked: true,
    associatedParts: ['front_suspension'],
  },
  {
    id: 'rear_axle_rl',
    label: 'Rear Left Axle Hub',
    position: fiaMmToWorld(3400, -820, 330),
    locked: true,
    associatedParts: ['rear_suspension'],
  },
  {
    id: 'rear_axle_rr',
    label: 'Rear Right Axle Hub',
    position: fiaMmToWorld(3400, 820, 330),
    locked: true,
    associatedParts: ['rear_suspension'],
  },
  {
    id: 'survival_cell_front',
    label: 'Front Bulkhead Section A-A',
    position: fiaMmToWorld(0, 0, 280),
    locked: true,
    associatedParts: ['nosecone', 'monocoque'],
  },
  {
    id: 'survival_cell_rear',
    label: 'Survival Cell Rear Bulkhead',
    position: fiaMmToWorld(1550, 0, 750),
    locked: true,
    associatedParts: ['monocoque', 'engine_cover'],
  },
  {
    id: 'halo_apex',
    label: 'Titanium Halo Forward Ring Apex',
    position: fiaMmToWorld(580, 0, 640),
    locked: true,
    associatedParts: ['monocoque'],
  },
  {
    id: 'halo_mount_l',
    label: 'Halo Left Rear Mounting Anchor',
    position: fiaMmToWorld(1520, -220, 740),
    locked: true,
    associatedParts: ['monocoque'],
  },
  {
    id: 'halo_mount_r',
    label: 'Halo Right Rear Mounting Anchor',
    position: fiaMmToWorld(1520, 220, 740),
    locked: true,
    associatedParts: ['monocoque'],
  },
  {
    id: 'cockpit_rear_bulkhead',
    label: 'Cockpit Roll-Hoop Bulkhead',
    position: fiaMmToWorld(1550, 0, 860),
    locked: true,
    associatedParts: ['monocoque', 'engine_cover'],
  },
  {
    id: 'exhaust_centerline',
    label: 'Exhaust Tailpipe Centerline Outlet',
    position: fiaMmToWorld(3620, 0, 340),
    locked: true,
    associatedParts: ['engine_cover'],
  },
];

/**
 * Default procedural fixtures (wheels, halo, mirrors, helmet, cockpit, exhaust).
 */
export const DEFAULT_FIXTURES: ProceduralFixtureConfig[] = [
  { id: 'wheel_fl', label: 'Front Left Wheel & Rim', category: 'wheels', visible: true },
  { id: 'wheel_fr', label: 'Front Right Wheel & Rim', category: 'wheels', visible: true },
  { id: 'wheel_rl', label: 'Rear Left Wheel & Rim', category: 'wheels', visible: true },
  { id: 'wheel_rr', label: 'Rear Right Wheel & Rim', category: 'wheels', visible: true },
  { id: 'halo_structure', label: 'Titanium Halo Structure', category: 'safety', visible: true },
  { id: 'mirror_l', label: 'Left Rearview Mirror', category: 'cockpit', visible: true },
  { id: 'mirror_r', label: 'Right Rearview Mirror', category: 'cockpit', visible: true },
  { id: 'driver_helmet', label: 'Driver Helmet & Visor', category: 'cockpit', visible: true },
  { id: 'cockpit_interior', label: 'Cockpit Seat & Steering Wheel', category: 'cockpit', visible: true },
  { id: 'exhaust_tailpipe', label: 'Central Exhaust Tailpipe', category: 'powertrain', visible: true },
];

function makeFiaBox(opts: {
  id: string;
  label: string;
  xFFront: number;
  xFRear: number;
  yMinFront: number;
  yMaxFront: number;
  yMinRear?: number;
  yMaxRear?: number;
  zMinFront: number;
  zMaxFront: number;
  zMinRear?: number;
  zMaxRear?: number;
  wheelCutoutFia?: { xF: number; zFia: number; radiusMm: number; yMinMm: number };
}): LegalityBox {
  const fMin = fiaMmToWorld(opts.xFFront, opts.yMinFront, opts.zMinFront);
  const fMax = fiaMmToWorld(opts.xFFront, opts.yMaxFront, opts.zMaxFront);
  const rMin = fiaMmToWorld(
    opts.xFRear,
    opts.yMinRear ?? opts.yMinFront,
    opts.zMinRear ?? opts.zMinFront
  );
  const rMax = fiaMmToWorld(
    opts.xFRear,
    opts.yMaxRear ?? opts.yMaxFront,
    opts.zMaxRear ?? opts.zMaxFront
  );

  let wheelCutout: LegalityBox['wheelCutout'] | undefined;
  if (opts.wheelCutoutFia) {
    const wc = fiaMmToWorld(
      opts.wheelCutoutFia.xF,
      opts.wheelCutoutFia.yMinMm,
      opts.wheelCutoutFia.zFia
    );
    wheelCutout = {
      axleZ: wc.z,
      axleY: wc.y,
      radius: opts.wheelCutoutFia.radiusMm * 0.001,
      minX: wc.x,
    };
  }

  return {
    id: opts.id,
    label: opts.label,
    minX: Math.min(fMin.x, rMin.x),
    maxX: Math.max(fMax.x, rMax.x),
    minXFront: fMin.x,
    maxXFront: fMax.x,
    minXRear: rMin.x,
    maxXRear: rMax.x,
    minZ: fMin.z,
    maxZ: rMax.z,
    minYFront: fMin.y,
    maxYFront: fMax.y,
    minYRear: rMin.y,
    maxYRear: rMax.y,
    wheelCutout,
  };
}

/**
 * Compute interpolated lateral limits [minX, maxX] of an FIA LegalityBox at longitudinal coordinate z.
 */
export function getBoxLateralBoundsAtZ(
  box: LegalityBox,
  z: number
): { minX: number; maxX: number } {
  const spanZ = Math.max(1e-5, box.maxZ - box.minZ);
  const t = Math.max(0, Math.min(1, (z - box.minZ) / spanZ));
  const x0f = box.minXFront ?? box.minX;
  const x1f = box.maxXFront ?? box.maxX;
  const x0r = box.minXRear ?? box.minX;
  const x1r = box.maxXRear ?? box.maxX;
  return {
    minX: x0f + (x0r - x0f) * t,
    maxX: x1f + (x1r - x1f) * t,
  };
}

/**
 * Compute interpolated vertical limits [minY, maxY] of an FIA LegalityBox at longitudinal coordinate z.
 */
export function getBoxVerticalBoundsAtZ(
  box: LegalityBox,
  z: number
): { minY: number; maxY: number } {
  const spanZ = Math.max(1e-5, box.maxZ - box.minZ);
  const t = Math.max(0, Math.min(1, (z - box.minZ) / spanZ));
  return {
    minY: box.minYFront + (box.minYRear - box.minYFront) * t,
    maxY: box.maxYFront + (box.maxYRear - box.maxYFront) * t,
  };
}

/**
 * Signed inside margin of point p (in +X half-space, using |p.x|) relative to a single LegalityBox.
 * Positive = inside box (meters to closest wall); Negative = outside box (meters of violation).
 */
export function signedMarginInBox(p: Vec3, box: LegalityBox): number {
  const ax = Math.abs(p.x);
  const { minX, maxX } = getBoxLateralBoundsAtZ(box, p.z);
  const { minY, maxY } = getBoxVerticalBoundsAtZ(box, p.z);

  const dxMin = ax - minX;
  const dxMax = maxX - ax;
  const dyMin = p.y - minY;
  const dyMax = maxY - p.y;
  const dzMin = p.z - box.minZ;
  const dzMax = box.maxZ - p.z;

  // Optional wheel exclusion cylinder check (e.g. D=825mm front tire cutout in RV-FWEP)
  let wheelClearMargin = Infinity;
  if (box.wheelCutout && ax >= box.wheelCutout.minX) {
    const distToAxle = Math.hypot(p.y - box.wheelCutout.axleY, p.z - box.wheelCutout.axleZ);
    wheelClearMargin = distToAxle - box.wheelCutout.radius;
  }

  if (
    dxMin >= 0 &&
    dxMax >= 0 &&
    dyMin >= 0 &&
    dyMax >= 0 &&
    dzMin >= 0 &&
    dzMax >= 0 &&
    wheelClearMargin >= 0
  ) {
    const xMargin = minX <= 0.0005 ? dxMax : Math.min(dxMin, dxMax);
    return Math.min(xMargin, dyMin, dyMax, dzMin, dzMax, wheelClearMargin);
  }

  // Outside box (or inside wheel exclusion cylinder): compute Euclidean violation distance
  const cz = Math.max(box.minZ, Math.min(box.maxZ, p.z));
  const latAtCz = getBoxLateralBoundsAtZ(box, cz);
  const vertAtCz = getBoxVerticalBoundsAtZ(box, cz);
  let cx = Math.max(latAtCz.minX, Math.min(latAtCz.maxX, ax));
  let cy = Math.max(vertAtCz.minY, Math.min(vertAtCz.maxY, p.y));
  let czz = cz;

  if (box.wheelCutout && cx >= box.wheelCutout.minX) {
    const dy = cy - box.wheelCutout.axleY;
    const dz = czz - box.wheelCutout.axleZ;
    const d = Math.hypot(dy, dz);
    if (d < box.wheelCutout.radius) {
      if (d > 1e-5) {
        const s = box.wheelCutout.radius / d;
        cy = box.wheelCutout.axleY + dy * s;
        czz = box.wheelCutout.axleZ + dz * s;
      } else {
        czz = box.wheelCutout.axleZ - box.wheelCutout.radius;
      }
    }
  }

  const ex = ax - cx;
  const ey = p.y - cy;
  const ez = p.z - czz;
  return -Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * Signed margin of point p against the UNION of FIA LegalityBoxes for a part.
 * A point is legal if it lies inside AT LEAST ONE box in the union (margin >= -0.001m).
 */
export function signedMarginInUnion(p: Vec3, boxes: LegalityBox[]): number {
  let best = -Infinity;
  for (const box of boxes) {
    const m = signedMarginInBox(p, box);
    if (m > best) best = m;
  }
  return best;
}

/**
 * Clamp a point p on the +X half-car into the nearest valid location inside the union of FIA LegalityBoxes.
 */
export function clampPointToLegalityBoxes(
  p: Vec3,
  boxes: LegalityBox[],
  lockCenterline = false
): Vec3 {
  const target: Vec3 = {
    x: lockCenterline ? 0 : Math.max(0, p.x),
    y: p.y,
    z: p.z,
  };

  if (signedMarginInUnion(target, boxes) >= 0) {
    return target;
  }

  let bestPoint = target;
  let bestDistSq = Infinity;

  for (const box of boxes) {
    let cz = Math.max(box.minZ, Math.min(box.maxZ, target.z));
    let lat = getBoxLateralBoundsAtZ(box, cz);
    if (lockCenterline && lat.minX > 0.001) continue;

    let cx = lockCenterline ? 0 : Math.max(lat.minX, Math.min(lat.maxX, target.x));
    let vert = getBoxVerticalBoundsAtZ(box, cz);
    let cy = Math.max(vert.minY, Math.min(vert.maxY, target.y));

    if (box.wheelCutout && cx >= box.wheelCutout.minX) {
      const dy = cy - box.wheelCutout.axleY;
      const dz = cz - box.wheelCutout.axleZ;
      const d = Math.hypot(dy, dz);
      if (d < box.wheelCutout.radius) {
        if (d > 1e-5) {
          const s = (box.wheelCutout.radius + 0.001) / d;
          cy = box.wheelCutout.axleY + dy * s;
          cz = Math.max(box.minZ, Math.min(box.maxZ, box.wheelCutout.axleZ + dz * s));
        } else {
          cz = box.wheelCutout.axleZ - box.wheelCutout.radius - 0.001;
        }
        lat = getBoxLateralBoundsAtZ(box, cz);
        vert = getBoxVerticalBoundsAtZ(box, cz);
        cx = lockCenterline ? 0 : Math.max(lat.minX, Math.min(lat.maxX, cx));
        cy = Math.max(vert.minY, Math.min(vert.maxY, cy));
      }
    }

    const dx = target.x - cx;
    const dy = target.y - cy;
    const dz = target.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestPoint = { x: cx, y: cy, z: cz };
    }
  }

  return bestPoint;
}

/**
 * Evaluate FIA 2026 scrutineering compliance for a part's control grid and sampled 3D mesh vertices.
 */
export function checkPartLegality(
  part: AeroPartData,
  sampledSurfacePoints?: Vec3[]
): LegalityCheckResult {
  const violatingNodes: NodeIndex[] = [];
  let minMarginM = Infinity;

  for (let u = 0; u < part.cols; u++) {
    for (let v = 0; v < part.rows; v++) {
      const margin = signedMarginInUnion(part.grid[u][v], part.legalityBoxes);
      if (margin < minMarginM) minMarginM = margin;
      if (margin < -0.0015) {
        violatingNodes.push({ u, v });
      }
    }
  }

  let outOfBoundsMeshVertices = 0;
  if (sampledSurfacePoints && sampledSurfacePoints.length > 0) {
    const skinTol = 0.006; // 6mm CAD tessellation / fillet tolerance
    for (const pt of sampledSurfacePoints) {
      const margin = signedMarginInUnion(pt, part.legalityBoxes);
      if (margin + skinTol < minMarginM) {
        minMarginM = margin + skinTol;
      }
      if (margin < -skinTol) {
        outOfBoundsMeshVertices++;
      }
    }
  }

  return {
    isLegal: violatingNodes.length === 0 && outOfBoundsMeshVertices === 0,
    violatingNodes,
    minClearanceMm: Math.round(minMarginM * 1000 * 10) / 10,
    outOfBoundsMeshVertices,
  };
}

export function cloneGrid(grid: Vec3[][]): Vec3[][] {
  return grid.map((col) => col.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })));
}

export function cloneProceduralElements(
  elements: ProceduralElementConfig[]
): ProceduralElementConfig[] {
  return elements.map((el) => ({ ...el }));
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
 * Evaluates the smooth bicubic Catmull-Rom detail control cage from a macro control lattice.
 */
export function interpolateMacroToDetail(
  macro: Vec3[][],
  detailCols: number,
  detailRows: number,
  detailOffsets?: Vec3[][],
  lockCenterline = false
): Vec3[][] {
  const macroCols = macro.length;

  // 1. Evaluate along v for each macro column u
  const colSampled: Vec3[][] = [];
  for (let u = 0; u < macroCols; u++) {
    const col: Vec3[] = [];
    for (let iv = 0; iv < detailRows; iv++) {
      const sv = detailRows > 1 ? iv / (detailRows - 1) : 0;
      col.push(evalCurveAlongArray(macro[u], sv, false));
    }
    colSampled.push(col);
  }

  // 2. Evaluate across u for each iv slice
  const out: Vec3[][] = [];
  for (let iu = 0; iu < detailCols; iu++) {
    const col: Vec3[] = [];
    const su = detailCols > 1 ? iu / (detailCols - 1) : 0;
    for (let iv = 0; iv < detailRows; iv++) {
      const rowCtrl: Vec3[] = [];
      for (let u = 0; u < macroCols; u++) {
        rowCtrl.push(colSampled[u][iv]);
      }
      const pt = evalCurveAlongArray(rowCtrl, su, lockCenterline && iu === 0);
      if (detailOffsets && detailOffsets[iu] && detailOffsets[iu][iv]) {
        const off = detailOffsets[iu][iv];
        pt.x += off.x;
        pt.y += off.y;
        pt.z += off.z;
      }
      if (lockCenterline && iu === 0) {
        pt.x = 0;
      }
      col.push(pt);
    }
    out.push(col);
  }

  return out;
}

/**
 * Deep-clone a CageV2 instance.
 */
export function cloneCageV2(cage: CageV2): CageV2 {
  return {
    macroCols: cage.macroCols,
    macroRows: cage.macroRows,
    detailCols: cage.detailCols,
    detailRows: cage.detailRows,
    macro: cloneGrid(cage.macro),
    detail: cloneGrid(cage.detail),
    detailOffsets: cloneGrid(cage.detailOffsets),
  };
}

/**
 * Create a new CageV2 from a macro grid with default detail density ((cols-1)*3+1 x (rows-1)*3+1).
 */
export function createCageV2(macro: Vec3[][], lockCenterline = false): CageV2 {
  const macroCols = macro.length;
  const macroRows = macro[0].length;
  const detailCols = (macroCols - 1) * 3 + 1;
  const detailRows = (macroRows - 1) * 3 + 1;
  const detailOffsets: Vec3[][] = Array.from({ length: detailCols }, () =>
    Array.from({ length: detailRows }, () => ({ x: 0, y: 0, z: 0 }))
  );
  const detail = interpolateMacroToDetail(
    macro,
    detailCols,
    detailRows,
    detailOffsets,
    lockCenterline
  );
  return {
    macroCols,
    macroRows,
    detailCols,
    detailRows,
    macro: cloneGrid(macro),
    detail,
    detailOffsets,
  };
}

/**
 * Propagate edited control node coordinates across shared seam boundaries.
 */
export function syncSharedSeamNodes(
  sourcePartId: PartId,
  u: number,
  v: number,
  newPosition: Vec3,
  cages: Partial<Record<PartId, CageV2>>,
  handleLevel: SculptHandleLevel = 'macro'
): void {
  for (const seam of SEAM_LINKS) {
    if (handleLevel === 'macro') {
      if (seam.partA === sourcePartId) {
        const idx = seam.nodesA.findIndex((n) => n.u === u && n.v === v);
        if (idx >= 0 && seam.nodesB[idx]) {
          const target = seam.nodesB[idx];
          const cageB = cages[seam.partB];
          if (cageB) {
            cageB.macro[target.u][target.v] = { ...newPosition };
            cageB.detail = interpolateMacroToDetail(
              cageB.macro,
              cageB.detailCols,
              cageB.detailRows,
              cageB.detailOffsets
            );
          }
        }
      } else if (seam.partB === sourcePartId) {
        const idx = seam.nodesB.findIndex((n) => n.u === u && n.v === v);
        if (idx >= 0 && seam.nodesA[idx]) {
          const target = seam.nodesA[idx];
          const cageA = cages[seam.partA];
          if (cageA) {
            cageA.macro[target.u][target.v] = { ...newPosition };
            cageA.detail = interpolateMacroToDetail(
              cageA.macro,
              cageA.detailCols,
              cageA.detailRows,
              cageA.detailOffsets
            );
          }
        }
      }
    }
  }
}

function initDefaultParamValues(sliders: PartParamSlider[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sliders) {
    out[s.id] = s.defaultValue;
  }
  return out;
}

const fiaGrid = (ptsFiaMm: Array<Array<[number, number, number]>>): Vec3[][] =>
  ptsFiaMm.map((col) => col.map(([xF, yFia, zFia]) => fiaMmToWorld(xF, yFia, zFia)));

/**
 * Apply engineering parameter sliders (Pitch/AoA, Camber/Arch, Span Flare, Undercut/Height)
 * onto a base control lattice grid[u][v], optionally clamping to FIA Reference Volumes.
 */
export function applyParametricOffsetsToGrid(
  baseGrid: Vec3[][],
  part: AeroPartData,
  paramValues: Record<string, number>,
  clampToFia = true
): Vec3[][] {
  const out = cloneGrid(baseGrid);
  const cols = part.cols;
  const rows = part.rows;

  const pitchDeg = paramValues.pitchDeg ?? 0;
  const camberMm = paramValues.camberMm ?? 0;
  const flareMm = paramValues.flareMm ?? 0;
  const heightMm = paramValues.heightMm ?? 0;

  const pitchRad = (pitchDeg * Math.PI) / 180;
  const camberM = camberMm * 0.001;
  const flareM = flareMm * 0.001;
  const heightM = heightMm * 0.001;

  for (let u = 0; u < cols; u++) {
    const su = cols > 1 ? u / (cols - 1) : 0;
    const zPivot = 0.5 * (baseGrid[u][0].z + baseGrid[u][rows - 1].z);
    const yPivot = 0.5 * (baseGrid[u][0].y + baseGrid[u][rows - 1].y);

    for (let v = 0; v < rows; v++) {
      const sv = rows > 1 ? v / (rows - 1) : 0;
      const pt = out[u][v];

      // 1. Pitch rotation around local chord midpoint (trailing edge rises for +pitchDeg)
      if (Math.abs(pitchRad) > 1e-5) {
        const dz = pt.z - zPivot;
        const dy = pt.y - yPivot;
        const cosP = Math.cos(pitchRad);
        const sinP = Math.sin(pitchRad);
        pt.y = yPivot + dy * cosP + dz * sinP;
        pt.z = zPivot - dy * sinP + dz * cosP;
      }

      // 2. Mid-chord camber arch (peaks at sv = 0.5)
      if (Math.abs(camberM) > 1e-5) {
        const arch = Math.sin(Math.PI * sv);
        pt.y += camberM * arch;
      }

      // 3. Lateral span/outwash flare (scales with su away from centerline)
      if (Math.abs(flareM) > 1e-5 && !(part.centerlineLocked && u === 0)) {
        const spanWeight = part.centerlineLocked ? su : 0.35 + 0.65 * su;
        pt.x = Math.max(0.001, pt.x + flareM * spanWeight);
      }

      // 4. Vertical trim / undercut height offset
      if (Math.abs(heightM) > 1e-5) {
        pt.y += heightM;
      }

      if (clampToFia) {
        out[u][v] = clampPointToLegalityBoxes(
          pt,
          part.legalityBoxes,
          part.centerlineLocked && u === 0
        );
      }
    }
  }

  return out;
}

/**
 * Create the official FIA 2026 baseline aerodynamic, chassis, and suspension parts (11 components),
 * Reference Volumes (Appendix 1), Sub-Zones, Parametric Sliders, and Procedural Aero Elements.
 */
export function createBaselineParts(): Record<PartId, AeroPartData> {
  const makePart = (spec: Omit<AeroPartData, 'paramValues'>): AeroPartData => {
    const cage = createCageV2(spec.grid, spec.centerlineLocked);
    return {
      ...spec,
      cage,
      grid: cage.macro,
      paramValues: initDefaultParamValues(spec.paramSliders),
    };
  };

  return {
    front_wing: makePart({
      id: 'front_wing',
      name: 'Front Wing, Endplate & Footplate',
      shortName: 'Front Wing',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.10 (RV-FW)',
      description:
        'Narrower 1800mm 2026 3-element wing with active flap (Y<=580mm) and footplate fence. Shapes front axle load and tire wake.',
      role: 'wing',
      accentHex: '#00d2be',
      centerlineLocked: true,
      thickness: 0.024,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_fw_profiles_inboard',
          label: 'RV-FW-PROFILES Inboard',
          xFFront: -1250,
          xFRear: -500,
          yMinFront: 0,
          yMaxFront: 360,
          yMinRear: 0,
          yMaxRear: 450,
          zMinFront: 55,
          zMaxFront: 255,
          zMinRear: 85,
          zMaxRear: 290,
        }),
        makeFiaBox({
          id: 'rv_fw_profiles_outboard',
          label: 'RV-FW-PROFILES Swept Span',
          xFFront: -1150,
          xFRear: -355,
          yMinFront: 320,
          yMaxFront: 685,
          yMinRear: 320,
          yMaxRear: 685,
          zMinFront: 58,
          zMaxFront: 285,
          zMinRear: 68,
          zMaxRear: 320,
        }),
        makeFiaBox({
          id: 'rv_fwep_body_and_ofp',
          label: 'RV-FWEP Endplate & Footplate',
          xFFront: -1120,
          xFRear: -295,
          yMinFront: 590,
          yMaxFront: 904,
          yMinRear: 590,
          yMaxRear: 904,
          zMinFront: 48,
          zMaxFront: 392,
          zMinRear: 48,
          zMaxRear: 395,
          wheelCutoutFia: { xF: 0, zFia: 330, radiusMm: 395, yMinMm: 595 },
        }),
      ],
      cols: 5,
      rows: 4,
      grid: fiaGrid([
        [
          [-1190, 0, 82],
          [-990, 0, 108],
          [-790, 0, 148],
          [-600, 0, 195],
        ],
        [
          [-1130, 275, 90],
          [-940, 275, 122],
          [-755, 275, 175],
          [-570, 275, 232],
        ],
        [
          [-1045, 540, 112],
          [-875, 540, 145],
          [-705, 540, 198],
          [-535, 540, 258],
        ],
        [
          [-985, 670, 130],
          [-815, 670, 162],
          [-640, 670, 215],
          [-465, 670, 275],
        ],
        [
          [-950, 820, 230],
          [-790, 845, 275],
          [-620, 865, 320],
          [-455, 880, 355],
        ],
      ]),
      subZones: [
        {
          id: 'fw_spoon',
          label: 'Inboard Spoon',
          description: 'Central neutral spoon & under-nose channel (u=0..1)',
          uIndices: [0, 1],
          vIndices: [0, 1, 2, 3],
        },
        {
          id: 'fw_active_flaps',
          label: 'Active Upper Flaps',
          description: 'Movable Z/X-Mode 2nd & 3rd flap cascade (v=2..3)',
          uIndices: [0, 1, 2, 3],
          vIndices: [2, 3],
        },
        {
          id: 'fw_endplate',
          label: 'Endplate & Footplate',
          description: 'Outboard RV-FWEP endplate & tire-wake footplate (u=3..4)',
          uIndices: [3, 4],
          vIndices: [0, 1, 2, 3],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Cascade AoA Pitch', unit: '°', min: -6, max: 6, step: 0.5, defaultValue: 0 },
        { id: 'camberMm', label: 'Spoon & Flap Camber', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Endplate Outwash Flare', unit: 'mm', min: -20, max: 22, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'fw_diveplane',
          label: 'Endplate Outwash Diveplane',
          enabled: true,
          pitchDeg: 11,
          scale: 1.0,
          count: 1,
          minCount: 1,
          maxCount: 2,
        },
        {
          id: 'fw_gurney',
          label: 'Upper Flap Gurney Lip',
          enabled: false,
          pitchDeg: 0,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    nosecone: makePart({
      id: 'nosecone',
      name: 'Nosecone, Cape & Wing Pylons',
      shortName: 'Nosecone',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.7.1 (RV-NOSE)',
      description:
        'Impact structure fairing, twin front-wing pylons, and under-nose cape. Channels clean flow beneath the front bulkhead into the floor bib.',
      role: 'body_fairing',
      accentHex: '#38bdf8',
      centerlineLocked: true,
      thickness: 0.045,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_nose_main',
          label: 'RV-NOSE Tapered Fairing',
          xFFront: -1300,
          xFRear: 115,
          yMinFront: 0,
          yMaxFront: 220,
          yMinRear: 0,
          yMaxRear: 390,
          zMinFront: 115,
          zMaxFront: 350,
          zMinRear: 175,
          zMaxRear: 645,
        }),
        makeFiaBox({
          id: 'rv_fw_pylon',
          label: 'RV-FW-PYLON Mounts',
          xFFront: -1240,
          xFRear: -650,
          yMinFront: 0,
          yMaxFront: 185,
          yMinRear: 0,
          yMaxRear: 220,
          zMinFront: 60,
          zMaxFront: 260,
          zMinRear: 85,
          zMaxRear: 320,
        }),
      ],
      cols: 3,
      rows: 4,
      grid: fiaGrid([
        [
          [-1220, 0, 195],
          [-820, 0, 315],
          [-380, 0, 455],
          [-50, 0, 540],
        ],
        [
          [-1190, 95, 175],
          [-800, 135, 285],
          [-370, 175, 415],
          [-50, 215, 500],
        ],
        [
          [-1150, 115, 125],
          [-790, 155, 205],
          [-365, 195, 285],
          [-50, 240, 300],
        ],
      ]),
      subZones: [
        {
          id: 'nose_tip_pylons',
          label: 'Nose Tip & Pylons',
          description: 'Forward impact tip and twin wing mounting pylons (v=0..1)',
          uIndices: [0, 1, 2],
          vIndices: [0, 1],
        },
        {
          id: 'nose_cape_keel',
          label: 'Under-Nose Keel',
          description: 'Lower keel & cape feeding the floor tea-tray (u=2)',
          uIndices: [1, 2],
          vIndices: [1, 2, 3],
        },
        {
          id: 'nose_bulkhead',
          label: 'Bulkhead Transition',
          description: 'Upper nose deck joining the survival cell (v=2..3)',
          uIndices: [0, 1, 2],
          vIndices: [2, 3],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Nose Droop Angle', unit: '°', min: -4, max: 4, step: 0.5, defaultValue: 0 },
        { id: 'heightMm', label: 'Under-Nose Clearance', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Cape Cheek Width', unit: 'mm', min: -20, max: 20, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'nose_cape_vanes',
          label: 'Under-Nose Turning Vanes',
          enabled: false,
          pitchDeg: 8,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    front_suspension: makePart({
      id: 'front_suspension',
      name: 'Front Suspension & Brake Ducts',
      shortName: 'Front Susp',
      category: 'suspension',
      articleRef: 'FIA 2026 Art. 3.13 / 10 (RV-FBD)',
      description:
        'Front carbon wishbone aero fairings, pushrod/trackrod shrouds, and inboard front brake cooling scoops & cake-tin deflectors.',
      role: 'suspension',
      accentHex: '#06b6d4',
      centerlineLocked: false,
      thickness: 0.018,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_susp_front_arms',
          label: 'RV-SUSP-FRONT Wishbone Envelope',
          xFFront: -330,
          xFRear: 475,
          yMinFront: 140,
          yMaxFront: 620,
          yMinRear: 140,
          yMaxRear: 620,
          zMinFront: 80,
          zMaxFront: 550,
          zMinRear: 80,
          zMaxRear: 550,
        }),
      ],
      cols: 3,
      rows: 3,
      grid: fiaGrid([
        // u=0: Inboard chassis pick-ups
        [
          [-210, 215, 290],
          [60, 235, 340],
          [320, 250, 385],
        ],
        // u=1: Mid-span wishbone & pushrod fairings
        [
          [-180, 395, 315],
          [40, 405, 355],
          [260, 410, 395],
        ],
        // u=2: Outboard upright & front brake duct scoop
        [
          [-160, 565, 335],
          [20, 575, 365],
          [210, 565, 415],
        ],
      ]),
      subZones: [
        {
          id: 'fsusp_inboard',
          label: 'Inboard Pick-Ups',
          description: 'Monocoque suspension pick-up fairings (u=0)',
          uIndices: [0],
          vIndices: [0, 1, 2],
        },
        {
          id: 'fsusp_wishbones',
          label: 'Wishbone Cascade',
          description: 'Upper & lower carbon wishbone downwash profiles (u=1)',
          uIndices: [1],
          vIndices: [0, 1, 2],
        },
        {
          id: 'fsusp_brake_duct',
          label: 'Brake Scoop & Upright',
          description: 'Outboard front brake cooling scoop & deflector (u=2)',
          uIndices: [2],
          vIndices: [0, 1, 2],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Wishbone Anti-Dive Pitch', unit: '°', min: -5, max: 5, step: 0.5, defaultValue: 0 },
        { id: 'heightMm', label: 'Roll-Center Height Offset', unit: 'mm', min: -20, max: 20, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Brake Scoop Width', unit: 'mm', min: -18, max: 18, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'fsusp_duct_winglet',
          label: 'Brake Duct Outwash Winglet',
          enabled: true,
          pitchDeg: 9,
          scale: 1.0,
          count: 2,
          minCount: 1,
          maxCount: 3,
        },
      ],
    }),

    monocoque: makePart({
      id: 'monocoque',
      name: 'Monocoque Tub, Cockpit, Halo & Mirrors',
      shortName: 'Monocoque & Halo',
      category: 'body',
      articleRef: 'FIA 2026 Art. 3.6 / 12 (RV-CHASSIS)',
      description:
        'Homologated carbon survival cell, cockpit coaming, titanium Halo safety fairing, and aerodynamic rearview mirror housings.',
      role: 'chassis_body',
      accentHex: '#64748b',
      centerlineLocked: true,
      thickness: 0.04,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_chassis_monocoque',
          label: 'RV-CHASSIS Survival Cell & Halo',
          xFFront: -420,
          xFRear: 1680,
          yMinFront: 0,
          yMaxFront: 895,
          yMinRear: 0,
          yMaxRear: 895,
          zMinFront: 25,
          zMaxFront: 870,
          zMinRear: 25,
          zMaxRear: 870,
        }),
      ],
      cols: 3,
      rows: 4,
      grid: fiaGrid([
        // u=0: Centerline spine & Halo central pillar (Y=0)
        [
          [-50, 0, 540],
          [420, 0, 650],
          [1020, 0, 740],
          [1550, 0, 860],
        ],
        // u=1: Survival cell upper shoulder & Halo hoop
        [
          [-50, 215, 500],
          [440, 245, 595],
          [1040, 250, 665],
          [1550, 200, 720],
        ],
        // u=2: Lower tub flank & outboard mirror pod zone
        [
          [-50, 240, 300],
          [460, 320, 380],
          [1040, 560, 640],
          [1550, 270, 500],
        ],
      ]),
      subZones: [
        {
          id: 'mono_bulkhead',
          label: 'Forward Tub & Bulkhead',
          description: 'Front survival cell shoulders behind nosecone (v=0..1)',
          uIndices: [0, 1, 2],
          vIndices: [0, 1],
        },
        {
          id: 'mono_halo_cockpit',
          label: 'Cockpit & Halo Hoop',
          description: 'Titanium Halo fairing & cockpit head protection (u=0..1, v=1..3)',
          uIndices: [0, 1],
          vIndices: [1, 2, 3],
        },
        {
          id: 'mono_mirrors',
          label: 'Mirrors & Tub Flanks',
          description: 'Outboard rearview mirror stalks & lower tub sides (u=2)',
          uIndices: [2],
          vIndices: [1, 2, 3],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Halo & Coaming Rake', unit: '°', min: -3, max: 3, step: 0.5, defaultValue: 0 },
        { id: 'camberMm', label: 'Cockpit Coaming Arch', unit: 'mm', min: -20, max: 20, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Mirror Stalk Span', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'mono_halo_boomerang',
          label: 'Halo Boomerang Conditioning Vane',
          enabled: false,
          pitchDeg: 6,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    floor_boards: makePart({
      id: 'floor_boards',
      name: '2026 Wake-Control Floor Boards',
      shortName: 'Floor Boards',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.5.4 (RV-FLOOR-BOARD)',
      description:
        'Signature 2026 outboard 3-slat wake deflectors ahead of the sidepods. Designed to push turbulent front-tire wake inward/downward cleanly.',
      role: 'wake_board',
      accentHex: '#22c55e',
      centerlineLocked: false,
      thickness: 0.018,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_floor_board',
          label: 'RV-FLOOR-BOARD Slat Zone',
          xFFront: 605,
          xFRear: 1750,
          yMinFront: 560,
          yMaxFront: 904,
          yMinRear: 560,
          yMaxRear: 904,
          zMinFront: 30,
          zMaxFront: 455,
          zMinRear: 30,
          zMaxRear: 455,
        }),
        makeFiaBox({
          id: 'rv_floor_foot',
          label: 'RV-FLOOR-FOOT Footplate',
          xFFront: 605,
          xFRear: 1750,
          yMinFront: 560,
          yMaxFront: 904,
          yMinRear: 560,
          yMaxRear: 904,
          zMinFront: -2,
          zMaxFront: 148,
          zMinRear: -2,
          zMaxRear: 148,
        }),
      ],
      cols: 3,
      rows: 4,
      grid: fiaGrid([
        [
          [720, 680, 55],
          [950, 725, 58],
          [1250, 740, 50],
          [1440, 720, 55],
        ],
        [
          [740, 760, 195],
          [990, 815, 195],
          [1230, 835, 185],
          [1445, 790, 175],
        ],
        [
          [760, 790, 345],
          [1000, 850, 350],
          [1240, 865, 335],
          [1450, 825, 310],
        ],
      ]),
      subZones: [
        {
          id: 'fb_footplate',
          label: 'Lower Footplate Shelf',
          description: 'Horizontal vortex-generating footplate base (u=0)',
          uIndices: [0],
          vIndices: [0, 1, 2, 3],
        },
        {
          id: 'fb_leading_slats',
          label: 'Leading Wake Slats',
          description: 'Forward tire-wake capture vanes (v=0..1)',
          uIndices: [1, 2],
          vIndices: [0, 1],
        },
        {
          id: 'fb_trailing_cascade',
          label: 'Trailing Inwash Vanes',
          description: 'Aft deflector slats guiding flow around sidepods (v=2..3)',
          uIndices: [1, 2],
          vIndices: [2, 3],
        },
      ],
      paramSliders: [
        { id: 'flareMm', label: 'Vane Inwash/Outwash Yaw', unit: 'mm', min: -35, max: 30, step: 1, defaultValue: 0 },
        { id: 'pitchDeg', label: 'Slat Vertical Rake', unit: '°', min: -5, max: 5, step: 0.5, defaultValue: 0 },
        { id: 'camberMm', label: 'Cascade Curvature', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'fb_aux_slat',
          label: 'Upper Wake Deflector Slat',
          enabled: true,
          pitchDeg: -8,
          scale: 1.0,
          count: 2,
          minCount: 1,
          maxCount: 3,
        },
      ],
    }),

    floor: makePart({
      id: 'floor',
      name: 'Main Floor, Bib & Edge Bodywork',
      shortName: 'Main Floor',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.5.1 (RV-FLOOR-BODY)',
      description:
        '2026 flatter step-plane underbody, central bib ("tea-tray") and lateral floor edges. Generates low-drag ground-effect suction ahead of the diffuser.',
      role: 'ground_effect',
      accentHex: '#a855f7',
      centerlineLocked: true,
      thickness: 0.022,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_floor_bib',
          label: 'RV-FLOOR-BIB Tea-Tray',
          xFFront: 330,
          xFRear: 1150,
          yMinFront: 0,
          yMaxFront: 320,
          yMinRear: 0,
          yMaxRear: 480,
          zMinFront: -10,
          zMaxFront: 185,
          zMinRear: -10,
          zMaxRear: 215,
        }),
        makeFiaBox({
          id: 'rv_floor_body_main',
          label: 'RV-FLOOR-BODY Step Plane',
          xFFront: 600,
          xFRear: 3075,
          yMinFront: 0,
          yMaxFront: 775,
          yMinRear: 0,
          yMaxRear: 755,
          zMinFront: -10,
          zMaxFront: 230,
          zMinRear: -10,
          zMaxRear: 230,
        }),
      ],
      cols: 4,
      rows: 5,
      grid: fiaGrid([
        [
          [480, 0, 18],
          [1050, 0, 12],
          [1620, 0, 10],
          [2180, 0, 12],
          [2720, 0, 22],
        ],
        [
          [760, 260, 85],
          [1180, 310, 68],
          [1680, 310, 56],
          [2200, 300, 60],
          [2720, 200, 68],
        ],
        [
          [820, 510, 88],
          [1220, 540, 66],
          [1700, 540, 55],
          [2220, 520, 58],
          [2720, 380, 65],
        ],
        [
          [950, 725, 58],
          [1250, 740, 50],
          [1750, 738, 42],
          [2250, 718, 44],
          [2720, 495, 51],
        ],
      ]),
      subZones: [
        {
          id: 'floor_bib_inlet',
          label: 'Bib & Tunnel Inlet',
          description: 'Forward tea-tray bib & leading Venturi fences (v=0..1)',
          uIndices: [0, 1, 2, 3],
          vIndices: [0, 1],
        },
        {
          id: 'floor_throat',
          label: 'Venturi Suction Throat',
          description: 'Mid-floor peak suction step-plane roof (u=1..2, v=1..3)',
          uIndices: [1, 2],
          vIndices: [1, 2, 3],
        },
        {
          id: 'floor_edge_wing',
          label: 'Lateral Floor Edge',
          description: 'Outboard vortex-sealing floor edge lip (u=3)',
          uIndices: [3],
          vIndices: [0, 1, 2, 3, 4],
        },
      ],
      paramSliders: [
        { id: 'camberMm', label: 'Venturi Throat Roof Arch', unit: 'mm', min: -22, max: 25, step: 1, defaultValue: 0 },
        { id: 'heightMm', label: 'Step-Plane Vertical Trim', unit: 'mm', min: -18, max: 22, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Lateral Edge Seal Width', unit: 'mm', min: -25, max: 20, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'floor_fences',
          label: 'Underfloor Vortex Fences',
          enabled: true,
          pitchDeg: 7,
          scale: 1.0,
          count: 3,
          minCount: 2,
          maxCount: 4,
        },
        {
          id: 'floor_edge_scroll',
          label: 'Lateral Floor-Edge Scroll Wing',
          enabled: true,
          pitchDeg: 10,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    sidepods: makePart({
      id: 'sidepods',
      name: 'Sidepod Inlet, Undercut & Coke-Bottle',
      shortName: 'Sidepods',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.8 (RV-SIDEPOD)',
      description:
        'Radiator intake, deep lower undercut, and tapered rear coke-bottle bodywork feeding high-energy flow over the floor edge to the rear corner.',
      role: 'body_fairing',
      accentHex: '#f59e0b',
      centerlineLocked: false,
      thickness: 0.04,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_sidepod_front',
          label: 'RV-SIDEPOD Inlet & Shoulder',
          xFFront: 785,
          xFRear: 1850,
          yMinFront: 35,
          yMaxFront: 725,
          yMinRear: 35,
          yMaxRear: 755,
          zMinFront: 50,
          zMaxFront: 700,
          zMinRear: 50,
          zMaxRear: 700,
        }),
        makeFiaBox({
          id: 'rv_ec_cokebottle',
          label: 'RV-EC Tapered Coke-Bottle',
          xFFront: 1800,
          xFRear: 3365,
          yMinFront: 35,
          yMaxFront: 755,
          yMinRear: 35,
          yMaxRear: 480,
          zMinFront: 50,
          zMaxFront: 700,
          zMinRear: 50,
          zMaxRear: 655,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        [
          [980, 250, 560],
          [1550, 270, 500],
          [2400, 210, 490],
          [3250, 145, 430],
        ],
        [
          [1020, 460, 535],
          [1720, 480, 495],
          [2520, 365, 385],
          [3250, 195, 285],
        ],
        [
          [1060, 665, 445],
          [1750, 705, 415],
          [2520, 495, 325],
          [3250, 225, 240],
        ],
        [
          [1080, 565, 205],
          [1750, 585, 190],
          [2520, 425, 165],
          [3250, 205, 155],
        ],
      ]),
      subZones: [
        {
          id: 'sp_inlet',
          label: 'Radiator Inlet Lip',
          description: 'Forward cooling intake opening & overbite lip (v=0)',
          uIndices: [0, 1, 2, 3],
          vIndices: [0],
        },
        {
          id: 'sp_undercut',
          label: 'Lower Undercut Belly',
          description: 'Lower floor-skimming undercut channel (u=3)',
          uIndices: [2, 3],
          vIndices: [0, 1, 2],
        },
        {
          id: 'sp_downwash_ramp',
          label: 'Coanda Downwash Ramp',
          description: 'Upper sloped deck guiding airflow to diffuser roof (u=1, v=1..3)',
          uIndices: [0, 1],
          vIndices: [1, 2, 3],
        },
        {
          id: 'sp_cokebottle',
          label: 'Coke-Bottle Waist',
          description: 'Aft inward taper ahead of the rear tire (v=2..3)',
          uIndices: [1, 2, 3],
          vIndices: [2, 3],
        },
      ],
      paramSliders: [
        { id: 'flareMm', label: 'Sidepod Width / Undercut', unit: 'mm', min: -55, max: 35, step: 2, defaultValue: 0 },
        { id: 'pitchDeg', label: 'Downwash Ramp Slope', unit: '°', min: -5, max: 5, step: 0.5, defaultValue: 0 },
        { id: 'heightMm', label: 'Shoulder Deck Height', unit: 'mm', min: -35, max: 30, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'sp_cooling_louvers',
          label: 'Cooling Exit Louver Cascade',
          enabled: true,
          pitchDeg: 14,
          scale: 1.0,
          count: 4,
          minCount: 2,
          maxCount: 6,
        },
      ],
    }),

    engine_cover: makePart({
      id: 'engine_cover',
      name: 'Airbox Roll Hoop, Sharkfin & Tailcone',
      shortName: 'Engine Cover',
      category: 'body',
      articleRef: 'FIA 2026 Art. 3.8.2 (RV-EC-SHARKFIN)',
      description:
        'Roll-hoop airbox intake, dorsal engine cover spine, yaw-stabilizing sharkfin, and central turbo-hybrid exhaust tailcone.',
      role: 'chassis_body',
      accentHex: '#eab308',
      centerlineLocked: true,
      thickness: 0.032,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_ec_sharkfin_spine',
          label: 'RV-EC Airbox & Sharkfin Spine',
          xFFront: 1360,
          xFRear: 4155,
          yMinFront: 0,
          yMaxFront: 705,
          yMinRear: 0,
          yMaxRear: 705,
          zMinFront: 30,
          zMaxFront: 1075,
          zMinRear: 30,
          zMaxRear: 1075,
        }),
      ],
      cols: 3,
      rows: 4,
      grid: fiaGrid([
        // u=0: Dorsal sharkfin ridge & airbox crown (Y=0)
        [
          [1550, 0, 860],
          [2150, 0, 885],
          [2820, 0, 775],
          [3480, 0, 625],
        ],
        // u=1: Upper engine cover cannon shelf
        [
          [1550, 200, 720],
          [2180, 155, 690],
          [2840, 130, 595],
          [3520, 95, 505],
        ],
        // u=2: Lower engine cover flank & exhaust tailpipe shroud
        [
          [1550, 270, 500],
          [2400, 210, 490],
          [2880, 155, 395],
          [3620, 85, 340],
        ],
      ]),
      subZones: [
        {
          id: 'ec_airbox',
          label: 'Roll Hoop & Airbox',
          description: 'Upper roll-hoop engine intake above driver helmet (v=0..1)',
          uIndices: [0, 1],
          vIndices: [0, 1],
        },
        {
          id: 'ec_sharkfin',
          label: 'Dorsal Sharkfin',
          description: 'Centerline vertical stabilizer spine feeding rear wing (u=0)',
          uIndices: [0],
          vIndices: [1, 2, 3],
        },
        {
          id: 'ec_cannon_exhaust',
          label: 'Cooling Cannon & Exhaust',
          description: 'Rear cooling exit cannon & central exhaust tailpipe (u=1..2, v=2..3)',
          uIndices: [1, 2],
          vIndices: [2, 3],
        },
      ],
      paramSliders: [
        { id: 'heightMm', label: 'Sharkfin Spine Height', unit: 'mm', min: -35, max: 35, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Cooling Cannon Width', unit: 'mm', min: -30, max: 30, step: 1, defaultValue: 0 },
        { id: 'pitchDeg', label: 'Spine Downwash Taper', unit: '°', min: -4, max: 4, step: 0.5, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'ec_sharkfin_ext',
          label: 'Dorsal Sharkfin Sail Extension',
          enabled: true,
          pitchDeg: 0,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    rear_suspension: makePart({
      id: 'rear_suspension',
      name: 'Rear Suspension & Brake Ducts',
      shortName: 'Rear Susp',
      category: 'suspension',
      articleRef: 'FIA 2026 Art. 3.13 / 10 (RV-RBD)',
      description:
        'Rear carbon wishbone fairings, pullrod/trackrod shrouds, and rear brake drum upwash winglets conditioning inner rear tire wake.',
      role: 'suspension',
      accentHex: '#10b981',
      centerlineLocked: false,
      thickness: 0.018,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_susp_rear_arms',
          label: 'RV-SUSP-REAR Wishbone & RBD',
          xFFront: 2945,
          xFRear: 3720,
          yMinFront: 70,
          yMaxFront: 565,
          yMinRear: 70,
          yMaxRear: 565,
          zMinFront: 30,
          zMaxFront: 655,
          zMinRear: 30,
          zMaxRear: 655,
        }),
      ],
      cols: 3,
      rows: 3,
      grid: fiaGrid([
        // u=0: Gearbox inboard pick-ups
        [
          [3080, 135, 260],
          [3320, 130, 320],
          [3560, 120, 365],
        ],
        // u=1: Mid-span rear wishbones & driveshaft shroud
        [
          [3120, 320, 295],
          [3360, 325, 345],
          [3580, 320, 395],
        ],
        // u=2: Outboard rear brake duct & upwash winglet cascade
        [
          [3160, 495, 315],
          [3390, 505, 355],
          [3610, 495, 420],
        ],
      ]),
      subZones: [
        {
          id: 'rsusp_inboard',
          label: 'Gearbox Pick-Ups',
          description: 'Inboard gearbox suspension mounts above diffuser (u=0)',
          uIndices: [0],
          vIndices: [0, 1, 2],
        },
        {
          id: 'rsusp_wishbones',
          label: 'Wishbones & Pullrod',
          description: 'Swept carbon rear wishbone & driveshaft fairings (u=1)',
          uIndices: [1],
          vIndices: [0, 1, 2],
        },
        {
          id: 'rsusp_brake_duct',
          label: 'Rear Brake Duct Winglets',
          description: 'Outboard rear brake drum & upwash cascade (u=2)',
          uIndices: [2],
          vIndices: [0, 1, 2],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Wishbone Upwash Pitch', unit: '°', min: -5, max: 5, step: 0.5, defaultValue: 0 },
        { id: 'heightMm', label: 'Anti-Squat Height Offset', unit: 'mm', min: -20, max: 20, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Brake Duct Winglet Span', unit: 'mm', min: -18, max: 18, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'rsusp_upwash_winglets',
          label: 'Rear Brake Duct Upwash Cascade',
          enabled: true,
          pitchDeg: 13,
          scale: 1.0,
          count: 3,
          minCount: 1,
          maxCount: 4,
        },
      ],
    }),

    diffuser: makePart({
      id: 'diffuser',
      name: 'Rear Diffuser & Boat-Tail',
      shortName: 'Diffuser',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.5.1 / 3.9 (RV-FLOOR-BODY / RV-TAIL)',
      description:
        'Narrower, lower-volume 2026 rear underbody diffuser and central crash boat-tail. Expands underfloor flow smoothly without a beam wing.',
      role: 'diffuser',
      accentHex: '#ec4899',
      centerlineLocked: true,
      thickness: 0.02,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_diffuser_ramp',
          label: 'RV-FLOOR-BODY Diffuser Ramp',
          xFFront: 2605,
          xFRear: 3650,
          yMinFront: 0,
          yMaxFront: 505,
          yMinRear: 0,
          yMaxRear: 505,
          zMinFront: -10,
          zMaxFront: 240,
          zMinRear: -10,
          zMaxRear: 360,
        }),
        makeFiaBox({
          id: 'rv_tail_structure',
          label: 'RV-TAIL Boat-Tail Keel',
          xFFront: 3250,
          xFRear: 4140,
          yMinFront: 0,
          yMaxFront: 165,
          yMinRear: 0,
          yMaxRear: 165,
          zMinFront: 0,
          zMaxFront: 475,
          zMinRear: 80,
          zMaxRear: 480,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        [
          [2720, 0, 22],
          [3060, 0, 75],
          [3350, 0, 148],
          [3590, 0, 218],
        ],
        [
          [2720, 200, 68],
          [3060, 155, 125],
          [3350, 150, 195],
          [3580, 145, 258],
        ],
        [
          [2720, 380, 65],
          [3060, 305, 120],
          [3350, 290, 188],
          [3580, 280, 248],
        ],
        [
          [2720, 495, 51],
          [3060, 410, 95],
          [3350, 392, 150],
          [3580, 380, 198],
        ],
      ]),
      subZones: [
        {
          id: 'diff_kickline',
          label: 'Throat Kickline',
          description: 'Forward diffuser throat transition from step-plane (v=0..1)',
          uIndices: [0, 1, 2, 3],
          vIndices: [0, 1],
        },
        {
          id: 'diff_boattail',
          label: 'Center Boat-Tail Keel',
          description: 'Central crash-structure keel ramp (u=0..1)',
          uIndices: [0, 1],
          vIndices: [1, 2, 3],
        },
        {
          id: 'diff_outer_tunnels',
          label: 'Expansion Roof & Sidewall',
          description: 'Outer diffuser expansion tunnels & corner strakes (u=2..3, v=2..3)',
          uIndices: [2, 3],
          vIndices: [2, 3],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Diffuser Expansion Angle', unit: '°', min: -5, max: 6, step: 0.5, defaultValue: 0 },
        { id: 'camberMm', label: 'Tunnel Roof Arch', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Sidewall Exit Width', unit: 'mm', min: -25, max: 25, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'diff_strakes',
          label: 'Internal Expansion Strakes',
          enabled: true,
          pitchDeg: 4,
          scale: 1.0,
          count: 3,
          minCount: 2,
          maxCount: 4,
        },
        {
          id: 'diff_gurney',
          label: 'Upper Exit Lip Gurney',
          enabled: false,
          pitchDeg: 0,
          scale: 1.0,
          count: 1,
        },
      ],
    }),

    rear_wing: makePart({
      id: 'rear_wing',
      name: 'Rear Wing, Endplates & Pylon',
      shortName: 'Rear Wing',
      category: 'aero',
      articleRef: 'FIA 2026 Art. 3.11 (RV-RW)',
      description:
        '3-element beamless 2026 rear wing (Y<=575mm, Z<=880mm) with active X-Mode/Z-Mode upper flaps (Y<=535mm) and curved lower endplates.',
      role: 'wing',
      accentHex: '#ef4444',
      centerlineLocked: true,
      thickness: 0.026,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_rw_profiles',
          label: 'RV-RW-PROFILES Upper Cascade',
          xFFront: 3500,
          xFRear: 4155,
          yMinFront: 0,
          yMaxFront: 578,
          yMinRear: 0,
          yMaxRear: 578,
          zMinFront: 680,
          zMaxFront: 882,
          zMinRear: 695,
          zMaxRear: 882,
        }),
        makeFiaBox({
          id: 'rv_rwep_body',
          label: 'RV-RWEP-BODY Endplate Zone',
          xFFront: 3500,
          xFRear: 4155,
          yMinFront: 320,
          yMaxFront: 578,
          yMinRear: 320,
          yMaxRear: 578,
          zMinFront: 120,
          zMaxFront: 882,
          zMinRear: 120,
          zMaxRear: 882,
        }),
        makeFiaBox({
          id: 'rv_rw_pylon',
          label: 'RV-RW-PYLON Swan-Neck',
          xFFront: 3400,
          xFRear: 3985,
          yMinFront: 0,
          yMaxFront: 120,
          yMinRear: 0,
          yMaxRear: 120,
          zMinFront: 280,
          zMaxFront: 875,
          zMinRear: 320,
          zMaxRear: 875,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        [
          [3645, 0, 735],
          [3785, 0, 760],
          [3920, 0, 810],
          [4035, 0, 858],
        ],
        [
          [3655, 270, 740],
          [3795, 270, 765],
          [3925, 270, 815],
          [4040, 270, 862],
        ],
        [
          [3665, 530, 742],
          [3805, 530, 768],
          [3935, 530, 812],
          [4055, 530, 855],
        ],
        [
          [3640, 485, 420],
          [3800, 505, 440],
          [3960, 520, 470],
          [4115, 535, 510],
        ],
      ]),
      subZones: [
        {
          id: 'rw_mainplane',
          label: 'Lower Mainplane',
          description: 'Leading fixed mainplane & central spoon (v=0..1)',
          uIndices: [0, 1, 2],
          vIndices: [0, 1],
        },
        {
          id: 'rw_active_flaps',
          label: 'Active Z/X-Mode Flaps',
          description: 'Upper movable 2nd & 3rd flap elements (u=0..2, v=2..3)',
          uIndices: [0, 1, 2],
          vIndices: [2, 3],
        },
        {
          id: 'rw_endplates',
          label: 'Endplate Skirt',
          description: 'Curved lower endplates & wingtip rollout (u=2..3)',
          uIndices: [2, 3],
          vIndices: [0, 1, 2, 3],
        },
      ],
      paramSliders: [
        { id: 'pitchDeg', label: 'Cascade AoA Incidence', unit: '°', min: -7, max: 6, step: 0.5, defaultValue: 0 },
        { id: 'camberMm', label: 'Mainplane Spoon Depth', unit: 'mm', min: -28, max: 25, step: 1, defaultValue: 0 },
        { id: 'flareMm', label: 'Endplate Toe / Flare', unit: 'mm', min: -22, max: 22, step: 1, defaultValue: 0 },
      ],
      proceduralElements: [
        {
          id: 'rw_gurney',
          label: 'Trailing-Edge Gurney Flap',
          enabled: false,
          pitchDeg: 0,
          scale: 1.0,
          count: 1,
        },
        {
          id: 'rw_endplate_vanes',
          label: 'Lower Endplate Swirl Vanes',
          enabled: true,
          pitchDeg: 12,
          scale: 1.0,
          count: 3,
          minCount: 2,
          maxCount: 4,
        },
      ],
    }),
  };
}

/**
 * Built-in FIA 2026 legal aero concept presets expressed as smooth FFD deformations
 * of the official FIA 2026 baseline car.
 */
export function createPresetGrids(
  preset: 'baseline' | 'high_downforce' | 'low_drag'
): Record<PartId, Vec3[][]> {
  const base = createBaselineParts();
  const result = {} as Record<PartId, Vec3[][]>;
  for (const id of PART_ORDER) {
    result[id] = cloneGrid(base[id].grid);
  }

  if (preset === 'high_downforce') {
    for (let u = 0; u < 4; u++) {
      result.front_wing[u][2].y += 0.018;
      result.front_wing[u][3].y += 0.032;
    }
    result.front_wing[4][2].x += 0.018;
    result.front_wing[4][3].x += 0.020;

    for (let u = 1; u <= 2; u++) {
      result.floor_boards[u][2].x += 0.022;
      result.floor_boards[u][3].x += 0.028;
    }

    result.floor[1][2].y -= 0.010;
    result.floor[2][2].y -= 0.010;
    result.floor[3][2].y -= 0.010;
    result.floor[3][3].y -= 0.008;

    result.sidepods[3][0].x -= 0.065;
    result.sidepods[3][1].x -= 0.075;
    result.sidepods[1][2].y -= 0.042;
    result.sidepods[1][3].y -= 0.038;

    for (let u = 0; u < 3; u++) {
      result.diffuser[u][2].y += 0.018;
      result.diffuser[u][3].y += 0.032;
    }

    for (let u = 0; u < 3; u++) {
      result.rear_wing[u][0].y -= 0.022;
      result.rear_wing[u][1].y -= 0.010;
      result.rear_wing[u][3].y += 0.018;
    }
  } else if (preset === 'low_drag') {
    for (let u = 0; u < 4; u++) {
      result.front_wing[u][2].y -= 0.018;
      result.front_wing[u][3].y -= 0.034;
    }

    for (let u = 0; u < 3; u++) {
      result.floor_boards[u][2].x -= 0.018;
      result.floor_boards[u][3].x -= 0.024;
    }

    for (let v = 0; v < 4; v++) {
      result.sidepods[2][v].x -= 0.045;
      result.sidepods[1][v].y -= 0.022;
    }

    for (let u = 0; u < 3; u++) {
      result.rear_wing[u][2].y -= 0.022;
      result.rear_wing[u][3].y -= 0.042;
    }
  }

  for (const id of PART_ORDER) {
    const part = base[id];
    for (let u = 0; u < part.cols; u++) {
      for (let v = 0; v < part.rows; v++) {
        result[id][u][v] = clampPointToLegalityBoxes(
          result[id][u][v],
          part.legalityBoxes,
          part.centerlineLocked && u === 0
        );
      }
    }
  }

  return result;
}

/**
 * Precomputed baseline V2 procedural control cages with shared seam welding.
 */
export const FITTED_CAGES_V2: Record<PartId, CageV2> = (() => {
  const base = createBaselineParts();
  const res = {} as Record<PartId, CageV2>;
  for (const id of PART_ORDER) {
    res[id] = cloneCageV2(base[id].cage!);
  }
  return res;
})();

/**
 * Generates preset procedural V2 control cages with synchronized seam boundaries.
 */
export function createPresetCagesV2(
  preset: 'baseline' | 'high_downforce' | 'low_drag'
): Record<PartId, CageV2> {
  const grids = createPresetGrids(preset);
  const base = createBaselineParts();
  const res = {} as Record<PartId, CageV2>;
  for (const id of PART_ORDER) {
    res[id] = createCageV2(grids[id], base[id].centerlineLocked);
  }
  return res;
}
