import type { Expense } from '../types/database';
import { formatCurrency, resolveDisplayCurrency } from '../utils/currency';
import { buildComparisonChart, buildDonutChart, type ChatChartSpec } from './chatCharts';

// Phase 11 D7. The local analytical answer path for chat.
//
// This module answers a small, fixed set of analytical questions from the user's own
// ledger with plain reads and no network call of any kind. It imports no provider
// client and its port has no secret accessor, so neither a request nor a key read is
// possible on this path: with no connection or no key configured, chat can still
// answer these instead of showing an error card.
//
// Anything this module does not recognise is reported as `cannot_answer`. It never
// guesses at an intent and never returns a total it did not read, which is the whole
// difference between degrading honestly and inventing an answer.

export type LocalAnswerIntent =
  | 'week_total'
  | 'month_total'
  | 'category_breakdown'
  | 'recent_expenses'
  | 'period_comparison';

export type LocalAnswerUnavailableReason =
  // The question is not one of the supported analytics, so it needs a remote answer.
  | 'unsupported_question'
  // The question is supported but the ledger has nothing to show for it.
  | 'no_data';

// The read port. DatabaseService satisfies it structurally, so the resolver adds no
// second reader and no SQL of its own. There is deliberately no secret or provider
// member here: a key read is impossible by construction.
export interface LocalAnswerPort {
  getSetting(key: string): Promise<string | null>;
  getMonthlySummary(startDate: number, endDate: number): Promise<{ totalSpent: number; expenseCount: number }>;
  getExpensesByCategoryInRange(startDate: number, endDate: number): Promise<{ category: string; total: number }[]>;
  getRecentExpenses(limit: number): Promise<Expense[]>;
  getCategories(): Promise<{ id: string; title: string }[]>;
}

// One row a chat card can render and open, in the same shape the S-08 route already
// takes. `category` stays the stored id; the surface resolves its title the way it
// already does for every other expense row.
export interface LocalAnswerExpense {
  expenseId: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  date: number;
  route: { screen: 'S-08'; id: string };
}

export type LocalAnswer =
  | {
      status: 'answered';
      intent: LocalAnswerIntent;
      // Ready to render as the assistant bubble body. Amounts go through the shared
      // formatter, so the symbol and the grouping come from data.
      text: string;
      // The same chart contract the surface renders for a remote answer. Null when
      // the intent has no chart (a total, for example).
      chart: ChatChartSpec | null;
      // Populated for `recent_expenses` only, empty for every other intent.
      expenses: LocalAnswerExpense[];
    }
  | { status: 'cannot_answer'; reason: LocalAnswerUnavailableReason };

export const LOCAL_ANSWER_RECENT_LIMIT = 5;
const DAY_MS = 86_400_000;

function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function localAnswerWeekRange(now: number): { start: number; end: number } {
  const start = startOfLocalDay(now) - 6 * DAY_MS;
  return { start, end: start + 7 * DAY_MS - 1 };
}

export function localAnswerMonthRange(now: number): { start: number; end: number } {
  const date = new Date(now);
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime(),
  };
}

export function localAnswerPreviousMonthRange(now: number): { start: number; end: number } {
  const date = new Date(now);
  return {
    start: new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(),
    end: new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999).getTime(),
  };
}

function localAnswerPreviousWeekRange(now: number): { start: number; end: number } {
  const current = localAnswerWeekRange(now);
  return { start: current.start - 7 * DAY_MS, end: current.start - 1 };
}

function isWeekQuestion(lower: string): boolean {
  return /\b(this week|last week|past week|last 7 days|week)\b/.test(lower);
}

// Ordered, and every literal is lowercase because the input is lowercased first.
// The order is the disambiguation: a comparison question mentions a period, and a
// category question mentions spending, so both are matched before the period totals.
export function classifyLocalQuestion(question: string): LocalAnswerIntent | null {
  const lower = question.toLowerCase();
  if (/\b(compare|compared|versus)\b|\bvs\b|difference between|more than (last|previous)/.test(lower)) return 'period_comparison';
  if (/by category|category breakdown|breakdown|categories|where did my money go/.test(lower)) return 'category_breakdown';
  if (/recent|latest|newest|last few|show .*(expenses|transactions)|what did i spend/.test(lower)) return 'recent_expenses';
  if (/\b(this week|past week|last 7 days|week so far)\b/.test(lower)) return 'week_total';
  if (/\b(this month|current month|month so far|last 30 days|past month)\b/.test(lower)) return 'month_total';
  return null;
}

