import { useEffect, useMemo, useRef, useState } from 'react';
import type { Limb, MotionFrame, Point } from '../types';
import { useStudio } from '../store';
import { drawScene } from '../lib/render';

const limbs: Limb[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function StudioCanvas({ frame, playback = false }: { frame: MotionFrame; playback?: boolean }) {
  const { project, editorMode, workingPose, selectedHoldId, selectedLimb, selectedStep, tool, selectHold, selectLimb, addHold, toggleStartHold, assignLimb, moveHandle, update, setNotice } = useStudio();
  const canvasRef = useRef<HTMLCanvasElement>(null); const [image, setImage] = useState<HTMLImageElement>(); const [zoom, setZoom] = useState(.75); const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ kind: 'hold' | 'hip' | 'shoulder' | Limb; point: Point }>();
  const pointers = useRef(new Map<number, Point>()); const pinchStart = useRef<{ distance: number; zoom: number } | undefined>(undefined);
  const panStart = useRef<{ x: number; y: number; pan: Point } | undefined>(undefined);
  const pose = useMemo(() => drag ? overridePose(frame.pose, drag.kind, drag.point) : editorMode === 'climb' && !playback ? workingPose : frame.pose, [frame.pose, workingPose, editorMode, playback, drag]);

  useEffect(() => { const img = new Image(); img.src = project.photo.dataUrl; img.onload = () => setImage(img); img.decode?.().then(() => setImage(img)).catch(() => undefined); }, [project.photo.dataUrl]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = 1200; canvas.height = Math.round(1200 * project.photo.height / project.photo.width); const ctx = canvas.getContext('2d'); if (ctx) drawScene(ctx, project, pose, frame.physics, image, { selectedHoldId, selectedLimb, showFigure: editorMode === 'climb', showCom: editorMode === 'climb', showForces: editorMode === 'climb', note: editorMode === 'climb' ? project.steps[selectedStep]?.note : undefined }); }, [project, pose, frame.physics, image, selectedHoldId, selectedLimb, selectedStep, editorMode]);

  const at = (e: React.PointerEvent): Point => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinchStart.current = { distance: d(a, b), zoom }; return; }
    if (editorMode === 'route' && tool === 'add-hold') { addHold(p); return; }
    if (editorMode === 'route' && tool === 'sample-color') { sampleColor(image, p).then(color => { update(x => { if (!x.route.colorSamples.includes(color)) x.route.colorSamples.push(color); }, `已取样 ${color}`); }); return; }
    if (editorMode === 'route' && tool === 'calibrate') { update(x => { const points = x.calibration.referenceQuad?.length === 4 ? [] : [...(x.calibration.referenceQuad ?? [])]; points.push(p); x.calibration.referenceQuad = points; x.calibration.calibrated = points.length === 4; }, '标定角点已记录'); return; }
    if (editorMode === 'route' && tool === 'set-start') {
      const hold = nearestHold(project, p);
      if (hold && d(hold.center, p) < .055) toggleStartHold(hold.id); else setNotice('请直接点击一个岩点来设置起步位置');
      return;
    }
    if (tool === 'pan') { panStart.current = { x: e.clientX, y: e.clientY, pan }; return; }
    if (editorMode === 'route') {
      const hitHold = nearestHold(project, p); if (hitHold && d(hitHold.center, p) < .055) { selectHold(hitHold.id); setDrag({ kind: 'hold', point: p }); return; }
      selectHold(undefined); return;
    }
    // In climb mode the figure wins hit-testing when a hand or foot overlaps a hold.
    const hit = hitFigure(pose, p); if (hit) { if (limbs.includes(hit as Limb)) selectLimb(hit as Limb); setDrag({ kind: hit, point: p }); return; }
    const hitHold = nearestHold(project, p); if (hitHold && hitHold.status === 'route' && d(hitHold.center, p) < .055) {
      if (selectedLimb) assignLimb(hitHold); else selectHold(hitHold.id); return;
    }
    selectHold(undefined); selectLimb(undefined);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = at(e); pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2 && pinchStart.current) { const [a, b] = [...pointers.current.values()]; setZoom(Math.min(3, Math.max(.5, pinchStart.current.zoom * d(a, b) / Math.max(.001, pinchStart.current.distance)))); return; }
    if (panStart.current) { setPan({ x: panStart.current.pan.x + e.clientX - panStart.current.x, y: panStart.current.pan.y + e.clientY - panStart.current.y }); return; }
    if (drag) setDrag({ ...drag, point: p });
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId); pinchStart.current = undefined; panStart.current = undefined;
    if (drag) {
      if (editorMode === 'climb' && limbs.includes(drag.kind as Limb)) {
        const hold = nearestHold(project, drag.point);
        if (hold && hold.status === 'route' && d(hold.center, drag.point) < .055) assignLimb(hold, drag.kind as Limb);
        else moveHandle(drag.kind, drag.point);
      } else moveHandle(drag.kind, drag.point);
      setDrag(undefined);
    }
  };

  return <div className="canvas-shell">
    <div className="canvas-scroll">
      <canvas aria-label="攀岩动作编辑画布" ref={canvasRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(z => Math.min(3, Math.max(.5, z - e.deltaY * .002))); } }} />
    </div>
    <div className="zoom-controls"><button aria-label="缩小画布" onClick={() => setZoom(z => Math.max(.5, z - .25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大画布" onClick={() => setZoom(z => Math.min(3, z + .25))}>＋</button></div>
    <div className={`canvas-badge ${editorMode === 'route' ? 'route-mode' : 'climb-mode'}`}>{editorMode === 'route' ? '线路设置模式 · 只移动岩点' : '动作编排模式 · 岩点已锁定'}</div>
    {!project.calibration.calibrated && <div className="canvas-badge warning calibration-warning">尺度未标定 · 不触发力量硬失败</div>}
  </div>;
}

function nearestHold(project: ReturnType<typeof useStudio.getState>['project'], p: Point) { if (!project.holds.length) return undefined; return project.holds.reduce((best, h) => d(h.center, p) < d(best.center, p) ? h : best, project.holds[0]); }
function hitFigure(pose: MotionFrame['pose'], p: Point): 'hip' | 'shoulder' | Limb | undefined {
  const candidates: Array<['hip' | 'shoulder' | Limb, Point]> = [['hip', pose.hip], ['shoulder', pose.shoulder], ...limbs.map(l => [l, pose.endpoints[l]] as [Limb, Point])];
  return candidates.sort((a, b) => d(a[1], p) - d(b[1], p)).find(x => d(x[1], p) < .045)?.[0];
}
function overridePose(pose: MotionFrame['pose'], kind: 'hold' | 'hip' | 'shoulder' | Limb, point: Point) { const next = structuredClone(pose); if (kind === 'hip' || kind === 'shoulder') next[kind] = point; else if (kind !== 'hold') next.endpoints[kind] = point; return next; }
async function sampleColor(image: HTMLImageElement | undefined, p: Point) { if (!image) return '#e04f86'; const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0); const px = ctx.getImageData(Math.floor(p.x * c.width), Math.floor(p.y * c.height), 1, 1).data; return `#${[px[0], px[1], px[2]].map(x => x.toString(16).padStart(2, '0')).join('')}`; }
