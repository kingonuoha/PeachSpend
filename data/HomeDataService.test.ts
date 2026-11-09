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

// F-06. Home used to scan the whole expenses table to compute two monthly totals.
// The period read is bounded to the current and previous month. These cases pin
// both halves: the range the snapshot asks for when the source can serve it, and
// the totals that must not move because of the narrowing.
describe('HomeDataService period range query (F-06)', () => {
  const now = new Date(2026, 8, 19, 12).getTime();
  const monthStart = new Date(2026, 8, 1).getTime();
  const monthEnd = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();
  const previousStart = new Date(2026, 7, 1).getTime();

  const current = expense('current', 20, new Date(2026, 8, 5).getTime(), 'dining');
  const previous = expense('previous', 30, new Date(2026, 7, 10).getTime(), 'transport');
  const older = expense('older', 999, new Date(2026, 4, 10).getTime(), 'dining');
  const future = expense('future', 888, new Date(2026, 9, 10).getTime(), 'dining');
  const all = [current, previous, older, future];

  const inRange = (start: number, end: number) => all.filter(item => item.date >= start && item.date <= end);

  it('asks for the current and previous period in one bounded range', async () => {
    const getExpenses = vi.fn(async () => all);
    const getExpensesForPeriod = vi.fn(async (start: number, end: number) => inRange(start, end));
    const service = new HomeDataService({ ...source(all), getExpenses, getExpensesForPeriod });

    const snapshot = await service.getSnapshot(now);

    expect(getExpensesForPeriod).toHaveBeenCalledTimes(1);
    expect(getExpensesForPeriod).toHaveBeenCalledWith(previousStart, monthEnd);
    // One period read only. This source has no bounded recent read, so the recent
    // fallback reads the full ledger once rather than reusing the period list, which
    // is the pre-row meaning and the F-09 fix.
    expect(getExpenses).toHaveBeenCalledTimes(1);
    expect(snapshot.period).toEqual({ start: monthStart, end: monthEnd });
  });

  it('falls back to the whole ledger when the source has no period read', async () => {
    const getExpenses = vi.fn(async () => all);
    const service = new HomeDataService({ ...source(all), getExpenses });

    const snapshot = await service.getSnapshot(now);

    expect(getExpenses).toHaveBeenCalledTimes(1);
    expect(snapshot.hero.totalSpent).toBe(20);
  });

  it('keeps the current and previous period totals identical to the unranged read', async () => {
    const ranged = await new HomeDataService({
      ...source(all),
      getExpensesForPeriod: vi.fn(async (start: number, end: number) => inRange(start, end)),
    }).getSnapshot(now);
    const unranged = await new HomeDataService(source(all)).getSnapshot(now);

    expect(ranged.hero).toEqual(unranged.hero);
    expect(ranged.comparativeInsight).toEqual(unranged.comparativeInsight);
    expect(ranged.categories).toEqual(unranged.categories);
    expect(ranged.normalization).toEqual(unranged.normalization);

    // 999 and 888 sit outside both periods and must not reach either total.
    expect(ranged.hero.totalSpent).toBe(20);
    expect(ranged.comparativeInsight.previousTotal).toBe(30);
    expect(ranged.comparativeInsight.direction).toBe('down');
    // The recent list is not part of the period narrowing. This source has no bounded
    // recent read, so it falls back to the full ledger, which is the pre-row meaning
    // and keeps the out-of-period rows the card is meant to show.
    expect(ranged.recentTransactions.map(item => item.id)).toEqual(['future', 'current', 'previous', 'older']);
  });
});

