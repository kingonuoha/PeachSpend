import { resolveDisplayCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';
import type { CurrencyRateMap } from './contracts';
import { buildCategories } from './HomeDataService';
import type { Expense } from '../types/database';
import type { HomePeriod } from './HomeContracts';
import type {
  SpendingRecapAffirmation, SpendingRecapCadence, SpendingRecapDataSource,
  SpendingRecapHighlight, SpendingRecapRead, SpendingRecapSeriesPoint, SpendingRecapSnapshot,
} from './RecapContracts';

const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A chart needs at least two populated buckets to read as a cadence. Below that
// the series is empty rather than a row of fake zero bars.
const MIN_POPULATED_BUCKETS = 2;

function startOfDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

interface SeriesBucket {
  label: string;
  start: number;
  end: number;
}

function weeklyBuckets(period: HomePeriod): SeriesBucket[] {
  const start = startOfDay(period.start);
  return Array.from({ length: 7 }, (_, index) => {
    const dayStart = start + index * DAY_MS;
    return {
      label: WEEKDAY_LABELS[new Date(dayStart).getDay()],
      start: dayStart,
      end: Math.min(dayStart + DAY_MS - 1, period.end),
    };
  });
}

function monthlyBuckets(period: HomePeriod): SeriesBucket[] {
  const start = startOfDay(period.start);
  const days = Math.round((startOfDay(period.end) - start) / DAY_MS) + 1;
  const bucketCount = Math.max(1, Math.ceil(days / 7));
  return Array.from({ length: bucketCount }, (_, index) => ({
    label: `W${index + 1}`,
    start: start + index * 7 * DAY_MS,
    end: Math.min(start + (index + 1) * 7 * DAY_MS - 1, period.end),
  }));
}

function bucketTotal(expenses: Expense[], start: number, end: number, displayCurrency: string, rates: CurrencyRateMap | string | null | undefined): number {
  const inRange = expenses
    .filter(expense => expense.date >= start && expense.date <= end)
    .map(expense => ({ amount: expense.amount, currency: expense.currency }));
  return normalizeCurrencyTotal(inRange, displayCurrency, rates).total;
}

// Bounded per-period series for the recap micro chart. Weekly is seven real day
// buckets; monthly is week-of-month buckets (four to six depending on the
// month). Values come only from real expenses, normalized through the one shared
// currency layer. No bucket is padded or fabricated, and `isPeak` is set only on
// a bucket that actually holds spending.
export function buildRecapSeries(
  cadence: SpendingRecapCadence,
  period: HomePeriod,
  expenses: Expense[],
  displayCurrency: string,
  rates: CurrencyRateMap | string | null | undefined,
): SpendingRecapSeriesPoint[] {
  const buckets = cadence === 'weekly' ? weeklyBuckets(period) : monthlyBuckets(period);
  const points = buckets.map(bucket => ({
    label: bucket.label,
    value: bucketTotal(expenses, bucket.start, bucket.end, displayCurrency, rates),
    isPeak: false,
  }));
  const populated = points.filter(point => point.value > 0).length;
  if (populated < MIN_POPULATED_BUCKETS) return [];
  let peakIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].value > points[peakIndex].value) peakIndex = index;
  }
  return points.map((point, index) => ({ ...point, isPeak: index === peakIndex }));
}


// Weekly recap covers the trailing seven days ending now; monthly recap covers
// the current calendar month, matching Home's period so the two never disagree.
export function resolveRecapPeriod(cadence: SpendingRecapCadence, now: number): HomePeriod {
  if (cadence === 'weekly') {
    const start = startOfDay(now) - 6 * DAY_MS;
    return { start, end: now };
  }
  const date = new Date(now);
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime(),
  };
}

export function resolvePreviousRecapPeriod(period: HomePeriod): HomePeriod {
  const length = period.end - period.start + 1;
  return { start: period.start - length, end: period.start - 1 };
}

