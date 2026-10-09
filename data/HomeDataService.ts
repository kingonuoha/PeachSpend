import { geminiClient, openRouterClient } from '../ai/providerClients';
import { normalizeAiError, type AiProvider } from '../ai/contracts';
import type { Expense } from '../types/database';
import { resolveDisplayCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';
import type {
  HomeCategorySnapshot, HomeComparativeInsight, HomeDataSource, HomePeriod, HomeSnapshot,
} from './HomeContracts';

function getPeriod(now: number): HomePeriod {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

function getPreviousPeriod(period: HomePeriod): HomePeriod {
  const start = new Date(period.start);
  const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1).getTime();
  return { start: previousStart, end: period.start - 1 };
}

function sumExpenses(expenses: Expense[], displayCurrency: string, rates: string | null): number {
  return normalizeCurrencyTotal(expenses.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates).total;
}

export function buildComparativeInsight(currentTotal: number, previousTotal: number): HomeComparativeInsight {
  const changeAmount = currentTotal - previousTotal;
  const hasPreviousData = previousTotal > 0;
  const changePercent = hasPreviousData ? (changeAmount / previousTotal) * 100 : null;
  const direction = !hasPreviousData ? 'no_previous_data' : changeAmount > 0 ? 'up' : changeAmount < 0 ? 'down' : 'unchanged';
  const localText = direction === 'no_previous_data'
    ? null
    : direction === 'unchanged' ? 'Spending matches previous period.'
      : `Spending is ${Math.abs(changePercent ?? 0).toFixed(0)}% ${direction === 'up' ? 'higher' : 'lower'} than previous period.`;
  return { currentTotal, previousTotal, changeAmount, changePercent, direction, localText, aiText: null, aiState: 'not_requested' };
}

export function buildCategories(expenses: Expense[], displayCurrency: string, rates: string | null): HomeCategorySnapshot[] {
  const groups = new Map<string, number>();
  const categoryEntries = new Map<string, { amount: number; currency: string }[]>();
  for (const expense of expenses) {
    const entries = categoryEntries.get(expense.category) ?? [];
    entries.push({ amount: expense.amount, currency: expense.currency });
    categoryEntries.set(expense.category, entries);
  }
  for (const [category, entries] of categoryEntries) {
    groups.set(category, normalizeCurrencyTotal(entries, displayCurrency, rates).total);
  }
  const total = [...groups.values()].reduce((sum, value) => sum + value, 0);
  return [...groups.entries()]
    .map(([category, categoryTotal]) => ({
      category,
      total: categoryTotal,
      transactionCount: categoryEntries.get(category)?.length ?? 0,
      share: total > 0 ? categoryTotal / total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export class HomeDataService {
  constructor(private readonly source: HomeDataSource) {}

  async getSnapshot(now = Date.now()): Promise<HomeSnapshot> {
    const period = getPeriod(now);
    let userCurrency: string | null = null;
    try {
      const [expenses, currency, amountsVisible, incomes, streak, unreadNotificationCount, rates] = await Promise.all([
        this.source.getExpenses(), this.source.getSetting('currency'), this.source.getSetting('prices_visible'),
        this.source.getIncomesForPeriod(period.start, period.end), this.source.getStreak(), this.source.getUnreadNotificationCount(),
        this.source.getSetting('conversion_rates'),
      ]);
      userCurrency = currency;
      const previousPeriod = getPreviousPeriod(period);
      const current = expenses.filter(expense => expense.date >= period.start && expense.date <= period.end);
      const previous = expenses.filter(expense => expense.date >= previousPeriod.start && expense.date <= previousPeriod.end);
      const displayCurrency = resolveDisplayCurrency(currency, current[0]?.currency);
      const spentTotal = normalizeCurrencyTotal(current.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates);
      const totalSpent = spentTotal.total;
      const incomeTotal = normalizeCurrencyTotal(incomes.map(income => ({ amount: income.amount, currency: income.currency })), displayCurrency, rates);
      const missingRates = [...new Set([...spentTotal.missingRates, ...incomeTotal.missingRates])];
      return {
        state: expenses.length === 0 ? 'empty' : 'ready', refreshedAt: now, period,
         hero: { totalSpent, incomeTotal: incomeTotal.total, transactionCount: current.length, currency: displayCurrency, visibility: amountsVisible === 'false' ? 'hidden' : 'visible' },
        comparativeInsight: buildComparativeInsight(totalSpent, sumExpenses(previous, displayCurrency, rates)),
        recentTransactions: [...expenses].sort((a, b) => b.date - a.date).slice(0, 5),
        categories: buildCategories(current, displayCurrency, rates), streak: { days: streak, hasActivity: streak > 0 }, unreadNotificationCount,
        refresh: { status: 'idle' },
        normalization: { complete: missingRates.length === 0, missingRates },
      };
    } catch (error) {
      const isOffline = error instanceof TypeError;
      return { state: isOffline ? 'offline' : 'failure', refreshedAt: now, period,
         hero: { totalSpent: 0, incomeTotal: 0, transactionCount: 0, currency: resolveDisplayCurrency(userCurrency), visibility: 'hidden' },
        comparativeInsight: buildComparativeInsight(0, 0), recentTransactions: [], categories: [], streak: { days: 0, hasActivity: false }, unreadNotificationCount: 0,
        refresh: { status: 'failed', errorCode: isOffline ? 'offline' : 'failure' },
        normalization: { complete: false, missingRates: [] } };
    }
  }

  async getAiComparativeInsight(snapshot: HomeSnapshot, isConnected: boolean): Promise<HomeSnapshot> {
    if (!isConnected) return { ...snapshot, comparativeInsight: { ...snapshot.comparativeInsight, aiState: 'offline' } };
    const providerSetting = await this.source.getSetting('home_ai_provider');
    const provider: AiProvider = providerSetting === 'openrouter' ? 'openrouter' : 'gemini';
    const key = provider === 'gemini' ? await this.source.getSecret?.('gemini_api_key') : await this.source.getSecret?.('chat_openrouter_api_key');
    if (!key) return { ...snapshot, comparativeInsight: { ...snapshot.comparativeInsight, aiState: 'failed' } };
    try {
      const client = provider === 'gemini' ? geminiClient : openRouterClient;
      const model = provider === 'gemini' ? 'gemini-2.5-flash' : await this.source.getSetting('home_openrouter_model') ?? 'openrouter/auto';
      const response = await client.generate({ feature: 'narrative_insight', model, prompt: `Give one short comparison of current spending ${snapshot.comparativeInsight.currentTotal} versus previous spending ${snapshot.comparativeInsight.previousTotal}. Do not add facts.` }, key);
      return { ...snapshot, comparativeInsight: { ...snapshot.comparativeInsight, aiText: response.text.trim() || null, aiState: 'ready' } };
    } catch (error) {
      normalizeAiError(error, provider);
      return { ...snapshot, comparativeInsight: { ...snapshot.comparativeInsight, aiState: 'failed' } };
    }
  }
}
