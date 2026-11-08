import {
  checkPartLegality,
  createBaselineParts,
  fiaMmToWorld,
  PART_ORDER,
  worldToFiaMm,
} from '../src/regulations/fia2026';
import { NodeIndex, PartId, Vec3 } from '../src/types/aero';

console.log('--- REFINING V2 PROCEDURAL CAGES WITH PHYSICAL SHARED SEAMS ---');

const parts = createBaselineParts();

interface SeamLinkDef {
  id: string;
  label: string;
  partA: PartId;
  partB: PartId;
  nodesA: NodeIndex[];
  nodesB: NodeIndex[];
  targetCoords: Array<[number, number, number]>; // in FIA mm [xF, yFia, zFia]
}

const physicalSeams: SeamLinkDef[] = [
  // 1. Nosecone trailing edge <-> Monocoque leading edge (Chassis Bulkhead A-A)
  {
    id: 'seam_nose_monocoque',
    label: 'Nosecone to Monocoque Bulkhead',
    partA: 'nosecone',
    partB: 'monocoque',
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    targetCoords: [
      [-50, 0, 540],     // Centerline top
      [-50, 215, 500],   // Mid-flank
      [-50, 240, 300],   // Lower corner
    ],
  },

  // 2. Monocoque trailing edge <-> Engine Cover leading edge (Cockpit Rear / Airbox Entry)
  {
    id: 'seam_monocoque_engine_cover',
    label: 'Monocoque Cockpit Rear to Engine Cover',
    partA: 'monocoque',
    partB: 'engine_cover',
    nodesA: [{ u: 0, v: 3 }, { u: 1, v: 3 }, { u: 2, v: 3 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }],
    targetCoords: [
      [1550, 0, 860],    // Roll-hoop spine (<= 870mm monocoque limit)
      [1550, 200, 720],  // Shoulder
      [1550, 270, 500],  // Lower flank
    ],
  },

  // 3. Floor trailing edge <-> Diffuser leading edge (Floor Kickline)
  {
    id: 'seam_floor_diffuser',
    label: 'Underbody Floor to Diffuser Ramp Kickline',
    partA: 'floor',
    partB: 'diffuser',
    nodesA: [{ u: 0, v: 4 }, { u: 1, v: 4 }, { u: 2, v: 4 }, { u: 3, v: 4 }],
    nodesB: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 3, v: 0 }],
    targetCoords: [
      [2720, 0, 22],     // Centerline keel
      [2720, 200, 68],   // Inboard tunnel
      [2720, 380, 65],   // Outboard tunnel
      [2720, 495, 51],   // Outer diffuser wall (<= 505mm diffuser limit)
    ],
  },

  // 4. Sidepod inboard shoulder <-> Engine cover flank
  {
    id: 'seam_sidepods_engine_cover',
    label: 'Sidepod Shoulder to Engine Cover Flank',
    partA: 'sidepods',
    partB: 'engine_cover',
    nodesA: [{ u: 0, v: 1 }, { u: 0, v: 2 }],
    nodesB: [{ u: 2, v: 0 }, { u: 2, v: 1 }],
    targetCoords: [
      [1650, 245, 555],  // Forward junction
      [2400, 210, 490],  // Mid coke-bottle junction
    ],
  },

  // 5. Floor boards footplate <-> Floor edge
  {
    id: 'seam_floor_boards_floor',
    label: 'Floor Board Footplate to Floor Edge',
    partA: 'floor_boards',
    partB: 'floor',
    nodesA: [{ u: 0, v: 1 }, { u: 0, v: 2 }],
    nodesB: [{ u: 3, v: 0 }, { u: 3, v: 1 }],
    targetCoords: [
      [950, 725, 58],    // Forward footplate
      [1250, 740, 50],   // Mid footplate
    ],
  },
];

// Apply target coordinates to both parts
for (const seam of physicalSeams) {
  const pA = parts[seam.partA];
  const pB = parts[seam.partB];
  for (let i = 0; i < seam.nodesA.length; i++) {
    const [xF, yFia, zFia] = seam.targetCoords[i];
    const wPt = fiaMmToWorld(xF, yFia, zFia);

    const nA = seam.nodesA[i];
    pA.grid[nA.u][nA.v] = { x: wPt.x, y: wPt.y, z: wPt.z };

    const nB = seam.nodesB[i];
    pB.grid[nB.u][nB.v] = { x: wPt.x, y: wPt.y, z: wPt.z };
  }
}

// Check legality of all 11 parts
console.log('\n--- VERIFYING FIA LEGALITY AFTER PHYSICAL SEAM WELDING ---');
let allLegal = true;
for (const id of PART_ORDER) {
  const part = parts[id];
  const flatPts: Vec3[] = [];
  for (const col of part.grid) {
    for (const pt of col) {
      flatPts.push(pt);
    }
  }
  const leg = checkPartLegality(part, flatPts);
  console.log(
    `Part "${id.padEnd(16)}": isLegal=${leg.isLegal ? '✓' : '✗'}, minClearance=${leg.minClearanceMm.toFixed(1).padStart(5)} mm, oobNodes=${leg.violatingNodes.length}`
  );
  if (!leg.isLegal) {
    allLegal = false;
    for (const vn of leg.violatingNodes) {
      const pt = part.grid[vn.u][vn.v];
      const fia = worldToFiaMm(pt);
      console.log(`    OOB node [${vn.u}, ${vn.v}]: FIA (${Math.round(fia.xF)}, ${Math.round(fia.yFia)}, ${Math.round(fia.zFia)})`);
    }
  }
}

console.log('\nAll 11 parts 100% legal after shared seam welding:', allLegal);
