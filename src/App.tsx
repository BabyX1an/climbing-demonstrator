import { useEffect, useMemo, useRef, useState } from 'react';
import { StudioCanvas } from './components/StudioCanvas';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { useStudio } from './store';
import { useMotion } from './hooks/useMotion';
import { evaluatePose } from './lib/physics';
import { frameAt } from './lib/motion';
import { exportProjectZip, importProjectZip, loadLastProject, saveProject } from './lib/storage';
import { exportMp4InBrowser, startServerExport, waitServerExport } from './lib/exportVideo';
import type { MotionFrame, Project } from './types';

export default function App() {
  const { project, editorMode, selectedStep, workingPose, workingDirty, tool, setTool, setEditorMode, beginClimb, setProject, update, history, future, undo, redo, notice, setNotice } = useStudio();
  const track = useMotion(project); const [playing, setPlaying] = useState(false); const [playhead, setPlayhead] = useState(0);
  const [exportProgress, setExportProgress] = useState<number>(); const started = useRef(0); const inputPhoto = useRef<HTMLInputElement>(null); const inputProject = useRef<HTMLInputElement>(null);
  const exportAbort = useRef<AbortController | undefined>(undefined);
  const stillFrame = useMemo<MotionFrame>(() => { const pose = editorMode === 'climb' ? workingPose : project.steps[selectedStep]?.pose ?? project.steps[0].pose; return { time: 0, pose, physics: evaluatePose(project, pose), stepIndex: selectedStep }; }, [project, selectedStep, editorMode, workingPose]);
  const frame = playing || playhead > 0 ? (frameAt(track, playhead) ?? stillFrame) : stillFrame;

  useEffect(() => { loadLastProject().then(p => p && setProject(p)).catch(() => undefined); }, [setProject]);
  useEffect(() => { const id = setTimeout(() => saveProject(project).catch(() => setNotice('本地自动保存失败')), 500); return () => clearTimeout(id); }, [project, setNotice]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(undefined), 4500); return () => clearTimeout(id); }, [notice, setNotice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } if (editorMode === 'climb' && e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setPlaying(x => !x); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [undo, redo, editorMode]);
  useEffect(() => {
    if (!playing) return; started.current = performance.now() - playhead * 1000; let raf = 0;
    const tick = (now: number) => { const t = (now - started.current) / 1000; if (t >= track.duration) { setPlayhead(track.duration); setPlaying(false); return; } setPlayhead(t); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, track.duration]);

  const uploadPhoto = async (file?: File) => {
    if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setNotice('仅支持 JPG、PNG 或 WebP'); return; }
    try { const photo = await normalizePhoto(file); update(p => { p.photo = photo; p.holds = []; p.route.colorSamples = []; p.route.startHoldIds = []; p.route.topHoldId = undefined; p.calibration.calibrated = false; p.calibration.referenceQuad = []; }, '照片已载入。请取样线路颜色或手工添加岩点。'); } catch (e) { setNotice(`照片读取失败：${e instanceof Error ? e.message : e}`); }
  };
  const importProject = async (file?: File) => { if (!file) return; try { setProject(await importProjectZip(file), true); setNotice('项目已导入'); } catch (e) { setNotice(`导入失败：${e instanceof Error ? e.message : e}`); } };
  const exportVideo = async (mode: 'browser' | 'server', resolution: 720 | 1080) => {
    exportAbort.current = new AbortController();
    setExportProgress(0); setNotice(mode === 'browser' ? '正在浏览器中逐帧编码…' : '服务器正在渲染 MP4…');
    try {
      if (mode === 'browser' && 'VideoEncoder' in window) {
        try { await exportMp4InBrowser(project, track, resolution, setExportProgress, exportAbort.current.signal); }
        catch (error) {
          if (exportAbort.current.signal.aborted) throw error;
          setNotice('浏览器编码不可用，已切换到服务器兼容导出'); setExportProgress(0);
          const id = await startServerExport(project, track, resolution); await waitServerExport(id, setExportProgress, exportAbort.current.signal);
        }
      } else {
        if (mode === 'browser') setNotice('当前浏览器不支持 WebCodecs，已切换到服务器兼容导出');
        const id = await startServerExport(project, track, resolution); await waitServerExport(id, setExportProgress, exportAbort.current.signal);
      }
      setNotice('MP4 已生成并开始下载');
    } catch (e) { setNotice(`${e instanceof Error ? e.message : e}`); } finally { setExportProgress(undefined); exportAbort.current = undefined; }
  };
  const startDemonstration = () => { setPlaying(false); setPlayhead(0); beginClimb(); };
  const returnToRoute = () => { setPlaying(false); setPlayhead(0); setEditorMode('route'); };
  const workflowControls = <>
    <div className="workflow-switch" aria-label="编辑阶段">
      <button className={editorMode === 'route' ? 'active' : ''} onClick={returnToRoute}><b>1</b><span>设置岩点与起步</span></button>
      <i aria-hidden="true">→</i>
      <button className={editorMode === 'climb' ? 'active' : ''} onClick={startDemonstration}><b>2</b><span>{editorMode === 'climb' ? '重新放置起步姿势' : '开始演示'}</span></button>
      <small>{editorMode === 'route' ? `已设置 ${project.route.startHoldIds.length} 个起步点` : '人物模式：岩点位置锁定'}</small>
    </div>
    <div className="toolbelt" role="toolbar" aria-label="编辑工具">
      <Tool active={tool === 'select'} icon="↖" label={editorMode === 'route' ? '选择 / 移动岩点' : '操控人物'} onClick={() => setTool('select')} />
      {editorMode === 'route' && <><Tool active={tool === 'set-start'} icon="S" label="设置起步点" onClick={() => setTool('set-start')} /><Tool active={tool === 'add-hold'} icon="＋" label="添加岩点" onClick={() => setTool('add-hold')} />
      <Tool active={tool === 'sample-color'} icon="◉" label="取样颜色" onClick={() => setTool('sample-color')} />
      <Tool active={tool === 'calibrate'} icon="⌗" label="四点标定" onClick={() => setTool('calibrate')} /></>}
      <Tool active={tool === 'pan'} icon="✥" label="移动画布" onClick={() => setTool('pan')} />
      <div className="tool-help">{editorMode === 'climb' ? (tool === 'pan' ? '拖动画布；双指缩放' : '拖动手脚到岩点，拖到空白处松开；拖髋部和肩部调整重心') : tool === 'set-start' ? '直接点击一至两个岩点；再点一次取消' : tool === 'select' ? '此阶段只编辑岩点；人物不会抢占触控' : tool === 'add-hold' ? '在照片上点击漏识别或褪色的岩点' : tool === 'sample-color' ? '点击目标线路岩点，可连续添加多个色样' : tool === 'calibrate' ? '依次点击已知矩形的四个角' : '拖动或双指缩放查看密集岩点'}</div>
    </div>
  </>;

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">β</div><div><strong>Climbing Beta Studio</strong><span>把一张岩壁照片变成清楚的动作演示</span></div></div>
      <div className="project-name"><input aria-label="项目名称" value={project.name} onChange={e => update(p => { p.name = e.target.value; })} /><span className="saved-dot">● 已自动保存</span></div>
      <div className="header-actions"><button disabled={!history.length} onClick={undo} title="撤销">↶</button><button disabled={!future.length} onClick={redo} title="重做">↷</button><button onClick={() => inputPhoto.current?.click()}>上传照片</button><button onClick={() => inputProject.current?.click()}>导入项目</button><button className="primary" onClick={() => exportProjectZip(project)}>保存项目包</button></div>
      <input ref={inputPhoto} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { uploadPhoto(e.target.files?.[0]); e.currentTarget.value = ''; }} />
      <input ref={inputProject} hidden type="file" accept=".zip,.climbbeta" onChange={e => { importProject(e.target.files?.[0]); e.currentTarget.value = ''; }} />
    </header>
    <main className="workspace">
      <section className="stage">
        <div className="mobile-stage-controls">{workflowControls}</div>
        <StudioCanvas frame={frame} playback={playing || playhead > 0} />
        {editorMode === 'climb' ? <Timeline playing={playing} playhead={playhead} duration={track.duration} workingDirty={workingDirty} onPlay={() => { if (playhead >= track.duration) setPlayhead(0); setPlaying(x => !x); }} onSeek={n => { setPlaying(false); setPlayhead(n); }} /> : <section className="route-setup-footer"><div><strong>先完成线路设置</strong><span>移动岩点、指定一至两个起步点和 TOP。进入演示后岩点会被锁定。</span></div><button className="primary" onClick={startDemonstration}>开始演示</button></section>}
      </section>
      <Inspector track={track} onExport={exportVideo} controls={workflowControls} />
    </main>
    {notice && <div className="notice" role="status">{notice}</div>}
    {exportProgress !== undefined && <div className="export-overlay"><div><span>正在生成 MP4</span><strong>{Math.round(exportProgress * 100)}%</strong><div className="progress"><i style={{ width: `${exportProgress * 100}%` }} /></div><small>逐帧渲染时请留在此页面</small><button className="wide" onClick={() => exportAbort.current?.abort()}>取消导出</button></div></div>}
  </div>;
}

function Tool({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) { return <button aria-label={label} className={active ? 'active' : ''} onClick={onClick}><b aria-hidden="true">{icon}</b><span>{label}</span></button>; }

async function normalizePhoto(file: File): Promise<Project['photo']> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); const max = 2400; const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio); canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', .9), name: file.name, width: canvas.width, height: canvas.height };
}
