import { clampPointToLegalityBoxes } from '../regulations/fia2026';
import { evalCurveAlongArray } from '../surface/surfaceMath';
import {
  AeroPartData,
  LegalityBox,
  ProceduralElementConfig,
  Vec3,
} from '../types/aero';

/**
 * Compute a deterministic signature string of a part's procedural elements state
 * so procedural geometry is only rebuilt when an element is toggled or tuned.
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

export interface SurfaceFrame {
  origin: Vec3;
  tangentU: Vec3; // Outboard spanwise unit vector (+X)
  tangentV: Vec3; // Rearward chordwise unit vector (+Z)
  normal: Vec3;   // Upward/outward surface unit vector (+Y)
}

/**
 * Evaluates the camber point P(su, sv) on the part's active control cage (+X half-car).
 */
export function samplePartCamber(part: AeroPartData, su: number, sv: number): Vec3 {
  const grid = part.cage?.detail ?? part.grid;
  const cols = grid.length;

  const colSampled: Vec3[] = [];
  for (let u = 0; u < cols; u++) {
    colSampled.push(evalCurveAlongArray(grid[u], sv, false));
  }

  const pt = evalCurveAlongArray(colSampled, su, part.centerlineLocked && su === 0);
  if (part.centerlineLocked && su === 0) {
    pt.x = 0;
  } else {
    pt.x = Math.max(0, pt.x);
  }
  return pt;
}

/**
 * Samples the local orthogonal surface frame (origin, tangentU, tangentV, normal)
 * at parametric coordinates (su, sv) on the part's active deformed surface.
 */
export function samplePartSurfaceFrame(
  part: AeroPartData,
  su: number,
  sv: number
): SurfaceFrame {
  const origin = samplePartCamber(part, su, sv);

  const dV = 0.02;
  const pV0 = samplePartCamber(part, su, Math.max(0, sv - dV));
  const pV1 = samplePartCamber(part, su, Math.min(1, sv + dV));
  let tvX = pV1.x - pV0.x;
  let tvY = pV1.y - pV0.y;
  let tvZ = pV1.z - pV0.z;
  const lenV = Math.hypot(tvX, tvY, tvZ) || 1;
  const tangentV: Vec3 = { x: tvX / lenV, y: tvY / lenV, z: tvZ / lenV };

  const dU = 0.02;
  const pU0 = samplePartCamber(part, Math.max(0, su - dU), sv);
  const pU1 = samplePartCamber(part, Math.min(1, su + dU), sv);
  let tuX = pU1.x - pU0.x;
  let tuY = pU1.y - pU0.y;
  let tuZ = pU1.z - pU0.z;
  const lenU = Math.hypot(tuX, tuY, tuZ) || 1;
  const tangentU: Vec3 = { x: tuX / lenU, y: tuY / lenU, z: tuZ / lenU };

  // Right-hand cross product tv x tu -> pointing +Y upward
  let nX = tangentV.y * tangentU.z - tangentV.z * tangentU.y;
  let nY = tangentV.z * tangentU.x - tangentV.x * tangentU.z;
  let nZ = tangentV.x * tangentU.y - tangentV.y * tangentU.x;
  const lenN = Math.hypot(nX, nY, nZ) || 1;
  const normal: Vec3 = { x: nX / lenN, y: nY / lenN, z: nZ / lenN };

  return { origin, tangentU, tangentV, normal };
}

