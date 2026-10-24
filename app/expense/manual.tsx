import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Briefcase, Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Repeat, Tag, X } from 'lucide-react-native';
import { format, isToday } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { CategoryTints, Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { DockedNumpad } from '../../components/capture/DockedNumpad';
import { DateTimeFieldSheet } from '../../components/capture/DateTimeFieldSheet';
import { useDateTimeFieldControl } from '../../components/capture/useDateTimeFieldControl';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { formatAmountInput, formatCurrency } from '../../utils/currency';
import { resolveExpenseSave, runCaptureSideEffects, type DuplicateMatch } from '../../data';

const SWITCH_TRACK_WIDTH = 44;
const SWITCH_TRACK_HEIGHT = 24;
const SWITCH_KNOB = 20;
const SWITCH_KNOB_TRAVEL = SWITCH_TRACK_WIDTH - SWITCH_KNOB - 4;
const MAX_INT_DIGITS = 7;
const CURSOR_HEIGHT = 32;

// The S-15 recurring model only understands daily, weekly, monthly and custom
// (types/database.ts:65, DatabaseService.getNextDueDate). The pair's Bi-Weekly
// option would fall through to a one day next-due date, so only the supported
// intervals ship here and the omission is escalated in the task evidence.
const RECURRENCE_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
] as const;

// How long the merchant field has to settle before the persisted category
// suggestion for it is read, so typing a name does not issue a read per keystroke.
const MERCHANT_SUGGESTION_DELAY_MS = 400;

// The category default is derived only from signals the app really stores: the
// per-merchant memory the capture pipeline already writes, the newest expense row,
// and the category table itself. When none of them speaks, the field stays empty.
type CategoryDefaultSource = 'merchant-memory' | 'recent-expense' | 'first-category' | 'none';

function ToggleSwitch({
  value,
  onToggle,
  activeColor,
  label,
}: {
  value: boolean;
  onToggle: () => void;
  activeColor: string;
  label: string;
}) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: 180 });
  }, [value, progress, reduceMotion]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * SWITCH_KNOB_TRAVEL }],
  }));

  return (
    <ScalePressable
      haptic={false}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => { void Haptics.selectionAsync(); onToggle(); }}
      style={[
        styles.switchTrack,
        { backgroundColor: value ? activeColor : ts.bg.elevated, borderColor: ts.border.card },
      ]}
    >
      <Animated.View style={[styles.switchKnob, knobStyle]} />
    </ScalePressable>
  );
}

