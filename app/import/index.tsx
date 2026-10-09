import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Upload,
  X,
  Zap,
} from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { useToast } from '../../components/ui/ToastProvider';
import { AIProcessingOverlay } from '../../components/capture/AIProcessingOverlay';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { CategoryTints, Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency, resolveCurrency } from '../../utils/currency';
import { aiChatService } from '../../services/AIChatService';
import type { Expense } from '../../types/database';
import {
  categoryService,
  commitImportItems,
  editImportItem,
  EXTERNAL_IMPORT_PROMPT,
  getImportRepository,
  importDataSource,
  parseImportInput,
  prepareImportPreview,
  refreshImportItem,
  resolveImportAiAvailability,
  toggleImportItem,
} from '../../services/DataServices';
import type {
  ImportAiAvailability,
  ImportCommitResult,
  ImportPreviewItem,
} from '../../services/DataServices';

// S-12 Import. Rebuilt as the single bulk-import surface (FR-12.1-FR-12.6).
// Method choice (AI-assisted default via S-07, external prompt and CSV/paste as
// opt-in), CSV/paste parse, the shared review-before-save preview with per-item
// edit, include/exclude and duplicate flags, a real commit count, and an honest
// success screen that auto-returns to the origin. All reads/writes go through the
// typed import contract; the screen runs no SQL and owns no second commit path.

type ImportView = 'method' | 'input' | 'preview' | 'success';
type InputTab = 'paste' | 'upload';

const MAX_CONTENT_WIDTH = 640;
const BACK_SIZE = 40;
const BACK_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };
const CLOSE_SIZE = 32;
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
const SHEET_MAX_HEIGHT = 760;
const AUTO_RETURN_MS = 2500;
const CHECKBOX_SIZE = 22;
const CHECKBOX_RADIUS = 6;

const ERROR_FIELD_LABEL: Record<string, string> = {
  merchant: 'merchant name',
  amount: 'amount',
  currency: 'currency',
  category: 'category',
};