// Descriptive and neutral by construction. "Higher" is a direction, not a
// rebuke, and there is no branch that says the user failed or overspent.
export function buildRecapHighlight(currentTotal: number, previousTotal: number): SpendingRecapHighlight {
  const changeAmount = currentTotal - previousTotal;
  const hasPrevious = previousTotal > 0;
  const changePercent = hasPrevious ? (changeAmount / previousTotal) * 100 : null;
  const direction = !hasPrevious ? 'no_previous_data' : changeAmount > 0 ? 'up' : changeAmount < 0 ? 'down' : 'unchanged';
  const text = direction === 'no_previous_data'
    ? 'Here is where this period went.'
    : direction === 'unchanged'
      ? 'Spending is level with the previous period.'
      : `Spending is ${Math.abs(changePercent ?? 0).toFixed(0)}% ${direction === 'up' ? 'higher' : 'lower'} than the previous period.`;
  return { direction, currentTotal, previousTotal, changeAmount, changePercent, text };
}

// Always produces a real, affirming value so the recap closes on a positive note
// even when spending was high (FR-23.4). The screen turns kind + value into copy.
export function buildRecapAffirmation(
  streak: number,
  totalEarned: number,
  currency: string,
  transactionCount: number,
): SpendingRecapAffirmation {
  if (streak > 0) return { kind: 'streak_days', value: streak };
  if (totalEarned > 0) return { kind: 'income_logged', value: totalEarned, currency };
  return { kind: 'transactions_tracked', value: transactionCount };
}

export class RecapDataService {
  constructor(private readonly source: SpendingRecapDataSource) {}

  async getRecap(cadence: SpendingRecapCadence, now = Date.now()): Promise<SpendingRecapRead> {
    try {
      const [expenses, currency, rates, streak] = await Promise.all([
        this.source.getExpenses(),
        this.source.getSetting('currency'),
        this.source.getSetting('conversion_rates'),
        this.source.getStreak(),
      ]);
      if (expenses.length === 0) return { state: 'empty', snapshot: null };

      const period = resolveRecapPeriod(cadence, now);
      const previousPeriod = resolvePreviousRecapPeriod(period);
      const current = expenses.filter(expense => expense.date >= period.start && expense.date <= period.end);
      const previous = expenses.filter(expense => expense.date >= previousPeriod.start && expense.date <= previousPeriod.end);
      if (current.length === 0) return { state: 'empty', snapshot: null };

      const displayCurrency = resolveDisplayCurrency(currency, current[0]?.currency);
      const spent = normalizeCurrencyTotal(current.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates);
      const incomes = await this.source.getIncomesForPeriod(period.start, period.end);
      const earned = normalizeCurrencyTotal(incomes.map(income => ({ amount: income.amount, currency: income.currency })), displayCurrency, rates);
      const previousTotal = normalizeCurrencyTotal(previous.map(expense => ({ amount: expense.amount, currency: expense.currency })), displayCurrency, rates).total;
      const categories = buildCategories(current, displayCurrency, rates);
      const series = buildRecapSeries(cadence, period, current, displayCurrency, rates);
      const missingRates = [...new Set([...spent.missingRates, ...earned.missingRates])];

      const snapshot: SpendingRecapSnapshot = {
        cadence,
        period,
        totalSpent: spent.total,
        totalEarned: earned.total,
        transactionCount: current.length,
        biggestCategory: categories[0] ?? null,
        comparativeHighlight: buildRecapHighlight(spent.total, previousTotal),
        affirmation: buildRecapAffirmation(streak, earned.total, displayCurrency, current.length),
        series,
        currency: displayCurrency,
        generatedAt: now,
        normalization: { complete: missingRates.length === 0, missingRates },
      };
      return { state: 'ready', snapshot };
    } catch (error) {
      const isOffline = error instanceof TypeError;
      return { state: isOffline ? 'offline' : 'failure', snapshot: null, errorCode: isOffline ? 'offline' : 'failure' };
    }
  }
}