interface MeshBuilder {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

/**
 * Add a closed 3D hexahedral box defined by 8 world-space points on the +X half-car,
 * clamped to FIA Reference Volumes and mirrored across X = 0 for -X.
 */
function addBilateralHexBoxWorld(
  builder: MeshBuilder,
  corners: [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3],
  boxes: LegalityBox[],
  color: [number, number, number]
): void {
  const worldPosPlus: Array<[number, number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const c = corners[i];
    const clamped = clampPointToLegalityBoxes(
      { x: Math.abs(c.x), y: c.y, z: c.z },
      boxes,
      false
    );
    worldPosPlus.push([Math.max(0.002, clamped.x), clamped.y, clamped.z]);
  }

  const basePlus = builder.positions.length / 3;
  for (let i = 0; i < 8; i++) {
    const [vx, vy, vz] = worldPosPlus[i];
    builder.positions.push(vx, vy, vz);
    builder.normals.push(0, 1, 0); // Will be recomputed or shaded
    builder.colors.push(color[0], color[1], color[2]);
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

  // Mirror across X = 0 for -X side with inverted triangle winding
  const baseMinus = builder.positions.length / 3;
  for (let i = 0; i < 8; i++) {
    const [vx, vy, vz] = worldPosPlus[i];
    builder.positions.push(-vx, vy, vz);
    builder.normals.push(0, 1, 0);
    builder.colors.push(color[0], color[1], color[2]);
  }

  for (const [a, b, c] of hexTris) {
    builder.indices.push(baseMinus + a, baseMinus + c, baseMinus + b);
  }
}

/**
 * Builds a multi-segment cambered 3D aerodynamic vane anchored in the local surface frame.
 */
function buildAnchoredVane(
  builder: MeshBuilder,
  boxes: LegalityBox[],
  frame: SurfaceFrame,
  opts: {
    chordLengthM: number;
    spanWidthM: number;
    thicknessM: number;
    camberM: number;
    pitchDeg: number;
    yawFlareM?: number;
    normalOffsetM?: number;
    spanOffsetM?: number;
    segments?: number;
    color?: [number, number, number];
  }
): void {
  const segs = opts.segments ?? 3;
  const pitchRad = (opts.pitchDeg * Math.PI) / 180;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const color = opts.color ?? [0.15, 0.17, 0.20];
  const normOff = opts.normalOffsetM ?? 0;
  const spanOff = opts.spanOffsetM ?? 0;
  const flareM = opts.yawFlareM ?? 0;

  const evalSliceCorners = (t: number): [Vec3, Vec3, Vec3, Vec3] => {
    // Relative along chord (tangentV) from -chordLengthM/2 to +chordLengthM/2
    const vRaw = (t - 0.5) * opts.chordLengthM;
    const arch = Math.sin(Math.PI * t) * opts.camberM;

    // Pitch rotation around tangentU in the (tangentV, normal) plane
    const vRot = vRaw * cosP - arch * sinP;
    const nRot = normOff + vRaw * sinP + arch * cosP;

    const taper = 1.0 - 0.35 * Math.abs(2 * t - 1);
    const halfThk = Math.max(0.002, 0.5 * opts.thicknessM * taper);
    const uShift = spanOff + flareM * t;
    const u0 = uShift;
    const u1 = uShift + opts.spanWidthM;

    const toWorld = (uLocal: number, vLocal: number, nLocal: number): Vec3 => ({
      x:
        frame.origin.x +
        frame.tangentU.x * uLocal +
        frame.tangentV.x * vLocal +
        frame.normal.x * nLocal,
      y:
        frame.origin.y +
        frame.tangentU.y * uLocal +
        frame.tangentV.y * vLocal +
        frame.normal.y * nLocal,
      z:
        frame.origin.z +
        frame.tangentU.z * uLocal +
        frame.tangentV.z * vLocal +
        frame.normal.z * nLocal,
    });

    return [
      toWorld(u0, vRot, nRot - halfThk),
      toWorld(u1, vRot, nRot - halfThk),
      toWorld(u1, vRot, nRot + halfThk),
      toWorld(u0, vRot, nRot + halfThk),
    ];
  };

  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const s0 = evalSliceCorners(t0);
    const s1 = evalSliceCorners(t1);
    addBilateralHexBoxWorld(
      builder,
      [s0[0], s0[1], s0[2], s0[3], s1[0], s1[1], s1[2], s1[3]],
      boxes,
      color
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
      // Anchored to the outer front wing endplate (su = 0.98)
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.40 + frac * 0.38;
        const frame = samplePartSurfaceFrame(part, 0.98, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: (0.24 + idx * 0.02) * scale,
          spanWidthM: 0.065 * scale,
          thicknessM: 0.009 * scale,
          camberM: 0.012 * scale,
          pitchDeg: pitch,
          yawFlareM: 0.016 * scale,
          spanOffsetM: 0.005,
          normalOffsetM: 0.015,
        });
      }
      break;
    }

