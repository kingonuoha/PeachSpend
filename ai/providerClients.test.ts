import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithProvider, listProviderModels, openRouterClient, PROVIDER_REQUEST_TIMEOUT_MS } from './providerClients';

describe('provider client boundary', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(['gemini', 'openrouter'] as const)('normalizes %s provider failures', async provider => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('provider secret', { status: 500 }));

    await expect(chatWithProvider(provider, { feature: 'chat', model: 'model', messages: [{ role: 'user', content: 'hello' }] }, 'key'))
      .rejects.toMatchObject({ code: 'provider', message: 'AI provider temporarily unavailable' });
  });

  it('normalizes both model list response shapes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'org/model', name: 'Model', pricing: { prompt: '0', completion: '0' }, context_length: 1000 }] }), { status: 200 }));

    await expect(listProviderModels('gemini', 'key')).resolves.toEqual([{ id: 'gemini-2.5-flash', displayName: 'Flash' }]);
    await expect(listProviderModels('openrouter', 'key')).resolves.toEqual([{ id: 'org/model', displayName: 'Model', isFree: true, contextLength: 1000 }]);
  });

  it('passes AbortSignal through OpenRouter chat requests', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.signal).toBe(signal);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'reply' } }] }), { status: 200 });
    });

    await expect(chatWithProvider('openrouter', { feature: 'chat', model: 'model', messages: [{ role: 'user', content: 'hello' }], signal }, 'key')).resolves.toMatchObject({ text: 'reply' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('passes AbortSignal through OpenRouter generate requests', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.signal).toBe(signal);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'parsed' } }] }), { status: 200 });
    });

    await expect(openRouterClient.generate({ feature: 'receipt_ocr', model: 'model', prompt: 'parse', signal }, 'key')).resolves.toMatchObject({ text: 'parsed' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['gemini', 'openrouter'] as const)('bounds %s requests', async provider => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const request = { feature: 'chat' as const, model: 'model', messages: [{ role: 'user' as const, content: 'hello' }] };
    const pending = chatWithProvider(provider, request, 'key');
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(PROVIDER_REQUEST_TIMEOUT_MS);
    await expect(settled).resolves.toMatchObject({ error: { code: 'timeout', retryable: true } });
    vi.useRealTimers();
  });
});
