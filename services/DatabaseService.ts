import * as SQLite from 'expo-sqlite';
import { Expense, Income, Notification, RecurringTemplate, Setting, ChatMessage } from '../types/database';
import { logger, registerSensitiveValue } from '../utils/logger';
import { runMigrations } from '../data/migrations';
import { parseCsvLine } from '../data/csv';
import { CURRENT_SCHEMA_VERSION, readContinuitySchema, runV1ExportMigration } from '../data/ContinuityService';
import type { ContinuityContract, ContinuityDetection, ContinuityFileInput, ContinuityImportPort, ContinuityMigrationResult, ContinuityRowMatch, ContinuitySchemaPort, ContinuitySchemaState } from '../data/ContinuityContracts';
import { deleteSecret, getSecret, isSecretSettingKey, migrateLegacySecrets, setSecret, SECRET_SETTING_KEYS, type SecretSettingKey } from '../data/secrets';
import { SqliteCaptureRepository } from '../data/CaptureRepository';
import { CaptureValidationError, type AutoCapturePermission, type AutoCaptureSettings, type CaptureCandidate, type CaptureEventInput, type CaptureEventQuery, type CaptureRepository, type CaptureSource, type IncomeCandidate, type OnboardingSettings, type OnboardingSettingsStore, type RecurringTemplateHandoff } from '../data/contracts';
import { deleteOwnedReceiptImage, isOwnedReceiptImage } from '../utils/ownedReceiptImage';
import { formatCurrency, resolveCurrency } from '../utils/currency';
import { CurrencyConversionError, executeBulkCurrencyConversion, isExportableExpense, parseStoredBudget, toStoredBudget } from '../data/SettingsContracts';
import { parseMoneyAmount, type MoneyParse } from '../data/moneyInput';
import { parseImportDate } from '../data/dateInput';
import { CategoryService } from '../data/CategoryService';
import { computeNextDueDate, normalizeInterval, parseRecurrenceDays } from '../data/RecurringDataService';
import { CLEAR_ALL_DATA_MEDIA_SCOPE, RESET_APP_MEDIA_SCOPE } from '../data/MediaErasure';
import { eraseOwnedMediaForScope } from './MediaErasureService';
import { markDataChanged } from '../hooks/useDataFreshness';

const DATABASE_NAME = 'peachspend.db';
const ACHIEVEMENT_THRESHOLDS = {
  saver: 3,
  shopper: 1_000,
  bigLeague: 10_000,
} as const;

// BUG-09-11a. Every number the achievement catalogue needs, in one statement, so a
// save no longer pays for eight awaited aggregates. The min amount pair is a scalar
// subquery rather than a second statement, and it is served by idx_expenses_amount
// instead of the whole table sort the old `ORDER BY amount ASC LIMIT 1` caused. Both
// subqueries order by (amount, rowid) so they resolve to the same physical row: with a
// bare `ORDER BY amount ASC` two rows sharing the minimum amount could supply the
// amount from one and the currency from the other, and the saver badge would state its
// threshold in a currency that held no such expense. The detail count is deliberately
// the same expression as before, `note != '' OR is_reimbursable = 1`, so a null note
// still does not count as detail.
const ACHIEVEMENT_TOTALS_SQL = `
  SELECT
    COUNT(*) AS expense_count,
    COALESCE(SUM(CASE WHEN scanned = 1 THEN 1 ELSE 0 END), 0) AS scanned_count,
    COALESCE(SUM(amount), 0) AS total_spent,
    COUNT(DISTINCT category) AS distinct_categories,
    COALESCE(SUM(CASE WHEN note IS NOT NULL AND note != '' THEN 1 ELSE 0 END), 0) AS note_count,
    COALESCE(SUM(CASE WHEN (note IS NOT NULL AND note != '') OR is_reimbursable = 1 THEN 1 ELSE 0 END), 0) AS detail_count,
    (SELECT amount FROM expenses ORDER BY amount ASC, rowid ASC LIMIT 1) AS min_amount,
    (SELECT currency FROM expenses ORDER BY amount ASC, rowid ASC LIMIT 1) AS min_currency,
    (SELECT COUNT(*) FROM recurring_templates) AS recurring_count
  FROM expenses
`;

interface AchievementTotals {
  expense_count: number;
  scanned_count: number;
  total_spent: number;
  distinct_categories: number;
  note_count: number;
  detail_count: number;
  min_amount: number | null;
  min_currency: string | null;
  recurring_count: number;
}

const EMPTY_ACHIEVEMENT_TOTALS: AchievementTotals = {
  expense_count: 0,
  scanned_count: 0,
  total_spent: 0,
  distinct_categories: 0,
  note_count: 0,
  detail_count: 0,
  min_amount: null,
  min_currency: null,
  recurring_count: 0,
};

// The stored streak read from a settings snapshot the caller already loaded. Both
// achievement passes used to read the whole settings table a second time through
// getStreak() for this one number.
function streakFromSettings(settings: Record<string, string>): number {
  return parseInt(settings.last_streak) || 0;
}

// Public settings whose values are financial or personally identifying. Their
// values are registered for logger redaction before persistence, so an error that
// later echoes a bound parameter cannot surface the raw amount or profile name.
const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set(['profile_name', 'monthly_budget']);

function achievementAmount(amount: number, currency: string): string {
  return formatCurrency(amount, currency);
}

type ExportableExpense = Expense & {
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  date: number;
};

// Re-derives the validated shape the CSV writer has always required. The field
// rules live in the shared isExportableExpense so the S-06 preview and the CSV
// writer cannot disagree about which rows will be written.
function toExportableExpense(expense: Expense): ExportableExpense | null {
  return isExportableExpense(expense).valid ? (expense as ExportableExpense) : null;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// BUG-09-11b freshness signal for the ledger. Every expense and income write in
// the app goes through the capture repository, whether the caller is manual entry,
// the scan confirm flow, the share intake, the expense review sheet, the auto
// capture host, the chat action handler or the import commit, so the change token
// is published here rather than at each of those call sites, where a later writer
// could forget it. Only the three saving methods publish; every read and every
// non ledger write is delegated unchanged, so no existing behaviour or return
// shape moves.
class PublishingCaptureRepository implements CaptureRepository {
  constructor(private readonly inner: CaptureRepository) {}

  private publish<T>(operation: Promise<T>): Promise<T> {
    return operation.then(result => {
      markDataChanged('ledger');
      return result;
    });
  }

  findDuplicate(candidate: Pick<CaptureCandidate, 'merchant' | 'amount' | 'date'>) {
    return this.inner.findDuplicate(candidate);
  }

  findBatchDuplicates(candidates: CaptureCandidate[]) {
    return this.inner.findBatchDuplicates(candidates);
  }

  save(candidate: CaptureCandidate, allowDuplicate?: boolean) {
    return this.publish(this.inner.save(candidate, allowDuplicate));
  }

  saveBatch(candidates: CaptureCandidate[], allowDuplicates?: boolean) {
    return this.publish(this.inner.saveBatch(candidates, allowDuplicates));
  }

  findIncomeDuplicate(candidate: Pick<IncomeCandidate, 'sourceName' | 'amount' | 'date'>) {
    return this.inner.findIncomeDuplicate(candidate);
  }

  saveIncome(candidate: IncomeCandidate, allowDuplicate?: boolean) {
    return this.publish(this.inner.saveIncome(candidate, allowDuplicate));
  }

  withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    return this.inner.withTransaction(operation);
  }

  getRecurringTemplateHandoff(): RecurringTemplateHandoff {
    return this.inner.getRecurringTemplateHandoff();
  }

  rememberCategory(merchant: string, category: string, source: CaptureSource) {
    return this.inner.rememberCategory(merchant, category, source);
  }

  getRememberedCategory(merchant: string) {
    return this.inner.getRememberedCategory(merchant);
  }

  recordEvent(event: CaptureEventInput) {
    return this.inner.recordEvent(event);
  }

  listEvents(query?: CaptureEventQuery) {
    return this.inner.listEvents(query);
  }

  enqueueAutoCapture(payload: CaptureCandidate) {
    return this.inner.enqueueAutoCapture(payload);
  }

  claimQueuedAutoCaptures(now?: number) {
    return this.inner.claimQueuedAutoCaptures(now);
  }

  completeQueuedAutoCapture(id: string) {
    return this.inner.completeQueuedAutoCapture(id);
  }

  failQueuedAutoCapture(id: string, errorCode: string, retryAt: number) {
    return this.inner.failQueuedAutoCapture(id, errorCode, retryAt);
  }

  discardQueuedAutoCaptures() {
    return this.inner.discardQueuedAutoCaptures();
  }
}
class DatabaseService implements OnboardingSettingsStore, ContinuityContract {
  private db: SQLite.SQLiteDatabase | null = null;
  // Single-flight handle for the first open. The open is async, so several
  // startup callers (SettingsProvider, ContinuityGate, the Home snapshot, the
  // auto-capture host) can all pass an `if (this.db)` guard before this.db is
  // assigned and each start their own SQLite.openDatabaseAsync on the same
  // file. A duplicate wrapper freeing the shared native handle is what left the
  // next prepareAsync null on device. Every path that touches the database goes
  // through init(), so they all await this one promise instead.
  private initPromise: Promise<void> | null = null;
  // Schema state captured before the migration runner advances the file. A v1
  // file reports 'v1' here even though user_version is 7 by the time any reader
  // sees it.
  private startupSchema: ContinuitySchemaState | null = null;
  private startupUserVersion = 0;