    case 'fw_gurney': {
      // Anchored to the front wing flap trailing edge (sv = 0.98)
      const frame = samplePartSurfaceFrame(part, 0.45, 0.98);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 0.016 * scale,
        spanWidthM: 0.58 * scale,
        thicknessM: 0.006 * scale,
        camberM: 0.003 * scale,
        pitchDeg: pitch,
        spanOffsetM: -0.28 * scale,
        normalOffsetM: 0.012 * scale,
        segments: 2,
      });
      break;
    }

    case 'nose_cape_vanes': {
      // Under-nose cape keel vanes
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const su = 0.18 + frac * 0.32;
        const frame = samplePartSurfaceFrame(part, su, 0.72);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.38 * scale,
          spanWidthM: 0.016 * scale,
          thicknessM: 0.032 * scale,
          camberM: 0.010 * scale,
          pitchDeg: pitch,
          normalOffsetM: -0.025 * scale,
          yawFlareM: 0.024 * scale,
        });
      }
      break;
    }

    case 'fsusp_duct_winglet': {
      // Front suspension brake duct winglets
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.38 + frac * 0.32;
        const frame = samplePartSurfaceFrame(part, 0.92, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.22 * scale,
          spanWidthM: 0.115 * scale,
          thicknessM: 0.011 * scale,
          camberM: 0.012 * scale,
          pitchDeg: pitch,
          normalOffsetM: 0.018 * scale,
        });
      }
      break;
    }

    case 'mono_halo_boomerang': {
      // Halo aerodynamic boomerang vane
      const frame = samplePartSurfaceFrame(part, 0.28, 0.65);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 0.32 * scale,
        spanWidthM: 0.195 * scale,
        thicknessM: 0.012 * scale,
        camberM: 0.015 * scale,
        pitchDeg: pitch,
        yawFlareM: 0.030 * scale,
        normalOffsetM: 0.022 * scale,
      });
      break;
    }

    case 'fb_aux_slat': {
      // Floor boards auxiliary wake-control slat
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.38 + frac * 0.32;
        const frame = samplePartSurfaceFrame(part, 0.88, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.44 * scale,
          spanWidthM: 0.095 * scale,
          thicknessM: 0.011 * scale,
          camberM: 0.014 * scale,
          pitchDeg: pitch,
          yawFlareM: -0.028 * scale,
          normalOffsetM: 0.016 * scale,
        });
      }
      break;
    }

    case 'floor_fences': {
      // Floor leading edge entry vortex fences
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const su = 0.22 + frac * 0.58;
        const frame = samplePartSurfaceFrame(part, su, 0.10);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.48 * scale,
          spanWidthM: 0.012 * scale,
          thicknessM: 0.048 * scale,
          camberM: 0.008 * scale,
          pitchDeg: pitch * 0.4,
          yawFlareM: (0.022 + pitch * 0.002) * scale,
          normalOffsetM: 0.015 * scale,
        });
      }
      break;
    }

    case 'floor_edge_scroll': {
      // Floor outer edge scroll lip
      const frame = samplePartSurfaceFrame(part, 0.98, 0.55);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 1.25 * scale,
        spanWidthM: 0.062 * scale,
        thicknessM: 0.012 * scale,
        camberM: 0.011 * scale,
        pitchDeg: pitch * 0.5,
        normalOffsetM: 0.010 * scale,
        segments: 4,
      });
      break;
    }

    case 'sp_cooling_louvers': {
      // Sidepod upper shoulder cooling louvers
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.32 + frac * 0.42;
        const frame = samplePartSurfaceFrame(part, 0.55, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.095 * scale,
          spanWidthM: 0.145 * scale,
          thicknessM: 0.007 * scale,
          camberM: 0.005 * scale,
          pitchDeg: pitch,
          normalOffsetM: 0.006 * scale,
          segments: 2,
        });
      }
      break;
    }

    case 'ec_sharkfin_ext': {
      // Engine cover dorsal sharkfin spine extension
      const frame = samplePartSurfaceFrame(part, 0.0, 0.62);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 1.25 * scale,
        spanWidthM: 0.010 * scale,
        thicknessM: 0.135 * scale,
        camberM: 0.016 * scale,
        pitchDeg: pitch * 0.35,
        normalOffsetM: 0.045 * scale,
        segments: 4,
      });
      break;
    }

    case 'rsusp_upwash_winglets': {
      // Rear suspension brake duct upwash winglets
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.38 + frac * 0.32;
        const frame = samplePartSurfaceFrame(part, 0.88, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.24 * scale,
          spanWidthM: 0.098 * scale,
          thicknessM: 0.010 * scale,
          camberM: 0.012 * scale,
          pitchDeg: pitch,
          normalOffsetM: 0.016 * scale,
        });
      }
      break;
    }

    case 'diff_strakes': {
      // Rear diffuser underfloor strakes
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const su = 0.20 + frac * 0.52;
        const frame = samplePartSurfaceFrame(part, su, 0.52);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.62 * scale,
          spanWidthM: 0.012 * scale,
          thicknessM: 0.052 * scale,
          camberM: 0.012 * scale,
          pitchDeg: pitch * 0.4,
          yawFlareM: 0.015 * scale,
          normalOffsetM: -0.022 * scale,
        });
      }
      break;
    }

    case 'diff_gurney': {
      // Diffuser exit lip Gurney flap
      const frame = samplePartSurfaceFrame(part, 0.42, 0.98);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 0.018 * scale,
        spanWidthM: 0.42 * scale,
        thicknessM: 0.008 * scale,
        camberM: 0.004 * scale,
        pitchDeg: pitch,
        spanOffsetM: -0.21 * scale,
        normalOffsetM: 0.014 * scale,
        segments: 2,
      });
      break;
    }

    case 'rw_gurney': {
      // Rear wing active upper flap trailing edge Gurney
      const frame = samplePartSurfaceFrame(part, 0.45, 0.98);
      buildAnchoredVane(builder, boxes, frame, {
        chordLengthM: 0.016 * scale,
        spanWidthM: 0.52 * scale,
        thicknessM: 0.007 * scale,
        camberM: 0.003 * scale,
        pitchDeg: pitch,
        spanOffsetM: -0.26 * scale,
        normalOffsetM: 0.012 * scale,
        segments: 2,
      });
      break;
    }

    case 'rw_endplate_vanes': {
      // Rear wing endplate outer wake-shedding vanes
      for (let idx = 0; idx < count; idx++) {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        const sv = 0.35 + frac * 0.38;
        const frame = samplePartSurfaceFrame(part, 0.98, sv);
        buildAnchoredVane(builder, boxes, frame, {
          chordLengthM: 0.28 * scale,
          spanWidthM: 0.045 * scale,
          thicknessM: 0.009 * scale,
          camberM: 0.011 * scale,
          pitchDeg: pitch,
          yawFlareM: 0.012 * scale,
          normalOffsetM: 0.014 * scale,
        });
      }
      break;
    }
  }
}

export interface EvaluatedProceduralElements {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/**
 * Builds closed bilateral (+X and -X) 3D triangle mesh geometry for all enabled
 * procedural aero elements on a part, anchored in the local surface frame and strictly
 * clamped to its FIA Reference Volumes.
 */
export function buildProceduralElementsForPart(part: AeroPartData): EvaluatedProceduralElements {
  const builder: MeshBuilder = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
  };

  if (part.proceduralElements && part.proceduralElements.length > 0) {
    for (const el of part.proceduralElements) {
      if (!el.enabled) continue;
      appendElementGeometry(builder, part, el);
    }
  }

  const vertexCount = builder.positions.length / 3;
  const triangleCount = builder.indices.length / 3;

  return {
    positions: new Float32Array(builder.positions),
    normals: new Float32Array(builder.normals),
    colors: new Float32Array(builder.colors),
    indices: new Uint32Array(builder.indices),
    vertexCount,
    triangleCount,
  };
}
