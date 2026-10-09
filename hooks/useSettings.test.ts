import { describe, expect, it } from 'vitest';
import { omitSecretSettings } from './settingsBoundary';

describe('useSettings security boundary', () => {
  it('omits provider secrets while preserving public settings', () => {
    expect(omitSecretSettings({
      gemini_api_key: 'gemini-secret',
      chat_openrouter_api_key: 'openrouter-secret',
      currency: 'EUR',
      theme: 'light',
    })).toEqual({ currency: 'EUR', theme: 'light' });
  });
});
