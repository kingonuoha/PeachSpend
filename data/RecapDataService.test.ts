import { describe, expect, it, vi } from 'vitest';
import type { Expense, Income } from '../types/database';
import type { HomePeriod } from './HomeContracts';
import type { SpendingRecapDataSource } from './RecapContracts';
import {
  buildRecapAffirmation, buildRecapHighlight, buildRecapSeries, RecapDataService, resolveRecapPeriod,
} from './RecapDataService';

const expense = (id: string, amount: number, date: number, category = 'dining', currency = 'CAD'): Expense => ({
  id, merchant: id, amount, currency, category, scanned: 0, date, created_at: date,
});

const income = (amount: number, date: number, currency = 'CAD'): Income => ({
  id: `income-${date}`, source: 'Employer', amount, currency, category: 'salary', date, created_at: date,
});

function source(expenses: Expense[], incomes: Income[] = [], settings: Record<string, string> = {}, streak = 0): SpendingRecapDataSource {
  return {
    getExpenses: vi.fn(async () => expenses),
    getIncomesForPeriod: vi.fn(async (start: number, end: number) => incomes.filter(item => item.date >= start && item.date <= end)),
    getSetting: vi.fn(async key => settings[key] ?? null),
    getStreak: vi.fn(async () => streak),
  };
}

describe('recap period and copy primitives', () => {
  it('resolves weekly as a trailing seven days and monthly as the calendar month', () => {
    const now = new Date(2026, 8, 16, 12).getTime();
    expect(resolveRecapPeriod('weekly', now)).toEqual({ start: new Date(2026, 8, 10).getTime(), end: now });
    expect(resolveRecapPeriod('monthly', now)).toEqual({ start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 30, 23, 59, 59, 999).getTime() });
  });

  it('keeps comparative copy neutral, with no failure or guilt statement', () => {
    const highlight = buildRecapHighlight(1000, 500);
    expect(highlight.direction).toBe('up');
    expect(highlight.text.toLowerCase()).not.toContain('over');
    expect(highlight.text.toLowerCase()).not.toContain('fail');
    expect(buildRecapHighlight(0, 0).direction).toBe('no_previous_data');
  });

  it('always resolves an affirming close value', () => {
    expect(buildRecapAffirmation(4, 100, 'CAD', 3)).toEqual({ kind: 'streak_days', value: 4 });
    expect(buildRecapAffirmation(0, 100, 'CAD', 3)).toEqual({ kind: 'income_logged', value: 100, currency: 'CAD' });
    expect(buildRecapAffirmation(0, 0, 'CAD', 3)).toEqual({ kind: 'transactions_tracked', value: 3 });
  });
});

describe('recap series (D7 supporting chart)', () => {
  const week: HomePeriod = { start: new Date(2026, 8, 14).getTime(), end: new Date(2026, 8, 20, 23, 59, 59, 999).getTime() };
  const month: HomePeriod = { start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 30, 23, 59, 59, 999).getTime() };

  it('builds seven real day buckets for a weekly recap and marks the true peak', () => {
    const series = buildRecapSeries('weekly', week, [
      expense('mon', 20, new Date(2026, 8, 14, 12).getTime()),
      expense('wed', 10, new Date(2026, 8, 16, 12).getTime()),
      expense('fri', 50, new Date(2026, 8, 18, 12).getTime()),
    ], 'CAD', null);

    expect(series.map(point => point.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(series.map(point => point.value)).toEqual([20, 0, 10, 0, 50, 0, 0]);
    expect(series.find(point => point.isPeak)?.label).toBe('Fri');
    expect(series.filter(point => point.isPeak)).toHaveLength(1);
  });

  it('builds bounded week-of-month buckets for a monthly recap', () => {
    const series = buildRecapSeries('monthly', month, [
      expense('w1', 10, new Date(2026, 8, 3, 12).getTime()),
      expense('w3', 40, new Date(2026, 8, 17, 12).getTime()),
    ], 'CAD', null);

    expect(series.map(point => point.label)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5']);
    expect(series.find(point => point.isPeak)?.label).toBe('W3');
  });

  it('returns an empty series for no spend or a single populated bucket instead of fake zero bars', () => {
    expect(buildRecapSeries('weekly', week, [], 'CAD', null)).toEqual([]);
    expect(buildRecapSeries('weekly', week, [expense('solo', 20, new Date(2026, 8, 14, 12).getTime())], 'CAD', null)).toEqual([]);
  });

  it('normalizes mixed-currency buckets through the shared layer', () => {
    const series = buildRecapSeries('weekly', week, [
      expense('cad', 100, new Date(2026, 8, 14, 12).getTime(), 'dining', 'CAD'),
      expense('usd', 10, new Date(2026, 8, 18, 12).getTime(), 'dining', 'USD'),
    ], 'CAD', JSON.stringify({ CAD: 1, USD: 1.4 }));

    expect(series[0].value).toBeCloseTo(100);
    expect(series[4].value).toBeCloseTo(14);
    expect(series[0].isPeak).toBe(true);
  });
});

describe('RecapDataService', () => {
  it('derives weekly totals, biggest category, and a highlight from real expenses and income', async () => {
    const now = new Date(2026, 8, 16, 12).getTime();
    const service = new RecapDataService(source(
      [expense('a', 60, new Date(2026, 8, 15).getTime(), 'dining'), expense('b', 40, new Date(2026, 8, 16).getTime(), 'transport')],
      [income(200, new Date(2026, 8, 15).getTime())],
      { currency: 'CAD' },
      5,
    ));

    const read = await service.getRecap('weekly', now);
    expect(read.state).toBe('ready');
    expect(read.snapshot).toMatchObject({
      cadence: 'weekly', totalSpent: 100, totalEarned: 200, transactionCount: 2,
      affirmation: { kind: 'streak_days', value: 5 },
      currency: 'CAD',
    });
    expect(read.snapshot?.biggestCategory?.category).toBe('dining');
    // The contract owns numbers, never a guilt label.
    expect(read.snapshot && 'overspent' in read.snapshot).toBe(false);
    expect(read.snapshot?.series).toHaveLength(7);
    expect(read.snapshot?.series.filter(point => point.isPeak)).toHaveLength(1);
  });

  it('returns an empty series on a low-data period instead of faking bars', async () => {
    const now = new Date(2026, 8, 16, 12).getTime();
    const service = new RecapDataService(source([expense('solo', 20, new Date(2026, 8, 15).getTime())], [], { currency: 'CAD' }));
    const read = await service.getRecap('weekly', now);
    expect(read.state).toBe('ready');
    expect(read.snapshot?.series).toEqual([]);
  });

  it('returns an empty read when there is nothing to recap', async () => {
    const read = await new RecapDataService(source([])).getRecap('monthly', Date.now());
    expect(read).toEqual({ state: 'empty', snapshot: null });
  });

  it('reports offline and failure without a fabricated snapshot', async () => {
    const offlineSource: SpendingRecapDataSource = { ...source([]), getExpenses: vi.fn(async () => { throw new TypeError('offline'); }) };
    const offline = await new RecapDataService(offlineSource).getRecap('weekly');
    expect(offline).toMatchObject({ state: 'offline', snapshot: null, errorCode: 'offline' });

    const failureSource: SpendingRecapDataSource = { ...source([]), getExpenses: vi.fn(async () => { throw new Error('db'); }) };
    const failure = await new RecapDataService(failureSource).getRecap('weekly');
    expect(failure).toMatchObject({ state: 'failure', snapshot: null, errorCode: 'failure' });
  });
});
