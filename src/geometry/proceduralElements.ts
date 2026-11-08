import { clampPointToLegalityBoxes, fiaMmToWorld } from '../regulations/fia2026';
import { AeroPartData, LegalityBox, ProceduralElementConfig } from '../types/aero';

/**
 * Compute a deterministic signature string of a part's procedural elements state
 * so PartFFDController only rebuilds its welded geometry when an element is toggled or tuned.
 */
export function computeProceduralSignature(part: AeroPartData): string {
  if (!part.proceduralElements || part.proceduralElements.length === 0) {
    return '';
  }
  return part.proceduralElements
    .map(
      (el) =>
        `${el.id}:${el.enabled ? 1 : 0}:${el.pitchDeg.toFixed(2)}:${el.scale.toFixed(2)}:${el.count}`
    )
    .join('|');
}

interface MeshBuilder {
  positions: number[];
  indices: number[];
}

/**
 * Add a closed 3D hexahedral airfoil/vane/strake segment defined by 8 FIA-mm corners on the +Y_FIA (+X world) side,
 * automatically clamping every vertex to the part's FIA LegalityBoxes and mirroring across X = 0 (-Y_FIA).
 *
 * Corner ordering:
 * 0: front-inboard-bottom, 1: front-outboard-bottom, 2: front-outboard-top, 3: front-inboard-top
 * 4: rear-inboard-bottom,  5: rear-outboard-bottom,  6: rear-outboard-top,  7: rear-inboard-top
 */
function addBilateralHexBoxFia(
  builder: MeshBuilder,
  cornersFia: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ],
  boxes: LegalityBox[]
): void {
  const worldPosPlus: Array<[number, number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const [xF, yFia, zFia] = cornersFia[i];
    const w = fiaMmToWorld(xF, Math.max(2, yFia), zFia);
    const clamped = clampPointToLegalityBoxes(
      { x: Math.abs(w.x), y: w.y, z: w.z },
      boxes,
      false
    );
    worldPosPlus.push([Math.max(0.002, clamped.x), clamped.y, clamped.z]);
  }

  // 12 triangles (6 quads) for +X side
  const basePlus = builder.positions.length / 3;
  for (let i = 0; i < 8; i++) {
    const [vx, vy, vz] = worldPosPlus[i];
    builder.positions.push(vx, vy, vz);
  }

  const hexTris: Array<[number, number, number]> = [
    // Top (+Y)
    [3, 2, 6],
    [3, 6, 7],
    // Bottom (-Y)
    [0, 5, 1],
    [0, 4, 5],
    // Outboard (+X)
    [1, 5, 6],
    [1, 6, 2],
    // Inboard (-X)
    [0, 3, 7],
    [0, 7, 4],
    // Front (-Z)
    [0, 1, 2],
    [0, 2, 3],
    // Rear (+Z)
    [4, 6, 5],
    [4, 7, 6],
  ];

  for (const [a, b, c] of hexTris) {
    builder.indices.push(basePlus + a, basePlus + b, basePlus + c);
  }

  // Mirror across X = 0 for -X side (reversed winding so outward normals stay consistent)
  const baseMinus = builder.positions.length / 3;
  for (let i = 0; i < 8; i++) {
    const [vx, vy, vz] = worldPosPlus[i];
    builder.positions.push(-vx, vy, vz);
  }

  for (const [a, b, c] of hexTris) {
    builder.indices.push(baseMinus + a, baseMinus + c, baseMinus + b);
  }
}

/**
 * Helper to build a pitched, cambered multi-segment 3D winglet/vane/strake in FIA millimeters.
 */
