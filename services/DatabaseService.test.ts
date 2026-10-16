import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseService } from './DatabaseService';
import * as SQLite from 'expo-sqlite';
import { logger } from '../utils/logger';
import { CurrencyConversionError } from '../data/SettingsContracts';
import { parseMoneyAmount } from '../data/moneyInput';

vi.mock('react-native', () => ({ Platform: { OS: 'test' } }));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const fileSystemLegacy = vi.hoisted(() => ({
  cacheDirectory: null as string | null,
  documentDirectory: null as string | null,
  getInfoAsync: vi.fn(),
  deleteAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ getInfoAsync: vi.fn(), deleteAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => fileSystemLegacy);
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

// The single aggregate row the achievement pass reads since BUG-09-11a, with the same
// column names the statement returns. Defaults are an empty account.
type AggregateRow = {
  expense_count: number;
  scanned_count: number;
  total_spent: number;
  distinct_categories: number;
  note_count: number;
  detail_count: number;
  min_amount: number | null;
  min_currency: string | null;
  recurring_count: number;
};

const aggregateTotals = (overrides: Partial<AggregateRow> = {}): AggregateRow => ({
  expense_count: 0,
  scanned_count: 0,
  total_spent: 0,
  distinct_categories: 0,
  note_count: 0,
  detail_count: 0,
  min_amount: null,
  min_currency: null,
  recurring_count: 0,
  ...overrides,
});

// The populated fixture used by the achievement regression tests. The numbers are the
// ones measured in docs/phases/phase-09-ui-polish/bugfix-BUG-09-11-evidence.md for a
// six-row account: three categories, three rows with a note, two reimbursable rows (one
// of which also has a note, so the detail count is four), two scanned rows, 2500 spent
// with a 2.50 GBP minimum, two recurring templates and three income rows.
const POPULATED_FIXTURE: AggregateRow = {
  expense_count: 6,
  scanned_count: 2,
  total_spent: 2500,
  distinct_categories: 3,
  note_count: 3,
  detail_count: 4,
  min_amount: 2.5,
  min_currency: 'GBP',
  recurring_count: 2,
};

const POPULATED_SETTINGS = [
  { key: 'currency', value: 'EUR' },
  { key: 'monthly_budget', value: '4500' },
  { key: 'export_count', value: '1' },
  { key: 'last_streak', value: '7' },
];

beforeEach(() => {
  vi.clearAllMocks();
  fileSystemLegacy.cacheDirectory = null;
  fileSystemLegacy.documentDirectory = null;
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

// BUG-09-15. The CSV amount cell was read with `parseFloat`, which stops at the first
// character it cannot use, so `1,250.50` imported as 1 and `2,900` as 2. Both passed the
// row's own validity check, because 1 and 2 are finite positive numbers, so a wrong
// amount reached the user's records with no error and no warning. Every case below
// asserts the value that reaches the record, or that nothing was imported and the row
// was reported. No existing expectation was loosened to make the fix pass.
describe('DatabaseService imported amount reads its true value (BUG-09-15)', () => {
  // The header and column order the export writer emits, so these rows are the file
  // shape the app itself produces and not a synthetic one. The amount cell is quoted
  // because that is how a CSV carries a value containing a comma: a third-party, bank
  // or hand-edited file quotes it, and `parseCsvLine` hands the raw `1,250.50` to the
  // parse. An unquoted `2,900` would split into two columns and misalign the row.
  const csvWithAmount = (amountCell: string): string => [
    'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image',
    `2026-01-05,Cafe,"${amountCell}",NGN,dining,,,0,no`,
  ].join('\n');

  const readAmount = (amountCell: string): number => {
    const result = databaseService.parseImportData(csvWithAmount(amountCell));
    expect(result.errors).toEqual([]);
    const [row] = result.expenses;
    expect(row).toBeDefined();
    return row?.amount ?? Number.NaN;
  };

  it('reads a raw amount the way the export writer writes it', () => {
    expect(readAmount('1250.5')).toBe(1250.5);
    expect(readAmount('1250000.75')).toBe(1250000.75);
  });

  it('reads a grouped amount as its true value and not as its first digit', () => {
    const amount = readAmount('2,900');
    expect(amount).toBe(2900);
    expect(amount).not.toBe(2);
  });

  it('reads a grouped amount with decimals as its true value and not as its first digit', () => {
    const amount = readAmount('1,250.50');
    expect(amount).toBe(1250.5);
    expect(amount).not.toBe(1);
    expect(readAmount('12,345,678.90')).toBe(12345678.9);
  });

  it('reads an amount that uses a decimal comma', () => {
    expect(readAmount('1250,50')).toBe(1250.5);
    expect(readAmount('1.250,50')).toBe(1250.5);
  });

  it('skips an amount it cannot read, reports the row, and imports no number at all', () => {
    const result = databaseService.parseImportData(csvWithAmount('1,25,0'));

    expect(result.expenses).toEqual([]);
    expect(result.errors).toEqual(['CSV row 1: the amount "1,25,0" could not be read, so the row was skipped']);
  });

  it('refuses a cell carrying a currency symbol instead of importing part of it', () => {
    const result = databaseService.parseImportData(csvWithAmount('₦2,900'));

    expect(result.expenses).toEqual([]);
    expect(result.errors).toEqual(['CSV row 1: the amount "₦2,900" could not be read, so the row was skipped']);
  });

  it('skips an empty amount without turning it into zero', () => {
    const result = databaseService.parseImportData(csvWithAmount(''));

    expect(result.expenses).toEqual([]);
    expect(result.errors).toEqual(['CSV row 1: skipped invalid entry']);
  });

  it('reads a grouped JSON amount and refuses a JSON type it would otherwise coerce', () => {
    const grouped = databaseService.parseImportData(
      JSON.stringify([{ merchant: 'Cafe', amount: '1,250.50', currency: 'NGN', category: 'dining' }]),
    );
    expect(grouped.errors).toEqual([]);
    expect(grouped.expenses[0]?.amount).toBe(1250.5);

    const coerced = databaseService.parseImportData(
      JSON.stringify([{ merchant: 'Cafe', amount: true, currency: 'NGN', category: 'dining' }]),
    );
    expect(coerced.expenses).toEqual([]);
    expect(coerced.errors).toEqual(['item 1: invalid amount']);
  });

  it('keeps reading a file the export writer produced, end to end', async () => {
    database.getAllAsync.mockResolvedValue([
      { id: 'a', merchant: 'Cafe', amount: 1250.5, currency: 'NGN', category: 'dining', note: '', scanned: 0, date: 1710000000000 },
      { id: 'b', merchant: 'Mall', amount: 2900, currency: 'NGN', category: 'shopping', note: 'Sale', scanned: 1, date: 1710000000000 },
      { id: 'c', merchant: 'Kiosk', amount: 12.345, currency: 'NGN', category: 'other', note: 'Converted', scanned: 0, date: 1710000000000 },
    ]);

    const csv = await databaseService.exportToCSV(0, Date.now());
    const result = databaseService.parseImportData(csv);

    expect(result.errors).toEqual([]);
    expect(result.expenses.map(expense => expense.amount)).toEqual([1250.5, 2900, 12.345]);
  });
});

describe('parseMoneyAmount reads a grouped or decimal amount and refuses the rest (BUG-09-15)', () => {
  it('reads grouped, decimal and plain amounts as their true value', () => {
    expect(parseMoneyAmount('1250.50')).toEqual({ valid: true, value: 1250.5 });
    expect(parseMoneyAmount('2,900')).toEqual({ valid: true, value: 2900 });
    expect(parseMoneyAmount('1,250.50')).toEqual({ valid: true, value: 1250.5 });
    expect(parseMoneyAmount('1250,50')).toEqual({ valid: true, value: 1250.5 });
    expect(parseMoneyAmount('1.250,50')).toEqual({ valid: true, value: 1250.5 });
    expect(parseMoneyAmount(' 1,250.50 ')).toEqual({ valid: true, value: 1250.5 });
    expect(parseMoneyAmount('1250.505')).toEqual({ valid: true, value: 1250.505 });
    expect(parseMoneyAmount('.5')).toEqual({ valid: true, value: 0.5 });
  });

  it('keeps the dot as the decimal separator so an exported three decimal amount survives', () => {
    // `String(amount)` is what the export writer emits, so these are real file values.
    expect(parseMoneyAmount(String(12.345))).toEqual({ valid: true, value: 12.345 });
    expect(parseMoneyAmount('1.500')).toEqual({ valid: true, value: 1.5 });
    expect(parseMoneyAmount(String(0.1 + 0.2))).toEqual({ valid: true, value: 0.1 + 0.2 });
    // A repeated separator cannot be a decimal, so dot grouping still reads.
    expect(parseMoneyAmount('1.250.000')).toEqual({ valid: true, value: 1250000 });
  });

  it('refuses an amount it cannot read unambiguously instead of truncating it', () => {
    expect(parseMoneyAmount('1,25,0')).toEqual({ valid: false });
    expect(parseMoneyAmount('abc')).toEqual({ valid: false });
    expect(parseMoneyAmount('₦2,900')).toEqual({ valid: false });
    expect(parseMoneyAmount('1,250 kr')).toEqual({ valid: false });
    expect(parseMoneyAmount('')).toEqual({ valid: false });
    expect(parseMoneyAmount(null)).toEqual({ valid: false });
    expect(parseMoneyAmount('.')).toEqual({ valid: false });
  });

  it('still reads a value the app itself writes in exponential form', () => {
    expect(parseMoneyAmount('1e-7')).toEqual({ valid: true, value: 1e-7 });
  });
});

describe('DatabaseService achievement currency descriptions', () => {  it('uses user currency for aggregate spending thresholds and record currency for saver', async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM achievements')) return [];
      return [{ key: 'currency', value: 'EUR' }];
    });
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('min_amount')) return aggregateTotals({ min_amount: 2, min_currency: 'GBP' });
      return { count: 0 };
    });

    const badges = await databaseService.getBadgeProgress();

    expect(badges.find(badge => badge.id === 'saver')?.description).toBe('Single expense ≤ £3');
    expect(badges.find(badge => badge.id === 'shopper')?.description).toBe('€1,000 total spent');
    expect(badges.find(badge => badge.id === 'big-league')?.description).toBe('€10,000 total spent');
  });

  it('uses NGN when user and record currencies are absent', async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM achievements')) return [];
      return [];
    });
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('min_amount')) return aggregateTotals({ min_amount: 2, min_currency: null });
      return { count: 0 };
    });

    const badges = await databaseService.getBadgeProgress();

    expect(badges.find(badge => badge.id === 'saver')?.description).toBe('Single expense ≤ ₦3');
    expect(badges.find(badge => badge.id === 'shopper')?.description).toBe('₦1,000 total spent');
  });
});

