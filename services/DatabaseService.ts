import * as SQLite from 'expo-sqlite';
import { Expense, Income, Notification, RecurringTemplate, Setting, ChatMessage } from '../types/database';
import { logger, registerSensitiveValue } from '../utils/logger';
import { runMigrations } from '../data/migrations';
import { deleteSecret, getSecret, isSecretSettingKey, migrateLegacySecrets, setSecret, SECRET_SETTING_KEYS, type SecretSettingKey } from '../data/secrets';
import { SqliteCaptureRepository } from '../data/CaptureRepository';
import { CaptureValidationError, type AutoCapturePermission, type AutoCaptureSettings, type CaptureCandidate, type CaptureRepository, type OnboardingSettings, type OnboardingSettingsStore } from '../data/contracts';
import { deleteOwnedReceiptImage, isOwnedReceiptImage } from '../utils/ownedReceiptImage';
import { formatCurrency, resolveCurrency } from '../utils/currency';
import { CurrencyConversionError, executeBulkCurrencyConversion, isExportableExpense } from '../data/SettingsContracts';
import { CategoryService } from '../data/CategoryService';
import { computeNextDueDate, normalizeInterval, parseRecurrenceDays } from '../data/RecurringDataService';
import { CLEAR_ALL_DATA_MEDIA_SCOPE, RESET_APP_MEDIA_SCOPE } from '../data/MediaErasure';
import { eraseOwnedMediaForScope } from './MediaErasureService';

const DATABASE_NAME = 'peachspend.db';
const ACHIEVEMENT_THRESHOLDS = {
  saver: 3,
  shopper: 1_000,
  bigLeague: 10_000,
} as const;

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

class DatabaseService implements OnboardingSettingsStore {
  private db: SQLite.SQLiteDatabase | null = null;

  async getCaptureRepository(): Promise<CaptureRepository> {
    return new SqliteCaptureRepository(await this.getDb());
  }

  private async getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  async init() {
    if (this.db) return;

    try {
      this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await this.createTables();
      await migrateLegacySecrets(key => this.getStoredSetting(key), key => this.deleteStoredSetting(key));
      await this.seedCategories();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database', 'database_init_failed');
      throw error;
    }
  }

  private async createTables() {
    if (!this.db) return;
    await runMigrations(this.db);
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

  async getExpenseById(id: string): Promise<Expense | null> {
    const db = await this.getDb();
    return await db.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
  }

  async saveExpense(expense: Expense) {
    if (!this.db) await this.init();
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
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO expenses (id, merchant, amount, currency, category, note, scanned, date, created_at, image_uri, is_reimbursable, unit_price, units, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params
      );
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
    if (!this.db) await this.init();

    const expense = await this.db!.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
    if (expense?.image_uri && isOwnedReceiptImage(expense.image_uri)) {
      try {
        await deleteOwnedReceiptImage(expense.image_uri);
      } catch {
        logger.warn('Could not delete cached image file', 'image_delete_failed');
      }
    }

    await this.db!.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
    logger.info(`Expense deleted: ${id}`);
  }

  async updateExpenseNote(id: string, note: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET note = ? WHERE id = ?', [note, id]);
  }

  // Single write boundary for an S-08 category correction. The learning-loop
  // decision (auto-capture only) lives in ExpenseDetailService so every caller
  // routes through the same rule instead of re-deriving it per screen.
  async updateExpenseCategory(id: string, category: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET category = ? WHERE id = ?', [category, id]);
  }

  async updateExpenseReimbursable(id: string, isReimbursable: boolean): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET is_reimbursable = ? WHERE id = ?', [isReimbursable ? 1 : 0, id]);
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
    logger.info(`Converted ${outcome.convertedCount} expense row(s) to ${targetCurrency}`);
    return outcome;
  }

  async updateExpenseCurrency(id: string, amount: number, currency: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE expenses SET amount = ?, currency = ? WHERE id = ?', [amount, currency, id]);
  }

