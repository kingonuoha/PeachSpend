import { describe, expect, it, vi } from 'vitest';
import type { AiProviderClient } from '../ai/contracts';
import type { Expense, Income } from '../types/database';
import type { InsightDataSource } from './InsightContracts';
import {
  buildInsightNarrative, dismissInsightDigest, generateInsightDigest, generatingInsightDigest,
  InsightDataService, resolveInsightPeriod, resolvePreviousInsightPeriod,
} from './InsightDataService';

const expense = (id: string, amount: number, date: number, category = 'dining', currency = 'CAD'): Expense => ({
  id, merchant: id, amount, currency, category, scanned: 0, date, created_at: date,
});

const income = (amount: number, date: number, currency = 'CAD'): Income => ({
  id: `income-${date}`, source: 'Employer', amount, currency, category: 'salary', date, created_at: date,
});

function source(expenses: Expense[], incomes: Income[] = [], settings: Record<string, string> = {}): InsightDataSource {
  return {
    getExpenses: vi.fn(async () => expenses),
    getIncomesForPeriod: vi.fn(async (start: number, end: number) => incomes.filter(item => item.date >= start && item.date <= end)),
    getSetting: vi.fn(async key => settings[key] ?? null),
  };
}

const clientReturning = (text: string): AiProviderClient => ({ provider: 'gemini', generate: vi.fn(async () => ({ text, provider: 'gemini' as const, model: 'm' })) });

describe('insight period resolution', () => {
  const wednesday = new Date(2026, 8, 16, 12).getTime();

  it('resolves week, month, all, and custom periods', () => {
    expect(resolveInsightPeriod({ timeframe: 'week' }, wednesday)).toEqual({
      start: new Date(2026, 8, 14).getTime(),
      end: new Date(2026, 8, 20, 23, 59, 59, 999).getTime(),
    });
    expect(resolveInsightPeriod({ timeframe: 'month' }, wednesday)).toEqual({
      start: new Date(2026, 8, 1).getTime(),
      end: new Date(2026, 8, 30, 23, 59, 59, 999).getTime(),
    });
    const all = resolveInsightPeriod({ timeframe: 'all' }, wednesday, new Date(2025, 0, 5).getTime());
    expect(all.start).toBe(new Date(2025, 0, 5).getTime());
    expect(all.end).toBe(wednesday);
    expect(resolveInsightPeriod({ timeframe: 'custom', customStart: 100, customEnd: 200 }, wednesday)).toEqual({ start: 100, end: 200 });
  });

  it('falls back to the current month for an invalid custom range', () => {
    expect(resolveInsightPeriod({ timeframe: 'custom', customStart: 500, customEnd: 100 }, wednesday)).toEqual(resolveInsightPeriod({ timeframe: 'month' }, wednesday));
  });

  it('compares week and custom against the immediately preceding window', () => {
    const week = resolveInsightPeriod({ timeframe: 'week' }, wednesday);
    expect(resolvePreviousInsightPeriod({ timeframe: 'week' }, week)).toEqual({ start: week.start - 7 * 86400000, end: week.start - 1 });
    const custom = { start: 1000, end: 1999 };
    expect(resolvePreviousInsightPeriod({ timeframe: 'custom' }, custom)).toEqual({ start: 1000 - 1000, end: 999 });
  });
});

describe('insight narrative', () => {
  it('produces a comparative statement from real data', () => {
    const narrative = buildInsightNarrative(120, 100, 4, 'CAD');
    expect(narrative.direction).toBe('up');
    expect(narrative.narrativeText).toContain('higher');
  });

  it('always produces a real statement even with no previous period', () => {
    const narrative = buildInsightNarrative(120, 0, 4, 'CAD');
    expect(narrative.direction).toBe('no_previous_data');
    expect(narrative.narrativeText).toContain('4 transactions');
  });
});

