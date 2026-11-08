/**
 * Vehicle & Wind Tunnel Coordinate Convention:
 * - X: Lateral (+X = Starboard / Driver Right = +Y_FIA, -X = Port / Driver Left, 0 = Symmetry Plane)
 * - Y: Vertical (+Y = Up, 0 = Tire Contact Ground / Wind Tunnel Rolling Road; FIA Z=0 Reference Plane is +30.8mm)
 * - Z: Longitudinal (-Z = Front / Nosecone, +Z = Rear / Rear Wing; Freestream flows -Z -> +Z)
 *      Front Axle (X_F = 0) sits at Z = -1.70 m; Rear Axle (X_R = 0, X_F = 3400) sits at Z = +1.70 m.
 * Units: Meters (m) in 3D space, Newtons (N) for forces.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type CarModelId = 'fia_2026_concept';

/**
 * 2026 FIA Active Aerodynamics Mode (Art. 3.10.9 Front Wing & Art. 3.11.6 Rear Wing):
 * - 'z_mode': Standard High-Downforce Cornering configuration
 * - 'x_mode': Low-Drag Straight-Line configuration (flattens movable FW & RW flap cascades)
 */
export type ActiveAeroMode = 'z_mode' | 'x_mode';

export type PartId =
  | 'front_wing'
  | 'nosecone'
  | 'front_suspension'
  | 'monocoque'
  | 'floor_boards'
  | 'floor'
  | 'sidepods'
  | 'engine_cover'
  | 'rear_suspension'
  | 'diffuser'
  | 'rear_wing';

export type PartCategory = 'aero' | 'body' | 'suspension';

export type SurfaceRole =
  | 'wing'
  | 'wake_board'
  | 'ground_effect'
  | 'body_fairing'
  | 'diffuser'
  | 'chassis_body'
  | 'suspension';

/**
 * Named functional Sub-Zone within an aerodynamic or chassis component.
 */
export interface PartSubZone {
  id: string;
  label: string;
  description: string;
  uIndices: number[];
  vIndices: number[];
}

/**
 * Parametric engineering slider definition driving smooth macro FFD shaping on a part.
 */
