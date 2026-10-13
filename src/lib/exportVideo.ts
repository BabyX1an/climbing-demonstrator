import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import type { MotionTrack, Project } from '../types';
import { drawScene } from './render';
import { downloadBlob, safe } from './storage';

async function loadImage(src: string) {
  const image = new Image(); image.src = src; await image.decode(); return image;
}

export async function exportMp4InBrowser(project: Project, track: MotionTrack, resolution: 720 | 1080, onProgress: (n: number) => void, signal?: AbortSignal) {
  if (!('VideoEncoder' in window)) throw new Error('当前浏览器没有 WebCodecs 视频编码能力');
  if (!track.frames.length) throw new Error('没有可导出的动作轨迹');
  if (track.duration > 120) throw new Error('第一版单段视频最长 120 秒，请缩短步骤或分段导出');
  const canvas = document.createElement('canvas'); canvas.height = resolution;
  canvas.width = Math.round(resolution * project.photo.width / project.photo.height / 2) * 2;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建视频画布');
  const image = await loadImage(project.photo.dataUrl); const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high'), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: 30 }); await output.start();
  const total = Math.max(1, Math.ceil(track.duration * 30));
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('导出已取消');
    const t = Math.min(track.duration, i / 30); const frame = track.frames[Math.min(track.frames.length - 1, Math.round(t * track.sampleRate))];
    const note = project.steps[frame.stepIndex]?.note || project.steps[frame.stepIndex]?.name;
    drawScene(ctx, project, frame.pose, frame.physics, image, { showForces: false, showCom: true, note });
    await source.add(i / 30, 1 / 30, { keyFrame: i % 60 === 0 }); if (i % 8 === 0) onProgress(i / total);
  }
  await output.finalize(); if (!target.buffer) throw new Error('编码器没有返回视频数据');
  downloadBlob(new Blob([target.buffer], { type: 'video/mp4' }), `${safe(project.name)}.mp4`); onProgress(1);
}

export async function startServerExport(project: Project, track: MotionTrack, resolution: 720 | 1080) {
  const res = await fetch('/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, track, resolution }) });
  const body = await res.json(); if (!res.ok) throw new Error(body.message || '无法创建服务器导出任务'); return body.id as string;
}

export async function waitServerExport(id: string, onProgress: (n: number) => void, signal?: AbortSignal) {
  for (;;) {
    if (signal?.aborted) { await fetch(`/api/exports/${id}`, { method: 'DELETE' }); throw new Error('导出已取消'); }
    const res = await fetch(`/api/exports/${id}`); const body = await res.json(); if (!res.ok) throw new Error(body.message || '导出任务不存在');
    onProgress(body.progress ?? 0); if (body.status === 'done') { window.location.href = `/api/exports/${id}/file`; return; }
    if (body.status === 'failed' || body.status === 'cancelled') throw new Error(body.error || '服务器导出失败');
    await new Promise(r => setTimeout(r, 700));
  }
}
