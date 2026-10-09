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
import Animated, { SlideInRight, SlideOutLeft, SlideInLeft, SlideOutRight, runOnJS } from 'react-native-reanimated';
import { Expense } from '../../types/database';
import { ExpenseItem } from '../expense/ExpenseItem';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors } from '../../constants/tokens';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

interface DayData {
  total: number;
  count: number;
  expenses: Expense[];
}

interface ExpenseCalendarProps {
  expenses: Expense[];
  currencySymbol: string;
  currency: string;
  pricesVisible: boolean;
  convertAmount: (amount: number, currency: string) => { amount: number };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL_WIDTH = '14.28%';

export const ExpenseCalendar: React.FC<ExpenseCalendarProps> = ({
  expenses,
  currencySymbol,
  currency,
  pricesVisible,
  convertAmount,
}) => {
  const styles = useThemeStyles();
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

  const maxDaily = useMemo(() => {
    const totals = Object.values(dailyExpenses).map(d => d.total);
    return Math.max(1, ...totals);
  }, [dailyExpenses]);

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

  const panGesture = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      if (e.velocityX > 400) {
        runOnJS(goToPrevMonth)();
      } else if (e.velocityX < -400) {
        runOnJS(goToNextMonth)();
      }
    });

  const handleDayPress = (day: Date) => {
    const key = format(day, 'yyyy-MM-dd');
    if (!dailyExpenses[key]) return;
    setSelectedDay(day);
    setDayModalVisible(true);
  };

  const today = new Date();
  const paddingSlots = Array.from({ length: calendarDays.startPadding }, (_, i) => i);

  return (
    <View>
      {/* Month Header */}
      <View className="flex-row items-center justify-between mb-4 px-1">
        <TouchableOpacity onPress={goToPrevMonth} className="p-2">
          <ChevronLeft size={20} color={styles.text.onSurface} />
        </TouchableOpacity>
        <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-xl">
          {format(currentMonth, 'MMMM yyyy')}
        </Text>
        <TouchableOpacity onPress={goToNextMonth} className="p-2">
          <ChevronRight size={20} color={styles.text.onSurface} />
        </TouchableOpacity>
      </View>

      {/* Weekday Headers */}
      <View className="flex-row mb-2">
        {WEEKDAYS.map(day => (
          <View key={day} className="flex-1 items-center">
            <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest">
              {day}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid with swipe gesture */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          key={format(currentMonth, 'yyyy-MM')}
          entering={monthDirection === 'left' ? SlideInLeft.duration(250) : SlideInRight.duration(250)}
          exiting={monthDirection === 'left' ? SlideOutRight.duration(250) : SlideOutLeft.duration(250)}
          className="flex-row flex-wrap"
        >
          {paddingSlots.map(i => (
            <View key={`pad-${i}`} style={{ width: CELL_WIDTH, aspectRatio: 1 }} />
          ))}

          {calendarDays.days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const data = dailyExpenses[key];
            const isToday = isSameDay(day, today);
            const intensity = data ? Math.max(0.1, data.total / maxDaily) : 0;
            const hexIntensity = Math.round(intensity * 40 + 10).toString(16).padStart(2, '0');

            return (
              <TouchableOpacity
                key={key}
                onPress={() => handleDayPress(day)}
                activeOpacity={data ? 0.7 : 1}
                style={{ width: CELL_WIDTH, aspectRatio: 1, padding: 2 }}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    backgroundColor: data ? Colors.primary + hexIntensity : 'transparent',
                    borderWidth: isToday ? 1.5 : 0,
                    borderColor: isToday ? Colors.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <Text
                    style={{ color: data ? styles.text.onSurface : styles.text.onSurfaceVariant60 }}
                    className="font-manrope-semibold text-xs"
                  >
                    {format(day, 'd')}
                  </Text>
                  {data && pricesVisible && (
                    <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-[8px] mt-0.5" numberOfLines={1}>
                      {currencySymbol}{Math.round(data.total)}
                    </Text>
                  )}
                  {data && !pricesVisible && (
                    <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: Colors.primary }} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </GestureDetector>

      {/* Day Detail Modal */}
      <Modal visible={dayModalVisible} transparent animationType="fade" onRequestClose={() => setDayModalVisible(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setDayModalVisible(false)}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{ backgroundColor: styles.bg.surfaceContainerHighest, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 24, paddingBottom: 40, paddingHorizontal: 24, maxHeight: '70%' }}
          >
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <View style={{ backgroundColor: styles.border.subtle, width: 40, height: 4, borderRadius: 2, marginBottom: 16 }} />
            </View>
            <View className="flex-row items-center justify-between mb-6">
              <View>
                <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl">
                  {selectedDay ? format(selectedDay, 'EEEE') : ''}
                </Text>
                <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm mt-1">
                  {selectedDay ? format(selectedDay, 'MMMM d, yyyy') : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDayModalVisible(false)} className="p-2">
                <X size={20} color={styles.icon.muted} />
              </TouchableOpacity>
            </View>

            {selectedDayData && (
              <View className="mb-4 flex-row items-baseline">
                <Text className="text-primary font-noto-serif-bold text-xs">{currencySymbol}</Text>
                <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-3xl tracking-tighter">
                  {selectedDayData.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-xs ml-2">
                  {selectedDayData.count} {selectedDayData.count === 1 ? 'transaction' : 'transactions'}
                </Text>
              </View>
            )}

            <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
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
