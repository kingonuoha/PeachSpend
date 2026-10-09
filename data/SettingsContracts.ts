import type { Expense } from '../types/database';
import { normalizeCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';
import { formatConversionRate } from './contracts';

// Minimal read/write port every settings-backed contract accepts. Keeping the
// surface this small means a test can inject a plain in-memory map and the
// DatabaseService structurally satisfies it, so no second settings writer exists.
export interface SettingsPort {
  getSetting(key: string): Promise<string | null>;
  updateSetting(key: string, value: string): Promise<void>;
}

export interface SettingsSnapshot {
  currency: string;
  budget: number;
  budgetCurrency: string;
  theme: 'light' | 'dark';
  pricesVisible: boolean;
  notificationsEnabled: boolean;
}

// Builds the S-06 read model from stored settings. Keys never appear in the
// returned shape: the AI provider key home is S-17, not this contract (FR-06.2).
export function buildSettingsSnapshot(settings: Record<string, string>): SettingsSnapshot {
  const budget = Number(settings.monthly_budget);
  return {
    currency: normalizeCurrency(settings.currency) ?? 'NGN',
    budget: Number.isFinite(budget) && budget > 0 ? budget : 0,
    budgetCurrency: normalizeCurrency(settings.budget_currency) ?? normalizeCurrency(settings.currency) ?? 'NGN',
    theme: settings.theme === 'light' ? 'light' : 'dark',
    pricesVisible: settings.prices_visible !== 'false',
    notificationsEnabled: settings.notifications_enabled === 'true',
  };
}

export type BudgetParse = { valid: true; value: number } | { valid: false };

// Empty means the user cleared the budget, which is a real value of zero, not a
// parse failure. Negative or non-numeric input is rejected instead of clamped.
export function parseBudgetInput(raw: string): BudgetParse {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: 0 };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { valid: false };
  return { valid: true, value };
}

export type BudgetUpdateResult =
  | { status: 'saved'; budget: number; currency: string }
  | { status: 'invalid'; reason: 'not_a_number' };

export async function updateBudget(port: SettingsPort, raw: string, currency: string): Promise<BudgetUpdateResult> {
  const parsed = parseBudgetInput(raw);
  if (!parsed.valid) return { status: 'invalid', reason: 'not_a_number' };
  const resolvedCurrency = normalizeCurrency(currency) ?? currency;
  await port.updateSetting('monthly_budget', String(parsed.value));
  await port.updateSetting('budget_currency', resolvedCurrency);
  return { status: 'saved', budget: parsed.value, currency: resolvedCurrency };
}

// SH-06a bulk conversion (FR-06.5). Each option carries the real stored rate or
// an explicit absence. A missing rate never becomes 1: the option is marked
// excluded and the preview refuses instead of rebasing at par (S-05R-08).
export interface CurrencyConversionOption {
  code: string;
  rate: number | null;
  rateLabel: string;
  excluded: boolean;
}

export interface CurrencyConversionScope {
  transactionCount: number;
  affectedCount: number;
  sourceTotal: number;
  convertedTotal: number;
}

export interface CurrencyConversionPreview {
  status: 'ready' | 'refused';
  fromCurrency: string;
  toCurrency: string;
  rate: number | null;
  rateLabel: string;
  scope: CurrencyConversionScope;
  missingRates: string[];
  options: CurrencyConversionOption[];
}

function conversionRate(fromCurrency: string, toCurrency: string, rates: string | null | undefined): number | null {
  const converted = normalizeCurrencyTotal([{ amount: 1, currency: fromCurrency }], toCurrency, rates);
  return converted.complete ? converted.total : null;
}

export function buildConversionOptions(
  fromCurrency: string,
  candidates: readonly string[],
  rates: string | null | undefined,
): CurrencyConversionOption[] {
  return candidates.map(code => {
    const normalized = normalizeCurrency(code) ?? code;
    const rate = normalized === normalizeCurrency(fromCurrency) ? 1 : conversionRate(fromCurrency, normalized, rates);
    return { code: normalized, rate, rateLabel: formatConversionRate(rate), excluded: rate === null };
  });
}

export function buildCurrencyConversionPreview(
  expenses: Pick<Expense, 'amount' | 'currency'>[],
  fromCurrency: string,
  toCurrency: string,
  rates: string | null | undefined,
  candidates: readonly string[] = [],
): CurrencyConversionPreview {
  const target = normalizeCurrency(toCurrency) ?? '';
  const source = normalizeCurrency(fromCurrency) ?? '';
  const entries = expenses.map(expense => ({ amount: expense.amount, currency: expense.currency }));
  const converted = normalizeCurrencyTotal(entries, target, rates);
  const sourceTotal = normalizeCurrencyTotal(entries, source, rates).total;
  const rate = source === target ? 1 : conversionRate(source, target, rates);
  const missingRates = [...new Set(converted.missingRates)];
  return {
    status: rate === null || missingRates.length > 0 ? 'refused' : 'ready',
    fromCurrency: source,
    toCurrency: target,
    rate,
    rateLabel: formatConversionRate(rate),
    scope: {
      transactionCount: expenses.length,
      affectedCount: expenses.filter(expense => (normalizeCurrency(expense.currency) ?? target) !== target).length,
      sourceTotal,
      convertedTotal: converted.total,
    },
    missingRates,
    options: candidates.length > 0 ? buildConversionOptions(source, candidates, rates) : [],
  };
}

