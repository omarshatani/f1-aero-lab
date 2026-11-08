import {
  AeroPartData,
  LegalityBox,
  LegalityCheckResult,
  NodeIndex,
  PartId,
  Vec3,
} from '../types/aero';

export const PART_ORDER: PartId[] = [
  'front_wing',
  'nosecone',
  'floor_boards',
  'floor',
  'sidepods',
  'diffuser',
  'rear_wing',
];

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

const fiaGrid = (ptsFiaMm: Array<Array<[number, number, number]>>): Vec3[][] =>
  ptsFiaMm.map((col) => col.map(([xF, yFia, zFia]) => fiaMmToWorld(xF, yFia, zFia)));

/**
 * Create the official FIA 2026 baseline aerodynamic parts, Reference Volumes (Appendix 1),
 * and 3D Free-Form Deformation (FFD) control lattices matching the FIA 2026 Concept Car.
 */
export function createBaselineParts(): Record<PartId, AeroPartData> {
  return {
    front_wing: {
      id: 'front_wing',
      name: 'Front Wing, Endplate & Footplate',
      shortName: 'Front Wing',
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
        // u=0: Centerline spoon (Y=0)
        [
          [-1190, 0, 82],
          [-990, 0, 108],
          [-790, 0, 148],
          [-600, 0, 195],
        ],
        // u=1: Inboard active-flap span (Y=275)
        [
          [-1130, 275, 90],
          [-940, 275, 122],
          [-755, 275, 175],
          [-570, 275, 232],
        ],
        // u=2: Mid-outboard cascade (Y=540)
        [
          [-1045, 540, 112],
          [-875, 540, 145],
          [-705, 540, 198],
          [-535, 540, 258],
        ],
        // u=3: Endplate base & diveplane junction (Y=670)
        [
          [-985, 670, 130],
          [-815, 670, 162],
          [-640, 670, 215],
          [-465, 670, 275],
        ],
        // u=4: Upper endplate & Y=900 footplate wingtip
        [
          [-950, 820, 230],
          [-790, 845, 275],
          [-620, 865, 320],
          [-455, 880, 355],
        ],
      ]),
    },

    nosecone: {
      id: 'nosecone',
      name: 'Nosecone & Wing Pylons',
      shortName: 'Nosecone',
      articleRef: 'FIA 2026 Art. 3.7.1 (RV-NOSE)',
      description:
        'Impact structure fairing and twin front-wing pylons. Channels clean high-energy flow beneath the front bulkhead into the floor bib.',
      role: 'body_fairing',
      accentHex: '#38bdf8',
      centerlineLocked: true,
      thickness: 0.045,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_nose_main',
          label: 'RV-NOSE Tapered Fairing',
          xFFront: -1300,
          xFRear: 75,
          yMinFront: 0,
          yMaxFront: 165,
          yMinRear: 0,
          yMaxRear: 268,
          zMinFront: 115,
          zMaxFront: 310,
          zMinRear: 185,
          zMaxRear: 645,
        }),
        makeFiaBox({
          id: 'rv_fw_pylon',
          label: 'RV-FW-PYLON Mounts',
          xFFront: -1240,
          xFRear: -780,
          yMinFront: 0,
          yMaxFront: 160,
          yMinRear: 0,
          yMaxRear: 165,
          zMinFront: 60,
          zMaxFront: 240,
          zMinRear: 85,
          zMaxRear: 280,
        }),
      ],
      cols: 3,
      rows: 4,
      grid: fiaGrid([
        // u=0: Upper nose spine (Y=0)
        [
          [-1220, 0, 195],
          [-820, 0, 315],
          [-380, 0, 455],
          [20, 0, 565],
        ],
        // u=1: Nose mid-shoulder
        [
          [-1190, 95, 175],
          [-800, 135, 285],
          [-370, 175, 415],
          [20, 210, 520],
        ],
        // u=2: Lower pylon / keel flank
        [
          [-1150, 115, 125],
          [-790, 155, 205],
          [-365, 195, 285],
          [20, 230, 345],
        ],
      ]),
    },

    floor_boards: {
      id: 'floor_boards',
      name: '2026 Wake-Control Floor Boards',
      shortName: 'Floor Boards',
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
          xFRear: 1555,
          yMinFront: 655,
          yMaxFront: 904,
          yMinRear: 655,
          yMaxRear: 904,
          zMinFront: 30,
          zMaxFront: 432,
          zMinRear: 30,
          zMaxRear: 410,
        }),
        makeFiaBox({
          id: 'rv_floor_foot',
          label: 'RV-FLOOR-FOOT Footplate',
          xFFront: 605,
          xFRear: 1555,
          yMinFront: 575,
          yMaxFront: 904,
          yMinRear: 575,
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
        // u=0: Footplate / lower board root
        [
          [720, 680, 55],
          [980, 720, 55],
          [1220, 735, 55],
          [1440, 720, 55],
        ],
        // u=1: Mid-height wake vane cascade
        [
          [740, 760, 195],
          [990, 815, 195],
          [1230, 835, 185],
          [1445, 790, 175],
        ],
        // u=2: Upper wake deflector slat crest
        [
          [760, 790, 345],
          [1000, 850, 350],
          [1240, 865, 335],
          [1450, 825, 310],
        ],
      ]),
    },

    floor: {
      id: 'floor',
      name: 'Main Floor, Bib & Edge Bodywork',
      shortName: 'Main Floor',
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
          xFFront: 350,
          xFRear: 1150,
          yMinFront: 0,
          yMaxFront: 265,
          yMinRear: 0,
          yMaxRear: 450,
          zMinFront: -10,
          zMaxFront: 170,
          zMinRear: -10,
          zMaxRear: 195,
        }),
        makeFiaBox({
          id: 'rv_floor_body_main',
          label: 'RV-FLOOR-BODY Step Plane',
          xFFront: 635,
          xFRear: 2765,
          yMinFront: 0,
          yMaxFront: 775,
          yMinRear: 0,
          yMaxRear: 725,
          zMinFront: -10,
          zMaxFront: 225,
          zMinRear: -10,
          zMaxRear: 195,
        }),
      ],
      cols: 4,
      rows: 5,
      grid: fiaGrid([
        // u=0: Plank & centerline keel (Y=0)
        [
          [480, 0, 18],
          [1050, 0, 12],
          [1620, 0, 10],
          [2180, 0, 12],
          [2700, 0, 18],
        ],
        // u=1: Inner step-plane tunnel roof
        [
          [760, 260, 85],
          [1180, 310, 68],
          [1680, 310, 56],
          [2200, 300, 60],
          [2700, 280, 68],
        ],
        // u=2: Mid-floor suction channel
        [
          [820, 510, 88],
          [1220, 540, 66],
          [1700, 540, 55],
          [2220, 520, 58],
          [2700, 480, 65],
        ],
        // u=3: Outer floor edge & vortex seal lip (Y~735 -> 680)
        [
          [900, 730, 62],
          [1300, 745, 48],
          [1750, 738, 42],
          [2250, 718, 44],
          [2700, 685, 50],
        ],
      ]),
    },

    sidepods: {
      id: 'sidepods',
      name: 'Sidepods & Coke-Bottle Engine Cover',
      shortName: 'Sidepods',
      articleRef: 'FIA 2026 Art. 3.8 (RV-SIDEPOD / RV-EC)',
      description:
        'Radiator intake, deep lower undercut, and tapered rear coke-bottle bodywork (max Y=715mm tapering to 225mm) feeding clean air to the beamless rear.',
      role: 'body_fairing',
      accentHex: '#f59e0b',
      centerlineLocked: false,
      thickness: 0.04,
      legalityBoxes: [
        makeFiaBox({
          id: 'rv_sidepod_front',
          label: 'RV-SIDEPOD Inlet & Shoulder',
          xFFront: 880,
          xFRear: 1850,
          yMinFront: 145,
          yMaxFront: 725,
          yMinRear: 145,
          yMaxRear: 755,
          zMinFront: 50,
          zMaxFront: 655,
          zMinRear: 50,
          zMaxRear: 655,
        }),
        makeFiaBox({
          id: 'rv_ec_cokebottle',
          label: 'RV-EC Tapered Coke-Bottle',
          xFFront: 1800,
          xFRear: 3360,
          yMinFront: 120,
          yMaxFront: 755,
          yMinRear: 80,
          yMaxRear: 265,
          zMinFront: 50,
          zMaxFront: 655,
          zMinRear: 50,
          zMaxRear: 585,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        // u=0: Inner shoulder along cockpit / engine cover
        [
          [980, 250, 560],
          [1700, 255, 555],
          [2500, 215, 500],
          [3250, 145, 430],
        ],
        // u=1: Upper Coanda downwash ramp
        [
          [1020, 460, 535],
          [1720, 480, 495],
          [2520, 365, 385],
          [3250, 195, 285],
        ],
        // u=2: Outer sidepod cheek (tapers sharply into coke-bottle!)
        [
          [1060, 665, 445],
          [1750, 705, 415],
          [2520, 495, 325],
          [3250, 225, 240],
        ],
        // u=3: Lower undercut belly (pull inward in Y or upward in Z for deeper undercut!)
        [
          [1080, 565, 205],
          [1750, 585, 190],
          [2520, 425, 165],
          [3250, 205, 155],
        ],
      ]),
    },

    diffuser: {
      id: 'diffuser',
      name: 'Rear Diffuser & Boat-Tail',
      shortName: 'Diffuser',
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
          xFFront: 2720,
          xFRear: 3620,
          yMinFront: 0,
          yMaxFront: 465,
          yMinRear: 0,
          yMaxRear: 398,
          zMinFront: -10,
          zMaxFront: 195,
          zMinRear: 15,
          zMaxRear: 315,
        }),
        makeFiaBox({
          id: 'rv_tail_structure',
          label: 'RV-TAIL Boat-Tail Keel',
          xFFront: 3250,
          xFRear: 4140,
          yMinFront: 0,
          yMaxFront: 135,
          yMinRear: 0,
          yMaxRear: 135,
          zMinFront: 0,
          zMaxFront: 475,
          zMinRear: 80,
          zMaxRear: 480,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        // u=0: Central boat-tail keel (Y=0)
        [
          [2760, 0, 25],
          [3060, 0, 75],
          [3350, 0, 148],
          [3590, 0, 218],
        ],
        // u=1: Inner diffuser expansion roof
        [
          [2760, 155, 68],
          [3060, 155, 125],
          [3350, 150, 195],
          [3580, 145, 258],
        ],
        // u=2: Outer diffuser tunnel roof
        [
          [2760, 310, 65],
          [3060, 305, 120],
          [3350, 290, 188],
          [3580, 280, 248],
        ],
        // u=3: Diffuser outer sidewall & corner strake
        [
          [2760, 425, 52],
          [3060, 410, 95],
          [3350, 392, 150],
          [3580, 380, 198],
        ],
      ]),
    },

    rear_wing: {
      id: 'rear_wing',
      name: 'Rear Wing, Endplates & Pylon',
      shortName: 'Rear Wing',
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
          xFFront: 3580,
          xFRear: 4090,
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
          xFFront: 3560,
          xFRear: 4155,
          yMinFront: 330,
          yMaxFront: 578,
          yMinRear: 330,
          yMaxRear: 578,
          zMinFront: 175,
          zMaxFront: 882,
          zMinRear: 185,
          zMaxRear: 882,
        }),
        makeFiaBox({
          id: 'rv_rw_pylon',
          label: 'RV-RW-PYLON Swan-Neck',
          xFFront: 3400,
          xFRear: 3840,
          yMinFront: 0,
          yMaxFront: 95,
          yMinRear: 0,
          yMaxRear: 95,
          zMinFront: 280,
          zMaxFront: 785,
          zMinRear: 320,
          zMaxRear: 795,
        }),
      ],
      cols: 4,
      rows: 4,
      grid: fiaGrid([
        // u=0: Centerline mainplane -> active upper flap (Y=0)
        [
          [3645, 0, 735],
          [3785, 0, 760],
          [3920, 0, 810],
          [4035, 0, 858],
        ],
        // u=1: Mid-span active cascade (Y=270)
        [
          [3655, 270, 740],
          [3795, 270, 765],
          [3925, 270, 815],
          [4040, 270, 862],
        ],
        // u=2: Outboard wingtip & rolled shoulder (Y=530)
        [
          [3665, 530, 742],
          [3805, 530, 768],
          [3935, 530, 812],
          [4055, 530, 855],
        ],
        // u=3: Lower endplate skirt (RV-RWEP-BODY)
        [
          [3640, 485, 420],
          [3800, 505, 440],
          [3960, 520, 470],
          [4115, 535, 510],
        ],
      ]),
    },
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
    // Steeper front wing trailing flap + outboard endplate curl
    for (let u = 0; u < 4; u++) {
      result.front_wing[u][2].y += 0.018;
      result.front_wing[u][3].y += 0.032;
    }
    result.front_wing[4][2].x += 0.018;
    result.front_wing[4][3].x += 0.020;

    // Stronger 2026 floor board wake deflection
    for (let u = 1; u <= 2; u++) {
      result.floor_boards[u][2].x += 0.022;
      result.floor_boards[u][3].x += 0.028;
    }

    // Tighter Venturi floor step-plane & sealed outer edge
    result.floor[1][2].y -= 0.010;
    result.floor[2][2].y -= 0.010;
    result.floor[3][2].y -= 0.010;
    result.floor[3][3].y -= 0.008;

    // Deeper sidepod undercut + steeper Coanda downwash ramp
    result.sidepods[3][0].x -= 0.065;
    result.sidepods[3][1].x -= 0.075;
    result.sidepods[1][2].y -= 0.042;
    result.sidepods[1][3].y -= 0.038;

    // Higher diffuser expansion ramp (near optimal limit)
    for (let u = 0; u < 3; u++) {
      result.diffuser[u][2].y += 0.018;
      result.diffuser[u][3].y += 0.032;
    }

    // High-load Monaco rear wing cascade within Z=880mm ceiling
    for (let u = 0; u < 3; u++) {
      result.rear_wing[u][0].y -= 0.022;
      result.rear_wing[u][1].y -= 0.010;
      result.rear_wing[u][3].y += 0.018;
    }
  } else if (preset === 'low_drag') {
    // Flatter low-drag front wing cascade
    for (let u = 0; u < 4; u++) {
      result.front_wing[u][2].y -= 0.018;
      result.front_wing[u][3].y -= 0.034;
    }

    // Streamlined low-drag floor boards
    for (let u = 0; u < 3; u++) {
      result.floor_boards[u][2].x -= 0.018;
      result.floor_boards[u][3].x -= 0.024;
    }

    // Tighter, slimmer coke-bottle sidepods
    for (let v = 0; v < 4; v++) {
      result.sidepods[2][v].x -= 0.045;
      result.sidepods[1][v].y -= 0.022;
    }

    // Monza spoon / low-drag rear wing profile
    for (let u = 0; u < 3; u++) {
      result.rear_wing[u][2].y -= 0.022;
      result.rear_wing[u][3].y -= 0.042;
    }
  }

  // Ensure every preset node is clamped cleanly within official FIA 2026 boxes
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
