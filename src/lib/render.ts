import type { Limb, PhysicsResult, Point, Pose, Project } from '../types';
import { reachFor, solveJoint } from './physics';

export interface RenderOptions { selectedHoldId?: string; selectedLimb?: Limb; showHolds?: boolean; showFigure?: boolean; showCom?: boolean; showForces?: boolean; note?: string }
const limbColors: Record<Limb, string> = { leftHand: '#ffcf66', rightHand: '#ff8e64', leftFoot: '#7ad8ff', rightFoot: '#79e3ae' };
const pxy = (p: Point, w: number, h: number) => ({ x: p.x * w, y: p.y * h });

export function drawScene(ctx: CanvasRenderingContext2D, project: Project, pose: Pose, physics: PhysicsResult, image: CanvasImageSource | undefined, opts: RenderOptions = {}) {
  const w = ctx.canvas.width, h = ctx.canvas.height; ctx.clearRect(0, 0, w, h);
  if (image) ctx.drawImage(image, 0, 0, w, h); else { ctx.fillStyle = '#66706f'; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = 'rgba(5,12,14,.15)'; ctx.fillRect(0, 0, w, h);
  if (opts.showHolds !== false) drawHolds(ctx, project, opts.selectedHoldId);
  const quad = project.calibration.referenceQuad;
  if (quad?.length) { ctx.strokeStyle = '#63e6be'; ctx.fillStyle = '#63e6be'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.beginPath(); quad.forEach((p, i) => { const q = pxy(p, w, h); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); ctx.fillRect(q.x - 5, q.y - 5, 10, 10); }); if (quad.length === 4) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
  if (opts.showFigure !== false) drawFigure(ctx, project, pose, opts.selectedLimb);
  if (opts.showFigure !== false && opts.showCom !== false) {
    const c = pxy(physics.centerOfMass, w, h); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#10272d'; ctx.lineWidth = Math.max(2, w / 500);
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(6, w / 120), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y); ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9); ctx.stroke();
  }
  if (opts.showFigure !== false && opts.showForces) { drawForces(ctx, project, pose, physics); drawGravity(ctx, physics); }
  const tone = physics.status === 'fall' ? '#ff705d' : physics.status === 'warning' ? '#ffc857' : physics.status === 'unknown' ? '#bfc6c7' : '#63e6be';
  if (opts.showFigure !== false) { ctx.fillStyle = 'rgba(10,23,27,.82)'; roundRect(ctx, 20, 20, Math.min(330, w - 40), 60, 15); ctx.fill();
  ctx.fillStyle = tone; ctx.font = `700 ${Math.max(16, w / 55)}px system-ui`; ctx.fillText(`估算核心负荷 ${Math.round(physics.coreLoadPercent)}%`, 38, 57); }
  if (opts.note) { ctx.fillStyle = 'rgba(10,23,27,.82)'; roundRect(ctx, 20, h - 75, Math.min(w - 40, 620), 54, 12); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.max(14, w / 65)}px system-ui`; ctx.fillText(opts.note.slice(0, 50), 38, h - 41); }
}

function drawHolds(ctx: CanvasRenderingContext2D, project: Project, selected?: string) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  project.holds.forEach((hold, i) => {
    const c = pxy(hold.center, w, h), rx = Math.max(10, hold.radius.x * w), ry = Math.max(8, hold.radius.y * h);
    ctx.save(); ctx.globalAlpha = hold.status === 'excluded' ? .28 : hold.status === 'candidate' ? .65 : 1;
    ctx.fillStyle = hold.status === 'route' ? 'rgba(238,70,139,.26)' : hold.status === 'candidate' ? 'rgba(255,200,87,.27)' : 'rgba(90,100,102,.2)';
    ctx.strokeStyle = hold.id === selected ? '#fff' : hold.status === 'route' ? '#ff4f91' : hold.status === 'candidate' ? '#ffc857' : '#b0b8b9';
    ctx.lineWidth = hold.id === selected ? 5 : 2.5; ctx.setLineDash(hold.confirmed ? [] : [8, 5]);
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const startIndex = project.route.startHoldIds.indexOf(hold.id); const isTop = project.route.topHoldId === hold.id;
    const label = startIndex >= 0 ? `S${startIndex + 1}` : isTop ? 'TOP' : String(i + 1);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(12, w / (isTop ? 95 : 80))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, c.x, c.y); ctx.restore();
  });
}

function drawFigure(ctx: CanvasRenderingContext2D, project: Project, pose: Pose, selected?: Limb) {
  const w = ctx.canvas.width, h = ctx.canvas.height; const hip = pxy(pose.hip, w, h), shoulder = pxy(pose.shoulder, w, h);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#f4f6f4'; ctx.lineWidth = Math.max(8, w / 86);
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; const torsoBend = Math.sin(pose.torsoAngleDeg * Math.PI / 180) * w * .018;
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo((hip.x + shoulder.x) / 2 + torsoBend, (hip.y + shoulder.y) / 2, shoulder.x, shoulder.y); ctx.stroke();
  const headR = Math.max(10, w / 52); ctx.fillStyle = '#eff4ef'; ctx.beginPath(); ctx.arc(shoulder.x, shoulder.y - headR * 1.35, headR, 0, Math.PI * 2); ctx.fill();
  (Object.keys(pose.endpoints) as Limb[]).forEach(limb => {
    const root = limb.endsWith('Hand') ? pose.shoulder : pose.hip; const end = pose.endpoints[limb];
    const joint = solveJoint(root, end, reachFor(project, limb), pose.bend[limb]); const a = pxy(root, w, h), j = pxy(joint, w, h), e = pxy(end, w, h);
    ctx.strokeStyle = selected === limb ? limbColors[limb] : '#f4f6f4'; ctx.lineWidth = selected === limb ? Math.max(11, w / 65) : Math.max(7, w / 90);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(j.x, j.y, e.x, e.y); ctx.stroke();
    ctx.fillStyle = selected === limb ? limbColors[limb] : '#dce8e4'; ctx.beginPath(); ctx.arc(j.x, j.y, selected === limb ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = limbColors[limb]; ctx.beginPath(); ctx.arc(e.x, e.y, selected === limb ? 12 : 8, 0, Math.PI * 2); ctx.fill();
    if (pose.contacts[limb]) { ctx.strokeStyle = limbColors[limb]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, selected === limb ? 17 : 13, 0, Math.PI * 2); ctx.stroke(); }
  });
  ctx.shadowBlur = 0; ctx.fillStyle = '#f4f6f4'; ctx.beginPath(); ctx.arc(hip.x, hip.y, Math.max(8, w / 100), 0, Math.PI * 2); ctx.fill();
}

function drawGravity(ctx: CanvasRenderingContext2D, physics: PhysicsResult) {
  const w = ctx.canvas.width, h = ctx.canvas.height; const c = pxy(physics.centerOfMass, w, h); const length = Math.max(34, h * .07);
  ctx.save(); ctx.strokeStyle = 'rgba(255,207,102,.9)'; ctx.fillStyle = 'rgba(255,207,102,.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(c.x + 18, c.y + 5); ctx.lineTo(c.x + 18, c.y + length); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c.x + 18, c.y + length); ctx.lineTo(c.x + 11, c.y + length - 10); ctx.lineTo(c.x + 25, c.y + length - 10); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawForces(ctx: CanvasRenderingContext2D, project: Project, pose: Pose, physics: PhysicsResult) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  physics.forces.forEach(f => { const id = pose.contacts[f.limb]; const hold = project.holds.find(x => x.id === id); if (!hold) return; const p = pxy(hold.center, w, h); const scale = .12;
    ctx.strokeStyle = '#70f0d0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + f.fx * scale, p.y - f.fy * scale); ctx.stroke();
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
