import { Vec3 } from '../types/aero';

export interface AntiFoldResult {
  valid: boolean;
  minDeterminant: number;
  invertedCells: Array<{ u: number; v: number }>;
}

export interface DragConstraintConfig {
  clampToFIA: boolean;
  preventFold: boolean;
  lockHardpoints: boolean;
}

export interface DragValidationResult {
  allowed: boolean;
  clampedPosition: Vec3;
  antiFoldOk: boolean;
  hardpointOk: boolean;
  fiaLegal: boolean;
  reason?: string;
}
