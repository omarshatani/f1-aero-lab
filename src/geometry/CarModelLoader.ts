import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createBaselineParts,
  PART_ORDER,
  signedMarginInUnion,
  worldToFiaMm,
} from '../regulations/fia2026';
import { AeroPartData, CarModelId, PartId, WheelStanceSettings } from '../types/aero';
import { PartFFDController } from './ffdDeformer';

export interface LoadedCarAssembly {
  modelId: CarModelId;
  /** Group holding non-deformable survival cell, halo, cockpit, mirrors, exhaust & wishbones */
  staticChassisGroup: THREE.Group;
  /** 4 wheel pivot groups positioned at exact axle centers for Wind Tunnel rotation */
  wheelGroups: THREE.Group[];
  /** 11 welded 3D FFD controllers for each FIA 2026 aerodynamic & chassis part */
  partControllers: Record<PartId, PartFFDController>;
  setGhostMode: (ghost: boolean) => void;
  updateWheelSpin: (dt: number, windSpeedKmh: number, active: boolean) => void;
  applyWheelStance?: (stance: WheelStanceSettings) => void;
  dispose: () => void;
}

type BucketId =
  | PartId
  | 'static_chassis'
  | 'wheel_fl'
  | 'wheel_fr'
  | 'wheel_rl'
  | 'wheel_rr';

interface RawBucketAccumulator {
  positions: number[];
  colors: number[];
  hasColors: boolean;
}

const MODEL_URLS: Record<CarModelId, string> = {
  fia_2026_concept: '/f1_2026_concept_polygon_model.glb',
};

/**
 * Spatial classification of a car triangle centroid (in World meters & FIA 2026 mm)
 * into Rotating Wheels, Static Homologated Chassis/Suspension, or the 7 FIA 2026 Aero Parts.
 */
function classifyTriangle(
  wx: number,
  wy: number,
  wz: number
): BucketId {
  const { xF, yFia, zFia } = worldToFiaMm({ x: wx, y: wy, z: wz });
  const ay = Math.abs(yFia);
  const xR = xF - 3400.0;

  // 1. Geometric 4-Wheel Cylinder Isolation (exact match on FIA 2026 Concept Car disconnected shells)
  const dFrontAxle = Math.hypot(xF, zFia - 328.7);
  if (dFrontAxle < 364.5 && ay > 588) {
    return wx >= 0 ? 'wheel_fr' : 'wheel_fl';
  }
  const dRearAxle = Math.hypot(xR, zFia - 328.6);
  if (dRearAxle < 365.5 && ay > 508) {
    return wx >= 0 ? 'wheel_rr' : 'wheel_rl';
  }

  // 3. Homologated Static Structures: Suspension Wishbones, Brake Scoops, Cockpit, Halo, Roll Hoop & Exhaust
  // Front suspension arms & brake ducts
  if (xF > -302 && xF < 435 && ay > 248 && zFia > 88) {
    return 'static_chassis';
  }
  // Rear suspension arms, pullrods, lower wishbones & rear brake ducts
  if (xR > -365 && xR < 245 && ay > 225 && zFia > 145 && zFia < 640) {
    return 'static_chassis';
  }
  // Upper Halo, Driver Helmet, Roll Hoop / Airbox, Sharkfin Spine & Mirrors (ahead of Rear Wing)
  if (zFia > 618 && xF < 3545) {
    return 'static_chassis';
  }
  // Central Survival Cell Monocoque Tub
  if (xF >= 50 && xF <= 1850 && ay < 252 && zFia > 142) {
    return 'static_chassis';
  }
  // Central Exhaust Tailpipe & Rear Impact Light Housing
  if (xR >= -220 && xR <= 760 && ay < 128 && zFia > 165 && zFia < 575) {
    return 'static_chassis';
  }

  // 4. Seven Independently Sculptable FIA 2026 Aerodynamic Bodywork Regions
  // (1) Front Wing, Endplate & Footplate (Art. 3.10)
  if (xF <= -295 && zFia <= 395 && !(ay < 185 && zFia > 196 && xF > -1060)) {
    return 'front_wing';
  }

  // (2) Nosecone & Wing Pylons (Art. 3.7.1)
  if (xF <= 65 && ay <= 268 && zFia >= 52 && zFia <= 645) {
    return 'nosecone';
  }

  // (7) Rear Wing, Endplates & Swan-Neck Pylon (Art. 3.11)
  if (
    xR >= 155 &&
    zFia >= 175 &&
    zFia <= 890 &&
    ay <= 582 &&
    !(ay < 325 && zFia < 580 && xR > 360)
  ) {
    return 'rear_wing';
  }

  // (3) 2026 Wake-Control Floor Boards (Art. 3.5.4 — outboard of Y=655mm!)
  if (xF >= 605 && xF <= 1555 && ay >= 655 && zFia <= 435) {
    return 'floor_boards';
  }

  // (6) Rear Underbody Diffuser & Boat-Tail (Art. 3.5.1 / 3.9)
  if (xF >= 2725 && xF <= 3620 && ay <= 465 && zFia <= 315) {
    return 'diffuser';
  }

  // (4) Main Floor, Bib & Lateral Edge Wing (Art. 3.5.1)
  if (xF >= 335 && xF < 2725 && zFia <= 145) {
    return 'floor';
  }

  // (5) Sidepods & Coke-Bottle Engine Cover (Art. 3.8)
  if (xF >= 880 && xF <= 3360 && ay >= 90 && zFia > 145 && zFia <= 618) {
    return 'sidepods';
  }

  return 'static_chassis';
}

