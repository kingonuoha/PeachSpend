import { normalizeAiError } from '../ai/contracts';
import { formatCurrency, resolveDisplayCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';
import { buildCategories, buildComparativeInsight } from './HomeDataService';
import type { HomeComparativeInsight, HomePeriod } from './HomeContracts';
import type {
  InsightComparativeNarrative, InsightDataSource, InsightDigest, InsightDigestContext,
  InsightsSnapshot, InsightTimeframeQuery,
} from './InsightContracts';

const DAY_MS = 86_400_000;

function startOfDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfWeek(value: number): number {
  const date = new Date(startOfDay(value));
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function calendarMonth(value: number): HomePeriod {
  const date = new Date(value);
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime(),
  };
}

function previousCalendarMonth(period: HomePeriod): HomePeriod {
  const date = new Date(period.start);
  return {
    start: new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(),
    end: period.start - 1,
  };
}

// Resolves the selected timeframe into a concrete period. `earliestExpenseDate`
// is only needed for the "all" timeframe, which spans from the first record to
// now; without it, all-time falls back to the current month so the snapshot is
// still well defined.
export function resolveInsightPeriod(query: InsightTimeframeQuery, now: number, earliestExpenseDate?: number): HomePeriod {
  switch (query.timeframe) {
    case 'week': {
      const start = startOfWeek(now);
      return { start, end: start + 7 * DAY_MS - 1 };
    }
    case 'all': {
      const start = earliestExpenseDate ? startOfDay(earliestExpenseDate) : calendarMonth(now).start;
      return { start, end: now };
    }
    case 'custom': {
      const { customStart, customEnd } = query;
      if (Number.isFinite(customStart) && Number.isFinite(customEnd) && (customStart as number) <= (customEnd as number)) {
        return { start: customStart as number, end: customEnd as number };
      }
      return calendarMonth(now);
    }
    case 'month':
    default:
      return calendarMonth(now);
  }
}

// Week and month compare against the calendar-previous period, matching what the
// user sees as "last week" or "last month". Custom and all compare against the
// immediately preceding window of the same length, which is the only honest
// comparison available for an arbitrary range.
export function resolvePreviousInsightPeriod(query: InsightTimeframeQuery, period: HomePeriod): HomePeriod {
  if (query.timeframe === 'week') {
    const length = period.end - period.start + 1;
    return { start: period.start - length, end: period.start - 1 };
  }
  if (query.timeframe === 'month') return previousCalendarMonth(period);
  const length = period.end - period.start + 1;
  return { start: period.start - length, end: period.start - 1 };
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

// Wraps the shared comparison helper and guarantees a real statement whenever
// there is real data. When there is no previous period, the fallback describes
// the current period factually instead of leaving the block empty.
export function buildInsightNarrative(
  currentTotal: number,
  previousTotal: number,
  transactionCount: number,
  currency: string,
): InsightComparativeNarrative {
  const base: HomeComparativeInsight = buildComparativeInsight(currentTotal, previousTotal);
  const narrativeText = base.localText
    ?? `You tracked ${transactionCount} ${pluralize(transactionCount, 'transaction')} totalling ${formatCurrency(currentTotal, currency)} in this period.`;
  return { ...base, narrativeText };
}

function emptyInsight(): InsightComparativeNarrative {
  return { ...buildComparativeInsight(0, 0), narrativeText: null };
}

export class InsightDataService {
  constructor(private readonly source: InsightDataSource) {}

  async getSnapshot(query: InsightTimeframeQuery, now = Date.now()): Promise<InsightsSnapshot> {
    let userCurrency: string | null = null;
    try {
      const [expenses, currency, rates] = await Promise.all([
        this.source.getExpenses(),
        this.source.getSetting('currency'),
        this.source.getSetting('conversion_rates'),
      ]);
      userCurrency = currency;
      const earliest = expenses.reduce<number | undefined>(
        (min, expense) => (min === undefined || expense.date < min ? expense.date : min),
        undefined,
      );
      const period = resolveInsightPeriod(query, now, earliest);
      const previousPeriod = resolvePreviousInsightPeriod(query, period);
      const current = expenses.filter(expense => expense.date >= period.start && expense.date <= period.end);
      const previous = expenses.filter(expense => expense.date >= previousPeriod.start && expense.date <= previousPeriod.end);
      const displayCurrency = resolveDisplayCurrency(currency, current[0]?.currency);
      const spent = normalizeCurrencyTotal(current.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates);
      const incomes = await this.source.getIncomesForPeriod(period.start, period.end);
      const earned = normalizeCurrencyTotal(incomes.map(income => ({ amount: income.amount, currency: income.currency })), displayCurrency, rates);
      const previousTotal = normalizeCurrencyTotal(previous.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates).total;
      const missingRates = [...new Set([...spent.missingRates, ...earned.missingRates])];
      return {
        state: expenses.length === 0 ? 'empty' : 'ready',
        timeframe: query.timeframe,
        period,
        previousPeriod,
        totalSpent: spent.total,
        totalIncome: earned.total,
        netBalance: earned.total - spent.total,
        transactionCount: current.length,
        currency: displayCurrency,
        categories: buildCategories(current, displayCurrency, rates),
        insight: buildInsightNarrative(spent.total, previousTotal, current.length, displayCurrency),
        normalization: { complete: missingRates.length === 0, missingRates },
        generatedAt: now,
        refresh: { status: 'idle' },
      };
    } catch (error) {
      const isOffline = error instanceof TypeError;
      return {
        state: isOffline ? 'offline' : 'failure',
        timeframe: query.timeframe,
        period: { start: now, end: now },
        previousPeriod: { start: now, end: now },
        totalSpent: 0,
        totalIncome: 0,
        netBalance: 0,
        transactionCount: 0,
        currency: resolveDisplayCurrency(userCurrency),
        categories: [],
        insight: emptyInsight(),
        normalization: { complete: false, missingRates: [] },
        generatedAt: now,
        refresh: { status: 'failed', errorCode: isOffline ? 'offline' : 'failure' },
      };
    }
  }
}

export function generatingInsightDigest(localText: string): InsightDigest {
  return { status: 'generating', text: null, localText, generatedAt: null, retryable: false };
}

export function dismissInsightDigest(digest: InsightDigest): InsightDigest {
  return { ...digest, status: 'dismissed' };
}

// Generation boundary for the FR-03.2 digest. Offline and missing-key are
// explicit typed outcomes, and a provider failure keeps the local text so the
// card degrades to a real local summary instead of disappearing.
export async function generateInsightDigest(
  snapshot: InsightsSnapshot,
  context: InsightDigestContext,
): Promise<InsightDigest> {
  const localText = snapshot.insight.narrativeText ?? '';
  if (!context.isConnected) {
    return { status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'offline', retryable: true };
  }
  if (!context.apiKey) {
    return { status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'missing_key', retryable: false };
  }
  try {
    const prompt = [
      `Write one short, non-judgmental sentence about this ${snapshot.timeframe} spending period.`,
      `Total spent: ${snapshot.totalSpent} ${snapshot.currency}.`,
      `Total earned: ${snapshot.totalIncome} ${snapshot.currency}.`,
      'Do not invent any number, category, or date that is not listed. Return only the sentence.',
    ].join(' ');
    const response = await context.client.generate({ feature: 'narrative_insight', model: context.model, prompt }, context.apiKey);
    const text = response.text.trim();
    if (!text) return { status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'invalid_response', retryable: true };
    return { status: 'available', text, localText, generatedAt: Date.now(), retryable: false };
  } catch (error) {
    const normalized = normalizeAiError(error, context.provider);
    return { status: 'unavailable', text: null, localText, generatedAt: null, errorCode: normalized.code, retryable: normalized.retryable };
  }
}