function buildCamberedVaneFia(
  builder: MeshBuilder,
  boxes: LegalityBox[],
  opts: {
    xFFront: number;
    xFRear: number;
    yInboard: number;
    yOutboard: number;
    zFront: number;
    zRear: number;
    thicknessMm: number;
    camberMm: number;
    pitchDeg: number;
    yawFlareMm?: number;
    segments?: number;
  }
): void {
  const segs = opts.segments ?? 3;
  const pitchRad = (opts.pitchDeg * Math.PI) / 180;
  const xMid = 0.5 * (opts.xFFront + opts.xFRear);
  const zMid = 0.5 * (opts.zFront + opts.zRear);
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const yawFlare = opts.yawFlareMm ?? 0;

  const evalSlice = (
    t: number
  ): [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ] => {
    const xRaw = opts.xFFront + (opts.xFRear - opts.xFFront) * t;
    const arch = Math.sin(Math.PI * t) * opts.camberMm;
    const zRaw = opts.zFront + (opts.zRear - opts.zFront) * t + arch;

    const dx = xRaw - xMid;
    const dz = zRaw - zMid;
    const xRot = xMid + dx * cosP - dz * sinP;
    const zRot = zMid + dx * sinP + dz * cosP;

    const taper = 1 - 0.35 * Math.abs(2 * t - 1);
    const halfThk = Math.max(2.5, 0.5 * opts.thicknessMm * taper);
    const yShift = yawFlare * t;
    const y0 = opts.yInboard + yShift;
    const y1 = opts.yOutboard + yShift;

    return [
      [xRot, y0, zRot - halfThk],
      [xRot, y1, zRot - halfThk],
      [xRot, y1, zRot + halfThk],
      [xRot, y0, zRot + halfThk],
    ];
  };

  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const s0 = evalSlice(t0);
    const s1 = evalSlice(t1);
    addBilateralHexBoxFia(
      builder,
      [s0[0], s0[1], s0[2], s0[3], s1[0], s1[1], s1[2], s1[3]],
      boxes
    );
  }
}

