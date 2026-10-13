import type { ContactForce, Hold, Limb, PhysicsResult, Point, Pose, Project } from '../types';

const limbs: Limb[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function centerOfMass(pose: Pose): Point {
  const pts: Array<[Point, number]> = [
    [pose.hip, .42], [pose.shoulder, .28],
    [pose.endpoints.leftHand, .075], [pose.endpoints.rightHand, .075],
    [pose.endpoints.leftFoot, .075], [pose.endpoints.rightFoot, .075],
  ];
  return pts.reduce((a, [p, w]) => ({ x: a.x + p.x * w, y: a.y + p.y * w }), { x: 0, y: 0 });
}

function directionFor(hold: Hold, limb: Limb): number {
  if (limb.endsWith('Foot')) return Math.PI / 2;
  if (hold.profile.usage === 'sidepull-left') return 0;
  if (hold.profile.usage === 'sidepull-right') return Math.PI;
  if (hold.profile.usage === 'undercling') return -Math.PI / 2;
  return Math.PI / 2;
}

/** Small projected-gradient QP: non-negative forces along finite friction-cone rays. */
export function evaluatePose(project: Project, pose: Pose): PhysicsResult {
  const com = centerOfMass(pose);
  if (!project.calibration.calibrated) return { status: 'unknown', converged: false, residual: 1, coreLoadPercent: 0, centerOfMass: com, forces: [], reasons: ['尺度未标定：只检查肢体几何，不进行力量失败判定'] };
  const scale = project.calibration.metersPerImageHeight;
  const contacts = limbs.flatMap(limb => {
    const id = pose.contacts[limb]; const hold = project.holds.find(h => h.id === id && h.status === 'route');
    if (!hold) return [];
    const isFoot = limb.endsWith('Foot');
    const cap = Math.min(hold.profile.capacityN, isFoot ? project.climber.maxFootN : project.climber.maxHandN);
    const center = directionFor(hold, limb);
    const half = Math.atan(clamp(hold.profile.friction, .05, 1.5));
    return [-half, 0, half].map(offset => ({ limb, hold, cap: cap / 2, a: center + offset }));
  });
  if (!contacts.length) return { status: 'fall', converged: true, residual: 1, coreLoadPercent: 180, centerOfMass: com, forces: [], reasons: ['没有有效接触点'] };

  const weight = project.climber.weightKg * 9.81;
  const vars = new Float64Array(contacts.length);
  const cols = contacts.map(c => {
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    const rx = (c.hold.center.x - com.x) * scale;
    const ry = -(c.hold.center.y - com.y) * scale;
    return { fx, fy, torque: rx * fy - ry * fx };
  });
  const target = [0, weight, 0];
  const torqueScale = 1 / Math.max(.35, project.climber.heightM * .3);
  // The columns are normalized force/moment directions, so a fixed projected
  // step converges quickly for this tiny convex problem (normally 6–12 vars).
  const lr = .025;
  for (let k = 0; k < 2600; k++) {
    let sx = 0, sy = 0, st = 0;
    cols.forEach((c, i) => { sx += c.fx * vars[i]; sy += c.fy * vars[i]; st += c.torque * vars[i]; });
    for (let i = 0; i < vars.length; i++) {
      const c = cols[i];
      const grad = 2 * (c.fx * (sx - target[0]) + c.fy * (sy - target[1]) + torqueScale * torqueScale * c.torque * st) + .002 * vars[i];
      vars[i] = clamp(vars[i] - lr * grad, 0, contacts[i].cap);
    }
  }
  let sx = 0, sy = 0, st = 0;
  const grouped = new Map<Limb, ContactForce>();
  cols.forEach((c, i) => {
    sx += c.fx * vars[i]; sy += c.fy * vars[i]; st += c.torque * vars[i];
    const prev = grouped.get(contacts[i].limb) ?? { limb: contacts[i].limb, fx: 0, fy: 0, magnitude: 0 };
    prev.fx += c.fx * vars[i]; prev.fy += c.fy * vars[i]; prev.magnitude = Math.hypot(prev.fx, prev.fy); grouped.set(prev.limb, prev);
  });
  const residual = Math.sqrt(sx * sx + (sy - weight) ** 2 + (torqueScale * st) ** 2) / weight;
  const depthMoment = weight * Math.max(0, pose.wallDepthM) * (.52 + Math.sin(project.calibration.wallAngleDeg * Math.PI / 180) * .45);
  const upperPullMoment = [...grouped.values()].filter(f => f.limb.endsWith('Hand')).reduce((s, f) => s + Math.abs(f.fx) * .18, 0);
  const coreLoadPercent = 100 * (depthMoment + upperPullMoment) / Math.max(20, project.climber.coreCapacityNm);
  const reasons: string[] = [];
  if (pose.wallDepthM > .28) reasons.push('身体离墙较远');
  if (!pose.contacts.leftFoot && !pose.contacts.rightFoot) reasons.push('双脚未承重');
  if (residual > .35) reasons.push('接触方向或承载能力不足，无法稳定平衡');
  if (coreLoadPercent > project.thresholds.warningPercent) reasons.push('估算核心负荷较高');
  const converged = Number.isFinite(residual);
  let status: PhysicsResult['status'] = 'ok';
  if (!converged) status = 'unknown';
  else if (residual > .52 || coreLoadPercent > project.thresholds.fallPercent) status = 'fall';
  else if (residual > .25 || coreLoadPercent > project.thresholds.warningPercent) status = 'warning';
  return { status, converged, residual, coreLoadPercent, centerOfMass: com, forces: [...grouped.values()], reasons: reasons.length ? reasons : ['当前姿势在模型容差内'] };
}

export function reachFor(project: Project, limb: Limb): number {
  const span = project.climber.wingspanM / project.calibration.metersPerImageHeight;
  const height = project.climber.heightM / project.calibration.metersPerImageHeight;
  return limb.endsWith('Hand') ? span * .43 : height * .48;
}

export function validateReach(project: Project, pose: Pose, limb: Limb): { ok: boolean; distance: number; limit: number } {
  const root = limb.endsWith('Hand') ? pose.shoulder : pose.hip;
  const distance = dist(root, pose.endpoints[limb]); const limit = reachFor(project, limb);
  return { ok: distance <= limit * 1.03, distance, limit };
}

export function solveJoint(root: Point, end: Point, totalLength: number, bend: number): Point {
  const dx = end.x - root.x, dy = end.y - root.y, d = Math.max(.0001, Math.hypot(dx, dy));
  const half = totalLength / 2; const along = Math.min(d, totalLength) / 2;
  const h = Math.sqrt(Math.max(0, half * half - along * along));
  const mx = root.x + dx * .5, my = root.y + dy * .5;
  return { x: mx + (-dy / d) * h * bend, y: my + (dx / d) * h * bend };
}
