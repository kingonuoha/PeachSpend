import React from 'react';
import { View, Text } from 'react-native';
import { Expense } from '../../types/database';
import { LuminousCard } from '../ui/LuminousCard';

interface ExpenseItemProps {
  expense: Expense;
}

export const ExpenseItem: React.FC<ExpenseItemProps> = ({ expense }) => {
  return (
    <LuminousCard className="flex-row justify-between items-center mb-3">
      <View className="flex-1">
        <Text className="text-lg text-onSurface font-manrope-semibold" numberOfLines={1}>
          {expense.merchant}
        </Text>
        <Text className="text-sm text-onSurfaceVariant font-manrope-regular">
          {expense.category}
        </Text>
      </View>
      
      <View className="items-end">
        <Text className="text-xl text-primary font-noto-serif-bold">
          ${expense.amount.toFixed(2)}
        </Text>
        <Text className="text-xs text-onSurfaceVariant font-manrope-regular">
          {new Date(expense.date * 1000).toLocaleDateString()}
        </Text>
      </View>
    </LuminousCard>
  );
};