function appendElementGeometry(
  builder: MeshBuilder,
  part: AeroPartData,
  el: ProceduralElementConfig
): void {
  const boxes = part.legalityBoxes;
  const scale = Math.max(0.5, Math.min(1.6, el.scale));
  const count = Math.max(1, Math.round(el.count));
  const pitch = el.pitchDeg;

  switch (el.id) {
    case 'fw_diveplane': {
      for (let idx = 0; idx < count; idx++) {
        const zOff = idx * 55;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: -950 + idx * 45,
          xFRear: -610 + idx * 35,
          yInboard: 825,
          yOutboard: 825 + 62 * scale,
          zFront: 185 + zOff,
          zRear: 255 + zOff,
          thicknessMm: 10 * scale,
          camberMm: 14 * scale,
          pitchDeg: pitch,
          yawFlareMm: 18 * scale,
        });
      }
      break;
    }

    case 'fw_gurney': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: -585,
        xFRear: -545,
        yInboard: 65,
        yOutboard: 645,
        zFront: 225,
        zRear: 225 + 28 * scale,
        thicknessMm: 8 * scale,
        camberMm: 4 * scale,
        pitchDeg: pitch,
        segments: 2,
      });
      break;
    }

    case 'nose_cape_vanes': {
      for (let idx = 0; idx < count; idx++) {
        const yBase = 125 + idx * 42;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: -680,
          xFRear: -140,
          yInboard: yBase,
          yOutboard: yBase + 16 * scale,
          zFront: 165,
          zRear: 225,
          thicknessMm: 38 * scale,
          camberMm: 10 * scale,
          pitchDeg: pitch,
          yawFlareMm: 28 * scale,
        });
      }
      break;
    }

    case 'fsusp_duct_winglet': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const zBase = 245 + frac * 145;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: -135 + idx * 25,
          xFRear: 155 + idx * 20,
          yInboard: 465,
          yOutboard: 465 + 115 * scale,
          zFront: zBase,
          zRear: zBase + 32 * scale,
          thicknessMm: 11 * scale,
          camberMm: 12 * scale,
          pitchDeg: pitch,
        });
      }
      break;
    }

    case 'mono_halo_boomerang': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: 640,
        xFRear: 1020,
        yInboard: 95,
        yOutboard: 95 + 215 * scale,
        zFront: 685,
        zRear: 725,
        thicknessMm: 14 * scale,
        camberMm: 16 * scale,
        pitchDeg: pitch,
        yawFlareMm: 35 * scale,
      });
      break;
    }

    case 'fb_aux_slat': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const zBase = 215 + frac * 135;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: 720 + idx * 60,
          xFRear: 1360 + idx * 40,
          yInboard: 735,
          yOutboard: 735 + 110 * scale,
          zFront: zBase,
          zRear: zBase + 38 * scale,
          thicknessMm: 12 * scale,
          camberMm: 15 * scale,
          pitchDeg: pitch,
          yawFlareMm: -32 * scale,
        });
      }
      break;
    }

    case 'floor_fences': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const yPos = 245 + frac * 365;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: 680 + idx * 35,
          xFRear: 1260 + idx * 45,
          yInboard: yPos,
          yOutboard: yPos + 12 * scale,
          zFront: 32,
          zRear: 48,
          thicknessMm: 52 * scale,
          camberMm: 8 * scale,
          pitchDeg: pitch * 0.4,
          yawFlareMm: (24 + pitch * 2.2) * scale,
        });
      }
      break;
    }

    case 'floor_edge_scroll': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: 1020,
        xFRear: 2480,
        yInboard: 665,
        yOutboard: 665 + 68 * scale,
        zFront: 52,
        zRear: 62,
        thicknessMm: 14 * scale,
        camberMm: 12 * scale,
        pitchDeg: pitch * 0.5,
        segments: 4,
      });
      break;
    }

    case 'sp_cooling_louvers': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const xStart = 1320 + frac * 880;
        const zStart = 535 - frac * 75;
        const yStart = 265 - frac * 35;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: xStart,
          xFRear: xStart + 115 * scale,
          yInboard: yStart,
          yOutboard: yStart + 165 * scale,
          zFront: zStart,
          zRear: zStart + 22 * scale,
          thicknessMm: 8 * scale,
          camberMm: 6 * scale,
          pitchDeg: pitch,
          segments: 2,
        });
      }
      break;
    }

    case 'ec_sharkfin_ext': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: 1720,
        xFRear: 3360,
        yInboard: 3,
        yOutboard: 3 + 11 * scale,
        zFront: 860,
        zRear: 720,
        thicknessMm: 145 * scale,
        camberMm: 18 * scale,
        pitchDeg: pitch * 0.35,
        segments: 4,
      });
      break;
    }

    case 'rsusp_upwash_winglets': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const zBase = 215 + frac * 215;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: 3190 + idx * 25,
          xFRear: 3540 + idx * 15,
          yInboard: 415,
          yOutboard: 415 + 115 * scale,
          zFront: zBase,
          zRear: zBase + 38 * scale,
          thicknessMm: 11 * scale,
          camberMm: 14 * scale,
          pitchDeg: pitch,
        });
      }
      break;
    }

    case 'diff_strakes': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const yPos = 140 + frac * 255;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: 2820,
          xFRear: 3560,
          yInboard: yPos,
          yOutboard: yPos + 12 * scale,
          zFront: 45,
          zRear: 175,
          thicknessMm: 56 * scale,
          camberMm: 14 * scale,
          pitchDeg: pitch * 0.4,
          yawFlareMm: 16 * scale,
        });
      }
      break;
    }

    case 'diff_gurney': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: 3545,
        xFRear: 3605,
        yInboard: 35,
        yOutboard: 435,
        zFront: 215,
        zRear: 215 + 32 * scale,
        thicknessMm: 9 * scale,
        camberMm: 5 * scale,
        pitchDeg: pitch,
        segments: 2,
      });
      break;
    }

    case 'rw_gurney': {
      buildCamberedVaneFia(builder, boxes, {
        xFFront: 4020,
        xFRear: 4075,
        yInboard: 20,
        yOutboard: 525,
        zFront: 845,
        zRear: 845 + 26 * scale,
        thicknessMm: 8 * scale,
        camberMm: 4 * scale,
        pitchDeg: pitch,
        segments: 2,
      });
      break;
    }

    case 'rw_endplate_vanes': {
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const zBase = 340 + frac * 240;
        buildCamberedVaneFia(builder, boxes, {
          xFFront: 3650 + idx * 35,
          xFRear: 4040 + idx * 15,
          yInboard: 515,
          yOutboard: 515 + 48 * scale,
          zFront: zBase,
          zRear: zBase + 36 * scale,
          thicknessMm: 10 * scale,
          camberMm: 12 * scale,
          pitchDeg: pitch,
          yawFlareMm: 14 * scale,
        });
      }
      break;
    }
  }
}

/**
 * Build closed bilateral (+X and -X) 3D triangle mesh geometry for all enabled
 * procedural aero elements on a part, strictly clamped to its FIA Reference Volumes.
 */
export function buildProceduralElementsForPart(part: AeroPartData): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const builder: MeshBuilder = {
    positions: [],
    indices: [],
  };

  if (part.proceduralElements && part.proceduralElements.length > 0) {
    for (const el of part.proceduralElements) {
      if (!el.enabled) continue;
      appendElementGeometry(builder, part, el);
    }
  }

  return {
    positions: new Float32Array(builder.positions),
    indices: new Uint32Array(builder.indices),
  };
}
