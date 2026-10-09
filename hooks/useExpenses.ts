import { useState, useEffect, useCallback } from 'react';
import { databaseService } from '../services/DatabaseService';
import { Expense } from '../types/database';
import { logger } from '../utils/logger';

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchExpenses = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await databaseService.getExpenses();
      setExpenses(data);
    } catch {
      logger.error('useExpenses fetch error', 'expenses_fetch_failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addExpense = async (expense: Expense) => {
    try {
      await databaseService.saveExpense(expense);
      await fetchExpenses();
    } catch (error) {
      logger.error('useExpenses add error', 'expense_add_failed');
      throw error;
    }
  };

  useEffect(() => {
    // Defer to a microtask so the effect body does not call setState synchronously.
    // fetchExpenses sets isLoading synchronously, and on mount it is already true.
    void Promise.resolve().then(fetchExpenses);
  }, [fetchExpenses]);

  return {
    expenses,
    isLoading,
    refreshExpenses: fetchExpenses,
    addExpense,
  };
}