/**
 * Weld duplicate STL/GLTF vertices within 0.1mm so vertex count drops ~4x and normals/FFD are smooth.
 */
function weldBucketTriangles(
  acc: RawBucketAccumulator,
  precisionInv = 5000 // 0.2mm spatial weld grid
): {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array | null;
} {
  const srcPos = acc.positions;
  const srcCol = acc.colors;
  const numVertsIn = srcPos.length / 3;

  const map = new Map<string, number>();
  const outPos: number[] = [];
  const outCol: number[] = [];
  const outIdx = new Uint32Array(numVertsIn);

  for (let i = 0; i < numVertsIn; i++) {
    const o = i * 3;
    const x = srcPos[o];
    const y = srcPos[o + 1];
    const z = srcPos[o + 2];

    const qx = Math.round(x * precisionInv);
    const qy = Math.round(y * precisionInv);
    const qz = Math.round(z * precisionInv);
    const key = `${qx},${qy},${qz}`;

    let wid = map.get(key);
    if (wid === undefined) {
      wid = outPos.length / 3;
      map.set(key, wid);
      outPos.push(x, y, z);
      if (acc.hasColors) {
        outCol.push(srcCol[o], srcCol[o + 1], srcCol[o + 2]);
      }
    }
    outIdx[i] = wid;
  }

  return {
    positions: new Float32Array(outPos),
    indices: outIdx,
    colors: acc.hasColors ? new Float32Array(outCol) : null,
  };
}

/**
 * Build a fast 10mm spatial voxel lookup of static_chassis vertices so deformable aero parts
 * smoothly feather their FFD displacement to 0 right where they join the monocoque/chassis.
 */
function buildStaticVoxelSet(staticPos: Float32Array, cellM = 0.012): Set<string> {
  const set = new Set<string>();
  const inv = 1.0 / cellM;
  for (let i = 0; i < staticPos.length; i += 3) {
    const ix = Math.floor(staticPos[i] * inv);
    const iy = Math.floor(staticPos[i + 1] * inv);
    const iz = Math.floor(staticPos[i + 2] * inv);
    set.add(`${ix},${iy},${iz}`);
  }
  return set;
}

function computeSeamPinFactors(
  partId: PartId,
  positions: Float32Array,
  staticVoxels: Set<string>,
  cellM = 0.012
): Float32Array {
  const n = positions.length / 3;
  const pins = new Float32Array(n);
  pins.fill(1.0);

  // Free-standing wing assemblies & outboard floor boards should translate/pitch 100% freely!
  if (partId === 'front_wing' || partId === 'rear_wing' || partId === 'floor_boards') {
    return pins;
  }

  const inv = 1.0 / cellM;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const ix = Math.floor(x * inv);
    const iy = Math.floor(y * inv);
    const iz = Math.floor(z * inv);

    let minGridDist = 99;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (staticVoxels.has(`${ix + dx},${iy + dy},${iz + dz}`)) {
            const d = Math.hypot(dx, dy, dz);
            if (d < minGridDist) minGridDist = d;
          }
        }
      }
    }

    if (minGridDist <= 0.8) {
      pins[i] = 0.0; // Shared weld vertex with static monocoque -> zero crack!
    } else if (minGridDist < 2.8) {
      const t = (minGridDist - 0.8) / 2.0;
      pins[i] = t * t * (3 - 2 * t);
    }
  }

  return pins;
}

