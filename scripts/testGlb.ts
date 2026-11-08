import fs from 'fs';

const buf = fs.readFileSync('public/f1_2026_concept_polygon_model.glb');
console.log('GLB file size:', (buf.length / (1024 * 1024)).toFixed(2), 'MB');

const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
console.log('Header:', { magic: '0x' + magic.toString(16), version, length });

const chunk0Length = buf.readUInt32LE(12);
const chunk0Type = buf.readUInt32LE(16);
const jsonStr = buf.toString('utf8', 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

console.log('GLTF summary:', {
  meshes: gltf.meshes?.length,
  accessors: gltf.accessors?.length,
  bufferViews: gltf.bufferViews?.length,
  buffers: gltf.buffers?.length,
  nodes: gltf.nodes?.length,
});

// Chunk 1 (BIN)
const chunk1Offset = 20 + chunk0Length;
const chunk1Length = buf.readUInt32LE(chunk1Offset);
const chunk1Type = buf.readUInt32LE(chunk1Offset + 4);
const binData = buf.subarray(chunk1Offset + 8, chunk1Offset + 8 + chunk1Length);
console.log('BIN chunk size:', (binData.length / (1024 * 1024)).toFixed(2), 'MB');
