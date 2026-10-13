import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStudio, limbLabel } from '../store';
import type { Hold, HoldKind, Limb, MotionTrack, UsageDirection } from '../types';
import { validateReach } from '../lib/physics';

const kinds: Array<[HoldKind, string]> = [['jug', '大把手'], ['edge', '边缘点'], ['sloper', '圆坡点'], ['pinch', '捏点'], ['pocket', '洞点'], ['unknown', '未知']];
const usages: Array<[UsageDirection, string]> = [['pull', '正拉'], ['sidepull-left', '向左侧拉'], ['sidepull-right', '向右侧拉'], ['undercling', '反拉'], ['downpress', '向下踩压']];
const limbOptions: Array<[Limb, string]> = [['leftHand', '左手'], ['rightHand', '右手'], ['leftFoot', '左脚'], ['rightFoot', '右脚']];

export function Inspector({ track, onExport, controls }: { track: MotionTrack; onExport: (mode: 'browser' | 'server', resolution: 720 | 1080) => void; controls?: ReactNode }) {
  const [tab, setTab] = useState<'route' | 'pose' | 'body' | 'export'>('route');
  const [analyzing, setAnalyzing] = useState(false); const [exportResolution, setExportResolution] = useState<720 | 1080>(720);
  const { project, editorMode, tool, selectedHoldId, selectedLimb, selectedStep, workingPose, workingDirty, setTool, toggleStartHold, selectLimb, update, updateWorkingPose, updateKeyframe, selectHold, setNotice } = useStudio();
  const hold = project.holds.find(h => h.id === selectedHoldId); const step = project.steps[selectedStep];
  const reach = selectedLimb && step ? validateReach(project, workingPose, selectedLimb) : undefined;
  const total = useMemo(() => project.steps.reduce((s, x, i) => s + (i ? x.moveSeconds + x.holdSeconds : 0), 0), [project.steps]);
  const topComplete = useMemo(() => { const top = project.route.topHoldId; const contacts = project.steps.at(-1)?.pose.contacts; if (!top || !contacts) return false; return project.route.topRule === 'both-hands' ? contacts.leftHand === top && contacts.rightHand === top : contacts.leftHand === top || contacts.rightHand === top; }, [project]);
  const tabs: Array<[typeof tab, string]> = editorMode === 'route' ? [['route', '线路'], ['body', '参数']] : [['pose', '动作'], ['body', '参数'], ['export', '导出']];
  useEffect(() => { setTab(editorMode === 'route' ? 'route' : 'pose'); }, [editorMode]);

  const analyze = async () => {
    setAnalyzing(true); setNotice('正在请求 AI 识别…');
    try {
      const blob = await (await fetch(project.photo.dataUrl)).blob(); const form = new FormData(); form.append('image', blob, project.photo.name); form.append('colorSamples', JSON.stringify(project.route.colorSamples));
      const res = await fetch('/api/vision/analyze', { method: 'POST', body: form }); const body = await res.json(); if (!res.ok) throw new Error(body.message || '识别失败');
      update(p => { const ids = new Set(p.holds.filter(h => h.confirmed).map(h => h.id)); p.holds = [...p.holds.filter(h => ids.has(h.id)), ...(body.holds as Hold[]).map(h => ({ ...h, status: 'candidate' as const, confirmed: false }))]; }, `AI 返回 ${body.holds.length} 个候选点，请逐一确认`);
    } catch (e) { setNotice(`AI 识别未完成：${e instanceof Error ? e.message : String(e)}。可继续手工选点。`); } finally { setAnalyzing(false); }
  };

  return <aside className="inspector">
    {controls && <div className="inspector-controls">{controls}</div>}
    <nav className="inspector-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="inspector-body">
      {tab === 'route' && <>
        <Section title="线路识别" sub="DeepSeek 只提供候选，人工修正永远优先">
          <label>线路名称<input value={project.route.name} onChange={e => update(p => { p.route.name = e.target.value; })} /></label>
          <div className="color-row">{project.route.colorSamples.map((c, i) => <button title="删除色样" key={`${c}-${i}`} className="swatch" style={{ background: c }} onClick={() => update(p => { p.route.colorSamples.splice(i, 1); })} />)}<span>{project.route.colorSamples.length ? '点击色块删除' : '请从照片取样'}</span></div>
          <label>颜色容差 <strong>{project.route.tolerance}</strong><input type="range" min="5" max="80" value={project.route.tolerance} onChange={e => update(p => { p.route.tolerance = +e.target.value; })} /></label>
          <button className="primary wide" disabled={analyzing} onClick={analyze}>{analyzing ? 'DeepSeek 分析照片中…' : 'DeepSeek 分析候选岩点'}</button>
        </Section>
        <Section title="设置起步点" sub="点击下面的按钮，再直接点画布上的一至两个岩点；一个点表示双手并手起步">
          <button className={`${tool === 'set-start' ? 'primary ' : ''}wide`} onClick={() => setTool(tool === 'set-start' ? 'select' : 'set-start')}>{tool === 'set-start' ? '正在选择起步点 · 点击岩点' : '开始选择起步点'}</button>
          <div className="start-hold-list">{project.route.startHoldIds.length ? project.route.startHoldIds.map((id, index) => <button key={id} onClick={() => toggleStartHold(id)}>S{index + 1} · 岩点 {project.holds.findIndex(h => h.id === id) + 1}<span>×</span></button>) : <p className="fine">尚未设置。选择工具后，点击照片中的起步岩点。</p>}</div>
          <button className="wide" disabled={!project.route.startHoldIds.length} onClick={() => update(p => { p.route.startHoldIds = []; }, '已清空起步点')}>清空起步点</button>
        </Section>
        <Section title={hold ? `岩点 ${project.holds.indexOf(hold) + 1}` : '岩点属性'} sub={hold ? `${hold.source === 'ai' ? 'AI 候选' : '手工添加'} · ${hold.confirmed ? '已确认' : '待确认'}` : '在画布中选择一个岩点'}>
          {hold && <HoldEditor hold={hold} />}
        </Section>
        <Section title="线路规则">
          <div className={`status-line ${project.route.startHoldIds.length ? 'ok' : 'warn'}`}><span>{project.route.startHoldIds.length || '!'}</span>{project.route.startHoldIds.length ? `已设置 ${project.route.startHoldIds.length} 个起步点，开始演示时双手会自动放置` : '请选择岩点并设为起步；一个点会自动并手'}</div>
          <label>TOP 完成条件<select value={project.route.topRule} onChange={e => update(p => { p.route.topRule = e.target.value as 'both-hands' | 'one-hand'; })}><option value="both-hands">双手稳定 TOP</option><option value="one-hand">单手触达 TOP</option></select></label>
          <label>稳定时间（秒）<input type="number" min=".2" max="5" step=".1" value={project.route.topHoldSeconds} onChange={e => update(p => { p.route.topHoldSeconds = +e.target.value; })} /></label>
        </Section>
      </>}
      {tab === 'pose' && step && <>
        <Section title={`关键帧 ${selectedStep + 1} · 工作姿势`} sub="当前拖动只调整工作姿势；点击‘截取关键帧’后才加入演示视频">
          <label>步骤名称<input value={step.name} onChange={e => update(p => { p.steps[selectedStep].name = e.target.value; })} /></label>
          <label>动作说明<textarea value={step.note} placeholder="例如：髋部向右靠墙" onChange={e => update(p => { p.steps[selectedStep].note = e.target.value; })} /></label>
          <div className="two"><label>移动秒数<input type="number" min=".1" max="15" step=".1" value={step.moveSeconds} onChange={e => update(p => { p.steps[selectedStep].moveSeconds = +e.target.value; })} /></label><label>停留秒数<input type="number" min="0" max="15" step=".1" value={step.holdSeconds} onChange={e => update(p => { p.steps[selectedStep].holdSeconds = +e.target.value; })} /></label></div>
          <label>离墙抬起轨迹 <strong>{Math.round(step.pathLift * 1000)} mm</strong><input type="range" min="0" max=".1" step=".005" value={step.pathLift} onChange={e => update(p => { p.steps[selectedStep].pathLift = +e.target.value; })} /></label>
          {workingDirty && <div className="status-line warn"><span>!</span>工作姿势尚未截取，导出视频不会包含刚才的改动</div>}
          {workingDirty && <button className="wide" onClick={updateKeyframe}>更新当前关键帧</button>}
        </Section>
        <Section title="选择肢体" sub="选中后点击岩点即可连接；拖到空白处会松开">
          <div className="limb-grid">{limbOptions.map(([id, label]) => <button key={id} className={selectedLimb === id ? 'active' : ''} onClick={() => selectLimb(selectedLimb === id ? undefined : id)}><i className={`limb-dot ${id}`} />{label}</button>)}</div>
          {selectedLimb && <><div className={`reach ${reach?.ok ? 'ok' : 'bad'}`}>{limbLabel(selectedLimb)}：{reach?.ok ? '肢体长度范围内' : '目标不可达，请移动身体或换点'}</div><button className="wide" onClick={() => updateWorkingPose(pose => { delete pose.contacts[selectedLimb]; }, `${limbLabel(selectedLimb)}已松开`)}>松开当前接触</button><button className="wide" onClick={() => updateWorkingPose(pose => { pose.bend[selectedLimb] *= -1; })}>切换肘／膝弯曲方向</button></>}
        </Section>
        <Section title="身体姿态">
          <label>离墙距离 <strong>{Math.round(workingPose.wallDepthM * 100)} cm</strong><input type="range" min=".04" max=".55" step=".01" value={workingPose.wallDepthM} onChange={e => updateWorkingPose(pose => { pose.wallDepthM = +e.target.value; })} /></label>
          <label>躯干转角 <strong>{workingPose.torsoAngleDeg}°</strong><input type="range" min="-60" max="60" step="1" value={workingPose.torsoAngleDeg} onChange={e => updateWorkingPose(pose => { pose.torsoAngleDeg = +e.target.value; })} /></label>
          <SideView angle={project.calibration.wallAngleDeg} depth={workingPose.wallDepthM} />
        </Section>
      </>}
      {tab === 'body' && <>
        <Section title="岩壁标定" sub="垂直为 0°，外倾为正，缓坡为负">
          <label className="check"><input type="checkbox" checked={project.calibration.calibrated} onChange={e => update(p => { p.calibration.calibrated = e.target.checked; })} />启用尺度标定与力量判断</label>
          <label>照片所示墙高（米）<input type="number" min="1" max="20" step=".1" value={project.calibration.metersPerImageHeight} onChange={e => update(p => { p.calibration.metersPerImageHeight = +e.target.value; })} /></label>
          <label>标定矩形宽度（米）<input type="number" min=".5" max="30" step=".1" value={project.calibration.wallWidthM ?? 3} onChange={e => update(p => { p.calibration.wallWidthM = +e.target.value; })} /></label>
          <label>墙面倾角 <strong>{project.calibration.wallAngleDeg}°</strong><input type="range" min="-25" max="65" value={project.calibration.wallAngleDeg} onChange={e => update(p => { p.calibration.wallAngleDeg = +e.target.value; })} /></label>
          <div className="status-line ok"><span>{project.calibration.referenceQuad?.length ?? 0}</span> / 4 个透视标定角点</div><button className="wide" onClick={() => update(p => { p.calibration.referenceQuad = []; p.calibration.calibrated = false; })}>清除四点标定</button>
        </Section>
        <Section title="攀爬者参数" sub="这些参数只用于模型估算，不代表真人实测能力">
          <div className="two"><label>身高（米）<input type="number" min="1" max="2.4" step=".01" value={project.climber.heightM} onChange={e => update(p => { p.climber.heightM = +e.target.value; })} /></label><label>臂展（米）<input type="number" min="1" max="2.6" step=".01" value={project.climber.wingspanM} onChange={e => update(p => { p.climber.wingspanM = +e.target.value; })} /></label></div>
          <label>体重（kg）<input type="number" min="30" max="180" value={project.climber.weightKg} onChange={e => update(p => { p.climber.weightKg = +e.target.value; })} /></label>
          <label>核心力矩容量（N·m）<input type="number" min="20" max="500" value={project.climber.coreCapacityNm} onChange={e => update(p => { p.climber.coreCapacityNm = +e.target.value; p.climber.strengthPreset = 'custom'; })} /></label>
          <label>警告阈值 <strong>{project.thresholds.warningPercent}%</strong><input type="range" min="60" max="140" value={project.thresholds.warningPercent} onChange={e => update(p => { p.thresholds.warningPercent = +e.target.value; })} /></label>
          <label>跌落阈值 <strong>{project.thresholds.fallPercent}%</strong><input type="range" min="110" max="240" value={project.thresholds.fallPercent} onChange={e => update(p => { p.thresholds.fallPercent = +e.target.value; })} /></label>
        </Section>
      </>}
      {tab === 'export' && <>
        <Section title="动作检查" sub={`${project.steps.length} 个已截取关键帧 · ${total.toFixed(1)} 秒 · 60 Hz 检查`}>
          <StatusLine ok={!workingDirty} label={workingDirty ? '工作姿势有未截取改动，回到时间线点击“截取关键帧”或更新当前帧' : '所有演示动作均来自已截取的关键帧'} />
          <StatusLine ok={!track.warnings.length} label={track.warnings.length ? track.warnings[0] : '所有过渡均已完成计算'} />
          <StatusLine ok={total <= 120} label={total <= 120 ? '符合 120 秒单段限制' : '超过 120 秒，请缩短或分段'} />
          <StatusLine ok={topComplete} label={topComplete ? '最后姿势已满足 TOP 条件' : project.route.topHoldId ? '已指定 TOP，最后姿势尚未完成' : '尚未指定 TOP，仍可导出'} />
        </Section>
        <Section title="MP4 导出" sub="逐帧渲染保存的动作，不记录鼠标和等待时间">
          <label>分辨率<select value={exportResolution} onChange={e => setExportResolution(+e.target.value as 720 | 1080)}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
          <button className="primary wide" disabled={!track.frames.length || total > 120 || workingDirty} onClick={() => onExport('browser', exportResolution)}>导出 {project.steps.length} 帧演示 MP4</button>
          <button className="wide" disabled={!track.frames.length || total > 120 || workingDirty} onClick={() => onExport('server', exportResolution)}>服务器兼容导出</button>
          <p className="fine">视频只使用已截取的关键帧，并在相邻帧之间生成过渡。浏览器不支持 WebCodecs AVC 时会使用服务器兼容路径。</p>
        </Section>
      </>}
    </div>
  </aside>;
}

