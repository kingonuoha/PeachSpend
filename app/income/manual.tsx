import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Briefcase, Calendar, ChevronLeft, ChevronRight, Repeat, X } from 'lucide-react-native';
import { format, isToday } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { CategoryTints, Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { VirtualNumpad } from '../../components/capture/VirtualNumpad';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { EntryCurrencyPicker } from '../../components/capture/EntryCurrencyPicker';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { formatCurrency } from '../../utils/currency';
import { resolveIncomeSave, runCaptureSideEffects, type DuplicateMatch } from '../../data';

const SWITCH_TRACK_WIDTH = 44;
const SWITCH_TRACK_HEIGHT = 24;
const SWITCH_KNOB = 20;
const SWITCH_KNOB_TRAVEL = SWITCH_TRACK_WIDTH - SWITCH_KNOB - 4;
const MAX_INT_DIGITS = 7;
const CURSOR_HEIGHT = 32;

// The S-15 recurring model only understands daily, weekly, monthly and custom
// (types/database.ts:65, DatabaseService.getNextDueDate). The pair's Bi-Weekly
// and Quarterly options would fall through to a one-day next-due date, so only
// the supported intervals ship here and the omission is escalated.
const RECURRENCE_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
] as const;

function ToggleSwitch({
  value,
  onToggle,
  label,
}: {
  value: boolean;
  onToggle: () => void;
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
        { backgroundColor: value ? ts.text.primary : ts.bg.elevated, borderColor: ts.border.card },
      ]}
    >
      <Animated.View style={[styles.switchKnob, knobStyle]} />
    </ScalePressable>
  );
}

