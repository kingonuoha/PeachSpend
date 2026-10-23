import { describe, expect, it, vi } from 'vitest';
import { migrations, runMigrations } from './migrations';
import { CURRENT_SCHEMA_VERSION, classifyContinuitySchema } from './ContinuityService';

class MigrationDatabase {
  userVersion = 0;
  tables = new Map<string, Set<string>>();
  indexes = new Set<string>();
  indexStatements: string[] = [];
  statements: string[] = [];
  records = [{ id: 'v1-expense', merchant: 'Market', amount: 12.5 }];
  inTransaction = false;
  async execAsync(sql: string): Promise<void> {
    this.statements.push(sql);
    if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE') { this.inTransaction = true; return; }
    if (sql === 'COMMIT') { this.inTransaction = false; return; }
    if (sql === 'ROLLBACK') { this.inTransaction = false; return; }
    const pragma = sql.match(/PRAGMA user_version = (\d+)/);
    if (pragma) { this.userVersion = Number(pragma[1]); return; }
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([^)]*)\)/g)) {
      this.tables.set(match[1], new Set(match[2].split(',').map(column => column.trim().split(/\s+/)[0])));
    }
    for (const match of sql.matchAll(/CREATE INDEX (?:IF NOT EXISTS )?(\w+)/g)) {
      this.indexStatements.push(match[0]);
      this.indexes.add(match[1]);
    }
    for (const match of sql.matchAll(/DROP INDEX IF EXISTS (\w+)/g)) this.indexes.delete(match[1]);
    const alter = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
    if (alter) this.tables.get(alter[1])?.add(alter[2]);
  }
  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (sql.includes('user_version')) return { user_version: this.userVersion } as T;
    return null;
  }
  async getAllAsync<T>(sql: string): Promise<T[]> {
    const table = sql.match(/table_info\((\w+)\)/)?.[1];
    return [...(this.tables.get(table || '') || [])].map(name => ({ name })) as T[];
  }
  async runAsync(sql: string): Promise<void> {
    if (sql.startsWith('UPDATE capture_queue')) return;
  }
}

describe('SQLite migration upgrades', () => {
  it('upgrades realistic v1 records and records user_version', async () => {
    const db = new MigrationDatabase();
    db.tables.set('expenses', new Set(['id', 'merchant', 'amount', 'category', 'date', 'created_at']));
    db.tables.set('income', new Set(['id', 'source', 'amount', 'currency', 'date', 'created_at']));
    await runMigrations(db as never, migrations);
    expect(db.userVersion).toBe(7);
    expect(db.tables.get('income')?.has('category')).toBe(true);
    expect(db.records[0]).toEqual({ id: 'v1-expense', merchant: 'Market', amount: 12.5 });
    expect(db.tables.get('capture_queue')?.has('expires_at')).toBe(true);
    expect(db.tables.get('merchant_category_memory')?.has('category')).toBe(true);
    expect(db.tables.get('expenses')?.has('source')).toBe(true);
  });

  it('rolls back version advancement when migration fails', async () => {
    const db = new MigrationDatabase();
    const failing = [{ version: 1, name: 'fails', up: async () => { throw new Error('migration_failed'); } }];
    await expect(runMigrations(db as never, failing)).rejects.toThrow('migration_failed');
    expect(db.userVersion).toBe(0);
    expect(db.inTransaction).toBe(false);
  });

  it('does not duplicate additive columns on an interrupted v4 retry', async () => {
    const db = new MigrationDatabase();
    db.userVersion = 3;
    db.tables.set('capture_queue', new Set(['id', 'payload', 'created_at', 'expires_at']));
    db.tables.set('expenses', new Set(['id', 'source']));
    await runMigrations(db as never, migrations);
    expect(db.userVersion).toBe(7);
    expect(db.tables.get('capture_queue')).toEqual(new Set(['id', 'payload', 'created_at', 'expires_at']));
    expect(db.tables.get('expenses')).toEqual(new Set(['id', 'source']));
  });

  it('leaves an already-current v2 file untouched (v2-present is not re-migrated)', async () => {
    const db = new MigrationDatabase();
    db.userVersion = migrations.length > 0 ? Math.max(...migrations.map(migration => migration.version)) : 0;
    const before = db.userVersion;
    const ups = migrations.map(migration => vi.fn());
    const watched = migrations.map((migration, index) => ({ ...migration, up: ups[index] }));
    await runMigrations(db as never, watched);
    expect(db.userVersion).toBe(before);
    ups.forEach(up => expect(up).not.toHaveBeenCalled());
  });

  it('keeps CURRENT_SCHEMA_VERSION aligned with the migration list', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(Math.max(...migrations.map(migration => migration.version)));
  });
});

