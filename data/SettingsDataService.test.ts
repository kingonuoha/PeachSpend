import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import {
  buildBulkConversionPlan, buildConversionOptions, buildCurrencyConversionPreview, buildExportPreview,
  buildSettingsSnapshot, CLEAR_ALL_DATA_SCOPE, executeBulkCurrencyConversion, executeDataStewardship, executeExport, isExportableExpense,
  parseBudgetInput, updateBudget, type CurrencyConversionWriter, type DataStewardshipPort, type ExportWriter,
} from './SettingsContracts';

const RATES = JSON.stringify({ USD: 1, EUR: 2, GBP: 4 });

const expense = (overrides: Partial<Expense>): Expense => ({
  id: 'e', merchant: 'M', amount: 10, currency: 'USD', category: 'dining', scanned: 0,
  date: 1_700_000_000_000, created_at: 1_700_000_000_000, ...overrides,
});

describe('settings snapshot', () => {
  it('never carries an API key field', () => {
    const snapshot = buildSettingsSnapshot({ currency: 'USD', monthly_budget: '100', theme: 'light', gemini_api_key: 'secret', chat_openrouter_api_key: 'secret' });
    expect(Object.keys(snapshot).some(key => key.includes('key'))).toBe(false);
    expect(snapshot).toMatchObject({ currency: 'USD', budget: 100, theme: 'light' });
  });
});

describe('budget update boundary', () => {
  it('parses empty as a cleared zero and rejects negatives or text', () => {
    expect(parseBudgetInput('')).toEqual({ valid: true, value: 0 });
    expect(parseBudgetInput('250')).toEqual({ valid: true, value: 250 });
    expect(parseBudgetInput('-5').valid).toBe(false);
    expect(parseBudgetInput('abc').valid).toBe(false);
  });

  it('writes budget and budget currency through the single port', async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const result = await updateBudget({ getSetting: async () => null, updateSetting }, '320', 'eur');
    expect(result).toEqual({ status: 'saved', budget: 320, currency: 'EUR' });
    expect(updateSetting).toHaveBeenNthCalledWith(1, 'monthly_budget', '320');
    expect(updateSetting).toHaveBeenNthCalledWith(2, 'budget_currency', 'EUR');
  });

  it('does not write an invalid budget', async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    await expect(updateBudget({ getSetting: async () => null, updateSetting }, '-1', 'USD')).resolves.toEqual({ status: 'invalid', reason: 'not_a_number' });
    expect(updateSetting).not.toHaveBeenCalled();
  });
});

describe('bulk currency conversion (S-05R-08)', () => {
  it('reports the real stored rate and refuses a missing one instead of using 1', () => {
    const preview = buildCurrencyConversionPreview([expense({ currency: 'EUR' })], 'USD', 'EUR', RATES, ['USD', 'EUR', 'JPY']);
    expect(preview.rate).toBe(0.5);
    expect(preview.rateLabel).toBe('0.5');
    const jpy = preview.options.find(option => option.code === 'JPY');
    expect(jpy).toEqual({ code: 'JPY', rate: null, rateLabel: '', excluded: true });
    expect(preview.status).toBe('ready');
  });

  it('refuses the batch when a row has no rate', () => {
    const preview = buildCurrencyConversionPreview([expense({ currency: 'JPY' })], 'USD', 'EUR', RATES);
    expect(preview.status).toBe('refused');
    expect(preview.missingRates).toContain('JPY');
  });

  it('plans per-row conversion without an assumed rate', () => {
    const plan = buildBulkConversionPlan([
      expense({ id: 'a', amount: 10, currency: 'USD' }),
      expense({ id: 'b', amount: 10, currency: 'JPY' }),
    ], 'EUR', RATES);
    expect(plan.entries).toEqual([{ id: 'a', amount: 10, currency: 'USD', convertedAmount: 5 }]);
    expect(plan.skipped).toEqual([{ id: 'b', currency: 'JPY' }]);
    expect(plan.complete).toBe(false);
  });

  it('refuses by default and only converts priced rows when partial is allowed', async () => {
    const writer: CurrencyConversionWriter = {
      getSetting: async () => null,
      updateSetting: vi.fn().mockResolvedValue(undefined),
      updateExpenseCurrency: vi.fn().mockResolvedValue(undefined),
    };
    const rows = [expense({ id: 'a', amount: 10, currency: 'USD' }), expense({ id: 'b', amount: 10, currency: 'JPY' })];

    await expect(executeBulkCurrencyConversion(writer, rows, 'EUR', RATES)).resolves.toEqual({ status: 'refused', missingRates: ['JPY'] });
    expect(writer.updateExpenseCurrency).not.toHaveBeenCalled();

    const partial = await executeBulkCurrencyConversion(writer, rows, 'EUR', RATES, { allowPartial: true });
    expect(partial).toEqual({ status: 'partial', toCurrency: 'EUR', convertedCount: 1, skippedCount: 1, missingRates: ['JPY'] });
    expect(writer.updateExpenseCurrency).toHaveBeenCalledWith('a', 5, 'EUR');
    expect(writer.updateSetting).toHaveBeenCalledWith('currency', 'EUR');
  });

  it('reports a fully converted batch', async () => {
    const writer: CurrencyConversionWriter = {
      getSetting: async () => null,
      updateSetting: vi.fn().mockResolvedValue(undefined),
      updateExpenseCurrency: vi.fn().mockResolvedValue(undefined),
    };
    const result = await executeBulkCurrencyConversion(writer, [expense({ id: 'a', amount: 10, currency: 'USD' })], 'EUR', RATES);
    expect(result).toMatchObject({ status: 'converted', toCurrency: 'EUR', convertedCount: 1, missingRates: [] });
  });
});

