/// <reference lib="webworker" />
import { compileMotion } from '../lib/motion';
self.onmessage = (event: MessageEvent) => {
  try { self.postMessage({ id: event.data.id, track: compileMotion(event.data.project, event.data.sampleRate ?? 60) }); }
  catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) }); }
};
export {};
