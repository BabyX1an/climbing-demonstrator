import { describe, expect, it, vi } from 'vitest';
import { analyzeHoldsWithDeepSeek } from '../server/deepseek.js';

describe('DeepSeek vision adapter', () => {
  it('sends an OpenAI-compatible image request and maps validated candidates', async () => {
    const requestMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"holds":[{"box":[100,200,300,400],"polygon":[[200,100],[400,300]],"kind":"sloper","usage":"sidepull-left","confidence":0.82}]}\n```' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const fetchImpl = requestMock as unknown as typeof fetch;

    const result = await analyzeHoldsWithDeepSeek({
      bytes: Uint8Array.from([137, 80, 78, 71]),
      mimetype: 'image/png',
      colorSamples: ['#e04f86'],
      apiKey: 'test-key',
      baseUrl: 'https://deepseek.invalid/',
      fetchImpl,
    });

    expect(requestMock).toHaveBeenCalledOnce();
    const [url, init] = requestMock.mock.calls[0];
    expect(url).toBe('https://deepseek.invalid/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-key' });
    const request = JSON.parse(String(init?.body));
    expect(request.model).toBe('deepseek-flash');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0].content[0].text).toContain('#e04f86');
    expect(request.messages[0].content[1].image_url.url).toBe('data:image/png;base64,iVBORw==');
    expect(result.provider).toBe('deepseek');
    expect(result.holds[0]).toMatchObject({
      center: { x: .3, y: .2 },
      radius: { x: .1, y: .1 },
      kind: 'sloper',
      status: 'candidate',
      source: 'ai',
      confirmed: false,
      profile: { usage: 'sidepull-left', friction: .45, hookAllowed: false },
    });
  });
});
