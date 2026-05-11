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
          'INSERT INTO categories (id, title, icon_name, color) VALUES (?, ?, ?, ?)',
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
      expense.image_uri || null
    ];

    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO expenses (id, merchant, amount, currency, category, note, scanned, date, created_at, image_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  async getCategories(): Promise<{ id: string; title: string; icon_name: string; color: string }[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllAsync<{ id: string; title: string; icon_name: string; color: string }>(
      'SELECT * FROM categories'
    );
  }

  async addCategory(title: string, icon: string, color: string) {
    if (!this.db) await this.init();
    const id = title.toLowerCase().replace(/\s+/g, '-');
    await this.db!.runAsync(
      'INSERT INTO categories (id, title, icon_name, color) VALUES (?, ?, ?, ?)',
      [id, title, icon, color]
    );
    return id;
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

  async clearAllData() {
    if (!this.db) await this.init();
    await this.db!.execAsync('DELETE FROM expenses;');
    logger.info('Transaction data purged');
  }

  async resetApp() {
    if (!this.db) await this.init();
    await this.db!.execAsync(`
      DELETE FROM expenses;
      DELETE FROM settings;
    `);
    logger.warn('Complete app reset performed');
  }
}

export const databaseService = new DatabaseService();