export class CarModelLoader {
  private gltfLoader = new GLTFLoader();

  public async loadCarModel(
    modelId: CarModelId,
    onProgress?: (pct: number, label: string) => void
  ): Promise<LoadedCarAssembly> {
    const url = MODEL_URLS[modelId];
    const modelLabel = 'Official FIA 2026 Concept Model';

    onProgress?.(5, `Downloading ${modelLabel}...`);

    const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
      (resolve, reject) => {
        this.gltfLoader.load(
          url,
          (loaded) => resolve(loaded),
          (evt) => {
            if (evt.lengthComputable && evt.total > 0) {
              const pct = Math.min(82, Math.round((evt.loaded / evt.total) * 80) + 5);
              onProgress?.(pct, `Loading ${modelLabel} (${Math.round(evt.loaded / 1048576)} MB)...`);
            }
          },
          (err) => reject(err)
        );
      }
    );

    onProgress?.(88, `Segmenting FIA 2026 Reference Volumes & Welding FFD Cages...`);
    // Allow browser to paint progress update before ~120ms weld & FFD precompute
    await new Promise((r) => setTimeout(r, 16));

    gltf.scene.updateMatrixWorld(true);

    const allBuckets: Record<BucketId, RawBucketAccumulator> = {
      front_wing: { positions: [], colors: [], hasColors: false },
      nosecone: { positions: [], colors: [], hasColors: false },
      front_suspension: { positions: [], colors: [], hasColors: false },
      monocoque: { positions: [], colors: [], hasColors: false },
      floor_boards: { positions: [], colors: [], hasColors: false },
      floor: { positions: [], colors: [], hasColors: false },
      sidepods: { positions: [], colors: [], hasColors: false },
      engine_cover: { positions: [], colors: [], hasColors: false },
      rear_suspension: { positions: [], colors: [], hasColors: false },
      diffuser: { positions: [], colors: [], hasColors: false },
      rear_wing: { positions: [], colors: [], hasColors: false },
      static_chassis: { positions: [], colors: [], hasColors: true },
      wheel_fl: { positions: [], colors: [], hasColors: true },
      wheel_fr: { positions: [], colors: [], hasColors: true },
      wheel_rl: { positions: [], colors: [], hasColors: true },
      wheel_rr: { positions: [], colors: [], hasColors: true },
    };

