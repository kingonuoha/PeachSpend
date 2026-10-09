import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/contracts';
import {
  buildConversationHistoryState, CHAT_HISTORY_AUTO_CLEAR_DAYS, refreshModels, toMaskedKeyState,
} from './ProviderSettings';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe('masked key state', () => {
  it('never contains any character of a real key', () => {
    const state = toMaskedKeyState(true);
    expect(state.status).toBe('configured');
    const realKey = 'AIzaSyA-first-three-and-last-two';
    if (state.status === 'configured') {
      for (const character of realKey) {
        // A digit or letter could coincidentally be the bullet mask, so check
        // against the key's alphanumeric characters only.
        if (/[a-z0-9]/i.test(character)) expect(state.masked.toLowerCase()).not.toContain(character.toLowerCase());
      }
    }
    expect(toMaskedKeyState(false)).toEqual({ status: 'absent' });
  });
});

describe('refreshModels outcome', () => {
  const model = { id: 'm', displayName: 'Model' };

  it('returns a success outcome and refreshes', async () => {
    const outcome = await refreshModels('gemini', 'key', async () => [model]);
    expect(outcome).toMatchObject({ status: 'success', models: [model] });
  });

  it('falls back to the real cache on provider failure', async () => {
    const outcome = await refreshModels('openrouter', 'key', async () => { throw new AiError('rate_limited', 'openrouter', 'limited', true); }, [model]);
    expect(outcome).toMatchObject({ status: 'cached', errorCode: 'rate_limited', models: [model] });
  });

  it('reports a typed failure when there is no cache', async () => {
    const outcome = await refreshModels('gemini', 'key', async () => { throw new TypeError('offline'); });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'offline', models: [] });
  });

  it('does not call the provider without a key', async () => {
    const list = vi.fn(async () => [model]);
    const outcome = await refreshModels('gemini', null, list);
    expect(list).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'missing_key' });
  });
});

describe('conversation history state', () => {
  it('exposes the count and the 7-day auto-clear rule', () => {
    const now = 1_000_000_000_000;
    const state = buildConversationHistoryState(12, now - 2 * 86400000, now);
    expect(state).toEqual({
      messageCount: 12,
      autoClearDays: CHAT_HISTORY_AUTO_CLEAR_DAYS,
      lastActiveAt: now - 2 * 86400000,
      autoClearsAt: now + 5 * 86400000,
      willAutoClear: false,
    });
    expect(buildConversationHistoryState(3, now - 8 * 86400000, now).willAutoClear).toBe(true);
    expect(buildConversationHistoryState(3, null, now)).toMatchObject({ autoClearsAt: null, willAutoClear: false });
  });
});
