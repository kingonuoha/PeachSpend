import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import { CurrencyConversionError } from '../data/SettingsContracts';

vi.mock('react-native', () => ({ Platform: { OS: 'test' } }));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ getInfoAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({ cacheDirectory: null, getInfoAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock('../data/migrations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/migrations')>()), runMigrations: vi.fn() }));

type MockDatabase = {
  getAllAsync: ReturnType<typeof vi.fn>;
  getFirstAsync: ReturnType<typeof vi.fn>;
  runAsync: ReturnType<typeof vi.fn>;
  execAsync: ReturnType<typeof vi.fn>;
};

const database: MockDatabase = {
  getAllAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  runAsync: vi.fn(),
  execAsync: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (databaseService as unknown as { db: MockDatabase }).db = database;
  database.getAllAsync.mockResolvedValue([
    { key: 'currency', value: 'USD' },
    { key: 'gemini_api_key', value: 'legacy-gemini-key' },
    { key: 'chat_openrouter_api_key', value: 'legacy-openrouter-key' },
  ]);
  database.getFirstAsync.mockResolvedValue({ count: 0 });
});

describe('DatabaseService secret boundary', () => {
  it('excludes secret settings from all-settings results', async () => {
    await expect(databaseService.getAllSettings()).resolves.toEqual({ currency: 'USD' });
    await expect(databaseService.getSetting('gemini_api_key')).resolves.toBeNull();
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('resets database and deletes both secure secrets without reading them', async () => {
    await databaseService.resetApp();

    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('peachspend.gemini_api_key');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('peachspend.chat_openrouter_api_key');
    expect(database.execAsync).toHaveBeenCalledTimes(1);
  });

  it('returns stable indexed import errors without database details', async () => {
    vi.spyOn(databaseService, 'getCategories').mockResolvedValue([]);
    vi.spyOn(databaseService, 'getCaptureRepository').mockResolvedValue({
      save: vi.fn().mockRejectedValue(new Error('SQL contains internal details')),
    } as never);

    await expect(databaseService.importExpenses([
      { merchant: 'First', amount: 1, category: 'other' },
      { merchant: 'Second', amount: 2, category: 'other' },
    ])).resolves.toEqual({
      imported: 0,
      errors: ['Item 1: import_save_failed', 'Item 2: import_save_failed'],
    });
  });

  it('rejects incomplete expenses before SQLite persistence', async () => {
    await expect(databaseService.saveExpense({ amount: 12 } as never)).rejects.toMatchObject({
      name: 'CaptureValidationError', code: 'capture_validation', field: 'merchant',
    });
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it('reports incomplete JSON import fields instead of filling synthetic values', () => {
    const result = databaseService.parseImportData(JSON.stringify({ merchant: 'Cafe', amount: 0 }));

    expect(result.expenses).toEqual([]);
    expect(result.errors).toEqual([
      'item 1: invalid amount',
      'item 1: missing currency',
      'item 1: missing category',
    ]);
  });
});

describe('DatabaseService typed update boundaries', () => {
  it('updates expense note through typed method', async () => {
    await databaseService.updateExpenseNote('expense-1', 'Client lunch');

    expect(database.runAsync).toHaveBeenCalledWith(
      'UPDATE expenses SET note = ? WHERE id = ?',
      ['Client lunch', 'expense-1']
    );
  });

  it('normalizes reimbursable boolean to SQLite flag', async () => {
    await databaseService.updateExpenseReimbursable('expense-1', true);

    expect(database.runAsync).toHaveBeenCalledWith(
      'UPDATE expenses SET is_reimbursable = ? WHERE id = ?',
      [1, 'expense-1']
    );
  });

  it('updates category color and icon through typed methods', async () => {
    await databaseService.updateCategoryColor('dining', '#123456');
    await databaseService.updateCategoryIcon('dining', 'coffee');

    expect(database.runAsync).toHaveBeenNthCalledWith(
      1,
      'UPDATE categories SET color = ? WHERE id = ?',
      ['#123456', 'dining']
    );
    expect(database.runAsync).toHaveBeenNthCalledWith(
      2,
      'UPDATE categories SET icon_name = ? WHERE id = ?',
      ['coffee', 'dining']
    );
  });
});

describe('DatabaseService duplicate detection', () => {
  it('delegates typed candidates to shared transaction-date duplicate detection', async () => {
    const existing = { id: 'expense-1' };
    const findDuplicate = vi.fn().mockResolvedValue({ existing, reason: 'merchant_amount_24h' });
    vi.spyOn(databaseService, 'getCaptureRepository').mockResolvedValue({ findDuplicate } as never);

    await expect(databaseService.isDuplicate({ merchant: 'Cafe', amount: 12.5, date: 1_700_000_000_000 })).resolves.toBe(existing);
    expect(findDuplicate).toHaveBeenCalledWith({ merchant: 'Cafe', amount: 12.5, date: 1_700_000_000_000 });
    expect(database.getFirstAsync).not.toHaveBeenCalled();
  });
});

describe('DatabaseService streak activity boundary', () => {
  it('counts both expenses and income so an income-only user advances the streak', async () => {
    database.getFirstAsync.mockResolvedValue({ count: 1 });

    await expect(databaseService.hasAnyLoggingActivity()).resolves.toBe(true);

    const [sql] = database.getFirstAsync.mock.calls.at(-1) as [string];
    expect(sql).toContain('FROM expenses');
    expect(sql).toContain('FROM income');
  });

  it('reports no activity when both ledgers are empty', async () => {
    database.getFirstAsync.mockResolvedValue({ count: 0 });

    await expect(databaseService.hasAnyLoggingActivity()).resolves.toBe(false);
  });
});

describe('DatabaseService CSV export validation', () => {
  it('exports real values and skips malformed legacy rows without defaults', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'valid', merchant: 'Cafe, Main', amount: 12.5, currency: 'EUR',
        category: 'dining', note: 'Lunch', scanned: 1, date: 1710000000000,
      },
      { id: 'missing-values', merchant: '', amount: 0, currency: '', category: '', date: null },
      {
        id: 'non-finite', merchant: 'Broken', amount: Number.NaN, currency: 'GBP',
        category: 'other', scanned: 0, date: 1710000000000,
      },
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(databaseService.exportToCSV(0, Date.now())).resolves.toBe(
      'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image\n' +
      '2024-03-09,"Cafe, Main",12.5,"EUR","dining","Lunch",,1,no'
    );

    expect(warn).toHaveBeenCalledWith('[WARN]:', 'Skipped invalid expense row 2: merchant', 'database_export_row_skipped');
    expect(warn).toHaveBeenCalledWith('[WARN]:', 'Skipped invalid expense row 3: amount', 'database_export_row_skipped');
    warn.mockRestore();
  });
});

describe('DatabaseService achievement currency descriptions', () => {  it('uses user currency for aggregate spending thresholds and record currency for saver', async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM achievements')) return [];
      return [{ key: 'currency', value: 'EUR' }];
    });
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY amount ASC')) return { min: 2, currency: 'GBP' };
      if (sql.includes('SUM(amount)')) return { total: 1000 };
      if (sql.includes('COUNT(DISTINCT')) return { count: 0 };
      return { count: 0 };
    });

    const badges = await databaseService.getBadgeProgress();

    expect(badges.find(badge => badge.id === 'saver')?.description).toBe('Single expense ≤ £3.00');
    expect(badges.find(badge => badge.id === 'shopper')?.description).toBe('€1000.00 total spent');
    expect(badges.find(badge => badge.id === 'big-league')?.description).toBe('€10000.00 total spent');
  });

  it('uses NGN when user and record currencies are absent', async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM achievements')) return [];
      return [];
    });
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY amount ASC')) return { min: 2, currency: null };
      if (sql.includes('SUM(amount)')) return { total: 0 };
      return { count: 0 };
    });

    const badges = await databaseService.getBadgeProgress();

    expect(badges.find(badge => badge.id === 'saver')?.description).toBe('Single expense ≤ ₦3.00');
    expect(badges.find(badge => badge.id === 'shopper')?.description).toBe('₦1000.00 total spent');
  });
});

