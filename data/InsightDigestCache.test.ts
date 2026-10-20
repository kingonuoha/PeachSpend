import { describe, expect, it, vi } from 'vitest';
import type { InsightDigest, InsightsSnapshot, InsightTimeframe } from './InsightContracts';
import { buildInsightDigestKey, createInsightDigestCache } from './InsightDigestCache';

const available = (text: string): InsightDigest => ({
  status: 'available',
  text,
  localText: 'Spending is 20% higher than previous period.',
  generatedAt: 1_700_000_000_000,
  retryable: false,
});

function snapshot(overrides: Partial<InsightsSnapshot> = {}): InsightsSnapshot {
  return {
    state: 'ready',
    timeframe: 'week',
    period: { start: 1_000, end: 2_000 },
    previousPeriod: { start: 0, end: 999 },
    totalSpent: 120,
    totalIncome: 500,
    netBalance: 380,
    transactionCount: 4,
    currency: 'CAD',
    categories: [],
    insight: {
      currentTotal: 120,
      previousTotal: 100,
      changeAmount: 20,
      changePercent: 20,
      direction: 'up',
      localText: 'Spending is 20% higher than previous period.',
      aiText: null,
      aiState: 'not_requested',
      narrativeText: 'Spending is 20% higher than previous period.',
    },
    normalization: { complete: true, missingRates: [] },
    generatedAt: 1_700_000_000_000,
    refresh: { status: 'idle' },
    ...overrides,
  };
}

const LOCAL_TEXT = 'Spending is 20% higher than previous period.';
// A settings revision token of the shape useEffect reads from useDataToken.
const CONTEXT = 'settings:0';

// F-06. The cache key is the whole reuse contract, so it is pinned on its own.
describe('insight digest cache key', () => {
  it('is stable for two snapshots of the same figures', () => {
    expect(buildInsightDigestKey(snapshot(), 'week')).toBe(buildInsightDigestKey(snapshot(), 'week'));
  });

  it('changes when the timeframe changes', () => {
    const keys = (['week', 'month', 'all', 'custom'] as InsightTimeframe[]).map(timeframe =>
      buildInsightDigestKey(snapshot(), timeframe));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('changes when either period bound moves', () => {
    const base = buildInsightDigestKey(snapshot(), 'week');
    expect(buildInsightDigestKey(snapshot({ period: { start: 1_001, end: 2_000 } }), 'week')).not.toBe(base);
    expect(buildInsightDigestKey(snapshot({ period: { start: 1_000, end: 2_001 } }), 'week')).not.toBe(base);
  });

  it('changes when the transaction count or the total spent changes', () => {
    const base = buildInsightDigestKey(snapshot(), 'week');
    expect(buildInsightDigestKey(snapshot({ transactionCount: 5 }), 'week')).not.toBe(base);
    expect(buildInsightDigestKey(snapshot({ totalSpent: 121 }), 'week')).not.toBe(base);
  });
});

// F-06. The read path and the generate path are separated so a mount, a section
// switch or a timeframe change cannot reach a provider. The loader is a spy, so
// "no network call" is asserted rather than assumed.
describe('insight digest cache resolution', () => {
  it('returns the local summary for an uncached snapshot and never runs the loader', () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    const digest = cache.read(snapshot(), 'week', CONTEXT);

    expect(digest).toEqual({
      status: 'unavailable',
      text: null,
      localText: LOCAL_TEXT,
      generatedAt: null,
      errorCode: undefined,
      retryable: true,
    });
    expect(load).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it('returns a generated digest without a second loader call', async () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    await expect(cache.generate(snapshot(), 'week', CONTEXT)).resolves.toEqual(available('AI text.'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ totalSpent: 120 }), 'week');

    expect(cache.read(snapshot(), 'week', CONTEXT)).toEqual(available('AI text.'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('does not serve a digest to a snapshot whose figures moved', async () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    await cache.generate(snapshot(), 'week', CONTEXT);

    expect(cache.read(snapshot({ totalSpent: 121 }), 'week', CONTEXT)).toMatchObject({ status: 'unavailable', text: null });
    expect(cache.read(snapshot({ period: { start: 1_001, end: 2_000 } }), 'week', CONTEXT)).toMatchObject({ status: 'unavailable', text: null });
    expect(cache.read(snapshot(), 'month', CONTEXT)).toMatchObject({ status: 'unavailable', text: null });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache an unavailable outcome, so a retry can still reach the provider', async () => {
    const load = vi.fn(async (): Promise<InsightDigest> => ({
      status: 'unavailable', text: null, localText: LOCAL_TEXT, generatedAt: null, errorCode: 'offline', retryable: true,
    }));
    const cache = createInsightDigestCache(load);

    await cache.generate(snapshot(), 'week', CONTEXT);

    expect(cache.size).toBe(0);
    expect(cache.read(snapshot(), 'week', CONTEXT)).toMatchObject({ status: 'unavailable', retryable: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports an unloaded snapshot as a typed failure without running the loader', () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    expect(cache.read(snapshot({ state: 'offline', refresh: { status: 'failed', errorCode: 'offline' } }), 'week', CONTEXT))
      .toMatchObject({ status: 'unavailable', text: null, errorCode: 'offline', retryable: false });
    expect(cache.read(snapshot({ state: 'failure', refresh: { status: 'failed', errorCode: 'failure' } }), 'week', CONTEXT))
      .toMatchObject({ status: 'unavailable', text: null, errorCode: 'provider', retryable: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('drops every entry on clear and never runs the loader to do it', async () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    await cache.generate(snapshot(), 'week', CONTEXT);
    await cache.generate(snapshot(), 'month', CONTEXT);
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.read(snapshot(), 'week', CONTEXT)).toMatchObject({ status: 'unavailable', text: null, localText: LOCAL_TEXT });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

// F-07. The provider context is part of the reuse boundary. A digest produced under
// one provider, model or key is not served under the next one, and the check holds
// across a remount because the token travels with every call rather than being
// compared against a ref inside the hook.
describe('insight digest cache provider context (F-07)', () => {
  it('drops a digest produced under a previous provider context', async () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    await cache.generate(snapshot(), 'week', 'settings:1');
    expect(cache.read(snapshot(), 'week', 'settings:1')).toEqual(available('AI text.'));
    expect(load).toHaveBeenCalledTimes(1);

    expect(cache.read(snapshot(), 'week', 'settings:2')).toMatchObject({ status: 'unavailable', text: null });
    expect(cache.size).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the digest when the token has not moved, as on a remount', async () => {
    const load = vi.fn(async () => available('AI text.'));
    const cache = createInsightDigestCache(load);

    await cache.generate(snapshot(), 'week', 'settings:4');

    expect(cache.read(snapshot(), 'week', 'settings:4')).toEqual(available('AI text.'));
    expect(cache.read(snapshot(), 'week', 'settings:4')).toEqual(available('AI text.'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });
});
