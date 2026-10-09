import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import { CaptureValidationError } from './contracts';
import type { CaptureRepository } from './contracts';
import {
  buildImportCandidate, commitImportItems, editImportItem, includedImportCount,
  parseImportInput, prepareImportPreview, refreshImportItem, resolveImportAiAvailability, toggleImportItem,
} from './ImportDataService';
import { EXTERNAL_IMPORT_PROMPT } from './ImportContracts';
import type { ImportDataSource } from './ImportContracts';

const repositoryFor = (
  findDuplicate: CaptureRepository['findDuplicate'],
  save: CaptureRepository['save'] = vi.fn(),
): CaptureRepository => ({ findDuplicate, save, recordEvent: vi.fn() } as unknown as CaptureRepository);

const row = (overrides: Partial<Expense> = {}): Partial<Expense> => ({
  merchant: 'Market', amount: 12, currency: 'CAD', category: 'groceries', date: 10, ...overrides,
});

describe('import candidate validation', () => {
  it('rejects a row instead of filling defaults', () => {
    expect(() => buildImportCandidate({ merchant: 'Cafe', amount: 0 })).toThrow(CaptureValidationError);
    expect(() => buildImportCandidate(row())).not.toThrow();
  });
});

describe('editable preview with duplicate detection', () => {
  it('flags duplicates as excluded and valid rows as included', async () => {
    const findDuplicate = vi.fn()
      .mockResolvedValueOnce({ existing: { id: 'existing' }, reason: 'merchant_amount_24h' })
      .mockResolvedValueOnce(null);
    const items = await prepareImportPreview([row(), row({ merchant: 'Cafe', category: 'dining' })], repositoryFor(findDuplicate));

    expect(items.map(item => item.included)).toEqual([false, true]);
    expect(items[0].duplicate?.reason).toBe('merchant_amount_24h');
    expect(includedImportCount(items)).toBe(1);
  });

  it('keeps an invalid row visible with a typed field error', async () => {
    const items = await prepareImportPreview([row({ currency: '' })], repositoryFor(vi.fn()));
    expect(items[0]).toMatchObject({ candidate: null, error: 'currency', included: false });
  });

  it('edits an item and re-probes its duplicate against existing records', async () => {
    const findDuplicate = vi.fn().mockResolvedValue(null);
    const repository = repositoryFor(findDuplicate);
    const [item] = await prepareImportPreview([row()], repository);

    const [edited] = editImportItem([item], item.id, { amount: 99 });
    expect(edited.expense.amount).toBe(99);
    expect(edited.included).toBe(true);

    findDuplicate.mockResolvedValue({ existing: { id: 'existing' }, reason: 'merchant_amount_24h' });
    const [refreshed] = await refreshImportItem([edited], edited.id, repository);
    expect(refreshed.duplicate).not.toBeNull();
    expect(refreshed.included).toBe(false);
  });

  it('toggles inclusion without touching the candidate', async () => {
    const [item] = await prepareImportPreview([row()], repositoryFor(vi.fn().mockResolvedValue(null)));
    expect(toggleImportItem([item], item.id, false)[0].included).toBe(false);
  });
});

describe('batch commit of included items only', () => {
  it('imports included rows, skips excluded duplicates, and reports the real count', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved' });
    const repository = repositoryFor(vi.fn().mockResolvedValue({ existing: { id: 'existing' }, reason: 'merchant_amount_24h' }), save);
    const items = await prepareImportPreview([row(), row({ merchant: 'Skipped', category: 'other' })], repository);
    const included = toggleImportItem(items, items[0].id, true);

    const result = await commitImportItems(included, repository);
    expect(result).toEqual({ status: 'committed', imported: 1, skipped: 1, failed: 0, errors: [] });
    expect(save).toHaveBeenCalledWith(included[0].candidate, true);
  });

  it('counts a save failure without aborting the batch', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk'));
    const repository = repositoryFor(vi.fn().mockResolvedValue(null), save);
    const items = await prepareImportPreview([row()], repository);

    await expect(commitImportItems(items, repository)).resolves.toEqual({
      status: 'committed', imported: 0, skipped: 0, failed: 1, errors: ['Item 1: import_save_failed'],
    });
  });
});

describe('AI-assisted import context (FR-12.1, FR-12.6)', () => {  it('defaults to in-app chat at Tier 2 when connected with a key', () => {
    expect(resolveImportAiAvailability(true, true)).toEqual({ status: 'in_app', feature: 'chat', intent: 'import', tier: 2, prompt: EXTERNAL_IMPORT_PROMPT });
  });

  it('degrades to the external prompt offline or without a key', () => {
    expect(resolveImportAiAvailability(false, true)).toMatchObject({ status: 'external', reason: 'offline' });
    expect(resolveImportAiAvailability(true, false)).toMatchObject({ status: 'external', reason: 'missing_key' });
  });
});

describe('import parse state (FR-12.2)', () => {
  const parser = (result: { expenses: Partial<Expense>[]; errors: string[] }): ImportDataSource => ({ parseImportData: () => result });

  it('reports parsed items, an empty input, and a parser failure distinctly', async () => {
    const repository = repositoryFor(vi.fn().mockResolvedValue(null));

    await expect(parseImportInput(parser({ expenses: [row()], errors: [] }), repository, 'x')).resolves.toMatchObject({ status: 'parsed', errors: [] });
    await expect(parseImportInput(parser({ expenses: [], errors: [] }), repository, '')).resolves.toEqual({ status: 'empty', errors: [] });
    await expect(parseImportInput(parser({ expenses: [], errors: ['bad format'] }), repository, 'x')).resolves.toEqual({ status: 'failed', errors: ['bad format'] });
  });
});