describe('DatabaseService atomic onboarding completion', () => {
  const upsert = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';

  it('writes every onboarding value inside one transaction and marks complete last', async () => {
    await databaseService.completeOnboarding({ profileName: ' Peach ', currency: 'USD', monthlyBudget: '1200' });

    expect(database.execAsync).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(database.execAsync).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(database.runAsync).toHaveBeenNthCalledWith(1, upsert, ['currency', 'USD']);
    expect(database.runAsync).toHaveBeenNthCalledWith(2, upsert, ['budget_currency', 'USD']);
    expect(database.runAsync).toHaveBeenNthCalledWith(3, upsert, ['profile_name', 'Peach']);
    expect(database.runAsync).toHaveBeenNthCalledWith(4, upsert, ['monthly_budget', '1200']);
    expect(database.runAsync).toHaveBeenNthCalledWith(5, upsert, ['profile_join_date', expect.any(String)]);
    expect(database.runAsync).toHaveBeenNthCalledWith(6, upsert, ['onboarding_complete', 'true']);
    expect(database.runAsync).toHaveBeenCalledTimes(6);
  });

  it('rolls back and never marks complete when an earlier write fails', async () => {
    database.runAsync.mockRejectedValueOnce(new Error('disk full'));

    await expect(databaseService.completeOnboarding({ currency: 'EUR' })).rejects.toThrow('disk full');

    expect(database.execAsync).toHaveBeenCalledWith('BEGIN');
    expect(database.execAsync).toHaveBeenCalledWith('ROLLBACK');
    expect(database.execAsync).not.toHaveBeenCalledWith('COMMIT');
    const completionWrites = database.runAsync.mock.calls.filter(call => call[1]?.[0] === 'onboarding_complete');
    expect(completionWrites).toHaveLength(0);
  });

  it('omits blank name and budget without inventing values', async () => {
    await databaseService.completeOnboarding({ profileName: '   ', currency: 'GBP', monthlyBudget: '  ' });

    const writtenKeys = database.runAsync.mock.calls.map(call => (call[1] as [string, string])[0]);
    expect(writtenKeys).toEqual(['currency', 'budget_currency', 'profile_join_date', 'onboarding_complete']);
  });

  it('registers profile name and budget so logs cannot echo them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await databaseService.completeOnboarding({ profileName: 'Zelda', currency: 'USD', monthlyBudget: '4321' });
    logger.error('settings_write_failed', 'Zelda spent 4321');

    expect(error).toHaveBeenCalledWith('[ERROR]:', 'settings_write_failed', '[REDACTED] spent [REDACTED]');
    error.mockRestore();
  });
});

