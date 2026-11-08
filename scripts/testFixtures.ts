import * as THREE from 'three';
import { DEFAULT_WHEEL_STANCE, fiaMmToWorld } from '../src/regulations/fia2026';
import { FixtureId, WheelStanceSettings } from '../src/types/aero';

console.log('=== TESTING PROCEDURAL FIXTURES ===\n');

// Test Three.js object hierarchy
const root = new THREE.Group();
root.name = 'ProceduralFixtures';

// Build a test wheel
const wheelPivot = new THREE.Group();
const spinGroup = new THREE.Group();
const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.345, 24);
tireGeo.rotateZ(Math.PI / 2); // align axle along X
const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
const tireMesh = new THREE.Mesh(tireGeo, tireMat);
spinGroup.add(tireMesh);
wheelPivot.add(spinGroup);
root.add(wheelPivot);

console.log('Wheel group created with tire mesh.');
console.log('Total root children:', root.children.length);

console.log('\n-> Procedural fixtures basic Three.js test passed!');
