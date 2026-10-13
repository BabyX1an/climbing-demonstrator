import { openDB } from 'idb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../types';

const db = openDB('climbing-beta-studio', 1, { upgrade(db) { db.createObjectStore('projects'); } });
export async function saveProject(project: Project) { await (await db).put('projects', structuredClone(project), project.id); }
export async function loadProject(id: string) { return (await db).get('projects', id) as Promise<Project | undefined>; }
export async function loadLastProject() { const d = await db; const keys = await d.getAllKeys('projects'); return keys.length ? d.get('projects', keys[keys.length - 1]) as Promise<Project> : undefined; }

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportProjectZip(project: Project) {
  const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(project, null, 2)) }, { level: 6 });
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${safe(project.name)}.climbbeta.zip`);
}
export async function importProjectZip(file: File): Promise<Project> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const json = files['project.json']; if (!json) throw new Error('项目包中没有 project.json');
  const parsed = JSON.parse(new TextDecoder().decode(json));
  if (parsed.version !== 1 || !Array.isArray(parsed.holds) || !Array.isArray(parsed.steps) || parsed.steps.length === 0 || typeof parsed.photo?.dataUrl !== 'string') throw new Error('项目文件格式不受支持或没有动作步骤');
  return parsed as Project;
}
export const safe = (name: string) => name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '') || 'climbing-beta';
