import type { AiErrorCode, AiProvider, ProviderModel } from '../ai/contracts';
import { normalizeAiError } from '../ai/contracts';
import { maskSecret } from './secrets';

// S-17 provider key and model contracts (FR-17.1-17.4). The key state never
// carries the value: a configured key only ever exposes the fixed, length
// independent mask, and an absent key exposes nothing.
export type MaskedKeyState =
  | { status: 'configured'; masked: string }
  | { status: 'absent' };

export interface ProviderKeyState {
  gemini: MaskedKeyState;
  openrouter: MaskedKeyState;
}

export function toMaskedKeyState(hasKey: boolean): MaskedKeyState {
  if (!hasKey) return { status: 'absent' };
  // The mask is computed from a constant, never from the real key, so the state
  // object cannot leak a prefix, a suffix, or the key length.
  return { status: 'configured', masked: maskSecret('configured') as string };
}

export type ModelRefreshOutcome =
  | { status: 'success'; models: ProviderModel[]; refreshedAt: number }
  | { status: 'cached'; models: ProviderModel[]; errorCode: AiErrorCode }
  | { status: 'failed'; models: []; errorCode: AiErrorCode };

// Refresh boundary shared by both providers and both model lists. On failure the
// caller's real cached list is returned as a typed `cached` outcome; with no
// cache it reports `failed` with the typed code instead of an empty success that
// would look like the provider returned nothing.
export async function refreshModels(
  provider: AiProvider,
  apiKey: string | null,
  listModels: (provider: AiProvider, apiKey: string) => Promise<ProviderModel[]>,
  cached: ProviderModel[] = [],
): Promise<ModelRefreshOutcome> {
  if (!apiKey) return cached.length > 0 ? { status: 'cached', models: cached, errorCode: 'missing_key' } : { status: 'failed', models: [], errorCode: 'missing_key' };
  try {
    const models = await listModels(provider, apiKey);
    return { status: 'success', models, refreshedAt: Date.now() };
  } catch (error) {
    const normalized = normalizeAiError(error, provider);
    return cached.length > 0
      ? { status: 'cached', models: cached, errorCode: normalized.code }
      : { status: 'failed', models: [], errorCode: normalized.code };
  }
}

export const CHAT_HISTORY_AUTO_CLEAR_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ConversationHistoryState {
  messageCount: number;
  autoClearDays: number;
  lastActiveAt: number | null;
  autoClearsAt: number | null;
  willAutoClear: boolean;
}

export function buildConversationHistoryState(
  messageCount: number,
  lastActiveAt: number | null,
  now = Date.now(),
): ConversationHistoryState {
  const autoClearsAt = lastActiveAt ? lastActiveAt + CHAT_HISTORY_AUTO_CLEAR_DAYS * DAY_MS : null;
  return {
    messageCount,
    autoClearDays: CHAT_HISTORY_AUTO_CLEAR_DAYS,
    lastActiveAt,
    autoClearsAt,
    willAutoClear: autoClearsAt !== null && autoClearsAt <= now,
  };
}