export default function IncomeEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string }>();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { currency, getCurrencySymbol, conversionRates } = useSettings();
  const { showToast } = useToast();
  const { checkForNewAchievements } = useAchievements();

  const [enteredAt] = useState(() => Date.now());
  const [amount, setAmount] = useState('0.00');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CaptureCategory | null>(null);
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [categoryLoadFailed, setCategoryLoadFailed] = useState(false);
  const [isCategoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [isRecurring, setRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<string>('monthly');
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [saving, setSaving] = useState<'idle' | 'checking' | 'saving'>('idle');
  const [saveFailed, setSaveFailed] = useState(false);

  // The user's currency may resolve after the provider loads. Track whether the
  // picker was touched so a real manual choice is never clobbered.
  const currencyTouched = useRef(false);
  useEffect(() => {
    if (!currencyTouched.current) setSelectedCurrency(currency);
  }, [currency]);

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

  const loadCategories = useCallback(async () => {
    try {
      const items = await databaseService.getCategories();
      setCategories(items);
      setCategoryLoadFailed(false);
    } catch {
      setCategoryLoadFailed(true);
    }
  }, []);

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
  const sourceValid = source.trim().length > 0;
  const categoryValid = selectedCategory !== null;
  const canSave = amountValid && sourceValid && categoryValid;
  const busy = saving !== 'idle';

  const symbol = getCurrencySymbol(selectedCurrency);
  const originLabel = typeof params.origin === 'string' && params.origin.trim() ? params.origin.trim() : null;
  const dateLabel = `${isToday(enteredAt) ? 'Today' : format(enteredAt, 'EEE, MMM d')} · ${format(enteredAt, 'h:mm a')}`;

  // Supported currencies come from the real conversion-rate map, never a local
  // hardcoded list. The active entry currency is always present even before the
  // provider resolves.
  const currencyOptions = useMemo(() => {
    const codes = Object.keys(conversionRates);
    return codes.includes(selectedCurrency) ? codes : [selectedCurrency, ...codes];
  }, [conversionRates, selectedCurrency]);

  const tint = selectedCategory
    ? (CategoryTints[selectedCategory.id as keyof typeof CategoryTints] ?? CategoryTints.other)
    : CategoryTints.other;
  const tintColors = ts.isDark ? tint.dark : tint.light;

  // Design line 1142: the source field shows a red border only once an amount is
  // present and the source is still empty.
  const sourceNeedsAttention = !sourceValid && parsedAmount > 0;

  const saveLabel = !amountValid
    ? 'Enter an Amount'
    : !sourceValid
      ? 'Enter Income Source'
      : !categoryValid
        ? 'Select a Category'
        : `Save Income (${formatCurrency(parsedAmount, selectedCurrency)})`;

  const handleKeyPress = useCallback((key: string) => {
    setAmount(prev => {
      let current = prev;
      // Pair decimal handling (code.html lines 860-872): the initial 0.00 or 0 is
      // cleared on the first key, decimals cap at two places, integer caps at 7.
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
    if (!selectedCategory) return;
    setSaveFailed(false);
    setSaving(allowDuplicate ? 'saving' : 'checking');
    const candidate = {
      source: 'manual' as const,
      origin: 'manual_income' as const,
      sourceName: source.trim(),
      amount: parsedAmount,
      currency: selectedCurrency,
      category: selectedCategory.id,
      date: enteredAt,
      note: note.trim() || undefined,
      isRecurring,
      recurrenceInterval: isRecurring ? recurrenceInterval : undefined,
    };
    try {
      const repository = await databaseService.getCaptureRepository();
      // The typed S-15 recurring handoff runs inside this shared resolver's
      // transaction, so no parallel recurring subsystem exists here.
      const resolution = await resolveIncomeSave(repository, candidate, allowDuplicate ? 'save_anyway' : 'confirm');
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
        onExpenseSaved: async () => undefined,
        // FR-11.3: income uses the income hook only, so it can never run the
        // expense-only spend badge path. The check is streak/consistency-based in
        // effect because income never changes expense aggregates.
        onIncomeSaved: checkForNewAchievements,
        scheduleNotification: (savedCandidate) => {
          if ('sourceName' in savedCandidate) {
            notificationService.scheduleExpenseNotification(savedCandidate.sourceName, formatCurrency(savedCandidate.amount, savedCandidate.currency));
          }
        },
      });
      setSaving('idle');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('Income saved', 'success');
      router.back();
    } catch {
      logger.error('Failed to save income', 'save_failed');
      setSaving('idle');
      setSaveFailed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [source, parsedAmount, selectedCurrency, selectedCategory, note, enteredAt, isRecurring, recurrenceInterval, checkForNewAchievements, showToast, router]);

  const handleSave = useCallback(() => {
    if (!canSave || busy) return;
    void doSave(false);
  }, [canSave, busy, doSave]);

  const handleCancel = useCallback(() => {
    void Haptics.selectionAsync();
    router.back();
  }, [router]);

  const clearSource = useCallback(() => {
    setSource('');
    void Haptics.selectionAsync();
  }, []);

  const selectCurrency = useCallback((code: string) => {
    currencyTouched.current = true;
    setSelectedCurrency(code);
  }, []);

  const openCategory = useCallback(() => {
    void Haptics.selectionAsync();
    setCategoryPickerVisible(true);
  }, []);

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
              Add Income
            </Text>
            {originLabel ? (
              <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{`From ${originLabel}`}</Text>
            ) : null}
          </View>

          <View
            accessibilityLabel={`Entry currency ${selectedCurrency}`}
            style={[styles.currencyChip, { backgroundColor: ts.raw.purple100, borderColor: ts.border.primary20 }]}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.micro, { fontFamily: 'Manrope_700Bold', color: ts.text.primary }]}>
              {`${selectedCurrency} ${symbol}`}
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

            <View
              accessibilityLabel="Income amount"
              style={[styles.card, styles.heroCard, { backgroundColor: ts.bg.surface, borderColor: ts.isDark ? ts.raw.outline : 'transparent' }]}
            >
              <View style={styles.rowBetween}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Income Amount</Text>
                <View style={[styles.inflowTag, { backgroundColor: ts.raw.successContainer, borderColor: ts.raw.successBorder }]}>
                  <Text style={[Typography.micro, { fontFamily: 'Manrope_700Bold', color: ts.raw.successText }]}>+ Cash Inflow</Text>
                </View>
              </View>
              <View style={styles.amountRow}>
                <Text style={[Typography.headlineSm, { color: ts.isDark ? ts.raw.primaryBorder : ts.text.onSurface }]}>{symbol}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.displayLg, styles.amountValue, { color: ts.text.onSurface }]}>
                  {amount}
                </Text>
                <Animated.View style={[styles.cursor, { backgroundColor: ts.text.primary }, cursorStyle]} />
              </View>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
                Tap to enter via shared virtual numpad below
              </Text>
            </View>

            <View style={styles.currencySection}>
              <Text style={[Typography.labelMd, styles.sectionLabel, { color: ts.text.onSurfaceVariant }]}>Entry Currency</Text>
              <EntryCurrencyPicker value={selectedCurrency} options={currencyOptions} onSelect={selectCurrency} />
            </View>

            <View style={styles.fieldBlock}>
              <View style={styles.fieldLabelRow}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>
                  Income Source <Text style={{ color: ts.text.error }}>*</Text>
                </Text>
                {sourceNeedsAttention ? (
                  <Text style={[Typography.micro, { color: ts.text.error }]}>Required to save</Text>
                ) : null}
              </View>
              <View style={[styles.inputRow, { backgroundColor: ts.bg.surface, borderColor: sourceNeedsAttention ? ts.border.error20 : ts.border.card }]}>
                <View style={[styles.inputIcon, { backgroundColor: ts.raw.purple100 }]}>
                  <Briefcase size={14} color={ts.text.primary} />
                </View>
                <TextInput
                  value={source}
                  onChangeText={setSource}
                  placeholder="e.g. Employer, Client, Investment, Gift"
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  accessibilityLabel="Income source"
                  style={[styles.input, Typography.bodyBold, { color: ts.text.onSurface }]}
                />
                {source.length > 0 ? (
                  <ScalePressable
                    haptic={false}
                    accessibilityRole="button"
                    accessibilityLabel="Clear income source"
                    onPress={clearSource}
                    style={styles.clearButton}
                  >
                    <X size={16} color={ts.text.onSurfaceVariant} />
                  </ScalePressable>
                ) : null}
              </View>
            </View>

            <View style={styles.fieldBlock}>
              <View style={styles.fieldLabelRow}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Category</Text>
                <Text style={[Typography.micro, { color: categoryValid ? ts.text.primary : ts.raw.warning }]}>
                  {categoryValid ? 'Selected' : 'Required'}
                </Text>
              </View>
              <ScalePressable
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={selectedCategory ? `Category, ${selectedCategory.title}. Change category` : 'Select category'}
                onPress={openCategory}
                style={[styles.categoryChip, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}
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

            <View style={[styles.card, styles.dateCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.dateLeft}>
                <View style={[styles.dateIcon, { backgroundColor: ts.raw.purple100 }]}>
                  <Calendar size={16} color={ts.text.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>Date & Time</Text>
                  <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{dateLabel}</Text>
                </View>
              </View>
              <View style={[styles.autoPill, { backgroundColor: ts.bg.elevated }]}>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Auto</Text>
              </View>
            </View>

            <View style={styles.fieldBlock}>
              <View style={styles.fieldLabelRow}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Note</Text>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Optional</Text>
              </View>
              <View style={[styles.inputRow, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add deposit notes or invoice #..."
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  accessibilityLabel="Note, optional"
                  style={[styles.input, Typography.bodyRegular, { color: ts.text.onSurface }]}
                />
              </View>
            </View>

            <View style={[styles.card, styles.recurringCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleLeft}>
                  <View style={[styles.toggleIcon, { backgroundColor: ts.raw.purple100 }]}>
                    <Repeat size={14} color={ts.text.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Recurring Income</Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Shared S-15 recurring model</Text>
                  </View>
                </View>
                <ToggleSwitch
                  value={isRecurring}
                  onToggle={() => setRecurring(value => !value)}
                  label="Recurring income"
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
                          style={[styles.frequencyButton, { backgroundColor: selected ? ts.bg.primary : ts.bg.screen }]}
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

            <View style={styles.keypadSection}>
              <VirtualNumpad onKeyPress={handleKeyPress} />
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.footer} pointerEvents="box-none">
          <LinearGradient
            colors={[`${ts.bg.screen}00`, ts.bg.screen]}
            locations={[0, 0.6]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={[styles.footerContent, { paddingBottom: Math.max(Spacing.s5, insets.bottom) }]}>
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
      </KeyboardAvoidingView>

      <CategoryPickerSheet
        visible={isCategoryPickerVisible}
        categories={categories}
        selectedId={selectedCategory?.id}
        flowType="income"
        originLabel={source.trim() || undefined}
        originAmount={parsedAmount > 0 ? formatCurrency(parsedAmount, selectedCurrency) : undefined}
        onSelect={(category) => { setSelectedCategory(category); setCategoryPickerVisible(false); }}
        onClose={() => setCategoryPickerVisible(false)}
      />

      {duplicateWarning ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicateWarning}
          incoming={{
            merchant: source.trim(),
            amount: parsedAmount,
            currency: selectedCurrency,
            category: selectedCategory?.id ?? '',
            type: 'income',
            date: enteredAt,
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
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s2,
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
    paddingHorizontal: Spacing.s3,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { paddingHorizontal: Spacing.s5, paddingTop: Spacing.s2, paddingBottom: 168, gap: Spacing.s3 },
  stack: { gap: Spacing.s3 },
  card: { borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s4, gap: Spacing.s2 },
  heroCard: { borderRadius: Radii.xl, borderWidth: 2, padding: Spacing.s5 },
  // Pair renders the source, category and note labels above a single surface
  // box, so each field is a label row plus its own bordered surface.
  fieldBlock: { gap: Spacing.s1 },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s1,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 },
  inflowTag: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 1,
    borderRadius: Radii.full,
    borderWidth: 1,
    flexShrink: 0,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.s2 },
  amountValue: { fontVariant: ['tabular-nums'], marginLeft: Spacing.s1 },
  cursor: { width: 2, height: CURSOR_HEIGHT, borderRadius: 1, marginLeft: 2 },
  currencySection: { gap: Spacing.s2, paddingHorizontal: Spacing.s1 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s2,
    minHeight: 44,
  },
  inputIcon: { width: 28, height: 28, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: { flex: 1, minWidth: 0, paddingVertical: Spacing.s2 },
  clearButton: { paddingHorizontal: Spacing.s2, minHeight: 44, justifyContent: 'center' },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s3,
    minHeight: 64,
  },
  categoryIcon: { width: 40, height: 40, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, flexShrink: 0 },
  dateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  dateIcon: { width: 32, height: 32, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  autoPill: { paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.full },
  recurringCard: { gap: Spacing.s3 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  toggleIcon: { width: 28, height: 28, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
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
    paddingTop: Spacing.s2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  frequencyOptions: { flexDirection: 'row', gap: Spacing.s2 },
  frequencyButton: { paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s2, borderRadius: Radii.sm, minHeight: 44, justifyContent: 'center' },
  keypadSection: { marginTop: Spacing.s2 },
  errorBox: { borderWidth: 1, borderRadius: Radii.md, padding: Spacing.s3, gap: Spacing.s2 },
  retry: { minHeight: 44, justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footerContent: { paddingHorizontal: Spacing.s4, paddingTop: Spacing.s6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3 },
  cancelSlot: { width: '32%' },
  saveSlot: { flex: 1 },
});
