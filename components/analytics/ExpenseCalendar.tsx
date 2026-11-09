import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import {
  startOfMonth,
  endOfMonth,
  getDay,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
} from 'date-fns';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { SlideInRight, SlideOutLeft, SlideInLeft, SlideOutRight } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Expense } from '../../types/database';
import { ExpenseItem } from '../expense/ExpenseItem';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCompactCurrency, formatCurrency, formatMoneyNumber, getCurrencyPrefix } from '../../utils/currency';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

interface DayData {
  total: number;
  count: number;
  expenses: Expense[];
}

interface ExpenseCalendarProps {
  expenses: Expense[];
  currency: string;
  pricesVisible: boolean;
  convertAmount: (amount: number, currency: string) => { amount: number };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL_WIDTH = '14.28%';

// Heat shading is anchored to a robust benchmark rather than the single largest day,
// so one rent payment cannot wash out every ordinary day. The benchmark is the larger
// of the median spending day times 1.5 and the average spending day, both computed
// from days that actually had spend.
const MEDIAN_BENCHMARK_WEIGHT = 1.5;
// Any spending day keeps a visible tint, and the strongest day is fully saturated.
const MIN_HEAT = 0.18;
const MIN_HEAT_ALPHA = 0x3a;
const MAX_HEAT_ALPHA = 0xb3;

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export const ExpenseCalendar: React.FC<ExpenseCalendarProps> = ({
  expenses,
  currency,
  pricesVisible,
  convertAmount,
}) => {
  const styles = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [monthDirection, setMonthDirection] = useState<'left' | 'right'>('right');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayModalVisible, setDayModalVisible] = useState(false);

  const dailyExpenses = useMemo(() => {
    const map: Record<string, DayData> = {};
    expenses.forEach(exp => {
      const date = new Date(exp.date);
      if (!isSameMonth(date, currentMonth)) return;
      const key = format(date, 'yyyy-MM-dd');
      const converted = convertAmount(exp.amount, exp.currency || currency);
      if (!map[key]) map[key] = { total: 0, count: 0, expenses: [] };
      map[key].total += converted.amount;
      map[key].count += 1;
      map[key].expenses.push(exp);
    });
    return map;
  }, [expenses, currentMonth, convertAmount, currency]);

  // Median-anchored benchmark. Days without spend are excluded so a quiet month
  // cannot drag the anchor to zero and make every real day look maximal.
  const heatBenchmark = useMemo(() => {
    const totals = Object.values(dailyExpenses)
      .map(day => day.total)
      .filter(total => total > 0);
    if (totals.length === 0) return 1;
    const average = totals.reduce((sum, total) => sum + total, 0) / totals.length;
    const median = medianOf(totals);
    return Math.max(median * MEDIAN_BENCHMARK_WEIGHT, average, 1);
  }, [dailyExpenses]);

