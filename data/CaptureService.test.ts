import { describe, expect, it, vi } from 'vitest';
import { resolveExpenseBatchSave, resolveExpenseSave, resolveIncomeSave, resolveIncomeSaveWithRecurring, runCaptureSideEffects } from './CaptureService';
import type { CaptureCandidate, CaptureRepository, IncomeCandidate } from './contracts';

const expense: CaptureCandidate = {
  merchant: 'Cafe', amount: 12.5, currency: 'USD', category: 'dining', date: 1_700_000_000_000, source: 'manual', origin: 'manual_expense',
};
const income: IncomeCandidate = {
  sourceName: 'Employer', amount: 1000, currency: 'USD', category: 'salary', date: 1_700_000_000_000, source: 'manual', origin: 'manual_income',
};

function repository(overrides: Partial<CaptureRepository> = {}): CaptureRepository {
  return {
    findDuplicate: vi.fn().mockResolvedValue(null),
    findBatchDuplicates: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({ ...expense, id: 'saved', created_at: expense.date }),
    saveBatch: vi.fn().mockResolvedValue([{ ...expense, id: 'saved', created_at: expense.date }]),
    findIncomeDuplicate: vi.fn().mockResolvedValue(null),
    saveIncome: vi.fn().mockResolvedValue({ ...income, id: 'saved', created_at: income.date }),
    withTransaction: vi.fn(async operation => operation()),
    getRecurringTemplateHandoff: vi.fn(() => ({ createFromCapture: vi.fn().mockResolvedValue('template') })),
    rememberCategory: vi.fn(), getRememberedCategory: vi.fn(), recordEvent: vi.fn().mockResolvedValue('event'), listEvents: vi.fn().mockResolvedValue([]), enqueueAutoCapture: vi.fn(),
     claimQueuedAutoCaptures: vi.fn(), completeQueuedAutoCapture: vi.fn(), failQueuedAutoCapture: vi.fn(), discardQueuedAutoCaptures: vi.fn(), ...overrides,
  };
}