export default function ManualEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string; imageUri?: string }>();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { currency, getCurrencySymbol } = useSettings();
  const { showToast } = useToast();
  const { checkForNewAchievements } = useAchievements();

  const [amount, setAmount] = useState('0.00');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CaptureCategory | null>(null);
  const [categoryDefaultSource, setCategoryDefaultSource] = useState<CategoryDefaultSource>('none');
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [categoryLoadFailed, setCategoryLoadFailed] = useState(false);
  const [isCategoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [isReimbursable, setReimbursable] = useState(false);
  const [isRecurring, setRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<string>('monthly');
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [saving, setSaving] = useState<'idle' | 'checking' | 'saving'>('idle');
  const [saveFailed, setSaveFailed] = useState(false);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  // DEC-11-01. The amount card opens with the docked numpad in place and the native
  // keyboard dismissed; focusing any text field hands the bottom back to the native
  // keyboard and removes the numpad from the layout entirely.
  const [isAmountActive, setAmountActive] = useState(true);
  const [isReceiptExpanded, setReceiptExpanded] = useState(false);
  // The date and time control is one shared implementation with the income form.
  const {
    platform: dateTimePlatform,
    value: enteredDate,
    field: dateTimeField,
    open: openDateTimeField,
    dismiss: dismissDateTimeField,
    done: doneDateTimeField,
    switchMode: selectDateTimeMode,
    handleChange: handleDateChange,
  } = useDateTimeFieldControl();
  const merchantInputRef = useRef<TextInput>(null);
  const noteInputRef = useRef<TextInput>(null);
  // Set once the user picks a category themselves, so a late merchant suggestion can
  // never overwrite a choice they made.
  const categoryChosenByUser = useRef(false);

  const receiptImageUri = typeof params.imageUri === 'string' && params.imageUri.trim() ? params.imageUri.trim() : null;

  const enterOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const enterOffset = useSharedValue(reduceMotion ? 0 : 16);
  const cursorOpacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      enterOpacity.value = 1;
      enterOffset.value = 0;
    } else {
      enterOpacity.value = withTiming(1, { duration: 280 });
      enterOffset.value = withTiming(0, { duration: 280 });
    }
    // Shared values are stable refs; writing them here is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      cursorOpacity.value = 1;
      return;
    }
    cursorOpacity.value = withRepeat(
      withSequence(withTiming(0.25, { duration: 800 }), withTiming(1, { duration: 800 })),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const applyCategoryDefault = useCallback((items: CaptureCategory[], recentCategoryId: string | null) => {
    if (categoryChosenByUser.current || items.length === 0) return;
    const remembered = recentCategoryId ? items.find(category => category.id === recentCategoryId) ?? null : null;
    if (remembered) {
      setSelectedCategory(remembered);
      setCategoryDefaultSource('recent-expense');
      return;
    }
    setSelectedCategory(items[0]);
    setCategoryDefaultSource('first-category');
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const items = await databaseService.getCategories();
      setCategories(items);
      setCategoryLoadFailed(false);
      // The most recent real expense is the only "what did I use last" signal the app
      // stores, so the default comes from that row rather than from a guess.
      let recentCategoryId: string | null = null;
      try {
        const recent = await databaseService.getRecentExpenses(1);
        recentCategoryId = recent[0]?.category ?? null;
      } catch {
        recentCategoryId = null;
      }
      applyCategoryDefault(items, recentCategoryId);
    } catch {
      setCategoryLoadFailed(true);
    }
  }, [applyCategoryDefault]);

  // A typed merchant can suggest the category the user settled on for that merchant
  // last time. The read is deferred so typing does not issue one per keystroke, and it
  // never overrides a category the user picked in this form.
  useEffect(() => {
    const trimmed = merchant.trim();
    if (!trimmed || categoryChosenByUser.current) return;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const repository = await databaseService.getCaptureRepository();
          const remembered = await repository.getRememberedCategory(trimmed);
          if (!active || categoryChosenByUser.current || !remembered) return;
          const match = categories.find(category => category.id === remembered) ?? null;
          if (!match) return;
          setSelectedCategory(match);
          setCategoryDefaultSource('merchant-memory');
        } catch {
          // A memory read failure leaves whatever default is already shown.
        }
      })();
    }, MERCHANT_SUGGESTION_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [categories, merchant]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadCategories(); }, 0);
    return () => clearTimeout(timer);
  }, [loadCategories]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterOpacity.value,
    transform: [{ translateY: enterOffset.value }],
  }));

  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  const parsedAmount = parseFloat(amount) || 0;
  const amountValid = parsedAmount > 0;
  const merchantValid = merchant.trim().length > 0;
  const categoryValid = selectedCategory !== null;
  const canSave = amountValid && merchantValid && categoryValid;
  const busy = saving !== 'idle';

  const symbol = getCurrencySymbol(currency);
  const originLabel = typeof params.origin === 'string' && params.origin.trim() ? params.origin.trim() : null;
  const dateLabel = `${isToday(enteredDate) ? 'Today' : format(enteredDate, 'EEE, MMM d')} · ${format(enteredDate, 'h:mm a')}`;
  const merchantNeedsAttention = hasAttemptedSave && !merchantValid;
  const amountNeedsAttention = hasAttemptedSave && !amountValid;
  const categoryNeedsAttention = hasAttemptedSave && !categoryValid;

  const tint = selectedCategory
    ? (CategoryTints[selectedCategory.id as keyof typeof CategoryTints] ?? CategoryTints.other)
    : CategoryTints.other;
  const tintColors = ts.isDark ? tint.dark : tint.light;
  // Pair reimbursable chip is blue-100 on blue-600 in light and blue-900/40 on
  // blue-400 in dark, so it follows the theme like every other tint.
  const reimburseTint = ts.isDark ? CategoryTints.transport.dark : CategoryTints.transport.light;

  // The primary action never changes job. It states what it will save, or just what it
  // does, and every missing field is explained next to that field instead.
  const saveLabel = amountValid
    ? `Save Expense (${formatCurrency(parsedAmount, currency)})`
    : 'Save Expense';

  // DEC-11-01. Activating the amount card owns the bottom of the screen: the native
  // keyboard is dismissed and the docked numpad takes its place.
  const activateAmount = useCallback(() => {
    Keyboard.dismiss();
    merchantInputRef.current?.blur();
    noteInputRef.current?.blur();
    setAmountActive(true);
  }, []);

  // Any text field taking focus removes the numpad from the layout before the native
  // keyboard opens, so the two can never compete for the same space.
  const deactivateAmount = useCallback(() => {
    setAmountActive(false);
  }, []);

  const handleSelectCategory = useCallback((category: CaptureCategory) => {
    categoryChosenByUser.current = true;
    setSelectedCategory(category);
    setCategoryDefaultSource('none');
    setCategoryPickerVisible(false);
  }, []);

  const handleKeyPress = useCallback((key: string) => {
    setAmount(prev => {
      let current = prev;
      // Pair JS (code.html lines 900-932): the initial 0.00 or 0 is cleared on
      // the first key, decimals cap at two places, and the integer caps at 7.
      if (current === '0.00' || current === '0') current = '';
      if (key === 'delete') {
        current = current.slice(0, -1);
        if (current.length === 0) current = '0';
      } else if (key === '.') {
        if (!current.includes('.')) current = (current === '' ? '0' : current) + '.';
      } else if (current.includes('.')) {
        const parts = current.split('.');
        if (parts[1].length < 2) current += key;
      } else if (current.length < MAX_INT_DIGITS) {
        current += key;
      }
      return current;
    });
  }, []);

  const doSave = useCallback(async (allowDuplicate = false) => {
    setHasAttemptedSave(true);
    if (!selectedCategory || !merchant.trim() || parsedAmount <= 0) return;
    setSaveFailed(false);
    setSaving(allowDuplicate ? 'saving' : 'checking');
    const candidate = {
      merchant: merchant.trim(),
      amount: parsedAmount,
      currency,
      category: selectedCategory.id,
      note: note.trim() || undefined,
      source: 'manual' as const,
      origin: 'manual_expense' as const,
      date: enteredDate.getTime(),
      isRecurring,
      recurrenceInterval: isRecurring ? recurrenceInterval : undefined,
      isReimbursable,
    };
    try {
      const repository = await databaseService.getCaptureRepository();
      const resolution = await resolveExpenseSave(repository, candidate, allowDuplicate ? 'save_anyway' : 'confirm');
      if (resolution.status === 'duplicate') {
        setDuplicateWarning(resolution.duplicate);
        setSaving('idle');
        return;
      }
      if (resolution.status !== 'saved') {
        setSaving('idle');
        return;
      }
      await runCaptureSideEffects(resolution, candidate, {
        onExpenseSaved: checkForNewAchievements,
        onIncomeSaved: async () => undefined,
        scheduleNotification: (savedCandidate) => {
          if ('merchant' in savedCandidate) {
            notificationService.scheduleExpenseNotification(savedCandidate.merchant, formatCurrency(savedCandidate.amount, savedCandidate.currency));
          }
        },
      });
      setSaving('idle');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Expense saved', 'success');
      router.back();
    } catch {
      logger.error('Failed to save manual expense', 'save_failed');
      setSaving('idle');
      setSaveFailed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [merchant, parsedAmount, currency, selectedCategory, note, enteredDate, isRecurring, recurrenceInterval, isReimbursable, checkForNewAchievements, showToast, router]);

  const handleSave = useCallback(() => {
    if (!canSave || busy) return;
    void doSave(false);
  }, [canSave, busy, doSave]);

  const handleCancel = useCallback(() => {
    void Haptics.selectionAsync();
    router.back();
  }, [router]);

  const clearMerchant = useCallback(() => {
    setMerchant('');
    void Haptics.selectionAsync();
  }, []);

  const sectionTitle = useMemo(() => (isRecurring ? `Recurring: ${RECURRENCE_OPTIONS.find(o => o.value === recurrenceInterval)?.label ?? 'Monthly'} schedule` : 'Create recurring schedule'), [isRecurring, recurrenceInterval]);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: ts.bg.screen }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Cancel and return"
            onPress={handleCancel}
            style={[styles.headerBack, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
          >
            <ChevronLeft color={ts.icon.default} size={20} />
          </ScalePressable>

          <View style={styles.headerCenter}>
            <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]} numberOfLines={1}>
              Log Expense
            </Text>
            {originLabel ? (
              <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{`From ${originLabel}`}</Text>
            ) : null}
          </View>

          <View
            accessibilityLabel={`Currency ${currency}`}
            style={[styles.currencyChip, { backgroundColor: ts.raw.purple100 }]}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.micro, { fontFamily: 'Manrope_700Bold', color: ts.text.primary }]}>
              {`${currency} ${symbol}`}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[enterStyle, styles.stack]}>
            {saveFailed ? (
              <View
                accessibilityRole="alert"
                style={[styles.errorBox, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}
              >
                <Text style={[Typography.labelMd, { color: ts.text.error }]}>
                  Could not save. Nothing was lost. Check the fields and try again.
                </Text>
              </View>
            ) : null}

            {receiptImageUri ? (
              <View style={[styles.card, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <Pressable
                  onPress={() => { void Haptics.selectionAsync(); setReceiptExpanded(value => !value); }}
                  accessibilityRole="button"
                  accessibilityLabel={isReceiptExpanded ? 'Hide the captured receipt' : 'Show the captured receipt'}
                  accessibilityState={{ expanded: isReceiptExpanded }}
                  style={styles.receiptHeader}
                >
                  <View style={[styles.dateIcon, { backgroundColor: ts.raw.purple100 }]}>
                    <Tag size={16} color={ts.text.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Captured receipt</Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                      {isReceiptExpanded ? 'Tap to hide' : 'Tap to read it while you type'}
                    </Text>
                  </View>
                  {isReceiptExpanded ? <ChevronUp size={18} color={ts.icon.muted} /> : <ChevronDown size={18} color={ts.icon.muted} />}
                </Pressable>
                {isReceiptExpanded ? (
                  <View style={styles.receiptImageWrap}>
                    <Image
                      source={{ uri: receiptImageUri }}
                      style={styles.receiptImage}
                      contentFit="contain"
                      accessibilityLabel="Captured receipt photo"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={activateAmount}
              accessibilityRole="button"
              accessibilityLabel={`Amount spent ${formatAmountInput(amount) || '0.00'} ${currency}. Tap to type with the keypad`}
              accessibilityState={{ selected: isAmountActive }}
              style={[
                styles.card,
                styles.heroCard,
                { backgroundColor: ts.bg.surface, borderColor: isAmountActive ? ts.border.primary20 : ts.border.card },
              ]}
            >
              <View style={styles.rowBetween}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Amount Spent</Text>
                {amountNeedsAttention ? (
                  <Text style={[Typography.micro, { color: ts.text.error }]}>Add the amount you spent</Text>
                ) : null}
              </View>
              <View style={styles.amountRow}>
                <Text style={[Typography.headlineSm, { color: ts.text.primary }]}>{symbol}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.displayLg, styles.amountValue, { color: ts.text.onSurface }]}>
                  {formatAmountInput(amount) || '0.00'}
                </Text>
                {isAmountActive ? <Animated.View style={[styles.cursor, { backgroundColor: ts.text.primary }, cursorStyle]} /> : null}
              </View>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
                {isAmountActive ? 'Typing with the keypad below' : 'Tap the amount to reopen the keypad'}
              </Text>
            </Pressable>

            <View style={styles.formGroup}>
            <View style={[styles.card, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.rowBetween}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>Merchant</Text>
                {merchantNeedsAttention ? (
                  <Text style={[Typography.micro, { color: ts.text.error }]}>Required to save</Text>
                ) : null}
              </View>
              <View style={[styles.inputRow, { backgroundColor: ts.bg.screen, borderColor: merchantNeedsAttention ? ts.border.error20 : 'transparent' }]}>
                <Tag size={16} color={ts.icon.muted} />
                <TextInput
                  ref={merchantInputRef}
                  value={merchant}
                  onChangeText={(val) => { setMerchant(val); if (hasAttemptedSave && val.trim().length > 0) setHasAttemptedSave(false); }}
                  onFocus={deactivateAmount}
                  placeholder="e.g. Whole Foods, Blue Bottle Coffee"
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  accessibilityLabel="Merchant"
                  style={[styles.input, Typography.bodyBold, { color: ts.text.onSurface }]}
                />
                {merchant.length > 0 ? (
                  <ScalePressable
                    haptic={false}
                    accessibilityRole="button"
                    accessibilityLabel="Clear merchant"
                    onPress={clearMerchant}
                    style={styles.clearButton}
                  >
                    <X size={16} color={ts.text.onSurfaceVariant} />
                  </ScalePressable>
                ) : null}
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.rowBetween}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>Category</Text>
                {categoryNeedsAttention ? (
                  <Text style={[Typography.micro, { color: ts.text.error }]}>Pick a category</Text>
                ) : selectedCategory ? (
                  <Text style={[Typography.micro, { color: ts.text.primary }]}>Selected</Text>
                ) : null}
              </View>
              <ScalePressable
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={selectedCategory ? `Category, ${selectedCategory.title}. Change category` : 'Select category'}
                onPress={() => { void Haptics.selectionAsync(); setCategoryPickerVisible(true); }}
                style={[styles.categoryChip, { backgroundColor: ts.bg.screen, borderColor: categoryNeedsAttention ? ts.border.error20 : ts.border.card }]}
              >
                <View style={[styles.categoryIcon, { backgroundColor: tintColors[0] }]}>
                  <CategoryGlyph iconName={selectedCategory?.icon_name} size={20} color={tintColors[1]} />
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[Typography.bodyBold, { color: selectedCategory ? ts.text.onSurface : ts.text.onSurfaceVariant }]}>
                    {selectedCategory?.title ?? 'Select category'}
                  </Text>
                </View>
                <View style={styles.changeRow}>
                  <Text style={[Typography.labelMd, { color: ts.text.primary }]}>Change</Text>
                  <ChevronRight size={16} color={ts.text.primary} />
                </View>
              </ScalePressable>
              {categoryDefaultSource === 'recent-expense' || categoryDefaultSource === 'first-category' ? (
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                  {categoryDefaultSource === 'recent-expense'
                    ? 'Suggested from your last expense. Change it if this one is different.'
                    : 'Suggested from your category list. Change it if this one is different.'}
                </Text>
              ) : null}
              {categoryLoadFailed ? (
                <View style={[styles.errorBox, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20, marginTop: Spacing.s3 }]}>
                  <Text style={[Typography.labelMd, { color: ts.text.error }]}>
                    Categories could not be loaded.
                  </Text>
                  <ScalePressable haptic={false} accessibilityRole="button" accessibilityLabel="Retry loading categories" onPress={() => { void loadCategories(); }} style={styles.retry}>
                    <Text style={[Typography.labelMd, { color: ts.text.primary }]}>Retry</Text>
                  </ScalePressable>
                </View>
              ) : null}
            </View>

            <ScalePressable
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel={`Date and time: ${dateLabel}. Tap to change`}
              onPress={() => {
                void Haptics.selectionAsync();
                openDateTimeField();
              }}
              style={[styles.card, styles.dateCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
            >
              <View style={styles.dateLeft}>
                <View style={[styles.dateIcon, { backgroundColor: ts.raw.purple100 }]}>
                  <Calendar size={16} color={ts.text.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>Date & Time</Text>
                  <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{dateLabel}</Text>
                </View>
              </View>
              <View style={styles.changeRow}>
                <Text style={[Typography.labelMd, { color: ts.text.primary }]}>Change</Text>
                <ChevronRight size={16} color={ts.text.primary} />
              </View>
            </ScalePressable>

            {/* The iOS wheels live in a bottom sheet (below), so opening the picker never
                pushes the form. Android keeps its own system dialogs. */}

            <View style={[styles.card, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.rowBetween}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>Note</Text>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Optional</Text>
              </View>
              <View style={[styles.inputRow, { backgroundColor: ts.bg.screen }]}>
                <TextInput
                  ref={noteInputRef}
                  value={note}
                  onChangeText={setNote}
                  onFocus={deactivateAmount}
                  placeholder="Add receipt notes or memo..."
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  accessibilityLabel="Note, optional"
                  style={[styles.input, Typography.bodyRegular, { color: ts.text.onSurface }]}
                />
              </View>
            </View>

            <View style={[styles.card, styles.togglesCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleLeft}>
                  <View style={[styles.toggleIcon, { backgroundColor: reimburseTint[0] }]}>
                    <Briefcase size={14} color={reimburseTint[1]} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Reimbursable</Text>
                    <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Tag as business expense</Text>
                  </View>
                </View>
                <ToggleSwitch
                  value={isReimbursable}
                  onToggle={() => setReimbursable(value => !value)}
                  activeColor={reimburseTint[1]}
                  label="Reimbursable expense"
                />
              </View>

              <View style={[styles.divider, { backgroundColor: ts.border.card }]} />

              <View style={styles.toggleRow}>
                <View style={styles.toggleLeft}>
                  <View style={[styles.toggleIcon, { backgroundColor: ts.raw.purple100 }]}>
                    <Repeat size={14} color={ts.text.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Repeats</Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{sectionTitle}</Text>
                  </View>
                </View>
                <ToggleSwitch
                  value={isRecurring}
                  onToggle={() => setRecurring(value => !value)}
                  activeColor={ts.text.primary}
                  label="Recurring expense"
                />
              </View>

              {isRecurring ? (
                <View style={[styles.frequencyRow, { borderTopColor: ts.border.card }]}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Frequency:</Text>
                  <View accessibilityRole="radiogroup" style={styles.frequencyOptions}>
                    {RECURRENCE_OPTIONS.map(option => {
                      const selected = recurrenceInterval === option.value;
                      return (
                        <ScalePressable
                          key={option.value}
                          haptic={false}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={option.label}
                          onPress={() => { void Haptics.selectionAsync(); setRecurrenceInterval(option.value); }}
                          style={[
                            styles.frequencyButton,
                            { backgroundColor: selected ? ts.bg.primary : ts.bg.screen },
                          ]}
                        >
                          <Text style={[Typography.micro, { fontFamily: 'Manrope_700Bold', color: selected ? ts.text.white : ts.text.onSurfaceVariant }]}>
                            {option.label}
                          </Text>
                        </ScalePressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* DEC-11-01. The bottom dock is part of the layout, not an overlay: the numpad
            and the action bar take their own space, so neither can cover the merchant
            field, the category card, the date card or each other at any scroll position.
            When a text field has focus the numpad is removed from the tree entirely and
            the native keyboard owns this space. */}
        {isAmountActive ? <DockedNumpad onKeyPress={handleKeyPress} /> : null}

        <View style={[styles.footer, { backgroundColor: ts.bg.screen, borderTopColor: ts.border.subtle }]}>
          <View style={[styles.footerContent, { paddingBottom: Math.max(Spacing.s4, insets.bottom) }]}>
            <View style={styles.actionRow}>
              <View style={styles.cancelSlot}>
                <PeachButton
                  title="Cancel"
                  variant="quiet"
                  size="lg"
                  fullWidth
                  onPress={handleCancel}
                  disabled={busy}
                />
              </View>
              <View style={styles.saveSlot}>
                <PeachButton
                  title={saveLabel}
                  variant="primary"
                  size="xl"
                  fullWidth
                  onPress={handleSave}
                  disabled={!canSave || busy}
                  isLoading={busy}
                  adjustsLabelFontSize
                />
              </View>
            </View>
          </View>
        </View>

        {dateTimePlatform === 'android' && dateTimeField.visible ? (
          <DateTimePicker
            value={enteredDate}
            mode={dateTimeField.mode}
            is24Hour={false}
            display="default"
            onValueChange={handleDateChange}
            onDismiss={dismissDateTimeField}
          />
        ) : null}
      </KeyboardAvoidingView>

      <CategoryPickerSheet
        visible={isCategoryPickerVisible}
        categories={categories}
        selectedId={selectedCategory?.id}
        flowType="expense"
        originLabel={merchant.trim() || undefined}
        originAmount={parsedAmount > 0 ? formatCurrency(parsedAmount, currency) : undefined}
        onSelect={handleSelectCategory}
        onClose={() => setCategoryPickerVisible(false)}
      />

      {/* The iOS wheels moved here from the scroll body: opening the picker no longer
          pushes the form, and the sheet cannot be confused with a form card. */}
      <DateTimeFieldSheet
        visible={dateTimePlatform === 'ios' && dateTimeField.visible}
        value={enteredDate}
        mode={dateTimeField.mode}
        onValueChange={handleDateChange}
        onDismiss={dismissDateTimeField}
        onSwitchMode={selectDateTimeMode}
        onDone={doneDateTimeField}
      />

      {duplicateWarning ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicateWarning}
          incoming={{
            merchant: merchant.trim(),
            amount: parsedAmount,
            currency,
            category: selectedCategory?.id ?? '',
            type: 'expense',
            date: enteredDate.getTime(),
          }}
          onSaveAnyway={() => { setDuplicateWarning(null); void doSave(true); }}
          onDiscard={() => { setDuplicateWarning(null); showToast('Duplicate discarded', 'info'); }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s1,
    paddingBottom: Spacing.s3,
    gap: Spacing.s3,
  },
  headerBack: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  currencyChip: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: Spacing.s2,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { paddingHorizontal: Spacing.s5, paddingBottom: Spacing.s6, gap: Spacing.s4 },
  stack: { gap: Spacing.s4 },
  card: { borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s4, gap: Spacing.s2 },
  heroCard: { borderRadius: Radii.lg },
  // Pair groups the five field cards with `space-y-3` (12) inside the wider
  // `space-y-4` body stack.
  formGroup: { gap: Spacing.s3 },
  // Pair toggles card uses `space-y-3` between the two rows and the divider.
  togglesCard: { gap: Spacing.s3 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.s1 },
  amountValue: { fontVariant: ['tabular-nums'], marginLeft: Spacing.s1 },
  cursor: { width: 2, height: CURSOR_HEIGHT, borderRadius: 1, marginLeft: 2 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.s3,
    minHeight: 44,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: Spacing.s2 },
  clearButton: { paddingHorizontal: Spacing.s2, minHeight: 44, justifyContent: 'center' },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    padding: Spacing.s3,
    minHeight: 64,
  },
  categoryIcon: { width: 40, height: 40, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, flexShrink: 0 },
  dateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  dateIcon: { width: 32, height: 32, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  toggleIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  divider: { height: 1, marginVertical: 0 },
  switchTrack: {
    width: SWITCH_TRACK_WIDTH,
    height: SWITCH_TRACK_HEIGHT,
    borderRadius: Radii.full,
    borderWidth: 1,
    padding: 2,
    justifyContent: 'center',
    flexShrink: 0,
  },
  switchKnob: {
    width: SWITCH_KNOB,
    height: SWITCH_KNOB,
    borderRadius: Radii.full,
    backgroundColor: Colors.white,
  },
  frequencyRow: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    marginTop: 0,
    paddingTop: Spacing.s2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  frequencyOptions: { flexDirection: 'row', gap: Spacing.s2 },
  frequencyButton: { paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s2, borderRadius: Radii.sm, minHeight: 44, justifyContent: 'center' },
  // The docked keypad and the action bar are layout siblings under the scroll body, so
  // the pad can never float over a field. The pad keeps its own fixed key height.
  receiptHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, minHeight: 44 },
  receiptImageWrap: { borderRadius: Radii.sm, overflow: 'hidden', backgroundColor: '#000000' },
  receiptImage: { width: '100%', aspectRatio: 3 / 4, maxHeight: 320 },
  errorBox: { borderWidth: 1, borderRadius: Radii.md, padding: Spacing.s3, gap: Spacing.s2 },
  retry: { minHeight: 44, justifyContent: 'center' },
  footer: { borderTopWidth: 1 },
  footerContent: { paddingHorizontal: Spacing.s4, paddingTop: Spacing.s3 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3 },
  cancelSlot: { width: '32%' },
  saveSlot: { flex: 1 },
});