// BUG-09-11a. Migration 7 adds reader index coverage and nothing else. These tests
// pin the parts a later reader could quietly break: that it stays additive, that every
// statement is idempotent so an interrupted retry cannot fail, that it is genuinely
// reversible because an index holds no user data, and that it does not carry an index
// with no consuming query.
describe('migration 7, reader index coverage (BUG-09-11a)', () => {
  const EXPECTED_INDEXES = [
    'idx_expenses_date',
    'idx_expenses_category',
    'idx_expenses_is_reimbursable',
    'idx_expenses_amount',
    'idx_income_date',
    'idx_notifications_created_at',
    'idx_notifications_read',
    'idx_chat_messages_created_at',
  ];

  const migration7 = () => {
    const found = migrations.find(migration => migration.version === 7);
    if (!found) throw new Error('migration 7 is missing from the migration list');
    return found;
  };

  it('adds the eight reader indexes, all with IF NOT EXISTS, and changes no table', async () => {
    const db = new MigrationDatabase();
    db.tables.set('expenses', new Set(['id', 'merchant', 'amount', 'currency', 'category', 'note', 'scanned', 'date', 'created_at']));
    db.tables.set('income', new Set(['id', 'source', 'amount', 'date', 'created_at']));
    const expensesBefore = [...(db.tables.get('expenses') ?? [])].sort();
    const incomeBefore = [...(db.tables.get('income') ?? [])].sort();

    const target = migration7();
    await target.up(db as never);

    expect(target.name).toBe('reader-index-coverage');
    expect([...db.indexes].sort()).toEqual([...EXPECTED_INDEXES].sort());
    expect(db.indexStatements).toHaveLength(8);
    db.indexStatements.forEach(statement => expect(statement).toContain('IF NOT EXISTS'));
    // Additive: no column, no table, no data write.
    expect([...(db.tables.get('expenses') ?? [])].sort()).toEqual(expensesBefore);
    expect([...(db.tables.get('income') ?? [])].sort()).toEqual(incomeBefore);
    expect(db.statements.join(' ')).not.toContain('ALTER TABLE');
    expect(db.statements.join(' ')).not.toContain('CREATE TABLE');

    // An interrupted retry re-runs the whole body without failing or duplicating.
    await target.up(db as never);
    expect(db.indexStatements).toHaveLength(16);
    expect([...db.indexes].sort()).toEqual([...EXPECTED_INDEXES].sort());
  });

  it('does not create expenses(scanned), which has no consuming statement after the collapse', async () => {
    const db = new MigrationDatabase();
    const target = migration7();
    await target.up(db as never);
    // Pins the finding recorded in bugfix-BUG-09-11-evidence.md: the pre-collapse
    // achievement pass was this index's only reader, and the collapsed aggregate scans
    // the table for its other eight columns. Re-adding it needs a query that reads it.
    expect(db.indexes.has('idx_expenses_scanned')).toBe(false);
  });

  it('is reversible: down drops exactly the indexes it created and claims no one way reason', async () => {
    const db = new MigrationDatabase();
    const target = migration7();
    expect(target.oneWayReason).toBeUndefined();

    await target.up(db as never);
    await target.down?.(db as never);

    expect([...db.indexes]).toEqual([]);
  });

  it('runs inside the runner as version 7 and leaves an existing row untouched', async () => {
    const db = new MigrationDatabase();
    db.tables.set('expenses', new Set(['id', 'merchant', 'amount', 'currency', 'category', 'note', 'scanned', 'date', 'created_at']));

    await runMigrations(db as never, migrations);

    expect(db.userVersion).toBe(7);
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    expect(db.records[0]).toEqual({ id: 'v1-expense', merchant: 'Market', amount: 12.5 });
    EXPECTED_INDEXES.forEach(index => expect(db.indexes.has(index)).toBe(true));
  });

  // Release blocking continuity guard, required by BUG-09-11a: the migration bumps
  // user_version to 7, and the v1 to v2 classifier treats any written version as a
  // v2 owned file. Both directions are asserted at the number this migration writes.
  it('keeps the continuity classifier correct at user_version 7', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    expect(7).toBe(Math.max(...migrations.map(migration => migration.version)));
    expect(classifyContinuitySchema(7, true)).toBe('v2');
    expect(classifyContinuitySchema(7, false)).toBe('v2');
    expect(classifyContinuitySchema(0, true)).toBe('v1');
    expect(classifyContinuitySchema(0, false)).toBe('none');
  });

  it('sets WAL and synchronous NORMAL before any transaction and optimises last, on every open', async () => {
    const db = new MigrationDatabase();

    await runMigrations(db as never, migrations);

    expect(db.statements.slice(0, 3)).toEqual(['PRAGMA journal_mode = WAL;', 'PRAGMA synchronous = NORMAL;', 'PRAGMA busy_timeout = 5000;']);
    expect(db.statements.indexOf('PRAGMA synchronous = NORMAL;')).toBeLessThan(db.statements.indexOf('BEGIN IMMEDIATE'));
    expect(db.statements.at(-1)).toBe('PRAGMA optimize;');

    // Second open of an already current file: the connection setup repeats and the
    // migration bodies do not.
    db.statements.length = 0;
    await runMigrations(db as never, migrations);
    expect(db.statements).toEqual(['PRAGMA journal_mode = WAL;', 'PRAGMA synchronous = NORMAL;', 'PRAGMA busy_timeout = 5000;', 'PRAGMA optimize;']);
  });
});
