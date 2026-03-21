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
    } catch (error) {
      logger.error('useExpenses fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addExpense = async (expense: Expense) => {
    try {
      await databaseService.saveExpense(expense);
      await fetchExpenses();
    } catch (error) {
      logger.error('useExpenses add error:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  return {
    expenses,
    isLoading,
    refreshExpenses: fetchExpenses,
    addExpense,
  };
}