export interface PartParamSlider {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

/**
 * Configurable 3D procedural aerodynamic appendage welded into a part's FFD & CFD pipeline.
 */
export interface ProceduralElementConfig {
  id: string;
  label: string;
  enabled: boolean;
  pitchDeg: number;
  scale: number;
  count: number;
  minCount?: number;
  maxCount?: number;
}

/**
 * Parametric 4-Wheel & Axle Stance settings coupled into 3D wheel pivots and CFD tire wake.
 */
export interface WheelStanceSettings {
  frontTrackOffsetMm: number;
  rearTrackOffsetMm: number;
  frontCamberDeg: number;
  rearCamberDeg: number;
  frontToeDeg: number;
  rimCoverDishMm: number;
}

/**
 * Official 2026 FIA Appendix 1 Reference Volume sub-frustum on the +X half-car
 * (mirrored automatically across X = 0).
 * Supports both sloped vertical planes (minYFront->minYRear, maxYFront->maxYRear)
 * and tapered lateral planes (minXFront->minXRear, maxXFront->maxXRear), plus
 * optional wheel-clearance cylinder exclusion (e.g. D=825mm front tire cutout in RV-FWEP).
 */
export interface LegalityBox {
  id: string;
  label: string;
  minX: number;
  maxX: number;
  minXFront?: number;
  maxXFront?: number;
  minXRear?: number;
  maxXRear?: number;
  minZ: number;
  maxZ: number;
  minYFront: number;
  maxYFront: number;
  minYRear: number;
  maxYRear: number;
  wheelCutout?: {
    axleZ: number;
    axleY: number;
    radius: number;
    minX: number;
  };
}

export interface AeroPartData {
  id: PartId;
  name: string;
  shortName: string;
  category: PartCategory;
  articleRef: string;
  description: string;
  role: SurfaceRole;
  accentHex: string;
  /** If true, spanwise index u=0 is locked onto the car symmetry plane X=0 */
  centerlineLocked: boolean;
  /** Nominal shell/airfoil skin tolerance in meters */
  thickness: number;
  /** Union of official FIA 2026 Reference Volumes inside which this part must lie */
  legalityBoxes: LegalityBox[];
  /** Number of lateral/feature control columns (u = 0 .. cols-1) */
  cols: number;
  /** Number of longitudinal/chordwise control rows (v = 0 .. rows-1, front to rear) */
  rows: number;
  /** 3D FFD control lattice grid[u][v] in meters on the +X half-car */
  grid: Vec3[][];
  /** Selectable functional Sub-Zones within this part */
  subZones: PartSubZone[];
  /** Engineering macro sliders for this part */
  paramSliders: PartParamSlider[];
  /** Current values of engineering macro sliders */
  paramValues: Record<string, number>;
  /** Configurable 3D procedural aero elements attached to this part */
  proceduralElements: ProceduralElementConfig[];
}

/**
 * Area-weighted aerodynamic surface patch extracted from the deformed 3D car mesh (+X half-car).
 */
export interface MacroAeroPanel {
  /** Centroid on +X half-car in meters (before ride-height transform) */
  cx: number;
  cy: number;
  cz: number;
  /** Outward unit normal on +X half-car */
  nx: number;
  ny: number;
  nz: number;
  /** Approximate local chordwise unit tangent (-Z -> +Z) */
  tx: number;
  ty: number;
  tz: number;
  /** True +X half-car surface area represented by this macro-panel (m^2) */
  area: number;
  /** Normalized spanwise [0..1] and chordwise [0..1] parameter in part bounds */
  su: number;
  sv: number;
}

export type AppMode = 'sculpt' | 'cfd';

export type SculptSelectMode =
  | 'node'
  | 'span_rib'
  | 'chord_edge'
  | 'sub_zone'
  | 'whole_part';

export type TransformAxisMode = 'translate' | 'bend_twist';

export interface NodeIndex {
  u: number;
  v: number;
}

export interface LegalityCheckResult {
  isLegal: boolean;
  violatingNodes: NodeIndex[];
  /** Signed minimum clearance to FIA boundary in millimeters (< 0 means outside box) */
  minClearanceMm: number;
  /** Out-of-bounds surface vertex count from real 3D mesh */
  outOfBoundsMeshVertices: number;
}

export interface TunnelSettings {
  windSpeedKmh: number;
  frontRideHeightMm: number;
  rearRideHeightMm: number;
  yawAngleDeg: number;
  activeAeroMode: ActiveAeroMode;
  wheelStance?: WheelStanceSettings;
}

export type StreamlineColorMode = 'velocity' | 'pressure' | 'turbulence';
export type SurfaceVizMode = 'carbon' | 'cp' | 'stall';

export interface PartCFDMetrics {
  partId: PartId;
  name: string;
  downforceN: number;
  dragN: number;
  cl: number;
  cd: number;
  ldRatio: number;
  stalledAreaPct: number;
  wakeExposurePct: number;
  isLegal: boolean;
  minClearanceMm: number;
}

export type DiagnosticSeverity = 'critical' | 'warning' | 'positive' | 'info';

export interface AeroDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  partId?: PartId;
  title: string;
  detail: string;
  suggestion: string;
}

export interface CFDGridField {
  nx: number;
  ny: number;
  nz: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  cp: Float32Array;
  turbulence: Float32Array;
  solid: Uint8Array;
}

export interface PartSurfaceCpMap {
  /** Sampled [uSample][vSample] Cp on upper (+normal) surface */
  upperCp: number[][];
  /** Sampled [uSample][vSample] Cp on lower (-normal) surface */
  lowerCp: number[][];
  /** Sampled [uSample][vSample] flow separation intensity [0..1] */
  separation: number[][];
}

export interface CFDResult {
  timestamp: number;
  settings: TunnelSettings;
  totalDownforceN: number;
  totalDragN: number;
  cl: number;
  cd: number;
  ldRatio: number;
  /** Percentage of total downforce acting on the front axle (ideal ~44% - 47.5%) */
  copFrontPct: number;
  /** Estimated terminal straight-line speed assuming 2026 F1 PU (~750 kW) */
  topSpeedEstKmh: number;
  /** Estimated sustained lateral G in a 240 km/h high-speed corner */
  highSpeedCornerG: number;
  allLegal: boolean;
  partMetrics: Record<PartId, PartCFDMetrics>;
  partSurfaceMaps: Record<PartId, PartSurfaceCpMap>;
  diagnostics: AeroDiagnostic[];
  field: CFDGridField;
}

export interface CarDesignSnapshot {
  name: string;
  createdAt: number;
  carModelId?: CarModelId;
  parts: Partial<Record<PartId, Vec3[][]>>;
  paramValues?: Partial<Record<PartId, Record<string, number>>>;
  proceduralElements?: Partial<Record<PartId, ProceduralElementConfig[]>>;
  wheelStance?: WheelStanceSettings;
  summary?: {
    cl: number;
    cd: number;
    ldRatio: number;
    copFrontPct: number;
    downforceN: number;
    dragN: number;
  };
}
