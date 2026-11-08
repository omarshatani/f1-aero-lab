import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createBaselineParts,
  DEFAULT_WHEEL_STANCE,
  PART_ORDER,
  worldToFiaMm,
} from '../regulations/fia2026';
import { CarModelId, PartId, WheelStanceSettings } from '../types/aero';
import { PartFFDController } from './ffdDeformer';

export interface LoadedCarAssembly {
  modelId: CarModelId;
  /** Empty group retained for scene graph compatibility (all non-wheel geometry lives in the 11 deformable parts) */
  staticChassisGroup: THREE.Group;
  /** 4 outer wheel stance pivot groups positioned at exact axle centers */
  wheelGroups: THREE.Group[];
  /** 11 welded 3D FFD controllers for each FIA 2026 aerodynamic, chassis & suspension part */
  partControllers: Record<PartId, PartFFDController>;
  setGhostMode: (ghost: boolean) => void;
  updateWheelSpin: (dt: number, windSpeedKmh: number, active: boolean) => void;
  applyWheelStance: (stance: WheelStanceSettings) => void;
  dispose: () => void;
}

type WheelBucketId = 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr';

type BucketId = PartId | 'static_chassis' | WheelBucketId;

interface RawBucketAccumulator {
  positions: number[];
  colors: number[];
  hasColors: boolean;
}

interface WheelAssemblyNode {
  id: WheelBucketId;
  isFront: boolean;
  isRight: boolean;
  baseX: number;
  baseY: number;
  baseZ: number;
  stancePivot: THREE.Group;
  spinGroup: THREE.Group;
}

const MODEL_URLS: Record<CarModelId, string> = {
  fia_2026_concept: '/f1_2026_concept_polygon_model.glb',
};

/**
 * Spatial classification of a car triangle centroid (in World meters & FIA 2026 mm)
 * into the 4 Rotating Wheels or the 11 Independently Sculptable FIA 2026 Parts.
 * 100% of non-wheel triangles are assigned to the 11 parts (static_chassis receives 0 triangles).
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

  // 2. Front & Rear Suspension Arms, Pushrods/Pullrods & Brake Ducts
  if (xF > -302 && xF < 435 && ay > 248 && zFia > 88) {
    return 'front_suspension';
  }
  if (xR > -365 && xR < 245 && ay > 225 && zFia > 145 && zFia < 640) {
    return 'rear_suspension';
  }

  // 3. Eleven Independently Sculptable FIA 2026 Aerodynamic, Bodywork & Chassis Regions
  if (xF <= -295 && zFia <= 395 && !(ay < 185 && zFia > 196 && xF > -1060)) {
    return 'front_wing';
  }

  if (xF <= 65 && ay <= 268 && zFia >= 52 && zFia <= 645) {
    return 'nosecone';
  }

  if (
    xR >= 155 &&
    zFia >= 175 &&
    zFia <= 890 &&
    ay <= 582 &&
    !(ay < 325 && zFia < 580 && xR > 360)
  ) {
    return 'rear_wing';
  }

  if (xF >= 605 && xF <= 1555 && ay >= 655 && zFia <= 435) {
    return 'floor_boards';
  }

  if (xF >= 2725 && xF <= 3620 && ay <= 465 && zFia <= 315) {
    return 'diffuser';
  }

  if (xF >= 335 && xF < 2725 && zFia <= 145) {
    return 'floor';
  }

  if (xF >= 880 && xF <= 3360 && ay >= 165 && zFia > 145 && zFia <= 618) {
    return 'sidepods';
  }

  if (xF >= 1450) {
    return 'engine_cover';
  }

  return 'monocoque';
}

/**
 * Weld duplicate STL/GLTF vertices within 0.2mm so vertex count drops ~4x and normals/FFD are smooth.
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
 * All 11 parts have 100% unpinned seams (seamPinFactor = 1.0) so every boundary and
 * junction node across the entire car responds freely to FFD sculpting and macro sliders.
 */
