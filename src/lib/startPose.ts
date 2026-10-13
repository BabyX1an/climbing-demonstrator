import type { Hold, Point, Pose, Project } from '../types';
import { reachFor } from './physics';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function poseAtRouteStart(project: Project): { pose?: Pose; holds: Hold[]; warning?: string } {
  const holds = project.route.startHoldIds
    .map(id => project.holds.find(hold => hold.id === id && hold.status === 'route'))
    .filter((hold): hold is Hold => Boolean(hold))
    .slice(0, 2)
    .sort((a, b) => a.center.x - b.center.x);
  if (!holds.length) return { holds, warning: '请先在线路设置中指定至少一个起步点' };

  const left = holds[0];
  const right = holds[1] ?? holds[0];
  const reach = reachFor(project, 'leftHand');
  const shoulder = shoulderBelow(left.center, right.center, reach * .78);
  const torso = project.climber.heightM / Math.max(.5, project.calibration.metersPerImageHeight) * .31;
  const base = structuredClone(project.steps[0]?.pose);
  if (!base) return { holds, warning: '项目缺少初始姿势' };

  const hip = {
    x: clamp(shoulder.x + Math.sin(base.torsoAngleDeg * Math.PI / 180) * torso * .18, -.08, 1.08),
    y: clamp(shoulder.y + Math.cos(base.torsoAngleDeg * Math.PI / 180) * torso, -.08, 1.12),
  };
  const legReach = reachFor(project, 'leftFoot');
  const footY = hip.y + legReach * .72;
  const footSpread = Math.min(.09, legReach * .34);

  base.shoulder = shoulder;
  base.hip = hip;
  base.endpoints.leftHand = { ...left.center };
  base.endpoints.rightHand = { ...right.center };
  base.endpoints.leftFoot = { x: hip.x - footSpread, y: footY };
  base.endpoints.rightFoot = { x: hip.x + footSpread, y: footY };
  base.contacts = { leftHand: left.id, rightHand: right.id };

  const separation = Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y);
  return {
    pose: base,
    holds,
    warning: separation > reach * 1.95 ? '两个起步点超过当前臂展，请调整起步点或人物臂展' : undefined,
  };
}

function shoulderBelow(a: Point, b: Point, preferredReach: number): Point {
  if (a.x === b.x && a.y === b.y) return { x: a.x, y: a.y + preferredReach };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const radius = Math.max(preferredReach, distance / 2 + .005);
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const height = Math.sqrt(Math.max(0, radius * radius - distance * distance / 4));
  const perpendicular = { x: -dy / distance, y: dx / distance };
  const first = { x: midpoint.x + perpendicular.x * height, y: midpoint.y + perpendicular.y * height };
  const second = { x: midpoint.x - perpendicular.x * height, y: midpoint.y - perpendicular.y * height };
  return first.y >= second.y ? first : second;
}
