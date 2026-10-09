import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import type { CaptureSource } from './contracts';
import { deriveExpenseOrigin, ExpenseDetailService, type ExpenseDetailDataSource } from './ExpenseDetail';

const expense = (id: string, fields: Partial<Expense> = {}): Expense => ({
  id, merchant: 'Cafe', amount: 12, currency: 'USD', category: 'dining', scanned: 0, date: 1000, created_at: 1000, ...fields,
});

function dataSource(expenses: Expense[]): ExpenseDetailDataSource & { updateExpenseCategory: ReturnType<typeof vi.fn>; deleteExpense: ReturnType<typeof vi.fn> } {
  return {
    getExpenseById: vi.fn(async (id: string) => expenses.find(item => item.id === id) ?? null),
    listExpenses: vi.fn(async () => expenses),
    updateExpenseCategory: vi.fn(async () => undefined),
    deleteExpense: vi.fn(async () => undefined),
  };
}

describe('deriveExpenseOrigin', () => {
  it('maps stored capture sources to the auto-capture, manual, or scanned origin', () => {
    const cases: [CaptureSource, string][] = [
      ['auto_capture', 'auto_capture'], ['ocr', 'scanned'], ['share', 'scanned'],
      ['manual', 'manual'], ['chat', 'manual'], ['import', 'manual'],
    ];
    for (const [source, origin] of cases) {
      expect(deriveExpenseOrigin({ source, scanned: 0 })).toBe(origin);
    }
  });

  it('infers a legacy origin from the scanned flag when no source is stored', () => {
    expect(deriveExpenseOrigin({ source: undefined, scanned: 1 })).toBe('scanned');
    expect(deriveExpenseOrigin({ source: undefined, scanned: 0 })).toBe('manual');
  });
});

describe('ExpenseDetailService paging', () => {
  it('returns previous and next ids for the arrival order', async () => {
    const expenses = [expense('a'), expense('b'), expense('c')];
    const service = new ExpenseDetailService(dataSource(expenses), { rememberCategory: vi.fn() });

    const detail = await service.readDetail('b');
    expect(detail?.position).toEqual({ index: 1, total: 3, previousId: 'a', nextId: 'c' });
    expect(detail?.origin).toBe('manual');
  });

  it('pages within a caller-supplied filtered order', async () => {
    const expenses = [expense('a'), expense('b'), expense('c')];
    const service = new ExpenseDetailService(dataSource(expenses), { rememberCategory: vi.fn() });

    const detail = await service.readDetail('c', ['c', 'a']);
    expect(detail?.position).toEqual({ index: 0, total: 2, previousId: null, nextId: 'a' });
  });

  it('returns null for a missing record', async () => {
    const service = new ExpenseDetailService(dataSource([]), { rememberCategory: vi.fn() });
    expect(await service.readDetail('missing')).toBeNull();
  });
});

describe('ExpenseDetailService category learning', () => {
  it('learns the merchant category only for an auto-capture record', async () => {
    const expenses = [expense('auto', { source: 'auto_capture' })];
    const data = dataSource(expenses);
    const memory = { rememberCategory: vi.fn(async () => undefined) };
    const service = new ExpenseDetailService(data, memory);

    const result = await service.editCategory('auto', 'groceries');
    expect(result).toEqual({ status: 'updated', origin: 'auto_capture', learned: true });
    expect(data.updateExpenseCategory).toHaveBeenCalledWith('auto', 'groceries');
    expect(memory.rememberCategory).toHaveBeenCalledWith('Cafe', 'groceries', 'auto_capture');
  });

  it('does not touch per-merchant memory for a manual or scanned record', async () => {
    const expenses = [expense('manual', { source: 'manual' }), expense('scanned', { source: 'ocr' })];
    const memory = { rememberCategory: vi.fn(async () => undefined) };
    const service = new ExpenseDetailService(dataSource(expenses), memory);

    expect(await service.editCategory('manual', 'other')).toMatchObject({ learned: false });
    expect(await service.editCategory('scanned', 'other')).toMatchObject({ learned: false });
    expect(memory.rememberCategory).not.toHaveBeenCalled();
  });

  it('reports not_found without writing', async () => {
    const data = dataSource([]);
    const memory = { rememberCategory: vi.fn(async () => undefined) };
    const service = new ExpenseDetailService(data, memory);
    expect(await service.editCategory('missing', 'other')).toEqual({ status: 'not_found' });
    expect(data.updateExpenseCategory).not.toHaveBeenCalled();
  });
});

describe('ExpenseDetailService delete boundary', () => {
  it('performs a single typed delete and reports missing records', async () => {
    const data = dataSource([expense('a')]);
    const service = new ExpenseDetailService(data, { rememberCategory: vi.fn() });
    expect(await service.delete('a')).toEqual({ status: 'deleted' });
    expect(data.deleteExpense).toHaveBeenCalledWith('a');
    expect(await service.delete('missing')).toEqual({ status: 'not_found' });
  });
});
