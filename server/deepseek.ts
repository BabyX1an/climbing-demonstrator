import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Hold } from '../src/types.js';

const candidateSchema = z.object({
  holds: z.array(z.object({
    box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
    kind: z.enum(['jug', 'edge', 'sloper', 'pinch', 'pocket', 'unknown']).catch('unknown'),
    usage: z.enum(['pull', 'sidepull-left', 'sidepull-right', 'undercling', 'downpress']).catch('pull'),
    confidence: z.number().min(0).max(1).optional(),
  })).max(150),
});

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

type AnalyzeInput = {
  bytes: Uint8Array;
  mimetype: 'image/jpeg' | 'image/png' | 'image/webp';
  colorSamples: string[];
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function analyzeHoldsWithDeepSeek(input: AnalyzeInput) {
  const model = input.model || 'deepseek-flash';
  const baseUrl = (input.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const prompt = `Analyze this indoor bouldering-wall photo. Find every climbing hold that plausibly belongs to the route represented by these sampled colors: ${input.colorSamples.join(', ') || 'no reliable sample; find prominent route holds'}.
Return strict JSON with key "holds". Each hold needs box=[ymin,xmin,ymax,xmax] normalized 0..1000, optional polygon=[[x,y],...] normalized 0..1000, kind one of jug|edge|sloper|pinch|pocket|unknown, usage one of pull|sidepull-left|sidepull-right|undercling|downpress, and confidence 0..1. Include faded or shadowed candidates at lower confidence. Do not invent holds outside visible plastic/wooden climbing features.`;

  const response = await (input.fetchImpl || fetch)(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${input.mimetype};base64,${Buffer.from(input.bytes).toString('base64')}`, detail: 'original' } },
      ] }],
    }),
  });

  const body = responseSchema.parse(await response.json());
  if (!response.ok) throw new Error(body.error?.message || `DeepSeek HTTP ${response.status}`);
  const content = body.choices?.[0]?.message.content;
  if (!content) throw new Error('DeepSeek response did not contain message content');

  const parsed = candidateSchema.parse(parseJsonObject(content));
  const holds = parsed.holds.map((candidate): Hold => {
    const [y1, x1, y2, x2] = candidate.box.map(value => Math.max(0, Math.min(1000, value))) as [number, number, number, number];
    return {
      id: `ai-${randomUUID()}`,
      center: { x: (x1 + x2) / 2000, y: (y1 + y2) / 2000 },
      radius: { x: Math.max(.01, (x2 - x1) / 2000), y: Math.max(.01, (y2 - y1) / 2000) },
      polygon: candidate.polygon?.map(([x, y]) => ({ x: x / 1000, y: y / 1000 })),
      kind: candidate.kind,
      status: 'candidate',
      source: 'ai',
      confirmed: false,
      depthCm: 4,
      profile: {
        allowed: ['hand', 'foot'],
        usage: candidate.usage,
        normalAngleDeg: 90,
        friction: candidate.kind === 'sloper' ? .45 : .7,
        capacityN: 850,
        hookAllowed: candidate.kind !== 'sloper',
      },
    };
  });

  return { holds, model, provider: 'deepseek' as const };
}

function parseJsonObject(value: string) {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('DeepSeek did not return a JSON object');
  return JSON.parse(value.slice(start, end + 1));
}
