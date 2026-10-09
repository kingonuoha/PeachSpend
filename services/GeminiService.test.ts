import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getSecret: vi.fn(),
  getExpenses: vi.fn(),
  getCategories: vi.fn(),
  addCategory: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('./DatabaseService', () => ({ databaseService: { getSetting: mocks.getSetting, getSecret: mocks.getSecret, getExpenses: mocks.getExpenses, getCategories: mocks.getCategories, addCategory: mocks.addCategory } }));
vi.mock('../ai/providerClients', () => ({ geminiClient: { generate: mocks.generate } }));

// Mocks must be registered before service import.
// eslint-disable-next-line import/first
import { geminiService } from './GeminiService';

describe('GeminiService scanReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecret.mockResolvedValue('test-key');
    mocks.getCategories.mockResolvedValue([
      { id: 'dining', title: 'Dining', icon_name: 'utensils', color: '#000' },
      { id: 'other', title: 'Other', icon_name: 'tag', color: '#111' },
    ]);
  });

  it('resolves the parsed category to an existing id without writing anything before confirmation', async () => {
    mocks.generate.mockResolvedValue({
      text: '{"legibility":"good","items":[{"merchant":"Cafe","item_name":"Latte","amount":5,"category":"Dining","currency":"USD"}]}',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });

    const items = await geminiService.scanReceipt('base64', 'receipt');

    expect(items[0].category).toBe('dining');
    expect(mocks.getCategories).toHaveBeenCalledOnce();
    expect(mocks.addCategory).not.toHaveBeenCalled();
  });

  it('falls back to the existing default category for an unknown parse value without creating one', async () => {
    mocks.generate.mockResolvedValue({
      text: '{"legibility":"good","items":[{"merchant":"Shop","item_name":"Thing","amount":9,"category":"Food & Drink","currency":"EUR"}]}',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });

    const items = await geminiService.scanReceipt('base64', 'receipt');

    expect(items[0].category).toBe('other');
    expect(mocks.addCategory).not.toHaveBeenCalled();
  });

  it('returns the confidence the provider supplies instead of a hardcoded value', async () => {
    mocks.generate.mockResolvedValue({
      text: '{"legibility":"good","items":[{"merchant":"Cafe","item_name":"Latte","amount":5,"category":"Dining","currency":"USD","confidence":0.42}]}',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });

    const items = await geminiService.scanReceipt('base64', 'receipt');

    expect(items[0].confidence).toBe(0.42);
  });

  it('leaves confidence undefined when the provider omits it', async () => {
    mocks.generate.mockResolvedValue({
      text: '{"legibility":"good","items":[{"merchant":"Cafe","item_name":"Latte","amount":5,"category":"Dining","currency":"USD"}]}',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });

    const items = await geminiService.scanReceipt('base64', 'receipt');

    expect(items[0].confidence).toBeUndefined();
  });

  it('leaves confidence undefined when the provider supplies an out-of-range value', async () => {
    mocks.generate.mockResolvedValue({
      text: '{"legibility":"good","items":[{"merchant":"Cafe","item_name":"Latte","amount":5,"category":"Dining","currency":"USD","confidence":90}]}',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });

    const items = await geminiService.scanReceipt('base64', 'receipt');

    expect(items[0].confidence).toBeUndefined();
  });
});

describe('GeminiService weekly digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetting.mockResolvedValue('test-key');
    mocks.getSecret.mockResolvedValue('test-key');
    mocks.getExpenses.mockResolvedValue([{ amount: 12, category: 'food', merchant: 'Shop', created_at: Date.now() }]);
  });

  it('uses normalized provider client', async () => {
    mocks.generate.mockResolvedValue({ text: 'Spend insight', provider: 'gemini', model: 'gemini-2.5-flash' });
    await expect(geminiService.generateWeeklyDigest()).resolves.toBe('Spend insight');
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ feature: 'narrative_insight' }), 'test-key');
  });

  it('does not expose raw provider errors', async () => {
    mocks.generate.mockRejectedValue(new Error('raw provider secret response'));
    await expect(geminiService.generateWeeklyDigest()).rejects.toMatchObject({ message: 'AI provider request failed', code: 'provider' });
  });
});
