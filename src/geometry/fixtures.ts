import * as THREE from 'three';
import {
  DEFAULT_WHEEL_STANCE,
  fiaMmToWorld,
  WORLD_FRONT_AXLE_Z,
  WORLD_REAR_AXLE_Z,
} from '../regulations/fia2026';
import { FixtureId, WheelStanceSettings } from '../types/aero';

interface WheelNode {
  id: 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr';
  isFront: boolean;
  isRight: boolean;
  baseX: number;
  baseY: number;
  baseZ: number;
  stancePivot: THREE.Group;
  spinGroup: THREE.Group;
}

export class ProceduralFixturesManager {
  public readonly root = new THREE.Group();
  public readonly wheelGroups: THREE.Group[] = [];

  private wheelNodes: WheelNode[] = [];
  private fixtureGroups = new Map<FixtureId, THREE.Group>();
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor() {
    this.root.name = 'ProceduralFixturesManager';
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

  private buildWheels(): void {
    const tireMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.92,
        metalness: 0.08,
      })
    );
    const rimMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x27272a,
        roughness: 0.45,
        metalness: 0.55,
      })
    );
    const deflectorMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x09090b,
        roughness: 0.35,
        metalness: 0.65,
      })
    );
    const brakeMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x3f3f46,
        roughness: 0.25,
        metalness: 0.85,
      })
    );

    const axleY = 0.3608;
    const wheelSpecs: Array<{
      id: 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr';
      isFront: boolean;
      isRight: boolean;
      baseX: number;
      baseZ: number;
      width: number;
    }> = [
      { id: 'wheel_fl', isFront: true, isRight: false, baseX: -0.82, baseZ: WORLD_FRONT_AXLE_Z, width: 0.345 },
      { id: 'wheel_fr', isFront: true, isRight: true, baseX: 0.82, baseZ: WORLD_FRONT_AXLE_Z, width: 0.345 },
      { id: 'wheel_rl', isFront: false, isRight: false, baseX: -0.80, baseZ: WORLD_REAR_AXLE_Z, width: 0.405 },
      { id: 'wheel_rr', isFront: false, isRight: true, baseX: 0.80, baseZ: WORLD_REAR_AXLE_Z, width: 0.405 },
    ];

    for (const spec of wheelSpecs) {
      const stancePivot = new THREE.Group();
      stancePivot.name = `${spec.id}_stance`;
      stancePivot.position.set(spec.baseX, axleY, spec.baseZ);

      const spinGroup = new THREE.Group();
      spinGroup.name = `${spec.id}_spin`;

      // 1. Tire Tread (outer radius = 0.360m)
      const tireGeo = this.registerGeo(
        new THREE.CylinderGeometry(0.36, 0.36, spec.width, 32, 1, false)
      );
      tireGeo.rotateZ(Math.PI / 2);
      const tireMesh = new THREE.Mesh(tireGeo, tireMat);
      spinGroup.add(tireMesh);

      // 2. Wheel Rim Cover Disk (radius = 0.228m)
      const rimGeo = this.registerGeo(
        new THREE.CylinderGeometry(0.228, 0.228, spec.width * 0.98, 24, 1, false)
      );
      rimGeo.rotateZ(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      spinGroup.add(rimMesh);

      // 3. Central Wheel Nut
      const nutGeo = this.registerGeo(
        new THREE.CylinderGeometry(0.045, 0.045, spec.width * 1.05, 12)
      );
      nutGeo.rotateZ(Math.PI / 2);
      const nutMat = this.registerMat(
        new THREE.MeshStandardMaterial({
          color: spec.isRight ? 0xef4444 : 0x3b82f6,
          roughness: 0.3,
          metalness: 0.8,
        })
      );
      const nutMesh = new THREE.Mesh(nutGeo, nutMat);
      spinGroup.add(nutMesh);

      // 4. Brake Disc (inboard side)
      const brakeGeo = this.registerGeo(
        new THREE.CylinderGeometry(0.18, 0.18, 0.035, 20)
      );
      brakeGeo.rotateZ(Math.PI / 2);
      const brakeMesh = new THREE.Mesh(brakeGeo, brakeMat);
      brakeMesh.position.x = (spec.isRight ? -1 : 1) * (spec.width * 0.35);
      spinGroup.add(brakeMesh);

      stancePivot.add(spinGroup);

      // 5. Front Wheel Wake Deflector (non-spinning, attached to stance pivot)
      if (spec.isFront) {
        const deflectorGeo = this.registerGeo(new THREE.BoxGeometry(0.03, 0.38, 0.42));
        const deflectorMesh = new THREE.Mesh(deflectorGeo, deflectorMat);
        const signX = spec.isRight ? 1 : -1;
        deflectorMesh.position.set(signX * (spec.width * 0.52), 0.12, -0.05);
        deflectorMesh.rotation.y = signX * 0.08;
        stancePivot.add(deflectorMesh);
      }

      const fixtureGroup = new THREE.Group();
      fixtureGroup.name = spec.id;
      fixtureGroup.add(stancePivot);

      this.root.add(fixtureGroup);
      this.wheelGroups.push(stancePivot);
      this.fixtureGroups.set(spec.id, fixtureGroup);

      this.wheelNodes.push({
        id: spec.id,
        isFront: spec.isFront,
        isRight: spec.isRight,
        baseX: spec.baseX,
        baseY: axleY,
        baseZ: spec.baseZ,
        stancePivot,
        spinGroup,
      });
    }
  }

  private buildHalo(): void {
    const haloGroup = new THREE.Group();
    haloGroup.name = 'halo_structure';

    const haloMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x3f3f46,
        roughness: 0.38,
        metalness: 0.82,
      })
    );

    // 1. Center Pylon Pillar (from front mount rising to apex)
    const pFront = fiaMmToWorld(580, 0, 640);
    const pApex = fiaMmToWorld(820, 0, 930);

    const pillarCurve = new THREE.LineCurve3(
      new THREE.Vector3(pFront.x, pFront.y, pFront.z),
      new THREE.Vector3(pApex.x, pApex.y, pApex.z)
    );
    const pillarGeo = this.registerGeo(new THREE.TubeGeometry(pillarCurve, 8, 0.024, 12, false));
    const pillarMesh = new THREE.Mesh(pillarGeo, haloMat);
    haloGroup.add(pillarMesh);

    // 2. Halo Hoop (ellipse from apex to left and right rear mounts)
    const pRearL = fiaMmToWorld(1520, -220, 740);
    const pRearR = fiaMmToWorld(1520, 220, 740);

    const hoopPoints = [
      new THREE.Vector3(pRearL.x, pRearL.y, pRearL.z),
      new THREE.Vector3(pRearL.x * 1.15, pApex.y * 0.98, (pRearL.z + pApex.z) * 0.5),
      new THREE.Vector3(pApex.x, pApex.y, pApex.z),
      new THREE.Vector3(pRearR.x * 1.15, pApex.y * 0.98, (pRearR.z + pApex.z) * 0.5),
      new THREE.Vector3(pRearR.x, pRearR.y, pRearR.z),
    ];
    const hoopCurve = new THREE.CatmullRomCurve3(hoopPoints);
    const hoopGeo = this.registerGeo(new THREE.TubeGeometry(hoopCurve, 24, 0.022, 12, false));
    const hoopMesh = new THREE.Mesh(hoopGeo, haloMat);
    haloGroup.add(hoopMesh);

    this.root.add(haloGroup);
    this.fixtureGroups.set('halo_structure', haloGroup);
  }

  private buildMirrors(): void {
    const mirrorMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.35,
        metalness: 0.65,
      })
    );
    const glassMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.05,
        metalness: 0.95,
      })
    );

    for (const isRight of [false, true]) {
      const id: FixtureId = isRight ? 'mirror_r' : 'mirror_l';
      const mGroup = new THREE.Group();
      mGroup.name = id;

      const signX = isRight ? 1 : -1;
      const rootPos = fiaMmToWorld(980, signX * 360, 540);
      const podPos = fiaMmToWorld(1040, signX * 520, 620);

      // Stalk
      const stalkCurve = new THREE.LineCurve3(
        new THREE.Vector3(rootPos.x, rootPos.y, rootPos.z),
        new THREE.Vector3(podPos.x, podPos.y, podPos.z)
      );
      const stalkGeo = this.registerGeo(new THREE.TubeGeometry(stalkCurve, 4, 0.012, 8));
      mGroup.add(new THREE.Mesh(stalkGeo, mirrorMat));

      // Mirror Housing
      const podGeo = this.registerGeo(new THREE.BoxGeometry(0.14, 0.065, 0.055));
      const podMesh = new THREE.Mesh(podGeo, mirrorMat);
      podMesh.position.set(podPos.x, podPos.y, podPos.z);
      podMesh.rotation.y = signX * 0.15;
      mGroup.add(podMesh);

      // Reflective Glass
      const glassGeo = this.registerGeo(new THREE.PlaneGeometry(0.12, 0.052));
      const glassMesh = new THREE.Mesh(glassGeo, glassMat);
      glassMesh.position.set(podPos.x, podPos.y, podPos.z + 0.029);
      glassMesh.rotation.y = signX * 0.15;
      mGroup.add(glassMesh);

      this.root.add(mGroup);
      this.fixtureGroups.set(id, mGroup);
    }
  }

  private buildDriverHelmet(): void {
    const helmetGroup = new THREE.Group();
    helmetGroup.name = 'driver_helmet';

    const pHead = fiaMmToWorld(1180, 0, 710);
    helmetGroup.position.set(pHead.x, pHead.y, pHead.z);

    // Helmet Dome
    const domeMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.22,
        metalness: 0.35,
      })
    );
    const domeGeo = this.registerGeo(new THREE.SphereGeometry(0.125, 18, 14));
    domeGeo.scale(0.85, 1.0, 1.15);
    helmetGroup.add(new THREE.Mesh(domeGeo, domeMat));

    // Dark Visor Band
    const visorMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x09090b,
        roughness: 0.08,
        metalness: 0.92,
      })
    );
    const visorGeo = this.registerGeo(new THREE.BoxGeometry(0.19, 0.045, 0.08));
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.015, -0.095);
    helmetGroup.add(visorMesh);

    this.root.add(helmetGroup);
    this.fixtureGroups.set('driver_helmet', helmetGroup);
  }

  private buildCockpitInterior(): void {
    const cockpitGroup = new THREE.Group();
    cockpitGroup.name = 'cockpit_interior';

    const tubMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.75,
        metalness: 0.2,
      })
    );

    // Cockpit Tub Cutout Rim
    const pCenter = fiaMmToWorld(1080, 0, 520);
    const tubGeo = this.registerGeo(new THREE.BoxGeometry(0.48, 0.28, 0.85));
    const tubMesh = new THREE.Mesh(tubGeo, tubMat);
    tubMesh.position.set(pCenter.x, pCenter.y, pCenter.z);
    cockpitGroup.add(tubMesh);

    // 2026-Spec Butterfly Steering Wheel
    const wheelMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0x27272a,
        roughness: 0.4,
        metalness: 0.6,
      })
    );
    const pWheel = fiaMmToWorld(840, 0, 610);
    const swGeo = this.registerGeo(new THREE.BoxGeometry(0.24, 0.14, 0.035));
    const swMesh = new THREE.Mesh(swGeo, wheelMat);
    swMesh.position.set(pWheel.x, pWheel.y, pWheel.z);
    swMesh.rotation.x = 0.25;
    cockpitGroup.add(swMesh);

    // Steering Wheel Screen Display
    const screenMat = this.registerMat(
      new THREE.MeshBasicMaterial({
        color: 0x00d2be,
      })
    );
    const screenGeo = this.registerGeo(new THREE.PlaneGeometry(0.09, 0.055));
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(pWheel.x, pWheel.y + 0.015, pWheel.z - 0.019);
    screenMesh.rotation.x = 0.25;
    cockpitGroup.add(screenMesh);

    this.root.add(cockpitGroup);
    this.fixtureGroups.set('cockpit_interior', cockpitGroup);
  }

  private buildExhaust(): void {
    const exhaustGroup = new THREE.Group();
    exhaustGroup.name = 'exhaust_tailpipe';

    const pExh = fiaMmToWorld(3620, 0, 340);
    const exhMat = this.registerMat(
      new THREE.MeshStandardMaterial({
        color: 0xa1a1aa,
        roughness: 0.28,
        metalness: 0.85,
      })
    );

    const exhGeo = this.registerGeo(new THREE.CylinderGeometry(0.065, 0.065, 0.18, 16));
    exhGeo.rotateX(Math.PI / 2);
    const exhMesh = new THREE.Mesh(exhGeo, exhMat);
    exhMesh.position.set(pExh.x, pExh.y, pExh.z);
    exhaustGroup.add(exhMesh);

    this.root.add(exhaustGroup);
    this.fixtureGroups.set('exhaust_tailpipe', exhaustGroup);
  }

  public applyWheelStance(stance: WheelStanceSettings): void {
    const degToRad = Math.PI / 180;
    const dishScaleX = Math.max(0.85, Math.min(1.2, 1 + stance.rimCoverDishMm * 0.002));

    for (const wn of this.wheelNodes) {
      const trackOffM =
        (wn.isFront ? stance.frontTrackOffsetMm : stance.rearTrackOffsetMm) * 0.001;
      const camberDeg = wn.isFront ? stance.frontCamberDeg : stance.rearCamberDeg;
      const toeDeg = wn.isFront ? stance.frontToeDeg : 0;
      const signX = wn.isRight ? 1 : -1;

      wn.stancePivot.position.x = wn.baseX + signX * trackOffM;
      wn.stancePivot.position.y = wn.baseY;
      wn.stancePivot.position.z = wn.baseZ;

      wn.stancePivot.rotation.z = signX * camberDeg * degToRad;
      wn.stancePivot.rotation.y = -signX * toeDeg * degToRad;
      wn.stancePivot.scale.set(dishScaleX, 1, 1);
    }
  }

  public updateWheelSpin(dt: number, windSpeedKmh: number, active: boolean): void {
    if (!active) return;
    const vMs = windSpeedKmh / 3.6;
    const omega = vMs / 0.36; // wheel outer radius = 0.36m
    for (const wn of this.wheelNodes) {
      wn.spinGroup.rotation.x -= omega * dt * 0.28;
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
      mat.opacity = ghost ? 0.22 : 1.0;
      mat.depthWrite = !ghost;
    }
  }

  public dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    this.root.clear();
    this.wheelGroups.length = 0;
    this.wheelNodes.length = 0;
    this.fixtureGroups.clear();
  }
}
