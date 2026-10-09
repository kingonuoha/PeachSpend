import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const [detail, all, categories] = await Promise.all([
        detailService.readDetail(initialId, orderedIds),
        databaseService.getExpenses(),
        databaseService.getCategories(),
      ]);
      if (id !== requestId.current) return;
      if (!detail) {
        setMissing(true);
        setRecords([]);
        setLoading(false);
        return;
      }

      let ordered: Expense[] = all;
      if (orderedIds && orderedIds.length > 0) {
        const byId = new Map(all.map(expense => [expense.id, expense]));
        ordered = orderedIds
          .map(recordId => byId.get(recordId))
          .filter((expense): expense is Expense => Boolean(expense));
      }

      const index = ordered.findIndex(expense => expense.id === initialId);
      const meta: Record<string, ExpenseCategoryMeta> = {};
      for (const category of categories) {
        meta[category.id] = { title: category.title, iconName: category.icon_name };
      }

      setRecords(ordered);
      setCategoryOptions(categories.map(category => ({ id: category.id, title: category.title, icon_name: category.icon_name })));
      setCategoryMeta(meta);
      setInitialOrigin(detail.origin);
      setInitialIndex(index >= 0 ? index : 0);
      setMissing(false);
      setLoading(false);
    } catch {
      if (id !== requestId.current) return;
      setFailed(true);
      setLoading(false);
    }
  }, [initialId, orderedIds]);

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

  return {
    records,
    categoryOptions,
    categoryMeta,
    initialOrigin,
    initialIndex,
    loading,
    missing,
    failed,
    retry: () => void load(),
    editCategory,
    remove,
    saveNote,
    setReimbursable,
    originOf,
  };
}
