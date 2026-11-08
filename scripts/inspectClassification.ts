import fs from 'fs';
import { worldToFiaMm } from '../src/regulations/fia2026';
import { PartId } from '../src/types/aero';

// Read GLB
const buf = fs.readFileSync('public/f1_2026_concept_polygon_model.glb');
const chunk0Length = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

const chunk1Offset = 20 + chunk0Length;
const binData = buf.subarray(chunk1Offset + 8);

function classifyTriangle(wx: number, wy: number, wz: number): PartId | 'wheel' {
  const { xF, yFia, zFia } = worldToFiaMm({ x: wx, y: wy, z: wz });
  const ay = Math.abs(yFia);
  const xR = xF - 3400.0;

  const dFrontAxle = Math.hypot(xF, zFia - 328.7);
  if (dFrontAxle < 364.5 && ay > 588) return 'wheel';
  const dRearAxle = Math.hypot(xR, zFia - 328.6);
  if (dRearAxle < 365.5 && ay > 508) return 'wheel';

  if (xF > -302 && xF < 435 && ay > 248 && zFia > 88) return 'front_suspension';
  if (xR > -365 && xR < 245 && ay > 225 && zFia > 145 && zFia < 640) return 'rear_suspension';

  if (xF <= -295 && zFia <= 395 && !(ay < 185 && zFia > 196 && xF > -1060)) return 'front_wing';
  if (xF <= 65 && ay <= 268 && zFia >= 52 && zFia <= 645) return 'nosecone';
  if (xR >= 155 && zFia >= 175 && zFia <= 890 && ay <= 582 && !(ay < 325 && zFia < 580 && xR > 360)) return 'rear_wing';

  if (xF >= 2680 && zFia <= 380 && ay <= 580) return 'diffuser';
  if (xF >= 280 && xF <= 1520 && ay >= 360 && ay <= 880 && zFia <= 245) return 'floor_boards';
  if (xF >= 180 && xF <= 2700 && zFia <= 165 && ay <= 890) return 'floor';

  if (xF >= 380 && xF <= 2650 && ay >= 185 && ay <= 850 && zFia >= 110 && zFia <= 680) return 'sidepods';
  if (xF >= 1520 && zFia >= 220 && zFia <= 960 && ay <= 480) return 'engine_cover';

  return 'monocoque';
}

const partPointCounts: Record<string, number> = {};
const partBounds: Record<string, { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }> = {};

for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    const posAcc = gltf.accessors[prim.attributes.POSITION];
    const posView = gltf.bufferViews[posAcc.bufferView];
    const posByteOffset = (posView.byteOffset || 0) + (posAcc.byteOffset || 0);

    const idxAcc = gltf.accessors[prim.indices];
    const idxView = gltf.bufferViews[idxAcc.bufferView];
    const idxByteOffset = (idxView.byteOffset || 0) + (idxAcc.byteOffset || 0);

    const posFloats = new Float32Array(binData.buffer, binData.byteOffset + posByteOffset, posAcc.count * 3);
    const indices = idxAcc.componentType === 5123
      ? new Uint16Array(binData.buffer, binData.byteOffset + idxByteOffset, idxAcc.count)
      : new Uint32Array(binData.buffer, binData.byteOffset + idxByteOffset, idxAcc.count);

    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t] * 3;
      const i1 = indices[t + 1] * 3;
      const i2 = indices[t + 2] * 3;

      // GLB vertices are in mm or Three coords
      // Let's check coordinates:
      const p0x = posFloats[i0] * 0.001;
      const p0y = (posFloats[i0 + 1] + 30.8) * 0.001; // wait, let's verify if GLB coordinates are in mm
      // In GLB: max X is 4095 mm (z in world), max Y is 940 mm (x in world), max Z is 1068 mm (y in world)
      // Or is it xF, yFia, zFia?
      // Let's verify with the centroid
      const cFiaX = (posFloats[i0] + posFloats[i1] + posFloats[i2]) / 3;
      const cFiaY = (posFloats[i0 + 1] + posFloats[i1 + 1] + posFloats[i2 + 1]) / 3;
      const cFiaZ = (posFloats[i0 + 2] + posFloats[i1 + 2] + posFloats[i2 + 2]) / 3;

      const wx = cFiaY * 0.001;
      const wy = (cFiaZ + 30.8) * 0.001;
      const wz = (cFiaX - 1700.0) * 0.001;

      const part = classifyTriangle(wx, wy, wz);
      partPointCounts[part] = (partPointCounts[part] || 0) + 1;

      if (!partBounds[part]) {
        partBounds[part] = { minX: wx, maxX: wx, minY: wy, maxY: wy, minZ: wz, maxZ: wz };
      } else {
        const b = partBounds[part];
        if (wx < b.minX) b.minX = wx;
        if (wx > b.maxX) b.maxX = wx;
        if (wy < b.minY) b.minY = wy;
        if (wy > b.maxY) b.maxY = wy;
        if (wz < b.minZ) b.minZ = wz;
        if (wz > b.maxZ) b.maxZ = wz;
      }
    }
  }
}

console.log('Part triangle counts:');
console.table(Object.entries(partPointCounts).map(([k, v]) => ({ part: k, triangles: v, bounds: partBounds[k] })));
