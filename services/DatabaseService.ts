import * as SQLite from 'expo-sqlite';
import { Expense, Setting } from '../types/database';
import { logger } from '../utils/logger';

const DATABASE_NAME = 'peachspend.db';

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

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

    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY NOT NULL,
        merchant TEXT NOT NULL,
        amount REAL NOT NULL,
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
          cat[0], cat[1], cat[2], cat[3]
        );
      }
    }
  }

  // Expenses
  async saveExpense(expense: Expense) {
    if (!this.db) await this.init();
    await this.db!.runAsync(
      'INSERT INTO expenses (id, merchant, amount, category, note, scanned, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [expense.id, expense.merchant, expense.amount, expense.category, expense.note || null, expense.scanned, expense.date, expense.created_at]
    );
  }

  async addExpense(expense: Expense) {
    return this.saveExpense(expense);
  }

  async getExpenses(): Promise<Expense[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY date DESC');
  }

  async getExpensesByCategory(): Promise<{ category: string; total: number }[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllAsync<{ category: string; total: number }>(
      'SELECT category, SUM(amount) as total FROM expenses GROUP BY category'
    );
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    const result = await this.db!.getFirstAsync<Setting>('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
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
    await this.db!.execAsync(`
      DELETE FROM expenses;
      DELETE FROM settings;
    `);
    logger.info('All data cleared');
  }
}

export const databaseService = new DatabaseService();