export interface BulkConversionSkipped { id: string; currency: string; }

export interface BulkConversionEntry {
  id: string;
  amount: number;
  currency: string;
  convertedAmount: number;
}

export interface BulkConversionPlan {
  toCurrency: string;
  entries: BulkConversionEntry[];
  skipped: BulkConversionSkipped[];
  transactionCount: number;
  missingRates: string[];
  complete: boolean;
}

// Per-row plan that routes every amount through normalizeCurrencyTotal, the one
// shared conversion rule. A row whose currency has no stored rate is listed in
// `skipped` and never converted at an assumed 1:1 rate.
export function buildBulkConversionPlan(
  expenses: Pick<Expense, 'id' | 'amount' | 'currency'>[],
  toCurrency: string,
  rates: string | null | undefined,
): BulkConversionPlan {
  const target = normalizeCurrency(toCurrency) ?? '';
  const entries: BulkConversionEntry[] = [];
  const skipped: BulkConversionSkipped[] = [];
  const missing = new Set<string>();
  for (const expense of expenses) {
    const code = normalizeCurrency(expense.currency) ?? target;
    const converted = normalizeCurrencyTotal([{ amount: expense.amount, currency: code }], target, rates);
    if (!converted.complete) {
      converted.missingRates.forEach(item => missing.add(item));
      skipped.push({ id: expense.id, currency: code });
      continue;
    }
    entries.push({ id: expense.id, amount: expense.amount, currency: code, convertedAmount: converted.total });
  }
  return {
    toCurrency: target,
    entries,
    skipped,
    transactionCount: expenses.length,
    missingRates: [...missing],
    complete: missing.size === 0,
  };
}

export interface CurrencyConversionWriter extends SettingsPort {
  updateExpenseCurrency(id: string, amount: number, currency: string): Promise<void>;
}

// Thrown by the storage executor when a row cannot be priced. Callers must show
// the missing currencies rather than rebasing at an assumed rate of 1 (S-05R-08).
export class CurrencyConversionError extends Error {
  readonly code = 'missing_rate';
  constructor(readonly missingRates: string[]) {
    super(`Missing conversion rate for: ${missingRates.join(', ')}`);
    this.name = 'CurrencyConversionError';
  }
}

export type BulkConversionOutcome =
  | { status: 'converted'; toCurrency: string; convertedCount: number; missingRates: [] }
  | { status: 'refused'; missingRates: string[] }
  | { status: 'partial'; toCurrency: string; convertedCount: number; skippedCount: number; missingRates: string[] };

// Sole executor for the SH-06a conversion. Default behavior refuses when any row
// lacks a rate. `allowPartial` converts what is fully priced and leaves the rest
// untouched, returning the skipped count so the screen can warn honestly.
export async function executeBulkCurrencyConversion(
  writer: CurrencyConversionWriter,
  expenses: Pick<Expense, 'id' | 'amount' | 'currency'>[],
  toCurrency: string,
  rates: string | null | undefined,
  options: { allowPartial?: boolean } = {},
): Promise<BulkConversionOutcome> {
  const plan = buildBulkConversionPlan(expenses, toCurrency, rates);
  if (!plan.complete && !options.allowPartial) {
    return { status: 'refused', missingRates: plan.missingRates };
  }
  for (const entry of plan.entries) {
    if (entry.currency === plan.toCurrency) continue;
    await writer.updateExpenseCurrency(entry.id, entry.convertedAmount, plan.toCurrency);
  }
  await writer.updateSetting('currency', plan.toCurrency);
  if (!plan.complete) {
    return {
      status: 'partial',
      toCurrency: plan.toCurrency,
      convertedCount: plan.entries.length,
      skippedCount: plan.skipped.length,
      missingRates: plan.missingRates,
    };
  }
  return { status: 'converted', toCurrency: plan.toCurrency, convertedCount: plan.entries.length, missingRates: [] };
}

// FR-06.9 export preview. Row counts mirror the CSV writer's own validity rule
// so the preview cannot promise rows the export later drops.
export type ExportFormat = 'csv';

export interface ExportValidation {
  valid: boolean;
  reason?: 'merchant' | 'amount' | 'currency' | 'category' | 'date' | 'scanned';
}

