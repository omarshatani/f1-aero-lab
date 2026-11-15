import * as THREE from 'three';
import { DEFAULT_WHEEL_STANCE } from '../regulations/fia2026';
import { FBX_FIXTURES, FBX_WHEEL_CENTERS, FbxFixtureTemplate } from '../surface/fbxCarData';
import { FixtureId, WheelStanceSettings } from '../types/aero';

interface WheelNode {
  id: 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr';
  isFront: boolean;
  isRight: boolean;
  baseX: number;
  baseY: number;
  baseZ: number;
  pivot: THREE.Group;
  spinGroup: THREE.Group;
  dishCap: THREE.Mesh;
}

const WHEEL_RADIUS_M = 0.35;

/**
 * Manages the 222.fbx vehicle fixtures (4 spinning stance-adjustable wheels,
 * titanium Halo, rearview mirrors, driver helmet, cockpit interior, and exhaust).
 */
export class ProceduralFixturesManager {
  public readonly root = new THREE.Group();
  public readonly wheelGroups: THREE.Group[] = [];

  private wheelNodes: WheelNode[] = [];
  private fixtureGroups = new Map<FixtureId, THREE.Group>();
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor() {
    this.root.name = 'car_fixtures';
    this.buildWheels();
    this.buildHalo();
    this.buildMirrors();
    this.buildDriverHelmet();
    this.buildCockpitInterior();
    this.buildExhaust();
    this.applyWheelStance(DEFAULT_WHEEL_STANCE);
  }

  private registerGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private registerMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private buildFbxGeometry(tpl: FbxFixtureTemplate, mirrorX = false): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(tpl.positions.length);
    const norm = new Float32Array(tpl.normals.length);

