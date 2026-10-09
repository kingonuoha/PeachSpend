import type { Expense, Income } from '../types/database';
import {
  assertValidCaptureCandidate,
  type CaptureCandidate,
  type CaptureEventInput,
  type CaptureOriginMetadata,
  type CaptureRepository,
  type CaptureSideEffectHooks,
  type IncomeCandidate,
  type RecurringTemplateHandoff,
  type SaveDecision,
  type SaveResolution,
  type BatchDuplicateMatch,
  type BatchSaveDecision,
  type BatchSaveResolution,
  IncomeValidationError,
} from './contracts';

export function createOriginMetadata(candidate: CaptureCandidate | IncomeCandidate, reviewed: boolean): CaptureOriginMetadata {
  return { source: candidate.source, origin: candidate.origin ?? 'home', reviewed };
}

// Writes a terminal outcome to the capture audit log so S-22 Diagnostic Activity
// (FR-22.3) can show discards and duplicate skips, not only confirmed saves.
// The ledger record itself is never touched here; this is audit-only.
function outcomeEvent(candidate: CaptureCandidate | IncomeCandidate, status: 'discarded' | 'duplicate_skipped'): CaptureEventInput {
  return {
    source: candidate.source,
    status,
    merchant: 'merchant' in candidate ? candidate.merchant : candidate.sourceName,
    amount: candidate.amount,
    category: candidate.category,
    payload: JSON.stringify({ origin: candidate.origin ?? 'home' }),
  };
}

export function validateIncomeCandidate(candidate: IncomeCandidate): void {
  if (!candidate.sourceName.trim()) throw new IncomeValidationError('sourceName');
  if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) throw new IncomeValidationError('amount');
  if (!candidate.currency.trim()) throw new IncomeValidationError('currency');
  if (!candidate.category.trim()) throw new IncomeValidationError('category');
  if (!Number.isFinite(candidate.date)) throw new IncomeValidationError('date');
}

export async function resolveExpenseSave(
  repository: CaptureRepository,
  candidate: CaptureCandidate,
  decision: SaveDecision = 'confirm',
): Promise<SaveResolution<Expense>> {
  assertValidCaptureCandidate(candidate);
  const origin = createOriginMetadata(candidate, true);
  if (decision === 'discard') {
    await repository.recordEvent(outcomeEvent(candidate, 'discarded'));
    return { status: 'discarded', origin };
  }
  const duplicate = decision === 'save_anyway' ? null : await repository.findDuplicate(candidate);
  if (duplicate) {
    await repository.recordEvent(outcomeEvent(candidate, 'duplicate_skipped'));
    return { status: 'duplicate', duplicate, origin };
  }
  const record = await saveWithRecurring(repository, candidate, () => repository.save(candidate, true));
  return { status: 'saved', record, origin };
}

export async function resolveIncomeSave(
  repository: CaptureRepository,
  candidate: IncomeCandidate,
  decision: SaveDecision = 'confirm',
): Promise<SaveResolution<Income>> {
  validateIncomeCandidate(candidate);
  const origin = createOriginMetadata(candidate, true);
  if (decision === 'discard') {
    await repository.recordEvent(outcomeEvent(candidate, 'discarded'));
    return { status: 'discarded', origin };
  }
  const duplicate = decision === 'save_anyway' ? null : await repository.findIncomeDuplicate(candidate);
  if (duplicate) {
    await repository.recordEvent(outcomeEvent(candidate, 'duplicate_skipped'));
    return { status: 'duplicate', duplicate, origin };
  }
  const record = await saveWithRecurring(repository, candidate, () => repository.saveIncome(candidate, true));
  return { status: 'saved', record, origin };
}

export async function resolveExpenseBatchSave(
  repository: CaptureRepository,
  candidates: CaptureCandidate[],
  decision: BatchSaveDecision = 'confirm',
): Promise<BatchSaveResolution> {
  candidates.forEach(assertValidCaptureCandidate);
  const matches: BatchDuplicateMatch[] = await repository.findBatchDuplicates(candidates);
  const origins = candidates.map(candidate => createOriginMetadata(candidate, true));
  if (decision === 'discard') {
    for (const candidate of candidates) await repository.recordEvent(outcomeEvent(candidate, 'discarded'));
    return { status: 'discarded', matches, origins };
  }
  if (matches.length > 0 && decision === 'confirm') {
    const skippedIndexes = new Set(matches.map(match => match.candidateIndex));
    for (const index of skippedIndexes) await repository.recordEvent(outcomeEvent(candidates[index], 'duplicate_skipped'));
    return { status: 'needs_review', matches, origins };
  }
  return { status: 'saved', records: await repository.saveBatch(candidates, decision === 'save_anyway'), matches, origins };
}

export async function runCaptureSideEffects(
  resolution: SaveResolution<Expense | Income>,
  candidate: CaptureCandidate | IncomeCandidate,
  hooks: CaptureSideEffectHooks,
): Promise<void> {
  if (resolution.status !== 'saved') return;
  hooks.scheduleNotification(candidate, resolution.record.id);
  if ('merchant' in candidate) await hooks.onExpenseSaved();
  else await hooks.onIncomeSaved();
}

export function handoffRecurringTemplate(
  candidate: CaptureCandidate | IncomeCandidate,
  handoff: RecurringTemplateHandoff,
): Promise<string> {
  return handoff.createFromCapture(candidate);
}

async function saveWithRecurring<T extends Expense | Income>(
  repository: CaptureRepository,
  candidate: CaptureCandidate | IncomeCandidate,
  save: () => Promise<T>,
): Promise<T> {
  if (!candidate.isRecurring) return save();
  return repository.withTransaction(async () => {
    const record = await save();
    await handoffRecurringTemplate(candidate, repository.getRecurringTemplateHandoff());
    return record;
  });
}

export async function resolveIncomeSaveWithRecurring(
  repository: CaptureRepository,
  candidate: IncomeCandidate,
  handoff: RecurringTemplateHandoff,
  decision: SaveDecision = 'confirm',
): Promise<SaveResolution<Income>> {
  validateIncomeCandidate(candidate);
  const origin = createOriginMetadata(candidate, true);
  if (decision === 'discard') {
    await repository.recordEvent(outcomeEvent(candidate, 'discarded'));
    return { status: 'discarded', origin };
  }
  const duplicate = decision === 'save_anyway' ? null : await repository.findIncomeDuplicate(candidate);
  if (duplicate) {
    await repository.recordEvent(outcomeEvent(candidate, 'duplicate_skipped'));
    return { status: 'duplicate', duplicate, origin };
  }
  const record = await repository.withTransaction(async () => {
    const saved = await repository.saveIncome(candidate, true);
    if (candidate.isRecurring) await handoff.createFromCapture(candidate);
    return saved;
  });
  return { status: 'saved', record, origin };
}
