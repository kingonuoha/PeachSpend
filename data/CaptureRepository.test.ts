import { describe, expect, it, vi } from 'vitest';
import { SqliteCaptureRepository } from './CaptureRepository';
import type { Expense } from '../types/database';
import type { CaptureCandidate } from './contracts';

const existingExpense: Expense = {
  id: 'existing',
  merchant: 'Cafe',
  amount: 12.5,
  currency: 'USD',
  category: 'dining',
  scanned: 1,
  date: 1_700_000_000_000,
  created_at: 1_700_100_000_000,
};

describe('SqliteCaptureRepository duplicate detection', () => {
  it('checks every candidate in a receipt batch', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([]);
    const repository = new SqliteCaptureRepository({ getAllAsync } as never);
    const candidates: CaptureCandidate[] = [
      { merchant: 'Cafe', amount: 12.5, currency: 'USD', category: 'dining', date: existingExpense.date, source: 'ocr' },
      { merchant: 'Market', amount: 30, currency: 'USD', category: 'shopping', date: existingExpense.date, source: 'ocr' },
    ];

    await expect(repository.findBatchDuplicates(candidates)).resolves.toEqual([]);
    expect(getAllAsync).toHaveBeenCalledTimes(candidates.length);
  });

  it('compares candidate date with transaction date, not created_at', async () => {
    const getFirstAsync = vi.fn().mockResolvedValue(existingExpense);
    const repository = new SqliteCaptureRepository({ getFirstAsync } as never);

    await expect(repository.findDuplicate({ merchant: 'Cafe', amount: 12.5, date: existingExpense.date })).resolves.toEqual({
      existing: existingExpense,
      reason: 'merchant_amount_24h',
    });

    const [query, params] = getFirstAsync.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('date BETWEEN ? AND ?');
    expect(query).not.toContain('created_at BETWEEN');
    expect(params).toEqual(['Cafe', 12.5, existingExpense.date - 86400000, existingExpense.date + 86400000]);
    expect(params.slice(1).every(value => typeof value === 'number')).toBe(true);
  });

  it('rolls back explicit repository transactions after operation failure', async () => {
    const execAsync = vi.fn().mockResolvedValue(undefined);
    const repository = new SqliteCaptureRepository({ execAsync } as never);

    await expect(repository.withTransaction(async () => { throw new Error('write_failed'); })).rejects.toThrow('write_failed');
    expect(execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });
});

describe('SqliteCaptureRepository diagnostic activity read', () => {
  it('maps recent capture events and applies the since window, source filter, and bounded limit', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([
      { id: 'e1', source: 'auto_capture', status: 'duplicate_skipped', merchant: 'Cafe', amount: 12.5, category: 'dining', error_code: null, created_at: 500, updated_at: 500 },
      { id: 'e2', source: 'auto_capture', status: 'discarded', merchant: null, amount: null, category: null, error_code: 'parse_failed', created_at: 400, updated_at: 400 },
    ]);
    const repository = new SqliteCaptureRepository({ getAllAsync } as never);

    const events = await repository.listEvents({ since: 100, sources: ['auto_capture'], limit: 10 });

    expect(events).toEqual([
      { id: 'e1', source: 'auto_capture', status: 'duplicate_skipped', merchant: 'Cafe', amount: 12.5, category: 'dining', errorCode: null, createdAt: 500, updatedAt: 500 },
      { id: 'e2', source: 'auto_capture', status: 'discarded', merchant: null, amount: null, category: null, errorCode: 'parse_failed', createdAt: 400, updatedAt: 400 },
    ]);
    const [sql, params] = getAllAsync.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('created_at >= ?');
    expect(sql).toContain('source IN (?)');
    expect(sql).toContain('ORDER BY created_at DESC LIMIT ?');
    expect(params).toEqual([100, 'auto_capture', 10]);
  });

  it('defaults to the 30 day window and clamps the requested limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    const getAllAsync = vi.fn().mockResolvedValue([]);
    const repository = new SqliteCaptureRepository({ getAllAsync } as never);

    await repository.listEvents({ limit: 10_000 });
    const [, params] = getAllAsync.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([1_000_000_000_000 - 30 * 86400000, 200]);

    await repository.listEvents({ limit: 0 });
    const [, capped] = getAllAsync.mock.calls[1] as [string, unknown[]];
    expect(capped).toEqual([1_000_000_000_000 - 30 * 86400000, 1]);
    vi.useRealTimers();
  });
});

describe('SqliteCaptureRepository reimbursable persistence', () => {
  it('persists the reimbursable flag through the shared save boundary', async () => {
    const getFirstAsync = vi.fn()
      .mockResolvedValueOnce({ value: 'USD' })
      .mockResolvedValueOnce(null);
    const runAsync = vi.fn().mockResolvedValue(undefined);
    const repository = new SqliteCaptureRepository({ getFirstAsync, runAsync } as never);

    await repository.save({ merchant: 'Cafe', amount: 12.5, currency: 'USD', category: 'dining', date: 1, source: 'manual', isReimbursable: true });

    const insert = runAsync.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO expenses')) as [string, unknown[]];
    expect(insert[0]).toContain('is_reimbursable');
    expect(insert[0]).toContain('source');
    const columns = insert[0].slice(insert[0].indexOf('(') + 1, insert[0].indexOf(')')).split(',').map(column => column.trim());
    expect(insert[1][columns.indexOf('is_reimbursable')]).toBe(1);
    expect(insert[1][columns.indexOf('source')]).toBe('manual');
  });
});
