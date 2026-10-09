import { AiError, classifyProviderFailure, normalizeAiError, type AiProviderClient, type ProviderRequest, type ProviderResponse, type AiProvider, type ChatProviderRequest, type ProviderModel } from './contracts';

export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

async function requestJson(url: string, init: RequestInit, provider: 'gemini' | 'openrouter', signal?: AbortSignal): Promise<unknown> {
  const timeoutMarker = Symbol('provider-timeout');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof timeoutMarker>(resolve => {
    timeoutId = setTimeout(() => resolve(timeoutMarker), PROVIDER_REQUEST_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([fetch(url, { ...init, signal }), timeoutPromise]);
    if (response === timeoutMarker) throw new AiError('timeout', provider, 'AI provider request timed out', true);
    if (!response.ok) { const body = await response.text().catch(() => ''); throw classifyProviderFailure(provider, response.status, body ? 'AI provider rejected request' : undefined); }
    try { return await response.json(); } catch { throw new AiError('invalid_response', provider, 'AI provider returned invalid JSON'); }
  } catch (error) {
    if (signal?.aborted) throw new AiError('cancelled', provider, 'AI provider request was cancelled');
    throw normalizeAiError(error, provider);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function requireKey(apiKey: string, provider: 'gemini' | 'openrouter'): void {
  if (!apiKey.trim()) throw new AiError('missing_key', provider, 'AI provider key is not configured');
}

export async function chatWithProvider(provider: AiProvider, request: ChatProviderRequest, apiKey: string): Promise<ProviderResponse> {
  requireKey(apiKey, provider);
  if (provider === 'gemini') {
    const contents = request.messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: typeof message.content === 'string' ? [{ text: message.content }] : message.content.map(content => content.type === 'text' ? { text: content.text || '' } : { inline_data: { mime_type: 'image/jpeg', data: content.image_url?.url.split(',')[1] || '' } }),
    }));
    const data = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ contents }) }, provider, request.signal) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) throw new AiError('invalid_response', provider, 'AI provider returned no content');
    return { text, provider, model: request.model };
  }
  const data = await requestJson('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: request.model, messages: request.messages, max_tokens: 1024 }) }, provider, request.signal) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiError('invalid_response', provider, 'AI provider returned no content');
  return { text, provider, model: request.model };
}

export async function listProviderModels(provider: AiProvider, apiKey: string): Promise<ProviderModel[]> {
  requireKey(apiKey, provider);
  const headers: Record<string, string> = provider === 'gemini' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` };
  const data = await requestJson(provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models' : 'https://openrouter.ai/api/v1/models', { headers }, provider, undefined) as { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]; data?: { id?: string; name?: string; pricing?: { prompt?: string; completion?: string }; context_length?: number }[] };
  if (provider === 'gemini') return (data.models || []).filter(model => model.name?.startsWith('models/') && model.supportedGenerationMethods?.includes('generateContent')).map(model => ({ id: model.name!.replace('models/', ''), displayName: model.displayName || model.name!.replace('models/', '') }));
  return (data.data || []).filter(model => model.id?.includes('/')).map(model => ({ id: model.id!, displayName: model.name || model.id!, isFree: Number(model.pricing?.prompt || 0) === 0 && Number(model.pricing?.completion || 0) === 0, contextLength: model.context_length || 0 }));
}

export const geminiClient: AiProviderClient = {
  provider: 'gemini',
  async generate(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    requireKey(apiKey, 'gemini');
    const parts: Record<string, unknown>[] = [{ text: request.prompt }];
    if (request.imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: request.imageBase64 } });
    const data = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ contents: [{ role: 'user', parts }] }) }, 'gemini', request.signal) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) throw new AiError('invalid_response', 'gemini', 'Gemini returned no content');
    return { text, provider: 'gemini', model: request.model };
  },
};

export const openRouterClient: AiProviderClient = {
  provider: 'openrouter',
  async generate(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    requireKey(apiKey, 'openrouter');
    const content: unknown = request.imageBase64 ? [{ type: 'text', text: request.prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.imageBase64}` } }] : request.prompt;
    const data = await requestJson('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: request.model, messages: [{ role: 'user', content }], max_tokens: 2048 }) }, 'openrouter', request.signal) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiError('invalid_response', 'openrouter', 'OpenRouter returned no content');
    return { text, provider: 'openrouter', model: request.model };
  },
};
