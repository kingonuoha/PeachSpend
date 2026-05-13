import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenses } from '../../hooks/useExpenses';
import { Strings } from '../../constants/strings';
import { SpendingDonut } from '../../components/analytics/SpendingDonut';
import { CategoryBreakdown } from '../../components/analytics/CategoryBreakdown';
import { DateRangePicker } from '../../components/ui/DateRangePicker';
import { ExpenseItem } from '../../components/expense/ExpenseItem';
import { startOfWeek, startOfMonth, subDays, isAfter, format } from 'date-fns';
import { Colors } from '../../constants/tokens';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import Animated, { FadeInDown } from 'react-native-reanimated';

type Timeframe = 'week' | 'month' | 'all' | 'custom';

export default function AnalyticsScreen() {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customStart, setCustomStart] = useState<Date>(subDays(new Date(), 30));
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const { expenses } = useExpenses();
  const { settings, getCurrencySymbol, convertAmount } = useSettings();
  const { colors } = useTheme();
  const styles = useThemeStyles();
  const pricesVisible = settings.prices_visible !== 'false';

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    let threshold: Date;
    let before: Date | null = null;

    switch (timeframe) {
      case 'week':
        threshold = startOfWeek(now);
        return expenses.filter(exp => isAfter(new Date(exp.created_at), threshold));
      case 'month':
        threshold = startOfMonth(now);
        return expenses.filter(exp => isAfter(new Date(exp.created_at), threshold));
      case 'custom':
        return expenses.filter(exp => {
          const d = new Date(exp.created_at);
          return d >= customStart && d <= customEnd;
        });
      case 'all':
      default:
        return expenses;
    }
  }, [expenses, timeframe, customStart, customEnd]);

  const totalSpending = useMemo(() => {
    return filteredExpenses.reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
  }, [filteredExpenses, convertAmount]);

  const distribution = useMemo(() => {
    const map: Record<string, number> = {};
    filteredExpenses.forEach(exp => {
      const converted = convertAmount(exp.amount, exp.currency || 'USD');
      map[exp.category] = (map[exp.category] || 0) + converted.amount;
    });

    return Object.entries(map).map(([name, amount], index) => ({
      name,
      amount,
      percentage: totalSpending > 0 ? (amount / totalSpending) * 100 : 0,
      color: [Colors.primary, Colors.primaryContainer, Colors.surfaceContainerHigh, Colors.onSurfaceVariant][index % 4],
    })).sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses, totalSpending]);

  const timeframeSegments: { key: Timeframe; label: string }[] = [
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'all', label: 'All' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <SafeAreaView style={{ backgroundColor: styles.bg.screen, flex: 1 }} edges={['top', 'bottom']}>
      <Animated.ScrollView 
        entering={FadeInDown.duration(600).springify()}
        className="flex-1 px-6 pt-4" 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View className="mb-10">
          <View className="flex-row justify-between items-end mb-4">
            <View>
              <Text style={{ color: styles.text.onSurface }} className="text-3xl font-manrope-bold tracking-tight">
                {Strings.analytics.title}
              </Text>
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium mt-1">
                {timeframe === 'all' ? 'All-time overview' : timeframe === 'custom' ? `${format(customStart, 'MMM dd')} - ${format(customEnd, 'MMM dd')}` : Strings.analytics.subtitle}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="flex-row p-1 rounded-2xl">
            {timeframeSegments.map((seg) => (
              <TouchableOpacity 
                key={seg.key}
                onPress={() => {
                  setTimeframe(seg.key);
                  if (seg.key === 'custom') setShowDatePicker(true);
                }}
                className={`px-4 py-2 rounded-xl flex-1 ${timeframe === seg.key ? 'bg-primary' : ''}`}
              >
                <Text className={`text-center font-manrope-bold text-[10px] uppercase tracking-widest ${timeframe === seg.key ? 'text-black' : ''}`}
                  style={timeframe !== seg.key ? { color: styles.text.onSurfaceVariant } : {}}>
                  {seg.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {timeframe === 'custom' && customStart && customEnd && (
            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              style={{ backgroundColor: styles.bg.primary5, borderColor: styles.border.primary20, borderWidth: 1 }}
              className="mt-3 py-3 px-4 rounded-xl flex-row items-center justify-center"
            >
              <Text style={{ color: styles.text.primary }} className="font-manrope-bold text-xs">
                {format(customStart, 'MMM dd, yyyy')} → {format(customEnd, 'MMM dd, yyyy')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* High-Fidelity Donut */}
        <SpendingDonut total={totalSpending} distribution={distribution} pricesVisible={pricesVisible} />
        
        <View className="mt-8 mb-4">
          <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl mb-6 px-1">Flow Breakdown</Text>
          <CategoryBreakdown distribution={distribution} pricesVisible={pricesVisible} />
        </View>

        {/* Transactions List */}
        {filteredExpenses.length > 0 && (
          <View className="mt-2 mb-8">
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl mb-6 px-1">Transactions</Text>
            {[...filteredExpenses].sort((a, b) => b.created_at - a.created_at).map((expense) => (
              <ExpenseItem key={expense.id} expense={expense} />
            ))}
          </View>
        )}
      </Animated.ScrollView>

      <DateRangePicker
        visible={showDatePicker}
        startDate={customStart}
        endDate={customEnd}
        onApply={(start, end) => {
          setCustomStart(start);
          setCustomEnd(end);
          setShowDatePicker(false);
        }}
        onClose={() => setShowDatePicker(false)}
      />
    </SafeAreaView>
  );
}