function toLocalAnswerExpense(expense: Expense): LocalAnswerExpense {
  return {
    expenseId: expense.id,
    merchant: expense.merchant,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    date: expense.date,
    route: { screen: 'S-08', id: expense.id },
  };
}

function categoryLabel(categoryId: string, titles: Map<string, string>): string {
  // Falls back to the stored id rather than inventing a prettier name for a category
  // that has no row, so a label always traces to data.
  return titles.get(categoryId) ?? categoryId;
}

export async function answerLocalQuestion(
  port: LocalAnswerPort,
  question: string,
  now = Date.now(),
): Promise<LocalAnswer> {
  const intent = classifyLocalQuestion(question);
  if (!intent) return { status: 'cannot_answer', reason: 'unsupported_question' };

  const currency = resolveDisplayCurrency(await port.getSetting('currency'));

  if (intent === 'recent_expenses') {
    const recent = await port.getRecentExpenses(LOCAL_ANSWER_RECENT_LIMIT);
    if (recent.length === 0) return { status: 'cannot_answer', reason: 'no_data' };
    const lines = recent.map(expense => `${expense.merchant} ${formatCurrency(expense.amount, expense.currency, currency)}`);
    const opening = recent.length === 1 ? 'Your most recent expense' : `Your ${recent.length} most recent expenses`;
    return {
      status: 'answered',
      intent,
      text: `${opening}: ${lines.join(', ')}.`,
      chart: null,
      expenses: recent.map(toLocalAnswerExpense),
    };
  }

  if (intent === 'category_breakdown') {
    const range = localAnswerMonthRange(now);
    const totals = await port.getExpensesByCategoryInRange(range.start, range.end);
    const positive = totals.filter(row => Number.isFinite(row.total) && row.total > 0).sort((a, b) => b.total - a.total);
    if (positive.length === 0) return { status: 'cannot_answer', reason: 'no_data' };
    const categories = await port.getCategories();
    const titles = new Map(categories.map(category => [category.id, category.title]));
    const data = positive.map(row => ({ label: categoryLabel(row.category, titles), value: row.total }));
    const led = data[0];
    return {
      status: 'answered',
      intent,
      text: `This month you spent ${formatCurrency(led.value, currency)} in ${led.label}, across ${data.length} ${data.length === 1 ? 'category' : 'categories'}.`,
      chart: buildDonutChart('Spending by Category', currency, data),
      expenses: [],
    };
  }

  if (intent === 'period_comparison') {
    const week = isWeekQuestion(question.toLowerCase());
    const currentRange = week ? localAnswerWeekRange(now) : localAnswerMonthRange(now);
    const previousRange = week ? localAnswerPreviousWeekRange(now) : localAnswerPreviousMonthRange(now);
    const currentLabel = week ? 'This Week' : 'This Month';
    const previousLabel = week ? 'Last Week' : 'Last Month';
    const [current, previous] = await Promise.all([
      port.getMonthlySummary(currentRange.start, currentRange.end),
      port.getMonthlySummary(previousRange.start, previousRange.end),
    ]);
    // A zero total is a real answer, so this intent answers even on an empty ledger.
    const comparison = previous.totalSpent > 0
      ? `${previousLabel} was ${formatCurrency(previous.totalSpent, currency)}.`
      : `${previousLabel} had no recorded spending.`;
    return {
      status: 'answered',
      intent,
      text: `${currentLabel} you spent ${formatCurrency(current.totalSpent, currency)} across ${current.expenseCount} ${current.expenseCount === 1 ? 'expense' : 'expenses'}. ${comparison}`,
      chart: buildComparisonChart('Spending Comparison', currency, { label: currentLabel, value: current.totalSpent }, { label: previousLabel, value: previous.totalSpent }),
      expenses: [],
    };
  }

  const range = intent === 'week_total' ? localAnswerWeekRange(now) : localAnswerMonthRange(now);
  const summary = await port.getMonthlySummary(range.start, range.end);
  const label = intent === 'week_total' ? 'This week' : 'This month';
  return {
    status: 'answered',
    intent,
    text: `${label} you spent ${formatCurrency(summary.totalSpent, currency)} across ${summary.expenseCount} ${summary.expenseCount === 1 ? 'expense' : 'expenses'}.`,
    chart: null,
    expenses: [],
  };
}
