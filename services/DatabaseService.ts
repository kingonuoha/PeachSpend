import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { Expense, Setting } from '../types/database';
import { logger } from '../utils/logger';

const DATABASE_NAME = 'peachspend.db';

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

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
      await this.seedCategories();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database', error);
      throw error;
    }
  }

  private async createTables() {
    if (!this.db) return;

    // Initial table creation
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY NOT NULL,
        merchant TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        category TEXT NOT NULL,
        note TEXT,
        scanned INTEGER DEFAULT 0,
        date INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        icon_name TEXT NOT NULL,
        color TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS recurring_templates (
        id TEXT PRIMARY KEY NOT NULL,
        merchant TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        category TEXT NOT NULL,
        note TEXT,
        interval TEXT NOT NULL,
        recurrence_days TEXT,
        next_due_date INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'expense',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY NOT NULL,
        earned_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS income (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        note TEXT,
        is_recurring INTEGER DEFAULT 0,
        recurrence_interval TEXT,
        next_due_date INTEGER,
        date INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Migration: Ensure currency column exists for older installations
    try {
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT "USD"');
      logger.info('Migration: Added currency column to expenses table');
    } catch (error) {
      // Column probably already exists, which is fine
    }

    // Migration: Add image_uri column
    try {
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN image_uri TEXT');
      logger.info('Migration: Added image_uri column to expenses table');
    } catch (error) {
      // Column probably already exists, which is fine
    }

    // Migration: Add is_reimbursable column
    try {
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN is_reimbursable INTEGER DEFAULT 0');
      logger.info('Migration: Added is_reimbursable column to expenses table');
    } catch (error) {
      // Column probably already exists, which is fine
    }

    // Migration: Add is_default column to categories
    try {
      await this.db.execAsync('ALTER TABLE categories ADD COLUMN is_default INTEGER DEFAULT 0');
      await this.db.execAsync("UPDATE categories SET is_default = 1 WHERE id IN ('dining','groceries','transport','shopping','entertainment','health','utilities','other')");
      logger.info('Migration: Added is_default column to categories table');
    } catch (error) {
      // Column probably already exists, which is fine
    }

    // Migration: Add recurring columns to expenses
    try {
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN is_recurring INTEGER DEFAULT 0');
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN recurrence_interval TEXT');
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN recurrence_days TEXT');
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN next_due_date INTEGER');
      await this.db.execAsync('ALTER TABLE expenses ADD COLUMN recurrence_parent_id TEXT');
      logger.info('Migration: Added recurring columns to expenses table');
    } catch (error) {
      // Columns probably already exist, which is fine
    }
  }

  private async seedCategories() {
    if (!this.db) return;

    const count = await this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM categories');
    if (count?.count === 0) {
      const defaultCategories = [
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
          [cat[0], cat[1], cat[2], cat[3]] as any
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
    
    // Harden parameters for SQLite native layer
    const params: any[] = [
      expense.id || Math.random().toString(36),
      expense.merchant || 'Unknown',
      (expense.amount !== undefined && expense.amount !== null) ? expense.amount : 0,
      expense.currency || 'USD',
      expense.category || 'other',
      expense.note || '',
      expense.scanned || 0,
      expense.date || Date.now(),
      expense.created_at || Date.now(),
      expense.image_uri || null,
      expense.is_reimbursable || 0
    ];

    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO expenses (id, merchant, amount, currency, category, note, scanned, date, created_at, image_uri, is_reimbursable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params as any
      );
      logger.info(`Expense saved: ${expense.id}`);
    } catch (error) {
      logger.error('DatabaseService.saveExpense Error:', error);
      throw error;
    }
  }

  async addExpense(expense: Expense) {
    return this.saveExpense(expense);
  }

  async deleteExpense(id: string) {
    if (!this.db) await this.init();

    const expense = await this.db!.getFirstAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
    if (expense?.image_uri) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(expense.image_uri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(expense.image_uri, { idempotent: true });
        }
      } catch (error) {
        logger.warn('Could not delete cached image file', error);
      }
    }

    await this.db!.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
    logger.info(`Expense deleted: ${id}`);
  }

  async getExpensesByCategory(): Promise<{ category: string; total: number }[]> {
    const db = await this.getDb();
    return await db.getAllAsync<{ category: string; total: number }>(
      'SELECT category, SUM(amount) as total FROM expenses GROUP BY category'
    );
  }

  async convertExpenses(targetCurrency: string) {
    const db = await this.getDb();
    const allSettings = await this.getAllSettings();
    let rates: Record<string, number> = {};
    try { rates = JSON.parse(allSettings.conversion_rates || '{}'); } catch {}

    const expenses = await db.getAllAsync<Expense>('SELECT * FROM expenses');
    for (const expense of expenses) {
      if (expense.currency === targetCurrency) continue;
      const fromRate = rates[expense.currency] || 1;
      const toRate = rates[targetCurrency] || 1;
      const newAmount = expense.amount * fromRate / toRate;
      await db.runAsync(
        'UPDATE expenses SET amount = ?, currency = ? WHERE id = ?',
        [newAmount, targetCurrency, expense.id]
      );
    }
    logger.info(`Converted all expenses to ${targetCurrency}`);
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

  // Settings
  async getSetting(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    const result = await this.db!.getFirstAsync<Setting>('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
  }
  
  async getAllSettings(): Promise<Record<string, string>> {
    if (!this.db) await this.init();
    const results = await this.db!.getAllAsync<Setting>('SELECT * FROM settings');
    const settings: Record<string, string> = {};
    results.forEach(s => {
      settings[s.key] = s.value || '';
    });
    return settings;
  }

  async updateSetting(key: string, value: string) {
    if (!this.db) await this.init();
    await this.db!.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  }

  async runAsync(sql: string, params: any[] = []) {
    const db = await this.getDb();
    await db.runAsync(sql, params as any);
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
    await db.runAsync(
      'INSERT INTO recurring_templates (id, merchant, amount, currency, category, note, interval, recurrence_days, next_due_date, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [template.id, template.merchant, template.amount, template.currency, template.category, template.note || '', template.interval, template.recurrence_days || null, template.next_due_date, template.type || 'expense', template.created_at] as any
    );
  }

  async getRecurringTemplates(type?: string): Promise<any[]> {
    const db = await this.getDb();
    if (type) {
      return await db.getAllAsync('SELECT * FROM recurring_templates WHERE type = ? ORDER BY next_due_date ASC', [type]);
    }
    return await db.getAllAsync('SELECT * FROM recurring_templates ORDER BY next_due_date ASC');
  }

  async deleteRecurringTemplate(id: string) {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM recurring_templates WHERE id = ?', [id]);
  }

  async getNextDueDate(interval: string, recurrence_days?: string): Promise<number> {
    const now = new Date();
    
    if (interval === 'daily') {
      return now.setDate(now.getDate() + 1);
    }
    
    if (interval === 'weekly') {
      return now.setDate(now.getDate() + 7);
    }
    
    if (interval === 'monthly') {
      return now.setMonth(now.getMonth() + 1);
    }
    
    if (interval === 'custom' && recurrence_days) {
      const days: number[] = JSON.parse(recurrence_days);
      const currentDay = now.getDay(); // 0 = Sunday
      
      // Find the next day in the configured days
      for (let i = 1; i <= 7; i++) {
        const nextDay = (currentDay + i) % 7;
        if (days.includes(nextDay)) {
          const next = new Date(now);
          next.setDate(now.getDate() + i);
          next.setHours(0, 0, 0, 0);
          return next.getTime();
        }
      }
    }
    
    return now.getTime() + 86400000; // Default: tomorrow
  }

  // Income
  async insertIncome(income: {
    id: string;
    source: string;
    amount: number;
    currency: string;
    note?: string;
    is_recurring?: number;
    recurrence_interval?: string;
    next_due_date?: number;
    date: number;
    created_at: number;
  }) {
    const db = await this.getDb();
    await db.runAsync(
      'INSERT INTO income (id, source, amount, currency, note, is_recurring, recurrence_interval, next_due_date, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [income.id, income.source, income.amount, income.currency, income.note || '', income.is_recurring || 0, income.recurrence_interval || null, income.next_due_date || null, income.date, income.created_at] as any
    );
  }

  async getIncome(startDate?: number, endDate?: number): Promise<any[]> {
    const db = await this.getDb();
    if (startDate && endDate) {
      return await db.getAllAsync('SELECT * FROM income WHERE date >= ? AND date <= ? ORDER BY date DESC', [startDate, endDate]);
    }
    return await db.getAllAsync('SELECT * FROM income ORDER BY date DESC');
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
      const expenseResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE created_at >= ? AND created_at <= ?', [startDate, endDate]);
      expenseTotal = expenseResult?.total || 0;
    } else {
      const incomeResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM income');
      incomeTotal = incomeResult?.total || 0;
      const expenseResult = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(amount), 0) as total FROM expenses');
      expenseTotal = expenseResult?.total || 0;
    }

    return incomeTotal - expenseTotal;
  }

  // Duplicate detection
  async isDuplicate(merchant: string, amount: number): Promise<Expense | null> {
    const db = await this.getDb();
    const twentyFourHoursAgo = Date.now() - 86400000;
    return await db.getFirstAsync<Expense>(
      'SELECT * FROM expenses WHERE LOWER(merchant) = LOWER(?) AND amount = ? AND created_at >= ? LIMIT 1',
      [merchant, amount, twentyFourHoursAgo]
    );
  }

  async exportToCSV(startDate: number, endDate: number, categories?: string[]): Promise<string> {
    const db = await this.getDb();
    let query = 'SELECT * FROM expenses WHERE date >= ? AND date <= ?';
    const params: any[] = [startDate, endDate];
    
    if (categories && categories.length > 0) {
      query += ` AND category IN (${categories.map(() => '?').join(',')})`;
      params.push(...categories);
    }
    query += ' ORDER BY date DESC';
    
    const expenses = await db.getAllAsync<any>(query, params as any);
    
    const header = 'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image';
    const rows = expenses.map((e: any) => {
      const dateStr = e.date ? new Date(e.date).toISOString().split('T')[0] : '';
      const note = (e.note || '').replace(/"/g, '""');
      return `${dateStr},"${e.merchant || ''}",${e.amount || 0},${e.currency || 'USD'},${e.category || ''},"${note}",,${e.scanned || 0},${e.image_uri ? 'yes' : 'no'}`;
    });
    
    return [header, ...rows].join('\n');
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
    const minExpense = (await db.getFirstAsync<{ min: number }>('SELECT MIN(amount) as min FROM expenses'))?.min || 0;
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
      { id: 'saver', check: async () => minExpense > 0 && minExpense <= 3 },
      { id: 'shopper', check: async () => totalSpent >= 1000 },
      { id: 'big-league', check: async () => totalSpent >= 10000 },
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
    const minExpense = (await db.getFirstAsync<{ min: number }>('SELECT MIN(amount) as min FROM expenses'))?.min || 0;
    const noteCount = (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM expenses WHERE note IS NOT NULL AND note != ''"))?.count || 0;

    const achievements = await db.getAllAsync<{ id: string; earned_at: number }>('SELECT * FROM achievements');

    const badgeData: { id: string; label: string; description: string; icon: string; current: number; target: number }[] = [
      // Existing
      { id: 'first_step', label: 'First Step', description: 'First expense logged', icon: '🌱', current: Math.min(expenseCount, 1), target: 1 },
      { id: 'eagle_eye', label: 'Eagle Eye', description: 'First receipt scanned', icon: '📸', current: Math.min(scannedCount, 1), target: 1 },
      { id: 'on_repeat', label: 'On Repeat', description: 'First recurring expense', icon: '🔁', current: Math.min(recurringCount, 1), target: 1 },
      { id: 'week_warrior', label: 'Week Warrior', description: '7-day streak', icon: '🔥', current: Math.min(streak, 7), target: 7 },
      { id: 'month_master', label: 'Month Master', description: '30-day streak', icon: '💎', current: Math.min(streak, 30), target: 30 },
      { id: 'paper_trail', label: 'Paper Trail', description: 'First CSV export', icon: '📤', current: Math.min(exportCount, 1), target: 1 },
      { id: 'detail_devil', label: 'Detail Devil', description: 'First note or tag', icon: '🏷️', current: Math.min(detailCount, 1), target: 1 },
      // Expense Milestones
      { id: 'getting-started', label: 'Getting Started', description: '5 expenses logged', icon: '🚀', current: Math.min(expenseCount, 5), target: 5 },
      { id: 'regular', label: 'Regular', description: '25 expenses logged', icon: '📊', current: Math.min(expenseCount, 25), target: 25 },
      { id: 'century', label: 'Century', description: '100 expenses logged', icon: '💯', current: Math.min(expenseCount, 100), target: 100 },
      // Scan Milestones
      { id: 'sneak-peek', label: 'Sneak Peek', description: '3 receipts scanned', icon: '👀', current: Math.min(scannedCount, 3), target: 3 },
      { id: 'shutterbug', label: 'Shutterbug', description: '15 receipts scanned', icon: '📷', current: Math.min(scannedCount, 15), target: 15 },
      { id: 'scanner-king', label: 'Scanner King', description: '50 receipts scanned', icon: '👑', current: Math.min(scannedCount, 50), target: 50 },
      // Streak Extensions
      { id: 'fortnight', label: 'Fortnight', description: '14-day streak', icon: '🌙', current: Math.min(streak, 14), target: 14 },
      { id: 'season', label: 'Season', description: '60-day streak', icon: '🍂', current: Math.min(streak, 60), target: 60 },
      { id: 'half-year-hero', label: 'Half-Year Hero', description: '180-day streak', icon: '⚡', current: Math.min(streak, 180), target: 180 },
      // Category Exploration
      { id: 'variety', label: 'Variety', description: '3 categories used', icon: '🎨', current: Math.min(distinctCategoriesCount, 3), target: 3 },
      { id: 'explorer', label: 'Explorer', description: '5 categories used', icon: '🗺️', current: Math.min(distinctCategoriesCount, 5), target: 5 },
      { id: 'completionist', label: 'Completionist', description: 'All 8 categories used', icon: '🏆', current: Math.min(distinctCategoriesCount, 8), target: 8 },
      // Spending & Saving
      { id: 'saver', label: 'Saver', description: 'Single expense ≤ $3', icon: '🐷', current: minExpense > 0 && minExpense <= 3 ? 1 : 0, target: 1 },
      { id: 'shopper', label: 'Shopper', description: '$1,000 total spent', icon: '🛍️', current: Math.min(Math.floor(totalSpent / 100), 10), target: 10 },
      { id: 'big-league', label: 'Big League', description: '$10,000 total spent', icon: '💰', current: Math.min(Math.floor(totalSpent / 1000), 10), target: 10 },
      // Recurring & Notes
      { id: 'habit', label: 'Habit', description: '2 recurring expenses', icon: '♻️', current: Math.min(recurringCount, 2), target: 2 },
      { id: 'loyalist', label: 'Loyalist', description: '5 recurring expenses', icon: '🏅', current: Math.min(recurringCount, 5), target: 5 },
      { id: 'novelist', label: 'Novelist', description: '5 expenses with notes', icon: '📝', current: Math.min(noteCount, 5), target: 5 },
      // Budget
      { id: 'on-track', label: 'On Track', description: '7-day budget streak', icon: '📈', current: Math.min(streak, 7), target: 7 },
      { id: 'disciplined', label: 'Disciplined', description: '30-day budget streak', icon: '🧘', current: Math.min(streak, 30), target: 30 },
    ];

    return badgeData.map(b => ({
      ...b,
      earned_at: achievements.find(a => a.id === b.id)?.earned_at || null,
    }));
  }

  async getStreak(): Promise<number> {
    const allSettings = await this.getAllSettings();
    const monthlyBudget = parseFloat(allSettings.monthly_budget) || 0;
    if (monthlyBudget <= 0) return 0;

    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const dailyLimit = monthlyBudget / daysInMonth;

    const db = await this.getDb();
    const expenses = await db.getAllAsync<{ date: number; amount: number }>('SELECT date, SUM(amount) as amount FROM expenses GROUP BY date ORDER BY date DESC');

    if (expenses.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const earliestDate = Math.min(...expenses.map(e => e.date));
    const earliestDay = new Date(earliestDate);
    earliestDay.setHours(0, 0, 0, 0);

    const daysSinceFirst = Math.floor((today.getTime() - earliestDay.getTime()) / 86400000) + 1;
    const maxDays = Math.min(365, daysSinceFirst);

    let streak = 0;
    for (let i = 0; i < maxDays; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const checkStart = checkDate.getTime();
      const checkEnd = checkStart + 86400000;

      const dayExpenses = expenses.filter(e => e.date >= checkStart && e.date < checkEnd);
      const dayTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

      if (dayTotal <= dailyLimit) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  async clearAllData() {
    if (!this.db) await this.init();
    await this.db!.execAsync('DELETE FROM expenses;');
    logger.info('Transaction data purged');
  }

  async resetApp() {
    if (!this.db) await this.init();
    const savedApiKey = await this.getSetting('gemini_api_key');
    await this.db!.execAsync(`
      DELETE FROM expenses;
      DELETE FROM categories;
      DELETE FROM recurring_templates;
      DELETE FROM achievements;
      DELETE FROM income;
      DELETE FROM settings;
    `);
    if (savedApiKey) {
      await this.updateSetting('gemini_api_key', savedApiKey);
    }
    await this.seedCategories();
    logger.warn('Complete app reset performed');
  }
}

export const databaseService = new DatabaseService();
