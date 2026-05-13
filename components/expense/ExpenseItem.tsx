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
import { Colors } from '../../constants/tokens';

interface ExpenseItemProps {
  expense: Expense;
  searchQuery?: string;
}

function HighlightedText({ text, query, style, numberOfLines }: { text: string; query?: string; style?: any; numberOfLines?: number }) {
  const content = (() => {
    if (!query || !text.toLowerCase().includes(query.toLowerCase())) {
      return null;
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const startIndex = lowerText.indexOf(lowerQuery);
    
    if (startIndex === -1) return null;

    const before = text.slice(0, startIndex);
    const match = text.slice(startIndex, startIndex + query.length);
    const after = text.slice(startIndex + query.length);

    return (
      <>
        {before}
        <Text style={{ backgroundColor: Colors.primary + '40', color: 'white' }}>{match}</Text>
        {after}
      </>
    );
  })();

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {content || text}
    </Text>
  );
}

export const ExpenseItem = React.memo(({ expense, searchQuery }: ExpenseItemProps) => {
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
          <View className="flex-row items-center gap-2">
            <HighlightedText 
              text={expense.note || expense.merchant} 
              query={searchQuery}
              style={{ color: styles.text.onSurface, fontFamily: 'Manrope_700Bold', fontSize: 16, letterSpacing: -0.3, flexShrink: 1 }}
              numberOfLines={1}
            />
            {expense.is_reimbursable === 1 && (
              <View style={{ backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '40', borderWidth: 1 }} className="px-2 py-0.5 rounded-full">
                <Text style={{ color: Colors.primary }} className="font-manrope-bold text-[9px] uppercase tracking-wider">Reimb.</Text>
              </View>
            )}
          </View>
          <HighlightedText 
            text={expense.note ? expense.merchant : expense.category} 
            query={searchQuery}
            style={{ color: styles.text.onSurfaceVariant60, fontFamily: 'Manrope_500Medium', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}
          />
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
