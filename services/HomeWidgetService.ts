import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Expense } from '../types/database';
import { normalizeCurrencyTotal } from '../data/currencyNormalization';
import { parseStoredBudget } from '../data/SettingsContracts';
import { formatCurrency, resolveCurrency, resolveDisplayCurrency } from '../utils/currency';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export const WIDGET_AMOUNT_MASK = '••••••';

export interface HomeWidgetSnapshotPayload {
  monthSpentText: string;
  todaySpentText: string;
  zeroAmountText: string;
  snapshotDate: string;
  pricesHidden: boolean;
  hasBudget: boolean;
  budgetPercent: number;
  budgetStatusText: string;
  streakDays: number;
  unreadAlertsCount: number;
  updatedAt: number;
}

export interface HomeWidgetDataSource {
  getExpensesForPeriod(startDate: number, endDate: number): Promise<Expense[]>;
  getSetting(key: string): Promise<string | null>;
  getStreak(): Promise<number>;
  getUnreadNotificationCount(): Promise<number>;
}

export interface NativeHomeWidgetModule {
  updateSnapshot?(payload: HomeWidgetSnapshotPayload): Promise<boolean>;
  clearSnapshot?(): Promise<boolean>;
  requestPinWidget?(): Promise<boolean>;
}

export function formatLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthRange(now: number): { start: number; end: number } {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

function getDayRange(now: number): { start: number; end: number } {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
  return { start, end };
}

function resolveBudgetCap(
  rawBudget: number,
  budgetCurrency: string | null,
  displayCurrency: string,
  rates: string | null,
): number {
  if (rawBudget <= 0) return 0;
  const sourceCurrency = resolveCurrency(budgetCurrency, displayCurrency);
  if (sourceCurrency === displayCurrency) return rawBudget;
  const normalized = normalizeCurrencyTotal(
    [{ amount: rawBudget, currency: sourceCurrency }],
    displayCurrency,
    rates,
  );
  return normalized.complete && normalized.total > 0 ? normalized.total : 0;
}

export async function buildHomeWidgetSnapshot(
  source: HomeWidgetDataSource,
  now = Date.now(),
): Promise<HomeWidgetSnapshotPayload> {
  const monthRange = getMonthRange(now);
  const dayRange = getDayRange(now);

  const [
    monthExpenses,
    currencySetting,
    pricesVisibleSetting,
    monthlyBudgetSetting,
    budgetCurrencySetting,
    ratesSetting,
    streak,
    unreadCount,
  ] = await Promise.all([
    source.getExpensesForPeriod(monthRange.start, monthRange.end),
    source.getSetting('currency'),
    source.getSetting('prices_visible'),
    source.getSetting('monthly_budget'),
    source.getSetting('budget_currency'),
    source.getSetting('conversion_rates'),
    source.getStreak(),
    source.getUnreadNotificationCount(),
  ]);

  const displayCurrency = resolveDisplayCurrency(currencySetting, monthExpenses[0]?.currency);
  const monthSpent = normalizeCurrencyTotal(
    monthExpenses.map(expense => ({ amount: expense.amount, currency: expense.currency })),
    displayCurrency,
    ratesSetting,
  ).total;
  const todayExpenses = monthExpenses.filter(
    expense => expense.date >= dayRange.start && expense.date <= dayRange.end,
  );
  const todaySpent = normalizeCurrencyTotal(
    todayExpenses.map(expense => ({ amount: expense.amount, currency: expense.currency })),
    displayCurrency,
    ratesSetting,
  ).total;

  const pricesHidden = pricesVisibleSetting === 'false';
  const zeroAmountText = formatCurrency(0, displayCurrency);
  const monthSpentText = pricesHidden ? WIDGET_AMOUNT_MASK : formatCurrency(monthSpent, displayCurrency);
  const todaySpentText = pricesHidden ? WIDGET_AMOUNT_MASK : formatCurrency(todaySpent, displayCurrency);

  const rawBudget = parseStoredBudget(monthlyBudgetSetting);
  const cap = resolveBudgetCap(rawBudget, budgetCurrencySetting, displayCurrency, ratesSetting);
  const hasBudget = cap > 0;
  const budgetPercent = hasBudget ? Math.max(0, Math.round((monthSpent / cap) * 100)) : 0;
  const budgetStatusText = !hasBudget
    ? 'No budget set'
    : budgetPercent >= 100
      ? 'Over budget'
      : `${budgetPercent}% of budget`;

  return {
    monthSpentText,
    todaySpentText,
    zeroAmountText,
    snapshotDate: formatLocalDateKey(now),
    pricesHidden,
    hasBudget,
    budgetPercent,
    budgetStatusText,
    streakDays: Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0,
    unreadAlertsCount: Number.isFinite(unreadCount) ? Math.max(0, Math.floor(unreadCount)) : 0,
    updatedAt: now,
  };
}

export function getNativeHomeWidgetModule(): NativeHomeWidgetModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireOptionalNativeModule<NativeHomeWidgetModule>('ExpoHomeWidget') ?? null;
  } catch {
    return null;
  }
}