describe('DatabaseService atomic onboarding completion', () => {
  const upsert = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
  const monthlyBudgetWrites = () =>
    database.runAsync.mock.calls.filter(call => (call[1] as [string, string])[0] === 'monthly_budget');

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

  it('stores a typed budget in canonical form instead of the raw string', async () => {
    await databaseService.completeOnboarding({ currency: 'NGN', monthlyBudget: ' 4500 ' });

    expect(monthlyBudgetWrites()).toEqual([[upsert, ['monthly_budget', '4500']]]);
  });

  // BUG-09-04a: onboarding was the one writer that stored the typed budget raw, and
  // "66,000" typed or pasted into the S-01 field became a stored cap of 66 on Home
  // while Settings read the same string as not set. E-12 proposal, recorded: an
  // entry that cannot be parsed is dropped rather than written, with no new UI on
  // the locked S-01 pair.
  it('refuses an entry it cannot parse instead of persisting the raw string', async () => {
    for (const monthlyBudget of ['66,000', '66,000.5', 'NGN 66,000', '-4500', 'abc']) {
      database.runAsync.mockClear();

      await databaseService.completeOnboarding({ currency: 'NGN', monthlyBudget });

      expect(monthlyBudgetWrites(), monthlyBudget).toEqual([]);
      const writtenKeys = database.runAsync.mock.calls.map(call => (call[1] as [string, string])[0]);
      expect(writtenKeys, monthlyBudget).toContain('onboarding_complete');
    }
  });

  it('registers profile name and budget so logs cannot echo them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await databaseService.completeOnboarding({ profileName: 'Zelda', currency: 'USD', monthlyBudget: '4321' });
    logger.error('settings_write_failed', 'Zelda spent 4321');

    expect(error).toHaveBeenCalledWith('[ERROR]:', 'settings_write_failed', '[REDACTED] spent [REDACTED]');
    error.mockRestore();
  });
});