    if (!mirrorX) {
      pos.set(tpl.positions);
      norm.set(tpl.normals);
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(tpl.indices), 1));
    } else {
      for (let i = 0; i < tpl.positions.length; i += 3) {
        pos[i] = -tpl.positions[i];
        pos[i + 1] = tpl.positions[i + 1];
        pos[i + 2] = tpl.positions[i + 2];

        norm[i] = -tpl.normals[i];
        norm[i + 1] = tpl.normals[i + 1];
        norm[i + 2] = tpl.normals[i + 2];
      }
      const idx = new Uint16Array(tpl.indices.length);
      for (let i = 0; i < tpl.indices.length; i += 3) {
        idx[i] = tpl.indices[i];
        idx[i + 1] = tpl.indices[i + 2];
        idx[i + 2] = tpl.indices[i + 1];
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    return this.registerGeo(geo);
  }

  private buildWheels(): void {
    const tireMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x1a1e24,
        roughness: 0.72,
        metalness: 0.14,
      })
    );
    const dishMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x11151b,
        roughness: 0.44,
        metalness: 0.32,
      })
    );

    const frontRightGeo = this.buildFbxGeometry(FBX_FIXTURES.wheel_front, false);
    const frontLeftGeo = this.buildFbxGeometry(FBX_FIXTURES.wheel_front, true);
    const rearRightGeo = this.buildFbxGeometry(FBX_FIXTURES.wheel_rear, false);
    const rearLeftGeo = this.buildFbxGeometry(FBX_FIXTURES.wheel_rear, true);
    const dishGeo = this.registerGeo(new THREE.CylinderGeometry(0.228, 0.228, 0.012, 28));
    dishGeo.rotateZ(Math.PI / 2);

    const specs: Array<{
      id: 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr';
      isFront: boolean;
      isRight: boolean;
      baseX: number;
      baseY: number;
      baseZ: number;
      halfWidth: number;
      geo: THREE.BufferGeometry;
    }> = [
      {
        id: 'wheel_fl',
        isFront: true,
        isRight: false,
        baseX: -FBX_WHEEL_CENTERS.front.x,
        baseY: FBX_WHEEL_CENTERS.front.y,
        baseZ: FBX_WHEEL_CENTERS.front.z,
        halfWidth: 0.175,
        geo: frontLeftGeo,
      },
      {
        id: 'wheel_fr',
        isFront: true,
        isRight: true,
        baseX: FBX_WHEEL_CENTERS.front.x,
        baseY: FBX_WHEEL_CENTERS.front.y,
        baseZ: FBX_WHEEL_CENTERS.front.z,
        halfWidth: 0.175,
        geo: frontRightGeo,
      },
      {
        id: 'wheel_rl',
        isFront: false,
        isRight: false,
        baseX: -FBX_WHEEL_CENTERS.rear.x,
        baseY: FBX_WHEEL_CENTERS.rear.y,
        baseZ: FBX_WHEEL_CENTERS.rear.z,
        halfWidth: 0.215,
        geo: rearLeftGeo,
      },
      {
        id: 'wheel_rr',
        isFront: false,
        isRight: true,
        baseX: FBX_WHEEL_CENTERS.rear.x,
        baseY: FBX_WHEEL_CENTERS.rear.y,
        baseZ: FBX_WHEEL_CENTERS.rear.z,
        halfWidth: 0.215,
        geo: rearRightGeo,
      },
    ];

    for (const spec of specs) {
      const fixtureGroup = new THREE.Group();
      fixtureGroup.name = spec.id;
      fixtureGroup.position.set(spec.baseX, spec.baseY, spec.baseZ);

      const stancePivot = new THREE.Group();
      stancePivot.name = `${spec.id}_pivot`;

      const spinGroup = new THREE.Group();
      spinGroup.name = `${spec.id}_spin`;

      const wheelMesh = new THREE.Mesh(spec.geo, tireMat);
      wheelMesh.castShadow = true;
      wheelMesh.receiveShadow = true;
      spinGroup.add(wheelMesh);

      const dishCap = new THREE.Mesh(dishGeo, dishMat);
      dishCap.position.x = (spec.isRight ? 1 : -1) * (spec.halfWidth - 0.008);
      dishCap.castShadow = true;
      dishCap.receiveShadow = true;
      spinGroup.add(dishCap);

      stancePivot.add(spinGroup);
      fixtureGroup.add(stancePivot);
      this.root.add(fixtureGroup);
      this.wheelGroups.push(stancePivot);
      this.fixtureGroups.set(spec.id, fixtureGroup);

      this.wheelNodes.push({
        id: spec.id,
        isFront: spec.isFront,
        isRight: spec.isRight,
        baseX: spec.baseX,
        baseY: spec.baseY,
        baseZ: spec.baseZ,
        pivot: stancePivot,
        spinGroup,
        dishCap,
      });
    }
  }

  private buildHalo(): void {
    const haloGroup = new THREE.Group();
    haloGroup.name = 'halo_structure';
    const mat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x20262f,
        roughness: 0.36,
        metalness: 0.48,
      })
    );
    const mesh = new THREE.Mesh(this.buildFbxGeometry(FBX_FIXTURES.halo, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    haloGroup.add(mesh);
    this.root.add(haloGroup);
    this.fixtureGroups.set('halo_structure', haloGroup);
  }

  private buildMirrors(): void {
    const mat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x222832,
        roughness: 0.38,
        metalness: 0.42,
      })
    );

    const rightGeo = this.buildFbxGeometry(FBX_FIXTURES.mirrors, false);
    const leftGeo = this.buildFbxGeometry(FBX_FIXTURES.mirrors, true);

    const mirrorR = new THREE.Group();
    mirrorR.name = 'mirror_r';
    const meshR = new THREE.Mesh(rightGeo, mat);
    meshR.castShadow = true;
    meshR.receiveShadow = true;
    mirrorR.add(meshR);
    this.root.add(mirrorR);
    this.fixtureGroups.set('mirror_r', mirrorR);

    const mirrorL = new THREE.Group();
    mirrorL.name = 'mirror_l';
    const meshL = new THREE.Mesh(leftGeo, mat);
    meshL.castShadow = true;
    meshL.receiveShadow = true;
    mirrorL.add(meshL);
    this.root.add(mirrorL);
    this.fixtureGroups.set('mirror_l', mirrorL);
  }

  private buildDriverHelmet(): void {
    const helmetGroup = new THREE.Group();
    helmetGroup.name = 'driver_helmet';

    const shellMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        roughness: 0.22,
        metalness: 0.55,
      })
    );
    const visorMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x090d14,
        roughness: 0.12,
        metalness: 0.9,
      })
    );

    const shellGeo = this.registerGeo(new THREE.SphereGeometry(0.118, 22, 18));
    shellGeo.scale(0.92, 0.96, 1.08);
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.set(0, 0.725, -0.16);
    shell.castShadow = true;
    shell.receiveShadow = true;
    helmetGroup.add(shell);

    const visorGeo = this.registerGeo(
      new THREE.CylinderGeometry(0.112, 0.114, 0.056, 18, 1, false, Math.PI * 0.65, Math.PI * 0.7)
    );
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.735, -0.17);
    helmetGroup.add(visor);

    this.root.add(helmetGroup);
    this.fixtureGroups.set('driver_helmet', helmetGroup);
  }

  private buildCockpitInterior(): void {
    const cockpitGroup = new THREE.Group();
    cockpitGroup.name = 'cockpit_interior';
    const mat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x141820,
        roughness: 0.78,
        metalness: 0.12,
      })
    );
    const mesh = new THREE.Mesh(this.buildFbxGeometry(FBX_FIXTURES.cockpit, false), mat);
    mesh.receiveShadow = true;
    cockpitGroup.add(mesh);
    this.root.add(cockpitGroup);
    this.fixtureGroups.set('cockpit_interior', cockpitGroup);
  }

  private buildExhaust(): void {
    const exhaustGroup = new THREE.Group();
    exhaustGroup.name = 'exhaust_tailpipe';
    const mat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x5c6470,
        roughness: 0.34,
        metalness: 0.85,
      })
    );
    const mesh = new THREE.Mesh(this.buildFbxGeometry(FBX_FIXTURES.exhaust, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    exhaustGroup.add(mesh);
    this.root.add(exhaustGroup);
    this.fixtureGroups.set('exhaust_tailpipe', exhaustGroup);
  }

  public applyWheelStance(stance: WheelStanceSettings): void {
    const degToRad = Math.PI / 180;
    const dishOffset = stance.rimCoverDishMm * 0.001;

    for (const node of this.wheelNodes) {
      const sign = node.isRight ? 1 : -1;
      const trackOffset =
        (node.isFront ? stance.frontTrackOffsetMm : stance.rearTrackOffsetMm) * 0.001;
      const camberRad =
        (node.isFront ? stance.frontCamberDeg : stance.rearCamberDeg) * degToRad;
      const toeRad = node.isFront ? stance.frontToeDeg * degToRad : 0;
      const halfWidth = node.isFront ? 0.175 : 0.215;

      node.pivot.position.set(sign * trackOffset, 0, 0);
      node.pivot.rotation.set(0, sign * toeRad, sign * -camberRad);
      node.dishCap.position.x = sign * (halfWidth - 0.008 + dishOffset);
    }
  }

  public updateWheelSpin(dt: number, windSpeedKmh: number, active: boolean): void {
    if (!active || windSpeedKmh <= 0) return;
    const angularVel = (windSpeedKmh / 3.6) / WHEEL_RADIUS_M;
    const dTheta = angularVel * dt;
    for (const node of this.wheelNodes) {
      node.spinGroup.rotation.x -= dTheta;
    }
  }

  public setFixtureVisible(id: FixtureId, visible: boolean): void {
    const group = this.fixtureGroups.get(id);
    if (group) {
      group.visible = visible;
    }
  }

  public setGhostMode(ghost: boolean): void {
    for (const mat of this.materials) {
      mat.transparent = ghost;
      mat.opacity = ghost ? 0.28 : 1.0;
      mat.depthWrite = !ghost;
      mat.needsUpdate = true;
    }
  }

  public dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    this.geometries = [];
    this.materials = [];
    this.wheelNodes = [];
    this.wheelGroups.length = 0;
    this.fixtureGroups.clear();
  }
}
