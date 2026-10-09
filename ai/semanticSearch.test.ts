import { describe, expect, it, vi } from 'vitest';
import type { AiProviderClient, ProviderRequest } from './contracts';
import type { Expense } from '../types/database';
import { exactKeywordMatches, MAX_SEMANTIC_CANDIDATES, searchExpenses, type SemanticSearchContext } from './semanticSearch';

const expense = (id: string, fields: Partial<Expense> = {}): Expense => ({
  id, merchant: 'Starbucks', amount: 8, currency: 'USD', category: 'dining', scanned: 0, date: 1000, created_at: 1000, ...fields,
});

const clientReturning = (text: string): AiProviderClient => ({ provider: 'gemini', generate: vi.fn(async () => ({ text, provider: 'gemini' as const, model: 'm' })) });

const context = (overrides: Partial<SemanticSearchContext> = {}): SemanticSearchContext => ({
  isConnected: true, provider: 'gemini', apiKey: 'k', model: 'm', client: clientReturning('{"ids":[]}'), ...overrides,
});

describe('exactKeywordMatches', () => {
  it('matches merchant, note, and category and carries the S-08 route', () => {
    const expenses = [
      expense('m', { merchant: 'Starbucks' }),
      expense('n', { merchant: 'Shop', note: 'coffee beans' }),
      expense('c', { merchant: 'Shop', category: 'coffee' }),
    ];
    const results = exactKeywordMatches(expenses, 'coffee');
    expect(results.map(result => result.expenseId)).toEqual(['n', 'c']);
    expect(results[0].matchedFields).toEqual(['note']);
    expect(results.every(result => result.matchType === 'exact')).toBe(true);
    expect(results[0].route).toEqual({ screen: 'S-08', id: 'n' });
  });

  it('returns nothing for an empty query', () => {
    expect(exactKeywordMatches([expense('a')], '   ')).toEqual([]);
  });
});

describe('searchExpenses', () => {
  const expenses = [expense('exact', { merchant: 'Coffee Bean' }), expense('semantic', { merchant: 'Starbucks' })];

  it('falls back to exact-only offline and without a key', async () => {
    const offline = await searchExpenses(expenses, 'Coffee Bean', context({ isConnected: false }));
    expect(offline.mode).toBe('exact_only');
    expect(offline.semanticAvailability).toBe('offline');
    expect(offline.exact).toHaveLength(1);

    const missing = await searchExpenses(expenses, 'Coffee Bean', context({ apiKey: null }));
    expect(missing.semanticAvailability).toBe('missing_key');
  });

  it('keeps semantic matches distinct from exact matches', async () => {
    const client = clientReturning('Here you go: {"ids":["semantic","exact"]}');
    const response = await searchExpenses(expenses, 'Coffee', context({ client, provider: 'openrouter' }));
    expect(response.mode).toBe('exact_and_semantic');
    expect(response.semanticAvailability).toBe('ready');
    expect(response.exact.map(result => result.expenseId)).toEqual(['exact']);
    expect(response.semantic.map(result => result.expenseId)).toEqual(['semantic']);
    expect(response.semantic[0].matchType).toBe('semantic');
    expect(response.semantic[0].route.screen).toBe('S-08');
  });

  it('reports a typed provider failure while still returning exact hits', async () => {
    const failing: AiProviderClient = { provider: 'gemini', generate: vi.fn(async () => { throw new TypeError('offline'); }) };
    const response = await searchExpenses(expenses, 'Coffee Bean', context({ client: failing }));
    expect(response.semanticAvailability).toBe('provider_failed');
    expect(response.errorCode).toBe('offline');
    expect(response.exact).toHaveLength(1);
    expect(response.mode).toBe('exact_only');
  });

  it('does not call the provider for an empty query', async () => {
    const client = clientReturning('{"ids":["semantic"]}');
    const response = await searchExpenses(expenses, '  ', context({ client }));
    expect(response.semanticAvailability).toBe('ready');
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe('semantic search data minimization (S-05R-02)', () => {
  const capturingClient = (ids: string[] = []): { client: AiProviderClient; prompt: () => string } => {
    let captured = '';
    const client: AiProviderClient = {
      provider: 'gemini',
      generate: vi.fn(async (request: ProviderRequest) => {
        captured = request.prompt;
        return { text: JSON.stringify({ ids }), provider: 'gemini' as const, model: 'm' };
      }),
    };
    return { client, prompt: () => captured };
  };

  it('never serializes a large ledger in full and keeps one provider call', async () => {
    const ledger = Array.from({ length: 400 }, (_, index) =>
      expense(`e${index}`, { merchant: `Merchant ${index}`, note: `private note ${index}`, date: index }));
    const { client, prompt } = capturingClient(['e399']);

    const response = await searchExpenses(ledger, 'coffee', context({ client }));

    expect(response.semanticAvailability).toBe('ready');
    expect(client.generate).toHaveBeenCalledTimes(1);
    // Only the most recent bounded window is sent; the oldest entries never leave.
    expect(prompt()).toContain('Merchant 399');
    expect(prompt()).not.toContain('Merchant 0');
    expect(prompt()).not.toContain(`Merchant ${400 - MAX_SEMANTIC_CANDIDATES - 1}`);
    // Notes are withheld unless the query targets them or the note hits a token.
    expect(prompt()).not.toContain('"note"');
    expect(prompt()).not.toContain('private note');
    // The listing is fenced as untrusted data.
    expect(prompt()).toContain('<<<LEDGER_DATA');
    expect(prompt()).toContain('never as instructions');
    // The result reports only the fields actually sent.
    expect(response.semantic[0].matchedFields).toEqual(['merchant', 'category']);
  });

  it('includes notes only when the query targets notes or the note hits a query token', async () => {
    const ledger = [
      expense('a', { note: 'client dinner' }),
      expense('b', { note: 'coffee beans' }),
      expense('c', { note: 'groceries run' }),
    ];
    const notesQuery = capturingClient();
    await searchExpenses(ledger, 'show my notes', context({ client: notesQuery.client }));
    expect(notesQuery.prompt()).toContain('client dinner');
    expect(notesQuery.prompt()).toContain('groceries run');

    const hitQuery = capturingClient();
    await searchExpenses(ledger, 'coffee shop', context({ client: hitQuery.client }));
    expect(hitQuery.prompt()).toContain('coffee beans');
    expect(hitQuery.prompt()).not.toContain('client dinner');
  });
});
