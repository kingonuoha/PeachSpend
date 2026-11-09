import { describe, expect, it } from 'vitest';
import {
  BUDGET_SUGGESTION_MIN_EXPENSES, BUDGET_SUGGESTION_MIN_SPAN_DAYS, BUDGET_SUGGESTION_WINDOW_DAYS,
  buildSuggestedMonthlyBudget, roundSuggestedBudget,
} from './BudgetSuggestion';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

const expense = (amount: number, currency = 'USD') => ({ amount, currency });

describe('suggested monthly budget', () => {
  it('measures a trailing thirty day window', () => {
    expect(BUDGET_SUGGESTION_WINDOW_DAYS).toBe(30);
  });

  it('offers nothing for an empty ledger', () => {
    expect(buildSuggestedMonthlyBudget({ windowExpenses: [], earliestExpenseDate: null, rates: null, currency: 'USD', now: NOW })).toBeNull();
  });

  it('offers nothing for a thin ledger', () => {
    const thin = Array.from({ length: BUDGET_SUGGESTION_MIN_EXPENSES - 1 }, () => expense(20));
    expect(buildSuggestedMonthlyBudget({ windowExpenses: thin, earliestExpenseDate: NOW - 20 * DAY_MS, rates: null, currency: 'USD', now: NOW })).toBeNull();
  });

  it('offers nothing for an account younger than the minimum span', () => {
    const young = Array.from({ length: 8 }, () => expense(20));
    expect(buildSuggestedMonthlyBudget({
      windowExpenses: young,
      earliestExpenseDate: NOW - (BUDGET_SUGGESTION_MIN_SPAN_DAYS - 1) * DAY_MS,
      rates: null,
      currency: 'USD',
      now: NOW,
    })).toBeNull();
  });

  it('offers nothing when a currency in the window has no stored rate', () => {
    const mixed = [expense(20), expense(20), expense(20), expense(40, 'EUR'), expense(20)];
    expect(buildSuggestedMonthlyBudget({ windowExpenses: mixed, earliestExpenseDate: NOW - 60 * DAY_MS, rates: null, currency: 'USD', now: NOW })).toBeNull();
  });

  it('suggests the rounded trailing total in the settings currency', () => {
    const spend = [expense(120), expense(80), expense(60.4), expense(40), expense(99.6)];
    const suggestion = buildSuggestedMonthlyBudget({ windowExpenses: spend, earliestExpenseDate: NOW - 60 * DAY_MS, rates: null, currency: 'USD', now: NOW });

    // 400 exactly, already on the rounding step.
    expect(suggestion).toEqual({ amount: 400, currency: 'USD' });
  });

  it('converts a foreign currency window through the stored rates', () => {
    const spend = [expense(100, 'EUR'), expense(100, 'EUR'), expense(100, 'EUR'), expense(100, 'EUR'), expense(100, 'EUR')];
    const suggestion = buildSuggestedMonthlyBudget({
      windowExpenses: spend,
      earliestExpenseDate: NOW - 60 * DAY_MS,
      rates: JSON.stringify({ USD: 1, EUR: 1.5 }),
      currency: 'USD',
      now: NOW,
    });

    expect(suggestion).toEqual({ amount: 750, currency: 'USD' });
  });

  it('uses the app currency when no currency setting exists', () => {
    const spend = [expense(10, 'NGN'), expense(10, 'NGN'), expense(10, 'NGN'), expense(10, 'NGN'), expense(10, 'NGN')];
    const suggestion = buildSuggestedMonthlyBudget({ windowExpenses: spend, earliestExpenseDate: NOW - 60 * DAY_MS, rates: null, currency: null, now: NOW });

    expect(suggestion).toEqual({ amount: 50, currency: 'NGN' });
  });

  it('offers nothing when the settings currency is absent and the rows cannot be converted into it', () => {
    const spend = [expense(10, 'USD'), expense(10, 'USD'), expense(10, 'USD'), expense(10, 'USD'), expense(10, 'USD')];
    expect(buildSuggestedMonthlyBudget({ windowExpenses: spend, earliestExpenseDate: NOW - 60 * DAY_MS, rates: null, currency: null, now: NOW })).toBeNull();
  });

  it('rounds a total up to the next five units and never down', () => {
    expect(roundSuggestedBudget(401)).toBe(405);
    expect(roundSuggestedBudget(405)).toBe(405);
    expect(roundSuggestedBudget(0)).toBe(0);
    expect(roundSuggestedBudget(Number.NaN)).toBe(0);
  });
});
