import { describe, expect, it, vi } from 'vitest';
import type { Expense, Income } from '../types/database';
import { buildComparativeInsight, HomeDataService } from './HomeDataService';
import type { HomeDataSource } from './HomeContracts';

const expense = (id: string, amount: number, date: number, category = 'dining'): Expense => ({
  id, merchant: id, amount, currency: 'CAD', category, scanned: 0, date, created_at: date,
});

function source(expenses: Expense[], settings: Record<string, string> = {}, incomeTotal = 0): HomeDataSource {
  const incomeCurrency = settings.currency ?? 'CAD';
  const incomes: Income[] = incomeTotal === 0 ? [] : [{ id: 'income', source: 'Employer', amount: incomeTotal, currency: incomeCurrency, category: 'salary', date: 1, created_at: 1 }];
  return {
    getExpenses: vi.fn(async () => expenses),
    getSetting: vi.fn(async key => settings[key] ?? null),
    getIncomeForPeriod: vi.fn(async () => incomeTotal),
    getIncomesForPeriod: vi.fn(async () => incomes),
    getStreak: vi.fn(async () => 3),
    getUnreadNotificationCount: vi.fn(async () => 2),
  };
}

describe('HomeDataService', () => {
  it('returns honest empty state without sample financial content', async () => {
    const result = await new HomeDataService(source([])).getSnapshot(new Date(2026, 8, 19).getTime());
    expect(result.state).toBe('empty');
    expect(result.hero.totalSpent).toBe(0);
    expect(result.hero.incomeTotal).toBe(0);
    expect(result.recentTransactions).toEqual([]);
    expect(result.comparativeInsight.localText).toBeNull();
    expect(result.refresh.status).toBe('idle');
    expect(result.hero.currency).toBe('NGN');
  });

  it('uses selected currency and preserves record currency in recent transactions', async () => {
    const record = expense('record', 20, new Date(2026, 8, 19).getTime());
    const result = await new HomeDataService(source([record], { currency: 'EUR' })).getSnapshot(record.date);
    expect(result.hero.currency).toBe('EUR');
    expect(result.recentTransactions[0].currency).toBe('CAD');
  });

  it('computes populated hero, categories, recent transactions and notifications', async () => {
    const now = new Date(2026, 8, 19, 12).getTime();
    const expenses = [expense('current', 20, now, 'dining'), expense('older', 10, now - 86400000 * 40, 'transport')];
    const result = await new HomeDataService(source(expenses, { currency: 'CAD', prices_visible: 'true' }, 500)).getSnapshot(now);
    expect(result.state).toBe('ready');
    expect(result.hero).toMatchObject({ totalSpent: 20, incomeTotal: 500, transactionCount: 1, currency: 'CAD', visibility: 'visible' });
    expect(result.categories[0]).toMatchObject({ category: 'dining', total: 20, share: 1 });
    expect(result.recentTransactions[0].id).toBe('current');
    expect(result.unreadNotificationCount).toBe(2);
  });

  it('folds the period income total into the typed hero snapshot', async () => {
    const now = Date.now();
    const result = await new HomeDataService(source([expense('one', 20, now)], {}, 120)).getSnapshot(now);
    expect(result.hero.incomeTotal).toBe(120);
    expect(result.hero.totalSpent).toBe(20);
  });

  it('keeps hidden amount state while retaining typed records', async () => {
    const result = await new HomeDataService(source([expense('one', 20, Date.now())], { prices_visible: 'false' })).getSnapshot();
    expect(result.hero.visibility).toBe('hidden');
    expect(result.hero.totalSpent).toBe(20);
  });

  it('reads the app-wide prices_visible key and ignores the dead home_amounts_visible key', async () => {
    const now = Date.now();
    const legacy = await new HomeDataService(source([expense('one', 20, now)], { home_amounts_visible: 'false' })).getSnapshot(now);
    expect(legacy.hero.visibility).toBe('visible');
    const aligned = await new HomeDataService(source([expense('one', 20, now)], { prices_visible: 'false' })).getSnapshot(now);
    expect(aligned.hero.visibility).toBe('hidden');
  });

  it('normalizes mixed-currency period totals through the shared layer', async () => {
    const now = new Date(2026, 8, 19, 12).getTime();
    const cad = expense('cad', 100, now);
    const usd: Expense = { ...expense('usd', 10, now), currency: 'USD' };
    const result = await new HomeDataService(source([cad, usd], { currency: 'CAD', conversion_rates: JSON.stringify({ CAD: 1, USD: 1.4 }) })).getSnapshot(now);
    expect(result.hero.totalSpent).toBeCloseTo(114);
    expect(result.normalization).toEqual({ complete: true, missingRates: [] });
  });

  it('excludes amounts with no usable rate and reports them instead of summing at par', async () => {
    const now = new Date(2026, 8, 19, 12).getTime();
    const cad = expense('cad', 100, now);
    const eur: Expense = { ...expense('eur', 10, now), currency: 'EUR' };
    const result = await new HomeDataService(source([cad, eur], { currency: 'CAD', conversion_rates: JSON.stringify({ CAD: 1 }) })).getSnapshot(now);
    expect(result.hero.totalSpent).toBe(100);
    expect(result.normalization).toEqual({ complete: false, missingRates: ['EUR'] });
  });

  it('reports offline and AI failure without inventing insight text', async () => {
    const offlineSource: HomeDataSource = { ...source([]), getExpenses: vi.fn(async () => { throw new TypeError('offline'); }) };
    const offline = await new HomeDataService(offlineSource).getSnapshot();
    expect(offline.state).toBe('offline');
    expect(offline.refresh).toMatchObject({ status: 'failed', errorCode: 'offline' });
    expect(offline.hero.incomeTotal).toBe(0);

    const service = new HomeDataService(source([expense('one', 20, Date.now())], { currency: 'CAD' }));
    const snapshot = await service.getSnapshot();
    const failedAi = await service.getAiComparativeInsight(snapshot, false);
    expect(failedAi.comparativeInsight.aiState).toBe('offline');
    expect(failedAi.comparativeInsight.aiText).toBeNull();
  });
});

describe('buildComparativeInsight', () => {
  it('supports refresh-safe comparison states', () => {
    expect(buildComparativeInsight(120, 100)).toMatchObject({ changeAmount: 20, changePercent: 20, direction: 'up' });
    expect(buildComparativeInsight(100, 100).direction).toBe('unchanged');
    expect(buildComparativeInsight(100, 0).direction).toBe('no_previous_data');
  });
});
