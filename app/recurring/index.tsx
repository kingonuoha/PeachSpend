import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { differenceInCalendarDays } from 'date-fns';
import { v4 as uuid } from 'uuid';
import {
  ArrowLeft, ChevronDown, Info, Plus, RefreshCw, Repeat, Trash2, TriangleAlert, X,
} from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { useToast } from '../../components/ui/ToastProvider';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency } from '../../utils/currency';
import {
  categoryService,
  recurringDataService,
} from '../../services/DataServices';
import type {
  CategoryRecord,
  RecurrenceInterval,
  RecurringDraft,
  RecurringRecord,
  RecurringType,
} from '../../services/DataServices';

// S-15 Recurring Expenses. Rebuilt as the single owner of recurring template
// create, edit, display and delete (FR-15.1-FR-15.3). Reads and writes go
// through the typed recurring contract, never screen SQL, and creation uses the
// same RecurringDraft boundary as the S-09/S-11 Repeats shortcut, so there is no
// divergent scheduling path. X-15.

const MAX_CONTENT_WIDTH = 640;
const CLOSE_SIZE = 32;
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
const SHEET_MAX_HEIGHT = 760;
const UPCOMING_WINDOW_DAYS = 7;

const INTERVALS: { value: RecurrenceInterval; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

// Monday-first weekday chips. Values match the 0-6 day index stored in
// recurrence_days and understood by the shared computeNextDueDate rule.
const WEEK_DAYS: { value: number; label: string; name: string }[] = [
  { value: 1, label: 'M', name: 'Monday' },
  { value: 2, label: 'T', name: 'Tuesday' },
  { value: 3, label: 'W', name: 'Wednesday' },
  { value: 4, label: 'T', name: 'Thursday' },
  { value: 5, label: 'F', name: 'Friday' },
  { value: 6, label: 'S', name: 'Saturday' },
  { value: 0, label: 'S', name: 'Sunday' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type FilterValue = 'all' | 'expense' | 'income' | 'upcoming';

interface FormState {
  mode: 'add' | 'edit';
  id: string | null;
  type: RecurringType;
  merchant: string;
  amount: string;
  categoryId: string;
  interval: RecurrenceInterval;
  recurrenceDays: number[];
}

interface FieldError {
  field: 'merchant' | 'amount' | 'category' | 'custom_days' | 'save';
  message: string;
}

function categoryTint(color?: string): string {
  return color ? `${color}1F` : 'transparent';
}

function intervalDetail(record: RecurringRecord): string {
  if (record.interval === 'daily') return 'Every day';
  if (record.interval === 'weekly') return 'Every week';
  if (record.interval === 'monthly') return 'Every month';
  if (record.recurrenceDays.length > 0) {
    return `Every ${record.recurrenceDays.map((day) => DAY_NAMES[day]).join(', ')}`;
  }
  return 'Custom schedule';
}

function nextDueLabel(nextDueDate: number, now: number): string {
  const days = differenceInCalendarDays(new Date(nextDueDate), new Date(now));
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function emptyForm(categoryId: string): FormState {
  return {
    mode: 'add',
    id: null,
    type: 'expense',
    merchant: '',
    amount: '',
    categoryId,
    interval: 'monthly',
    recurrenceDays: [],
  };
}

export default function RecurringScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const { showToast } = useToast();
  const { currency, getCurrencySymbol, convertAmount } = useSettings();

  const [templates, setTemplates] = useState<RecurringRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const [listState, categoryList] = await Promise.all([
        recurringDataService.list(),
        categoryService.list(),
      ]);
      setTemplates(listState.status === 'ready' ? listState.templates : []);
      setCategories(categoryList);
      setNow(Date.now());
    } catch {
      setLoadError('Recurring templates could not load. Your data stays on this device.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the initial load does not setState synchronously inside the
    // effect body; the cleanup cancels a pending load on unmount.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const categoryById = useMemo(() => {
    const map = new Map<string, CategoryRecord>();
    categories.forEach((category) => map.set(category.id, category));
    return map;
  }, [categories]);

  const captureCategories = useMemo<CaptureCategory[]>(
    () => categories.map((category) => ({ id: category.id, title: category.title, icon_name: category.iconName })),
    [categories],
  );

  const filteredTemplates = useMemo(() => {
    if (filter === 'expense') return templates.filter((record) => record.type === 'expense');
    if (filter === 'income') return templates.filter((record) => record.type === 'income');
    if (filter === 'upcoming') {
      const horizon = now + UPCOMING_WINDOW_DAYS * 86400000;
      return templates.filter((record) => record.nextDueDate <= horizon);
    }
    return templates;
  }, [templates, filter, now]);

  const summary = useMemo(() => {
    const expenses = templates.filter((record) => record.type === 'expense');
    const income = templates.filter((record) => record.type === 'income');
    const total = expenses.reduce((sum, record) => sum + convertAmount(record.amount, record.currency).amount, 0);
    return { total, expenseCount: expenses.length, incomeCount: income.length };
  }, [templates, convertAmount]);

  const openAdd = useCallback(() => {
    setFieldError(null);
    setForm(emptyForm(categories[0]?.id ?? ''));
  }, [categories]);

  const openEdit = useCallback((record: RecurringRecord) => {
    setFieldError(null);
    setForm({
      mode: 'edit',
      id: record.id,
      type: record.type,
      merchant: record.merchant,
      amount: String(record.amount),
      categoryId: record.category,
      interval: record.interval,
      recurrenceDays: record.recurrenceDays,
    });
  }, []);

  const closeForm = useCallback(() => {
    setForm(null);
    setFieldError(null);
    setDeleteOpen(false);
  }, []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  const showHelp = useCallback(() => {
    showToast('Recurring templates generate automatically when due. Repeats on an expense or income uses the same schedule model.', 'info');
  }, [showToast]);

  const validate = useCallback((current: FormState): FieldError | null => {
    if (!current.merchant.trim()) return { field: 'merchant', message: 'Merchant or description is required.' };
    const amount = Number.parseFloat(current.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { field: 'amount', message: 'Enter an amount greater than zero.' };
    if (!current.categoryId) return { field: 'category', message: 'Choose a category.' };
    if (current.interval === 'custom' && current.recurrenceDays.length === 0) {
      return { field: 'custom_days', message: 'Choose at least one day for a custom schedule.' };
    }
    return null;
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    const validationError = validate(form);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    const draft: RecurringDraft = {
      merchant: form.merchant.trim(),
      amount: Number.parseFloat(form.amount),
      currency,
      category: form.categoryId,
      note: '',
      interval: form.interval,
      recurrenceDays: form.interval === 'custom' ? form.recurrenceDays : undefined,
      type: form.type,
    };

    setSaving(true);
    setFieldError(null);
    try {
      const result = form.mode === 'edit' && form.id
        ? await recurringDataService.update(form.id, draft)
        : await recurringDataService.create(draft, uuid());

      if (result.status === 'invalid') {
        setFieldError({ field: result.field === 'custom_days' ? 'custom_days' : result.field === 'amount' ? 'amount' : result.field === 'merchant' ? 'merchant' : 'category', message: 'Check this field and try again.' });
        return;
      }
      if (result.status === 'not_found') {
        setFieldError({ field: 'save', message: 'This template no longer exists.' });
        return;
      }

      closeForm();
      await load(false);
      showToast(form.mode === 'edit' ? `Updated "${draft.merchant}"` : `Added "${draft.merchant}"`, 'success');
    } catch {
      setFieldError({ field: 'save', message: 'Could not save the template. Please try again.' });
    } finally {
      setSaving(false);
    }
  }, [form, saving, validate, currency, closeForm, load, showToast]);

  const confirmDelete = useCallback(async () => {
    if (!form?.id || deleting) return;
    setDeleting(true);
    try {
      const result = await recurringDataService.delete(form.id);
      setDeleteOpen(false);
      closeForm();
      await load(false);
      if (result.status === 'deleted') showToast('Template deleted', 'success');
      else showToast('This template no longer exists.', 'info');
    } catch {
      showToast('Could not delete the template. Please try again.', 'error');
    } finally {
      setDeleting(false);
    }
  }, [form, deleting, closeForm, load, showToast]);

  const deleteTarget = form?.mode === 'edit' && form.id
    ? templates.find((record) => record.id === form.id)
    : undefined;

  const sheetMaxHeight = Math.min(height * 0.9, SHEET_MAX_HEIGHT);
  const editing = form?.mode === 'edit';
  const currencySymbol = getCurrencySymbol(currency);
  const fieldErrorFor = (field: FieldError['field']) => (fieldError?.field === field ? fieldError.message : null);
  const generalError = fieldError?.field === 'save' ? fieldError.message : null;

  return (
    <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
      <View style={styles.header}>
        <ScalePressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={4}
          style={[styles.headerCircle, { backgroundColor: ts.bg.card, borderColor: ts.raw.outline }]}
        >
          <ArrowLeft size={18} color={ts.raw.onSurface} />
        </ScalePressable>
        <View style={styles.headerTitle}>
          <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>Recurring</Text>
          <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Cash Flow Automation</Text>
        </View>
        <ScalePressable
          onPress={showHelp}
          accessibilityRole="button"
          accessibilityLabel="Recurring schedule help"
          hitSlop={4}
          style={[styles.headerCircle, { backgroundColor: ts.bg.card, borderColor: ts.raw.outline }]}
        >
          <Info size={16} color={ts.raw.onSurfaceVariant} />
        </ScalePressable>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={ts.raw.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.centerBox}>
          <LuminousCard variant="low" style={styles.messageCard}>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Recurring templates could not load</Text>
            <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s1 }]}>
              Your data stays on this device. Try again to read your schedules.
            </Text>
            <PeachButton
              title="Retry"
              onPress={() => void load()}
              variant="primary"
              size="sm"
              style={{ marginTop: Spacing.s3 }}
            />
          </LuminousCard>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <LuminousCard
            variant="low"
            style={[styles.infoBanner, { backgroundColor: ts.isDark ? ts.raw.surface : ts.bg.primary5, borderColor: ts.raw.primary + '33' }]}
          >
            <View style={[styles.infoChip, { backgroundColor: ts.raw.purple100 }]}>
              <RefreshCw size={16} color={ts.raw.primary} />
            </View>
            <View style={styles.infoText}>
              <View style={styles.infoTitleRow}>
                <Text style={[Typography.captionBold, { color: ts.isDark ? ts.raw.primary : ts.raw.onSurface }]}>
                  Silent Auto-Generation
                </Text>
                <View style={[styles.infoBadge, { backgroundColor: ts.raw.purple100 }]}>
                  <Text style={[Typography.micro, { color: ts.raw.primary }]}>Active</Text>
                </View>
              </View>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, lineHeight: 17 }]}>
                Auto-generation runs in the background. When an item is due, Peach commits a draft entry without double-counting your balance.
              </Text>
            </View>
          </LuminousCard>

          <LuminousCard variant="high" style={[styles.summaryCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
            <View style={styles.summaryLeft}>
              <Text style={[Typography.micro, styles.summaryLabel, { color: ts.raw.onSurfaceVariant }]}>RECURRING COMMITMENTS</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[Typography.displayMd, { color: ts.raw.onSurface }]}>
                {formatCurrency(summary.total, currency)}
              </Text>
            </View>
            <View style={styles.summaryRight}>
              <View style={[styles.summaryBadge, { backgroundColor: ts.raw.purple100 }]}>
                <Text style={[Typography.micro, { color: ts.raw.primary }]}>{pluralize(templates.length, 'Template', 'Templates')}</Text>
              </View>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s1 }]}>
                {`${summary.expenseCount} Exp · ${summary.incomeCount} Inc`}
              </Text>
            </View>
          </LuminousCard>

          <View style={styles.filterRow}>
            {([
              { value: 'all' as const, label: `All (${templates.length})` },
              { value: 'expense' as const, label: 'Expenses' },
              { value: 'income' as const, label: 'Income' },
              { value: 'upcoming' as const, label: 'Upcoming' },
            ]).map((option) => {
              const selected = filter === option.value;
              return (
                <ScalePressable
                  key={option.value}
                  haptic={false}
                  onPress={() => setFilter(option.value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  style={[
                    styles.filterPill,
                    selected
                      ? { backgroundColor: ts.raw.primary, borderColor: ts.raw.primary }
                      : { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline },
                  ]}
                >
                  <Text numberOfLines={1} style={[Typography.micro, { color: selected ? '#FFFFFF' : ts.raw.onSurfaceVariant }]}>
                    {option.label}
                  </Text>
                </ScalePressable>
              );
            })}
          </View>

          {templates.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyChip, { backgroundColor: ts.raw.purple100 }]}>
                <Repeat size={30} color={ts.raw.primary} />
              </View>
              <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>No Recurring Templates Yet</Text>
              <Text style={[Typography.labelMd, styles.emptyBody, { color: ts.raw.onSurfaceVariant }]}>
                Add recurring expenses or income to automate your cash flow. Items marked as Repeats when adding an expense or income also appear here.
              </Text>
              <PeachButton
                title="Add Your First Template"
                onPress={openAdd}
                variant="primary"
                size="sm"
                icon={<Plus size={16} color="#FFFFFF" strokeWidth={2.5} />}
              />
            </View>
          ) : filteredTemplates.length === 0 ? (
            <View style={styles.emptyFilter}>
              <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, textAlign: 'center' }]}>
                No templates in this filter.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filteredTemplates.map((record) => {
                const category = categoryById.get(record.category);
                const isIncome = record.type === 'income';
                return (
                  <ScalePressable
                    key={record.id}
                    onPress={() => openEdit(record)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${record.merchant}`}
                    style={[styles.card, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
                  >
                    <View style={styles.cardRow}>
                      <View style={styles.cardLeft}>
                        <View style={[styles.categoryChip, { backgroundColor: categoryTint(category?.color) }]}>
                          <CategoryGlyph iconName={category?.iconName} size={20} color={category?.color ?? ts.raw.onSurfaceVariant} />
                        </View>
                        <View style={styles.cardText}>
                          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                            {record.merchant}
                          </Text>
                          <View style={styles.cardMetaRow}>
                            <Text numberOfLines={1} style={[Typography.micro, styles.cardMeta, { color: ts.raw.onSurfaceVariant }]}>
                              {intervalDetail(record)}
                            </Text>
                            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}> · </Text>
                            <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>
                              {nextDueLabel(record.nextDueDate, now)}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.cardRight}>
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                          style={[Typography.labelBold, { color: isIncome ? ts.raw.successText : ts.raw.onSurface }]}
                        >
                          {isIncome ? `+${formatCurrency(record.amount, record.currency)}` : formatCurrency(record.amount, record.currency)}
                        </Text>
                        <Text style={[Typography.micro, styles.cardInterval, { color: ts.raw.onSurfaceVariant }]}>
                          {record.interval}
                        </Text>
                      </View>
                    </View>
                  </ScalePressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {!loading && !loadError ? (
        <View pointerEvents="box-none" style={[styles.ctaWrap, { paddingBottom: insets.bottom + Spacing.s4 }]}>
          <View pointerEvents="box-none" style={styles.ctaInner}>
            <PeachButton
              title="Add Recurring"
              onPress={openAdd}
              variant="primary"
              size="lg"
              fullWidth
              icon={<Plus size={18} color="#FFFFFF" strokeWidth={2.5} />}
            />
          </View>
        </View>
      ) : null}

      <Modal
        visible={form !== null}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={closeForm}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable onPress={closeForm} accessibilityRole="button" accessibilityLabel="Dismiss template editor" style={[styles.backdrop, { backgroundColor: ts.bg.overlay }]} />
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: ts.raw.surface, borderTopColor: ts.raw.outline, maxHeight: sheetMaxHeight }]}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: ts.border.subtle }]}>
              <View style={styles.sheetHeaderText}>
                <Text accessibilityRole="header" numberOfLines={1} style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>
                  {editing ? 'Edit Recurring Template' : 'New Recurring Template'}
                </Text>
                <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                  Automated Schedule &amp; Budget Link
                </Text>
              </View>
              <ScalePressable
                onPress={closeForm}
                accessibilityRole="button"
                accessibilityLabel="Close template editor"
                hitSlop={CLOSE_HIT_SLOP}
                style={[styles.closeCircle, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}
              >
                <X size={15} color={ts.raw.onSurfaceVariant} />
              </ScalePressable>
            </View>

            {form ? (
              <>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.sheetBody}
                  contentContainerStyle={styles.sheetBodyContent}
                >
                  <View style={[styles.segment, { backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.elevated }]} accessibilityRole="radiogroup">
                    {(['expense', 'income'] as RecurringType[]).map((type) => {
                      const selected = form.type === type;
                      return (
                        <ScalePressable
                          key={type}
                          haptic={false}
                          onPress={() => setForm((current) => (current ? { ...current, type } : current))}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={type === 'expense' ? 'Expense' : 'Income'}
                          style={[styles.segmentCell, selected ? { backgroundColor: type === 'income' ? ts.raw.success : ts.bg.card } : null]}
                        >
                          <Text style={[Typography.labelBold, { color: selected ? (type === 'income' ? ts.text.white : ts.raw.primary) : ts.raw.onSurfaceVariant }]}>
                            {type === 'expense' ? 'Expense' : 'Income'}
                          </Text>
                        </ScalePressable>
                      );
                    })}
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>Merchant / Description</Text>
                    <TextInput
                      value={form.merchant}
                      onChangeText={(value) => {
                        setForm((current) => (current ? { ...current, merchant: value } : current));
                        if (fieldError?.field === 'merchant') setFieldError(null);
                      }}
                      placeholder="e.g. Netflix, Rent, Salary"
                      placeholderTextColor={ts.raw.onSurfaceVariant}
                      selectionColor={ts.raw.primary}
                      accessibilityLabel="Merchant or description"
                      returnKeyType="next"
                      style={[styles.input, { backgroundColor: ts.bg.low, borderColor: fieldErrorFor('merchant') ? ts.raw.danger : ts.raw.outline, color: ts.raw.onSurface }]}
                    />
                    {fieldErrorFor('merchant') ? (
                      <Text accessibilityLiveRegion="polite" style={[Typography.micro, styles.validation, { color: ts.raw.danger }]}>
                        {fieldErrorFor('merchant')}
                      </Text>
                    ) : null}
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                      {`Amount (${currencySymbol} ${currency})`}
                    </Text>
                    <View style={[styles.amountRow, { backgroundColor: ts.bg.low, borderColor: fieldErrorFor('amount') ? ts.raw.danger : ts.raw.outline }]}>
                      <Text style={[Typography.bodyBold, { color: ts.raw.onSurfaceVariant }]}>{currencySymbol}</Text>
                      <TextInput
                        value={form.amount}
                        onChangeText={(value) => {
                          setForm((current) => (current ? { ...current, amount: value } : current));
                          if (fieldError?.field === 'amount') setFieldError(null);
                        }}
                        placeholder="0.00"
                        placeholderTextColor={ts.raw.onSurfaceVariant}
                        selectionColor={ts.raw.primary}
                        keyboardType="decimal-pad"
                        accessibilityLabel="Amount"
                        style={[styles.amountInput, { color: ts.raw.onSurface }]}
                      />
                    </View>
                    {fieldErrorFor('amount') ? (
                      <Text accessibilityLiveRegion="polite" style={[Typography.micro, styles.validation, { color: ts.raw.danger }]}>
                        {fieldErrorFor('amount')}
                      </Text>
                    ) : null}
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>Category</Text>
                    <ScalePressable
                      onPress={() => setPickerOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Choose category"
                      style={[
                        styles.selectorRow,
                        {
                          backgroundColor: ts.bg.low,
                          borderColor: fieldErrorFor('category') ? ts.raw.danger : ts.raw.outline,
                        },
                      ]}
                    >
                      {form.categoryId ? (
                        <View style={[styles.selectorChip, { backgroundColor: categoryTint(categoryById.get(form.categoryId)?.color) }]}>
                          <CategoryGlyph
                            iconName={categoryById.get(form.categoryId)?.iconName}
                            size={18}
                            color={categoryById.get(form.categoryId)?.color ?? ts.raw.onSurfaceVariant}
                          />
                        </View>
                      ) : null}
                      <Text numberOfLines={1} style={[Typography.labelBold, styles.selectorLabel, { color: form.categoryId ? ts.raw.onSurface : ts.raw.onSurfaceVariant }]}>
                        {categoryById.get(form.categoryId)?.title ?? 'Choose a category'}
                      </Text>
                      <ChevronDown size={16} color={ts.raw.onSurfaceVariant} />
                    </ScalePressable>
                    {fieldErrorFor('category') ? (
                      <Text accessibilityLiveRegion="polite" style={[Typography.micro, styles.validation, { color: ts.raw.danger }]}>
                        {fieldErrorFor('category')}
                      </Text>
                    ) : null}
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>Frequency</Text>
                    <View style={[styles.frequencySegment, { backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.elevated }]} accessibilityRole="radiogroup">
                      {INTERVALS.map((option) => {
                        const selected = form.interval === option.value;
                        return (
                          <ScalePressable
                            key={option.value}
                            haptic={false}
                            onPress={() => setForm((current) => (current ? { ...current, interval: option.value } : current))}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            accessibilityLabel={option.label}
                            style={[styles.frequencyCell, selected ? { backgroundColor: ts.bg.card } : null]}
                          >
                            <Text numberOfLines={1} style={[Typography.labelMd, { color: selected ? ts.raw.primary : ts.raw.onSurfaceVariant }]}>
                              {option.label}
                            </Text>
                          </ScalePressable>
                        );
                      })}
                    </View>

                    {form.interval === 'custom' ? (
                      <View style={[styles.customPanel, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
                        <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginBottom: Spacing.s2 }]}>Repeats on:</Text>
                        <View style={styles.dayRow} accessibilityRole="radiogroup">
                          {WEEK_DAYS.map((day) => {
                            const selected = form.recurrenceDays.includes(day.value);
                            return (
                              <ScalePressable
                                key={day.value}
                                haptic={false}
                                onPress={() => {
                                  setForm((current) => {
                                    if (!current) return current;
                                    const days = current.recurrenceDays.includes(day.value)
                                      ? current.recurrenceDays.filter((value) => value !== day.value)
                                      : [...current.recurrenceDays, day.value].sort();
                                    return { ...current, recurrenceDays: days };
                                  });
                                  if (fieldError?.field === 'custom_days') setFieldError(null);
                                }}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                                accessibilityLabel={day.name}
                                style={[
                                  styles.dayChip,
                                  selected
                                    ? { backgroundColor: ts.raw.primary, borderColor: ts.raw.primary }
                                    : { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline },
                                ]}
                              >
                                <Text style={[Typography.micro, { color: selected ? '#FFFFFF' : ts.raw.onSurfaceVariant }]}>{day.label}</Text>
                              </ScalePressable>
                            );
                          })}
                        </View>
                        {fieldErrorFor('custom_days') ? (
                          <Text accessibilityLiveRegion="polite" style={[Typography.micro, styles.validation, { color: ts.raw.danger }]}>
                            {fieldErrorFor('custom_days')}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  {generalError ? (
                    <View style={[styles.generalError, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}>
                      <TriangleAlert size={14} color={ts.raw.danger} />
                      <Text accessibilityLiveRegion="polite" style={[Typography.micro, styles.generalErrorText, { color: ts.raw.danger }]}>
                        {generalError}
                      </Text>
                    </View>
                  ) : null}
                </ScrollView>

                <View style={[styles.sheetFooter, { borderTopColor: ts.border.subtle }]}>
                  <PeachButton
                    title="Save Template"
                    onPress={() => void save()}
                    variant="primary"
                    size="lg"
                    isLoading={saving}
                    disabled={saving}
                    style={styles.footerPrimary}
                  />
                  {editing ? (
                    <PeachButton
                      title="Delete"
                      onPress={() => setDeleteOpen(true)}
                      variant="destructive"
                      size="lg"
                      disabled={saving}
                      icon={<Trash2 size={14} color={ts.raw.danger} />}
                    />
                  ) : null}
                  <PeachButton
                    title="Cancel"
                    onPress={closeForm}
                    variant="quiet"
                    size="lg"
                    disabled={saving}
                  />
                </View>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={deleteOpen}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setDeleteOpen(false)}
      >
        <View style={styles.confirmRoot}>
          <Pressable onPress={() => setDeleteOpen(false)} accessibilityRole="button" accessibilityLabel="Dismiss delete confirmation" style={[styles.backdrop, { backgroundColor: ts.bg.overlay }]} />
          <View
            accessibilityViewIsModal
            style={[styles.confirmCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            <View style={[styles.confirmIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <Trash2 size={22} color={ts.raw.danger} />
            </View>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface, textAlign: 'center' }]}>Delete Recurring Template?</Text>
            <Text style={[Typography.labelMd, styles.confirmBody, { color: ts.raw.onSurfaceVariant }]}>
              {`Deleting "${deleteTarget?.merchant ?? ''}" stops future automated drafts. Existing ledger entries will remain untouched.`}
            </Text>
            <View style={styles.confirmActions}>
              <PeachButton
                title="Delete Template"
                onPress={() => void confirmDelete()}
                variant="destructive"
                size="lg"
                fullWidth
                isLoading={deleting}
                disabled={deleting}
              />
              <PeachButton
                title="Cancel"
                onPress={() => setDeleteOpen(false)}
                variant="quiet"
                size="lg"
                fullWidth
                disabled={deleting}
              />
            </View>
          </View>
        </View>
      </Modal>

      <CategoryPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={captureCategories}
        selectedId={form?.categoryId}
        onSelect={(category) => {
          setForm((current) => (current ? { ...current, categoryId: category.id } : current));
          if (fieldError?.field === 'category') setFieldError(null);
          setPickerOpen(false);
        }}
        flowType={form?.type ?? 'expense'}
        originLabel={form?.merchant.trim() || undefined}
        originAmount={form?.amount ? formatCurrency(Number.parseFloat(form.amount), currency) : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s2,
    paddingBottom: Spacing.s2,
  },
  headerCircle: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s5,
  },
  messageCard: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s2,
    paddingBottom: 132,
    gap: Spacing.s4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.lg,
  },
  infoChip: {
    width: 32,
    height: 32,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.s1,
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  infoBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 1,
    borderRadius: Radii.full,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    padding: Spacing.s4,
    borderRadius: Radii.lg,
  },
  summaryLeft: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.s1,
  },
  summaryLabel: {
    letterSpacing: 0.6,
  },
  summaryRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  summaryBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
  },
  filterPill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.s3,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.s7,
    paddingHorizontal: Spacing.s4,
    gap: Spacing.s2,
  },
  emptyChip: {
    width: 64,
    height: 64,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s2,
  },
  emptyBody: {
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: Spacing.s2,
  },
  emptyFilter: {
    paddingVertical: Spacing.s6,
  },
  list: {
    gap: Spacing.s2,
  },
  card: {
    padding: Spacing.s3,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    minHeight: 44,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    flex: 1,
    minWidth: 0,
  },
  categoryChip: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMeta: {
    flexShrink: 1,
  },
  cardRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  cardInterval: {
    textTransform: 'capitalize',
  },
  ctaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.s5,
  },
  ctaInner: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  sheetHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  closeCircle: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sheetBody: {
    flexShrink: 1,
  },
  sheetBodyContent: {
    padding: Spacing.s5,
    gap: Spacing.s4,
  },
  segment: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radii.full,
  },
  segmentCell: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
  },
  frequencySegment: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radii.sm,
  },
  frequencyCell: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  fieldLabel: {
    marginBottom: Spacing.s2,
  },
  input: {
    minHeight: 44,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s4,
    ...Typography.bodyMd,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    minHeight: 44,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s4,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.s2,
    ...Typography.bodyBold,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    minHeight: 48,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s3,
  },
  selectorChip: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorLabel: {
    flex: 1,
    minWidth: 0,
  },
  customPanel: {
    marginTop: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
  },
  dayChip: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  validation: {
    marginTop: Spacing.s1,
  },
  generalError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  generalErrorText: {
    flex: 1,
    minWidth: 0,
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    padding: Spacing.s4,
    borderTopWidth: 1,
  },
  footerPrimary: {
    flex: 1,
  },
  confirmRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.s5,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s5,
    alignItems: 'center',
  },
  confirmIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s3,
  },
  confirmBody: {
    textAlign: 'center',
    marginTop: Spacing.s2,
    lineHeight: 18,
  },
  confirmActions: {
    width: '100%',
    gap: Spacing.s2,
    marginTop: Spacing.s5,
  },
});
