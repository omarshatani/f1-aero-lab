import * as THREE from 'three';

export interface ReferenceChassisBuild {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  setGhostMode: (ghost: boolean) => void;
  updateWheelSpin: (dt: number, windSpeedKmh: number, active: boolean) => void;
}

export const WHEEL_SPECS = {
  front: { x: 0.82, y: 0.36, z: -1.65, radius: 0.36, width: 0.305 },
  rear: { x: 0.80, y: 0.36, z: 1.75, radius: 0.36, width: 0.405 },
};

/**
 * Builds the FIA homologated non-editable reference chassis:
 * Survival cell, airbox/engine spine, titanium halo, driver helmet, suspension wishbones, and 18" wheels.
 */
export function createReferenceChassis(): ReferenceChassisBuild {
  const root = new THREE.Group();
  root.name = 'ReferenceChassis';

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const ghostableMaterials: THREE.MeshStandardMaterial[] = [];

  const makeMat = (
    color: number,
    roughness = 0.45,
    metalness = 0.25
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: true,
      opacity: 1.0,
    });
    ghostableMaterials.push(m);
    return m;
  };

  const chassisMat = makeMat(0x1e2430, 0.38, 0.35);
  const darkCarbonMat = makeMat(0x11151c, 0.55, 0.2);
  const haloMat = makeMat(0x2a3140, 0.3, 0.6);
  const helmetMat = makeMat(0x00d2be, 0.2, 0.4);
  const tireMat = makeMat(0x15171a, 0.78, 0.08);
  const rimMat = makeMat(0x232832, 0.35, 0.65);
  const stripeMat = makeMat(0xef4444, 0.35, 0.1); // Soft compound red sidewall ring

  // 1. Survival Cell / Monocoque lofted profile along Z [-1.44 -> +1.55]
  const stations: Array<{ z: number; halfW: number; yBot: number; yTop: number }> = [
    { z: -1.44, halfW: 0.21, yBot: 0.23, yTop: 0.53 },
    { z: -0.95, halfW: 0.24, yBot: 0.17, yTop: 0.57 },
    { z: -0.45, halfW: 0.26, yBot: 0.14, yTop: 0.59 },
    { z: 0.12, halfW: 0.25, yBot: 0.14, yTop: 0.62 },
    { z: 0.55, halfW: 0.21, yBot: 0.15, yTop: 0.84 }, // Roll hoop / airbox peak
    { z: 1.05, halfW: 0.14, yBot: 0.16, yTop: 0.68 },
    { z: 1.58, halfW: 0.07, yBot: 0.20, yTop: 0.44 }, // Gearbox tail cone
  ];

  const ringPts = 16;
  const monoPos: number[] = [];
  const monoIdx: number[] = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const cy = 0.5 * (st.yBot + st.yTop);
    const ry = 0.5 * (st.yTop - st.yBot);
    for (let k = 0; k <= ringPts; k++) {
      const theta = (k / ringPts) * Math.PI * 2;
      // Superellipse cross section for realistic F1 tub
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const sx = Math.sign(cosT) * Math.pow(Math.abs(cosT), 0.72) * st.halfW;
      const sy = cy + Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.78) * ry;
      monoPos.push(sx, sy, st.z);
    }
  }

  const stride = ringPts + 1;
  for (let s = 0; s < stations.length - 1; s++) {
    for (let k = 0; k < ringPts; k++) {
      const a = s * stride + k;
      const b = a + 1;
      const c = (s + 1) * stride + k;
      const d = c + 1;
      monoIdx.push(a, c, d, a, d, b);
    }
  }

  const monoGeo = new THREE.BufferGeometry();
  monoGeo.setAttribute('position', new THREE.Float32BufferAttribute(monoPos, 3));
  monoGeo.setIndex(monoIdx);
  monoGeo.computeVertexNormals();
  bodyGroup.add(new THREE.Mesh(monoGeo, chassisMat));

  // Sharkfin engine cover & rear wing swan-neck pylon
  const finShape = new THREE.Shape();
  finShape.moveTo(0.48, 0.82);
  finShape.lineTo(1.42, 0.66);
  finShape.lineTo(1.48, 0.44);
  finShape.lineTo(0.48, 0.58);
  finShape.closePath();

  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.016, bevelEnabled: false });
  finGeo.rotateY(Math.PI / 2);
  finGeo.translate(-0.008, 0, 0);
  //Wait: rotateY(PI/2) maps shape X -> -Z, so let's build sharkfin directly with BufferGeometry or Box/Plane to be 100% exact in Z!
  finGeo.dispose();

  const pylonPts: Array<[number, number, number]> = [
    // Sharkfin quad
    [0, 0.83, 0.52],
    [0, 0.71, 1.38],
    [0, 0.48, 1.48],
    [0, 0.56, 0.52],
  ];
  const finBoxGeo = new THREE.BufferGeometry();
  const fw = 0.009;
  const fVerts = [
    fw, pylonPts[0][1], pylonPts[0][2],
    fw, pylonPts[1][1], pylonPts[1][2],
    fw, pylonPts[2][1], pylonPts[2][2],
    fw, pylonPts[3][1], pylonPts[3][2],
    -fw, pylonPts[0][1], pylonPts[0][2],
    -fw, pylonPts[1][1], pylonPts[1][2],
    -fw, pylonPts[2][1], pylonPts[2][2],
    -fw, pylonPts[3][1], pylonPts[3][2],
  ];
  finBoxGeo.setAttribute('position', new THREE.Float32BufferAttribute(fVerts, 3));
  finBoxGeo.setIndex([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
  ]);
  finBoxGeo.computeVertexNormals();
  bodyGroup.add(new THREE.Mesh(finBoxGeo, darkCarbonMat));

  // Rear wing central swan-neck support pillar
  const rearPylonCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.30, 1.54),
    new THREE.Vector3(0, 0.55, 1.72),
    new THREE.Vector3(0, 0.77, 1.84),
  ]);
  const rearPylonGeo = new THREE.TubeGeometry(rearPylonCurve, 12, 0.018, 8, false);
  rearPylonGeo.scale(0.45, 1.0, 1.3);
  bodyGroup.add(new THREE.Mesh(rearPylonGeo, darkCarbonMat));

  // Cockpit recess & Driver helmet
  const cockpitRecess = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.12, 0.62),
    darkCarbonMat
  );
  cockpitRecess.position.set(0, 0.56, -0.12);
  bodyGroup.add(cockpitRecess);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 14), helmetMat);
  helmet.scale.set(0.92, 0.96, 1.08);
  helmet.position.set(0, 0.64, -0.02);
  bodyGroup.add(helmet);

  // Titanium Halo structure
  for (const side of [-1, 1] as const) {
    const haloArm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.67, -0.46),
      new THREE.Vector3(side * 0.18, 0.73, -0.22),
      new THREE.Vector3(side * 0.21, 0.72, 0.18),
    ]);
    bodyGroup.add(new THREE.Mesh(new THREE.TubeGeometry(haloArm, 16, 0.02, 8, false), haloMat));
  }
  const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 10), haloMat);
  haloPillar.position.set(0, 0.60, -0.46);
  haloPillar.rotation.x = -0.25;
  bodyGroup.add(haloPillar);

  // Carbon Suspension Wishbones (Front & Rear)
  const addWishbone = (p1: THREE.Vector3, p2: THREE.Vector3) => {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 6), darkCarbonMat);
    arm.position.copy(p1).addScaledVector(dir, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    arm.scale.set(0.45, 1, 1.4);
    bodyGroup.add(arm);
  };

  for (const s of [-1, 1] as const) {
    // Front double wishbones + pushrod
    const fwHubUp = new THREE.Vector3(s * 0.70, 0.44, -1.65);
    const fwHubLo = new THREE.Vector3(s * 0.70, 0.24, -1.65);
    addWishbone(new THREE.Vector3(s * 0.20, 0.46, -1.78), fwHubUp);
    addWishbone(new THREE.Vector3(s * 0.22, 0.45, -1.46), fwHubUp);
    addWishbone(new THREE.Vector3(s * 0.19, 0.24, -1.78), fwHubLo);
    addWishbone(new THREE.Vector3(s * 0.22, 0.24, -1.46), fwHubLo);

    // Rear double wishbones + pullrod
    const rwHubUp = new THREE.Vector3(s * 0.64, 0.45, 1.75);
    const rwHubLo = new THREE.Vector3(s * 0.64, 0.24, 1.75);
    addWishbone(new THREE.Vector3(s * 0.11, 0.44, 1.48), rwHubUp);
    addWishbone(new THREE.Vector3(s * 0.08, 0.42, 1.82), rwHubUp);
    addWishbone(new THREE.Vector3(s * 0.12, 0.23, 1.48), rwHubLo);
    addWishbone(new THREE.Vector3(s * 0.08, 0.23, 1.82), rwHubLo);
  }

  // 4 Pirelli-style 18-inch Wheels & Aero Covers
  const wheels: THREE.Group[] = [];
  const createWheel = (spec: { x: number; y: number; z: number; radius: number; width: number }, side: -1 | 1) => {
    const wGroup = new THREE.Group();
    wGroup.position.set(side * spec.x, spec.y, spec.z);

    // Tire carcass with beveled shoulder profile via LatheGeometry
    const hw = spec.width * 0.5;
    const r = spec.radius;
    const rimR = 0.228; // 18-inch rim
    const profile = [
      new THREE.Vector2(rimR, -hw * 0.92),
      new THREE.Vector2(r * 0.94, -hw),
      new THREE.Vector2(r, -hw * 0.76),
      new THREE.Vector2(r, hw * 0.76),
      new THREE.Vector2(r * 0.94, hw),
      new THREE.Vector2(rimR, hw * 0.92),
    ];
    const tireGeo = new THREE.LatheGeometry(profile, 32);
    tireGeo.rotateZ(Math.PI / 2);
    wGroup.add(new THREE.Mesh(tireGeo, tireMat));

    // Wheel aero cover disc
    const rimGeo = new THREE.CylinderGeometry(rimR, rimR, spec.width * 0.9, 24);
    rimGeo.rotateZ(Math.PI / 2);
    wGroup.add(new THREE.Mesh(rimGeo, rimMat));

    // Sidewall compound ring + rotation spoke marker so wheel spin is visible
    const ringGeo = new THREE.TorusGeometry(r * 0.78, 0.009, 8, 28);
    ringGeo.rotateY(Math.PI / 2);
    const outerRing = new THREE.Mesh(ringGeo, stripeMat);
    outerRing.position.x = side * (hw * 0.96);
    wGroup.add(outerRing);

    const spokeMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, rimR * 1.6, 0.028),
      stripeMat
    );
    spokeMarker.position.x = side * (hw * 0.93);
    wGroup.add(spokeMarker);

    root.add(wGroup);
    wheels.push(wGroup);
  };

  createWheel(WHEEL_SPECS.front, 1);
  createWheel(WHEEL_SPECS.front, -1);
  createWheel(WHEEL_SPECS.rear, 1);
  createWheel(WHEEL_SPECS.rear, -1);

  return {
    root,
    bodyGroup,
    wheels,
    setGhostMode(ghost: boolean) {
      for (const m of ghostableMaterials) {
        m.opacity = ghost ? 0.22 : 1.0;
        m.depthWrite = !ghost;
      }
    },
    updateWheelSpin(dt: number, windSpeedKmh: number, active: boolean) {
      if (!active) return;
      const vMs = windSpeedKmh / 3.6;
      const omega = vMs / 0.36;
      for (const w of wheels) {
        w.rotation.x -= omega * dt * 0.28;
      }
    },
  };
}
