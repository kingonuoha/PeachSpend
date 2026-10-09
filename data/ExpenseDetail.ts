import type { Expense } from '../types/database';
import type { CaptureRepository, CaptureSource } from './contracts';

// S-08 detail contracts (FR-08.1-08.4). The origin tells the screen whether a
// record came from auto-capture, so the category-edit learning loop can stay
// scoped to auto-capture only (FR-08.2). Pre-v6 rows carry no stored source; the
// inference below is honest about that instead of guessing a capture path.
export type ExpenseRecordOrigin = 'auto_capture' | 'manual' | 'scanned' | 'unknown';

const SOURCE_TO_ORIGIN: Record<CaptureSource, ExpenseRecordOrigin> = {
  auto_capture: 'auto_capture',
  ocr: 'scanned',
  share: 'scanned',
  manual: 'manual',
  chat: 'manual',
  import: 'manual',
};

export function deriveExpenseOrigin(expense: Pick<Expense, 'source' | 'scanned'>): ExpenseRecordOrigin {
  const source = expense.source?.trim() as CaptureSource | undefined;
  if (source && source in SOURCE_TO_ORIGIN) return SOURCE_TO_ORIGIN[source];
  if (expense.scanned === 1) return 'scanned';
  if (expense.scanned === 0) return 'manual';
  return 'unknown';
}

export interface ExpenseDetailPosition {
  index: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

export interface ExpenseDetailRead {
  transaction: Expense;
  origin: ExpenseRecordOrigin;
  position: ExpenseDetailPosition;
}

export type ExpenseCategoryEditResult =
  | { status: 'updated'; origin: ExpenseRecordOrigin; learned: boolean }
  | { status: 'not_found' };

export type ExpenseDeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' };

export interface ExpenseDetailDataSource {
  getExpenseById(id: string): Promise<Expense | null>;
  listExpenses(): Promise<Expense[]>;
  updateExpenseCategory(id: string, category: string): Promise<void>;
  deleteExpense(id: string): Promise<void>;
}

// The learning loop reads and writes the same per-merchant memory the capture
// boundary owns. ExpenseDetailService must never write it for a manual or
// scanned record, so callers cannot diverge on that rule.
export type ExpenseMemory = Pick<CaptureRepository, 'rememberCategory'>;

export function buildExpenseDetailPosition(orderedIds: string[], id: string): ExpenseDetailPosition | null {
  const index = orderedIds.indexOf(id);
  if (index === -1) return null;
  return {
    index,
    total: orderedIds.length,
    previousId: orderedIds[index - 1] ?? null,
    nextId: orderedIds[index + 1] ?? null,
  };
}

export class ExpenseDetailService {
  constructor(
    private readonly data: ExpenseDetailDataSource,
    private readonly memory: ExpenseMemory,
  ) {}

  // `orderedIds` lets Home and a filtered/sorted Insights list each pass the id
  // order they are actually showing, so swipe paging matches the arrival context
  // (FR-08.4) instead of always paging the global date order.
  async readDetail(id: string, orderedIds?: string[]): Promise<ExpenseDetailRead | null> {
    const transaction = await this.data.getExpenseById(id);
    if (!transaction) return null;
    const ids = orderedIds ?? (await this.data.listExpenses()).map(expense => expense.id);
    const position = buildExpenseDetailPosition(ids, id) ?? { index: 0, total: 1, previousId: null, nextId: null };
    return { transaction, origin: deriveExpenseOrigin(transaction), position };
  }

  async editCategory(id: string, category: string): Promise<ExpenseCategoryEditResult> {
    const transaction = await this.data.getExpenseById(id);
    if (!transaction) return { status: 'not_found' };
    const origin = deriveExpenseOrigin(transaction);
    await this.data.updateExpenseCategory(id, category);
    const learned = origin === 'auto_capture';
    if (learned) await this.memory.rememberCategory(transaction.merchant, category, 'auto_capture');
    return { status: 'updated', origin, learned };
  }

  // Delete stays a single confirmed boundary. Confirmation is the caller's
  // contract; this method performs the one write and returns a typed outcome.
  async delete(id: string): Promise<ExpenseDeleteResult> {
    const transaction = await this.data.getExpenseById(id);
    if (!transaction) return { status: 'not_found' };
    await this.data.deleteExpense(id);
    return { status: 'deleted' };
  }
}