    const baselinePartsForFilter: Record<PartId, AeroPartData> = createBaselineParts();
    const rgb0: [number, number, number] = [0.2, 0.2, 0.2];
    const rgb1: [number, number, number] = [0.2, 0.2, 0.2];
    const rgb2: [number, number, number] = [0.2, 0.2, 0.2];

    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr) return;
      const idxAttr = geo.getIndex();

      const getWorldVertex = (vIdx: number): [number, number, number] => {
        // Raw CAD coordinates are already exact FIA millimeters:
        // rx = X_A (X_F - 55), ry = Y_FIA, rz = Z_FIA
        const rx = posAttr.getX(vIdx);
        const ry = posAttr.getY(vIdx);
        const rz = posAttr.getZ(vIdx);
        return [
          ry * 0.001,
          (rz + 30.8) * 0.001,
          (rx + 55.0 - 1700.0) * 0.001,
        ];
      };

      const sampleVertColor = (
        bucket: BucketId,
        wy: number,
        out: [number, number, number]
      ) => {
        if (bucket.startsWith('wheel_')) {
          const yAxle = 0.3595;
          const rFromAxle = Math.abs(wy - yAxle);
          if (rFromAxle < 0.225) {
            out[0] = 0.16;
            out[1] = 0.18;
            out[2] = 0.22;
          } else {
            out[0] = 0.09;
            out[1] = 0.10;
            out[2] = 0.115;
          }
        } else {
          // Static survival cell, wishbones, halo & roll hoop in gunmetal carbon
          out[0] = 0.14;
          out[1] = 0.155;
          out[2] = 0.185;
        }
      };

      const triCount = idxAttr ? idxAttr.count : posAttr.count;
      for (let t = 0; t < triCount; t += 3) {
        const i0 = idxAttr ? idxAttr.getX(t) : t;
        const i1 = idxAttr ? idxAttr.getX(t + 1) : t + 1;
        const i2 = idxAttr ? idxAttr.getX(t + 2) : t + 2;

        const [x0, y0, z0] = getWorldVertex(i0);
        const [x1, y1, z1] = getWorldVertex(i1);
        const [x2, y2, z2] = getWorldVertex(i2);

        const cx = (x0 + x1 + x2) / 3;
        const cy = (y0 + y1 + y2) / 3;
        const cz = (z0 + z1 + z2) / 3;

        let bucketId = classifyTriangle(cx, cy, cz);
        // FIA Art. 3.2.2: Ensure non-aero suspension/crash-structure triangles extending outside
        // the official Reference Volumes stay rigidly attached to static_chassis!
        if (
          bucketId !== 'static_chassis' &&
          !bucketId.startsWith('wheel_')
        ) {
          const boxes = baselinePartsForFilter[bucketId as PartId].legalityBoxes;
          if (
            signedMarginInUnion({ x: Math.abs(x0), y: y0, z: z0 }, boxes) < -0.005 ||
            signedMarginInUnion({ x: Math.abs(x1), y: y1, z: z1 }, boxes) < -0.005 ||
            signedMarginInUnion({ x: Math.abs(x2), y: y2, z: z2 }, boxes) < -0.005
          ) {
            bucketId = 'static_chassis';
          }
        }
        const acc = allBuckets[bucketId];
        acc.positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);

        if (acc.hasColors) {
          if (bucketId.startsWith('wheel_')) {
            const zAxle = bucketId.includes('_f') ? -1.70 : 1.70;
            const yAxle = 0.3595;
            for (const [vy, vz, out] of [
              [y0, z0, rgb0],
              [y1, z1, rgb1],
              [y2, z2, rgb2],
            ] as Array<[number, number, [number, number, number]]>) {
              const rad = Math.hypot(vy - yAxle, vz - zAxle);
              if (rad > 0.218 && rad < 0.236) {
                // Crisp Pirelli red sidewall ring on 18-inch rim edge!
                out[0] = 0.82;
                out[1] = 0.16;
                out[2] = 0.16;
              } else if (rad <= 0.218) {
                out[0] = 0.17;
                out[1] = 0.19;
                out[2] = 0.23;
              } else {
                out[0] = 0.085;
                out[1] = 0.092;
                out[2] = 0.105;
              }
            }
          } else {
            sampleVertColor(bucketId, y0, rgb0);
            sampleVertColor(bucketId, y1, rgb1);
            sampleVertColor(bucketId, y2, rgb2);
          }
          acc.colors.push(
            rgb0[0], rgb0[1], rgb0[2],
            rgb1[0], rgb1[1], rgb1[2],
            rgb2[0], rgb2[1], rgb2[2]
          );
        }
      }
    });

    const ghostableMaterials: THREE.MeshStandardMaterial[] = [];

    // Build Static Homologated Chassis Mesh
    const staticChassisGroup = new THREE.Group();
    staticChassisGroup.name = 'StaticChassis2026';
    const weldedStatic = weldBucketTriangles(allBuckets.static_chassis);
    const staticVoxels = buildStaticVoxelSet(weldedStatic.positions);

    if (weldedStatic.positions.length > 0) {
      const sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.BufferAttribute(weldedStatic.positions, 3));
      if (weldedStatic.colors) {
        sGeo.setAttribute('color', new THREE.BufferAttribute(weldedStatic.colors, 3));
      }
      sGeo.setIndex(new THREE.BufferAttribute(weldedStatic.indices, 1));
      sGeo.computeVertexNormals();

      const sMat = new THREE.MeshStandardMaterial({
        vertexColors: Boolean(weldedStatic.colors),
        roughness: 0.38,
        metalness: 0.32,
        transparent: true,
        opacity: 1.0,
      });
      ghostableMaterials.push(sMat);
      staticChassisGroup.add(new THREE.Mesh(sGeo, sMat));
    }

    // Build 4 Rotating Wheel Pivot Groups centered on their exact axles
    const wheelGroups: THREE.Group[] = [];
    const wheelIds: Array<'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr'> = [
      'wheel_fl',
      'wheel_fr',
      'wheel_rl',
      'wheel_rr',
    ];

    for (const wid of wheelIds) {
      const weldedW = weldBucketTriangles(allBuckets[wid]);
      if (weldedW.positions.length === 0) continue;

      // Compute exact wheel bounding center so rotation about X has zero wobble
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      const wp = weldedW.positions;
      for (let i = 0; i < wp.length; i += 3) {
        if (wp[i] < minX) minX = wp[i];
        if (wp[i] > maxX) maxX = wp[i];
        if (wp[i + 1] < minY) minY = wp[i + 1];
        if (wp[i + 1] > maxY) maxY = wp[i + 1];
        if (wp[i + 2] < minZ) minZ = wp[i + 2];
        if (wp[i + 2] > maxZ) maxZ = wp[i + 2];
      }

      const pivotX = 0.5 * (minX + maxX);
      const pivotY = 0.5 * (minY + maxY);
      const pivotZ = 0.5 * (minZ + maxZ);

      for (let i = 0; i < wp.length; i += 3) {
        wp[i] -= pivotX;
        wp[i + 1] -= pivotY;
        wp[i + 2] -= pivotZ;
      }

      const wGeo = new THREE.BufferGeometry();
      wGeo.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      if (weldedW.colors) {
        wGeo.setAttribute('color', new THREE.BufferAttribute(weldedW.colors, 3));
      }
      wGeo.setIndex(new THREE.BufferAttribute(weldedW.indices, 1));
      wGeo.computeVertexNormals();

      const wMat = new THREE.MeshStandardMaterial({
        vertexColors: Boolean(weldedW.colors),
        roughness: 0.72,
        metalness: 0.14,
        transparent: true,
        opacity: 1.0,
      });
      ghostableMaterials.push(wMat);

      const wPivot = new THREE.Group();
      wPivot.position.set(pivotX, pivotY, pivotZ);
      wPivot.add(new THREE.Mesh(wGeo, wMat));
      wheelGroups.push(wPivot);
    }

    // Build 7 Welded Deformable Aero Part FFD Controllers
    onProgress?.(95, `Binding 3D Free-Form Deformation Cages to 7 FIA Parts...`);
    const baselineParts = createBaselineParts();
    const partControllers = {} as Record<PartId, PartFFDController>;

    for (const partId of PART_ORDER) {
      const weldedPart = weldBucketTriangles(allBuckets[partId]);
      const seamPins = computeSeamPinFactors(partId, weldedPart.positions, staticVoxels);
      partControllers[partId] = new PartFFDController(
        baselineParts[partId],
        weldedPart.positions,
        weldedPart.indices,
        seamPins,
        weldedPart.colors
      );
    }

    // Dispose temporary raw GLTF geometries/textures no longer needed in GPU RAM
    gltf.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        m.geometry.dispose();
      }
    });

    onProgress?.(100, `Ready`);

    return {
      modelId,
      staticChassisGroup,
      wheelGroups,
      partControllers,
      setGhostMode(ghost: boolean) {
        for (const m of ghostableMaterials) {
          m.opacity = ghost ? 0.18 : 1.0;
          m.depthWrite = !ghost;
        }
      },
      updateWheelSpin(dt: number, windSpeedKmh: number, active: boolean) {
        if (!active) return;
        const vMs = windSpeedKmh / 3.6;
        const omega = vMs / 0.359;
        for (const w of wheelGroups) {
          w.rotation.x -= omega * dt * 0.28;
        }
      },
      dispose() {
        staticChassisGroup.traverse((obj) => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        });
        for (const w of wheelGroups) {
          w.traverse((obj) => {
            if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
          });
        }
        for (const id of PART_ORDER) {
          partControllers[id].dispose();
        }
        for (const m of ghostableMaterials) {
          m.dispose();
        }
      },
    };
  }
}