// BUG-09-04a read side: the achievement gate was a fourth reader of the same stored
// key, and its parseFloat('66,000') read a cap of 66 that no one had set.
//
// BUG-09-11a moved the streak out of a second settings read and into the snapshot the
// pass already loaded, so these two cases are now asserted where the user sees the
// difference: whether the streak badges are awarded at all.
describe('DatabaseService reads the stored budget strictly (BUG-09-04a)', () => {
  const settingsRows = (monthlyBudget: string) => async (sql: string) =>
    sql.includes('FROM achievements')
      ? []
      : [{ key: 'monthly_budget', value: monthlyBudget }, { key: 'last_streak', value: '9' }];

  const weeklyStreakBadges = (ids: string[]) => ids.filter(id => id === 'week_warrior' || id === 'on-track');

  it('does not open the budget streak gate for a stored value a strict parse refuses', async () => {
    database.getAllAsync.mockImplementation(settingsRows('66,000'));
    database.getFirstAsync.mockResolvedValue(aggregateTotals());

    const newBadges = await databaseService.checkAchievements();

    expect(newBadges).toEqual([]);
    expect(weeklyStreakBadges(newBadges)).toEqual([]);
  });

  it('still opens the budget streak gate for a stored numeric budget', async () => {
    database.getAllAsync.mockImplementation(settingsRows('4500'));
    database.getFirstAsync.mockResolvedValue(aggregateTotals());

    const newBadges = await databaseService.checkAchievements();

    expect(newBadges).toContain('week_warrior');
    expect(weeklyStreakBadges(newBadges)).toEqual(['week_warrior', 'on-track']);
  });
});

