import type * as SQLite from 'expo-sqlite';

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  down?: (db: SQLite.SQLiteDatabase) => Promise<void>;
  oneWayReason?: string;
}

const LEGACY_COLUMNS = [
  ['expenses', 'currency TEXT NOT NULL DEFAULT \'USD\''],
  ['expenses', 'image_uri TEXT'],
  ['expenses', 'is_reimbursable INTEGER NOT NULL DEFAULT 0'],
  ['expenses', 'is_recurring INTEGER NOT NULL DEFAULT 0'],
  ['expenses', 'recurrence_interval TEXT'],
  ['expenses', 'recurrence_days TEXT'],
  ['expenses', 'next_due_date INTEGER'],
  ['expenses', 'recurrence_parent_id TEXT'],
  ['expenses', 'unit_price REAL'],
  ['expenses', 'units INTEGER'],
  ['categories', 'is_default INTEGER NOT NULL DEFAULT 0'],
  ['chat_messages', 'model TEXT'],
] as const;

const migration1: Migration = {
  version: 1,
  name: 'legacy-schema-baseline',
  oneWayReason: 'Baseline creates tables and cannot safely remove user data during rollback.',
  async up(db) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', category TEXT NOT NULL, note TEXT, scanned INTEGER NOT NULL DEFAULT 0, date INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, icon_name TEXT NOT NULL, color TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT);
      CREATE TABLE IF NOT EXISTS recurring_templates (id TEXT PRIMARY KEY NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', category TEXT NOT NULL, note TEXT, interval TEXT NOT NULL, recurrence_days TEXT, next_due_date INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'expense', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY NOT NULL, earned_at INTEGER);
      CREATE TABLE IF NOT EXISTS income (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', note TEXT, is_recurring INTEGER NOT NULL DEFAULT 0, recurrence_interval TEXT, next_due_date INTEGER, date INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', image_uri TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, type TEXT DEFAULT 'expense', data TEXT, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    `);
  },
};

const migration2: Migration = {
  version: 2,
  name: 'complete-legacy-columns',
  oneWayReason: 'SQLite column additions cannot be removed without rebuilding tables, which risks user data.',
  async up(db) {
    for (const [table, column] of LEGACY_COLUMNS) {
      const columnName = column.split(' ')[0];
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!columns.some(item => item.name === columnName)) {
        await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column}`);
      }
    }
    await db.runAsync('UPDATE categories SET is_default = 1 WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)', ['dining', 'groceries', 'transport', 'shopping', 'entertainment', 'health', 'utilities', 'other']);
  },
};

const migration3: Migration = {
  version: 3,
  name: 'capture-memory-and-event-queue',
  oneWayReason: 'Queue and event history are user audit data. Rollback must not silently destroy it.',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS merchant_category_memory (merchant_key TEXT PRIMARY KEY NOT NULL, merchant TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS capture_events (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, merchant TEXT, amount REAL, category TEXT, payload TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS capture_queue (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, last_error_code TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_capture_events_created_at ON capture_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capture_queue_available_at ON capture_queue(available_at ASC);
    `);
  },
};

const migration4: Migration = {
  version: 4,
  name: 'expire-capture-payloads',
  oneWayReason: 'Expiry metadata is additive. Reconstructing expired private capture payloads is impossible and unsafe.',
  async up(db) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(capture_queue)');
    if (!columns.some(item => item.name === 'expires_at')) {
      await db.execAsync('ALTER TABLE capture_queue ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
      await db.runAsync('UPDATE capture_queue SET expires_at = created_at + ?', [7 * 86400000]);
    }
  },
};

const migration5: Migration = {
  version: 5,
  name: 'income-category',
  oneWayReason: 'Adding a required column with a legacy default preserves existing income rows without destructive table rebuild.',
  async up(db) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(income)');
    if (!columns.some(item => item.name === 'category')) {
      await db.execAsync("ALTER TABLE income ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
    }
  },
};

const migration6: Migration = {
  version: 6,
  name: 'expense-record-source',
  async up(db) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(expenses)');
    if (!columns.some(item => item.name === 'source')) {
      await db.execAsync('ALTER TABLE expenses ADD COLUMN source TEXT');
    }
  },
  // Reversible: the column is nullable and holds no derived data, so a rebuild is
  // not required to drop it. Existing pre-v6 rows keep NULL and the detail read
  // infers their origin from the scanned flag instead of guessing at backfill time.
  async down(db) {
    await db.execAsync('ALTER TABLE expenses DROP COLUMN source');
  },
};

export const migrations: Migration[] = [migration1, migration2, migration3, migration4, migration5, migration6];

export async function runMigrations(db: SQLite.SQLiteDatabase, list: Migration[] = migrations): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  for (const migration of list.filter(item => item.version > current).sort((a, b) => a.version - b.version)) {
    await db.execAsync('BEGIN');
    try {
      await migration.up(db);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  }
}
