import type { Expense } from '../types/database';
import { resolveUserCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';

// Phase 11 D6. A suggested starting monthly budget, computed from what the user has
// actually spent. A made up default is worse than no suggestion, so this returns
// null whenever the ledger cannot support a real one, and the caller renders
// nothing rather than a number invented by the app.

export const BUDGET_SUGGESTION_WINDOW_DAYS = 30;

// "Not enough data" is defined here rather than tuned per screen. Both thresholds
// exist because either one alone produces a misleading number:
//   - fewer than five expenses in the window is a handful of one-off purchases,
//     not a spending pattern;
//   - an account younger than seven days has a window that covers only part of a
//     month, so its trailing total would systematically understate a monthly plan.
export const BUDGET_SUGGESTION_MIN_EXPENSES = 5;
export const BUDGET_SUGGESTION_MIN_SPAN_DAYS = 7;

// Rounded up to a whole five units, so the suggestion reads like a plan a person
// would set rather than a forensic total, and never like a limit that is already
// too low by rounding down.
const BUDGET_SUGGESTION_ROUNDING_STEP = 5;

const DAY_MS = 86_400_000;

export interface BudgetSuggestion {
  amount: number;
  currency: string;
}

export interface BudgetSuggestionInput {
  // Expenses inside the trailing window.
  windowExpenses: Pick<Expense, 'amount' | 'currency'>[];
  // The earliest expense the account holds at all, or null when it holds none. It
  // is read outside the window on purpose: it is the only honest answer to "how
  // long has this account been in use".
  earliestExpenseDate: number | null;
  // The stored conversion rates, unchanged from the settings row.
  rates: string | null;
  currency: string | null;
  now: number;
}

export function roundSuggestedBudget(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / BUDGET_SUGGESTION_ROUNDING_STEP) * BUDGET_SUGGESTION_ROUNDING_STEP;
}

export function buildSuggestedMonthlyBudget(input: BudgetSuggestionInput): BudgetSuggestion | null {
  const currency = resolveUserCurrency(input.currency);
  if (input.windowExpenses.length < BUDGET_SUGGESTION_MIN_EXPENSES) return null;
  if (input.earliestExpenseDate === null) return null;
  if (input.now - input.earliestExpenseDate < BUDGET_SUGGESTION_MIN_SPAN_DAYS * DAY_MS) return null;

  const normalized = normalizeCurrencyTotal(
    input.windowExpenses.map(expense => ({ amount: expense.amount, currency: expense.currency })),
    currency,
    input.rates,
  );
  // A window holding a currency with no stored rate cannot be summed honestly, and
  // summing the rest would suggest a budget below what the user actually spends.
  if (!normalized.complete) return null;

  const amount = roundSuggestedBudget(normalized.total);
  return amount > 0 ? { amount, currency: normalized.currency } : null;
}