describe('DatabaseService bulk currency conversion refuses a missing rate (S-05R-08)', () => {
  it('throws with the missing currencies instead of converting at par', async () => {
    database.getAllAsync.mockResolvedValue([
      { id: 'a', amount: 10, currency: 'USD' },
      { id: 'b', amount: 10, currency: 'JPY' },
    ]);
    database.getFirstAsync.mockResolvedValue({ key: 'conversion_rates', value: JSON.stringify({ USD: 1, EUR: 2 }) });

    await expect(databaseService.convertExpenses('EUR')).rejects.toBeInstanceOf(CurrencyConversionError);
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it('converts a fully priced batch through the shared rate rule', async () => {
    database.getAllAsync.mockResolvedValue([{ id: 'a', amount: 10, currency: 'USD' }]);
    database.getFirstAsync.mockResolvedValue({ key: 'conversion_rates', value: JSON.stringify({ USD: 1, EUR: 2 }) });

    await databaseService.convertExpenses('EUR');

    expect(database.runAsync).toHaveBeenCalledWith(
      'UPDATE expenses SET amount = ?, currency = ? WHERE id = ?',
      [5, 'EUR', 'a'],
    );
  });
});

describe('DatabaseService typed recurring update', () => {
  it('updates a recurring template through the typed boundary', async () => {
    database.getFirstAsync.mockResolvedValue({ key: 'currency', value: 'USD' });
    await databaseService.updateRecurringTemplate('t1', {
      merchant: 'Gym', amount: 40, currency: '', category: 'health', interval: 'monthly', next_due_date: 123, type: 'expense',
    });

    const [sql, params] = database.runAsync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('UPDATE recurring_templates SET');
    expect(params[0]).toBe('Gym');
    expect(params[2]).toBe('USD');
  });
});

describe('DatabaseService Clear All Data scope (D8)', () => {
  it('clears expenses, income, chat confirmations, and capture rows in one transaction', async () => {
    await databaseService.clearAllData();

    expect(database.execAsync).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(database.execAsync).toHaveBeenLastCalledWith('COMMIT');
    const deletes = database.runAsync.mock.calls.map(call => call[0] as string);
    expect(deletes).toEqual([
      'DELETE FROM expenses',
      'DELETE FROM income',
      'DELETE FROM chat_messages WHERE message_type = ?',
      'DELETE FROM capture_events',
      'DELETE FROM capture_queue',
    ]);
    expect(database.runAsync).toHaveBeenCalledWith('DELETE FROM chat_messages WHERE message_type = ?', ['expense_confirmation']);
  });

  it('never clears categories, settings, API keys, or achievements', async () => {
    await databaseService.clearAllData();

    const combined = database.runAsync.mock.calls.map(call => call[0] as string).join(' ').toUpperCase();
    expect(combined).not.toContain('CATEGORIES');
    expect(combined).not.toContain('SETTINGS');
    expect(combined).not.toContain('ACHIEVEMENTS');
    expect(combined).not.toContain('MERCHANT_CATEGORY_MEMORY');
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('rolls the whole clear back when a delete fails', async () => {
    database.runAsync.mockRejectedValueOnce(new Error('disk full'));

    await expect(databaseService.clearAllData()).rejects.toThrow('disk full');

    expect(database.execAsync).toHaveBeenCalledWith('BEGIN');
    expect(database.execAsync).toHaveBeenCalledWith('ROLLBACK');
    expect(database.execAsync).not.toHaveBeenCalledWith('COMMIT');
  });
});

describe('DatabaseService v1 to v2 continuity detection and migration (DEC-32)', () => {
  const resetStartup = () => {
    (databaseService as unknown as { startupSchema: unknown }).startupSchema = null;
  };

  beforeEach(resetStartup);

  it('classifies an unversioned file with the legacy table as v1 and reports no records', async () => {
    database.getAllAsync.mockResolvedValue([{ name: 'expenses' }]);
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('user_version')) return { user_version: 0 };
      if (sql.includes('COUNT(*)')) return { count: 0 };
      return null;
    });

    await expect(databaseService.detectContinuity()).resolves.toEqual({
      schema: 'v1', userVersion: 0, currentVersion: 6, hasRecords: false,
    });
  });

  it('classifies a versioned file with rows as an existing v2 account', async () => {
    database.getAllAsync.mockResolvedValue([{ name: 'expenses' }]);
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('user_version')) return { user_version: 6 };
      if (sql.includes('COUNT(*)')) return { count: 3 };
      return null;
    });

    await expect(databaseService.detectContinuity()).resolves.toEqual({
      schema: 'v2', userVersion: 6, currentVersion: 6, hasRecords: true,
    });
  });

  it('classifies a file with no tables and no version as none', async () => {
    database.getAllAsync.mockResolvedValue([]);
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('user_version')) return { user_version: 0 };
      if (sql.includes('COUNT(*)')) return { count: 0 };
      return null;
    });

    await expect(databaseService.detectContinuity()).resolves.toEqual({
      schema: 'none', userVersion: 0, currentVersion: 6, hasRecords: false,
    });
  });

  it('moves a supplied v1 export through the shared capture save boundary', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved' });
    vi.spyOn(databaseService, 'getCaptureRepository').mockResolvedValue({
      save, withTransaction: (operation: () => Promise<unknown>) => operation(),
    } as never);
    vi.spyOn(databaseService, 'getCategories').mockResolvedValue([]);
    database.getFirstAsync.mockResolvedValue({ count: 0 });

    const content = [
      'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image',
      '2026-03-09,"Cafe",10,"NGN","dining","",,1,yes',
    ].join('\n');

    await expect(databaseService.migrateV1Export({ content })).resolves.toMatchObject({ status: 'imported', imported: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      merchant: 'Cafe', amount: 10, currency: 'NGN', category: 'dining', source: 'import', scanned: true,
    }), true);
  });

  it('reports a non v1 file as unsupported without writing', async () => {
    const save = vi.fn();
    vi.spyOn(databaseService, 'getCaptureRepository').mockResolvedValue({ save } as never);

    await expect(databaseService.migrateV1Export({ content: 'a,b\n1,2' })).resolves.toMatchObject({ status: 'unsupported' });
    expect(save).not.toHaveBeenCalled();
  });
});
