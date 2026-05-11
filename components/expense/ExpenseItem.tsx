import React from 'react';
import { View, Text } from 'react-native';
import { Expense } from '../../types/database';
import { LuminousCard } from '../ui/LuminousCard';
import { format } from 'date-fns';
import { useSettings } from '../ui/SettingsProvider';
import { useTheme } from '../ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

interface ExpenseItemProps {
  expense: Expense;
}

export const ExpenseItem = React.memo(({ expense }: ExpenseItemProps) => {
  const router = useRouter();
  const { settings, getCurrencySymbol, convertAmount } = useSettings();
  const { colors } = useTheme();
  const styles = useThemeStyles();
  const pricesVisible = settings.prices_visible !== 'false';
  const dateStr = format(new Date(expense.created_at), 'MMM dd, HH:mm');
  
  const displayValue = convertAmount(expense.amount, expense.currency || 'USD');

  return (
    <TouchableOpacity 
      activeOpacity={0.7} 
      onPress={() => router.push(`/expense/${expense.id}` as any)}
    >
      <LuminousCard className="flex-row justify-between items-center mb-4 py-4 px-5" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
        <View className="flex-1 mr-4">
          <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-base tracking-tight" numberOfLines={1}>
            {expense.note || expense.merchant}
          </Text>
          <Text className="text-onSurfaceVariant font-manrope-medium text-xs uppercase tracking-widest mt-0.5">
            {expense.note ? expense.merchant : expense.category}
          </Text>
        </View>
        
        <View className="items-end">
          <View className="flex-row items-baseline">
            <Text className="text-primary font-noto-serif-bold text-xs mr-0.5">{pricesVisible ? displayValue.symbol : ''}</Text>
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-xl tracking-tighter">
              {pricesVisible ? displayValue.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '••••'}
            </Text>
          </View>
          <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-[10px] mt-0.5">
            {dateStr}
          </Text>
        </View>
      </LuminousCard>
    </TouchableOpacity>
  );
});
