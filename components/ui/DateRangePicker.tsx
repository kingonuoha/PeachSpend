import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isBefore, isAfter } from 'date-fns';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Colors } from '../../constants/tokens';

interface DateRangePickerProps {
  visible: boolean;
  startDate: Date | null;
  endDate: Date | null;
  onApply: (start: Date, end: Date) => void;
  onClose: () => void;
}

// Fluid calendar width: it fills the sheet at phone widths and stops growing past a
// readable column on a tablet, so it cannot overflow the sheet inset at 320 and
// cannot stretch on a 430 or tablet window. Read per render through
// useWindowDimensions so a rotation re-measures instead of keeping the first size.
const CALENDAR_MAX_WIDTH = 400;
const CALENDAR_HORIZONTAL_INSET = 64;
// The month chevrons and the two boundary controls clear the 44pt iOS and 48dp
// Android floor through hitSlop alone, so no resting pixel moves for Section 7.
const NAV_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const BOUNDARY_HIT_SLOP = { top: 8, bottom: 8 };
// A refusal has no resting visual of its own, so it speaks through the announcement
// and takes the error haptic rather than moving the range or inventing an error row.
const END_BEFORE_START_MESSAGE = 'End date must be on or after the start date.';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function selectionFeedback() {
  void Haptics.selectionAsync();
}

function commitFeedback() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function refusalFeedback() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

// Spoken date shape. Built from the same date-fns formatter the rest of the app
// uses for an absolute date (`app/expense/[id].tsx`), never a literal.
function spokenDate(day: Date): string {
  return format(day, 'd MMMM yyyy');
}