describe('InsightDataService snapshot', () => {
  it('computes real previous-period comparison, categories, and income vs expense totals', async () => {
    const now = new Date(2026, 8, 16, 12).getTime();
    const current = [expense('a', 60, new Date(2026, 8, 15).getTime(), 'dining'), expense('b', 40, new Date(2026, 8, 16).getTime(), 'transport')];
    const previous = [expense('c', 50, new Date(2026, 8, 9).getTime(), 'dining')];
    const service = new InsightDataService(source([...current, ...previous], [income(500, new Date(2026, 8, 15).getTime())], { currency: 'CAD' }));

    const snapshot = await service.getSnapshot({ timeframe: 'week' }, now);
    expect(snapshot.state).toBe('ready');
    expect(snapshot.totalSpent).toBe(100);
    expect(snapshot.totalIncome).toBe(500);
    expect(snapshot.netBalance).toBe(400);
    expect(snapshot.insight.previousTotal).toBe(50);
    expect(snapshot.insight.direction).toBe('up');
    expect(snapshot.insight.narrativeText).toBeTruthy();
    expect(snapshot.categories.map(category => category.category)).toEqual(['dining', 'transport']);
  });

  it('returns an honest empty state with a real zero narrative', async () => {
    const snapshot = await new InsightDataService(source([])).getSnapshot({ timeframe: 'month' }, Date.now());
    expect(snapshot.state).toBe('empty');
    expect(snapshot.insight.narrativeText).toBeTruthy();
  });

  it('reports offline and failure without fabricating a narrative', async () => {
    const offlineSource: InsightDataSource = { ...source([]), getExpenses: vi.fn(async () => { throw new TypeError('offline'); }) };
    const offline = await new InsightDataService(offlineSource).getSnapshot({ timeframe: 'month' });
    expect(offline.state).toBe('offline');
    expect(offline.refresh).toMatchObject({ status: 'failed', errorCode: 'offline' });
    expect(offline.insight.narrativeText).toBeNull();

    const failureSource: InsightDataSource = { ...source([]), getExpenses: vi.fn(async () => { throw new Error('db'); }) };
    const failure = await new InsightDataService(failureSource).getSnapshot({ timeframe: 'month' });
    expect(failure.state).toBe('failure');
    expect(failure.insight.narrativeText).toBeNull();
  });
});

describe('insight digest boundary', () => {
  const buildSnapshot = () => new InsightDataService(source([expense('a', 20, Date.now())], [], { currency: 'CAD' })).getSnapshot({ timeframe: 'week' }, Date.now());

  it('exposes generating and dismissed states', async () => {
    const snapshot = await buildSnapshot();
    const generating = generatingInsightDigest(snapshot.insight.narrativeText ?? '');
    expect(generating.status).toBe('generating');
    const dismissed = dismissInsightDigest({ ...generating, status: 'available', text: 'x', generatedAt: 1 });
    expect(dismissed.status).toBe('dismissed');
  });

  it('returns offline and missing-key outcomes while keeping the local text', async () => {
    const snapshot = await buildSnapshot();
    const offline = await generateInsightDigest(snapshot, { isConnected: false, provider: 'gemini', apiKey: 'k', model: 'm', client: clientReturning('ai') });
    expect(offline).toMatchObject({ status: 'unavailable', errorCode: 'offline', text: null });
    expect(offline.localText).toBe(snapshot.insight.narrativeText);
    const missing = await generateInsightDigest(snapshot, { isConnected: true, provider: 'openrouter', apiKey: null, model: 'm', client: clientReturning('ai') });
    expect(missing).toMatchObject({ status: 'unavailable', errorCode: 'missing_key' });
  });

  it('returns provider text on success and a typed failure otherwise', async () => {
    const snapshot = await buildSnapshot();
    const available = await generateInsightDigest(snapshot, { isConnected: true, provider: 'gemini', apiKey: 'k', model: 'm', client: clientReturning('Short summary.') });
    expect(available).toMatchObject({ status: 'available', text: 'Short summary.' });

    const failing: AiProviderClient = { provider: 'openrouter', generate: vi.fn(async () => { throw new TypeError('offline'); }) };
    const failed = await generateInsightDigest(snapshot, { isConnected: true, provider: 'openrouter', apiKey: 'k', model: 'm', client: failing });
    expect(failed).toMatchObject({ status: 'unavailable', errorCode: 'offline' });
    expect(failed.localText).toBe(snapshot.insight.narrativeText);
  });
});
