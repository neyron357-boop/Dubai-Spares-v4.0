import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cloudConfig', () => ({ SUPABASE_URL: 'https://qa-only.supabase.co', SUPABASE_ANON_KEY: 'qa-public-key' }));
vi.mock('../../egressDebug', () => ({ wrapSupabaseFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }));

beforeEach(() => vi.resetModules());
afterEach(() => vi.useRealTimers());

describe('AI request lifecycle', () => {
  it('does not send a request cancelled before it started', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { aiCore } = await import('../../utils/aiCore');
    const controller = new AbortController(); controller.abort();
    expect((await aiCore.analyzeText({ text: 'test', instructions: '' }, { signal: controller.signal })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('honors timeouts and returns a structured failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const { aiCore } = await import('../../utils/aiCore');
    const result = aiCore.analyzeText({ text: 'test', instructions: '' }, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ ok: false, result: null, error: expect.stringContaining('timed out') });
  });
  it('rejects a successful response for another task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, task: 'transform_text', result: {} }))));
    const { aiCore } = await import('../../utils/aiCore');
    expect((await aiCore.analyzeText({ text: 'test', instructions: '' })).ok).toBe(false);
  });
  it('accepts a valid structured response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, task: 'analyze_text', result: { analysis: { brand: 'Toyota' } } }))));
    const { aiCore } = await import('../../utils/aiCore');
    expect(await aiCore.analyzeText({ text: 'test', instructions: '' })).toMatchObject({ ok: true, result: { analysis: { brand: 'Toyota' } } });
  });
});
