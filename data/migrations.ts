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
    // journal_mode is repeated here for a file opened outside the runner. The
    // matching durability setting, `PRAGMA synchronous = NORMAL`, is deliberately
    // NOT repeated here: this runs inside the runner's transaction, and SQLite
    // refuses to change the safety level inside one ("Safety level may not be
    // changed inside a transaction"). It is set once per open in runMigrations,
    // outside any transaction, which is where the trade is documented.
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

// BUG-09-11a. Reader index coverage, derived from the queries the data layer actually
// runs rather than from the shape of the schema. One index per column a query filters
// or sorts on, and no composite index, because a wider index would cost write time on
// the save path without serving any query in the app. Each line names the statement
// that reads it, checked with EXPLAIN QUERY PLAN (see
// bugfix-BUG-09-11-evidence.md):
//
// - expenses(date): every period read and every newest first read. Serves the range
//   filter in getMonthlySummary, getNetBalance, getBudgetStatus, getRecentExpensesInRange,
//   getExpensesByCategoryInRange and exportToCSV, and the ORDER BY date DESC in
//   getExpenses, getRecentExpenses and the category drill down. The drill down also
//   leans on it for its category predicate, because `LOWER(category) = LOWER(?)` is a
//   different term from the column and cannot use the category index below.
// - expenses(category): getExpensesByCategory groups by this column, so the planner
//   walks the index in group order instead of building a temp b-tree over the table.
// - expenses(is_reimbursable): getReimbursableTotal reads this flag twice, once for the
//   sum and once for the rows.
// - expenses(amount): the achievement totals statement reads the smallest amount with
//   ORDER BY amount ASC, rowid ASC LIMIT 1. Without this index that scalar subquery
//   sorted the whole table to return one row.
// - income(date): the same period and newest first reads as expenses(date).
// - notifications(created_at): getNotifications orders newest first.
// - notifications(read): getUnreadNotificationCount answers its count from the index
//   alone, and markAllNotificationsRead filters on the same flag.
// - chat_messages(created_at): getChatHistory orders oldest first.
//
// Evaluated and deliberately NOT created, with the reason:
// - expenses(scanned): the triage named it missing because the pre-collapse achievement
//   pass ran `SELECT COUNT(*) FROM expenses WHERE scanned = 1`, which this index made
//   covering. The collapse in services/DatabaseService.ts folds that count into the one
//   aggregate statement, which must scan the table for the other eight columns, and no
//   other statement in the app filters on scanned. The index would therefore cost write
//   time on every save and be read by nothing. Add it with the query that consumes it if
//   a scanned predicate returns.
//
// Reversible, so no oneWayReason is claimed: an index stores no user data, so down()
// drops exactly the eight indexes this migration created and leaves every row intact.
const migration7: Migration = {
  version: 7,
  name: 'reader-index-coverage',
  async up(db) {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
      CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
      CREATE INDEX IF NOT EXISTS idx_expenses_is_reimbursable ON expenses(is_reimbursable);
      CREATE INDEX IF NOT EXISTS idx_expenses_amount ON expenses(amount);
      CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    `);
  },
  async down(db) {
    await db.execAsync(`
      DROP INDEX IF EXISTS idx_expenses_date;
      DROP INDEX IF EXISTS idx_expenses_category;
      DROP INDEX IF EXISTS idx_expenses_is_reimbursable;
      DROP INDEX IF EXISTS idx_expenses_amount;
      DROP INDEX IF EXISTS idx_income_date;
      DROP INDEX IF EXISTS idx_notifications_created_at;
      DROP INDEX IF EXISTS idx_notifications_read;
      DROP INDEX IF EXISTS idx_chat_messages_created_at;
    `);
  },
};

export const migrations: Migration[] = [migration1, migration2, migration3, migration4, migration5, migration6, migration7];

// Connection level setup, applied on every open so the settings cannot drift between
// an install that migrated and one that opened an already current file.
//
// DEC-B23, the durability trade, stated here so a later reader does not have to go
// looking for it: with WAL, `synchronous = NORMAL` stops fsyncing on every commit and
// only syncs at checkpoints, so a sudden power loss or a battery pull can lose the
// last commit or two instead of corrupting the file. The owner accepted that trade for
// a local financial log, knowing it. Do not raise this back to FULL without asking
// Kingsley, and do not lower it to OFF.
//
// Connection pragmas evaluated for BUG-09-11a and deliberately NOT set, each with its
// reason:
// - cache_size: SQLite's default 2 MiB page cache already holds the whole file for a
//   personal expense log, and the effect of raising it is a memory and read pattern
//   claim that cannot be measured without the device run this pass bans.
// - mmap_size: memory mapped pages would only move the same reads off the SQLite
//   pager onto the OS page cache, which already serves repeat reads of a file this
//   size, and it changes WAL checkpoint behaviour in a way only a device run could
//   clear.
// - temp_store: forcing temp tables and sort spills into memory grows the process with
//   the table size on exactly the low end devices that need the headroom, and the
//   indexes added in migration 7 remove the whole table sorts that motivated it.
// - PRAGMA optimize IS set below, because it is cheap, idempotent, and the planner
//   needs row counts to choose between the new indexes instead of a rule of thumb.
export async function runMigrations(db: SQLite.SQLiteDatabase, list: Migration[] = migrations): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA synchronous = NORMAL;');
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  for (const migration of list.filter(item => item.version > current).sort((a, b) => a.version - b.version)) {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      await migration.up(db);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  }
  // Analyses any table that has no statistics yet and is close to a no-op once they
  // exist, so a first open pays for the planner's row counts and later opens do not.
  await db.execAsync('PRAGMA optimize;');
}