describe('export preview', () => {
  it('counts valid and skipped rows using the shared export rule', () => {
    const preview = buildExportPreview([
      expense({ id: 'ok', date: 100 }),
      expense({ id: 'bad', merchant: '', date: 100 }),
      expense({ id: 'future', date: 999_999 }),
    ], { start: 0, end: 1000 });
    expect(preview).toMatchObject({ format: 'csv', rowCount: 2, validRowCount: 1, skippedRowCount: 1 });
    expect(preview.sample).toHaveLength(1);
    expect(isExportableExpense({ merchant: 'M', amount: 1, currency: 'USD', category: 'dining', date: 1, scanned: 0 }).valid).toBe(true);
  });
});

describe('export execution boundary (FR-06.9)', () => {
  const preview = buildExportPreview([expense({ id: 'ok', date: 100 })], { start: 0, end: 1000 });

  it('writes and shares the exact CSV body through the writer', async () => {
    const writer: ExportWriter = {
      exportToCSV: vi.fn().mockResolvedValue('csv-body'),
      writeExportFile: vi.fn().mockResolvedValue('file://export.csv'),
      shareFile: vi.fn().mockResolvedValue(undefined),
    };
    await expect(executeExport(writer, preview)).resolves.toEqual({ status: 'exported', uri: 'file://export.csv', rowCount: 1 });
    expect(writer.exportToCSV).toHaveBeenCalledWith(0, 1000);
  });

  it('reports a typed failure without throwing', async () => {
    const writer: ExportWriter = {
      exportToCSV: vi.fn().mockRejectedValue(new Error('storage_unavailable')),
      writeExportFile: vi.fn(),
      shareFile: vi.fn(),
    };
    await expect(executeExport(writer, preview)).resolves.toEqual({ status: 'failed', errorCode: 'storage_unavailable' });
  });
});

describe('data stewardship sole executor', () => {
  it('requires confirmation before any destructive call', async () => {
    const port: DataStewardshipPort = { clearAllData: vi.fn(), resetApp: vi.fn() };
    await expect(executeDataStewardship(port, 'reset_app', false)).resolves.toEqual({ status: 'requires_confirmation', action: 'reset_app' });
    expect(port.resetApp).not.toHaveBeenCalled();
  });

  it('executes only the requested action after confirmation', async () => {
    const port: DataStewardshipPort = { clearAllData: vi.fn().mockResolvedValue(undefined), resetApp: vi.fn().mockResolvedValue(undefined) };
    await expect(executeDataStewardship(port, 'clear_all_data', true)).resolves.toEqual({ status: 'completed', action: 'clear_all_data' });
    expect(port.clearAllData).toHaveBeenCalledOnce();
    expect(port.resetApp).not.toHaveBeenCalled();
  });

  it('reports a typed failure instead of throwing', async () => {
    const port: DataStewardshipPort = { clearAllData: vi.fn().mockRejectedValue(new Error('disk')), resetApp: vi.fn() };
    await expect(executeDataStewardship(port, 'clear_all_data', true)).resolves.toEqual({ status: 'failed', action: 'clear_all_data', errorCode: 'execution_failed' });
  });
});

describe('conversion option list', () => {
  it('marks a currency without a stored rate as excluded', () => {
    expect(buildConversionOptions('USD', ['EUR', 'JPY'], RATES)).toEqual([
      { code: 'EUR', rate: 0.5, rateLabel: '0.5', excluded: false },
      { code: 'JPY', rate: null, rateLabel: '', excluded: true },
    ]);
  });
});

describe('Clear All Data scope (D8)', () => {
  it('documents exactly what clears and what is kept for honest copy', () => {
    expect(CLEAR_ALL_DATA_SCOPE.clears).toEqual([
      'expenses', 'income', 'chat_expense_confirmations', 'capture_events', 'capture_queue',
    ]);
    expect(CLEAR_ALL_DATA_SCOPE.keeps).toEqual([
      'categories', 'settings', 'api_keys', 'achievements', 'merchant_category_memory',
    ]);
  });
});