export interface HomeWidgetCoordinator {
  syncNow(now?: number): Promise<boolean>;
  clearSnapshot(): Promise<boolean>;
  requestPinWidget(): Promise<boolean>;
}

export function createHomeWidgetCoordinator(deps: {
  source: HomeWidgetDataSource;
  getNativeModule: () => NativeHomeWidgetModule | null;
  now?: () => number;
}): HomeWidgetCoordinator {
  let inFlight: Promise<boolean> | null = null;
  let pending = false;

  const executeSync = async (timestamp: number): Promise<boolean> => {
    const native = deps.getNativeModule();
    if (!native || typeof native.updateSnapshot !== 'function') return false;
    try {
      const payload = await buildHomeWidgetSnapshot(deps.source, timestamp);
      return Boolean(await native.updateSnapshot(payload));
    } catch {
      logger.warn('Home widget sync failed', 'home_widget_sync_failed');
      return false;
    }
  };

  const syncNow = (explicitNow?: number): Promise<boolean> => {
    const native = deps.getNativeModule();
    if (!native || typeof native.updateSnapshot !== 'function') {
      return Promise.resolve(false);
    }
    if (inFlight) {
      pending = true;
      return inFlight;
    }
    const run = async (): Promise<boolean> => {
      let result = false;
      try {
        result = await executeSync(explicitNow ?? (deps.now ? deps.now() : Date.now()));
        while (pending) {
          pending = false;
          result = await executeSync(deps.now ? deps.now() : Date.now());
        }
      } finally {
        inFlight = null;
        pending = false;
      }
      return result;
    };
    inFlight = run();
    return inFlight;
  };

  const clearSnapshot = async (): Promise<boolean> => {
    const native = deps.getNativeModule();
    if (!native || typeof native.clearSnapshot !== 'function') return false;
    try {
      return Boolean(await native.clearSnapshot());
    } catch {
      return false;
    }
  };

  const requestPinWidget = async (): Promise<boolean> => {
    const native = deps.getNativeModule();
    if (!native || typeof native.requestPinWidget !== 'function') return false;
    try {
      return Boolean(await native.requestPinWidget());
    } catch {
      return false;
    }
  };

  return { syncNow, clearSnapshot, requestPinWidget };
}

const defaultCoordinator = createHomeWidgetCoordinator({
  source: databaseService,
  getNativeModule: getNativeHomeWidgetModule,
});

export function syncHomeWidgetSnapshot(now?: number): Promise<boolean> {
  return defaultCoordinator.syncNow(now);
}

export function clearHomeWidgetSnapshot(): Promise<boolean> {
  return defaultCoordinator.clearSnapshot();
}

export function requestPinHomeWidget(): Promise<boolean> {
  return defaultCoordinator.requestPinWidget();
}