export function DateRangePicker({ visible, startDate: initialStart, endDate: initialEnd, onApply, onClose }: DateRangePickerProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const sheetRef = useRef<View>(null);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const [startDate, setStartDate] = useState<Date | null>(initialStart || new Date());
  const [endDate, setEndDate] = useState<Date | null>(initialEnd || new Date());

  // Bounded both ways: never wider than the sheet inset allows, never past a tablet column.
  const calendarWidth = Math.min(windowWidth, CALENDAR_MAX_WIDTH + CALENDAR_HORIZONTAL_INSET) - CALENDAR_HORIZONTAL_INSET;

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // POLISH Section 7: move screen-reader focus into the sheet when it opens, the same
  // best-effort AccessibilityInfo call the other polished sheets make. Returning focus
  // to the opening control belongs to the host screen, which this unit does not own.
  useEffect(() => {
    if (visible && sheetRef.current !== null) {
      AccessibilityInfo.sendAccessibilityEvent(sheetRef.current, 'focus');
    }
  }, [visible]);

  const isInRange = (day: Date) => {
    if (!startDate || !endDate) return false;
    return isAfter(day, startDate) && isBefore(day, endDate);
  };

  const selectBoundary = useCallback((boundary: 'start' | 'end') => {
    if (boundary === selecting) return;
    selectionFeedback();
    setSelecting(boundary);
  }, [selecting]);

  const goToMonth = useCallback((next: Date) => {
    selectionFeedback();
    setCurrentMonth(next);
  }, []);

  const handleDayPress = useCallback((day: Date) => {
    if (selecting === 'start') {
      setStartDate(day);
      // The end only survives a start that stays before it. A later start clears it,
      // which drops the sheet into the one-boundary-chosen state with Apply disabled.
      if (endDate && isAfter(day, endDate)) setEndDate(null);
      setSelecting('end');
      selectionFeedback();
      return;
    }

    // A day before the start cannot be an end. It is refused and announced rather
    // than silently reinterpreted as a new start, and the range is left untouched.
    // The same day is a valid one-day range, so only strictly-before is refused.
    // The Start control above is the deliberate route to re-pick an earlier start.
    if (!startDate) {
      setStartDate(day);
      selectionFeedback();
      return;
    }
    if (isBefore(day, startDate)) {
      refusalFeedback();
      AccessibilityInfo.announceForAccessibility(END_BEFORE_START_MESSAGE);
      return;
    }

    setEndDate(day);
    selectionFeedback();
  }, [endDate, selecting, startDate]);

  const handleApply = useCallback(() => {
    if (!startDate || !endDate) return;
    commitFeedback();
    onApply(startDate, endDate);
  }, [endDate, onApply, startDate]);

  const startValueLabel = startDate ? `Start date, ${spokenDate(startDate)}` : 'Start date, none chosen';
  const endValueLabel = endDate ? `End date, ${spokenDate(endDate)}` : 'End date, none chosen';
  // The chosen range reads back as one sentence instead of two bare values, so a
  // screen-reader user hears what Apply will commit before they activate it.
  const applyLabel = startDate && endDate
    ? `Apply custom range from ${spokenDate(startDate)} to ${spokenDate(endDate)}`
    : 'Apply custom range, choose a start and end date';

  return (
    <Modal
      visible={visible}
      transparent
      // Reduce motion drops the slide for the Section 4 modal fallback, a fade. The
      // resting sheet is identical either way; only the transition changes.
      animationType={reduceMotion ? 'fade' : 'slide'}
      // Android hardware back is a dismiss path, so it must not strand the user here.
      onRequestClose={onClose}
    >
      <View style={{ backgroundColor: ts.bg.overlay, flex: 1 }} className="justify-end">
        {/* The scrim the pair dismisses on (HTML 454). Kept out of the accessibility
            tree so it adds no second dismiss stop beside Cancel and only ever acts as
            a tap target. */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <View
          ref={sheetRef}
          // iOS ignores the scrim sibling while the sheet is up, which is the trap the
          // opening sequence needs; the Modal already isolates Android. No container
          // label, matching `EditProfileSheet`: the sheet is one stop per real control,
          // not one invented summary stop above them.
          accessibilityViewIsModal
          style={{ backgroundColor: ts.bg.surfaceContainerHighest, borderTopLeftRadius: 40, borderTopRightRadius: 40 }}
          className="p-6"
        >
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={{ backgroundColor: ts.bg.white10 }}
            className="w-12 h-1.5 rounded-full self-center mb-6"
          />

          <View className="flex-row justify-between items-center mb-6">
            <TouchableOpacity
              onPress={() => selectBoundary('start')}
              accessibilityRole="button"
              accessibilityLabel={startValueLabel}
              accessibilityState={{ selected: selecting === 'start' }}
              hitSlop={BOUNDARY_HIT_SLOP}
              className="flex-1"
            >
              <Text style={{ color: selecting === 'start' ? ts.text.primary : ts.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-1">Start</Text>
              <Text style={{ color: selecting === 'start' ? ts.text.onSurface : ts.text.onSurfaceVariant }} className="font-manrope-bold text-base">
                {startDate ? format(startDate, 'MMM dd, yyyy') : 'Select'}
              </Text>
            </TouchableOpacity>
            <Text accessible={false} importantForAccessibility="no-hide-descendants" style={{ color: ts.text.onSurfaceVariant40 }} className="mx-4 text-lg">→</Text>
            <TouchableOpacity
              onPress={() => selectBoundary('end')}
              accessibilityRole="button"
              accessibilityLabel={endValueLabel}
              accessibilityState={{ selected: selecting === 'end' }}
              hitSlop={BOUNDARY_HIT_SLOP}
              className="flex-1 items-end"
            >
              <Text style={{ color: selecting === 'end' ? ts.text.primary : ts.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-1">End</Text>
              <Text style={{ color: selecting === 'end' ? ts.text.onSurface : ts.text.onSurfaceVariant }} className="font-manrope-bold text-base">
                {endDate ? format(endDate, 'MMM dd, yyyy') : 'Select'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ maxWidth: calendarWidth, alignSelf: 'center' }}>
            <View className="flex-row justify-between items-center mb-4 px-2">
              <TouchableOpacity
                onPress={() => goToMonth(subMonths(currentMonth, 1))}
                accessibilityRole="button"
                accessibilityLabel={`Previous month, ${format(subMonths(currentMonth, 1), 'MMMM yyyy')}`}
                hitSlop={NAV_HIT_SLOP}
                className="p-2"
              >
                <ChevronLeft size={20} color={ts.text.onSurfaceVariant} />
              </TouchableOpacity>
              <Text accessibilityRole="header" style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">{format(currentMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity
                onPress={() => goToMonth(addMonths(currentMonth, 1))}
                accessibilityRole="button"
                accessibilityLabel={`Next month, ${format(addMonths(currentMonth, 1), 'MMMM yyyy')}`}
                hitSlop={NAV_HIT_SLOP}
                className="p-2"
              >
                <ChevronRight size={20} color={ts.text.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <View className="flex-row mb-2">
              {WEEKDAYS.map((day) => (
                <View key={day} style={{ width: calendarWidth / 7 }} className="items-center py-1">
                  <Text accessible={false} style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase">{day}</Text>
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
                    accessibilityRole="button"
                    // A spoken full date instead of a bare day number, plus the two
                    // states that matter: the chosen edge, and an out-of-month day the
                    // grid draws but does not accept.
                    accessibilityLabel={format(day, 'EEEE, d MMMM yyyy')}
                    accessibilityState={{ selected: Boolean(isRangeEdge), disabled: !isCurrentMonth }}
                    style={{
                      width: calendarWidth / 7,
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
                      color: isRangeEdge ? ts.text.black : isCurrentMonth ? ts.text.onSurface : ts.text.onSurfaceVariant30,
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
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={{ borderColor: ts.border.card, borderWidth: 1 }}
              className="flex-1 h-12 rounded-2xl items-center justify-center"
            >
              <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              accessibilityRole="button"
              accessibilityLabel={applyLabel}
              accessibilityState={{ disabled: !startDate || !endDate }}
              style={{ backgroundColor: ts.bg.primary, opacity: startDate && endDate ? 1 : 0.4 }}
              className="flex-1 h-12 rounded-2xl items-center justify-center"
              disabled={!startDate || !endDate}
            >
              <Text style={{ color: ts.text.black }} className="font-manrope-bold">Apply Range</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