  // Categories
  async getCategories(): Promise<{ id: string; title: string; icon_name: string; color: string; is_default?: number }[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllAsync<{ id: string; title: string; icon_name: string; color: string }>(
      'SELECT * FROM categories'
    );
  }

  async addCategory(title: string, icon: string, color: string) {
    if (!this.db) await this.init();
    const id = title.toLowerCase().replace(/\s+/g, '-');
    await this.db!.runAsync(
      'INSERT INTO categories (id, title, icon_name, color, is_default) VALUES (?, ?, ?, ?, 0)',
      [id, title, icon, color]
    );
    return id;
  }

  async renameCategory(id: string, newTitle: string) {
    if (!this.db) await this.init();
    await this.db!.runAsync(
      'UPDATE categories SET title = ? WHERE id = ?',
      [newTitle, id]
    );
  }

  async updateCategoryColor(id: string, color: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE categories SET color = ? WHERE id = ?', [color, id]);
  }

  async updateCategoryIcon(id: string, iconName: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE categories SET icon_name = ? WHERE id = ?', [iconName, id]);
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    if (isSecretSettingKey(key)) return null;
    const result = await this.db!.getFirstAsync<Setting>('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
  }
  
  async getAllSettings(): Promise<Record<string, string>> {
    if (!this.db) await this.init();
    const results = await this.db!.getAllAsync<Setting>('SELECT * FROM settings');
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
  }

  async updateSetting(key: string, value: string) {
    if (!this.db) await this.init();
    if (isSecretSettingKey(key)) { await setSecret(key, value); return; }
    await this.writePublicSetting(this.db!, key, value);
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
  async completeOnboarding(settings: OnboardingSettings): Promise<void> {
    if (!this.db) await this.init();
    const db = this.db!;
    const profileName = settings.profileName?.trim();
    const monthlyBudget = settings.monthlyBudget?.trim();

    await db.execAsync('BEGIN');
    try {
      await this.writePublicSetting(db, 'currency', settings.currency);
      await this.writePublicSetting(db, 'budget_currency', settings.currency);
      if (profileName) await this.writePublicSetting(db, 'profile_name', profileName);
      if (monthlyBudget) await this.writePublicSetting(db, 'monthly_budget', monthlyBudget);
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
  }

  async markAllNotificationsRead() {
    const db = await this.getDb();
    await db.runAsync('UPDATE notifications SET read = 1 WHERE read = 0');
  }

  async deleteNotification(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM notifications WHERE id = ?', [id]);
  }

  async clearAllNotifications() {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM notifications');
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
  }

  async deleteRecurringTemplate(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM recurring_templates WHERE id = ?', [id]);
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

    const toTimestamp = (dateStr: string): number => {
      if (!dateStr) return Date.now();
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? Date.now() : d.getTime();
    };

    // Try JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const expenses: Partial<Expense>[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const expErrors: string[] = [];
           if (typeof item.merchant !== 'string' || !item.merchant.trim()) expErrors.push(`item ${i + 1}: missing merchant`);
           if (item.amount === undefined || item.amount === null || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0) expErrors.push(`item ${i + 1}: invalid amount`);

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
            amount: Number(item.amount),
             currency,
             category,
            note: item.note || '',
            scanned: item.scanned || 0,
            date: toTimestamp(item.date),
            created_at: Date.now(),
            is_reimbursable: item.is_reimbursable || 0,
            unit_price: item.unit_price ?? undefined,
            units: item.units ?? undefined,
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
    const dateIdx = header.indexOf('date');
    const merchantIdx = header.indexOf('merchant');
    const amountIdx = header.indexOf('amount');
    const currencyIdx = header.indexOf('currency');
    const categoryIdx = header.indexOf('category');
    const noteIdx = header.indexOf('note');
    const scannedIdx = header.indexOf('scanned');

     if (merchantIdx === -1 || amountIdx === -1 || currencyIdx === -1 || categoryIdx === -1) {
       errors.push('CSV must have "merchant", "amount", "currency", and "category" columns.');
      return { expenses: [], errors };
    }

    const expenses: Partial<Expense>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCSVLine(lines[i]);
      const merchant = (cols[merchantIdx] || '').trim();
       const amountValue = cols[amountIdx]?.trim() || '';
       const amount = parseFloat(amountValue);
       const currency = cols[currencyIdx]?.trim() || '';
       const category = cols[categoryIdx]?.toLowerCase().trim() || '';

       if (!merchant || !amountValue || isNaN(amount) || amount <= 0 || !currency || !category) {
        errors.push(`CSV row ${i}: skipped invalid entry`);
        continue;
      }

       expenses.push({
        id: Math.random().toString(36).substring(2, 15),
        merchant,
        amount,
         currency,
         category,
        note: noteIdx !== -1 ? (cols[noteIdx] || '').replace(/""/g, '"') : '',
        scanned: scannedIdx !== -1 ? parseInt(cols[scannedIdx] || '0') || 0 : 0,
        date: dateIdx !== -1 ? toTimestamp(cols[dateIdx]) : Date.now(),
        created_at: Date.now(),
        is_reimbursable: 0,
        unit_price: undefined,
        units: undefined,
      });
    }

    return { expenses, errors };
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
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
  async checkAchievements(): Promise<string[]> {
    const db = await this.getDb();
    const allSettings = await this.getAllSettings();
    const monthlyBudget = parseFloat(allSettings.monthly_budget) || 0;
    const streak = monthlyBudget > 0 ? await this.getStreak() : 0;

    const expenseCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM expenses'))?.count || 0;
    const scannedCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM expenses WHERE scanned = 1'))?.count || 0;
    const recurringCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM recurring_templates'))?.count || 0;
    const exportCount = parseInt(allSettings.export_count) || 0;
    const detailCount = (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM expenses WHERE note != '' OR is_reimbursable = 1"))?.count || 0;
    const totalSpent = (await db.getFirstAsync<{ total: number }>('SELECT SUM(amount) as total FROM expenses'))?.total || 0;
    const distinctCategories = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(DISTINCT category) as count FROM expenses'))?.count || 0;
    const minExpenseRecord = await db.getFirstAsync<{ min: number; currency: string }>(
      'SELECT amount as min, currency FROM expenses ORDER BY amount ASC LIMIT 1'
    );
    const minExpense = minExpenseRecord?.min || 0;
    const noteCount = (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM expenses WHERE note IS NOT NULL AND note != ''"))?.count || 0;

    const badgeDefs: { id: string; check: () => Promise<boolean> }[] = [
      // Existing
      { id: 'first_step', check: async () => expenseCount >= 1 },
      { id: 'eagle_eye', check: async () => scannedCount >= 1 },
      { id: 'on_repeat', check: async () => recurringCount >= 1 },
      { id: 'paper_trail', check: async () => exportCount >= 1 },
      { id: 'detail_devil', check: async () => detailCount >= 1 },
      { id: 'week_warrior', check: async () => streak >= 7 },
      { id: 'month_master', check: async () => streak >= 30 },
      // Expense Milestones
      { id: 'getting-started', check: async () => expenseCount >= 5 },
      { id: 'regular', check: async () => expenseCount >= 25 },
      { id: 'century', check: async () => expenseCount >= 100 },
      // Scan Milestones
      { id: 'sneak-peek', check: async () => scannedCount >= 3 },
      { id: 'shutterbug', check: async () => scannedCount >= 15 },
      { id: 'scanner-king', check: async () => scannedCount >= 50 },
      // Streak Extensions
      { id: 'fortnight', check: async () => streak >= 14 },
      { id: 'season', check: async () => streak >= 60 },
      { id: 'half-year-hero', check: async () => streak >= 180 },
      // Category Exploration
      { id: 'variety', check: async () => distinctCategories >= 3 },
      { id: 'explorer', check: async () => distinctCategories >= 5 },
      { id: 'completionist', check: async () => distinctCategories >= 8 },
      // Spending & Saving
      { id: 'saver', check: async () => minExpense > 0 && minExpense <= ACHIEVEMENT_THRESHOLDS.saver },
      { id: 'shopper', check: async () => totalSpent >= ACHIEVEMENT_THRESHOLDS.shopper },
      { id: 'big-league', check: async () => totalSpent >= ACHIEVEMENT_THRESHOLDS.bigLeague },
      // Recurring & Notes
      { id: 'habit', check: async () => recurringCount >= 2 },
      { id: 'loyalist', check: async () => recurringCount >= 5 },
      { id: 'novelist', check: async () => noteCount >= 5 },
      // Budget
      { id: 'on-track', check: async () => streak >= 7 },
      { id: 'disciplined', check: async () => streak >= 30 },
    ];

    const newBadges: string[] = [];
    for (const badge of badgeDefs) {
      const already = await db.getFirstAsync<{ earned_at: number }>('SELECT earned_at FROM achievements WHERE id = ?', [badge.id]);
      if (!already) {
        const earned = await badge.check();
        if (earned) {
          await db.runAsync('INSERT INTO achievements (id, earned_at) VALUES (?, ?)', [badge.id, Date.now()]);
          newBadges.push(badge.id);
        }
      }
    }

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

  async getBadgeProgress(): Promise<{
    id: string;
    label: string;
    description: string;
    icon: string;
    earned_at: number | null;
    current: number;
    target: number;
  }[]> {
    const db = await this.getDb();
    const allSettings = await this.getAllSettings();
    const streak = await this.getStreak();

    const expenseCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM expenses'))?.count || 0;
    const scannedCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM expenses WHERE scanned = 1'))?.count || 0;
    const recurringCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM recurring_templates'))?.count || 0;
    const exportCount = parseInt(allSettings.export_count) || 0;
    const detailCount = (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM expenses WHERE note != '' OR is_reimbursable = 1"))?.count || 0;
    const totalSpent = (await db.getFirstAsync<{ total: number }>('SELECT SUM(amount) as total FROM expenses'))?.total || 0;
    const distinctCategoriesCount = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(DISTINCT category) as count FROM expenses'))?.count || 0;
    const minExpenseRecord = await db.getFirstAsync<{ min: number; currency: string }>(
      'SELECT amount as min, currency FROM expenses ORDER BY amount ASC LIMIT 1'
    );
    const minExpense = minExpenseRecord?.min || 0;
    const userCurrency = resolveCurrency(undefined, allSettings.currency);
    const saverCurrency = resolveCurrency(minExpenseRecord?.currency, userCurrency);
    const noteCount = (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM expenses WHERE note IS NOT NULL AND note != ''"))?.count || 0;

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
    const allSettings = await this.getAllSettings();
    return parseInt(allSettings.last_streak) || 0;
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

  async getRecentExpenses(limit = 10): Promise<Expense[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY date DESC LIMIT ?', [limit]);
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
    if (!this.db) await this.init();
    const db = this.db!;
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
    } catch (error) {
      await db.execAsync('ROLLBACK');
      logger.error('Failed to clear transaction data', 'clear_all_data_failed');
      throw error;
    }
    logger.info('Transaction data purged');
  }

  async resetApp() {
    if (!this.db) await this.init();
    await this.db!.execAsync(`
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
    // D9 / S-06R-01: reset is the widest boundary, so it also removes every media
    // file the app wrote: receipt images, profile avatars, and export CSVs.
    const media = await eraseOwnedMediaForScope(RESET_APP_MEDIA_SCOPE);
    if (media.failed > 0) logger.warn('Some app media could not be erased on reset', 'reset_media_erase_partial');
    logger.warn('Complete app reset performed');
  }
}

export const databaseService = new DatabaseService();