function humanizeCategory(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function itemDateLabel(date?: number): string {
  return typeof date === 'number' && Number.isFinite(date) ? format(new Date(date), 'MMM d, yyyy') : '';
}

function itemAmountLabel(expense: Partial<Expense>): string {
  const amount = typeof expense.amount === 'number' && Number.isFinite(expense.amount) ? expense.amount : 0;
  return formatCurrency(amount, expense.currency);
}

// Mixed-currency batches cannot be summed into one number, so the tally shows a
// total only when every included row shares one currency and otherwise shows the
// count alone rather than an invalid cross-currency sum.
function summariseIncluded(
  items: ImportPreviewItem[],
  userCurrency: string,
): { count: number; total: number | null; currency: string | null } {
  const included = items.filter((item) => item.included && item.candidate !== null);
  if (included.length === 0) return { count: 0, total: null, currency: null };
  const currencies = new Set(included.map((item) => resolveCurrency(item.expense.currency, userCurrency)));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const total = currency
    ? included.reduce((sum, item) => sum + (typeof item.expense.amount === 'number' ? item.expense.amount : 0), 0)
    : null;
  return { count: included.length, total, currency };
}

interface PreviewRowProps {
  item: ImportPreviewItem;
  category?: CaptureCategory;
  onToggle: (included: boolean) => void;
  onEdit: () => void;
}

function PreviewRow({ item, category, onToggle, onEdit }: PreviewRowProps) {
  const ts = useThemeStyles();
  const expense = item.expense;
  const categoryId = expense.category ?? '';
  const tint = CategoryTints[categoryId as keyof typeof CategoryTints] ?? CategoryTints.other;
  const chipBackground = ts.isDark ? tint.dark[0] : tint.light[0];
  const chipColor = ts.isDark ? tint.dark[1] : tint.light[1];
  const title = category?.title ?? (categoryId ? humanizeCategory(categoryId) : 'Uncategorized');
  const isDuplicate = item.duplicate !== null;
  const invalid = item.candidate === null;
  const dateLabel = itemDateLabel(expense.date);

  return (
    <LuminousCard
      variant={isDuplicate ? 'low' : 'high'}
      style={{
        padding: Spacing.s3,
        marginBottom: Spacing.s2,
        borderColor: isDuplicate ? ts.raw.warningBorder : ts.raw.outline,
        backgroundColor: isDuplicate ? ts.raw.warningContainer : ts.bg.card,
      }}
    >
      {isDuplicate ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.s1,
            paddingBottom: Spacing.s2,
            marginBottom: Spacing.s2,
            borderBottomWidth: 1,
            borderBottomColor: ts.raw.warningBorder,
          }}
        >
          <AlertTriangle size={12} color={ts.raw.warning} />
          <Text style={[Typography.micro, { color: ts.raw.warningContainerText }]}>Possible Duplicate in Ledger</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2, flex: 1, minWidth: 0 }}>
          <ScalePressable
            haptic={false}
            disabled={invalid}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.included, disabled: invalid }}
            accessibilityLabel={`Include ${title}`}
            onPress={() => onToggle(!item.included)}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -Spacing.s2, marginLeft: -Spacing.s2 }}
          >
            <View
              style={{
                width: CHECKBOX_SIZE,
                height: CHECKBOX_SIZE,
                borderRadius: CHECKBOX_RADIUS,
                borderWidth: 1.5,
                borderColor: item.included ? ts.raw.primary : isDuplicate ? ts.raw.warning : ts.border.card,
                backgroundColor: item.included ? ts.raw.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {item.included ? <Check size={13} color={Colors.white} strokeWidth={3} /> : null}
            </View>
          </ScalePressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>
              {expense.merchant || 'Untitled'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, marginTop: 2, flexWrap: 'wrap' }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Spacing.s1,
                  paddingHorizontal: Spacing.s1,
                  paddingVertical: 1,
                  borderRadius: Radii.full,
                  backgroundColor: chipBackground,
                }}
              >
                <CategoryGlyph iconName={category?.icon_name} size={10} color={chipColor} />
                <Text style={[Typography.micro, { color: chipColor }]}>{title}</Text>
              </View>
              {dateLabel ? <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{dateLabel}</Text> : null}
            </View>
            {invalid && item.error ? (
              <Text style={[Typography.micro, { color: ts.text.error, marginTop: Spacing.s1 }]}>
                Missing {ERROR_FIELD_LABEL[item.error] ?? item.error}.
              </Text>
            ) : null}
            {isDuplicate ? (
              <ScalePressable
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={item.included ? 'Exclude flagged duplicate' : 'Include flagged duplicate anyway'}
                onPress={() => onToggle(!item.included)}
                style={{ minHeight: 28, justifyContent: 'center', marginTop: Spacing.s1 }}
              >
                <Text style={[Typography.micro, { color: ts.raw.warningContainerText, fontFamily: 'Manrope_700Bold' }]}>
                  {item.included ? 'Exclude again' : 'Include anyway'}
                </Text>
              </ScalePressable>
            ) : null}
          </View>
        </View>

        <View style={{ alignItems: 'flex-end', gap: Spacing.s1, flexShrink: 0 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.labelBold, { color: ts.text.onSurface }]}>
            {itemAmountLabel(expense)}
          </Text>
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${title}`}
            onPress={onEdit}
            style={{ minHeight: 28, justifyContent: 'center' }}
          >
            <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Edit</Text>
          </ScalePressable>
        </View>
      </View>
    </LuminousCard>
  );
}

export default function ImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string; parsed?: string }>();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { showToast } = useToast();
  const { currency } = useSettings();

  const [view, setView] = useState<ImportView>('method');
  const [inputTab, setInputTab] = useState<InputTab>('paste');
  const [inputText, setInputText] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<'parse' | 'commit' | null>(null);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [parseMessages, setParseMessages] = useState<string[]>([]);
  const [parseNoticeOpen, setParseNoticeOpen] = useState(false);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [aiAvailability, setAiAvailability] = useState<ImportAiAvailability | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [returnRemainingMs, setReturnRemainingMs] = useState(AUTO_RETURN_MS);

  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editMerchant, setEditMerchant] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editPickerOpen, setEditPickerOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const handoffHandled = useRef(false);

  const categoryById = useMemo(() => {
    const map = new Map<string, CaptureCategory>();
    categories.forEach((category) => map.set(category.id, category));
    return map;
  }, [categories]);

  // Real category titles/icons for the preview chips and the per-item picker.
  useEffect(() => {
    let active = true;
    void categoryService
      .list()
      .then((rows) => {
        if (active) setCategories(rows.map((row) => ({ id: row.id, title: row.title, icon_name: row.iconName })));
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // FR-12.1: the in-app assistant is the default, but only when a provider key is
  // configured and the device is online. Any read failure falls back to chat,
  // which owns its own missing-key state; nothing is hidden.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const netState = await NetInfo.fetch();
        const isConnected = netState.isConnected === true && netState.isInternetReachable === true;
        const keyState = await aiChatService.getProviderKeyState();
        const hasKey = keyState.gemini.status === 'configured' || keyState.openrouter.status === 'configured';
        if (active) setAiAvailability(resolveImportAiAvailability(isConnected, hasKey));
      } catch {
        if (active) setAiAvailability(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // FR-12.1: a chat-originated batch flows back into this same preview. The
  // hand-off payload is the real parsed expense array; it is staged through the
  // shared contract, never trusted as a saved row.
  useEffect(() => {
    if (handoffHandled.current || typeof params.parsed !== 'string' || !params.parsed) return;
    handoffHandled.current = true;
    let active = true;
    void (async () => {
      try {
        const parsed = JSON.parse(params.parsed as string) as Partial<Expense>[];
        if (!Array.isArray(parsed) || parsed.length === 0) {
          if (active) setEmptyNotice(true);
          return;
        }
        const repository = await getImportRepository();
        const items = await prepareImportPreview(parsed, repository);
        if (!active) return;
        if (items.length === 0) {
          setEmptyNotice(true);
          return;
        }
        setPreviewItems(items);
        setView('preview');
      } catch {
        if (active) {
          setParseMessages(['Could not read the returned import data.']);
          setParseNoticeOpen(true);
          setView('input');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [params.parsed]);

  const returnToOrigin = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  useEffect(() => {
    if (view !== 'success' || !commitResult) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setReturnRemainingMs(Math.max(0, AUTO_RETURN_MS - (Date.now() - startedAt)));
    }, 100);
    const timer = setTimeout(() => returnToOrigin(), AUTO_RETURN_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [view, commitResult, returnToOrigin]);

  const handleBack = useCallback(() => {
    if (view === 'method' || view === 'success') returnToOrigin();
    else if (view === 'input') setView('method');
    else setView('input');
  }, [view, returnToOrigin]);

  const handleAiPrimary = useCallback(() => {
    if (aiAvailability === undefined) return;
    if (aiAvailability === null || aiAvailability.status === 'in_app') {
      router.push({ pathname: '/chat', params: { intent: 'import' } });
      return;
    }
    if (aiAvailability.reason === 'missing_key') {
      router.push('/settings/chat');
      return;
    }
    // Offline: the in-app assistant cannot run, so the external fallback below is
    // the working path.
    setInputTab('paste');
    setView('input');
  }, [aiAvailability, router]);

  const handleCopyPrompt = useCallback(async () => {
    await Clipboard.setStringAsync(EXTERNAL_IMPORT_PROMPT);
    setCopied(true);
    showToast('Prompt copied. Paste it into your AI tool.', 'success');
    setTimeout(() => setCopied(false), 2000);
  }, [showToast]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/json', 'text/plain'],
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const content = await readAsStringAsync(asset.uri);
      setInputText(content);
      setSelectedFileName(asset.name);
      setEmptyNotice(false);
    } catch {
      showToast('Could not read the selected file.', 'error');
    }
  }, [showToast]);

  const handleParse = useCallback(async () => {
    if (!inputText.trim() || busy) return;
    setBusy('parse');
    setEmptyNotice(false);
    setParseMessages([]);
    setParseNoticeOpen(false);
    try {
      const repository = await getImportRepository();
      const state = await parseImportInput(importDataSource, repository, inputText);
      if (state.status === 'failed') {
        setParseMessages(state.errors);
        setParseNoticeOpen(true);
        setView('input');
      } else if (state.status === 'empty') {
        setEmptyNotice(true);
        setView('input');
      } else {
        setPreviewItems(state.items);
        setParseMessages(state.errors);
        setParseNoticeOpen(state.errors.length > 0);
        setView('preview');
      }
    } catch {
      setParseMessages(['Could not parse the pasted data. Check the format and try again.']);
      setParseNoticeOpen(true);
    } finally {
      setBusy(null);
    }
  }, [inputText, busy]);

  const handleToggleItem = useCallback((id: string, included: boolean) => {
    setPreviewItems((items) => toggleImportItem(items, id, included));
  }, []);

  const handleSelectAll = useCallback((included: boolean) => {
    setPreviewItems((items) => items.reduce((acc, item) => (item.candidate ? toggleImportItem(acc, item.id, included) : acc), items));
  }, []);

  const openEdit = useCallback((item: ImportPreviewItem) => {
    setEditItemId(item.id);
    setEditMerchant(item.expense.merchant ?? '');
    setEditAmount(typeof item.expense.amount === 'number' ? String(item.expense.amount) : '');
    setEditCategoryId(item.expense.category ?? '');
    setEditError(null);
  }, []);

  const closeEdit = useCallback(() => {
    setEditItemId(null);
    setEditPickerOpen(false);
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editItemId) return;
    const merchant = editMerchant.trim();
    const amount = Number(editAmount.replace(/,/g, ''));
    if (!merchant) {
      setEditError('Merchant name is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('Enter an amount greater than zero.');
      return;
    }
    if (!editCategoryId) {
      setEditError('Select a category.');
      return;
    }
    let next = editImportItem(previewItems, editItemId, { merchant, amount, category: editCategoryId });
    try {
      const repository = await getImportRepository();
      next = await refreshImportItem(next, editItemId, repository);
    } catch {
      // The edit still applies; the duplicate probe can be retried on the next edit.
    }
    setPreviewItems(next);
    closeEdit();
  }, [editItemId, editMerchant, editAmount, editCategoryId, previewItems, closeEdit]);

  const handleCommit = useCallback(async () => {
    if (busy) return;
    const included = previewItems.filter((item) => item.included && item.candidate !== null);
    if (included.length === 0) return;
    setBusy('commit');
    try {
      const repository = await getImportRepository();
      // Missing category names are provisioned through the S-16 owner before the
      // commit, matching the v1 CSV behavior and FR-12.2; existing names are left
      // untouched and no duplicate is created.
      const names = [...new Set(included.map((item) => item.candidate?.category ?? '').filter(Boolean))];
      await categoryService.ensure(names);
      const result = await commitImportItems(previewItems, repository);
      setCommitResult(result);
      setReturnRemainingMs(AUTO_RETURN_MS);
      setView('success');
      if (result.failed > 0) {
        showToast(`${result.failed} item${result.failed === 1 ? '' : 's'} could not be imported.`, 'error');
      } else {
        showToast(`${result.imported} item${result.imported === 1 ? '' : 's'} imported.`, 'success');
      }
    } catch {
      showToast('Import failed. Nothing was changed.', 'error');
    } finally {
      setBusy(null);
    }
  }, [busy, previewItems, showToast]);

  const summary = useMemo(() => summariseIncluded(previewItems, currency), [previewItems, currency]);
  const excludedCount = previewItems.filter((item) => !item.included).length;

  const headerTitle =
    view === 'success' ? 'Import Complete' : view === 'preview' ? 'Review Parsed Batch' : 'Import Transactions';
  const headerSubtitle =
    view === 'method'
      ? 'Choose a source'
      : view === 'input'
        ? inputTab === 'upload'
          ? 'Upload a CSV file'
          : 'Paste JSON or CSV'
        : view === 'preview'
          ? 'Review before saving'
          : 'Returning to origin';

  const importButtonLabel = (() => {
    if (busy === 'commit') return 'Importing...';
    const noun = summary.count === 1 ? 'Transaction' : 'Transactions';
    const total = summary.currency !== null && summary.total !== null ? ` (${formatCurrency(summary.total, summary.currency)})` : '';
    return `Import ${summary.count} Verified ${noun}${total}`;
  })();

  const sheetMaxHeight = Math.min(SHEET_MAX_HEIGHT, height * 0.9);

  const renderMethod = () => (
    <View style={{ gap: Spacing.s4 }}>
      <View style={{ gap: Spacing.s1 }}>
        <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>Choose Import Source</Text>
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
          Select how you want to extract transactions. All methods pass through manual review before saving.
        </Text>
      </View>

      <LinearGradient
        colors={ts.isDark ? Gradients.dark : Gradients.light}
        start={{ x: 0.33, y: 0 }}
        end={{ x: 0.67, y: 1 }}
        style={{ borderRadius: Radii.lg, padding: Spacing.s4, gap: Spacing.s2 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
          <View style={{ backgroundColor: ts.raw.warning, borderRadius: Radii.full, paddingHorizontal: Spacing.s2, paddingVertical: 2 }}>
            <Text style={[Typography.micro, { color: Colors.black, fontFamily: 'Manrope_700Bold', textTransform: 'uppercase' }]}>Recommended</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s3 }}>
          <View style={{ width: 40, height: 40, borderRadius: Radii.md, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' }}>
            <Zap size={20} color={ts.raw.onPrimary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[Typography.labelBold, { color: ts.raw.onPrimary }]}>AI Conversational Extract</Text>
            <Text style={[Typography.micro, { color: 'rgba(255,255,255,0.80)', marginTop: Spacing.s1 }]}>
              Paste unstructured bank digests, SMS, or receipt summaries into Peach Chat. The assistant parses them and returns them here for review.
            </Text>
          </View>
        </View>

        {aiAvailability?.status === 'external' ? (
          <View style={{ backgroundColor: ts.raw.warningContainer, borderColor: ts.raw.warningBorder, borderWidth: 1, borderRadius: Radii.md, padding: Spacing.s2, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2 }}>
            <AlertTriangle size={14} color={ts.raw.warning} />
            <Text style={[Typography.micro, { color: ts.raw.warningContainerText, flex: 1 }]}>
              {aiAvailability.reason === 'missing_key'
                ? 'No AI key configured. Add one in S-17, or use the external prompt fallback below.'
                : 'You are offline. The in-app assistant needs a connection; use the external prompt fallback below.'}
            </Text>
          </View>
        ) : null}

        <PeachButton
          title={
            aiAvailability === undefined
              ? 'Checking availability'
              : aiAvailability?.status === 'external'
                ? aiAvailability.reason === 'missing_key'
                  ? 'Open S-17'
                  : 'Use External Fallback'
                : 'Continue to Chat'
          }
          onPress={handleAiPrimary}
          variant={aiAvailability === undefined ? 'disabled' : 'neutral'}
          tone="light"
          disabled={aiAvailability === undefined}
          size="lg"
          fullWidth
          trailingIcon={<ChevronRight size={16} color={aiAvailability === undefined ? ts.raw.disabledText : ts.raw.primary} />}
        />
      </LinearGradient>

      <LuminousCard variant="high" style={{ padding: Spacing.s4, gap: Spacing.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 }}>
            <View style={{ width: 28, height: 28, borderRadius: Radii.sm, backgroundColor: ts.raw.purple100, alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={14} color={ts.text.primary} />
            </View>
            <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>External LLM Prompt Fallback</Text>
          </View>
          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, flexShrink: 0 }]}>Free/Zero-API</Text>
        </View>
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
          Run the prompt in your own AI tool, then paste the structured response back here. This path always works, even without an in-app key.
        </Text>
        <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
          <PeachButton
            title={copied ? 'Copied' : 'Copy Prompt'}
            onPress={() => { void handleCopyPrompt(); }}
            variant="secondary"
            size="sm"
            icon={copied ? <Check size={14} color={ts.text.primary} /> : <Copy size={14} color={ts.text.primary} />}
            style={{ flex: 1 }}
          />
          <PeachButton
            title="Paste JSON or CSV"
            onPress={() => { setInputTab('paste'); setView('input'); }}
            variant="quiet"
            size="sm"
            style={{ flex: 1 }}
          />
        </View>
      </LuminousCard>

      <ScalePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel="Upload a CSV or statement"
        onPress={() => { setInputTab('upload'); setView('input'); }}
        style={{ borderRadius: Radii.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: ts.border.primary20, padding: Spacing.s4, alignItems: 'center', gap: Spacing.s2 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: Radii.full, backgroundColor: ts.bg.primary10, alignItems: 'center', justifyContent: 'center' }}>
          <Upload size={20} color={ts.text.primary} />
        </View>
        <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Tap to Upload CSV or Statement</Text>
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
          Supports exported bank CSV and pasted JSON with merchant, amount, currency, and category columns.
        </Text>
      </ScalePressable>
    </View>
  );

  const renderInput = () => (
    <View style={{ gap: Spacing.s4 }}>
      <View style={{ flexDirection: 'row', backgroundColor: ts.bg.low, borderRadius: Radii.md, padding: Spacing.s1, gap: Spacing.s1 }}>
        {(['paste', 'upload'] as InputTab[]).map((tab) => {
          const active = inputTab === tab;
          return (
            <ScalePressable
              key={tab}
              haptic={false}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab === 'paste' ? 'Paste data' : 'Upload file'}
              onPress={() => setInputTab(tab)}
              style={{ flex: 1, minHeight: 44, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? ts.raw.primary : 'transparent' }}
            >
              <Text style={[Typography.labelMd, { color: active ? Colors.white : ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold' }]}>
                {tab === 'paste' ? 'Paste' : 'Upload File'}
              </Text>
            </ScalePressable>
          );
        })}
      </View>

      {inputTab === 'upload' ? (
        <ScalePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel="Select a CSV or JSON file"
          onPress={() => { void handlePickFile(); }}
          style={{ borderRadius: Radii.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: ts.border.subtle, padding: Spacing.s7, alignItems: 'center', gap: Spacing.s2 }}
        >
          <Upload size={32} color={ts.text.primary} />
          <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Tap to select a file</Text>
          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>CSV, JSON, or plain text</Text>
          {selectedFileName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s2, borderRadius: Radii.sm, backgroundColor: ts.bg.primary10, marginTop: Spacing.s2, maxWidth: '100%' }}>
              <FileText size={14} color={ts.text.primary} />
              <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.primary, flexShrink: 1 }]}>{selectedFileName}</Text>
            </View>
          ) : null}
        </ScalePressable>
      ) : (
        <View style={{ gap: Spacing.s1 }}>
          <TextInput
            value={inputText}
            onChangeText={(value) => { setInputText(value); setEmptyNotice(false); }}
            placeholder="Paste JSON or CSV here..."
            placeholderTextColor={ts.text.onSurfaceVariant}
            selectionColor={ts.raw.primary}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Paste import data"
            style={[Typography.labelMd, { color: ts.text.onSurface, backgroundColor: ts.bg.low, borderColor: ts.border.subtle, borderWidth: 1, borderRadius: Radii.md, minHeight: 200, maxHeight: 320, padding: Spacing.s4 }]}
          />
          {inputText.length > 0 ? (
            <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'right' }]}>{inputText.length} characters</Text>
          ) : null}
        </View>
      )}

      <PeachButton
        title="Parse Data"
        onPress={() => { void handleParse(); }}
        variant={inputText.trim() && !busy ? 'primary' : 'disabled'}
        disabled={!inputText.trim() || busy !== null}
        size="lg"
        fullWidth
      />

      {emptyNotice ? (
        <LuminousCard variant="low" style={{ padding: Spacing.s3 }}>
          <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>
            No importable rows were found. Check that each row has a merchant, a positive amount, a currency, and a category.
          </Text>
        </LuminousCard>
      ) : null}

      {parseNoticeOpen && parseMessages.length > 0 ? (
        <LuminousCard variant="low" style={{ padding: Spacing.s3, borderColor: ts.border.error20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, marginBottom: Spacing.s1 }}>
            <AlertTriangle size={14} color={ts.text.error} />
            <Text style={[Typography.captionBold, { color: ts.text.error }]}>
              {parseMessages.length} row{parseMessages.length === 1 ? '' : 's'} need a look
            </Text>
          </View>
          {parseMessages.map((message, index) => (
            <Text key={index} style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>{message}</Text>
          ))}
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Dismiss parse messages"
            onPress={() => setParseNoticeOpen(false)}
            style={{ minHeight: 44, justifyContent: 'center', marginTop: Spacing.s1 }}
          >
            <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Dismiss and continue review</Text>
          </ScalePressable>
        </LuminousCard>
      ) : null}
    </View>
  );

  const renderPreview = () => (
    <View style={{ gap: Spacing.s3 }}>
      {parseNoticeOpen && parseMessages.length > 0 ? (
        <LuminousCard variant="low" style={{ padding: Spacing.s3, borderColor: ts.border.error20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, marginBottom: Spacing.s1 }}>
            <AlertTriangle size={14} color={ts.text.error} />
            <Text style={[Typography.captionBold, { color: ts.text.error }]}>Some rows were skipped</Text>
          </View>
          {parseMessages.map((message, index) => (
            <Text key={index} style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>{message}</Text>
          ))}
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Dismiss parse messages"
            onPress={() => setParseNoticeOpen(false)}
            style={{ minHeight: 44, justifyContent: 'center', marginTop: Spacing.s1 }}
          >
            <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Dismiss and continue review</Text>
          </ScalePressable>
        </LuminousCard>
      ) : null}

      <LinearGradient
        colors={[ts.raw.purple100, ts.bg.low]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ borderRadius: Radii.lg, borderWidth: 1, borderColor: ts.border.primary20, padding: Spacing.s3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}
      >
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text style={[Typography.micro, { color: ts.text.primary, textTransform: 'uppercase', fontFamily: 'Manrope_700Bold' }]}>Batch Inspection</Text>
          <Text style={[Typography.labelMd, { color: ts.text.onSurface }, { marginTop: 2 }]}>
            {summary.count} Included • {excludedCount} Excluded
            {summary.currency !== null && summary.total !== null ? ` (${formatCurrency(summary.total, summary.currency)})` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.s1, flexShrink: 0 }}>
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Include all items"
            onPress={() => handleSelectAll(true)}
            style={{ minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.raw.surface, borderWidth: 1, borderColor: ts.border.primary20, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[Typography.micro, { color: ts.text.onSurface }]}>All</Text>
          </ScalePressable>
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Exclude all items"
            onPress={() => handleSelectAll(false)}
            style={{ minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.raw.surface, borderWidth: 1, borderColor: ts.border.primary20, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[Typography.micro, { color: ts.text.onSurface }]}>None</Text>
          </ScalePressable>
        </View>
      </LinearGradient>

      {previewItems.map((item) => (
        <PreviewRow
          key={item.id}
          item={item}
          category={item.expense.category ? categoryById.get(item.expense.category) : undefined}
          onToggle={(included) => handleToggleItem(item.id, included)}
          onEdit={() => openEdit(item)}
        />
      ))}
    </View>
  );

  const renderSuccess = () => {
    if (!commitResult) return null;
    const skipped = commitResult.skipped;
    const failed = commitResult.failed;
    return (
      <View style={{ alignItems: 'center', gap: Spacing.s3, paddingTop: Spacing.s6 }}>
        <View style={{ width: 64, height: 64, borderRadius: Radii.full, backgroundColor: ts.raw.successContainer, alignItems: 'center', justifyContent: 'center' }}>
          <Check size={30} color={ts.raw.successText} strokeWidth={3} />
        </View>
        <Text style={[Typography.headlineMd, { color: ts.text.onSurface, textAlign: 'center' }]}>
          {commitResult.imported} transaction{commitResult.imported === 1 ? '' : 's'} imported
        </Text>
        <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, textAlign: 'center', maxWidth: 320 }]}>
          {skipped > 0
            ? `${skipped} item${skipped === 1 ? '' : 's'} skipped${failed > 0 ? `, ${failed} failed` : ''}.`
            : failed > 0
              ? `${failed} item${failed === 1 ? '' : 's'} failed to import.`
              : 'Written to your on-device ledger.'}
        </Text>

        {failed > 0 && commitResult.errors.length > 0 ? (
          <LuminousCard variant="low" style={{ padding: Spacing.s3, width: '100%' }}>
            {commitResult.errors.map((error, index) => (
              <Text key={index} style={[Typography.micro, { color: ts.text.error, marginTop: index === 0 ? 0 : 2 }]}>{error}</Text>
            ))}
          </LuminousCard>
        ) : null}

        <LuminousCard variant="high" style={{ padding: Spacing.s3, width: '100%', maxWidth: 360, gap: Spacing.s2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
            <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Returning to origin</Text>
            <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>{(returnRemainingMs / 1000).toFixed(1)}s</Text>
          </View>
          <View style={{ height: 6, borderRadius: Radii.full, backgroundColor: ts.bg.primary20, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${(returnRemainingMs / AUTO_RETURN_MS) * 100}%`, backgroundColor: ts.raw.primary }} />
          </View>
          <PeachButton title="Return Now" onPress={returnToOrigin} variant="secondary" size="sm" fullWidth />
        </LuminousCard>
      </View>
    );
  };

  const renderEditDrawer = () => {
    if (!editItemId) return null;
    const selectedCategory = categoryById.get(editCategoryId);
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: ts.bg.overlay }]}
          onPress={closeEdit}
          accessibilityRole="button"
          accessibilityLabel="Dismiss edit"
        />
        <KeyboardAvoidingView
          style={StyleSheet.absoluteFill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <View
              accessibilityViewIsModal
              style={{
                width: '100%',
                maxWidth: MAX_CONTENT_WIDTH,
                alignSelf: 'center',
                maxHeight: sheetMaxHeight,
                backgroundColor: ts.raw.surface,
                borderTopLeftRadius: Radii.xl,
                borderTopRightRadius: Radii.xl,
                borderTopWidth: 1,
                borderColor: ts.border.card,
                paddingTop: Spacing.s3,
                paddingHorizontal: Spacing.s5,
                paddingBottom: Math.max(Spacing.s5, insets.bottom),
              }}
            >
              <View style={{ width: 40, height: 4, borderRadius: Radii.full, backgroundColor: ts.raw.outline, alignSelf: 'center', marginBottom: Spacing.s3 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3, paddingBottom: Spacing.s3, borderBottomWidth: 1, borderBottomColor: ts.border.subtle }}>
                <Text style={[Typography.bodyBold, { color: ts.text.onSurface, flexShrink: 1 }]}>Edit Parsed Transaction</Text>
                <ScalePressable
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel="Close edit"
                  onPress={closeEdit}
                  hitSlop={CLOSE_HIT_SLOP}
                  style={{ width: CLOSE_SIZE, height: CLOSE_SIZE, borderRadius: Radii.full, backgroundColor: ts.bg.low, alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={15} color={ts.icon.muted} />
                </ScalePressable>
              </View>

              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingVertical: Spacing.s3, gap: Spacing.s3 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={{ gap: Spacing.s1 }}>
                  <Text style={[Typography.captionBold, { color: ts.text.onSurfaceVariant }]}>Merchant Title</Text>
                  <TextInput
                    value={editMerchant}
                    onChangeText={setEditMerchant}
                    placeholder="Merchant name"
                    placeholderTextColor={ts.text.onSurfaceVariant}
                    selectionColor={ts.raw.primary}
                    accessibilityLabel="Merchant title"
                    style={[Typography.bodyMd, { color: ts.text.onSurface, backgroundColor: ts.bg.low, borderColor: ts.border.subtle, borderWidth: 1, borderRadius: Radii.md, minHeight: 44, paddingHorizontal: Spacing.s3 }]}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: Spacing.s3 }}>
                  <View style={{ flex: 1, minWidth: 0, gap: Spacing.s1 }}>
                    <Text style={[Typography.captionBold, { color: ts.text.onSurfaceVariant }]}>Amount</Text>
                    <TextInput
                      value={editAmount}
                      onChangeText={setEditAmount}
                      placeholder="0.00"
                      placeholderTextColor={ts.text.onSurfaceVariant}
                      selectionColor={ts.raw.primary}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Amount"
                      style={[Typography.bodyMd, { color: ts.text.onSurface, backgroundColor: ts.bg.low, borderColor: ts.border.subtle, borderWidth: 1, borderRadius: Radii.md, minHeight: 44, paddingHorizontal: Spacing.s3 }]}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 0, gap: Spacing.s1 }}>
                    <Text style={[Typography.captionBold, { color: ts.text.onSurfaceVariant }]}>Category</Text>
                    <ScalePressable
                      haptic={false}
                      accessibilityRole="button"
                      accessibilityLabel={`Category ${selectedCategory?.title ?? 'not set'}. Change category`}
                      onPress={() => setEditPickerOpen(true)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.md, backgroundColor: ts.bg.primary10, borderWidth: 1, borderColor: ts.border.primary20 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 }}>
                        <CategoryGlyph iconName={selectedCategory?.icon_name} size={16} color={ts.text.primary} />
                        <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>
                          {selectedCategory?.title ?? 'Select category'}
                        </Text>
                      </View>
                      <ChevronRight size={12} color={ts.text.primary} />
                    </ScalePressable>
                  </View>
                </View>

                {editError ? (
                  <Text accessibilityLiveRegion="polite" style={[Typography.micro, { color: ts.text.error }]}>{editError}</Text>
                ) : null}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: Spacing.s2, paddingTop: Spacing.s3, borderTopWidth: 1, borderTopColor: ts.border.subtle }}>
                <PeachButton title="Save Item Changes" onPress={() => { void saveEdit(); }} variant="primary" size="lg" fullWidth style={{ flex: 1 }} />
                <PeachButton title="Cancel" onPress={closeEdit} variant="quiet" size="lg" fullWidth style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: ts.bg.screen }} edges={['top']}>
      <View style={{ paddingHorizontal: Spacing.s5, paddingTop: Spacing.s3, paddingBottom: Spacing.s3, borderBottomWidth: 1, borderBottomColor: ts.border.subtle }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
          <ScalePressable
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={handleBack}
            hitSlop={BACK_HIT_SLOP}
            style={{ width: BACK_SIZE, height: BACK_SIZE, borderRadius: Radii.full, backgroundColor: ts.bg.low, alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeft size={18} color={ts.text.onSurface} />
          </ScalePressable>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: Spacing.s2 }}>
            <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>{headerTitle}</Text>
            <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.primary }]}>{headerSubtitle}</Text>
          </View>
          <View style={{ width: BACK_SIZE, height: BACK_SIZE }} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s4, paddingBottom: Spacing.s9, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {view === 'method' ? renderMethod() : null}
        {view === 'input' ? renderInput() : null}
        {view === 'preview' ? renderPreview() : null}
        {view === 'success' ? renderSuccess() : null}
      </ScrollView>

      {view === 'preview' ? (
        <View style={{ paddingHorizontal: Spacing.s5, paddingTop: Spacing.s3, paddingBottom: Math.max(Spacing.s4, insets.bottom), borderTopWidth: 1, borderTopColor: ts.border.subtle, backgroundColor: ts.raw.surface }}>
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: Spacing.s2 }}>
            <PeachButton
              title={importButtonLabel}
              onPress={() => { void handleCommit(); }}
              variant={summary.count > 0 && !busy ? 'primary' : 'disabled'}
              disabled={summary.count === 0 || busy !== null}
              isLoading={busy === 'commit'}
              size="lg"
              fullWidth
            />
            <ScalePressable
              haptic
              accessibilityRole="button"
              accessibilityLabel="Cancel and return to settings"
              onPress={returnToOrigin}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Cancel and Return to Settings</Text>
            </ScalePressable>
          </View>
        </View>
      ) : null}

      {renderEditDrawer()}

      <CategoryPickerSheet
        visible={editPickerOpen}
        categories={categories}
        selectedId={editCategoryId}
        flowType="expense"
        originLabel={editMerchant.trim() || undefined}
        onSelect={(category) => { setEditCategoryId(category.id); setEditPickerOpen(false); }}
        onClose={() => setEditPickerOpen(false)}
      />

      <AIProcessingOverlay
        visible={busy === 'parse'}
        contextLabel="Import parse"
        title="Parsing statement"
        description="Normalizing rows, checking required fields, and probing for duplicates."
      />
    </SafeAreaView>
  );
}