  const monthHasSpend = Object.keys(dailyExpenses).length > 0;

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startPadding = getDay(monthStart);
    return { days, startPadding };
  }, [currentMonth]);

  const selectedDayData = useMemo(() => {
    if (!selectedDay) return null;
    const key = format(selectedDay, 'yyyy-MM-dd');
    return dailyExpenses[key] || null;
  }, [selectedDay, dailyExpenses]);

  const goToNextMonth = useCallback(() => {
    setMonthDirection('right');
    setCurrentMonth(prev => addMonths(prev, 1));
  }, []);

  const goToPrevMonth = useCallback(() => {
    setMonthDirection('left');
    setCurrentMonth(prev => subMonths(prev, 1));
  }, []);

  // Memoized so the recognizer is not rebuilt on every render. onEnd runs as a
  // worklet, so the RN-runtime month change is scheduled back with scheduleOnRN
  // (not the deprecated runOnJS).
  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      if (e.velocityX > 400) {
        scheduleOnRN(goToPrevMonth);
      } else if (e.velocityX < -400) {
        scheduleOnRN(goToNextMonth);
      }
    }), [goToPrevMonth, goToNextMonth]);

  // Every day responds. A day with no spend opens the same sheet with a truthful
  // zero state instead of returning silently.
  const handleDayPress = (day: Date) => {
    setSelectedDay(day);
    setDayModalVisible(true);
  };

  const today = new Date();
  const paddingSlots = Array.from({ length: calendarDays.startPadding }, (_, i) => i);
  const monthEntering = reduceMotion
    ? undefined
    : monthDirection === 'left'
      ? SlideInLeft.duration(250)
      : SlideInRight.duration(250);
  const monthExiting = reduceMotion
    ? undefined
    : monthDirection === 'left'
      ? SlideOutRight.duration(250)
      : SlideOutLeft.duration(250);

  return (
    <View>
      {/* Month Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s3, paddingHorizontal: Spacing.s1 }}>
        <TouchableOpacity
          onPress={goToPrevMonth}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <ChevronLeft size={20} color={styles.text.onSurface} />
        </TouchableOpacity>
        <Text
          accessibilityRole="header"
          style={[Typography.headlineMd, { color: styles.text.onSurface }]}
        >
          {format(currentMonth, 'MMMM yyyy')}
        </Text>
        <TouchableOpacity
          onPress={goToNextMonth}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <ChevronRight size={20} color={styles.text.onSurface} />
        </TouchableOpacity>
      </View>

      {/* Weekday Headers */}
      <View style={{ flexDirection: 'row', marginBottom: Spacing.s2 }}>
        {WEEKDAYS.map(day => (
          <View key={day} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant60, textTransform: 'uppercase' }]}>
              {day}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid with swipe gesture */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          key={format(currentMonth, 'yyyy-MM')}
          entering={monthEntering}
          exiting={monthExiting}
          style={{ flexDirection: 'row', flexWrap: 'wrap' }}
        >
          {paddingSlots.map(i => (
            <View key={`pad-${i}`} style={{ width: CELL_WIDTH, aspectRatio: 1 }} />
          ))}

          {calendarDays.days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const data = dailyExpenses[key];
            const isToday = isSameDay(day, today);
            const intensity = data ? Math.min(1, Math.max(MIN_HEAT, data.total / heatBenchmark)) : 0;
            const alpha = Math.round(MIN_HEAT_ALPHA + intensity * (MAX_HEAT_ALPHA - MIN_HEAT_ALPHA));
            const heatColor = `${styles.raw.primary}${alpha.toString(16).padStart(2, '0')}`;
            const dayLabel = format(day, 'MMMM d');
            const accessibilityLabel = data
              ? `${dayLabel}, ${pricesVisible ? formatCurrency(data.total, currency) : 'amount hidden'}, ${data.count} ${data.count === 1 ? 'transaction' : 'transactions'}`
              : `${dayLabel}, zero expenses`;

            return (
              <TouchableOpacity
                key={key}
                onPress={() => handleDayPress(day)}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={data ? 'Opens the transactions for this day' : 'Opens the day summary'}
                hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
                style={{ width: CELL_WIDTH, aspectRatio: 1, padding: 2 }}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: Radii.sm,
                    backgroundColor: data ? heatColor : 'transparent',
                    borderWidth: isToday ? 1.5 : 0,
                    borderColor: isToday ? styles.raw.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <Text
                    style={[Typography.micro, { color: data ? styles.text.onSurface : styles.text.onSurfaceVariant60 }]}
                  >
                    {format(day, 'd')}
                  </Text>
                  {data && pricesVisible && (
                    <Text style={[Typography.micro, { color: styles.text.onSurface, fontFamily: 'Manrope_700Bold' }]} numberOfLines={1}>
                      {formatCompactCurrency(data.total, currency)}
                    </Text>
                  )}
                  {data && !pricesVisible && (
                    <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: styles.raw.primary }} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </GestureDetector>

      {!monthHasSpend ? (
        <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.s3 }]}>
          No spending recorded this month.
        </Text>
      ) : null}

      {/* Day Detail Modal */}
      <Modal visible={dayModalVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setDayModalVisible(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setDayModalVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Close day details"
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{ backgroundColor: styles.bg.surfaceContainerHighest, borderTopLeftRadius: Radii.xxl, borderTopRightRadius: Radii.xxl, paddingTop: Spacing.s6, paddingBottom: Spacing.s8, paddingHorizontal: Spacing.s6, maxHeight: '70%' }}
          >
            <View style={{ alignItems: 'center', marginBottom: Spacing.s2 }}>
              <View style={{ backgroundColor: styles.border.subtle, width: 40, height: 4, borderRadius: 2, marginBottom: Spacing.s4 }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s5 }}>
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Text style={[Typography.headlineSm, { color: styles.text.onSurface }]}>
                  {selectedDay ? format(selectedDay, 'EEEE') : ''}
                </Text>
                <Text style={[Typography.labelMd, { color: styles.text.onSurfaceVariant60, marginTop: Spacing.s1 }]}>
                  {selectedDay ? format(selectedDay, 'MMMM d, yyyy') : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setDayModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close day details"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} color={styles.icon.muted} />
              </TouchableOpacity>
            </View>

            {selectedDayData ? (
              <View style={{ marginBottom: Spacing.s4, flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={[Typography.labelMd, { color: styles.text.primary }]}>{getCurrencyPrefix(currency)}</Text>
                <Text style={[Typography.displayMd, { color: styles.text.onSurface }]}>
                  {pricesVisible ? formatMoneyNumber(selectedDayData.total) : '••••'}
                </Text>
                <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant60, marginLeft: Spacing.s2 }]}>
                  {selectedDayData.count} {selectedDayData.count === 1 ? 'transaction' : 'transactions'}
                </Text>
              </View>
            ) : (
              <View style={{ marginBottom: Spacing.s4, gap: Spacing.s1 }}>
                <Text style={[Typography.labelBold, { color: styles.text.onSurface }]}>
                  No expenses recorded on this day
                </Text>
                <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant, maxWidth: 300 }]}>
                  Nothing was spent, so there is nothing to list. Zero spend is a real result, not missing data.
                </Text>
              </View>
            )}

            <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.s5 }}>
              {selectedDayData?.expenses.map(expense => (
                <ExpenseItem key={expense.id} expense={expense} />
              ))}
            </Animated.ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
