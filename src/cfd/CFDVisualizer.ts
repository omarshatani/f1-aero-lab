import * as THREE from 'three';
import { cpToRgb } from '../geometry/splineSurface';
import { CFDGridField, CFDResult, StreamlineColorMode, Vec3 } from '../types/aero';
import { sampleCFDField } from './CFDSolver';

export type RakePreset = 'full_car' | 'front_outwash' | 'underfloor' | 'rear_wake';

function velocityRatioToRgb(ratio: number): [number, number, number] {
  // ratio = |V| / V_inf, typically [0.2 .. 1.55]
  const r = Math.max(0.2, Math.min(1.55, ratio));
  if (r < 0.75) {
    const t = (r - 0.2) / 0.55;
    return [0.08 + 0.04 * t, 0.18 + 0.45 * t, 0.58 + 0.38 * t];
  } else if (r < 1.08) {
    const t = (r - 0.75) / 0.33;
    return [0.12 + 0.08 * t, 0.63 + 0.28 * t, 0.96 - 0.48 * t];
  } else {
    const t = (r - 1.08) / 0.47;
    return [0.2 + 0.8 * t, 0.91 - 0.22 * t, 0.48 - 0.38 * t];
  }
}

function turbulenceToRgb(turb: number): [number, number, number] {
  const t = Math.max(0, Math.min(0.9, turb)) / 0.9;
  if (t < 0.3) {
    const f = t / 0.3;
    return [0.12 + 0.1 * f, 0.58 + 0.15 * f, 0.78 + 0.1 * f];
  }
  const f = (t - 0.3) / 0.7;
  return [0.25 + 0.75 * f, 0.72 - 0.52 * f, 0.85 - 0.35 * f];
}

function createParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(220,245,255,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

interface IntegratedStreamline {
  pts: Vec3[];
  velRatio: number[];
  cp: number[];
  turb: number[];
}

export class CFDVisualizer {
  public readonly root = new THREE.Group();

  private lineMesh: THREE.LineSegments | null = null;
  private particlePoints: THREE.Points | null = null;
  private sliceMesh: THREE.Mesh;
  private sliceBorder: THREE.LineLoop;
  private sliceTexture: THREE.DataTexture;

  private streamlines: IntegratedStreamline[] = [];
  private particlePhases: Float32Array = new Float32Array(0);
  private particleStreamIdx: Uint16Array = new Uint16Array(0);

  private currentResult: CFDResult | null = null;
  private colorMode: StreamlineColorMode = 'velocity';
  private rakePreset: RakePreset = 'full_car';
  private showStreamlines = true;
  private showSlicePlane = true;
  private sliceZ = 1.25; // Default slice behind sidepods / over diffuser

  private readonly particleSprite = createParticleTexture();

  constructor() {
    this.root.name = 'CFDVisualizer';
    this.root.visible = false;

    // 2D Cross-Section Slice Plane (Z = const)
    const texW = 96;
    const texH = 64;
    const data = new Uint8Array(texW * texH * 4);
    this.sliceTexture = new THREE.DataTexture(data, texW, texH, THREE.RGBAFormat);
    this.sliceTexture.magFilter = THREE.LinearFilter;
    this.sliceTexture.minFilter = THREE.LinearFilter;
    this.sliceTexture.needsUpdate = true;

    const planeW = 2.64; // [-1.32 .. +1.32]
    const planeH = 1.32; // [0.00 .. +1.32]
    const sliceGeo = new THREE.PlaneGeometry(planeW, planeH);
    const sliceMat = new THREE.MeshBasicMaterial({
      map: this.sliceTexture,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sliceMesh = new THREE.Mesh(sliceGeo, sliceMat);
    this.sliceMesh.position.set(0, planeH * 0.5, this.sliceZ);
    this.root.add(this.sliceMesh);

    const borderPts = [
      new THREE.Vector3(-planeW * 0.5, -planeH * 0.5, 0),
      new THREE.Vector3(planeW * 0.5, -planeH * 0.5, 0),
      new THREE.Vector3(planeW * 0.5, planeH * 0.5, 0),
      new THREE.Vector3(-planeW * 0.5, planeH * 0.5, 0),
    ];
    this.sliceBorder = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(borderPts),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 })
    );
    this.sliceMesh.add(this.sliceBorder);
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public setColorMode(mode: StreamlineColorMode): void {
    this.colorMode = mode;
    this.rebuildStreamlineColors();
    this.updateSliceTexture();
  }

  public setRakePreset(preset: RakePreset): void {
    this.rakePreset = preset;
    if (this.currentResult) {
      this.buildStreamlinesFromField(this.currentResult);
    }
  }

  public setStreamlinesVisible(show: boolean): void {
    this.showStreamlines = show;
    if (this.lineMesh) this.lineMesh.visible = show;
    if (this.particlePoints) this.particlePoints.visible = show;
  }

  public setSliceVisible(show: boolean): void {
    this.showSlicePlane = show;
    this.sliceMesh.visible = show;
    if (show) {
      this.updateSliceTexture();
    }
  }

  public setSliceZ(z: number): void {
    this.sliceZ = Math.max(-3.20, Math.min(3.20, z));
    this.sliceMesh.position.z = this.sliceZ;
    this.updateSliceTexture();
  }

  public getSliceZ(): number {
    return this.sliceZ;
  }

  public updateFromResult(result: CFDResult): void {
    this.currentResult = result;
    this.buildStreamlinesFromField(result);
    this.updateSliceTexture();
  }

  private generateRakeSeeds(): Vec3[] {
    const seeds: Vec3[] = [];

    if (this.rakePreset === 'front_outwash') {
      // Dense rake ahead of 2026 Front Wing, Tires & Floor Boards
      for (const side of [-1, 1]) {
        for (let ix = 0; ix <= 7; ix++) {
          const x = side * (0.08 + ix * 0.125);
          for (let iy = 0; iy <= 4; iy++) {
            seeds.push({ x, y: 0.06 + iy * 0.095, z: -3.18 });
          }
        }
      }
    } else if (this.rakePreset === 'underfloor') {
      // Low ground-effect rake feeding tea-tray bib, step-plane floor & diffuser
      for (let ix = -7; ix <= 7; ix++) {
        const x = ix * 0.105;
        for (let iy = 0; iy <= 2; iy++) {
          seeds.push({ x, y: 0.028 + iy * 0.046, z: -3.15 });
        }
      }
    } else if (this.rakePreset === 'rear_wake') {
      // Focused on 2026 Floor Boards, Coke-Bottle Sidepods, Diffuser & Beamless Rear Wing
      for (let ix = -6; ix <= 6; ix++) {
        const x = ix * 0.105;
        for (let iy = 0; iy <= 5; iy++) {
          seeds.push({ x, y: 0.08 + iy * 0.175, z: -1.15 });
        }
      }
    } else {
      // Full Car Wind Tunnel Matrix
      const xs = [-0.92, -0.74, -0.55, -0.36, -0.18, 0.0, 0.18, 0.36, 0.55, 0.74, 0.92];
      const ys = [0.045, 0.14, 0.28, 0.46, 0.68, 0.90];
      for (const x of xs) {
        for (const y of ys) {
          seeds.push({ x, y, z: -3.20 });
        }
      }
    }

    return seeds;
  }

  private buildStreamlinesFromField(result: CFDResult): void {
    const field: CFDGridField = result.field;
    const vInf = Math.max(10, result.settings.windSpeedKmh / 3.6);
    const seeds = this.generateRakeSeeds();

    const stepLength = 0.095; // meters per RK2 step
    const maxSteps = 76;
    const integrated: IntegratedStreamline[] = [];

    for (const seed of seeds) {
      const pts: Vec3[] = [];
      const velRatio: number[] = [];
      const cpArr: number[] = [];
      const turbArr: number[] = [];

      let x = seed.x;
      let y = seed.y;
      let z = seed.z;

      for (let s = 0; s < maxSteps; s++) {
        if (
          x < field.minX + 0.02 ||
          x > field.maxX - 0.02 ||
          y < 0.008 ||
          y > field.maxY - 0.02 ||
          z > field.maxZ - 0.03
        ) {
          break;
        }

        const f1 = sampleCFDField(field, x, y, z);
        const mag1 = Math.hypot(f1.vx, f1.vy, f1.vz) || vInf;

        pts.push({ x, y, z });
        velRatio.push(mag1 / vInf);
        cpArr.push(f1.cp);
        turbArr.push(f1.turb);

        // Midpoint RK2 integration for smooth curved streamlines
        const dt = stepLength / mag1;
        const mx = x + 0.5 * f1.vx * dt;
        const my = Math.max(0.012, y + 0.5 * f1.vy * dt);
        const mz = z + 0.5 * f1.vz * dt;

        const f2 = sampleCFDField(field, mx, my, mz);
        const mag2 = Math.hypot(f2.vx, f2.vy, f2.vz) || vInf;
        const dt2 = stepLength / mag2;

        x += f2.vx * dt2;
        y = Math.max(0.012, y + f2.vy * dt2);
        z += Math.max(0.02, f2.vz * dt2);
      }

      if (pts.length >= 4) {
        integrated.push({ pts, velRatio, cp: cpArr, turb: turbArr });
      }
    }

    this.streamlines = integrated;

    // Build LineSegments geometry
    let totalSegs = 0;
    for (const sl of integrated) {
      totalSegs += sl.pts.length - 1;
    }

    const linePositions = new Float32Array(totalSegs * 2 * 3);
    const lineColors = new Float32Array(totalSegs * 2 * 3);

    let ptr = 0;
    for (const sl of integrated) {
      for (let i = 0; i < sl.pts.length - 1; i++) {
        const a = sl.pts[i];
        const b = sl.pts[i + 1];
        linePositions[ptr] = a.x;
        linePositions[ptr + 1] = a.y;
        linePositions[ptr + 2] = a.z;
        linePositions[ptr + 3] = b.x;
        linePositions[ptr + 4] = b.y;
        linePositions[ptr + 5] = b.z;
        ptr += 6;
      }
    }

    if (this.lineMesh) {
      this.lineMesh.geometry.dispose();
      this.root.remove(this.lineMesh);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lineMesh = new THREE.LineSegments(lineGeo, lineMat);
    this.lineMesh.visible = this.showStreamlines;
    this.root.add(this.lineMesh);

    // Build animated tracer particles (3 tracers per streamline)
    const tracersPerLine = 3;
    const totalParticles = integrated.length * tracersPerLine;
    this.particlePhases = new Float32Array(totalParticles);
    this.particleStreamIdx = new Uint16Array(totalParticles);

    const pPos = new Float32Array(totalParticles * 3);
    const pCol = new Float32Array(totalParticles * 3);

    for (let s = 0; s < integrated.length; s++) {
      for (let t = 0; t < tracersPerLine; t++) {
        const idx = s * tracersPerLine + t;
        this.particleStreamIdx[idx] = s;
        this.particlePhases[idx] = (t / tracersPerLine + ((s * 0.173) % 1)) % 1;
      }
    }

    if (this.particlePoints) {
      this.particlePoints.geometry.dispose();
      this.root.remove(this.particlePoints);
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));

    const pMat = new THREE.PointsMaterial({
      size: 0.068,
      map: this.particleSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particlePoints = new THREE.Points(pGeo, pMat);
    this.particlePoints.visible = this.showStreamlines;
    this.root.add(this.particlePoints);

    this.rebuildStreamlineColors();
    this.updateAnimation(0);
  }

  private sampleColorForStreamPoint(
    sl: IntegratedStreamline,
    idx: number
  ): [number, number, number] {
    if (this.colorMode === 'pressure') {
      return cpToRgb(sl.cp[idx]);
    }
    if (this.colorMode === 'turbulence') {
      return turbulenceToRgb(sl.turb[idx]);
    }
    return velocityRatioToRgb(sl.velRatio[idx]);
  }

  private rebuildStreamlineColors(): void {
    if (!this.lineMesh) return;
    const colorAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = colorAttr.array as Float32Array;

    let ptr = 0;
    for (const sl of this.streamlines) {
      for (let i = 0; i < sl.pts.length - 1; i++) {
        const cA = this.sampleColorForStreamPoint(sl, i);
        const cB = this.sampleColorForStreamPoint(sl, i + 1);
        arr[ptr] = cA[0];
        arr[ptr + 1] = cA[1];
        arr[ptr + 2] = cA[2];
        arr[ptr + 3] = cB[0];
        arr[ptr + 4] = cB[1];
        arr[ptr + 5] = cB[2];
        ptr += 6;
      }
    }
    colorAttr.needsUpdate = true;
  }

  private updateSliceTexture(): void {
    if (!this.currentResult || !this.showSlicePlane) return;
    const field = this.currentResult.field;
    const vInf = Math.max(10, this.currentResult.settings.windSpeedKmh / 3.6);

    const img = this.sliceTexture.image as { data: Uint8Array; width: number; height: number };
    const w = img.width;
    const h = img.height;
    const data = img.data;

    for (let py = 0; py < h; py++) {
      const wy = field.minY + (py / (h - 1)) * (field.maxY - field.minY);
      for (let px = 0; px < w; px++) {
        // Note: PlaneGeometry facing -Z/+Z: UV u=0 is -X or +X depending on camera; standard PlaneGeometry faces +Z so u=0 is -X, u=1 is +X!
        const wx = field.minX + (px / (w - 1)) * (field.maxX - field.minX);
        const s = sampleCFDField(field, wx, wy, this.sliceZ);

        let rgb: [number, number, number];
        let alpha = 155;

        if (this.colorMode === 'pressure') {
          rgb = cpToRgb(s.cp);
          alpha = Math.round(80 + Math.min(165, Math.abs(s.cp) * 150));
        } else if (this.colorMode === 'turbulence') {
          rgb = turbulenceToRgb(s.turb);
          alpha = Math.round(45 + Math.min(200, s.turb * 260));
        } else {
          const ratio = Math.hypot(s.vx, s.vy, s.vz) / vInf;
          rgb = velocityRatioToRgb(ratio);
          alpha = Math.round(75 + Math.min(165, Math.abs(ratio - 1.0) * 260 + s.turb * 120));
        }

        const off = (py * w + px) * 4;
        data[off] = Math.round(rgb[0] * 255);
        data[off + 1] = Math.round(rgb[1] * 255);
        data[off + 2] = Math.round(rgb[2] * 255);
        data[off + 3] = alpha;
      }
    }

    this.sliceTexture.needsUpdate = true;
  }

  public updateAnimation(dt: number): void {
    if (!this.root.visible || !this.particlePoints || !this.showStreamlines) return;
    if (this.streamlines.length === 0) return;

    const speedScale = this.currentResult
      ? (this.currentResult.settings.windSpeedKmh / 250) * 0.48
      : 0.45;

    const posAttr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.particlePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pArr = posAttr.array as Float32Array;
    const cArr = colAttr.array as Float32Array;

    for (let i = 0; i < this.particlePhases.length; i++) {
      const sl = this.streamlines[this.particleStreamIdx[i]];
      if (!sl || sl.pts.length < 2) continue;

      let phase = this.particlePhases[i] + dt * speedScale;
      if (phase >= 1) phase -= Math.floor(phase);
      this.particlePhases[i] = phase;

      const fIdx = phase * (sl.pts.length - 1);
      const idx0 = Math.min(sl.pts.length - 2, Math.floor(fIdx));
      const frac = fIdx - idx0;

      const p0 = sl.pts[idx0];
      const p1 = sl.pts[idx0 + 1];
      const o = i * 3;
      pArr[o] = p0.x + (p1.x - p0.x) * frac;
      pArr[o + 1] = p0.y + (p1.y - p0.y) * frac;
      pArr[o + 2] = p0.z + (p1.z - p0.z) * frac;

      const rgb = this.sampleColorForStreamPoint(sl, idx0);
      cArr[o] = Math.min(1, rgb[0] * 1.25);
      cArr[o + 1] = Math.min(1, rgb[1] * 1.25);
      cArr[o + 2] = Math.min(1, rgb[2] * 1.25);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
}