describe('shared capture save boundary', () => {
  it('does not persist before review confirmation', async () => {
    const repo = repository();
    const result = await resolveExpenseSave(repo, expense, 'discard');
    expect(result.status).toBe('discarded');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('returns duplicate for confirmation and saves only after forced resolution', async () => {
    const repo = repository({ findDuplicate: vi.fn().mockResolvedValue({ existing: { ...expense, id: 'existing' }, reason: 'merchant_amount_24h' }) });
    const duplicate = await resolveExpenseSave(repo, expense);
    expect(duplicate.status).toBe('duplicate');
    expect(repo.save).not.toHaveBeenCalled();
    const saved = await resolveExpenseSave(repo, expense, 'save_anyway');
    expect(saved.status).toBe('saved');
    expect(repo.save).toHaveBeenCalledWith(expense, true);
  });

  it('keeps income duplicate flow and side effects streak-only', async () => {
    const repo = repository({ findIncomeDuplicate: vi.fn().mockResolvedValue({ existing: { ...income, id: 'existing' }, reason: 'source_amount_24h' }) });
    const duplicate = await resolveIncomeSave(repo, income);
    expect(duplicate.status).toBe('duplicate');
    const hooks = { onExpenseSaved: vi.fn(), onIncomeSaved: vi.fn().mockResolvedValue(undefined), scheduleNotification: vi.fn() };
    const saved = await resolveIncomeSave(repo, income, 'save_anyway');
    await runCaptureSideEffects(saved, income, hooks);
    expect(hooks.onIncomeSaved).toHaveBeenCalledOnce();
    expect(hooks.onExpenseSaved).not.toHaveBeenCalled();
    expect(hooks.scheduleNotification).toHaveBeenCalledWith(income, 'saved');
  });

  it('resolves every batch match before atomic save', async () => {
    const repo = repository({ findBatchDuplicates: vi.fn().mockResolvedValue([{ candidateIndex: 1, otherCandidateIndex: 0, reason: 'same_batch_24h' }]) });
    const second = { ...expense, merchant: 'Cafe' };
    await expect(resolveExpenseBatchSave(repo, [expense, second])).resolves.toMatchObject({ status: 'needs_review', matches: [{ candidateIndex: 1 }] });
    expect(repo.saveBatch).not.toHaveBeenCalled();
    await expect(resolveExpenseBatchSave(repo, [expense, second], 'save_anyway')).resolves.toMatchObject({ status: 'saved' });
    expect(repo.saveBatch).toHaveBeenCalledWith([expense, second], true);
  });

  it('checks later receipt items before creating confirmation metadata or saving', async () => {
    const second = { ...expense, merchant: 'Market', amount: 20 };
    const findBatchDuplicates = vi.fn(async (candidates: CaptureCandidate[]) => candidates.flatMap((candidate, candidateIndex) => (
      candidateIndex === 1 ? [{ candidateIndex, match: { existing: {
        id: 'existing', merchant: candidate.merchant, amount: candidate.amount, currency: candidate.currency,
        category: candidate.category, scanned: 0, date: candidate.date, created_at: candidate.date,
      }, reason: 'merchant_amount_24h' as const } }] : []
    )));
    const repo = repository({ findBatchDuplicates });

    const result = await resolveExpenseBatchSave(repo, [expense, second]);

    expect(findBatchDuplicates).toHaveBeenCalledWith([expense, second]);
    expect(result).toMatchObject({ status: 'needs_review', matches: [{ candidateIndex: 1 }] });
    expect(result.origins).toHaveLength(2);
    expect(repo.saveBatch).not.toHaveBeenCalled();
  });

  it('rejects non-finite income dates before duplicate lookup', async () => {
    const repo = repository();
    await expect(resolveIncomeSave(repo, { ...income, date: Number.NaN })).rejects.toMatchObject({ field: 'date' });
    expect(repo.findIncomeDuplicate).not.toHaveBeenCalled();
  });

  it('requires income category before duplicate lookup', async () => {
    const repo = repository();
    await expect(resolveIncomeSave(repo, { ...income, category: '' })).rejects.toMatchObject({ field: 'category' });
    expect(repo.findIncomeDuplicate).not.toHaveBeenCalled();
  });

  it('rolls back income and recurring handoff together', async () => {
    const repo = repository();
    const handoff = { createFromCapture: vi.fn().mockRejectedValue(new Error('handoff failed')) };
    await expect(resolveIncomeSaveWithRecurring(repo, { ...income, isRecurring: true }, handoff)).rejects.toThrow('handoff failed');
    expect(repo.withTransaction).toHaveBeenCalledOnce();
  });

  it('records discarded and duplicate-skipped outcomes for the diagnostic log', async () => {
    const discardRepo = repository();
    await resolveExpenseSave(discardRepo, expense, 'discard');
    expect(discardRepo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'discarded', merchant: 'Cafe', amount: 12.5 }));

    const duplicateRepo = repository({ findDuplicate: vi.fn().mockResolvedValue({ existing: { ...expense, id: 'existing' }, reason: 'merchant_amount_24h' }) });
    await resolveExpenseSave(duplicateRepo, expense);
    expect(duplicateRepo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'duplicate_skipped' }));

    const incomeRepo = repository({ findIncomeDuplicate: vi.fn().mockResolvedValue({ existing: { ...income, id: 'existing' }, reason: 'source_amount_24h' }) });
    await resolveIncomeSave(incomeRepo, income);
    expect(incomeRepo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'duplicate_skipped', merchant: 'Employer' }));
  });

  it('records batch discard and duplicate outcomes once per candidate', async () => {
    const second = { ...expense, merchant: 'Market', amount: 20 };
    const discardRepo = repository();
    await resolveExpenseBatchSave(discardRepo, [expense, second], 'discard');
    expect(discardRepo.recordEvent).toHaveBeenCalledTimes(2);
    expect(discardRepo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'discarded', merchant: 'Cafe' }));
    expect(discardRepo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'discarded', merchant: 'Market' }));

    const repo = repository({ findBatchDuplicates: vi.fn().mockResolvedValue([{ candidateIndex: 1, otherCandidateIndex: 0, reason: 'same_batch_24h' }]) });
    await resolveExpenseBatchSave(repo, [expense, second]);
    expect(repo.recordEvent).toHaveBeenCalledOnce();
    expect(repo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'duplicate_skipped', merchant: 'Market' }));
  });
});
