import type { Expense } from '../../types/database';
import type { CaptureCandidate, CaptureRepository, DuplicateMatch } from '../../data/contracts';
import {
  buildImportCandidate, commitImportItems, prepareImportPreview as prepareImportPreviewItems,
} from '../../data/ImportDataService';

// Compatibility adapter for the pre-rebuild S-12 screen. It keeps the old
// decision-shaped API while every rule (validation, duplicate probing, commit,
// success count) comes from the single `ImportDataService` implementation. The
// E10 rebuild consumes the data service directly.

export type ImportDecision = 'pending' | 'save' | 'discard';

export interface ImportPreviewItem {
  expense: Partial<Expense>;
  candidate: CaptureCandidate;
  duplicate: DuplicateMatch | null;
  decision: ImportDecision;
}

export async function prepareImportPreview(
  expenses: Partial<Expense>[],
  repository: CaptureRepository,
  _currency?: string,
): Promise<ImportPreviewItem[]> {
  // Preserve the legacy contract that an incomplete row rejects the whole parse
  // rather than appearing as a silently skippable item.
  expenses.forEach(expense => buildImportCandidate(expense));
  const items = await prepareImportPreviewItems(expenses, repository);
  return items.map(item => ({
    expense: item.expense,
    candidate: item.candidate as CaptureCandidate,
    duplicate: item.duplicate,
    decision: item.duplicate ? 'pending' : 'save',
  }));
}

export async function saveImportPreview(
  items: ImportPreviewItem[],
  repository: CaptureRepository,
): Promise<{ imported: number; errors: string[] }> {
  const result = await commitImportItems(
    items.map((item, index) => ({
      id: `import_${index}`,
      expense: item.expense,
      candidate: item.candidate,
      duplicate: item.duplicate,
      included: item.decision !== 'discard',
      error: null,
    })),
    repository,
  );
  return { imported: result.imported, errors: result.errors };
}
