import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { databaseService } from '../services/DatabaseService';
import {
  ExpenseDetailService,
  deriveExpenseOrigin,
  type ExpenseCategoryEditResult,
  type ExpenseDeleteResult,
  type ExpenseDetailDataSource,
  type ExpenseMemory,
  type ExpenseRecordOrigin,
} from '../data/ExpenseDetail';
import type { Expense } from '../types/database';

export interface ExpenseCategoryOption {
  id: string;
  title: string;
  icon_name?: string;
}

export interface ExpenseCategoryMeta {
  title: string;
  iconName?: string;
}

// S-08 Data and AI boundary. The memory adapter forwards to the capture
// repository, so the auto-capture-only learning rule stays in ExpenseDetailService
// and the screen never writes the per-merchant table itself (FR-08.2).
const dataSource: ExpenseDetailDataSource = {
  getExpenseById: id => databaseService.getExpenseById(id),
  listExpenses: () => databaseService.getExpenses(),
  updateExpenseCategory: (id, category) => databaseService.updateExpenseCategory(id, category),
  deleteExpense: id => databaseService.deleteExpense(id),
};

const memory: ExpenseMemory = {
  rememberCategory: async (merchant, category, source) => {
    const repository = await databaseService.getCaptureRepository();
    await repository.rememberCategory(merchant, category, source);
  },
};

const detailService = new ExpenseDetailService(dataSource, memory);

type ExpenseDetailRead =
  | { status: 'failed' }
  | { status: 'missing' }
  | {
      status: 'loaded';
      records: Expense[];
      categories: Awaited<ReturnType<typeof databaseService.getCategories>>;
      origin: ExpenseRecordOrigin;
      index: number;
    };

// One read for the screen. It is an async helper of its own for two reasons: an
// async function can never throw synchronously, so a failing source always lands
// here as a typed result after an await, and the hook's state updates therefore
// sit unambiguously past the await boundary instead of in a catch that a
// synchronously throwing source could reach inside the mount effect.
async function readExpenseDetail(initialId: string, orderedIds?: string[]): Promise<ExpenseDetailRead> {
  try {
    const [detail, all, categories] = await Promise.all([
      detailService.readDetail(initialId, orderedIds),
      databaseService.getExpenses(),
      databaseService.getCategories(),
    ]);
    if (!detail) return { status: 'missing' };

    let ordered: Expense[] = all;
    if (orderedIds && orderedIds.length > 0) {
      const byId = new Map(all.map(expense => [expense.id, expense]));
      ordered = orderedIds
        .map(recordId => byId.get(recordId))
        .filter((expense): expense is Expense => Boolean(expense));
    }

    const index = ordered.findIndex(expense => expense.id === initialId);
    return {
      status: 'loaded',
      records: ordered,
      categories,
      origin: detail.origin,
      index: index >= 0 ? index : 0,
    };
  } catch {
    return { status: 'failed' };
  }
}

export interface ExpenseDetailState {
  records: Expense[];
  categoryOptions: ExpenseCategoryOption[];
  categoryMeta: Record<string, ExpenseCategoryMeta>;
  initialOrigin: ExpenseRecordOrigin;
  initialIndex: number;
  loading: boolean;
  missing: boolean;
  failed: boolean;
  retry: () => void;
  editCategory: (id: string, category: string) => Promise<ExpenseCategoryEditResult>;
  remove: (id: string) => Promise<ExpenseDeleteResult>;
  saveNote: (id: string, note: string) => Promise<void>;
  setReimbursable: (id: string, value: boolean) => Promise<void>;
  originOf: (expense: Expense) => ExpenseRecordOrigin;
}

// `orderedIds` is the arrival list order (Home recent, or the active Insights
// filtered/sorted list) so swipe paging matches the list the user came from
// (FR-08.4). Without it, the global date order is the honest fallback.
export function useExpenseDetail(initialId: string, orderedIds?: string[]): ExpenseDetailState {
  const [records, setRecords] = useState<Expense[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<ExpenseCategoryOption[]>([]);
  const [categoryMeta, setCategoryMeta] = useState<Record<string, ExpenseCategoryMeta>>({});
  const [initialOrigin, setInitialOrigin] = useState<ExpenseRecordOrigin>('unknown');
  const [initialIndex, setInitialIndex] = useState(0);
  // The id plus arrival order the last landed read belongs to. `loading` is derived
  // from it so this hook's fetch effect never sets state synchronously; a read the
  // screen is still waiting on simply has no key yet.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const readKey = useMemo(
    () => `${initialId}|${orderedIds && orderedIds.length > 0 ? orderedIds.join(',') : ''}`,
    [initialId, orderedIds],
  );

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const result = await readExpenseDetail(initialId, orderedIds);
    if (id !== requestId.current) return;

    // One unconditional commit of everything the read owns. Deriving the values
    // first instead of setting them from inside a branch is what keeps the effect
    // from cascading a render, and it means a failed or missing read cannot leave
    // a stale field behind.
    const loaded = result.status === 'loaded' ? result : null;
    const categories = loaded?.categories ?? [];
    const meta: Record<string, ExpenseCategoryMeta> = {};
    for (const category of categories) {
      meta[category.id] = { title: category.title, iconName: category.icon_name };
    }

    setRecords(loaded?.records ?? []);
    setCategoryOptions(categories.map(category => ({ id: category.id, title: category.title, icon_name: category.icon_name })));
    setCategoryMeta(meta);
    setInitialOrigin(loaded?.origin ?? 'unknown');
    setInitialIndex(loaded?.index ?? 0);
    setMissing(result.status === 'missing');
    setFailed(result.status === 'failed');
    setLoadedKey(readKey);
  }, [initialId, orderedIds, readKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const editCategory = useCallback(async (id: string, category: string) => {
    const result = await detailService.editCategory(id, category);
    if (result.status === 'updated') {
      setRecords(prev => prev.map(expense => (expense.id === id ? { ...expense, category } : expense)));
    }
    return result;
  }, []);

  const remove = useCallback(async (id: string) => {
    const result = await detailService.delete(id);
    if (result.status === 'deleted') {
      setRecords(prev => prev.filter(expense => expense.id !== id));
    }
    return result;
  }, []);

  // Note and reimbursable are the other two edit surfaces the canonical pair
  // exposes. They stay on the existing per-column data-layer writers; no SQL here.
  const saveNote = useCallback(async (id: string, note: string) => {
    await databaseService.updateExpenseNote(id, note);
    setRecords(prev => prev.map(expense => (expense.id === id ? { ...expense, note } : expense)));
  }, []);

  const setReimbursable = useCallback(async (id: string, value: boolean) => {
    await databaseService.updateExpenseReimbursable(id, value);
    setRecords(prev => prev.map(expense => (expense.id === id ? { ...expense, is_reimbursable: value ? 1 : 0 } : expense)));
  }, []);

  const originOf = useCallback((expense: Expense) => deriveExpenseOrigin(expense), []);

  // The retry drops the landed key, which makes `loading` true again for the
  // re-read, exactly as the previous setLoading(true) did before the fetch.
  const retry = useCallback(() => {
    setLoadedKey(null);
    void load();
  }, [load]);

  return {
    records,
    categoryOptions,
    categoryMeta,
    initialOrigin,
    initialIndex,
    loading: loadedKey !== readKey,
    missing,
    failed,
    retry,
    editCategory,
    remove,
    saveNote,
    setReimbursable,
    originOf,
  };
}
