import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import {
  answerLocalQuestion, classifyLocalQuestion, localAnswerMonthRange, localAnswerPreviousMonthRange,
  localAnswerWeekRange, LOCAL_ANSWER_RECENT_LIMIT, type LocalAnswerPort,
} from './localAnswers';

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime();
const MONTH = localAnswerMonthRange(NOW);
const PREVIOUS_MONTH = localAnswerPreviousMonthRange(NOW);
const WEEK = localAnswerWeekRange(NOW);

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'e1', merchant: 'Cafe', amount: 20, currency: 'USD', category: 'dining',
  scanned: 0, date: NOW, created_at: NOW, ...overrides,
});

interface PortCalls {
  summary: { start: number; end: number }[];
  categories: { start: number; end: number }[];
  recent: number[];
  settings: string[];
}

function port(overrides: Partial<LocalAnswerPort> = {}) {
  const calls: PortCalls = { summary: [], categories: [], recent: [], settings: [] };
  const summaryByRange = new Map<string, { totalSpent: number; expenseCount: number }>();
  const categoriesByRange = new Map<string, { category: string; total: number }[]>();

  const base: LocalAnswerPort = {
    async getSetting(key) {
      calls.settings.push(key);
      return 'USD';
    },
    async getMonthlySummary(start, end) {
      calls.summary.push({ start, end });
      return summaryByRange.get(`${start}-${end}`) ?? { totalSpent: 0, expenseCount: 0 };
    },
    async getExpensesByCategoryInRange(start, end) {
      calls.categories.push({ start, end });
      return categoriesByRange.get(`${start}-${end}`) ?? [];
    },
    async getRecentExpenses(limit) {
      calls.recent.push(limit);
      return [];
    },
    async getCategories() {
      return [{ id: 'dining', title: 'Dining' }, { id: 'groceries', title: 'Groceries' }];
    },
  };

  const answers: LocalAnswerPort = { ...base, ...overrides };
  return {
    calls,
    port: answers,
    setSummary: (start: number, end: number, value: { totalSpent: number; expenseCount: number }) => summaryByRange.set(`${start}-${end}`, value),
    setCategories: (start: number, end: number, value: { category: string; total: number }[]) => categoriesByRange.set(`${start}-${end}`, value),
  };
}

describe('local answer intent classification', () => {
  it('recognises the five supported analytics', () => {
    expect(classifyLocalQuestion('How much did I spend this week?')).toBe('week_total');
    expect(classifyLocalQuestion('How much did I spend this month?')).toBe('month_total');
    expect(classifyLocalQuestion('Show my spending by category')).toBe('category_breakdown');
    expect(classifyLocalQuestion('Show my recent expenses')).toBe('recent_expenses');
    expect(classifyLocalQuestion('Compare this month to last month')).toBe('period_comparison');
  });

  it('matches lowercase words only, so a differently cased question still classifies', () => {
    expect(classifyLocalQuestion('HOW MUCH DID I SPEND THIS MONTH')).toBe('month_total');
    expect(classifyLocalQuestion('What did I spend recently?')).toBe('recent_expenses');
  });

  it('returns nothing for a question it cannot answer from the ledger', () => {
    expect(classifyLocalQuestion('What is my budget?')).toBeNull();
    expect(classifyLocalQuestion('Hello')).toBeNull();
    expect(classifyLocalQuestion('How am I doing?')).toBeNull();
    expect(classifyLocalQuestion('')).toBeNull();
  });

  it('matches a comparison before the period it mentions', () => {
    expect(classifyLocalQuestion('this month versus last month')).toBe('period_comparison');
  });
});

