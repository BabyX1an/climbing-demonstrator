import { useEffect, useRef, useState } from 'react';
import type { MotionTrack, Project } from '../types';
import { compileMotion } from '../lib/motion';

export function useMotion(project: Project) {
  const [track, setTrack] = useState<MotionTrack>(() => compileMotion(project)); const id = useRef(0);
  useEffect(() => {
    const current = ++id.current; let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('../workers/physics.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = e => { if (e.data.id === current && e.data.track) setTrack(e.data.track); worker?.terminate(); };
      worker.onerror = () => { if (current === id.current) setTrack(compileMotion(project)); worker?.terminate(); };
      worker.postMessage({ id: current, project, sampleRate: 60 });
    } catch { setTrack(compileMotion(project)); }
    return () => worker?.terminate();
  }, [project]);
  return track;
}
