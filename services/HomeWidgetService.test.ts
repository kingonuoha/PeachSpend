import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import {
  WIDGET_AMOUNT_MASK,
  buildHomeWidgetSnapshot,
  createHomeWidgetCoordinator,
  formatLocalDateKey,
  syncHomeWidgetSnapshot,
  type HomeWidgetDataSource,
  type HomeWidgetSnapshotPayload,
} from './HomeWidgetService';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
}));

vi.mock('./DatabaseService', () => ({
  databaseService: {},
}));

const NOW = new Date(2026, 10, 12, 14, 30, 0, 0).getTime();
const YESTERDAY = new Date(2026, 10, 11, 18, 0, 0, 0).getTime();

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    merchant: 'Grocery Hub',
    amount: 2500,
    currency: 'NGN',
    category: 'groceries',
    note: '',
    scanned: 0,
    date: NOW,
    created_at: NOW,
    ...overrides,
  };
}

function createMemorySource(options: {
  expenses?: Expense[];
  settings?: Record<string, string>;
  streak?: number;
  unreadCount?: number;
} = {}): HomeWidgetDataSource {
  const settings = options.settings ?? {};
  return {
    getExpensesForPeriod: async () => options.expenses ?? [],
    getSetting: async key => (key in settings ? settings[key] : null),
    getStreak: async () => options.streak ?? 0,
    getUnreadNotificationCount: async () => options.unreadCount ?? 0,
  };
}

describe('HomeWidgetService', () => {
  it('formats month and today spend via formatCurrency, sets zeroAmountText, and reports unset budget honestly', async () => {
    const source = createMemorySource({
      expenses: [
        makeExpense({ id: 'e1', amount: 1500, currency: 'USD', date: NOW }),
        makeExpense({ id: 'e2', amount: 3500, currency: 'USD', date: YESTERDAY }),
      ],
      settings: {
        currency: 'USD',
        prices_visible: 'true',
      },
      streak: 5,
      unreadCount: 2,
    });

    const snapshot = await buildHomeWidgetSnapshot(source, NOW);
    expect(snapshot.monthSpentText).toBe('$5,000');
    expect(snapshot.todaySpentText).toBe('$1,500');
    expect(snapshot.zeroAmountText).toBe('$0');
    expect(snapshot.snapshotDate).toBe(formatLocalDateKey(NOW));
    expect(snapshot.pricesHidden).toBe(false);
    expect(snapshot.hasBudget).toBe(false);
    expect(snapshot.budgetPercent).toBe(0);
    expect(snapshot.budgetStatusText).toBe('No budget set');
    expect(snapshot.streakDays).toBe(5);
    expect(snapshot.unreadAlertsCount).toBe(2);
  });

  it('computes budget percentage and over-budget status using parseStoredBudget and currency normalization', async () => {
    const sourceOnTrack = createMemorySource({
      expenses: [makeExpense({ amount: 420, currency: 'EUR', date: NOW })],
      settings: {
        currency: 'EUR',
        monthly_budget: '1000',
        budget_currency: 'EUR',
      },
    });
    const onTrack = await buildHomeWidgetSnapshot(sourceOnTrack, NOW);
    expect(onTrack.hasBudget).toBe(true);
    expect(onTrack.budgetPercent).toBe(42);
    expect(onTrack.budgetStatusText).toBe('42% of budget');
    expect(onTrack.zeroAmountText).toBe('€0');

    const sourceOver = createMemorySource({
      expenses: [makeExpense({ amount: 1200, currency: 'EUR', date: NOW })],
      settings: {
        currency: 'EUR',
        monthly_budget: '1000',
        budget_currency: 'EUR',
      },
    });
    const over = await buildHomeWidgetSnapshot(sourceOver, NOW);
    expect(over.hasBudget).toBe(true);
    expect(over.budgetPercent).toBe(120);
    expect(over.budgetStatusText).toBe('Over budget');
  });

  it('masks month and today spend as •••••• when prices_visible is false while keeping zeroAmountText formatted for rollover', async () => {
    const source = createMemorySource({
      expenses: [makeExpense({ amount: 7500, currency: 'NGN', date: NOW })],
      settings: {
        currency: 'NGN',
        prices_visible: 'false',
        monthly_budget: '20000',
      },
    });

    const snapshot = await buildHomeWidgetSnapshot(source, NOW);
    expect(snapshot.pricesHidden).toBe(true);
    expect(snapshot.monthSpentText).toBe(WIDGET_AMOUNT_MASK);
    expect(snapshot.todaySpentText).toBe(WIDGET_AMOUNT_MASK);
    expect(snapshot.zeroAmountText).toBe('₦0');
    expect(snapshot.budgetStatusText).toBe('38% of budget');
  });

  it('produces zeroAmountText and snapshotDate for day rollover when today has no expenses', async () => {
    const source = createMemorySource({
      expenses: [makeExpense({ amount: 42.5, currency: 'GBP', date: YESTERDAY })],
      settings: { currency: 'GBP' },
    });

    const snapshot = await buildHomeWidgetSnapshot(source, NOW);
    expect(snapshot.monthSpentText).toBe('£42.50');
    expect(snapshot.todaySpentText).toBe('£0');
    expect(snapshot.zeroAmountText).toBe('£0');
    expect(snapshot.snapshotDate).toBe(formatLocalDateKey(NOW));
  });

  it('degrades cleanly as a no-op when native module is unavailable', async () => {
    const coordinator = createHomeWidgetCoordinator({
      source: createMemorySource(),
      getNativeModule: () => null,
    });

    expect(await coordinator.syncNow(NOW)).toBe(false);
    expect(await coordinator.clearSnapshot()).toBe(false);
    expect(await coordinator.requestPinWidget()).toBe(false);
    expect(await syncHomeWidgetSnapshot(NOW)).toBe(false);
  });

  it('coalesces concurrent sync requests and delivers the latest snapshot to the native module', async () => {
    const pushed: HomeWidgetSnapshotPayload[] = [];
    const deferred: { release: (() => void) | null } = { release: null };
    let callCount = 0;

    const source: HomeWidgetDataSource = {
      getExpensesForPeriod: () => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<Expense[]>(resolve => {
            deferred.release = () => resolve([makeExpense({ amount: 100, currency: 'USD', date: NOW })]);
          });
        }
        return Promise.resolve([makeExpense({ amount: 250, currency: 'USD', date: NOW })]);
      },
      getSetting: async key => (key === 'currency' ? 'USD' : null),
      getStreak: async () => 1,
      getUnreadNotificationCount: async () => 0,
    };

    const coordinator = createHomeWidgetCoordinator({
      source,
      getNativeModule: () => ({
        updateSnapshot: async payload => {
          pushed.push(payload);
          return true;
        },
      }),
      now: () => NOW,
    });

    const first = coordinator.syncNow(NOW);
    const second = coordinator.syncNow(NOW);
    const third = coordinator.syncNow(NOW);

    // Wait a tick so the first read reaches the deferred expense query.
    await new Promise(resolve => setTimeout(resolve, 0));
    deferred.release?.();

    const results = await Promise.all([first, second, third]);
    expect(results).toEqual([true, true, true]);
    expect(pushed).toHaveLength(2);
    expect(pushed[0]?.monthSpentText).toBe('$100');
    expect(pushed[1]?.monthSpentText).toBe('$250');
  });
});