export function isExportableExpense(expense: Partial<Expense>): ExportValidation {
  if (typeof expense.merchant !== 'string' || !expense.merchant.trim()) return { valid: false, reason: 'merchant' };
  if (typeof expense.amount !== 'number' || !Number.isFinite(expense.amount) || expense.amount <= 0) return { valid: false, reason: 'amount' };
  if (typeof expense.currency !== 'string' || !expense.currency.trim()) return { valid: false, reason: 'currency' };
  if (typeof expense.category !== 'string' || !expense.category.trim()) return { valid: false, reason: 'category' };
  if (typeof expense.date !== 'number' || !Number.isFinite(expense.date) || !Number.isFinite(new Date(expense.date).getTime())) return { valid: false, reason: 'date' };
  if (expense.scanned !== 0 && expense.scanned !== 1) return { valid: false, reason: 'scanned' };
  return { valid: true };
}

export interface ExportRange { start: number; end: number; }

export interface ExportSampleRow {
  date: number;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
}

export interface ExportPreview {
  format: ExportFormat;
  range: ExportRange;
  rowCount: number;
  validRowCount: number;
  skippedRowCount: number;
  sample: ExportSampleRow[];
}

export function buildExportPreview(
  expenses: Expense[],
  range: ExportRange,
  sampleSize = 3,
): ExportPreview {
  const inRange = expenses.filter(expense => expense.date >= range.start && expense.date <= range.end);
  const valid = inRange.filter(expense => isExportableExpense(expense).valid);
  return {
    format: 'csv',
    range,
    rowCount: inRange.length,
    validRowCount: valid.length,
    skippedRowCount: inRange.length - valid.length,
    sample: valid.slice(0, sampleSize).map(expense => ({
      date: expense.date,
      merchant: expense.merchant,
      amount: expense.amount,
      currency: expense.currency,
      category: expense.category,
    })),
  };
}

// FR-06.9 execution boundary. The screen owns the file/share UI, but the data
// layer owns the CSV body and the success/failure shape so the preview and the
// written file always come from the same query and the same row rule.
export interface ExportWriter {
  exportToCSV(start: number, end: number, categories?: string[]): Promise<string>;
  writeExportFile(fileName: string, content: string): Promise<string>;
  shareFile(uri: string): Promise<void>;
}

export type ExportOutcome =
  | { status: 'exported'; uri: string; rowCount: number }
  | { status: 'failed'; errorCode: 'storage_unavailable' | 'sharing_unavailable' | 'failed' };

export async function executeExport(writer: ExportWriter, preview: ExportPreview): Promise<ExportOutcome> {
  try {
    const content = await writer.exportToCSV(preview.range.start, preview.range.end);
    const uri = await writer.writeExportFile(`peachspend_private_export_${preview.range.start}_${preview.range.end}.csv`, content);
    await writer.shareFile(uri);
    return { status: 'exported', uri, rowCount: preview.validRowCount };
  } catch (error) {
    if (error instanceof Error && error.message === 'storage_unavailable') return { status: 'failed', errorCode: 'storage_unavailable' };
    if (error instanceof Error && error.message === 'sharing_unavailable') return { status: 'failed', errorCode: 'sharing_unavailable' };
    return { status: 'failed', errorCode: 'failed' };
  }
}

// FR-06.6 Data Stewardship. Clear All Data and Reset App execute only here and
// only after an explicit confirmation. Chat (Tier 3) deep-links to S-06 instead
// of calling this boundary.
export type DataStewardshipAction = 'clear_all_data' | 'reset_app';

// D8: the factual scope of Clear All Data. This is the one source a screen reads
// to render honest copy, so the dialog can never claim a wider or narrower clear
// than the database performs. Existing result shapes are unchanged.
export const CLEAR_ALL_DATA_SCOPE = {
  clears: ['expenses', 'income', 'chat_expense_confirmations', 'capture_events', 'capture_queue'],
  keeps: ['categories', 'settings', 'api_keys', 'achievements', 'merchant_category_memory'],
} as const;

export interface DataStewardshipPort {
  clearAllData(): Promise<void>;
  resetApp(): Promise<void>;
}

export type DataStewardshipResult =
  | { status: 'requires_confirmation'; action: DataStewardshipAction }
  | { status: 'completed'; action: DataStewardshipAction }
  | { status: 'failed'; action: DataStewardshipAction; errorCode: 'execution_failed' };

export async function executeDataStewardship(
  port: DataStewardshipPort,
  action: DataStewardshipAction,
  confirmed: boolean,
): Promise<DataStewardshipResult> {
  if (!confirmed) return { status: 'requires_confirmation', action };
  try {
    if (action === 'clear_all_data') await port.clearAllData();
    else await port.resetApp();
    return { status: 'completed', action };
  } catch {
    return { status: 'failed', action, errorCode: 'execution_failed' };
  }
}
