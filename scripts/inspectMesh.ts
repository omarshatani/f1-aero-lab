import fs from 'fs';

const buf = fs.readFileSync('public/f1_2026_concept_polygon_model.glb');
const chunk0Length = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

const chunk1Offset = 20 + chunk0Length;
const binData = buf.subarray(chunk1Offset + 8);

console.log('Meshes count:', gltf.meshes.length);
for (let i = 0; i < gltf.meshes.length; i++) {
  const mesh = gltf.meshes[i];
  console.log(`Mesh ${i}: "${mesh.name}" primitives: ${mesh.primitives.length}`);
  for (let p = 0; p < mesh.primitives.length; p++) {
    const prim = mesh.primitives[p];
    const posAcc = gltf.accessors[prim.attributes.POSITION];
    const idxAcc = prim.indices !== undefined ? gltf.accessors[prim.indices] : null;
    console.log(`  Prim ${p}: posCount=${posAcc.count}, idxCount=${idxAcc ? idxAcc.count : 'none'}, min=${JSON.stringify(posAcc.min)}, max=${JSON.stringify(posAcc.max)}`);
  }
}