  // One aggregate read shared by both achievement passes: checkAchievements and
  // getBadgeProgress ask for the same nine numbers.
  private async readAchievementTotals(db: SQLite.SQLiteDatabase): Promise<AchievementTotals> {
    const row = await db.getFirstAsync<AchievementTotals>(ACHIEVEMENT_TOTALS_SQL);
    return row ?? EMPTY_ACHIEVEMENT_TOTALS;
  }

  async getCaptureRepository(): Promise<CaptureRepository> {
    return new PublishingCaptureRepository(new SqliteCaptureRepository(await this.getDb()));
  }

  // The single accessor for the open handle. The init() call inside is
  // single-flight, so concurrent callers share one open and this.db is set when
  // it resolves.
  private async getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    const initPromise = this.openAndPrepare();
    this.initPromise = initPromise;
    try {
      await initPromise;
    } finally {
      // Clear the in-flight handle once it settles. A success leaves this.db set
      // so later callers return early; a failure leaves this.db null so a
      // genuine retry can open again rather than reusing a discarded promise.
      this.initPromise = null;
    }
  }

  private async openAndPrepare(): Promise<void> {
    try {
      this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      // DEC-32 detection runs against the file as opened, before the runner
      // touches it, so a v1 file is classified as v1 rather than as its
      // post-migration version.
      const startup = await readContinuitySchema(this.continuitySchemaPort(this.db));
      this.startupSchema = startup.schema;
      this.startupUserVersion = startup.userVersion;
      await this.createTables();
      await migrateLegacySecrets(key => this.getStoredSetting(key), key => this.deleteStoredSetting(key));
      await this.seedCategories();
      logger.info('Database initialized successfully');
    } catch (error) {
      await this.discardPartialOpen();
      logger.error('Failed to initialize database', 'database_init_failed');
      throw error;
    }
  }

  // A failed start must not leave a half-opened or stale handle behind: detach it
  // from the service and close it, so a retry opens a fresh connection instead of
  // reusing a partially initialized one. The close failure is swallowed so it can
  // never mask the original initialization error.
  private async discardPartialOpen(): Promise<void> {
    const db = this.db;
    this.db = null;
    this.startupSchema = null;
    this.startupUserVersion = 0;
    if (!db) return;
    try {
      await db.closeAsync();
    } catch {
      logger.warn('Discarded database handle could not be closed', 'database_discard_close_failed');
    }
  }

  private async createTables() {
    if (!this.db) return;
    await runMigrations(this.db);
  }

  // DEC-32 continuity. Detection reports the on-device schema and whether the
  // account already holds records, so a surface can render a new empty user or an
  // existing account without guessing. Migration moves a supplied v1 export into
  // the v2 schema; a v2-present file is never re-migrated, only read.
  async detectContinuity(): Promise<ContinuityDetection> {
    const db = await this.getDb();
    if (this.startupSchema === null) {
      const startup = await readContinuitySchema(this.continuitySchemaPort(db));
      this.startupSchema = startup.schema;
      this.startupUserVersion = startup.userVersion;
    }
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM income) as count'
    );
    return {
      schema: this.startupSchema,
      userVersion: this.startupUserVersion,
      currentVersion: CURRENT_SCHEMA_VERSION,
      hasRecords: (row?.count ?? 0) > 0,
    };
  }

  async migrateV1Export(input: ContinuityFileInput): Promise<ContinuityMigrationResult> {
    const result = await runV1ExportMigration(await this.getContinuityImportPort(), input);
    // The continuity restore is its own writer class: it lands through the
    // capture repository like any other save, but it is driven by a bulk port,
    // so it publishes once for the whole restore as well.
    if (result.status === 'imported' || result.status === 'partially_imported' || result.status === 'already_current') {
      markDataChanged('ledger');
    }
    return result;
  }

  private continuitySchemaPort(db: SQLite.SQLiteDatabase): ContinuitySchemaPort {
    return {
      getFirstAsync: <T>(source: string) => db.getFirstAsync<T>(source),
      getAllAsync: <T>(source: string) => db.getAllAsync<T>(source),
    };
  }

  // The single writer the continuity migration drives. Rows go through the shared
  // capture save boundary (so merchant memory and the capture audit log stay in
  // one place), and the whole batch shares one transaction so a failure rolls
  // back rather than half-importing.
  async getContinuityImportPort(): Promise<ContinuityImportPort> {
    const db = await this.getDb();
    const repository = await this.getCaptureRepository();
    return {
      ensureCategories: async names => { await new CategoryService(this).ensure(names); },
      countExisting: async (match: ContinuityRowMatch) => {
        const row = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM expenses WHERE source = 'import' AND merchant = ? AND amount = ? AND currency = ? AND category = ? AND scanned = ? AND date = ? AND COALESCE(note, '') = ?",
          [match.merchant, match.amount, match.currency, match.category, match.scanned, match.date, match.note],
        );
        return row?.count ?? 0;
      },
      saveRow: async (match: ContinuityRowMatch) => {
        await repository.save({
          merchant: match.merchant,
          amount: match.amount,
          currency: match.currency,
          category: match.category,
          date: match.date,
          note: match.note,
          source: 'import',
          scanned: match.scanned === 1,
        }, true);
      },
      withTransaction: operation => repository.withTransaction(operation),
    };
  }

  private async getStoredSetting(key: string): Promise<string | null> {
    return this.db?.getFirstAsync<Setting>('SELECT value FROM settings WHERE key = ?', [key]).then(row => row?.value || null) || null;
  }

  private async deleteStoredSetting(key: string): Promise<void> { await this.db?.runAsync('DELETE FROM settings WHERE key = ?', [key]); }

  private async seedCategories() {
    if (!this.db) return;

    const count = await this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM categories');
    if (count?.count === 0) {
      const defaultCategories: readonly [string, string, string, string][] = [
        ['dining', 'Dining', 'utensils', '#FFD2C4'],
        ['groceries', 'Groceries', 'shopping-cart', '#FFAB91'],
        ['transport', 'Transport', 'car', '#81C784'],
        ['shopping', 'Shopping', 'shopping-bag', '#FFD2C4'],
        ['entertainment', 'Entertainment', 'film', '#FFAB91'],
        ['health', 'Health', 'heart', '#CF6679'],
        ['utilities', 'Utilities', 'zap', '#81C784'],
        ['other', 'Other', 'more-horizontal', '#A18C87'],
      ];

      for (const cat of defaultCategories) {
        await this.db.runAsync(
          'INSERT INTO categories (id, title, icon_name, color, is_default) VALUES (?, ?, ?, ?, 1)',
          [cat[0], cat[1], cat[2], cat[3]]
        );
      }
    }
  }

  // Expenses
  async getExpenses(): Promise<Expense[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY date DESC');
  }

  async getExpensesForPeriod(startDate: number, endDate: number): Promise<Expense[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY date DESC',
      [startDate, endDate]
    );
  }

  async getExpenseById(id: string): Promise<Expense | null> {
    const db = await this.getDb();
    return await db.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
  }

  async saveExpense(expense: Expense) {
    const db = await this.getDb();
    if (!expense.merchant?.trim()) throw new CaptureValidationError('merchant');
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) throw new CaptureValidationError('amount');
    const currency = resolveCurrency(expense.currency, await this.getSetting('currency'));
    if (!expense.category?.trim()) throw new CaptureValidationError('category');

    const params: SQLite.SQLiteBindValue[] = [
      expense.id || Math.random().toString(36),
      expense.merchant,
      expense.amount,
       currency,
      expense.category,
      expense.note || '',
      expense.scanned || 0,
      expense.date || Date.now(),
      expense.created_at || Date.now(),
      expense.image_uri || null,
      expense.is_reimbursable || 0,
      expense.unit_price ?? null,
      expense.units ?? null,
      expense.source ?? null
    ];

    try {
      await db.runAsync(
        'INSERT OR REPLACE INTO expenses (id, merchant, amount, currency, category, note, scanned, date, created_at, image_uri, is_reimbursable, unit_price, units, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params
      );
      markDataChanged('ledger');
      logger.info(`Expense saved: ${expense.id}`);
    } catch (error) {
      logger.error('DatabaseService.saveExpense failed', 'expense_save_failed');
      throw error;
    }
  }

  async addExpense(expense: Expense) {
    return this.saveExpense(expense);
  }

  async deleteExpense(id: string) {
    const db = await this.getDb();

    const expense = await db.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
    if (expense?.image_uri && isOwnedReceiptImage(expense.image_uri)) {
      try {
        await deleteOwnedReceiptImage(expense.image_uri);
      } catch {
        logger.warn('Could not delete cached image file', 'image_delete_failed');
      }
    }

    await db.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
    markDataChanged('ledger');
    logger.info(`Expense deleted: ${id}`);
  }

  async updateExpenseNote(id: string, note: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET note = ? WHERE id = ?', [note, id]);
    markDataChanged('ledger');
  }

  // Single write boundary for an S-08 category correction. The learning-loop
  // decision (auto-capture only) lives in ExpenseDetailService so every caller
  // routes through the same rule instead of re-deriving it per screen.
  async updateExpenseCategory(id: string, category: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET category = ? WHERE id = ?', [category, id]);
    markDataChanged('ledger');
  }

  async updateExpenseReimbursable(id: string, isReimbursable: boolean): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET is_reimbursable = ? WHERE id = ?', [isReimbursable ? 1 : 0, id]);
    markDataChanged('ledger');
  }

  async getExpensesByCategory(): Promise<{ category: string; total: number }[]> {
    const db = await this.getDb();
    return await db.getAllAsync<{ category: string; total: number }>(
      'SELECT category, SUM(amount) as total FROM expenses GROUP BY category'
    );
  }

  async getExpensesByCategoryInRange(startDate: number, endDate: number): Promise<{ category: string; total: number }[]> {
    const db = await this.getDb();
    return await db.getAllAsync<{ category: string; total: number }>(
      'SELECT category, SUM(amount) as total FROM expenses WHERE date >= ? AND date <= ? GROUP BY category',
      [startDate, endDate]
    );
  }

  async getRecentExpensesInRange(limit: number, startDate: number, endDate: number): Promise<Expense[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT ?',
      [startDate, endDate, limit]
    );
  }

  // Resolves the S-05R-08 defect: every row is priced through the shared
  // normalizeCurrencyTotal layer, and a missing rate refuses the whole batch
  // instead of substituting 1. Never updates rows at an assumed parity.
  async convertExpenses(targetCurrency: string) {
    const db = await this.getDb();
    const expenses = await db.getAllAsync<Expense>('SELECT * FROM expenses');
    const rates = await this.getSetting('conversion_rates');
    const outcome = await executeBulkCurrencyConversion(this, expenses, targetCurrency, rates);
    if (outcome.status === 'refused') throw new CurrencyConversionError(outcome.missingRates);
    markDataChanged('ledger');
    logger.info(`Converted ${outcome.convertedCount} expense row(s) to ${targetCurrency}`);
    return outcome;
  }

  async updateExpenseCurrency(id: string, amount: number, currency: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET amount = ?, currency = ? WHERE id = ?', [amount, currency, id]);
    markDataChanged('ledger');
  }

  // Categories
  async getCategories(): Promise<{ id: string; title: string; icon_name: string; color: string; is_default?: number }[]> {
    const db = await this.getDb();
    return await db.getAllAsync<{ id: string; title: string; icon_name: string; color: string }>(
      'SELECT * FROM categories'
    );
  }

  async addCategory(title: string, icon: string, color: string) {
    const db = await this.getDb();
    const id = title.toLowerCase().replace(/\s+/g, '-');
    await db.runAsync(
      'INSERT INTO categories (id, title, icon_name, color, is_default) VALUES (?, ?, ?, ?, 0)',
      [id, title, icon, color]
    );
    markDataChanged('ledger');
    return id;
  }

  async renameCategory(id: string, newTitle: string) {
    const db = await this.getDb();
    await db.runAsync(
      'UPDATE categories SET title = ? WHERE id = ?',
      [newTitle, id]
    );
    markDataChanged('ledger');
  }

  async updateCategoryColor(id: string, color: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE categories SET color = ? WHERE id = ?', [color, id]);
    markDataChanged('ledger');
  }

  async updateCategoryIcon(id: string, iconName: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE categories SET icon_name = ? WHERE id = ?', [iconName, id]);
    markDataChanged('ledger');
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    const db = await this.getDb();
    if (isSecretSettingKey(key)) return null;
    const result = await db.getFirstAsync<Setting>('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
  }
  
  async getAllSettings(): Promise<Record<string, string>> {
    const db = await this.getDb();
    const results = await db.getAllAsync<Setting>('SELECT * FROM settings');
    const settings: Record<string, string> = {};
    results.forEach(s => {
      if (isSecretSettingKey(s.key)) return;
      settings[s.key] = s.value || '';
    });
    return settings;
  }

  async getSecret(key: SecretSettingKey): Promise<string | null> {
    return getSecret(key);
  }

  async hasSecret(key: SecretSettingKey): Promise<boolean> {
    return (await getSecret(key)) !== null;
  }

  private async writePublicSetting(db: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
    if (SENSITIVE_SETTING_KEYS.has(key)) registerSensitiveValue(value);
    await db.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
    // One publisher for the settings table: updateSetting, completeOnboarding and
    // the auto capture settings write all funnel through here, so a settings
    // change cannot reach the table without waking the screens that read it.
    markDataChanged('settings');
  }

  async updateSetting(key: string, value: string) {
    const db = await this.getDb();
    if (isSecretSettingKey(key)) {
      await setSecret(key, value);
      // F-07. A provider key write changes what the AI layer will call, so it
      // publishes the same settings token a public setting does and the screens
      // that cache provider output drop it. The token carries no key material:
      // it is a revision integer per domain, never a value.
      markDataChanged('settings');
      return;
    }
    await this.writePublicSetting(db, key, value);
  }

  async isOnboardingComplete(): Promise<boolean> {
    return (await this.getSetting('onboarding_complete')) === 'true';
  }

  // FR-01.7: complete and skip both funnel here. One transaction writes the whole
  // onboarding state, and the completion flag lands last, so a failed earlier
  // write can never strand a half-configured install as onboarded. Budget currency
  // follows the setup currency so Home never reconverts a value the user typed in
  // the currency they chose during setup. The join date is written here so S-05
  // has a real install date; existing installs fall back to their earliest record.
  // BUG-09-04a: the typed budget goes through the one canonical write rule, so a
  // thousands separator, a currency symbol, or letters can no longer be stored as
  // the budget. An entry that cannot be parsed is not written (E-12), and a blank
  // entry keeps its existing meaning of no budget row at all.
  async completeOnboarding(settings: OnboardingSettings): Promise<void> {
    const db = await this.getDb();
    const profileName = settings.profileName?.trim();
    const storedBudget = toStoredBudget(settings.monthlyBudget);

    await db.execAsync('BEGIN');
    try {
      await this.writePublicSetting(db, 'currency', settings.currency);
      await this.writePublicSetting(db, 'budget_currency', settings.currency);
      if (profileName) await this.writePublicSetting(db, 'profile_name', profileName);
      if (storedBudget !== null) await this.writePublicSetting(db, 'monthly_budget', storedBudget);
      await this.writePublicSetting(db, 'profile_join_date', String(Date.now()));
      await this.writePublicSetting(db, 'onboarding_complete', 'true');
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      logger.error('Failed to complete onboarding settings', 'onboarding_write_failed');
      throw error;
    }
  }

  async getAutoCaptureSettings(): Promise<AutoCaptureSettings> {
    const enabled = (await this.getSetting('auto_capture_enabled')) === 'true';
    const permission = (await this.getSetting('auto_capture_permission')) as AutoCapturePermission | null;
    return { enabled, permission: permission ?? 'unsupported' };
  }

  async updateAutoCaptureSettings(settings: Partial<AutoCaptureSettings>): Promise<AutoCaptureSettings> {
    if (settings.enabled !== undefined) await this.updateSetting('auto_capture_enabled', String(settings.enabled));
    if (settings.permission !== undefined) await this.updateSetting('auto_capture_permission', settings.permission);
    return this.getAutoCaptureSettings();
  }

  // Notifications
  async insertNotification(notification: {
    id: string;
    title: string;
    body: string;
    type?: string;
    data?: string;
  }) {
    const db = await this.getDb();
    await db.runAsync(
      'INSERT INTO notifications (id, title, body, type, data, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [notification.id, notification.title, notification.body, notification.type || 'expense', notification.data || null, Date.now()]
    );
    markDataChanged('notifications');
  }

  async getNotifications(): Promise<Notification[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Notification>('SELECT * FROM notifications ORDER BY created_at DESC');
  }

  async getUnreadNotificationCount(): Promise<number> {
    const db = await this.getDb();
    const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM notifications WHERE read = 0');
    return result?.count || 0;
  }

  async markNotificationRead(id: string) {
    const db = await this.getDb();
    await db.runAsync('UPDATE notifications SET read = 1 WHERE id = ?', [id]);
    markDataChanged('notifications');
  }

  async markAllNotificationsRead() {
    const db = await this.getDb();
    await db.runAsync('UPDATE notifications SET read = 1 WHERE read = 0');
    markDataChanged('notifications');
  }

  async deleteNotification(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM notifications WHERE id = ?', [id]);
    markDataChanged('notifications');
  }

  async clearAllNotifications() {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM notifications');
    markDataChanged('notifications');
  }

  async runAsync(sql: string, params: SQLite.SQLiteBindParams = []) {
    const db = await this.getDb();
    await db.runAsync(sql, params);
  }

  // Recurring Templates
  async insertRecurringTemplate(template: {
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    category: string;
    note?: string;
    interval: string;
    recurrence_days?: string;
    next_due_date: number;
    type?: string;
    created_at: number;
  }) {
    const db = await this.getDb();
    const currency = resolveCurrency(template.currency, await this.getSetting('currency'));
    await db.runAsync(
      'INSERT INTO recurring_templates (id, merchant, amount, currency, category, note, interval, recurrence_days, next_due_date, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [template.id, template.merchant, template.amount, currency, template.category, template.note || '', template.interval, template.recurrence_days || null, template.next_due_date, template.type || 'expense', template.created_at]
    );
    markDataChanged('ledger');
  }

  async getRecurringTemplates(type?: string): Promise<RecurringTemplate[]> {
    const db = await this.getDb();
    if (type) {
      return await db.getAllAsync<RecurringTemplate>('SELECT * FROM recurring_templates WHERE type = ? ORDER BY next_due_date ASC', [type]);
    }
    return await db.getAllAsync<RecurringTemplate>('SELECT * FROM recurring_templates ORDER BY next_due_date ASC');
  }

  async getDueRecurringTemplates(): Promise<RecurringTemplate[]> {
    const db = await this.getDb();
    const now = Date.now();
    return await db.getAllAsync<RecurringTemplate>(
      'SELECT * FROM recurring_templates WHERE next_due_date <= ? ORDER BY next_due_date ASC',
      [now]
    );
  }

  async updateRecurringNextDue(id: string, nextDue: number) {
    const db = await this.getDb();
    await db.runAsync(
      'UPDATE recurring_templates SET next_due_date = ? WHERE id = ?',
      [nextDue, id]
    );
    markDataChanged('ledger');
  }

  async deleteRecurringTemplate(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM recurring_templates WHERE id = ?', [id]);
    markDataChanged('ledger');
  }

  async getNextDueDate(interval: string, recurrence_days?: string, fromDate?: number): Promise<number> {
    return computeNextDueDate(normalizeInterval(interval), parseRecurrenceDays(recurrence_days), fromDate);
  }

  async updateRecurringTemplate(
    id: string,
    patch: {
      merchant: string;
      amount: number;
      currency: string;
      category: string;
      note?: string;
      interval: string;
      recurrence_days?: string;
      next_due_date: number;
      type?: string;
    },
  ) {
    const db = await this.getDb();
    const currency = resolveCurrency(patch.currency, await this.getSetting('currency'));
    await db.runAsync(
      'UPDATE recurring_templates SET merchant = ?, amount = ?, currency = ?, category = ?, note = ?, interval = ?, recurrence_days = ?, next_due_date = ?, type = ? WHERE id = ?',
      [patch.merchant, patch.amount, currency, patch.category, patch.note || '', patch.interval, patch.recurrence_days || null, patch.next_due_date, patch.type || 'expense', id]
    );
    markDataChanged('ledger');
  }

  // Income
  async insertIncome(income: {
    id: string;
    source: string;
    amount: number;
    currency: string;
    category: string;
    note?: string;
    is_recurring?: number;
    recurrence_interval?: string;
    next_due_date?: number;
    date: number;
    created_at: number;
  }) {
    const db = await this.getDb();
    const currency = resolveCurrency(income.currency, await this.getSetting('currency'));
    await db.runAsync(
      'INSERT INTO income (id, source, amount, currency, category, note, is_recurring, recurrence_interval, next_due_date, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [income.id, income.source, income.amount, currency, income.category, income.note || '', income.is_recurring || 0, income.recurrence_interval || null, income.next_due_date || null, income.date, income.created_at]
    );
    markDataChanged('ledger');
  }

  async getIncome(startDate?: number, endDate?: number): Promise<Income[]> {
    const db = await this.getDb();
    if (startDate && endDate) {
      return await db.getAllAsync<Income>('SELECT * FROM income WHERE date >= ? AND date <= ? ORDER BY date DESC', [startDate, endDate]);
    }
    return await db.getAllAsync<Income>('SELECT * FROM income ORDER BY date DESC');
  }

  async deleteIncome(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM income WHERE id = ?', [id]);
    markDataChanged('ledger');
  }

  async getNetBalance(startDate?: number, endDate?: number): Promise<number> {
    const db = await this.getDb();
    
    let incomeTotal = 0;
    let expenseTotal = 0;

    if (startDate && endDate) {
      const incomeResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE date >= ? AND date <= ?', [startDate, endDate]);
      incomeTotal = incomeResult?.total || 0;
      const expenseResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?', [startDate, endDate]);
      expenseTotal = expenseResult?.total || 0;
    } else {
      const incomeResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM income');
      incomeTotal = incomeResult?.total || 0;
      const expenseResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM expenses');
      expenseTotal = expenseResult?.total || 0;
    }

    return incomeTotal - expenseTotal;
  }

  // Duplicate detection stays delegated so every capture path uses transaction date.
  async isDuplicate(candidate: Pick<CaptureCandidate, 'merchant' | 'amount' | 'date'>): Promise<Expense | null> {
    const duplicate = await (await this.getCaptureRepository()).findDuplicate(candidate);
    return duplicate?.reason === 'merchant_amount_24h' ? duplicate.existing : null;
  }

  async exportToCSV(startDate: number, endDate: number, categories?: string[]): Promise<string> {
    const db = await this.getDb();
    let query = 'SELECT * FROM expenses WHERE date >= ? AND date <= ?';
    const params: SQLite.SQLiteBindValue[] = [startDate, endDate];
    
    if (categories && categories.length > 0) {
      query += ` AND category IN (${categories.map(() => '?').join(',')})`;
      params.push(...categories);
    }
    query += ' ORDER BY date DESC';
    
    const expenses = await db.getAllAsync<Expense>(query, params);
    
    const header = 'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image';
    const rows: string[] = [];
    expenses.forEach((expense, index) => {
      const validation = isExportableExpense(expense);
      const e = toExportableExpense(expense);
      if (!validation.valid || !e) {
        logger.warn(`Skipped invalid expense row ${index + 1}: ${validation.reason ?? 'unknown'}`, 'database_export_row_skipped');
        return;
      }

      const dateStr = new Date(e.date).toISOString().split('T')[0];
      const note = typeof e.note === 'string' ? e.note : '';
      rows.push(`${dateStr},${escapeCsv(e.merchant)},${e.amount},${escapeCsv(e.currency)},${escapeCsv(e.category)},${escapeCsv(note)},,${e.scanned},${e.image_uri ? 'yes' : 'no'}`);
    });
    
    return [header, ...rows].join('\n');
  }

  parseImportData(input: string): { expenses: Partial<Expense>[]; errors: string[] } {
    const errors: string[] = [];
    const trimmed = input.trim();

    // BUG-09-19. A date is read through the shared parse in ../data/dateInput.
    // `new Date(value)` used to be reached with anything, and an unreadable value
    // silently became `Date.now()`, so a row the file dated wrongly was stored as if
    // it had happened today: no error, no warning, and a wrong month, which moves an
    // expense between budget periods. A value the file supplies that cannot be read
    // now refuses the row, which is the decision BUG-09-15 made for an amount it
    // cannot read.
    //
    // A date the file does not supply at all is a different case and is not a
    // refusal. The import's documented default for an unknown date is the import
    // time: `EXTERNAL_IMPORT_PROMPT` tells the source to use today when the date is
    // unknown, the JSON shape in ../data/ImportContracts.ts marks `date` optional,
    // and a pinned test asserts that a JSON row without a date is not an error. That
    // default is stated here rather than left to a `||` a reader has to notice.
    const dateIsSupplied = (raw: unknown): boolean => {
      if (raw === undefined || raw === null) return false;
      return typeof raw === 'string' ? raw.trim() !== '' : true;
    };

    const dateErrorMessage = (prefix: string, raw: unknown): string =>
      `${prefix}: the date "${String(raw)}" could not be read, so the row was skipped`;

    // An absent, null or blank JSON numeric field stays absent, the same rule an
    // absent or blank date gets below, because both fields are optional in the
    // documented shape (`unit_price` and `units` are optional in `Expense` and in
    // `CaptureCandidate`). Every other JSON type is read through the shared parse,
    // which refuses a boolean, an array, a hex string or any other value `Number()`
    // would have coerced into a number the user never wrote.
    const readOptionalNumber = (raw: unknown): MoneyParse | null => {
      if (raw === undefined || raw === null) return null;
      if (typeof raw === 'string' && raw.trim() === '') return null;
      return parseMoneyAmount(typeof raw === 'number' || typeof raw === 'string' ? String(raw) : null);
    };

    // BUG-09-20. JSON is keyed, so a field count cannot shift a value into the wrong
    // column the way a CSV row can; what a JSON file can get wrong is the shape of the
    // item itself. A string, number, array or null is not a row. A null item used to
    // throw on its first property read, so the whole file was refused as `Invalid JSON
    // format. Check for syntax errors.` even though its syntax was fine. The item is
    // named and skipped instead, and that is the whole of the JSON shape check.
    const isRowObject = (value: unknown): boolean =>
      value !== null && typeof value === 'object' && !Array.isArray(value);

    // Try JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const expenses: Partial<Expense>[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const expErrors: string[] = [];
           if (!isRowObject(item)) {
             errors.push(`item ${i + 1}: the row is not a JSON object, so the row was skipped`);
             continue;
           }
           if (typeof item.merchant !== 'string' || !item.merchant.trim()) expErrors.push(`item ${i + 1}: missing merchant`);
           // A JSON amount is a number in the documented shape, and it is read through the
           // same shared parse as a CSV cell. Any other JSON type is refused rather than
           // coerced, because `Number(true)` is 1 and `Number("0x10")` is 16, both of which
           // used to be imported as a wrong amount with no message. The fallback zero is
           // only ever produced for a row the guard below skips, so an unreadable amount
           // never reaches the database as zero.
           const amountParse = parseMoneyAmount(typeof item.amount === 'number' || typeof item.amount === 'string' ? String(item.amount) : null);
           const amount = amountParse.valid ? amountParse.value : 0;
           if (!amountParse.valid || amount <= 0) expErrors.push(`item ${i + 1}: invalid amount`);

           // BUG-09-19. The date is read on the same terms as the amount above, and
           // a value the file supplies that cannot be read refuses the row instead of
           // becoming today. A date the file does not supply keeps the documented
           // import default, so an item without one is not an error.
           const dateParse = parseImportDate(item.date);
           if (!dateParse.valid && dateIsSupplied(item.date)) expErrors.push(dateErrorMessage(`item ${i + 1}`, item.date));

           // `unit_price` and `units` used to be passed straight through, so a JSON
           // string, boolean or array reached the repository and was stored as
           // whatever SQLite coerced it to. Each keeps its own field rule: `units` is
           // a whole count of at least one, the rule the receipt parser already
           // applies (`ai/parsing.ts`), and `unit_price` is a money amount that is not
           // negative. The parser's further check that `unit_price * units` equals the
           // amount is not applied here, because the import's `amount` is the row
           // total and a file may legitimately carry a pair that does not multiply to
           // it, so that check would refuse honest rows.
           const unitPriceParse = readOptionalNumber(item.unit_price);
           const unitsParse = readOptionalNumber(item.units);
           if (unitPriceParse && (!unitPriceParse.valid || unitPriceParse.value < 0)) expErrors.push(`item ${i + 1}: invalid unit_price`);
           if (unitsParse && (!unitsParse.valid || !Number.isInteger(unitsParse.value) || unitsParse.value < 1)) expErrors.push(`item ${i + 1}: invalid units`);

            const currency = typeof item.currency === 'string' ? item.currency.trim() : '';
            const category = typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
            if (!currency) expErrors.push(`item ${i + 1}: missing currency`);
            if (!category) expErrors.push(`item ${i + 1}: missing category`);
            if (expErrors.length > 0) {
             errors.push(...expErrors);
             continue;
           }
           expenses.push({
            id: Math.random().toString(36).substring(2, 15),
            merchant: String(item.merchant),
            amount,
             currency,
             category,
            note: item.note || '',
            scanned: item.scanned || 0,
            date: dateParse.valid ? dateParse.value : Date.now(),
            created_at: Date.now(),
            is_reimbursable: item.is_reimbursable || 0,
            unit_price: unitPriceParse && unitPriceParse.valid ? unitPriceParse.value : undefined,
            units: unitsParse && unitsParse.valid ? unitsParse.value : undefined,
          });
        }
        return { expenses, errors };
      } catch {
        errors.push('Invalid JSON format. Check for syntax errors.');
        return { expenses: [], errors };
      }
    }

    // CSV fallback, matches exportToCSV format
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) {
      errors.push('No data found. Paste JSON or CSV content.');
      return { expenses: [], errors };
    }

    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    // BUG-09-20. The field count the header declares, read with the same CSV reader as
    // the data rows below, so a quoted comma is one field on both sides. For a plain
    // header, which is every header this app or the v1 export writes, this equals
    // `header.length`, the token count the column lookups just below come from.
    const headerFieldCount = parseCsvLine(lines[0]).length;
    const dateIdx = header.indexOf('date');
    const merchantIdx = header.indexOf('merchant');
    const amountIdx = header.indexOf('amount');
    const currencyIdx = header.indexOf('currency');
    const categoryIdx = header.indexOf('category');
    const noteIdx = header.indexOf('note');
    const scannedIdx = header.indexOf('scanned');

     if (merchantIdx === -1 || amountIdx === -1 || currencyIdx === -1 || categoryIdx === -1 || dateIdx === -1) {
       errors.push('CSV must have "merchant", "amount", "currency", "category", and "date" columns.');
      return { expenses: [], errors };
    }

    const expenses: Partial<Expense>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      // BUG-09-20. A row whose field count differs from the header's shifts every
      // column after the differing one, so an unquoted grouped amount such as `2,900`
      // in a hand-edited file used to store amount 2 against a currency of `900` with
      // no error and no warning. The count is of parsed fields on both sides, so a
      // quoted field containing a comma is one field and a trailing empty field is a
      // field rather than a mismatch. The row is reported and skipped here, before any
      // column is read, so a shifted row can never be imported with shifted values.
      if (cols.length !== headerFieldCount) {
        errors.push(`CSV row ${i}: the row has ${cols.length} fields where the header declares ${headerFieldCount}, so the row was skipped`);
        continue;
      }
      const merchant = (cols[merchantIdx] || '').trim();
      const amountValue = cols[amountIdx]?.trim() || '';
      // BUG-09-15. `parseFloat` read `1,250.50` as 1 and `2,900` as 2, so a grouped cell
      // was imported as its first digit with no error and no warning. The shared parse
      // reads a grouped amount as its true value, and a cell it cannot read is reported
      // below instead of being written as a truncated number or as zero.
      const amount = parseMoneyAmount(amountValue);
      const currency = cols[currencyIdx]?.trim() || '';
      const category = cols[categoryIdx]?.toLowerCase().trim() || '';
      // BUG-09-19. The header carries a date column, so a row whose date cell is
      // empty or unreadable is a row this file did not date. It is skipped and named
      // rather than stored as today, which used to move the expense into the current
      // month with no error and no warning. An empty date cell is treated exactly as
      // an empty amount cell is above, with the same wording.
      const dateValue = (cols[dateIdx] || '').trim();
      const date = parseImportDate(dateValue);

      if (!merchant || !amountValue || !currency || !category || !dateValue) {
        errors.push(`CSV row ${i}: skipped invalid entry`);
        continue;
      }
      if (!amount.valid) {
        errors.push(`CSV row ${i}: the amount "${amountValue}" could not be read, so the row was skipped`);
        continue;
      }
      if (!date.valid) {
        errors.push(`CSV row ${i}: the date "${dateValue}" could not be read, so the row was skipped`);
        continue;
      }
      if (amount.value <= 0) {
        errors.push(`CSV row ${i}: skipped invalid entry`);
        continue;
      }

      expenses.push({
        id: Math.random().toString(36).substring(2, 15),
        merchant,
        amount: amount.value,
        currency,
        category,
        note: noteIdx !== -1 ? (cols[noteIdx] || '').replace(/""/g, '"') : '',
        scanned: scannedIdx !== -1 ? parseInt(cols[scannedIdx] || '0') || 0 : 0,
        date: date.value,
        created_at: Date.now(),
        is_reimbursable: 0,
        unit_price: undefined,
        units: undefined,
      });
    }

    return { expenses, errors };
  }

  async importExpenses(expenses: Partial<Expense>[]): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    // Collect unique categories that need to be created
     const uniqueCats = new Set(expenses.map(e => e.category?.toLowerCase()).filter((category): category is string => Boolean(category)));
    // Category provisioning routes through the single S-16 writer so a CSV can
    // never introduce a category outside the shared validation or a second slug.
    const categoryService = new CategoryService(this);
    await categoryService.ensure([...uniqueCats]);

    const repository = await this.getCaptureRepository();
    for (let i = 0; i < expenses.length; i++) {
      try {
        const expense = expenses[i];
         if (!expense.merchant?.trim()) throw new CaptureValidationError('merchant');
         const amount = expense.amount;
         if (amount === undefined || !Number.isFinite(amount) || amount <= 0) throw new CaptureValidationError('amount');
         if (!expense.currency?.trim()) throw new CaptureValidationError('currency');
         if (!expense.category?.trim()) throw new CaptureValidationError('category');
         await repository.save({
           merchant: expense.merchant, amount,
           currency: expense.currency, category: expense.category,
          note: expense.note, date: expense.date || Date.now(), source: 'import',
          scanned: expense.scanned === 1, unitPrice: expense.unit_price, units: expense.units,
        });
        imported++;
      } catch {
         errors.push(`Item ${i + 1}: import_save_failed`);
      }
    }
    return { imported, errors };
  }

  // Achievements & Streaks
  //
  // BUG-09-11a. This used to cost one statement per badge in the catalogue, plus eight
  // aggregates, plus a second settings read: 36 round trips on a save, 37 when a budget
  // is set and getStreak() re-reads the settings table, and the count grew with the
  // badge catalogue. It is now three reads, a single settings snapshot, and the earned
  // set read once instead of probed per badge. The badge catalogue, its order, and every
  // threshold below are unchanged, so the ids returned and the order celebrations queue
  // in are identical.
  async checkAchievements(): Promise<string[]> {
    const db = await this.getDb();
    const allSettings = await this.getAllSettings();
    const monthlyBudget = parseStoredBudget(allSettings.monthly_budget);
    const streak = monthlyBudget > 0 ? streakFromSettings(allSettings) : 0;

    const totals = await this.readAchievementTotals(db);
    const exportCount = parseInt(allSettings.export_count) || 0;
    const minExpense = totals.min_amount || 0;
    const earnedIds = new Set((await db.getAllAsync<{ id: string }>('SELECT id FROM achievements')).map(row => row.id));

    const badgeDefs: { id: string; check: () => boolean }[] = [
      // Existing
      { id: 'first_step', check: () => totals.expense_count >= 1 },
      { id: 'eagle_eye', check: () => totals.scanned_count >= 1 },
      { id: 'on_repeat', check: () => totals.recurring_count >= 1 },
      { id: 'paper_trail', check: () => exportCount >= 1 },
      { id: 'detail_devil', check: () => totals.detail_count >= 1 },
      { id: 'week_warrior', check: () => streak >= 7 },
      { id: 'month_master', check: () => streak >= 30 },
      // Expense Milestones
      { id: 'getting-started', check: () => totals.expense_count >= 5 },
      { id: 'regular', check: () => totals.expense_count >= 25 },
      { id: 'century', check: () => totals.expense_count >= 100 },
      // Scan Milestones
      { id: 'sneak-peek', check: () => totals.scanned_count >= 3 },
      { id: 'shutterbug', check: () => totals.scanned_count >= 15 },
      { id: 'scanner-king', check: () => totals.scanned_count >= 50 },
      // Streak Extensions
      { id: 'fortnight', check: () => streak >= 14 },
      { id: 'season', check: () => streak >= 60 },
      { id: 'half-year-hero', check: () => streak >= 180 },
      // Category Exploration
      { id: 'variety', check: () => totals.distinct_categories >= 3 },
      { id: 'explorer', check: () => totals.distinct_categories >= 5 },
      { id: 'completionist', check: () => totals.distinct_categories >= 8 },
      // Spending & Saving
      { id: 'saver', check: () => minExpense > 0 && minExpense <= ACHIEVEMENT_THRESHOLDS.saver },
      { id: 'shopper', check: () => totals.total_spent >= ACHIEVEMENT_THRESHOLDS.shopper },
      { id: 'big-league', check: () => totals.total_spent >= ACHIEVEMENT_THRESHOLDS.bigLeague },
      // Recurring & Notes
      { id: 'habit', check: () => totals.recurring_count >= 2 },
      { id: 'loyalist', check: () => totals.recurring_count >= 5 },
      { id: 'novelist', check: () => totals.note_count >= 5 },
      // Budget
      { id: 'on-track', check: () => streak >= 7 },
      { id: 'disciplined', check: () => streak >= 30 },
    ];

    const newBadges: string[] = [];
    for (const badge of badgeDefs) {
      if (earnedIds.has(badge.id)) continue;
      if (!badge.check()) continue;
      await db.runAsync('INSERT INTO achievements (id, earned_at) VALUES (?, ?)', [badge.id, Date.now()]);
      newBadges.push(badge.id);
    }
    if (newBadges.length > 0) markDataChanged('ledger');

    return newBadges;
  }

  async getAchievements(): Promise<{ id: string; earned_at: number | null }[]> {
    const db = await this.getDb();
    const all = await db.getAllAsync<{ id: string; earned_at: number | null }>('SELECT * FROM achievements');
    const allBadges = [
      'first_step', 'eagle_eye', 'on_repeat', 'week_warrior', 'month_master', 'paper_trail', 'detail_devil',
      'getting-started', 'regular', 'century',
      'sneak-peek', 'shutterbug', 'scanner-king',
      'fortnight', 'season', 'half-year-hero',
      'variety', 'explorer', 'completionist',
      'saver', 'shopper', 'big-league',
      'habit', 'loyalist', 'novelist',
      'on-track', 'disciplined',
    ];
    return allBadges.map(id => {
      const found = all.find(a => a.id === id);
      return { id, earned_at: found?.earned_at || null };
    });
  }

  async getBadgeProgress(cachedSettings?: Record<string, string>): Promise<{
    id: string;
    label: string;
    description: string;
    icon: string;
    earned_at: number | null;
    current: number;
    target: number;
  }[]> {
    const db = await this.getDb();
    // One settings read for the pass, and the streak comes out of that snapshot rather
    // than a second read of the settings table (BUG-09-11a). The streak is
    // unconditional here, as it was before: the profile view shows streak progress even
    // with no budget set.
    const allSettings = cachedSettings ?? (await this.getAllSettings());
    const streak = streakFromSettings(allSettings);
    const totals = await this.readAchievementTotals(db);
    const expenseCount = totals.expense_count;
    const scannedCount = totals.scanned_count;
    const recurringCount = totals.recurring_count;
    const exportCount = parseInt(allSettings.export_count) || 0;
    const detailCount = totals.detail_count;
    const totalSpent = totals.total_spent;
    const distinctCategoriesCount = totals.distinct_categories;
    const minExpense = totals.min_amount || 0;
    const userCurrency = resolveCurrency(undefined, allSettings.currency);
    const saverCurrency = resolveCurrency(totals.min_currency, userCurrency);
    const noteCount = totals.note_count;

    const achievements = await db.getAllAsync<{ id: string; earned_at: number }>('SELECT * FROM achievements');

    const badgeData: { id: string; label: string; description: string; icon: string; current: number; target: number }[] = [
      // Existing
      { id: 'first_step', label: 'First Step', description: 'First expense logged', icon: 'Seedling', current: Math.min(expenseCount, 1), target: 1 },
      { id: 'eagle_eye', label: 'Eagle Eye', description: 'First receipt scanned', icon: 'Camera', current: Math.min(scannedCount, 1), target: 1 },
      { id: 'on_repeat', label: 'On Repeat', description: 'First recurring expense', icon: 'Repeat', current: Math.min(recurringCount, 1), target: 1 },
      { id: 'week_warrior', label: 'Week Warrior', description: '7-day streak', icon: 'Flame', current: Math.min(streak, 7), target: 7 },
      { id: 'month_master', label: 'Month Master', description: '30-day streak', icon: 'Diamond', current: Math.min(streak, 30), target: 30 },
      { id: 'paper_trail', label: 'Paper Trail', description: 'First CSV export', icon: 'Export', current: Math.min(exportCount, 1), target: 1 },
      { id: 'detail_devil', label: 'Detail Devil', description: 'First note or tag', icon: 'Tag', current: Math.min(detailCount, 1), target: 1 },
      // Expense Milestones
      { id: 'getting-started', label: 'Getting Started', description: '5 expenses logged', icon: 'Launch', current: Math.min(expenseCount, 5), target: 5 },
      { id: 'regular', label: 'Regular', description: '25 expenses logged', icon: 'Chart', current: Math.min(expenseCount, 25), target: 25 },
      { id: 'century', label: 'Century', description: '100 expenses logged', icon: 'Goal', current: Math.min(expenseCount, 100), target: 100 },
      // Scan Milestones
      { id: 'sneak-peek', label: 'Sneak Peek', description: '3 receipts scanned', icon: 'View', current: Math.min(scannedCount, 3), target: 3 },
      { id: 'shutterbug', label: 'Shutterbug', description: '15 receipts scanned', icon: 'Camera', current: Math.min(scannedCount, 15), target: 15 },
      { id: 'scanner-king', label: 'Scanner King', description: '50 receipts scanned', icon: 'Crown', current: Math.min(scannedCount, 50), target: 50 },
      // Streak Extensions
      { id: 'fortnight', label: 'Fortnight', description: '14-day streak', icon: 'Moon', current: Math.min(streak, 14), target: 14 },
      { id: 'season', label: 'Season', description: '60-day streak', icon: 'Leaf', current: Math.min(streak, 60), target: 60 },
      { id: 'half-year-hero', label: 'Half-Year Hero', description: '180-day streak', icon: 'Lightning', current: Math.min(streak, 180), target: 180 },
      // Category Exploration
      { id: 'variety', label: 'Variety', description: '3 categories used', icon: 'Palette', current: Math.min(distinctCategoriesCount, 3), target: 3 },
      { id: 'explorer', label: 'Explorer', description: '5 categories used', icon: 'Map', current: Math.min(distinctCategoriesCount, 5), target: 5 },
      { id: 'completionist', label: 'Completionist', description: 'All 8 categories used', icon: 'Trophy', current: Math.min(distinctCategoriesCount, 8), target: 8 },
      // Spending & Saving
      { id: 'saver', label: 'Saver', description: `Single expense ≤ ${achievementAmount(ACHIEVEMENT_THRESHOLDS.saver, saverCurrency)}`, icon: 'Pig', current: minExpense > 0 && minExpense <= ACHIEVEMENT_THRESHOLDS.saver ? 1 : 0, target: 1 },
      { id: 'shopper', label: 'Shopper', description: `${achievementAmount(ACHIEVEMENT_THRESHOLDS.shopper, userCurrency)} total spent`, icon: 'Shopping', current: Math.min(Math.floor(totalSpent / (ACHIEVEMENT_THRESHOLDS.shopper / 10)), 10), target: 10 },
      { id: 'big-league', label: 'Big League', description: `${achievementAmount(ACHIEVEMENT_THRESHOLDS.bigLeague, userCurrency)} total spent`, icon: 'Money', current: Math.min(Math.floor(totalSpent / (ACHIEVEMENT_THRESHOLDS.bigLeague / 10)), 10), target: 10 },
      // Recurring & Notes
      { id: 'habit', label: 'Habit', description: '2 recurring expenses', icon: 'Recycle', current: Math.min(recurringCount, 2), target: 2 },
      { id: 'loyalist', label: 'Loyalist', description: '5 recurring expenses', icon: 'Badge', current: Math.min(recurringCount, 5), target: 5 },
      { id: 'novelist', label: 'Novelist', description: '5 expenses with notes', icon: 'Note', current: Math.min(noteCount, 5), target: 5 },
      // Budget
      { id: 'on-track', label: 'On Track', description: '7-day budget streak', icon: 'Trend', current: Math.min(streak, 7), target: 7 },
      { id: 'disciplined', label: 'Disciplined', description: '30-day budget streak', icon: 'Mindful', current: Math.min(streak, 30), target: 30 },
    ];

    return badgeData.map(b => ({
      ...b,
      earned_at: achievements.find(a => a.id === b.id)?.earned_at || null,
    }));
  }

  async getStreak(): Promise<number> {
    return streakFromSettings(await this.getAllSettings());
  }

  async incrementStreak(): Promise<number> {
    const allSettings = await this.getAllSettings();
    const currentStreak = parseInt(allSettings.last_streak) || 0;
    const newStreak = currentStreak + 1;
    await this.updateSetting('last_streak', newStreak.toString());
    return newStreak;
  }

  async getExpenseCount(): Promise<number> {
    const db = await this.getDb();
    const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM expenses');
    return result?.count || 0;
  }

  // Streak advancement counts any logging activity, expense or income, per
  // FR-11.3: logging income advances the daily streak exactly like an expense.
  async hasAnyLoggingActivity(): Promise<boolean> {
    const db = await this.getDb();
    const result = await db.getFirstAsync<{ count: number }>(
      'SELECT (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM income) as count'
    );
    return (result?.count || 0) > 0;
  }

  // Chat Messages
  async saveChatMessage(msg: {
    id?: string;
    role: string;
    content: string;
    message_type: string;
    image_uri?: string;
    created_at: number;
    model?: string;
  }) {
    const db = await this.getDb();
    await db.runAsync(
      'INSERT INTO chat_messages (id, role, content, message_type, image_uri, created_at, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [msg.id || Math.random().toString(36).substring(2, 15), msg.role, msg.content, msg.message_type, msg.image_uri || null, msg.created_at, msg.model || null]
    );
  }

  async getChatHistory(): Promise<ChatMessage[]> {
    const db = await this.getDb();
    return await db.getAllAsync<ChatMessage>('SELECT * FROM chat_messages ORDER BY created_at ASC');
  }

  async clearChatHistory() {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM chat_messages');
  }

  async deleteChatMessage(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM chat_messages WHERE id = ?', [id]);
  }

  // Context-building queries for AIChatService
  async getMonthlySummary(startDate: number, endDate: number): Promise<{
    totalSpent: number;
    totalIncome: number;
    expenseCount: number;
    topCategory: { category: string; total: number } | null;
    biggestExpense: Expense | null;
  }> {
    const db = await this.getDb();

    const expenseResult = await db.getFirstAsync<{ total: number; count: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date >= ? AND date <= ?',
      [startDate, endDate]
    );

    const incomeResult = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE date >= ? AND date <= ?',
      [startDate, endDate]
    );

    const categoryBreaks = await db.getAllAsync<{ category: string; total: number }>(
      'SELECT category, SUM(amount) as total FROM expenses WHERE date >= ? AND date <= ? GROUP BY category ORDER BY total DESC LIMIT 1',
      [startDate, endDate]
    );

    const biggest = await db.getFirstAsync<Expense>(
      'SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY amount DESC LIMIT 1',
      [startDate, endDate]
    );

    return {
      totalSpent: expenseResult?.total || 0,
      totalIncome: incomeResult?.total || 0,
      expenseCount: expenseResult?.count || 0,
      topCategory: categoryBreaks[0] || null,
      biggestExpense: biggest || null,
    };
  }

  async getCategorySpend(category: string, startDate: number, endDate: number): Promise<{
    total: number;
    count: number;
    recent: Expense[];
  }> {
    const db = await this.getDb();
    const agg = await db.getFirstAsync<{ total: number; count: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE LOWER(category) = LOWER(?) AND date >= ? AND date <= ?',
      [category, startDate, endDate]
    );
    const recent = await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE LOWER(category) = LOWER(?) AND date >= ? AND date <= ? ORDER BY date DESC LIMIT 5',
      [category, startDate, endDate]
    );
    return {
      total: agg?.total || 0,
      count: agg?.count || 0,
      recent,
    };
  }

  async getMerchantSpend(merchant: string, limit = 5): Promise<Expense[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE LOWER(merchant) LIKE LOWER(?) ORDER BY date DESC LIMIT ?',
      [`%${merchant}%`, limit]
    );
  }

  // F-09, F-10. The newest rows regardless of period, served by idx_expenses_date and
  // bounded in SQL, so a screen that shows "recent" does not depend on a period filter
  // and does not pull the ledger into memory. A limit that is not a usable count asks
  // for no rows: SQLite reads a negative LIMIT as "no limit", which would return the
  // whole table to a caller that asked for five.
  async getRecentExpenses(limit = 10): Promise<Expense[]> {
    const db = await this.getDb();
    const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    return await db.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY date DESC LIMIT ?', [boundedLimit]);
  }

  async getReimbursableTotal(): Promise<{ total: number; expenses: Expense[] }> {
    const db = await this.getDb();
    const total = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_reimbursable = 1'
    );
    const expenses = await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE is_reimbursable = 1 ORDER BY date DESC'
    );
    return { total: total?.total || 0, expenses };
  }

  async getBudgetStatus(monthlyBudget: number, startDate: number, endDate: number): Promise<{
    spent: number;
    remaining: number;
    usedPercent: number;
    dailySpendRate: number;
    daysRemaining: number;
  }> {
    const db = await this.getDb();
    const result = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?',
      [startDate, endDate]
    );
    const spent = result?.total || 0;
    const now = Date.now();
    const daysElapsed = Math.max(1, Math.floor((now - startDate) / 86400000));
    const totalDays = Math.max(1, Math.ceil((endDate - startDate) / 86400000));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const dailySpendRate = spent / daysElapsed;
    const remaining = Math.max(0, monthlyBudget - spent);
    const usedPercent = monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : 0;

    return { spent, remaining, usedPercent, dailySpendRate, daysRemaining };
  }

  async getIncomeForPeriod(startDate: number, endDate: number): Promise<number> {
    const db = await this.getDb();
    const result = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE date >= ? AND date <= ?',
      [startDate, endDate]
    );
    return result?.total || 0;
  }

  // Returns the period income rows with their stored currency so the shared
  // normalization layer can convert mixed-currency income before summing, rather
  // than this method summing raw amounts across currencies.
  async getIncomesForPeriod(startDate: number, endDate: number): Promise<Income[]> {
    const db = await this.getDb();
    return db.getAllAsync<Income>('SELECT * FROM income WHERE date >= ? AND date <= ?', [startDate, endDate]);
  }

  // D8 / FR-06.6 and D9 / S-06R-02: Clear All Data clears the user's financial
  // records and their dependent rows in one transaction, and removes the owned
  // receipt images those expense rows point at before COMMIT, so the rows and the
  // imagery leave together. Categories, settings, API keys, achievements, avatars,
  // and merchant-category memory are deliberately kept (see CLEAR_ALL_DATA_SCOPE).
  // Reset App is a separate, wider boundary.
  async clearAllData() {
    const db = await this.getDb();
    await db.execAsync('BEGIN');
    try {
      const rows = await db.getAllAsync<{ image_uri: string | null }>('SELECT image_uri FROM expenses');
      const receiptImageUris = rows
        .map(row => row.image_uri)
        .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0);
      await db.runAsync('DELETE FROM expenses');
      await db.runAsync('DELETE FROM income');
      await db.runAsync("DELETE FROM chat_messages WHERE message_type = ?", ['expense_confirmation']);
      await db.runAsync('DELETE FROM capture_events');
      await db.runAsync('DELETE FROM capture_queue');
      const media = await eraseOwnedMediaForScope(CLEAR_ALL_DATA_MEDIA_SCOPE, receiptImageUris);
      if (media.failed > 0) logger.warn('Some cleared receipt images could not be erased', 'clear_all_data_media_partial');
      await db.execAsync('COMMIT');
      markDataChanged('ledger');
      markDataChanged('notifications');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      logger.error('Failed to clear transaction data', 'clear_all_data_failed');
      throw error;
    }
    logger.info('Transaction data purged');
  }

  async resetApp() {
    const db = await this.getDb();
    await db.execAsync(`
      DELETE FROM expenses;
      DELETE FROM categories;
      DELETE FROM recurring_templates;
      DELETE FROM achievements;
      DELETE FROM income;
      DELETE FROM chat_messages;
      DELETE FROM settings;
      DELETE FROM merchant_category_memory;
      DELETE FROM capture_events;
      DELETE FROM capture_queue;
    `);
    await Promise.all(SECRET_SETTING_KEYS.map(deleteSecret));
    await this.seedCategories();
    markDataChanged('ledger');
    markDataChanged('settings');
    markDataChanged('notifications');
    // D9 / S-06R-01: reset is the widest boundary, so it also removes every media
    // file the app wrote: receipt images, profile avatars, and export CSVs.
    const media = await eraseOwnedMediaForScope(RESET_APP_MEDIA_SCOPE);
    if (media.failed > 0) logger.warn('Some app media could not be erased on reset', 'reset_media_erase_partial');
    logger.warn('Complete app reset performed');
  }
}

export const databaseService = new DatabaseService();