// F-09, F-10. The recent list is its own bounded read, so it must not be a slice of
// the period range: a record older than the previous period or newer than the current
// one still belongs in it, and the card must not report an empty ledger for a user
// whose newest records sit outside both periods.
describe('HomeDataService recent list independent of the period range (F-09, F-10)', () => {
  const now = new Date(2026, 8, 19, 12).getTime();
  const monthEnd = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();

  const current = expense('current', 20, new Date(2026, 8, 5).getTime(), 'dining');
  const previous = expense('previous', 30, new Date(2026, 7, 10).getTime(), 'transport');
  const older = expense('older', 999, new Date(2026, 4, 10).getTime(), 'dining');
  const future = expense('future', 888, new Date(2026, 9, 10).getTime(), 'dining');
  const all = [current, previous, older, future];

  const inRange = (start: number, end: number) => all.filter(item => item.date >= start && item.date <= end);
  const newest = (rows: Expense[], limit: number) => [...rows].sort((a, b) => b.date - a.date).slice(0, limit);

  const rangedSource = (recent: Expense[] = all) => ({
    ...source(all),
    getExpensesForPeriod: vi.fn(async (start: number, end: number) => inRange(start, end)),
    getRecentExpenses: vi.fn(async (limit: number) => newest(recent, limit)),
  });

  it('keeps records outside the period range in the recent list', async () => {
    const getRecentExpenses = vi.fn(async (limit: number) => newest(all, limit));
    const snapshot = await new HomeDataService({ ...rangedSource(), getRecentExpenses }).getSnapshot(now);

    expect(getRecentExpenses).toHaveBeenCalledTimes(1);
    // Five is the card's limit, asked for in SQL rather than sliced from the ledger.
    expect(getRecentExpenses).toHaveBeenCalledWith(5);
    // `future` is newer than the period end, `older` is older than the previous
    // period start, and both are still real recent records.
    expect(snapshot.recentTransactions.map(item => item.id)).toEqual(['future', 'current', 'previous', 'older']);
    expect(snapshot.period.end).toBe(monthEnd);
  });

  it('orders the recent list date descending and holds it to the limit', async () => {
    const many = [
      ...all,
      expense('e1', 1, new Date(2026, 3, 1).getTime()),
      expense('e2', 2, new Date(2026, 2, 1).getTime()),
      expense('e3', 3, new Date(2026, 1, 1).getTime()),
    ];
    const snapshot = await new HomeDataService({
      ...rangedSource(),
      // A source that ignores the limit must not make the card render more rows.
      getRecentExpenses: vi.fn(async () => many),
    }).getSnapshot(now);

    const dates = snapshot.recentTransactions.map(item => item.date);
    expect(dates).toEqual([...dates].sort((left, right) => right - left));
    expect(snapshot.recentTransactions).toHaveLength(5);
  });

  it('keeps the period aggregates on the narrowed range', async () => {
    const snapshot = await new HomeDataService(rangedSource()).getSnapshot(now);

    // 999 and 888 sit outside both periods and must not reach either total, even
    // though both are in the recent list.
    expect(snapshot.hero.totalSpent).toBe(20);
    expect(snapshot.hero.transactionCount).toBe(1);
    expect(snapshot.comparativeInsight.previousTotal).toBe(30);
    expect(snapshot.categories.map(category => category.category)).toEqual(['dining']);
    expect(snapshot.categories[0]?.total).toBe(20);
  });

  it('preserves the pre-row meaning for a source without the bounded recent read', async () => {
    const getExpenses = vi.fn(async () => all);
    const fallback = await new HomeDataService({
      ...source(all),
      getExpenses,
      getExpensesForPeriod: vi.fn(async (start: number, end: number) => inRange(start, end)),
    }).getSnapshot(now);
    const bounded = await new HomeDataService(rangedSource()).getSnapshot(now);

    expect(getExpenses).toHaveBeenCalledTimes(1);
    expect(fallback.recentTransactions).toEqual(bounded.recentTransactions);
    expect(fallback.hero).toEqual(bounded.hero);
    expect(fallback.comparativeInsight).toEqual(bounded.comparativeInsight);
  });
});

describe('buildComparativeInsight', () => {
  it('supports refresh-safe comparison states', () => {
    expect(buildComparativeInsight(120, 100)).toMatchObject({ changeAmount: 20, changePercent: 20, direction: 'up' });
    expect(buildComparativeInsight(100, 100).direction).toBe('unchanged');
    expect(buildComparativeInsight(100, 0).direction).toBe('no_previous_data');
  });
});
