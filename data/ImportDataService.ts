import { chatActionTier } from '../ai/chatActions';
import type { Expense } from '../types/database';
import { CaptureValidationError, assertValidCaptureCandidate, type CaptureCandidate, type CaptureRepository } from './contracts';
import { EXTERNAL_IMPORT_PROMPT, type ImportAiAvailability, type ImportCommitResult, type ImportDataSource, type ImportItemError, type ImportParseState, type ImportPreviewItem } from './ImportContracts';

// Converts a parsed or AI-returned expense into the same CaptureCandidate every
// other capture path uses. Throws the typed validation error rather than filling
// a default, so an incomplete row never becomes a fabricated transaction.
export function buildImportCandidate(expense: Partial<Expense>): CaptureCandidate {
  if (typeof expense.merchant !== 'string' || !expense.merchant.trim()) throw new CaptureValidationError('merchant');
  if (typeof expense.amount !== 'number' || !Number.isFinite(expense.amount) || expense.amount <= 0) throw new CaptureValidationError('amount');
  if (typeof expense.currency !== 'string' || !expense.currency.trim()) throw new CaptureValidationError('currency');
  if (typeof expense.category !== 'string' || !expense.category.trim()) throw new CaptureValidationError('category');
  const candidate: CaptureCandidate = {
    merchant: expense.merchant,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    date: expense.date || Date.now(),
    note: expense.note,
    source: 'import',
    scanned: expense.scanned === 1,
    unitPrice: expense.unit_price,
    units: expense.units,
  };
  assertValidCaptureCandidate(candidate);
  return candidate;
}

function fieldFromError(error: unknown): ImportItemError | null {
  if (error instanceof CaptureValidationError) return error.field as ImportItemError;
  return null;
}

// Shared review-before-save preview (FR-12.3, FR-12.4). Each item is editable,
// and its duplicate flag is probed against real existing records before commit.
export async function prepareImportPreview(
  expenses: Partial<Expense>[],
  repository: CaptureRepository,
): Promise<ImportPreviewItem[]> {
  const items: ImportPreviewItem[] = [];
  for (const [index, expense] of expenses.entries()) {
    let candidate: CaptureCandidate | null = null;
    let error: ImportItemError | null = null;
    try {
      candidate = buildImportCandidate(expense);
    } catch (thrown) {
      error = fieldFromError(thrown);
    }
    const duplicate = candidate ? await repository.findDuplicate(candidate) : null;
    items.push({
      id: `import_${index}`,
      expense,
      candidate,
      duplicate,
      included: candidate !== null && duplicate === null,
      error,
    });
  }
  return items;
}

export function toggleImportItem(items: ImportPreviewItem[], id: string, included: boolean): ImportPreviewItem[] {
  return items.map(item => (item.id === id ? { ...item, included } : item));
}

// Editing changes the candidate, so the previous duplicate verdict no longer
// applies; the caller re-runs duplicate detection by calling refreshImportItem.
export function editImportItem(items: ImportPreviewItem[], id: string, patch: Partial<Expense>): ImportPreviewItem[] {
  return items.map(item => {
    if (item.id !== id) return item;
    const expense = { ...item.expense, ...patch };
    let candidate: CaptureCandidate | null = null;
    let error: ImportItemError | null = null;
    try {
      candidate = buildImportCandidate(expense);
    } catch (thrown) {
      error = fieldFromError(thrown);
    }
    return { ...item, expense, candidate, duplicate: null, included: candidate !== null, error };
  });
}

export async function refreshImportItem(
  items: ImportPreviewItem[],
  id: string,
  repository: CaptureRepository,
): Promise<ImportPreviewItem[]> {
  const target = items.find(item => item.id === id);
  if (!target?.candidate) return items;
  const duplicate = await repository.findDuplicate(target.candidate);
  return items.map(item => (item.id === id ? { ...item, duplicate, included: duplicate === null } : item));
}

export function includedImportCount(items: ImportPreviewItem[]): number {
  return items.filter(item => item.included && item.candidate !== null).length;
}

// FR-12.5 commit boundary. Only included items are written; excluded duplicates
// are recorded as skipped in the shared capture audit log. The returned count is
// the real number of records created.
export async function commitImportItems(
  items: ImportPreviewItem[],
  repository: CaptureRepository,
): Promise<ImportCommitResult> {
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const [index, item] of items.entries()) {
    if (!item.included || !item.candidate) {
      skipped += 1;
      if (!item.included && item.duplicate) {
        const existing = item.duplicate.existing;
        await repository.recordEvent({
          source: 'import',
          status: 'duplicate_skipped',
          merchant: item.candidate?.merchant ?? ('merchant' in existing ? existing.merchant : existing.source),
          amount: item.candidate?.amount ?? existing.amount,
          category: item.candidate?.category ?? existing.category,
        });
      }
      continue;
    }
    try {
      await repository.save(item.candidate, item.duplicate !== null);
      imported += 1;
    } catch {
      failed += 1;
      errors.push(`Item ${index + 1}: import_save_failed`);
    }
  }
  return { status: 'committed', imported, skipped, failed, errors };
}

// FR-12.2 parse boundary. A parse that finds no row reports empty when the
// parser gave no message, and failed when it did, so the screen never shows a
// silent blank preview.
export async function parseImportInput(
  source: ImportDataSource,
  repository: CaptureRepository,
  input: string,
): Promise<ImportParseState> {
  const parsed = source.parseImportData(input);
  if (parsed.expenses.length === 0) {
    return parsed.errors.length > 0 ? { status: 'failed', errors: parsed.errors } : { status: 'empty', errors: [] };
  }
  return { status: 'parsed', items: await prepareImportPreview(parsed.expenses, repository), errors: parsed.errors };
}

// FR-12.6 chat import is Tier 2 (bulk action, blocking confirmation). The tier
// comes from the shared chat action map, not a second literal.
export function resolveImportAiAvailability(isConnected: boolean, hasApiKey: boolean): ImportAiAvailability {
  if (!isConnected) return { status: 'external', reason: 'offline', prompt: EXTERNAL_IMPORT_PROMPT };
  if (!hasApiKey) return { status: 'external', reason: 'missing_key', prompt: EXTERNAL_IMPORT_PROMPT };
  return { status: 'in_app', feature: 'chat', intent: 'import', tier: chatActionTier('log_expenses_bulk'), prompt: EXTERNAL_IMPORT_PROMPT };
}
