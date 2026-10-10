import { describe, expect, it, vi } from 'vitest';
import { migrations, runMigrations } from './migrations';
import { CURRENT_SCHEMA_VERSION } from './ContinuityService';

class MigrationDatabase {
  userVersion = 0;
  tables = new Map<string, Set<string>>();
  records = [{ id: 'v1-expense', merchant: 'Market', amount: 12.5 }];
  inTransaction = false;
  async execAsync(sql: string): Promise<void> {
    if (sql === 'BEGIN') { this.inTransaction = true; return; }
    if (sql === 'COMMIT') { this.inTransaction = false; return; }
    if (sql === 'ROLLBACK') { this.inTransaction = false; return; }
    const pragma = sql.match(/PRAGMA user_version = (\d+)/);
    if (pragma) { this.userVersion = Number(pragma[1]); return; }
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([^)]*)\)/g)) {
      this.tables.set(match[1], new Set(match[2].split(',').map(column => column.trim().split(/\s+/)[0])));
    }
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
    expect(db.userVersion).toBe(6);
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
    expect(db.userVersion).toBe(6);
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
