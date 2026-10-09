import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  Pencil,
  Receipt,
  ScanLine,
  Share2,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react-native';

import { CategoryTints, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { PeachButton } from '../../components/ui/PeachButton';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { useExpenseDetail, type ExpenseCategoryMeta } from '../../hooks/useExpenseDetail';
import type { ExpenseRecordOrigin } from '../../data/ExpenseDetail';
import type { Expense } from '../../types/database';
import { formatCurrency } from '../../utils/currency';

const MASK = '••••';
const NOTE_MAX = 140;
const MAX_CONTENT_WIDTH = 640;
// The canonical dot rail shows one dot per record. Real ledgers can hold many
// more, so the rail is windowed to a fixed 5 dots that slide with the active
// record instead of rendering an unbounded row.
const MAX_DOTS = 5;

type DetailOrigin = 'home' | 'insights' | 'chat' | 'notification';

const ORIGIN_ROUTES: Record<DetailOrigin, string> = {
  home: '/(tabs)',
  insights: '/(tabs)/analytics',
  chat: '/chat',
  notification: '/notifications',
};

const ORIGIN_LABELS: Record<DetailOrigin, string> = {
  home: 'Home',
  insights: 'Insights',
  chat: 'Chat',
  notification: 'Notifications',
};

const ORIGIN_LABELS_CAPTURE: Record<ExpenseRecordOrigin, string> = {
  auto_capture: 'Auto-Capture',
  scanned: 'Receipt Scan',
  manual: 'Manual Entry',
  unknown: 'Unknown Source',
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseOrigin(value: string | undefined): DetailOrigin {
  return value === 'insights' || value === 'chat' || value === 'notification' ? value : 'home';
}

function OriginGlyph({ origin, color, size = 13 }: { origin: ExpenseRecordOrigin; color: string; size?: number }) {
  if (origin === 'auto_capture') return <Zap size={size} color={color} />;
  if (origin === 'scanned') return <ScanLine size={size} color={color} />;
  if (origin === 'manual') return <Pencil size={size} color={color} />;
  return <HelpCircle size={size} color={color} />;
}

function SwipeDots({ total, current }: { total: number; current: number }) {
  const ts = useThemeStyles();
  const shown = Math.min(total, MAX_DOTS);
  const start = total > shown ? Math.min(Math.max(current - Math.floor(shown / 2), 0), total - shown) : 0;
  const indexes = Array.from({ length: shown }, (_, offset) => start + offset);
  return (
    <View style={styles.dotsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {indexes.map(index => {
        const active = index === current;
        return (
          <View
            key={index}
            style={[
              styles.dot,
              active ? styles.dotActive : null,
              { backgroundColor: active ? ts.raw.primary : ts.raw.onSurfaceVariant + '66' },
            ]}
          />
        );
      })}
    </View>
  );
}

export default function ExpenseDetailScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings, currency, convertAmount, updateSetting } = useSettings();
  const params = useLocalSearchParams<{ id?: string; origin?: string; ids?: string }>();

  const expenseId = firstParam(params.id) ?? '';
  const origin = parseOrigin(firstParam(params.origin));
  const idsParam = firstParam(params.ids);
  const orderedIds = useMemo(
    () => (idsParam ? idsParam.split(',').filter(Boolean) : undefined),
    [idsParam],
  );

  const {
    records,
    categoryOptions,
    categoryMeta,
    initialOrigin,
    initialIndex,
    loading,
    missing,
    failed,
    retry,
    editCategory,
    remove,
    saveNote,
    setReimbursable,
    originOf,
  } = useExpenseDetail(expenseId, orderedIds);

  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const listRef = useRef<FlatList<Expense>>(null);
  const [scrolledIndex, setScrolledIndex] = useState<number | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [learnedNotice, setLearnedNotice] = useState<{ id: string; title: string } | null>(null);
  const [actionFailedId, setActionFailedId] = useState<string | null>(null);

  const maxIndex = Math.max(records.length - 1, 0);
  const currentIndex = scrolledIndex === null ? initialIndex : Math.min(scrolledIndex, maxIndex);

  const retryDetail = useCallback(() => {
    setScrolledIndex(null);
    retry();
  }, [retry]);

  const pricesVisible = settings.prices_visible !== 'false';
  const active = records[currentIndex];
  const activeOrigin = active ? originOf(active) : initialOrigin;

  const categoryLabel = useCallback(
    (expense: Expense) => categoryMeta[expense.category]?.title ?? expense.category,
    [categoryMeta],
  );

  const returnToOrigin = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(ORIGIN_ROUTES[origin] as never);
  }, [router, origin]);

  const togglePrices = useCallback(() => {
    void updateSetting('prices_visible', pricesVisible ? 'false' : 'true');
  }, [updateSetting, pricesVisible]);

  const goToIndex = useCallback((index: number) => {
    if (index < 0 || index >= records.length) return;
    setScrolledIndex(index);
    listRef.current?.scrollToIndex({ index, animated: true });
  }, [records.length]);

  const onSettle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (contentWidth <= 0) return;
      const next = Math.round(event.nativeEvent.contentOffset.x / contentWidth);
      setScrolledIndex(Math.max(0, Math.min(next, records.length - 1)));
    },
    [contentWidth, records.length],
  );

  const handleShare = useCallback(async () => {
    const expense = records[currentIndex];
    if (!expense) return;
    const lines = [
      `Merchant: ${expense.merchant}`,
      `Amount: ${formatCurrency(expense.amount, expense.currency || currency)}`,
      `Category: ${categoryMeta[expense.category]?.title ?? expense.category}`,
      `Date: ${format(new Date(expense.date), 'MMMM dd, yyyy HH:mm')}`,
    ];
    if (expense.note) lines.push(`Note: ${expense.note}`);
    if (expense.is_reimbursable === 1) lines.push('Reimbursable: yes');
    if (expense.image_uri) lines.push('Receipt image attached');
    try {
      await Share.share({ message: lines.join('\n'), title: 'Expense Details' });
    } catch {
      // The user dismissed the OS share sheet; nothing to persist.
    }
  }, [records, currentIndex, categoryMeta, currency]);

  const handleSelectCategory = useCallback(
    async (category: CaptureCategory) => {
      setCategoryOpen(false);
      const expense = records[currentIndex];
      if (!expense) return;
      setActionFailedId(null);
      try {
        const result = await editCategory(expense.id, category.id);
        if (result.status === 'updated' && result.learned) {
          setLearnedNotice({ id: expense.id, title: category.title });
        }
      } catch {
        setActionFailedId(expense.id);
      }
    },
    [records, currentIndex, editCategory],
  );

  const confirmDelete = useCallback(async () => {
    const expense = records[currentIndex];
    if (!expense) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const result = await remove(expense.id);
      setDeleting(false);
      setDeleteOpen(false);
      if (result.status === 'deleted') {
        returnToOrigin();
      } else {
        retryDetail();
      }
    } catch {
      setDeleting(false);
      setDeleteFailed(true);
    }
  }, [records, currentIndex, remove, returnToOrigin, retryDetail]);

  const pricesText = pricesVisible ? null : MASK;
  const converted = active ? convertAmount(active.amount, active.currency || currency) : null;
  const activeAmountText = active && converted
    ? formatCurrency(converted.amount, currency)
    : '';

  const headerInner = (
    <View style={styles.appbarInner}>
      <ScalePressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={returnToOrigin}
        style={[styles.circle, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
      >
        <ChevronLeft size={22} color={ts.raw.onSurface} strokeWidth={2.2} />
      </ScalePressable>

      <View style={styles.appbarCenter}>
        <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
          {active ? categoryLabel(active) : 'Expense Record'}
        </Text>
        {active && records.length > 1 ? <SwipeDots total={records.length} current={currentIndex} /> : null}
      </View>

      {active ? (
        <View style={styles.appbarRight}>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel={pricesVisible ? 'Hide amounts' : 'Show amounts'}
            onPress={togglePrices}
            style={[styles.circle, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            {pricesVisible
              ? <Eye size={20} color={ts.raw.primary} strokeWidth={2} />
              : <EyeOff size={20} color={ts.raw.onSurfaceVariant} strokeWidth={2} />}
          </ScalePressable>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Share transaction"
            onPress={handleShare}
            style={[styles.circle, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            <Share2 size={19} color={ts.raw.onSurface} strokeWidth={2} />
          </ScalePressable>
        </View>
      ) : (
        <View style={styles.appbarSpacer} />
      )}
    </View>
  );

  const header = (
    <View
      style={[
        styles.appbar,
        { paddingTop: insets.top + Spacing.s2, borderBottomColor: ts.raw.outline, backgroundColor: ts.bg.screen },
      ]}
    >
      {headerInner}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
        {header}
        <View style={styles.stateWrap}>
          <ActivityIndicator color={ts.raw.primary} />
        </View>
      </View>
    );
  }

  if (missing || failed || !active) {
    const isMissing = missing && !failed;
    return (
      <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
        {header}
        <View style={styles.stateWrap}>
          <View style={[styles.stateIcon, { backgroundColor: isMissing ? ts.raw.warningContainer : ts.raw.dangerSoft }]}>
            <AlertTriangle size={26} color={isMissing ? ts.raw.warning : ts.raw.danger} />
          </View>
          <Text accessibilityRole="header" style={[Typography.headlineMd, styles.stateTitle, { color: ts.raw.onSurface }]}>
            {isMissing ? 'Record Not Found' : 'Could Not Load This Record'}
          </Text>
          <Text style={[Typography.bodyRegular, styles.stateBody, { color: ts.raw.onSurfaceVariant }]}>
            {isMissing
              ? 'This transaction may have been deleted, or it belongs to a different ledger.'
              : 'Something went wrong reading this transaction from your device.'}
          </Text>
          {failed ? (
            <View style={styles.stateActions}>
              <PeachButton title="Try again" variant="secondary" size="md" onPress={retryDetail} />
            </View>
          ) : null}
          <View style={styles.stateActions}>
            <PeachButton
              title={`Return to ${ORIGIN_LABELS[origin]}`}
              variant="outline"
              size="xl"
              fullWidth
              onPress={returnToOrigin}
              labelColor={ts.raw.primary}
              trailingIcon={<Check size={16} color={ts.raw.primary} strokeWidth={2.2} />}
              adjustsLabelFontSize
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
      {header}

      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          data={records}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: contentWidth, offset: contentWidth * index, index })}
          keyExtractor={item => item.id}
          onMomentumScrollEnd={onSettle}
          onScrollToIndexFailed={info => {
            listRef.current?.scrollToOffset({ offset: info.index * contentWidth, animated: true });
          }}
          windowSize={3}
          removeClippedSubviews={Platform.OS === 'android'}
          style={{ width: '100%' }}
          renderItem={({ item, index }) => (
            <DetailPage
              expense={item}
              index={index}
              total={records.length}
              origin={index === currentIndex && activeOrigin ? activeOrigin : originOf(item)}
              categoryMeta={categoryMeta}
              pricesVisible={pricesVisible}
              pricesText={pricesText}
              currency={currency}
              convertAmount={convertAmount}
              learnedCategory={learnedNotice && learnedNotice.id === item.id ? learnedNotice.title : null}
              actionFailed={actionFailedId === item.id}
              contentWidth={contentWidth}
              onPrev={() => goToIndex(index - 1)}
              onNext={() => goToIndex(index + 1)}
              onOpenCategory={() => setCategoryOpen(true)}
              onOpenReceipt={() => setReceiptOpen(true)}
              onRequestDelete={() => { setDeleteFailed(false); setDeleteOpen(true); }}
              onSaveNote={saveNote}
              onToggleReimbursable={setReimbursable}
            />
          )}
        />
      </View>

      <CategoryPickerSheet
        visible={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        categories={categoryOptions}
        selectedId={active?.category}
        onSelect={handleSelectCategory}
        flowType="expense"
        originLabel={active?.merchant}
        originAmount={active ? (pricesVisible ? activeAmountText : MASK) : undefined}
      />

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleting) setDeleteOpen(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.deleteCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
            <View style={[styles.deleteIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <Trash2 size={22} color={ts.raw.danger} />
            </View>
            <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
              Delete this transaction?
            </Text>
            <Text style={[Typography.bodyRegular, styles.deleteBody, { color: ts.raw.onSurfaceVariant }]}>
              This removes {pricesVisible ? activeAmountText : MASK} at {active?.merchant}. Your totals will update immediately.
            </Text>
            <View style={[styles.deleteInfo, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
              <Info size={14} color={ts.raw.warning} />
              <Text style={[Typography.micro, styles.flexShrink, { color: ts.raw.onSurfaceVariant }]}>
                This action cannot be undone, but a receipt can be re-scanned anytime.
              </Text>
            </View>
            {deleteFailed ? (
              <Text style={[Typography.micro, styles.deleteError, { color: ts.raw.danger }]}>
                Could not delete this record. Try again.
              </Text>
            ) : null}
            <View style={styles.deleteActions}>
              <PeachButton
                title="Yes, Delete Transaction"
                variant="destructive"
                size="lg"
                fullWidth
                isLoading={deleting}
                onPress={confirmDelete}
              />
              <PeachButton
                title="Keep Transaction"
                variant="neutral"
                size="lg"
                fullWidth
                disabled={deleting}
                onPress={() => setDeleteOpen(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={receiptOpen} transparent animationType="fade" onRequestClose={() => setReceiptOpen(false)}>
        <View style={styles.receiptViewer}>
          <View style={[styles.receiptViewerBar, { paddingTop: insets.top + Spacing.s2 }]}>
            <Text style={[Typography.micro, styles.mono, { color: '#FFFFFF' }]}>Receipt Attachment</Text>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Close receipt"
              onPress={() => setReceiptOpen(false)}
              hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
              style={styles.receiptClose}
            >
              <X size={18} color="#FFFFFF" strokeWidth={2.2} />
            </ScalePressable>
          </View>
          {active?.image_uri ? (
            <Image source={{ uri: active.image_uri }} style={styles.receiptImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

interface DetailPageProps {
  expense: Expense;
  index: number;
  total: number;
  origin: ExpenseRecordOrigin;
  categoryMeta: Record<string, ExpenseCategoryMeta>;
  pricesVisible: boolean;
  pricesText: string | null;
  currency: string;
  convertAmount: (amount: number, fromCurrency: string) => { amount: number; symbol: string };
  learnedCategory: string | null;
  actionFailed: boolean;
  contentWidth: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenCategory: () => void;
  onOpenReceipt: () => void;
  onRequestDelete: () => void;
  onSaveNote: (id: string, note: string) => Promise<void>;
  onToggleReimbursable: (id: string, value: boolean) => Promise<void>;
}

function DetailPage({
  expense,
  index,
  total,
  origin,
  categoryMeta,
  pricesVisible,
  pricesText,
  currency,
  convertAmount,
  learnedCategory,
  actionFailed,
  contentWidth,
  onPrev,
  onNext,
  onOpenCategory,
  onOpenReceipt,
  onRequestDelete,
  onSaveNote,
  onToggleReimbursable,
}: DetailPageProps) {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState(expense.note ?? '');
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reimbursable, setReimbursable] = useState(expense.is_reimbursable === 1);
  const [reimbError, setReimbError] = useState(false);

  const meta = categoryMeta[expense.category];
  const categoryTitle = meta?.title ?? expense.category;
  const tint = CategoryTints[expense.category as keyof typeof CategoryTints] ?? CategoryTints.other;
  const tintPair = ts.isDark ? tint.dark : tint.light;
  // Canonical reimbursable chip is a blue work-expense accent (HTML 284). The
  // transport category pair is the shared blue token pair used by S-09 manual
  // entry (expense/manual.tsx:191), so no new literal is introduced.
  const reimburseTint = ts.isDark ? CategoryTints.transport.dark : CategoryTints.transport.light;
  const originLabel = ORIGIN_LABELS_CAPTURE[origin];
  const isAutoCapture = origin === 'auto_capture';

  const converted = convertAmount(expense.amount, expense.currency || currency);
  const amountText = formatCurrency(converted.amount, currency);
  const originalText = formatCurrency(expense.amount, expense.currency || currency);
  const dateLabel = format(new Date(expense.date), 'EEEE, MMMM d, yyyy');
  const timeLabel = format(new Date(expense.date), 'HH:mm');
  // Hero badge is the canonical 12-hour clock (HTML 230, PNG "2:14 PM"); the
  // metadata Recorded Time row keeps the canonical 24-hour clock (HTML 327).
  const timeBadgeLabel = format(new Date(expense.date), 'h:mm a');

  const commitNote = useCallback(async () => {
    if ((expense.note ?? '') === note) {
      setNoteStatus('idle');
      return;
    }
    setNoteStatus('saving');
    try {
      await onSaveNote(expense.id, note);
      setNoteStatus('saved');
    } catch {
      setNoteStatus('error');
    }
  }, [expense.note, expense.id, note, onSaveNote]);

  const clearNote = useCallback(() => {
    setNote('');
    setNoteStatus('saving');
    onSaveNote(expense.id, '')
      .then(() => setNoteStatus('saved'))
      .catch(() => setNoteStatus('error'));
  }, [expense.id, onSaveNote]);

  const changeReimbursable = useCallback(async (value: boolean) => {
    setReimbursable(value);
    setReimbError(false);
    try {
      await onToggleReimbursable(expense.id, value);
    } catch {
      setReimbursable(!value);
      setReimbError(true);
    }
  }, [expense.id, onToggleReimbursable]);

  const atFirst = index === 0;
  const atLast = index === total - 1;

  return (
    <View style={{ width: contentWidth }}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.pageContent, { paddingBottom: Spacing.s8 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Swipe hint bar (HTML 205-213) */}
        <View style={styles.hintBar}>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Previous transaction"
            accessibilityState={{ disabled: atFirst }}
            disabled={atFirst}
            onPress={onPrev}
            hitSlop={8}
            style={[styles.hintButton, atFirst ? styles.hintDisabled : null]}
          >
            <ChevronLeft size={14} color={ts.raw.onSurfaceVariant} />
            <Text style={[Typography.micro, styles.hintText, { color: ts.raw.onSurfaceVariant }]}>Swipe Prev</Text>
          </ScalePressable>
          <View style={[styles.hintPill, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primaryBorder }]}>
            <Text style={[Typography.micro, styles.hintPillText, { color: ts.raw.primary }]}>
              Tx {index + 1} of {total}
            </Text>
          </View>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Next transaction"
            accessibilityState={{ disabled: atLast }}
            disabled={atLast}
            onPress={onNext}
            hitSlop={8}
            style={[styles.hintButton, atLast ? styles.hintDisabled : null]}
          >
            <Text style={[Typography.micro, styles.hintText, { color: ts.raw.onSurfaceVariant }]}>Swipe Next</Text>
            <ChevronRight size={14} color={ts.raw.onSurfaceVariant} />
          </ScalePressable>
        </View>

        {/* Hero detail card (HTML 216-279) */}
        <LuminousCard variant="high" style={styles.heroCard}>
          <View style={styles.originRow}>
            <View style={styles.originLeft}>
              <View style={[styles.originBadge, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primaryBorder }]}>
                <OriginGlyph origin={origin} color={ts.raw.primary} />
                <Text style={[Typography.micro, styles.bold, { color: ts.raw.primary }]} numberOfLines={1}>
                  {originLabel}
                </Text>
              </View>
              {isAutoCapture ? (
                <View style={[styles.memoryBadge, { backgroundColor: ts.raw.warningContainer, borderColor: ts.raw.warningBorder }]}>
                  <Sparkles size={11} color={ts.raw.warningContainerText} />
                  <Text style={[Typography.micro, styles.bold, { color: ts.raw.warningContainerText }]} numberOfLines={1}>
                    Memory Sync Active
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>{timeBadgeLabel}</Text>
          </View>

          <View style={styles.merchantRow}>
            <View style={[styles.merchantAvatar, { backgroundColor: tintPair[0] }]}>
              <CategoryGlyph iconName={meta?.iconName} size={24} color={tintPair[1]} />
            </View>
            <View style={styles.flexShrink}>
              <Text
                accessibilityRole="header"
                style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
                numberOfLines={1}
              >
                {expense.merchant}
              </Text>
              <Text style={[Typography.micro, styles.merchantSub, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                {categoryTitle}
              </Text>
            </View>
          </View>

          <View style={[styles.amountRow, { borderTopColor: ts.raw.outline, borderBottomColor: ts.raw.outline }]}>
            <View style={styles.flexShrink}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]}>Total Charged</Text>
              <Text
                style={[Typography.displayLg, styles.amount, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {pricesVisible ? `-${amountText}` : pricesText}
              </Text>
            </View>
            <View style={styles.originalBox}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]}>Parsed Raw</Text>
              <View style={[styles.originalChip, { backgroundColor: ts.bg.elevated }]}>
                <Text style={[Typography.micro, styles.mono, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                  {pricesVisible ? originalText : MASK}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.categoryRow}>
            <View style={styles.categoryLeft}>
              <Text style={[Typography.micro, styles.bold, { color: ts.raw.onSurfaceVariant }]}>Category:</Text>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={`Change category, currently ${categoryTitle}`}
                onPress={onOpenCategory}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                style={[styles.categoryBadge, { backgroundColor: tintPair[0], borderColor: tintPair[1] + '33' }]}
              >
                <CategoryGlyph iconName={meta?.iconName} size={14} color={tintPair[1]} />
                <Text style={[Typography.micro, styles.bold, { color: tintPair[1] }]} numberOfLines={1}>
                  {categoryTitle}
                </Text>
                <ChevronDown size={13} color={tintPair[1]} />
              </ScalePressable>
            </View>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Change category"
              onPress={onOpenCategory}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
            >
              <Text style={[Typography.micro, styles.bold, styles.underline, { color: ts.raw.primary }]}>Change</Text>
            </ScalePressable>
          </View>

          {actionFailed ? (
            <Text style={[Typography.micro, styles.learnedAlertText, { color: ts.raw.danger }]}>
              Could not update the category. Try again.
            </Text>
          ) : null}

          {learnedCategory ? (
            <View style={[styles.learnedAlert, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primaryBorder }]}>
              <Sparkles size={14} color={ts.raw.primary} />
              <View style={styles.flexShrink}>
                <Text style={[Typography.micro, styles.bold, { color: ts.raw.primary }]}>
                  Auto-Capture Memory Updated
                </Text>
                <Text style={[Typography.micro, styles.learnedAlertText, { color: ts.raw.onSurfaceVariant }]}>
                  Future auto-captures from {expense.merchant} will categorize under {learnedCategory}.
                </Text>
              </View>
            </View>
          ) : null}
        </LuminousCard>

        {/* Reimbursable card (HTML 282-296) */}
        <LuminousCard variant="high" style={styles.tileCard}>
          <View style={styles.tileLeft}>
            <View style={[styles.tileIcon, { backgroundColor: reimburseTint[0] }]}>
              <Briefcase size={18} color={reimburseTint[1]} />
            </View>
            <View style={styles.flexShrink}>
              <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Reimbursable Expense</Text>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                {reimbursable ? 'Flagged for company/work expense reimbursement' : 'Personal transaction (not reimbursable)'}
              </Text>
              {reimbError ? (
                <Text style={[Typography.micro, { color: ts.raw.danger }]}>Could not update. Reverted.</Text>
              ) : null}
            </View>
          </View>
          <Switch
            value={reimbursable}
            onValueChange={changeReimbursable}
            trackColor={{ false: ts.raw.surfaceContainerHighest, true: ts.raw.primary }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={ts.raw.surfaceContainerHighest}
            accessibilityLabel="Reimbursable expense"
          />
        </LuminousCard>

        {/* Note card (HTML 299-317) */}
        <LuminousCard variant="high" style={styles.tileCard}>
          <View style={styles.noteHeader}>
            <View style={styles.noteTitleRow}>
              <Pencil size={15} color={ts.raw.onSurfaceVariant} />
              <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Personal Note</Text>
            </View>
            <Text style={[Typography.micro, styles.mono, { color: ts.raw.onSurfaceVariant }]}>
              {note.length} / {NOTE_MAX}
            </Text>
          </View>
          <TextInput
            value={note}
            onChangeText={text => {
              setNote(text);
              if (noteStatus === 'error') setNoteStatus('idle');
            }}
            onBlur={commitNote}
            multiline
            maxLength={NOTE_MAX}
            textAlignVertical="top"
            placeholder="Add context, project name, or who was there..."
            placeholderTextColor={ts.raw.onSurfaceVariant}
            selectionColor={ts.raw.primary}
            style={[styles.noteInput, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline, color: ts.raw.onSurface }]}
            accessibilityLabel="Transaction note"
          />
          <View style={[styles.noteFooter, { borderTopColor: ts.raw.outline }]}>
            {noteStatus === 'saving' ? (
              <Text style={[Typography.micro, { color: ts.raw.primary }]}>Saving...</Text>
            ) : noteStatus === 'error' ? (
              <Pressable onPress={commitNote} accessibilityRole="button" accessibilityLabel="Retry saving note" hitSlop={{ top: 14, bottom: 14 }}>
                <Text style={[Typography.micro, styles.bold, { color: ts.raw.danger }]}>Save failed, tap to retry</Text>
              </Pressable>
            ) : noteStatus === 'saved' ? (
              <View style={styles.savedRow}>
                <Check size={12} color={ts.raw.statusSuccessText} strokeWidth={2.5} />
                <Text style={[Typography.micro, styles.bold, { color: ts.raw.statusSuccessText }]}>Autosaved to SQLite</Text>
              </View>
            ) : (
              <View style={styles.savedRow}>
                <Check size={12} color={ts.raw.onSurfaceVariant} strokeWidth={2.5} />
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Saved</Text>
              </View>
            )}
            {note.length > 0 ? (
              <Pressable onPress={clearNote} accessibilityRole="button" accessibilityLabel="Clear note" hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}>
                <Text style={[Typography.micro, styles.bold, { color: ts.raw.onSurfaceVariant }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </LuminousCard>

        {/* Metadata card (HTML 320-341) */}
        <LuminousCard variant="high" style={styles.metaCard}>
          <MetaRow label="Transaction Date" value={dateLabel} />
          <MetaRow label="Recorded Time" value={timeLabel} />
          <MetaRow label="Capture Source" value={originLabel} last />
        </LuminousCard>

        {/* Receipt card (HTML 344-392) */}
        <LuminousCard variant="high" style={styles.tileCard}>
          <View style={styles.receiptHeader}>
            <View style={styles.noteTitleRow}>
              <Receipt size={15} color={ts.raw.onSurfaceVariant} />
              <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Receipt Attachment</Text>
            </View>
            <View style={[
              styles.receiptPill,
              expense.image_uri
                ? { backgroundColor: ts.raw.successContainer, borderColor: ts.raw.successBorder }
                : { backgroundColor: ts.bg.elevated, borderColor: ts.raw.outline },
            ]}>
              <Text style={[Typography.micro, styles.bold, { color: expense.image_uri ? ts.raw.successText : ts.raw.onSurfaceVariant }]}>
                {expense.image_uri ? '1 Image Attached' : 'None'}
              </Text>
            </View>
          </View>
          {expense.image_uri ? (
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="View receipt image"
              onPress={onOpenReceipt}
              style={[styles.receiptImageBox, { borderColor: ts.raw.outline }]}
            >
              <Image source={{ uri: expense.image_uri }} style={styles.receiptThumb} resizeMode="cover" />
            </ScalePressable>
          ) : (
            <View style={[styles.receiptEmpty, { borderColor: ts.raw.outline, backgroundColor: ts.bg.low }]}>
              <View style={[styles.receiptEmptyIcon, { backgroundColor: ts.bg.elevated }]}>
                <Receipt size={20} color={ts.raw.onSurfaceVariant} />
              </View>
              <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>No Receipt Attached</Text>
              <Text style={[Typography.micro, styles.receiptEmptyBody, { color: ts.raw.onSurfaceVariant }]}>
                Receipts scanned through the capture flow appear here.
              </Text>
            </View>
          )}
        </LuminousCard>

        {/* Destructive delete (HTML 395-401) */}
        <View style={styles.deleteWrap}>
          <PeachButton
            title="Delete Transaction"
            variant="destructive"
            size="lg"
            fullWidth
            icon={<Trash2 size={16} color={ts.raw.danger} />}
            onPress={onRequestDelete}
          />
          <Text style={[Typography.micro, styles.deleteHint, { color: ts.raw.onSurfaceVariant }]}>
            Protected by zero-blame confirmation prompt
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function MetaRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const ts = useThemeStyles();
  return (
    <View style={[styles.metaRow, last ? null : { borderBottomColor: ts.raw.outline, borderBottomWidth: 1 }]}>
      <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>{label}</Text>
      <Text style={[Typography.labelBold, styles.metaValue, { color: ts.raw.onSurface }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appbar: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s2,
  },
  appbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
  },
  appbarCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  appbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  appbarSpacer: { width: 44 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  uppercase: { textTransform: 'uppercase', letterSpacing: 0.6 },
  bold: { fontFamily: 'Manrope_700Bold' },
  flexShrink: { flexShrink: 1, minWidth: 0 },
  mono: { fontFamily: 'Manrope_500Medium', letterSpacing: 0.4 },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    marginTop: Spacing.s1,
  },
  dot: { width: 6, height: 6, borderRadius: Radii.full },
  dotActive: { width: 16 },

  listWrap: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  page: { flex: 1 },
  pageContent: {
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    gap: Spacing.s4,
  },

  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  hintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    minHeight: 32,
  },
  hintDisabled: { opacity: 0.35 },
  hintText: { fontFamily: 'Manrope_600SemiBold' },
  hintPill: {
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  hintPillText: { fontFamily: 'Manrope_700Bold' },

  heroCard: { position: 'relative' },
  originRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s3,
  },
  originLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexWrap: 'wrap',
  },
  originBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 3,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  memoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    marginBottom: Spacing.s3,
  },
  merchantAvatar: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  merchantSub: { marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: Spacing.s3,
  },
  amount: { letterSpacing: -0.5, marginTop: 2 },
  originalBox: { alignItems: 'flex-end', flexShrink: 0 },
  originalChip: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    marginTop: Spacing.s1,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    paddingTop: Spacing.s1,
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flex: 1,
    minWidth: 0,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.sm,
    borderWidth: 1,
    flexShrink: 1,
    minHeight: 34,
  },
  underline: { textDecorationLine: 'underline' },
  learnedAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s2,
    marginTop: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  learnedAlertText: { marginTop: 2 },

  tileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    flexWrap: 'wrap',
  },
  tileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    flex: 1,
    minWidth: 0,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s2,
  },
  noteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexShrink: 1,
    minWidth: 0,
  },
  noteInput: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: Radii.sm,
    padding: Spacing.s3,
    ...Typography.labelMd,
  },
  noteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginTop: Spacing.s2,
    paddingTop: Spacing.s2,
    borderTopWidth: 1,
  },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },

  metaCard: { paddingVertical: Spacing.s2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingVertical: Spacing.s2,
  },
  metaValue: { flexShrink: 1, minWidth: 0, textAlign: 'right' },

  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s3,
    width: '100%',
  },
  receiptPill: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  receiptImageBox: {
    width: '100%',
    height: 176,
    borderRadius: Radii.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  receiptThumb: { width: '100%', height: '100%' },
  receiptEmpty: {
    width: '100%',
    paddingVertical: Spacing.s5,
    paddingHorizontal: Spacing.s4,
    borderRadius: Radii.sm,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  receiptEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s2,
  },
  receiptEmptyBody: { textAlign: 'center', marginTop: Spacing.s1, maxWidth: 240 },

  deleteWrap: { paddingTop: Spacing.s1 },
  deleteHint: { textAlign: 'center', marginTop: Spacing.s2 },

  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s5,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s4,
  },
  stateTitle: { textAlign: 'center' },
  stateBody: { textAlign: 'center', marginTop: Spacing.s2, maxWidth: 280 },
  stateActions: { marginTop: Spacing.s4, width: '100%', maxWidth: 320 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.s4,
  },
  deleteCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radii.xl,
    borderWidth: 1,
    padding: Spacing.s5,
  },
  deleteIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s3,
  },
  deleteBody: { marginTop: Spacing.s2 },
  deleteInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    marginTop: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  deleteError: { marginTop: Spacing.s3 },
  deleteActions: { marginTop: Spacing.s4, gap: Spacing.s3 },

  receiptViewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  receiptViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s3,
  },
  receiptClose: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptImage: { flex: 1, width: '100%' },
});
