import { describe, expect, it, vi } from 'vitest';
import type { CaptureRepository } from '../../data';
import type { Expense } from '../../types/database';
import { prepareImportPreview, saveImportPreview } from './importCapture';
import { CaptureValidationError } from '../../data/contracts';

const repositoryFor = (findDuplicate: CaptureRepository['findDuplicate'], save: CaptureRepository['save']) => ({
  findDuplicate, save, recordEvent: vi.fn(),
} as unknown as CaptureRepository);

describe('import duplicate boundary', () => {
  it('flags each duplicate before import', async () => {
    const findDuplicate = vi.fn().mockResolvedValueOnce({ existing: { id: 'existing' }, reason: 'merchant_amount_24h' }).mockResolvedValueOnce(null);
    const items = await prepareImportPreview([
        { merchant: 'Market', amount: 12, currency: 'CAD', category: 'shopping', date: 10 },
        { merchant: 'Cafe', amount: 8, currency: 'CAD', category: 'dining', date: 10 },
    ], repositoryFor(findDuplicate, vi.fn()), 'CAD');

    expect(items.map(item => item.decision)).toEqual(['pending', 'save']);
    expect(items[0].duplicate?.reason).toBe('merchant_amount_24h');
  });

  it('saves selected duplicates and skips discarded items', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved' });
    const repository = repositoryFor(vi.fn(), save);
     const items = await prepareImportPreview([{ merchant: 'Market', amount: 12, currency: 'CAD', category: 'shopping', date: 10 }], repository, 'CAD');
    const result = await saveImportPreview([
      { ...items[0], duplicate: { existing: {} as Expense, reason: 'merchant_amount_24h' }, decision: 'save' },
      { ...items[0], decision: 'discard' },
    ], repository);

    expect(result).toEqual({ imported: 1, errors: [] });
    expect(save).toHaveBeenCalledWith(items[0].candidate, true);
  });

  it('rejects missing required source fields instead of creating defaults', async () => {
    await expect(prepareImportPreview([{ merchant: 'Market', amount: 12 }], repositoryFor(vi.fn(), vi.fn()), 'CAD'))
      .rejects.toBeInstanceOf(CaptureValidationError);
  });
});