function computeSeamPinFactors(
  _partId: PartId,
  positions: Float32Array
): Float32Array {
  const n = positions.length / 3;
  const pins = new Float32Array(n);
  pins.fill(1.0);
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

    onProgress?.(88, `Segmenting 11 FIA 2026 Parts & Welding Unpinned FFD Cages...`);
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

        const bucketId = classifyTriangle(cx, cy, cz);
        const acc = allBuckets[bucketId];
        acc.positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);

        if (acc.hasColors && bucketId.startsWith('wheel_')) {
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
          acc.colors.push(
            rgb0[0], rgb0[1], rgb0[2],
            rgb1[0], rgb1[1], rgb1[2],
            rgb2[0], rgb2[1], rgb2[2]
          );
        }
      }
    });

    const ghostableMaterials: THREE.MeshStandardMaterial[] = [];

    // Static Chassis Group (now empty because 100% of chassis/suspension triangles belong to the 11 parts)
    const staticChassisGroup = new THREE.Group();
    staticChassisGroup.name = 'StaticChassis2026';

    // Build 4 Rotating & Stance-Adjustable Wheel Pivot Groups centered on their exact axles
    const wheelGroups: THREE.Group[] = [];
    const wheelNodes: WheelAssemblyNode[] = [];
    const wheelIds: WheelBucketId[] = [
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

      const wSpinGroup = new THREE.Group();
      wSpinGroup.name = `${wid}_spin`;
      wSpinGroup.add(new THREE.Mesh(wGeo, wMat));

      const wStancePivot = new THREE.Group();
      wStancePivot.name = `${wid}_stance`;
      wStancePivot.position.set(pivotX, pivotY, pivotZ);
      wStancePivot.add(wSpinGroup);

      wheelGroups.push(wStancePivot);
      wheelNodes.push({
        id: wid,
        isFront: wid.includes('_f'),
        isRight: wid.endsWith('_r'),
        baseX: pivotX,
        baseY: pivotY,
        baseZ: pivotZ,
        stancePivot: wStancePivot,
        spinGroup: wSpinGroup,
      });
    }

    // Build 11 Welded Deformable Aero, Bodywork & Suspension Part FFD Controllers
    onProgress?.(95, `Binding 3D Free-Form Deformation Cages to 11 FIA Parts...`);
    const baselineParts = createBaselineParts();
    const partControllers = {} as Record<PartId, PartFFDController>;

    for (const partId of PART_ORDER) {
      const weldedPart = weldBucketTriangles(allBuckets[partId]);
      const seamPins = computeSeamPinFactors(partId, weldedPart.positions);
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

    const applyWheelStance = (stance: WheelStanceSettings) => {
      const degToRad = Math.PI / 180;
      const dishScaleX = Math.max(0.85, Math.min(1.2, 1 + stance.rimCoverDishMm * 0.002));

      for (const wn of wheelNodes) {
        const trackOffM =
          (wn.isFront ? stance.frontTrackOffsetMm : stance.rearTrackOffsetMm) * 0.001;
        const camberDeg = wn.isFront ? stance.frontCamberDeg : stance.rearCamberDeg;
        const toeDeg = wn.isFront ? stance.frontToeDeg : 0;

        const signX = wn.isRight ? 1 : -1;
        wn.stancePivot.position.set(
          wn.baseX + signX * trackOffM,
          wn.baseY,
          wn.baseZ
        );
        // Negative camber tilts top of tire inboard toward car centerline (X = 0)
        wn.stancePivot.rotation.z = -signX * camberDeg * degToRad;
        // Positive toe-in angles front of tire inward toward car centerline
        wn.stancePivot.rotation.y = -signX * toeDeg * degToRad;
        wn.stancePivot.scale.set(dishScaleX, 1, 1);
      }
    };

    applyWheelStance(DEFAULT_WHEEL_STANCE);

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
        for (const wn of wheelNodes) {
          wn.spinGroup.rotation.x -= omega * dt * 0.28;
        }
      },
      applyWheelStance,
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