// BUG-09-11a. The fan out collapsed into one aggregate read plus one achievements read.
// These tests hold the two things that collapse could break: the badge values
// themselves, and the statements the pass is allowed to issue.
describe('DatabaseService achievement pass (BUG-09-11a)', () => {
  const usePopulatedFixture = (earned: { id: string; earned_at: number | null }[] = []) => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM achievements')) return earned;
      return POPULATED_SETTINGS;
    });
    database.getFirstAsync.mockResolvedValue(POPULATED_FIXTURE);
  };

  it('keeps every badge current and target value for the populated fixture', async () => {
    usePopulatedFixture([{ id: 'first_step', earned_at: 111 }]);

    const badges = await databaseService.getBadgeProgress();

    // Derived by hand from the fixture: 6 expenses in 3 categories with 3 notes and 4
    // detail rows, 2 scanned, 2 recurring, 2500 spent with a 2.50 minimum, streak 7,
    // 1 export. A change to any of those numbers moves a line here.
    const expected: [string, number, number][] = [
      ['first_step', 1, 1],
      ['eagle_eye', 1, 1],
      ['on_repeat', 1, 1],
      ['week_warrior', 7, 7],
      ['month_master', 7, 30],
      ['paper_trail', 1, 1],
      ['detail_devil', 1, 1],
      ['getting-started', 5, 5],
      ['regular', 6, 25],
      ['century', 6, 100],
      ['sneak-peek', 2, 3],
      ['shutterbug', 2, 15],
      ['scanner-king', 2, 50],
      ['fortnight', 7, 14],
      ['season', 7, 60],
      ['half-year-hero', 7, 180],
      ['variety', 3, 3],
      ['explorer', 3, 5],
      ['completionist', 3, 8],
      ['saver', 1, 1],
      ['shopper', 10, 10],
      ['big-league', 2, 10],
      ['habit', 2, 2],
      ['loyalist', 2, 5],
      ['novelist', 3, 5],
      ['on-track', 7, 7],
      ['disciplined', 7, 30],
    ];

    expect(badges.map(badge => [badge.id, badge.current, badge.target])).toEqual(expected);
    expect(badges.find(badge => badge.id === 'first_step')?.earned_at).toBe(111);
    expect(badges.filter(badge => badge.id !== 'first_step').every(badge => badge.earned_at === null)).toBe(true);
  });

  it('awards the same badge ids in the same order for the populated fixture', async () => {
    usePopulatedFixture([{ id: 'first_step', earned_at: 111 }]);

    const newBadges = await databaseService.checkAchievements();

    // Catalogue order, only the unearned ids whose check now passes.
    expect(newBadges).toEqual([
      'eagle_eye', 'on_repeat', 'paper_trail', 'detail_devil', 'week_warrior',
      'getting-started', 'variety', 'saver', 'shopper', 'habit', 'on-track',
    ]);
    expect(database.runAsync.mock.calls.map(call => (call[1] as [string])[0])).toEqual(newBadges);
  });

  it('reads the whole pass in three statements, whatever the badge catalogue size', async () => {
    usePopulatedFixture([{ id: 'first_step', earned_at: 111 }]);

    await databaseService.checkAchievements();

    const settingsReads = database.getAllAsync.mock.calls.filter(call => (call[0] as string).includes('FROM settings'));
    expect(settingsReads).toHaveLength(1);
    expect(database.getAllAsync).toHaveBeenCalledTimes(2);
    expect(database.getFirstAsync).toHaveBeenCalledTimes(1);
    expect(database.getFirstAsync.mock.calls[0]?.[0]).toContain('AS min_amount');
  });

  it('resolves the minimum amount and its currency from one row with a shared tie break', async () => {
    usePopulatedFixture([]);

    await databaseService.checkAchievements();

    // The collapsed statement replaces a single row read with two scalar subqueries. A
    // bare `ORDER BY amount ASC LIMIT 1` in each lets two rows with an equal minimum
    // amount supply the amount and the currency separately, so the saver badge would
    // name a currency that held no such expense. (amount, rowid) is a total order, so
    // both subqueries must order by it and must therefore land on the same row.
    const sql = database.getFirstAsync.mock.calls[0]?.[0] as string;
    const sharedOrder = sql.match(/ORDER BY amount ASC, rowid ASC LIMIT 1/g) ?? [];
    expect(sharedOrder).toHaveLength(2);
    expect(sql).not.toMatch(/ORDER BY amount ASC LIMIT 1/);
  });

  it('reads the profile badge view in three statements and never re-reads settings', async () => {
    usePopulatedFixture([{ id: 'first_step', earned_at: 111 }]);

    await databaseService.getBadgeProgress();

    const settingsReads = database.getAllAsync.mock.calls.filter(call => (call[0] as string).includes('FROM settings'));
    expect(settingsReads).toHaveLength(1);
    expect(database.getAllAsync).toHaveBeenCalledTimes(2);
    expect(database.getFirstAsync).toHaveBeenCalledTimes(1);
  });

  it('never reads income, so income rows cannot move a badge', async () => {
    usePopulatedFixture([]);

    await databaseService.checkAchievements();

    const statements = [
      ...database.getAllAsync.mock.calls.map(call => call[0] as string),
      ...database.getFirstAsync.mock.calls.map(call => call[0] as string),
      ...database.runAsync.mock.calls.map(call => call[0] as string),
    ].join(' ');
    expect(statements).not.toMatch(/income/i);
    expect(statements).toMatch(/FROM expenses/);
    expect(statements).toMatch(/recurring_templates/);
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
      schema: 'v1', userVersion: 0, currentVersion: 7, hasRecords: false,
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
      schema: 'v2', userVersion: 6, currentVersion: 7, hasRecords: true,
    });
  });

  // BUG-09-11a continuity gate. Migration 7 writes user_version 7, so the state a real
  // reader now sees on every install is version 7, not 6. The classifier must still
  // call that a v2 owned file, and it must still call an unversioned legacy file v1.
  it('classifies a file already at user_version 7 as a v2 account, not v1', async () => {
    database.getAllAsync.mockResolvedValue([{ name: 'expenses' }]);
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('user_version')) return { user_version: 7 };
      if (sql.includes('COUNT(*)')) return { count: 12 };
      return null;
    });

    await expect(databaseService.detectContinuity()).resolves.toEqual({
      schema: 'v2', userVersion: 7, currentVersion: 7, hasRecords: true,
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
      schema: 'none', userVersion: 0, currentVersion: 7, hasRecords: false,
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

describe('DatabaseService media erasure (D9, S-06R-01, S-06R-02)', () => {
  it('Clear All Data deletes the owned receipt images its rows referenced, before COMMIT', async () => {
    fileSystemLegacy.cacheDirectory = 'cache/';
    database.getAllAsync.mockResolvedValue([
      { image_uri: 'cache/peachspend-receipt-a.jpg' },
      { image_uri: null },
    ]);

    await databaseService.clearAllData();

    expect(fileSystemLegacy.deleteAsync).toHaveBeenCalledTimes(1);
    expect(fileSystemLegacy.deleteAsync).toHaveBeenCalledWith('cache/peachspend-receipt-a.jpg', { idempotent: true });

    const commitIndex = database.execAsync.mock.calls.findIndex(call => call[0] === 'COMMIT');
    const deleteOrder = fileSystemLegacy.deleteAsync.mock.invocationCallOrder[0];
    const commitOrder = database.execAsync.mock.invocationCallOrder[commitIndex];
    expect(deleteOrder).toBeLessThan(commitOrder);
  });

  it('Clear All Data never deletes a foreign image path', async () => {
    fileSystemLegacy.cacheDirectory = 'cache/';
    database.getAllAsync.mockResolvedValue([{ image_uri: '/sdcard/foreign.jpg' }]);

    await databaseService.clearAllData();

    expect(fileSystemLegacy.deleteAsync).not.toHaveBeenCalled();
  });

  it('Reset App sweeps owned receipts and exports and skips foreign files', async () => {
    fileSystemLegacy.cacheDirectory = 'cache/';
    fileSystemLegacy.readDirectoryAsync.mockResolvedValue([
      'peachspend-receipt-a.jpg',
      'peachspend_private_export_1_2.csv',
      'report.csv',
    ]);

    await databaseService.resetApp();

    expect(fileSystemLegacy.deleteAsync).toHaveBeenCalledWith('cache/peachspend-receipt-a.jpg', { idempotent: true });
    expect(fileSystemLegacy.deleteAsync).toHaveBeenCalledWith('cache/peachspend_private_export_1_2.csv', { idempotent: true });
    expect(fileSystemLegacy.deleteAsync).not.toHaveBeenCalledWith('cache/report.csv', { idempotent: true });
  });
});

// Regression for the concurrent-open race: two startup callers that both pass the
// `if (this.db)` guard must share one SQLite.openDatabaseAsync, and a failed open
// must be retryable rather than cached as a rejected promise.
describe('DatabaseService single-flight initialization', () => {
  const openDatabaseAsync = SQLite.openDatabaseAsync as unknown as ReturnType<typeof vi.fn>;
  type InitState = { db: unknown; initPromise: unknown; startupSchema: unknown };

  // init() only runs when this.db is null, so each test detaches the shared
  // singleton's handle (and clears any queued open mock) and restores it after.
  const detachSharedHandle = (): (() => void) => {
    const service = databaseService as unknown as InitState;
    const previous: InitState = { db: service.db, initPromise: service.initPromise, startupSchema: service.startupSchema };
    service.db = null;
    service.initPromise = null;
    service.startupSchema = null;
    openDatabaseAsync.mockReset();
    return () => { Object.assign(service, previous); };
  };

  it('opens the database exactly once when two public callers race on first access', async () => {
    const restore = detachSharedHandle();
    let releaseOpen: (handle: unknown) => void = () => {};
    openDatabaseAsync.mockReturnValueOnce(new Promise(resolve => { releaseOpen = resolve; }));

    const first = databaseService.getSetting('currency');
    const second = databaseService.getSetting('currency');

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    releaseOpen(database);
    await Promise.all([first, second]);

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    restore();
  });

  it('opens the database exactly once when init is called concurrently', async () => {
    const restore = detachSharedHandle();
    let releaseOpen: (handle: unknown) => void = () => {};
    openDatabaseAsync.mockReturnValueOnce(new Promise(resolve => { releaseOpen = resolve; }));

    const first = databaseService.init();
    const second = databaseService.init();

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    releaseOpen(database);
    await Promise.all([first, second]);

    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    restore();
  });

  it('allows a retry after a failed open instead of caching the rejection', async () => {
    const restore = detachSharedHandle();
    openDatabaseAsync
      .mockRejectedValueOnce(new Error('native open failed'))
      .mockResolvedValueOnce(database);

    await expect(databaseService.init()).rejects.toThrow('native open failed');
    await expect(databaseService.init()).resolves.toBeUndefined();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
    restore();
  });

  it('closes and discards a half-opened handle when preparation fails so a retry opens fresh', async () => {
    const restore = detachSharedHandle();
    const broken = {
      getAllAsync: vi.fn(),
      getFirstAsync: vi.fn().mockRejectedValueOnce(new Error('pragma read failed')),
      runAsync: vi.fn(),
      execAsync: vi.fn(),
      closeAsync: vi.fn().mockResolvedValue(undefined),
    };
    openDatabaseAsync
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(database);

    await expect(databaseService.init()).rejects.toThrow('pragma read failed');
    expect(broken.closeAsync).toHaveBeenCalledTimes(1);
    expect((databaseService as unknown as { db: unknown }).db).toBeNull();

    await expect(databaseService.init()).resolves.toBeUndefined();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
    restore();
  });
});