function HoldEditor({ hold }: { hold: Hold }) {
  const { project, update, selectHold, toggleStartHold } = useStudio();
  const set = (fn: (h: Hold) => void) => update(p => { const h = p.holds.find(x => x.id === hold.id); if (h) { fn(h); h.confirmed = true; } });
  return <div className="hold-editor">
    <div className="segmented">{(['route', 'candidate', 'excluded'] as const).map(x => <button className={hold.status === x ? 'active' : ''} key={x} onClick={() => set(h => { h.status = x; })}>{x === 'route' ? '属于线路' : x === 'candidate' ? '待确认' : '排除'}</button>)}</div>
    <label>外形／抓握类型<select value={hold.kind} onChange={e => set(h => { h.kind = e.target.value as HoldKind; })}>{kinds.map(([x, l]) => <option value={x} key={x}>{l}</option>)}</select></label>
    <label>主要使用方向<select value={hold.profile.usage} onChange={e => set(h => { h.profile.usage = e.target.value as UsageDirection; })}>{usages.map(([x, l]) => <option value={x} key={x}>{l}</option>)}</select></label>
    <label>摩擦系数 <strong>{hold.profile.friction.toFixed(2)}</strong><input type="range" min=".1" max="1.4" step=".05" value={hold.profile.friction} onChange={e => set(h => { h.profile.friction = +e.target.value; })} /></label>
    <div className="two"><label>轮廓宽度<input type="range" min=".01" max=".15" step=".005" value={hold.radius.x} onChange={e => set(h => { h.radius.x = +e.target.value; })} /></label><label>轮廓高度<input type="range" min=".01" max=".15" step=".005" value={hold.radius.y} onChange={e => set(h => { h.radius.y = +e.target.value; })} /></label></div>
    <div className="two"><label>凸出（cm）<input type="number" min="0" max="40" value={hold.depthCm} onChange={e => set(h => { h.depthCm = +e.target.value; })} /></label><label>承载（N）<input type="number" min="50" max="3000" step="50" value={hold.profile.capacityN} onChange={e => set(h => { h.profile.capacityN = +e.target.value; })} /></label></div>
    <div className="button-row"><button onClick={() => toggleStartHold(hold.id)}>{project.route.startHoldIds.includes(hold.id) ? '取消起步' : '设为起步'}</button><button onClick={() => update(p => { p.route.topHoldId = hold.id; })}>{project.route.topHoldId === hold.id ? '当前 TOP' : '设为 TOP'}</button></div>
    <div className="button-row"><button onClick={() => update(p => { const h = p.holds.find(x => x.id === hold.id); if (h) p.holds.push({ ...structuredClone(h), id: crypto.randomUUID(), center: { x: h.center.x + .025, y: h.center.y + .015 }, source: 'manual' }); }, '已拆分出一个可移动副本')}>拆分</button><button disabled={project.holds.length < 2} onClick={() => update(p => { const a = p.holds.find(x => x.id === hold.id); const b = p.holds.filter(x => x.id !== hold.id).sort((x,y) => Math.hypot(x.center.x-a!.center.x,x.center.y-a!.center.y)-Math.hypot(y.center.x-a!.center.x,y.center.y-a!.center.y))[0]; if (!a || !b) return; a.center = { x:(a.center.x+b.center.x)/2, y:(a.center.y+b.center.y)/2 }; a.radius = { x:Math.max(a.radius.x,b.radius.x), y:Math.max(a.radius.y,b.radius.y) }; p.steps.forEach(s => Object.entries(s.pose.contacts).forEach(([l,id]) => { if(id===b.id){s.pose.contacts[l as Limb]=a.id;s.pose.endpoints[l as Limb]={...a.center}} })); p.holds=p.holds.filter(x=>x.id!==b.id); }, '已与最近岩点合并')}>合并最近点</button></div>
    <button className="danger wide" onClick={() => { update(p => { p.holds = p.holds.filter(x => x.id !== hold.id); p.steps.forEach(s => Object.entries(s.pose.contacts).forEach(([l, id]) => { if (id === hold.id) delete s.pose.contacts[l as Limb]; })); }); selectHold(undefined); }}>删除岩点</button>
  </div>;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) { return <section className="panel-section"><h3>{title}</h3>{sub && <p className="section-sub">{sub}</p>}<div className="fields">{children}</div></section>; }
function StatusLine({ ok, label }: { ok: boolean; label: string }) { return <div className={`status-line ${ok ? 'ok' : 'warn'}`}><span>{ok ? '✓' : '!'}</span>{label}</div>; }
function SideView({ angle, depth }: { angle: number; depth: number }) { return <div className="side-view"><div className="wall-line" style={{ transform: `rotate(${angle * .55}deg)` }} /><div className="mini-person" style={{ left: `${48 - Math.min(22, depth * 45)}%` }}><i /><b /></div><span>侧视 · 离墙 {Math.round(depth * 100)} cm</span></div>; }
