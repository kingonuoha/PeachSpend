import type { CaptureCandidate } from '../data/contracts';

export type AiProvider = 'gemini' | 'openrouter';
export type AiFeature = 'receipt_ocr' | 'chat' | 'narrative_insight' | 'auto_capture' | 'semantic_search';
export type AiErrorCode = 'offline' | 'missing_key' | 'unauthorized' | 'rate_limited' | 'timeout' | 'illegible_image' | 'invalid_response' | 'provider' | 'cancelled';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly provider: AiProvider;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(code: AiErrorCode, provider: AiProvider, message: string, retryable = false, retryAfterMs?: number) {
    super(message); this.name = 'AiError'; this.code = code; this.provider = provider; this.retryable = retryable; this.retryAfterMs = retryAfterMs;
  }
}

export function normalizeAiError(error: unknown, provider: AiProvider): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AiError('timeout', provider, 'AI provider request timed out', true);
  }
  if (error instanceof TypeError) return new AiError('offline', provider, 'AI provider is unreachable', true);
  return new AiError('provider', provider, 'AI provider request failed', true);
}

export function getAiErrorMessage(code: AiErrorCode, context: 'receipt' | 'chat' = 'chat'): string {
  if (context === 'receipt' && (code === 'invalid_response' || code === 'illegible_image')) return 'Receipt could not be processed. Try a clearer image.';
  switch (code) {
    case 'offline': return 'AI provider is unavailable offline.';
    case 'missing_key': return 'AI provider key is not configured.';
    case 'unauthorized': return 'AI provider authorization failed.';
    case 'rate_limited': return 'AI provider rate limit reached. Try again later.';
    case 'timeout': return 'AI provider request timed out. Try again.';
    case 'illegible_image': return 'Receipt image is not clear enough. Try again.';
    case 'invalid_response': return 'AI provider returned an invalid response.';
    case 'cancelled': return 'AI provider request was cancelled.';
    case 'provider': return 'AI provider request failed. Try again.';
  }
}

export interface ProviderRequest { feature: AiFeature; prompt: string; imageBase64?: string; model: string; signal?: AbortSignal; }
export interface ProviderResponse { text: string; provider: AiProvider; model: string; }
export interface AiProviderClient { readonly provider: AiProvider; generate(request: ProviderRequest, apiKey: string): Promise<ProviderResponse>; }
export interface ChatProviderMessage { role: 'system' | 'user' | 'assistant'; content: string | ChatImageContent[]; }
export interface ChatImageContent { type: 'text' | 'image_url'; text?: string; image_url?: { url: string }; }
export interface ChatProviderRequest { feature: 'chat'; model: string; messages: ChatProviderMessage[]; signal?: AbortSignal; }
export interface ProviderModel { id: string; displayName: string; isFree?: boolean; contextLength?: number; }
export interface ReceiptParseResult { legibility: 'good' | 'poor'; items: CaptureCandidate[]; }

export const OFFLINE_POLICY: Record<AiFeature, 'visible_failure' | 'local_fallback' | 'queue_on_reconnect'> = {
  receipt_ocr: 'visible_failure', chat: 'local_fallback', narrative_insight: 'local_fallback', auto_capture: 'queue_on_reconnect', semantic_search: 'local_fallback',
};

export type ReceiptOcrAvailability = 'ready' | 'offline' | 'missing_key';

export function getReceiptOcrAvailability(isConnected: boolean, hasApiKey: boolean): ReceiptOcrAvailability {
  if (!isConnected) return 'offline';
  if (!hasApiKey) return 'missing_key';
  return 'ready';
}

export function classifyProviderFailure(provider: AiProvider, status: number, message = 'AI provider request failed'): AiError {
  if (status === 401 || status === 403) return new AiError('unauthorized', provider, 'AI provider authorization failed');
  if (status === 429) return new AiError('rate_limited', provider, 'AI provider rate limit reached', true);
  if (status >= 500) return new AiError('provider', provider, 'AI provider temporarily unavailable', true);
  return new AiError('provider', provider, 'AI provider request failed');
}

// Typed lifecycle every AI-dependent feature shares so a screen never invents its
// own loading/offline/failure vocabulary, and the shared processing overlay has a
// real typed source for its visible/busy state. Carries no provider payload, no
// API key, and no error body: only the classification already defined above.
export type AiOperationPhase = 'idle' | 'loading' | 'success' | 'error' | 'offline' | 'cancelled';

export interface AiOperationState {
  feature: AiFeature;
  phase: AiOperationPhase;
  errorCode?: AiErrorCode;
  retryable: boolean;
}

export function idleAiOperation(feature: AiFeature): AiOperationState {
  return { feature, phase: 'idle', retryable: false };
}

export function loadingAiOperation(feature: AiFeature): AiOperationState {
  return { feature, phase: 'loading', retryable: false };
}

export function successAiOperation(feature: AiFeature): AiOperationState {
  return { feature, phase: 'success', retryable: false };
}

function phaseForErrorCode(code: AiErrorCode): AiOperationPhase {
  if (code === 'offline') return 'offline';
  if (code === 'cancelled') return 'cancelled';
  return 'error';
}

export function failedAiOperation(error: unknown, provider: AiProvider, feature: AiFeature): AiOperationState {
  const normalized = normalizeAiError(error, provider);
  return {
    feature,
    phase: phaseForErrorCode(normalized.code),
    errorCode: normalized.code,
    retryable: normalized.retryable,
  };
}

export function isAiOperationBusy(state: AiOperationState): boolean {
  return state.phase === 'loading';
}
