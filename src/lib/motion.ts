import type { Limb, MotionTrack, Point, Pose, Project } from '../types';
import { evaluatePose } from './physics';

const limbs: Limb[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const point = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const ease = (t: number) => t * t * (3 - 2 * t);
const springEase = (t: number) => t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(9 * t);

export function interpolatePose(a: Pose, b: Pose, rawT: number, moving?: Limb, lift = .035): Pose {
  const t = ease(rawT); const bodyT = springEase(rawT); const result: Pose = structuredClone(a);
  result.hip = point(a.hip, b.hip, bodyT); result.shoulder = point(a.shoulder, b.shoulder, bodyT);
  result.wallDepthM = lerp(a.wallDepthM, b.wallDepthM, bodyT); result.torsoAngleDeg = lerp(a.torsoAngleDeg, b.torsoAngleDeg, bodyT);
  for (const limb of limbs) {
    const changedContact = a.contacts[limb] !== b.contacts[limb];
    const changedPosition = Math.hypot(a.endpoints[limb].x - b.endpoints[limb].x, a.endpoints[limb].y - b.endpoints[limb].y) > .008;
    const movingLimb = limb === moving || changedContact || changedPosition;
    result.endpoints[limb] = point(a.endpoints[limb], b.endpoints[limb], t);
    if (movingLimb) result.endpoints[limb].y -= Math.sin(Math.PI * t) * lift;
    result.bend[limb] = lerp(a.bend[limb], b.bend[limb], t);
    if (movingLimb && changedContact) {
      if (rawT < .12) result.contacts[limb] = a.contacts[limb];
      else if (rawT < .88) delete result.contacts[limb];
      else if (b.contacts[limb]) result.contacts[limb] = b.contacts[limb];
      else delete result.contacts[limb];
    } else if (a.contacts[limb] && a.contacts[limb] === b.contacts[limb]) {
      result.contacts[limb] = a.contacts[limb];
    } else result.contacts[limb] = b.contacts[limb];
  }
  // When a limb releases, the body yields briefly under gravity. Contacted
  // endpoints stay fixed, so the motion reads as body weight rather than the
  // wall holds moving with the climber.
  const supportCount = Object.keys(result.contacts).length;
  const hasMovingLimb = limbs.some(limb => limb === moving || a.contacts[limb] !== b.contacts[limb] || Math.hypot(a.endpoints[limb].x - b.endpoints[limb].x, a.endpoints[limb].y - b.endpoints[limb].y) > .008);
  const airbornePhase = hasMovingLimb && rawT > .12 && rawT < .88 ? Math.sin(Math.PI * (rawT - .12) / .76) : 0;
  const gravitySag = airbornePhase * (supportCount <= 1 ? .045 : supportCount === 2 ? .022 : .009);
  result.hip.y += gravitySag; result.shoulder.y += gravitySag * .82;
  for (const limb of limbs) if (!result.contacts[limb]) result.endpoints[limb].y += gravitySag * (limb === moving ? .2 : .65);
  return result;
}

export function compileMotion(project: Project, sampleRate = 60): MotionTrack {
  const frames: MotionTrack['frames'] = []; const warnings: string[] = [];
  if (!project.steps.length) return { duration: 0, sampleRate, frames, warnings: ['没有动作步骤'] };
  let time = 0; let overload = 0; let fallingFor = 0;
  const firstPhysics = evaluatePose(project, project.steps[0].pose);
  frames.push({ time, pose: structuredClone(project.steps[0].pose), physics: firstPhysics, stepIndex: 0 });
  for (let s = 1; s < project.steps.length; s++) {
    const prev = project.steps[s - 1], next = project.steps[s];
    const moveFrames = Math.max(2, Math.round(next.moveSeconds * sampleRate));
    for (let i = 1; i <= moveFrames; i++) {
      let pose = interpolatePose(prev.pose, next.pose, i / moveFrames, next.movingLimb, next.pathLift);
      let physics = evaluatePose(project, pose); time += 1 / sampleRate;
      overload = physics.coreLoadPercent > project.thresholds.fallPercent ? overload + 1 / sampleRate : 0;
      fallingFor = physics.status === 'fall' ? fallingFor + 1 / sampleRate : Math.max(0, fallingFor - 2 / sampleRate);
      if (fallingFor > project.thresholds.fallDurationSeconds) { pose = gravityDrop(pose, fallingFor - project.thresholds.fallDurationSeconds); physics = evaluatePose(project, pose); }
      if (overload >= project.thresholds.fallDurationSeconds && !warnings.some(w => w.includes(`步骤 ${s + 1}`))) warnings.push(`步骤 ${s + 1} 过渡中持续超出负荷阈值`);
      if (physics.status === 'fall' && !warnings.some(w => w.includes(`步骤 ${s + 1}`))) warnings.push(`步骤 ${s + 1} 过渡中失去稳定支撑`);
      frames.push({ time, pose, physics, stepIndex: s });
    }
    for (let i = 0; i < Math.round(next.holdSeconds * sampleRate); i++) {
      let pose = structuredClone(next.pose); let physics = evaluatePose(project, pose); time += 1 / sampleRate;
      overload = physics.coreLoadPercent > project.thresholds.fallPercent ? overload + 1 / sampleRate : 0;
      fallingFor = physics.status === 'fall' ? fallingFor + 1 / sampleRate : Math.max(0, fallingFor - 2 / sampleRate);
      if (fallingFor > project.thresholds.fallDurationSeconds) { pose = gravityDrop(pose, fallingFor - project.thresholds.fallDurationSeconds); physics = evaluatePose(project, pose); }
      frames.push({ time, pose, physics, stepIndex: s });
    }
  }
  return { duration: time, sampleRate, frames, warnings };
}

function gravityDrop(source: Pose, elapsed: number): Pose {
  const pose = structuredClone(source); const drop = Math.min(.34, .018 + .72 * elapsed * elapsed); const sway = Math.sin(elapsed * 8) * Math.min(.018, elapsed * .012);
  pose.contacts = {};
  pose.hip = { x: pose.hip.x + sway, y: pose.hip.y + drop };
  pose.shoulder = { x: pose.shoulder.x - sway * .35, y: pose.shoulder.y + drop };
  for (const limb of limbs) pose.endpoints[limb] = { x: pose.endpoints[limb].x + (limb.endsWith('Hand') ? -sway * .2 : sway), y: pose.endpoints[limb].y + drop };
  return pose;
}

export function frameAt(track: MotionTrack, time: number) {
  if (!track.frames.length) return undefined;
  return track.frames[Math.min(track.frames.length - 1, Math.max(0, Math.round(time * track.sampleRate)))];
}
