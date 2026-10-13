import { writeFile } from 'node:fs/promises';
import { createSampleProject } from '../src/sample';
import { compileMotion } from '../src/lib/motion';

const project = createSampleProject();
// Keep the smoke export short while still exercising a real transition.
project.steps = project.steps.slice(0, 2);
project.steps[1].moveSeconds = .4; project.steps[1].holdSeconds = .2;
const track = compileMotion(project, 60);
const response = await fetch('http://127.0.0.1:3001/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, track, resolution: 720 }) });
const created = await response.json() as { id?: string; message?: string };
if (!response.ok || !created.id) throw new Error(created.message || 'Could not create export job');
for (;;) {
  const status = await fetch(`http://127.0.0.1:3001/api/exports/${created.id}`).then(r => r.json()) as { status: string; progress: number; error?: string };
  process.stdout.write(`\r${status.status} ${Math.round(status.progress * 100)}%`);
  if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || status.status);
  if (status.status === 'done') break;
  await new Promise(r => setTimeout(r, 500));
}
const video = await fetch(`http://127.0.0.1:3001/api/exports/${created.id}/file`);
if (!video.ok) throw new Error(`Video download failed: ${video.status}`);
const output = '/tmp/climbing-beta-studio-smoke.mp4'; await writeFile(output, Buffer.from(await video.arrayBuffer()));
console.log(`\n${output}`);
