import type { CaptureCandidate } from '../data/contracts';

export type AiProvider = 'gemini' | 'openrouter';
export type AiFeature = 'receipt_ocr' | 'chat' | 'narrative_insight' | 'auto_capture' | 'semantic_search';
// The runtime list is the source of the union, so a caller that has to walk every
// code (the failure message table test, or a screen that enumerates them) cannot
// drift from the type. Members and their meaning are unchanged.
export const AI_ERROR_CODES = [
  'offline',
  'missing_key',
  'unauthorized',
  'rate_limited',
  'timeout',
  'illegible_image',
  'invalid_response',
  'provider',
  'cancelled',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
// What the app was looking at when the call failed. Product and receipt are not a
// copy switch, per DEC-B17: each names its own object, and a product failure must
// never be described with receipt nouns.
export type AiMessageContext = 'receipt' | 'chat' | 'product';

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

// Codes that describe the provider request itself rather than the object that was
// scanned. They read the same in every context because the sentence names no scanned
// object, so there is no receipt or product noun that could be wrong.
type ProviderLevelCode = Exclude<AiErrorCode, 'illegible_image' | 'invalid_response'>;

const PROVIDER_MESSAGE: Record<ProviderLevelCode, string> = {
  offline: 'AI provider is unavailable offline.',
  missing_key: 'AI provider key is not configured.',
  unauthorized: 'AI provider authorization failed.',
  rate_limited: 'AI provider rate limit reached. Try again later.',
  timeout: 'AI provider request timed out. Try again.',
  cancelled: 'AI provider request was cancelled.',
  provider: 'AI provider request failed. Try again.',
};

// The two codes that describe the outcome of reading the scan itself, so they are the
// two that need mode aware copy.
// illegible_image means the provider could not read the image, which is a fact about
// the photograph. invalid_response means the response could not be used, which is a
// schema problem, not a photographic one, so it must not offer a retake as the remedy.
// Neither sentence claims blur or dim lighting, because the app never establishes
// either: it only knows what the provider returned.
// The chat sentences are byte identical to the ones this table replaced, because the
// row's constraint is to unflatten the two codes and change nothing else outside
// receipt and product mode.
type ScanOutcomeCode = 'illegible_image' | 'invalid_response';

const SCAN_MESSAGE: Record<AiMessageContext, Record<ScanOutcomeCode, string>> = {
  receipt: {
    illegible_image: 'Receipt image could not be read. Retake the photo and try again.',
    invalid_response: 'The AI response for this receipt could not be used. Try scanning again.',
  },
  chat: {
    illegible_image: 'Receipt image is not clear enough. Try again.',
    invalid_response: 'AI provider returned an invalid response.',
  },
  product: {
    illegible_image: 'Product image could not be read. Retake the photo and try again.',
    invalid_response: 'The AI response for this product could not be used. Try scanning again.',
  },
};

// Pure and total: both tables are exhaustive records over their code sets, so every
// code in the union returns a sentence and there is no fallthrough to undefined.
export function getAiErrorMessage(code: AiErrorCode, context: AiMessageContext = 'chat'): string {
  if (code === 'illegible_image' || code === 'invalid_response') return SCAN_MESSAGE[context][code];
  return PROVIDER_MESSAGE[code];
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