describe('local answer periods', () => {
  it('covers today and the six days before it for the week', () => {
    // Asserted as bounds rather than as a local calendar date, so the test holds in a
    // timezone with a daylight saving transition inside the window.
    expect(WEEK.end - WEEK.start).toBe(7 * 86_400_000 - 1);
    expect(WEEK.start).toBeLessThanOrEqual(NOW);
    expect(WEEK.end).toBeGreaterThanOrEqual(NOW);
  });

  it('covers the calendar month and the one before it', () => {
    expect(new Date(MONTH.start).getDate()).toBe(1);
    expect(new Date(MONTH.start).getMonth()).toBe(9);
    expect(new Date(PREVIOUS_MONTH.start).getMonth()).toBe(8);
    expect(PREVIOUS_MONTH.start).toBeLessThan(PREVIOUS_MONTH.end);
    expect(PREVIOUS_MONTH.end).toBeLessThan(MONTH.start);
  });
});

describe('local answer resolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers the week total from the week range', async () => {
    const { port: readPort, calls, setSummary } = port();
    setSummary(WEEK.start, WEEK.end, { totalSpent: 125.5, expenseCount: 4 });

    const answer = await answerLocalQuestion(readPort, 'How much did I spend this week?', NOW);

    expect(answer).toMatchObject({ status: 'answered', intent: 'week_total', chart: null, expenses: [] });
    expect(answer.status === 'answered' && answer.text).toBe('This week you spent $125.50 across 4 expenses.');
    expect(calls.summary).toEqual([{ start: WEEK.start, end: WEEK.end }]);
  });

  it('answers the month total from the month range', async () => {
    const { port: readPort, calls, setSummary } = port();
    setSummary(MONTH.start, MONTH.end, { totalSpent: 900, expenseCount: 1 });

    const answer = await answerLocalQuestion(readPort, 'How much did I spend this month?', NOW);

    expect(answer.status === 'answered' && answer.text).toBe('This month you spent $900 across 1 expense.');
    expect(calls.summary).toEqual([{ start: MONTH.start, end: MONTH.end }]);
  });

  it('answers a category breakdown with the chart contract the chat already renders', async () => {
    const { port: readPort, setCategories } = port();
    setCategories(MONTH.start, MONTH.end, [
      { category: 'dining', total: 300 },
      { category: 'groceries', total: 120 },
      { category: 'other', total: 0 },
    ]);

    const answer = await answerLocalQuestion(readPort, 'Show my spending by category', NOW);

    expect(answer.status).toBe('answered');
    if (answer.status !== 'answered') return;
    expect(answer.intent).toBe('category_breakdown');
    expect(answer.chart).toEqual({
      kind: 'donut',
      title: 'Spending by Category',
      currency: 'USD',
      data: [{ label: 'Dining', value: 300 }, { label: 'Groceries', value: 120 }],
    });
    expect(answer.text).toBe('This month you spent $300 in Dining, across 2 categories.');
  });

  it('answers recent expenses as rows that open the detail route', async () => {
    const { port: readPort, calls } = port({
      getRecentExpenses: async () => [expense({ id: 'e7', merchant: 'Kiosk', amount: 3.5 })],
    });

    const answer = await answerLocalQuestion(readPort, 'Show my recent expenses', NOW);

    expect(calls.recent).toEqual([]);
    expect(answer.status).toBe('answered');
    if (answer.status !== 'answered') return;
    expect(answer.expenses).toEqual([{
      expenseId: 'e7',
      merchant: 'Kiosk',
      amount: 3.5,
      currency: 'USD',
      category: 'dining',
      date: NOW,
      route: { screen: 'S-08', id: 'e7' },
    }]);
    expect(answer.text).toBe('Your most recent expense: Kiosk $3.50.');
  });

  it('asks for a bounded recent list rather than the whole ledger', async () => {
    const recent = vi.fn(async () => [expense()]);
    const { port: readPort } = port({ getRecentExpenses: recent });

    await answerLocalQuestion(readPort, 'Show my recent expenses', NOW);

    expect(recent).toHaveBeenCalledWith(LOCAL_ANSWER_RECENT_LIMIT);
  });

  it('compares the month against the previous month with a comparison chart', async () => {
    const { port: readPort, setSummary } = port();
    setSummary(MONTH.start, MONTH.end, { totalSpent: 500, expenseCount: 6 });
    setSummary(PREVIOUS_MONTH.start, PREVIOUS_MONTH.end, { totalSpent: 400, expenseCount: 5 });

    const answer = await answerLocalQuestion(readPort, 'Compare this month to last month', NOW);

    expect(answer.status).toBe('answered');
    if (answer.status !== 'answered') return;
    expect(answer.text).toBe('This Month you spent $500 across 6 expenses. Last Month was $400.');
    expect(answer.chart).toEqual({
      kind: 'bar',
      title: 'Spending Comparison',
      currency: 'USD',
      data: [{ label: 'This Month', value: 500 }, { label: 'Last Month', value: 400 }],
    });
  });

  it('compares weeks when the question names a week', async () => {
    const { port: readPort, calls, setSummary } = port();
    setSummary(WEEK.start, WEEK.end, { totalSpent: 60, expenseCount: 2 });

    const answer = await answerLocalQuestion(readPort, 'Compare this week to last week', NOW);

    expect(answer.status).toBe('answered');
    if (answer.status !== 'answered') return;
    expect(answer.text).toContain('This Week you spent $60 across 2 expenses.');
    expect(calls.summary.map(call => call.start)).toEqual([WEEK.start, WEEK.start - 7 * 86_400_000]);
  });

  it('states a month with no spending in the previous window instead of a percentage of zero', async () => {
    const { port: readPort, setSummary } = port();
    setSummary(MONTH.start, MONTH.end, { totalSpent: 90, expenseCount: 3 });

    const answer = await answerLocalQuestion(readPort, 'Compare this month to last month', NOW);

    expect(answer.status === 'answered' && answer.text).toBe('This Month you spent $90 across 3 expenses. Last Month had no recorded spending.');
  });

  it('returns a typed cannot answer for a question outside the supported set, with no read at all', async () => {
    const { port: readPort, calls } = port();

    const answer = await answerLocalQuestion(readPort, 'What is my budget?', NOW);

    expect(answer).toEqual({ status: 'cannot_answer', reason: 'unsupported_question' });
    expect(calls.summary).toEqual([]);
    expect(calls.categories).toEqual([]);
    expect(calls.recent).toEqual([]);
  });

  it('answers a real zero for an empty ledger total rather than refusing', async () => {
    const { port: readPort } = port();

    const answer = await answerLocalQuestion(readPort, 'How much did I spend this month?', NOW);

    expect(answer.status === 'answered' && answer.text).toBe('This month you spent $0 across 0 expenses.');
  });

  it('reports no data for a category breakdown or a recent list on an empty ledger', async () => {
    const { port: readPort } = port();

    await expect(answerLocalQuestion(readPort, 'Show my spending by category', NOW)).resolves.toEqual({ status: 'cannot_answer', reason: 'no_data' });
    await expect(answerLocalQuestion(readPort, 'Show my recent expenses', NOW)).resolves.toEqual({ status: 'cannot_answer', reason: 'no_data' });
  });

  it('formats amounts through the shared currency rule, using the stored currency', async () => {
    const { port: readPort, setSummary } = port({
      getSetting: async () => 'GBP',
    });
    setSummary(MONTH.start, MONTH.end, { totalSpent: 1250, expenseCount: 2 });

    const answer = await answerLocalQuestion(readPort, 'How much did I spend this month?', NOW);

    expect(answer.status === 'answered' && answer.text).toBe('This month you spent £1,250 across 2 expenses.');
  });

  it('makes no network request and reads no key on the answer path', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { port: readPort, calls, setSummary } = port();
    setSummary(MONTH.start, MONTH.end, { totalSpent: 10, expenseCount: 1 });

    await answerLocalQuestion(readPort, 'How much did I spend this month?', NOW);

    expect(fetchSpy).not.toHaveBeenCalled();
    // The port only ever receives settings reads, and the only key it asks for is the
    // currency. There is no secret accessor on the port, so a key read is impossible.
    expect(calls.settings).toEqual(['currency']);
  });
});
