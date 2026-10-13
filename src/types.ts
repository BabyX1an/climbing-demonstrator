export type Point = { x: number; y: number };
export type Limb = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
export type HoldKind = 'jug' | 'edge' | 'sloper' | 'pinch' | 'pocket' | 'unknown';
export type HoldStatus = 'route' | 'candidate' | 'excluded';
export type UsageDirection = 'pull' | 'sidepull-left' | 'sidepull-right' | 'undercling' | 'downpress';

export interface ContactProfile {
  allowed: Array<'hand' | 'foot' | 'heel' | 'toe'>;
  usage: UsageDirection;
  normalAngleDeg: number;
  friction: number;
  capacityN: number;
  hookAllowed: boolean;
}

export interface Hold {
  id: string;
  center: Point;
  radius: Point;
  polygon?: Point[];
  kind: HoldKind;
  status: HoldStatus;
  source: 'ai' | 'manual';
  confirmed: boolean;
  depthCm: number;
  profile: ContactProfile;
}

export interface Route {
  name: string;
  colorSamples: string[];
  tolerance: number;
  startHoldIds: string[];
  topHoldId?: string;
  topRule: 'both-hands' | 'one-hand';
  topHoldSeconds: number;
}

export interface Pose {
  hip: Point;
  shoulder: Point;
  wallDepthM: number;
  torsoAngleDeg: number;
  endpoints: Record<Limb, Point>;
  contacts: Partial<Record<Limb, string>>;
  bend: Record<Limb, number>;
}

export interface Step {
  id: string;
  name: string;
  pose: Pose;
  movingLimb?: Limb;
  moveSeconds: number;
  holdSeconds: number;
  note: string;
  pathLift: number;
}

export interface Calibration {
  calibrated: boolean;
  metersPerImageHeight: number;
  wallAngleDeg: number;
  referenceMeters: number;
  reference?: [Point, Point];
  referenceQuad?: Point[];
  wallWidthM?: number;
}

export interface Climber {
  heightM: number;
  wingspanM: number;
  weightKg: number;
  strengthPreset: 'easy' | 'regular' | 'strong' | 'custom';
  coreCapacityNm: number;
  maxHandN: number;
  maxFootN: number;
}

export interface Thresholds {
  warningPercent: number;
  fallPercent: number;
  fallDurationSeconds: number;
}

export interface ProjectPhoto {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  updatedAt: string;
  photo: ProjectPhoto;
  holds: Hold[];
  route: Route;
  calibration: Calibration;
  climber: Climber;
  thresholds: Thresholds;
  steps: Step[];
}

export interface ContactForce { limb: Limb; fx: number; fy: number; magnitude: number }
export interface PhysicsResult {
  status: 'ok' | 'warning' | 'fall' | 'unknown';
  converged: boolean;
  residual: number;
  coreLoadPercent: number;
  centerOfMass: Point;
  forces: ContactForce[];
  reasons: string[];
}

export interface MotionFrame { time: number; pose: Pose; physics: PhysicsResult; stepIndex: number }
export interface MotionTrack { duration: number; sampleRate: number; frames: MotionFrame[]; warnings: string[] }

export type EditorTool = 'select' | 'set-start' | 'add-hold' | 'sample-color' | 'calibrate' | 'pan';
export type EditorMode = 'route' | 'climb';
