import { useStudio } from '../store';

export function Timeline({ playing, playhead, duration, workingDirty, onPlay, onSeek }: { playing: boolean; playhead: number; duration: number; workingDirty: boolean; onPlay: () => void; onSeek: (n: number) => void }) {
  const { project, selectedStep, selectStep, captureKeyframe, updateKeyframe, clearKeyframes, duplicateStep, deleteStep } = useStudio();
  return <section className="timeline" aria-label="动作时间线">
    <div className="timeline-playback"><button className="play" onClick={onPlay}>{playing ? '暂停' : '播放演示'}</button><span className="timecode">{playhead.toFixed(1)} / {duration.toFixed(1)} 秒</span><input aria-label="播放位置" type="range" min="0" max={Math.max(.01, duration)} step=".01" value={playhead} onChange={e => onSeek(+e.target.value)} /></div>
    <div className="keyframe-actions"><button className="primary" onClick={() => { onSeek(0); captureKeyframe(); }}>截取关键帧</button><button disabled={!workingDirty} onClick={updateKeyframe}>更新当前帧</button><button onClick={duplicateStep}>复制</button><button disabled={selectedStep === 0 || project.steps.length <= 1} onClick={deleteStep}>删除</button><button disabled={project.steps.length <= 1} onClick={clearKeyframes}>清空后续</button></div>
    <div className="keyframe-caption">视频由 {project.steps.length} 个已截取关键帧组成 · 当前人物改动{workingDirty ? '尚未截取' : '已保存为关键帧'}</div>
    <div className="step-list">{project.steps.map((s, i) => <button key={s.id} className={`step-card ${i === selectedStep ? 'active' : ''}`} onClick={() => { selectStep(i); onSeek(0); }}><span>{String(i + 1).padStart(2, '0')}</span><strong>{s.name}</strong><small>{(s.moveSeconds + s.holdSeconds).toFixed(1)}s · {s.note || (i === 0 ? '起步关键帧' : '已截取')}</small></button>)}</div>
  </section>;
}
