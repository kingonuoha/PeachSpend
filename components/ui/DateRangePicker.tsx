import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Dimensions } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isBefore, isAfter } from 'date-fns';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors } from '../../constants/tokens';

interface DateRangePickerProps {
  visible: boolean;
  startDate: Date | null;
  endDate: Date | null;
  onApply: (start: Date, end: Date) => void;
  onClose: () => void;
}

const { width } = Dimensions.get('window');
const CALENDAR_WIDTH = Math.min(width - 64, 400);

export function DateRangePicker({ visible, startDate: initialStart, endDate: initialEnd, onApply, onClose }: DateRangePickerProps) {
  const ts = useThemeStyles();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const [startDate, setStartDate] = useState<Date | null>(initialStart || new Date());
  const [endDate, setEndDate] = useState<Date | null>(initialEnd || new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const isInRange = (day: Date) => {
    if (!startDate || !endDate) return false;
    return isAfter(day, startDate) && isBefore(day, endDate);
  };

  const handleDayPress = (day: Date) => {
    if (selecting === 'start') {
      setStartDate(day);
      if (endDate && isAfter(day, endDate)) setEndDate(null);
      setSelecting('end');
    } else {
      if (day && startDate && (isBefore(day, startDate) || isSameDay(day, startDate))) {
        setStartDate(day);
        setEndDate(null);
        setSelecting('end');
      } else {
        setEndDate(day);
      }
    }
  };

  const handleApply = () => {
    if (startDate && endDate) {
      onApply(startDate, endDate);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ backgroundColor: ts.bg.overlay, flex: 1 }} className="justify-end">
        <View style={{ backgroundColor: ts.bg.surfaceContainerHighest, borderTopLeftRadius: 40, borderTopRightRadius: 40 }} className="p-6">
          <View style={{ backgroundColor: ts.bg.white10 }} className="w-12 h-1.5 rounded-full self-center mb-6" />
          
          <View className="flex-row justify-between items-center mb-6">
            <TouchableOpacity onPress={() => setSelecting('start')} className="flex-1">
              <Text style={{ color: selecting === 'start' ? ts.text.primary : ts.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-1">Start</Text>
              <Text style={{ color: selecting === 'start' ? ts.text.onSurface : ts.text.onSurfaceVariant }} className="font-manrope-bold text-base">
                {startDate ? format(startDate, 'MMM dd, yyyy') : 'Select'}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: ts.text.onSurfaceVariant40 }} className="mx-4 text-lg">→</Text>
            <TouchableOpacity onPress={() => setSelecting('end')} className="flex-1 items-end">
              <Text style={{ color: selecting === 'end' ? ts.text.primary : ts.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-1">End</Text>
              <Text style={{ color: selecting === 'end' ? ts.text.onSurface : ts.text.onSurfaceVariant }} className="font-manrope-bold text-base">
                {endDate ? format(endDate, 'MMM dd, yyyy') : 'Select'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ maxWidth: CALENDAR_WIDTH, alignSelf: 'center' }}>
            <View className="flex-row justify-between items-center mb-4 px-2">
              <TouchableOpacity onPress={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2">
                <ChevronLeft size={20} color={ts.text.onSurfaceVariant} />
              </TouchableOpacity>
              <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">{format(currentMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity onPress={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2">
                <ChevronRight size={20} color={ts.text.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <View className="flex-row mb-2">
              {WEEKDAYS.map((day) => (
                <View key={day} style={{ width: CALENDAR_WIDTH / 7 }} className="items-center py-1">
                  <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase">{day}</Text>
                </View>
              ))}
            </View>

            <View className="flex-row flex-wrap">
              {days.map((day, idx) => {
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isStart = startDate && isSameDay(day, startDate);
                const isEnd = endDate && isSameDay(day, endDate);
                const inRange = isInRange(day);
                const isRangeEdge = isStart || isEnd;

                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleDayPress(day)}
                    style={{
                      width: CALENDAR_WIDTH / 7,
                      backgroundColor: isRangeEdge ? Colors.primary : inRange ? ts.bg.primary10 : 'transparent',
                      borderTopLeftRadius: isStart ? 999 : 0,
                      borderBottomLeftRadius: isStart ? 999 : 0,
                      borderTopRightRadius: isEnd ? 999 : 0,
                      borderBottomRightRadius: isEnd ? 999 : 0,
                    }}
                    className="items-center py-2"
                    disabled={!isCurrentMonth}
                  >
                    <Text style={{
                      color: isRangeEdge ? '#000' : isCurrentMonth ? ts.text.onSurface : ts.text.onSurfaceVariant30,
                      fontFamily: isRangeEdge ? 'Manrope_700Bold' : 'Manrope_500Medium',
                    }} className="text-sm">
                      {format(day, 'd')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View className="flex-row gap-4 mt-6">
            <TouchableOpacity onPress={onClose} style={{ borderColor: ts.border.card, borderWidth: 1 }} className="flex-1 h-12 rounded-2xl items-center justify-center">
              <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleApply} style={{ backgroundColor: ts.bg.primary, opacity: startDate && endDate ? 1 : 0.4 }} className="flex-1 h-12 rounded-2xl items-center justify-center" disabled={!startDate || !endDate}>
              <Text style={{ color: ts.text.black }} className="font-manrope-bold">Apply Range</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
