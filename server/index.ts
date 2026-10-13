import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Limb, MotionTrack, Project } from '../src/types.js';
import { reachFor, solveJoint } from '../src/lib/physics.js';
import { analyzeHoldsWithDeepSeek } from './deepseek.js';

const execFileAsync = promisify(execFile); const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const exportRoot = path.join(root, '.exports'); await mkdir(exportRoot, { recursive: true });
const app = Fastify({ logger: true, bodyLimit: 90 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

app.get('/api/health', async () => ({ ok: true, visionProvider: 'deepseek', visionModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash', visionConfigured: Boolean(process.env.DEEPSEEK_API_KEY), ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg' }));

app.post('/api/vision/analyze', async (request, reply) => {
  if (!process.env.DEEPSEEK_API_KEY) return reply.code(503).send({ message: '服务器未配置 DEEPSEEK_API_KEY' });
  const file = await request.file(); if (!file) return reply.code(400).send({ message: '缺少图像文件' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return reply.code(415).send({ message: '图像类型不受支持' });
  const bytes = await file.toBuffer(); const rawSamples = file.fields.colorSamples && 'value' in file.fields.colorSamples ? String(file.fields.colorSamples.value) : '[]';
  const colors = z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(12).catch([]).parse(safeJson(rawSamples));
  try {
    return await analyzeHoldsWithDeepSeek({
      bytes,
      mimetype: file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
      colorSamples: colors,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
    });
  } catch (error) { request.log.error(error); return reply.code(502).send({ message: error instanceof Error ? `AI 响应无效：${error.message}` : 'AI 服务请求失败' }); }
});

type Job = { id: string; status: 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled'; progress: number; error?: string; file?: string; created: number; cancelled: boolean };
const jobs = new Map<string, Job>();
const exportInputSchema = z.object({ project: z.custom<Project>(), track: z.custom<MotionTrack>(), resolution: z.union([z.literal(720), z.literal(1080)]) });

app.post('/api/exports', async (request, reply) => {
  const input = exportInputSchema.safeParse(request.body); if (!input.success) return reply.code(400).send({ message: '导出参数格式错误' });
  if (!input.data.track.frames?.length) return reply.code(400).send({ message: '动作轨迹为空' });
  if (input.data.track.duration > 120) return reply.code(400).send({ message: '单段视频最长 120 秒' });
  const id = randomUUID(); const job: Job = { id, status: 'queued', progress: 0, created: Date.now(), cancelled: false }; jobs.set(id, job);
  setImmediate(() => { void renderJob(job, input.data).catch(error => { job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); }); });
  return reply.code(202).send({ id });
});
app.get<{ Params: { id: string } }>('/api/exports/:id', async (request, reply) => { const job = jobs.get(request.params.id); return job ? publicJob(job) : reply.code(404).send({ message: '导出任务不存在或已过期' }); });
app.get<{ Params: { id: string } }>('/api/exports/:id/file', async (request, reply) => { const job = jobs.get(request.params.id); if (!job?.file || job.status !== 'done') return reply.code(409).send({ message: '视频尚未生成' }); return reply.type('video/mp4').header('content-disposition', 'attachment; filename="climbing-beta.mp4"').send(await import('node:fs').then(fs => fs.createReadStream(job.file!))); });
app.delete<{ Params: { id: string } }>('/api/exports/:id', async (request, reply) => { const job = jobs.get(request.params.id); if (!job) return reply.code(404).send({ message: '任务不存在' }); job.cancelled = true; job.status = 'cancelled'; return { ok: true }; });

async function renderJob(job: Job, input: z.infer<typeof exportInputSchema>) {
  job.status = 'rendering'; const dir = path.join(exportRoot, job.id); await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: await browserExecutable() });
  try {
    const { project, track, resolution } = input; const width = Math.round(resolution * project.photo.width / project.photo.height / 2) * 2; const page = await browser.newPage({ viewport: { width, height: resolution }, deviceScaleFactor: 1 });
    await page.setContent(`<canvas id="c" width="${width}" height="${resolution}"></canvas><img id="bg" style="display:none"/>`);
    await page.evaluate(async src => { const img = document.querySelector('#bg') as HTMLImageElement; img.src = src; await img.decode(); }, project.photo.dataUrl);
    const count = Math.max(1, Math.ceil(track.duration * 30));
    for (let i = 0; i < count; i++) {
      if (job.cancelled) throw new Error('导出已取消'); const frame = track.frames[Math.min(track.frames.length - 1, Math.round(i / 30 * track.sampleRate))];
      await page.evaluate(serverFrameScript({ project, frame, note: project.steps[frame.stepIndex]?.note || project.steps[frame.stepIndex]?.name || '' }));
      await page.locator('#c').screenshot({ path: path.join(dir, `frame-${String(i).padStart(5, '0')}.png`) }); job.progress = .05 + .76 * i / count;
    }
    const out = path.join(dir, 'climbing-beta.mp4');
    await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-framerate', '30', '-i', path.join(dir, 'frame-%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { maxBuffer: 4 * 1024 * 1024 });
    job.file = out; job.progress = 1; job.status = 'done';
  } finally { await browser.close(); }
}

function serverFrameScript(arg: { project: Project; frame: MotionTrack['frames'][number]; note: string }) {
  const pose = arg.frame.pose;
  const joints = (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as Limb[]).map(limb => {
    const root = limb.endsWith('Hand') ? pose.shoulder : pose.hip;
    return { limb, point: solveJoint(root, pose.endpoints[limb], reachFor(arg.project, limb), pose.bend[limb]) };
  });
  const payload = JSON.stringify({ ...arg, joints }).replaceAll('<', '\\u003c');
  return `(() => { const arg=${payload}; const project=arg.project,frame=arg.frame,note=arg.note;
    const c=document.querySelector('#c'),ctx=c.getContext('2d'),bg=document.querySelector('#bg'),w=c.width,h=c.height;
    ctx.drawImage(bg,0,0,w,h);ctx.fillStyle='rgba(5,12,14,.15)';ctx.fillRect(0,0,w,h);
    const holds=project.holds.filter(x=>x.status==='route');for(let i=0;i<holds.length;i++){const hold=holds[i];ctx.strokeStyle='#ff4f91';ctx.fillStyle='rgba(238,70,139,.25)';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(hold.center.x*w,hold.center.y*h,Math.max(10,hold.radius.x*w),Math.max(8,hold.radius.y*h),0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='700 15px sans-serif';ctx.textAlign='center';ctx.fillText(String(i+1),hold.center.x*w,hold.center.y*h+5)}
    const pose=frame.pose,limbColors={leftHand:'#ffcf66',rightHand:'#ff8e64',leftFoot:'#7ad8ff',rightFoot:'#79e3ae'};
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#f4f6f4';ctx.lineWidth=Math.max(8,w/86);ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=8;
    const hip={x:pose.hip.x*w,y:pose.hip.y*h},shoulder={x:pose.shoulder.x*w,y:pose.shoulder.y*h},torsoBend=Math.sin(pose.torsoAngleDeg*Math.PI/180)*w*.018;
    ctx.beginPath();ctx.moveTo(hip.x,hip.y);ctx.quadraticCurveTo((hip.x+shoulder.x)/2+torsoBend,(hip.y+shoulder.y)/2,shoulder.x,shoulder.y);ctx.stroke();
    const headR=Math.max(10,w/52);ctx.fillStyle='#eff4ef';ctx.beginPath();ctx.arc(shoulder.x,shoulder.y-headR*1.35,headR,0,Math.PI*2);ctx.fill();
    for(const item of arg.joints){const limb=item.limb,root=limb.endsWith('Hand')?pose.shoulder:pose.hip,end=pose.endpoints[limb],j=item.point;ctx.strokeStyle='#f4f6f4';ctx.lineWidth=Math.max(7,w/90);ctx.beginPath();ctx.moveTo(root.x*w,root.y*h);ctx.quadraticCurveTo(j.x*w,j.y*h,end.x*w,end.y*h);ctx.stroke();ctx.fillStyle='#dce8e4';ctx.beginPath();ctx.arc(j.x*w,j.y*h,Math.max(5,w/240),0,Math.PI*2);ctx.fill();ctx.fillStyle=limbColors[limb];ctx.beginPath();ctx.arc(end.x*w,end.y*h,Math.max(8,w/150),0,Math.PI*2);ctx.fill();if(pose.contacts[limb]){ctx.strokeStyle=limbColors[limb];ctx.lineWidth=3;ctx.beginPath();ctx.arc(end.x*w,end.y*h,Math.max(13,w/100),0,Math.PI*2);ctx.stroke()}}
    ctx.shadowBlur=0;ctx.fillStyle='#f4f6f4';ctx.beginPath();ctx.arc(hip.x,hip.y,Math.max(8,w/100),0,Math.PI*2);ctx.fill();const com=frame.physics.centerOfMass;ctx.fillStyle='#fff';ctx.strokeStyle='#10272d';ctx.lineWidth=3;ctx.beginPath();ctx.arc(com.x*w,com.y*h,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    const tone=frame.physics.status==='fall'?'#ff705d':frame.physics.status==='warning'?'#ffc857':'#63e6be';ctx.fillStyle='rgba(10,23,27,.84)';ctx.fillRect(18,18,330,58);ctx.fillStyle=tone;ctx.textAlign='left';ctx.font='700 23px sans-serif';ctx.fillText('估算核心负荷 '+Math.round(frame.physics.coreLoadPercent)+'%',36,55);if(note){ctx.fillStyle='rgba(10,23,27,.84)';ctx.fillRect(18,h-68,Math.min(w-36,620),50);ctx.fillStyle='#fff';ctx.font='600 18px sans-serif';ctx.fillText(note.slice(0,50),36,h-36)} })()`;
}

function publicJob(job: Job) { return { id: job.id, status: job.status, progress: job.progress, error: job.error }; }
function safeJson(value: string) { try { return JSON.parse(value); } catch { return []; } }
async function browserExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return process.env.CHROMIUM_EXECUTABLE_PATH;
  const common = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const candidate of common) try { await access(candidate, constants.X_OK); return candidate; } catch { /* try bundled browser */ }
  return undefined;
}
setInterval(() => { const ttl = +(process.env.EXPORT_TTL_MINUTES || 30) * 60000; for (const [id, job] of jobs) if (Date.now() - job.created > ttl) { jobs.delete(id); void rm(path.join(exportRoot, id), { recursive: true, force: true }); } }, 60000).unref();

const dist = path.join(root, 'dist'); try { await access(dist, constants.R_OK); await app.register(fastifyStatic, { root: dist }); app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ message: 'API route not found' }) : reply.sendFile('index.html')); } catch { /* Vite serves the UI in development. */ }
await app.listen({ port: +(process.env.PORT || 3001), host: '0.0.0.0' });
