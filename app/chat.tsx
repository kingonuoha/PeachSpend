import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Paperclip,
  RotateCcw,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { Colors, Radii, Spacing, Typography, Gradients } from '../constants/tokens';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useSettings } from '../components/ui/SettingsProvider';
import { useToast } from '../components/ui/ToastProvider';
import { LuminousCard } from '../components/ui/LuminousCard';
import { PeachButton } from '../components/ui/PeachButton';
import { ScalePressable } from '../components/ui/ScalePressable';
import { SearchFilterBar } from '../components/ui/SearchFilterBar';
import { AIProcessingOverlay } from '../components/capture/AIProcessingOverlay';
import { ScopedMarkdown } from '../components/chat/ScopedMarkdown';
import { ChatChartView } from '../components/chat/ChatChartView';
import { aiChatService } from '../services/AIChatService';
import { databaseService } from '../services/DatabaseService';
import { notificationService } from '../services/NotificationService';
import { useAchievements } from '../components/ui/AchievementProvider';
import { getAiErrorMessage, normalizeAiError, type AiErrorCode, type AiProvider } from '../ai/contracts';
import { geminiClient, openRouterClient } from '../ai/providerClients';
import { searchExpenses, type ChatSearchResponse, type SemanticSearchContext } from '../ai/semanticSearch';
import { buildComparisonChart, buildDonutChart, type ChatChartSpec } from '../ai/chatCharts';
import {
  type ChatActionKind,
  type ChatActionResult,
  type ChatActionRequest,
  type ChatDeepLink,
  type ChatTier2Approval,
} from '../ai/chatActions';
import type { ProviderKeyState } from '../data/ProviderSettings';
import type { ChatAction } from '../types/chat';
import type { ChatMessage, Expense } from '../types/database';
import type { DuplicateMatch, CaptureSideEffectHooks } from '../data/contracts';
import { formatCurrency } from '../utils/currency';
import { formatRelativeDateWithTime } from '../utils/dateFormat';

const UNDO_WINDOW_MS = 10_000;
const MODEL_SHEET_MAX_HEIGHT_RATIO = 0.85;
// Tablet content bound, matching the other rebuilt Phase 05 screens.
const MAX_CONTENT_WIDTH = 640;

type Role = 'user' | 'assistant' | 'system';
type EntryKind =
  | 'user_text'
  | 'assistant_text'
  | 'system'
  | 'confirmation'
  | 'duplicate'
  | 'approval'
  | 'unauthorized_action'
  | 'blocked'
  | 'chart'
  | 'search'
  | 'import_approval'
  | 'error';

interface ConfirmationPayload {
  expenseId: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  categoryTitle: string;
  date: string;
}

interface DuplicatePayload {
  match: DuplicateMatch;
  action: ChatAction;
}

interface ApprovalPayload {
  request: ChatActionRequest;
  approval: ChatTier2Approval;
}

// FR-12.1/FR-12.6: the import batch confirmation. It carries the Tier 2 approval
// descriptor and the parsed rows, but no writable request, so the import confirm
// path can never reach the chat batch-write boundary. Confirm hands the batch to
// S-12's single shared preview, which owns the only import commit.
interface ImportApprovalPayload {
  approval: ChatTier2Approval;
}

// S-05R-03: a model-emitted logging action that did not come from a user logging
// request is held here until the user explicitly confirms or discards it.
interface UnauthorizedActionPayload {
  action: ChatAction;
}

interface ChatEntry {
  id: string;
  role: Role;
  createdAt: number;
  kind: EntryKind;
  text: string;
  imageUri?: string;
  model?: string;
  confirmation?: ConfirmationPayload;
  duplicate?: DuplicatePayload;
  approval?: ApprovalPayload;
  importApproval?: ImportApprovalPayload;
  importBatch?: Partial<Expense>[];
  unauthorizedAction?: UnauthorizedActionPayload;
  deepLink?: ChatDeepLink;
  chart?: ChatChartSpec;
  search?: ChatSearchResponse;
  errorCode?: AiErrorCode;
  retryable?: boolean;
}

interface AttachedImage {
  uri: string;
  name: string;
  size?: number;
}

interface UndoState {
  expenseId: string;
  label: string;
  remaining: number;
}

const TIER3_REFUSAL_TEXT =
  'I cannot run destructive actions like clearing data or resetting your account from chat. Open Data Stewardship in Settings to do that yourself.';
const TIER2_UNSUPPORTED_TEXT =
  'That change does not have a supported action boundary from chat yet, so nothing was changed.';
const IMPORT_EMPTY_TEXT =
  'I could not find any transactions to import. Paste one transaction per line with a merchant and an amount, or attach a receipt image.';
const SUGGESTED_PROMPTS = [
  'How much did I spend this month?',
  'Am I on track with my budget?',
  'Log an expense at a merchant for a category',
  'Show my recent expenses',
];

function localId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function humanizeCategory(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// FR-12.6: the batch is gated by the existing Tier 2 `log_expenses_bulk`
// approval. The executor's `request` branch reads only the item count to describe
// the approval, and the import confirm path never reaches its write branch (it
// routes to S-12), so the parsed values are carried for the request shape only
// and no default value can be written or rendered.
function toApprovalActions(batch: Partial<Expense>[]): ChatAction[] {
  return batch.map((row) => ({
    action: 'log_expense',
    merchant: row.merchant,
    amount: row.amount,
    category: row.category,
    note: row.note,
    date: typeof row.date === 'number' ? new Date(row.date).toISOString().slice(0, 10) : undefined,
  } as ChatAction));
}

function formatFileSize(size?: number): string | null {
  if (!size || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parseExpenseConfirmation(content: string): ConfirmationPayload | null {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    if (
      data.action !== 'expense_logged' ||
      typeof data.id !== 'string' ||
      !data.id ||
      typeof data.merchant !== 'string' ||
      !data.merchant ||
      typeof data.amount !== 'number' ||
      !Number.isFinite(data.amount) ||
      typeof data.currency !== 'string' ||
      !data.currency.trim() ||
      typeof data.category !== 'string' ||
      !data.category ||
      typeof data.date !== 'string'
    ) {
      return null;
    }
    return {
      expenseId: data.id,
      merchant: data.merchant,
      amount: data.amount,
      currency: data.currency,
      category: data.category,
      categoryTitle: data.category,
      date: data.date,
    };
  } catch {
    return null;
  }
}

function entriesFromHistory(history: ChatMessage[]): ChatEntry[] {
  return history.flatMap<ChatEntry>((message) => {
    if (message.message_type === 'expense_confirmation') {
      const confirmation = parseExpenseConfirmation(message.content);
      if (!confirmation) return [];
      return [{
        id: message.id,
        role: 'assistant',
        createdAt: message.created_at,
        kind: 'confirmation',
        text: '',
        confirmation,
        model: message.model,
      }];
    }
    const role: Role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant';
    return [{
      id: message.id,
      role,
      createdAt: message.created_at,
      kind: role === 'user' ? 'user_text' : role === 'system' ? 'system' : 'assistant_text',
      text: message.content,
      imageUri: message.image_uri,
      model: message.model,
    }];
  });
}

// Tier 3 is fixed by the action kind, so the screen only routes a request to the
// executor; the executor is what hard-blocks it. The keyword pass detects the
// intent, it never executes anything itself.
function detectTier3Kind(text: string): ChatActionKind | null {
  const value = text.toLowerCase();
  if (/chat history|conversation history/.test(value)) return null;
  const object = 'account|data|transactions?|history|records?|everything|app|ledger';
  const destructive =
    new RegExp(`(delete|erase|wipe|purge|clear|reset|remove)[^.!?]*\\b(${object})\\b`).test(value) ||
    new RegExp(`\\b(${object})\\b[^.!?]*(delete|erase|wipe|purge|clear|reset|remove)`).test(value);
  if (!destructive) return null;
  if (/biometric|fingerprint|face id/.test(value)) return 'biometric_toggle';
  if (/convert|currency|exchange rate/.test(value)) return 'bulk_currency_conversion';
  if (/account/.test(value) && /(delete|remove|erase)/.test(value)) return 'delete_account_data';
  if (/reset/.test(value)) return 'reset_app';
  return 'clear_all_data';
}

function parseBudgetChange(text: string): number | null {
  const pattern = /(?:set|change|update|make|adjust)[^0-9]{0,40}budget[^0-9]{0,30}([\d,]+(?:\.\d+)?)/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseCurrencyChange(text: string): string | null {
  const pattern = /(?:set|change|update|switch|make)[^.!?]{0,40}currency[^A-Za-z]{0,12}([A-Za-z]{3})\b/i;
  const match = pattern.exec(text);
  if (!match) return null;
  return match[1].toUpperCase();
}

function isComparisonQuery(text: string): boolean {
  return /\bcompare|compared|versus|\bvs\b|last (week|month)|this (week|month)\b/i.test(text) && !isCategoryBreakdownQuery(text);
}

function isWeekComparison(text: string): boolean {
  return /week/i.test(text);
}

function isCategoryBreakdownQuery(text: string): boolean {
  return /(spending|spend|breakdown|break down|share).*(category|categories)|category (breakdown|share)|by category|top categories/i.test(text);
}

function isSearchQuery(text: string): boolean {
  return /\b(find|search|look for|receipts for|anything with|show me (?:all )?(?:my )?(?:receipts|transactions|purchases))\b/i.test(text);
}

function buildSearchSummary(response: ChatSearchResponse): string {
  const total = response.exact.length + response.semantic.length;
  if (total === 0) {
    if (response.semanticAvailability === 'offline') return 'No keyword matches found. Semantic search needs a connection, so it was skipped.';
    if (response.semanticAvailability === 'missing_key') return 'No keyword matches found. Add a provider key in S-17 to search by meaning.';
    if (response.semanticAvailability === 'provider_failed') return 'No keyword matches found. Semantic search is unavailable right now.';
    return 'No matching transactions found.';
  }
  const scope = [
    response.exact.length > 0 ? `${response.exact.length} exact` : null,
    response.semantic.length > 0 ? `${response.semantic.length} semantic` : null,
  ].filter((value): value is string => value !== null).join(', ');
  let summary = `Found ${total} transaction${total === 1 ? '' : 's'}${scope ? ` (${scope})` : ''}. Tap a result to open it.`;
  if (response.semanticAvailability === 'offline') summary += ' Semantic matches were skipped offline.';
  if (response.semanticAvailability === 'missing_key') summary += ' Add a provider key in S-17 to search by meaning.';
  if (response.semanticAvailability === 'provider_failed') summary += ' Semantic matching is unavailable right now.';
  return summary;
}

async function buildSearchContext(isOffline: boolean): Promise<SemanticSearchContext> {
  const provider: AiProvider = (await databaseService.getSetting('chat_provider')) === 'openrouter' ? 'openrouter' : 'gemini';
  const apiKey = provider === 'openrouter'
    ? await databaseService.getSecret('chat_openrouter_api_key')
    : await databaseService.getSecret('gemini_api_key');
  const model = provider === 'openrouter'
    ? (await databaseService.getSetting('chat_openrouter_model')) || 'openrouter/auto'
    : (await databaseService.getSetting('chat_gemini_model')) || 'gemini-2.5-flash';
  const client = provider === 'openrouter' ? openRouterClient : geminiClient;
  return { isConnected: !isOffline, provider, apiKey, model, client };
}

async function persistExchange(userText: string, assistantText: string, imageUri?: string): Promise<void> {
  const now = Date.now();
  await databaseService.saveChatMessage({
    role: 'user',
    content: userText,
    message_type: imageUri ? 'image' : 'text',
    image_uri: imageUri,
    created_at: now,
  });
  await databaseService.saveChatMessage({
    role: 'assistant',
    content: assistantText,
    message_type: 'text',
    created_at: now + 1,
  });
  await databaseService.updateSetting('chat_last_active', String(now));
}

// ---- Presentational pieces -------------------------------------------------

function UserBubble({ entry }: { entry: ChatEntry }) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(200)} style={{ alignItems: 'flex-end', paddingHorizontal: Spacing.s4, marginVertical: Spacing.s1 }}>
      <View
        style={{
          maxWidth: '85%',
          borderRadius: Radii.md,
          borderTopRightRadius: Spacing.s1,
          overflow: 'hidden',
        }}
      >
        <LinearGradient
          colors={ts.isDark ? Gradients.dark : Gradients.light}
          start={{ x: 0.33, y: 0 }}
          end={{ x: 0.67, y: 1 }}
          style={{ paddingHorizontal: Spacing.s4, paddingVertical: Spacing.s3 }}
        >
          <Text style={{ color: ts.raw.onPrimary, ...Typography.bodyRegular }}>{entry.text}</Text>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  const ts = useThemeStyles();
  return (
    <View style={{ alignItems: 'flex-start', paddingHorizontal: Spacing.s4, marginVertical: Spacing.s1 }}>
      <View style={{ maxWidth: '85%' }}>
        <LuminousCard
          variant="high"
          className="px-4 py-3"
          style={{ borderTopLeftRadius: Spacing.s1, backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }}
        >
          {children}
        </LuminousCard>
      </View>
    </View>
  );
}

function SystemPill({ text }: { text: string }) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(250)} style={{ alignItems: 'center', paddingHorizontal: Spacing.s6, marginVertical: Spacing.s2 }}>
      <View style={{ backgroundColor: ts.raw.purple100, borderRadius: Radii.full, paddingHorizontal: Spacing.s4, paddingVertical: Spacing.s2 }}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>{text}</Text>
      </View>
    </Animated.View>
  );
}

function ConfirmationCard({ payload }: { payload: ConfirmationPayload }) {
  const ts = useThemeStyles();
  const router = useRouter();
  return (
    <View style={{ gap: Spacing.s1 }}>
      <Text style={[Typography.labelBold, { color: ts.text.primary }]}>Expense Logged</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
        <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 1 }]}>
          {payload.merchant}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.labelBold, { color: ts.text.primary }]}>
          {formatCurrency(payload.amount, payload.currency)}
        </Text>
      </View>
      <Text numberOfLines={2} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        Category: {payload.categoryTitle} | {payload.date}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: ts.raw.outline, paddingTop: Spacing.s2, marginTop: Spacing.s1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
          <Check size={12} color={ts.raw.successText} />
          <Text style={[Typography.micro, { color: ts.raw.successText }]}>Ledger Committed</Text>
        </View>
        <ScalePressable
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Inspect expense detail"
          onPress={() => router.push(`/expense/${payload.expenseId}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, minHeight: 44, paddingHorizontal: Spacing.s2 }}
        >
          <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Inspect S-08</Text>
          <ArrowRight size={12} color={ts.text.primary} />
        </ScalePressable>
      </View>
    </View>
  );
}

function DuplicateCard({ payload, incomingCurrency, busy, onSaveAnyway, onDiscard }: {
  payload: DuplicatePayload;
  incomingCurrency: string;
  busy: boolean;
  onSaveAnyway: () => void;
  onDiscard: () => void;
}) {
  const ts = useThemeStyles();
  const existingName = 'source' in payload.match.existing ? payload.match.existing.source : payload.match.existing.merchant;
  return (
    <View style={{ gap: Spacing.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
        <AlertTriangle size={16} color={ts.raw.warning} />
        <Text style={[Typography.labelBold, { color: ts.raw.warningContainerText }]}>Possible Duplicate Transaction</Text>
      </View>
      <View style={{ backgroundColor: ts.bg.low, borderRadius: Radii.sm, borderWidth: 1, borderColor: ts.raw.warningBorder, padding: Spacing.s2, gap: Spacing.s1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.s2 }}>
          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 1 }]}>{payload.action.merchant}</Text>
          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>{formatCurrency(payload.action.amount, incomingCurrency)}</Text>
        </View>
        <Text numberOfLines={2} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
          Existing: {existingName} | {formatRelativeDateWithTime(payload.match.existing.date)}
        </Text>
      </View>
      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        Record this as an intentional duplicate, or discard it?
      </Text>
      <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
        <PeachButton
          title={busy ? 'Saving...' : 'Save Anyway'}
          onPress={onSaveAnyway}
          variant="primary"
          size="sm"
          disabled={busy}
          isLoading={busy}
          style={{ flex: 1 }}
        />
        <PeachButton title="Discard" onPress={onDiscard} variant="neutral" size="sm" disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function ApprovalCard({ summary, busy, onApprove, onCancel }: {
  summary: string;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const ts = useThemeStyles();
  return (
    <View style={{ gap: Spacing.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
          <View style={{ width: 8, height: 8, borderRadius: Radii.full, backgroundColor: ts.raw.primary }} />
          <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Requires In-Chat Approval</Text>
        </View>
        <View style={{ backgroundColor: ts.raw.purple100, borderRadius: Radii.sm, paddingHorizontal: Spacing.s1, paddingVertical: 1 }}>
          <Text style={[Typography.micro, { color: ts.text.primary }]}>Tier 2 Risk</Text>
        </View>
      </View>
      <View style={{ borderRadius: Radii.sm, borderWidth: 1, borderColor: ts.border.primary20, padding: Spacing.s2, backgroundColor: ts.bg.low }}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>{summary}</Text>
      </View>
      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        Nothing is written until you authorize it. This has no undo window.
      </Text>
      <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
        <PeachButton
          title="Authorize"
          onPress={onApprove}
          variant="primary"
          size="sm"
          disabled={busy}
          isLoading={busy}
          style={{ flex: 1 }}
        />
        <PeachButton title="Cancel" onPress={onCancel} variant="neutral" size="sm" disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function UnauthorizedActionCard({ payload, incomingCurrency, busy, onConfirm, onDiscard }: {
  payload: UnauthorizedActionPayload;
  incomingCurrency: string;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const ts = useThemeStyles();
  return (
    <View style={{ gap: Spacing.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
        <ShieldAlert size={16} color={ts.raw.warning} />
        <Text style={[Typography.labelBold, { color: ts.raw.warningContainerText }]}>Needs Your Confirmation</Text>
      </View>
      <View style={{ backgroundColor: ts.bg.low, borderRadius: Radii.sm, borderWidth: 1, borderColor: ts.raw.warningBorder, padding: Spacing.s2, gap: Spacing.s1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.s2 }}>
          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 1 }]}>{payload.action.merchant}</Text>
          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>{formatCurrency(payload.action.amount, incomingCurrency)}</Text>
        </View>
      </View>
      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        The assistant suggested this expense, but you did not ask to log it. Confirm to save it, or discard it.
      </Text>
      <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
        <PeachButton
          title={busy ? 'Saving...' : 'Confirm Save'}
          onPress={onConfirm}
          variant="primary"
          size="sm"
          disabled={busy}
          isLoading={busy}
          style={{ flex: 1 }}
        />
        <PeachButton title="Discard" onPress={onDiscard} variant="neutral" size="sm" disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function BlockedCard({ deepLink, onOpenStewardship }: { deepLink: ChatDeepLink; onOpenStewardship: () => void }) {
  const ts = useThemeStyles();
  return (
    <View style={{ gap: Spacing.s2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
        <ShieldAlert size={16} color={ts.raw.danger} />
        <Text style={[Typography.labelBold, { color: ts.raw.danger }]}>Destructive Action Guard</Text>
      </View>
      <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>{TIER3_REFUSAL_TEXT}</Text>
      <PeachButton
        title="Open S-06 Data Stewardship"
        onPress={onOpenStewardship}
        variant="destructive"
        size="sm"
        fullWidth
        trailingIcon={<ArrowRight size={14} color={ts.raw.danger} />}
      />
      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
        Target: {deepLink.screen} {deepLink.section.replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

function ChartCard({ chart, onOpenInsights }: { chart: ChatChartSpec; onOpenInsights: () => void }) {
  const ts = useThemeStyles();
  const isComparison = chart.kind === 'bar' && chart.data.length === 2;
  const delta = isComparison ? chart.data[0].value - chart.data[1].value : 0;
  const previous = isComparison ? chart.data[1].value : 0;
  const deltaPct = previous > 0 ? (delta / previous) * 100 : null;
  return (
    <View style={{ gap: Spacing.s2 }}>
      <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>{chart.title}</Text>
      <ChatChartView spec={chart} />
      {deltaPct !== null ? (
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
          Delta: {delta >= 0 ? '+' : ''}{deltaPct.toFixed(1)}% ({formatCurrency(delta, chart.currency)})
        </Text>
      ) : null}
      <ScalePressable
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel="Deep dive in Insights"
        onPress={onOpenInsights}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Deep Dive in S-03 Insights</Text>
      </ScalePressable>
    </View>
  );
}

function SearchCard({ response, onOpenResult }: { response: ChatSearchResponse; onOpenResult: (expenseId: string) => void }) {
  const ts = useThemeStyles();
  const results = [...response.exact, ...response.semantic];
  return (
    <View style={{ gap: Spacing.s2 }}>
      {results.map((result) => (
        <ScalePressable
          key={result.expenseId}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel={`Open ${result.merchant} expense detail`}
          onPress={() => onOpenResult(result.expenseId)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: Spacing.s2,
            padding: Spacing.s2,
            borderRadius: Radii.sm,
            borderWidth: 1,
            borderColor: ts.raw.outline,
            backgroundColor: ts.bg.low,
            minHeight: 48,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
              <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 1 }]}>
                {result.merchant}
              </Text>
              <View
                style={{
                  borderRadius: Radii.sm,
                  paddingHorizontal: Spacing.s1,
                  paddingVertical: 1,
                  backgroundColor: result.matchType === 'exact' ? ts.bg.primary10 : ts.bg.primary20,
                }}
              >
                <Text style={[Typography.micro, { color: ts.text.primary }]}>
                  {result.matchType === 'exact' ? 'Exact Match' : 'Semantic Match'}
                </Text>
              </View>
            </View>
            <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
              {new Date(result.date).toLocaleDateString()} | {result.category}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.labelBold, { color: ts.text.onSurface }]}>
              {formatCurrency(result.amount, result.currency)}
            </Text>
            <Text style={[Typography.micro, { color: ts.text.primary }]}>View S-08</Text>
          </View>
        </ScalePressable>
      ))}
      {(response.semanticAvailability === 'offline' ||
        response.semanticAvailability === 'missing_key' ||
        response.semanticAvailability === 'provider_failed') ? (
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
          {response.semanticAvailability === 'offline'
            ? 'Semantic matches need a connection.'
            : response.semanticAvailability === 'missing_key'
              ? 'Add a provider key in S-17 to search by meaning.'
              : 'Semantic matching is unavailable right now.'}
        </Text>
      ) : null}
    </View>
  );
}

function ErrorCard({ text, retryable, code, onRetry, onOpenSettings }: {
  text: string;
  retryable: boolean;
  code?: AiErrorCode;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const ts = useThemeStyles();
  return (
    <View style={{ gap: Spacing.s2 }}>
      <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>{text}</Text>
      {code === 'missing_key' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, padding: Spacing.s2, borderRadius: Radii.sm, backgroundColor: ts.raw.warningContainer, borderWidth: 1, borderColor: ts.raw.warningBorder }}>
          <Lock size={14} color={ts.raw.warning} />
          <Text style={[Typography.micro, { color: ts.raw.warningContainerText, flex: 1 }]}>
            Keys live in S-17. Chat never collects a key inline.
          </Text>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Configure key in S-17"
            onPress={onOpenSettings}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.s2 }}
          >
            <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Open S-17</Text>
          </ScalePressable>
        </View>
      ) : null}
      {retryable ? (
        <PeachButton
          title="Retry Request"
          onPress={onRetry}
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={14} color={ts.raw.primary} />}
        />
      ) : null}
    </View>
  );
}

// ---- Screen ----------------------------------------------------------------

export default function ChatScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();
  const { settings, updateSetting } = useSettings();
  const toast = useToast();
  const { checkForNewAchievements } = useAchievements();

  // FR-12.1: S-12 routes here with `intent=import`. The flag switches S-07 into
  // the import-context producer without changing the normal chat behaviour.
  const params = useLocalSearchParams<{ intent?: string }>();
  const importMode = params.intent === 'import';

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [inputText, setInputText] = useState('');
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<UndoState | null>(null);
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [activeModelId, setActiveModelId] = useState('');
  const [activeModelLabel, setActiveModelLabel] = useState('');
  const [keyState, setKeyState] = useState<ProviderKeyState | null>(null);
  const [geminiModels, setGeminiModels] = useState<{ name: string; displayName: string }[]>([]);
  const [orModels, setOrModels] = useState<{ id: string; displayName: string; isFree: boolean }[]>([]);
  const [showProviderSheet, setShowProviderSheet] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [isOffline, setIsOffline] = useState(false);

  const listRef = useRef<FlatList<ChatEntry>>(null);
  const lastSendRef = useRef<{ text: string; image: AttachedImage | null }>({ text: '', image: null });

  const pricesVisible = settings.prices_visible !== 'false';

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        await aiChatService.checkAutoExpiry();
        const history = await aiChatService.getHistory();
        if (active) setEntries(entriesFromHistory(history));
      } catch {
        if (active) setEntries([]);
      } finally {
        if (active) setLoadingHistory(false);
      }

      try {
        const stored = (await databaseService.getSetting('chat_provider')) === 'openrouter' ? 'openrouter' : 'gemini';
        const model = stored === 'openrouter'
          ? (await databaseService.getSetting('chat_openrouter_model')) || ''
          : (await databaseService.getSetting('chat_gemini_model')) || '';
        const display = stored === 'openrouter'
          ? (await databaseService.getSetting('chat_openrouter_model_display')) || model
          : (await databaseService.getSetting('chat_gemini_model_display')) || model;
        if (active) {
          setProvider(stored);
          setActiveModelId(model);
          setActiveModelLabel(display || model);
        }
      } catch {
        // Provider defaults remain; the sheet shows the honest empty state.
      }

      try {
        const nextKeyState = await aiChatService.getProviderKeyState();
        if (active) setKeyState(nextKeyState);
      } catch {
        if (active) setKeyState(null);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const update = (state: NetInfoState) => {
      if (active) setIsOffline(state.isConnected !== true || state.isInternetReachable !== true);
    };
    const unsubscribe = NetInfo.addEventListener(update);
    NetInfo.fetch().then(update).catch(() => {
      if (active) setIsOffline(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!pendingUndo) return;
    const interval = setInterval(() => {
      setPendingUndo((previous) => {
        if (!previous) return previous;
        const next = previous.remaining - 1;
        return next <= 0 ? null : { ...previous, remaining: next };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingUndo]);

  const undoRemaining = pendingUndo?.remaining ?? 0;

  useEffect(() => {
    if (entries.length > 0) {
      const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(timer);
    }
  }, [entries.length]);

  const categoryTitles = useCallback(async (): Promise<Map<string, string>> => {
    try {
      const categories = await databaseService.getCategories();
      return new Map(categories.map((category) => [category.id, category.title]));
    } catch {
      return new Map();
    }
  }, []);

  const runSideEffects = useCallback(async (result: ChatActionResult, request: ChatActionRequest) => {
    const hooks: CaptureSideEffectHooks = {
      onExpenseSaved: checkForNewAchievements,
      onIncomeSaved: async () => undefined,
      scheduleNotification: (candidate) => {
        if ('merchant' in candidate) {
          notificationService.scheduleExpenseNotification(candidate.merchant, `${candidate.currency} ${candidate.amount.toFixed(2)}`);
        }
      },
    };
    try {
      await aiChatService.runActionSideEffects(result, request, hooks);
    } catch {
      // Side effects are best effort; the expense is already saved.
    }
  }, [checkForNewAchievements]);

  const buildChartForQuery = useCallback(async (text: string): Promise<ChatChartSpec | null> => {
    const currency = settings.currency || 'NGN';
    try {
      if (isCategoryBreakdownQuery(text)) {
        const [totals, categories] = await Promise.all([
          databaseService.getExpensesByCategory(),
          databaseService.getCategories(),
        ]);
        const colorById = new Map(categories.map((category) => [category.id, category.color]));
        const titleById = new Map(categories.map((category) => [category.id, category.title]));
        const data = totals
          .filter((row) => row.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 6)
          .map((row) => ({ label: titleById.get(row.category) ?? humanizeCategory(row.category), value: row.total, color: colorById.get(row.category) || undefined }));
        if (data.length === 0) return null;
        return buildDonutChart('Spending by Category', currency, data);
      }
      if (isComparisonQuery(text)) {
        const week = isWeekComparison(text);
        const now = new Date();
        let currentStart: number;
        let currentEnd: number;
        let previousStart: number;
        let previousEnd: number;
        let currentLabel: string;
        let previousLabel: string;
        if (week) {
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const day = 86_400_000;
          currentStart = today - 6 * day;
          currentEnd = today + day - 1;
          previousStart = currentStart - 7 * day;
          previousEnd = currentStart - 1;
          currentLabel = 'This Week';
          previousLabel = 'Last Week';
        } else {
          currentStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
          previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
          previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime();
          currentLabel = 'This Month';
          previousLabel = 'Last Month';
        }
        const [current, previous] = await Promise.all([
          databaseService.getMonthlySummary(currentStart, currentEnd),
          databaseService.getMonthlySummary(previousStart, previousEnd),
        ]);
        return buildComparisonChart(
          'Spending Comparison',
          currency,
          { label: currentLabel, value: current.totalSpent },
          { label: previousLabel, value: previous.totalSpent },
        );
      }
      return null;
    } catch {
      return null;
    }
  }, [settings.currency]);

  const appendEntries = useCallback((next: ChatEntry[]) => {
    setEntries((prev) => [...prev, ...next]);
  }, []);

  const runSend = useCallback(async (rawText: string, image: AttachedImage | null, appendUser: boolean) => {
    const text = rawText.trim();
    if (!text && !image) return;

    // The exact text the user sent (image-only sends an honest placeholder). It is
    // the authorization input for the executor, so a model action is only allowed
    // when this message itself is a logging request.
    const userMessage = text || 'Attached image';

    lastSendRef.current = { text, image };

    if (appendUser) {
      appendEntries([{
        id: localId(),
        role: 'user',
        createdAt: Date.now(),
        kind: 'user_text',
        text: text || 'Attached image',
        imageUri: image?.uri,
      }]);
      setInputText('');
      setAttachedImage(null);
    }

    setIsProcessing(true);
    setProcessingImage(Boolean(image));

    try {
      // FR-12.1/FR-12.2: in import mode the send is a parse, not a chat turn. The
      // producer structures the input and writes nothing; the batch is gated by
      // the same Tier 2 `log_expenses_bulk` approval the rest of chat uses, then
      // handed to S-12's shared preview on confirm.
      if (importMode) {
        const batch = await aiChatService.extractImportBatch({ text, imageUri: image?.uri });
        if (batch.length === 0) {
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: IMPORT_EMPTY_TEXT }]);
          return;
        }
        const approval = await aiChatService.executeChatAction(
          { kind: 'log_expenses_bulk', items: toApprovalActions(batch) },
          'request',
        );
        if (approval.status !== 'requires_approval') {
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: TIER2_UNSUPPORTED_TEXT }]);
          return;
        }
        appendEntries([{
          id: localId(),
          role: 'assistant',
          createdAt: Date.now(),
          kind: 'import_approval',
          text: `I parsed ${batch.length} transaction${batch.length === 1 ? '' : 's'} from your pasted text. Please verify before writing to the ledger:`,
          importApproval: { approval: approval.approval },
          importBatch: batch,
        }]);
        return;
      }

      const tier3Kind = detectTier3Kind(text);
      if (tier3Kind) {
        const result = await aiChatService.executeChatAction({ kind: tier3Kind } as ChatActionRequest, 'request', userMessage);
        if (result.status === 'blocked') {
          await persistExchange(text || 'Attached image', TIER3_REFUSAL_TEXT, image?.uri);
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'blocked', text: TIER3_REFUSAL_TEXT, deepLink: result.deepLink }]);
        }
        return;
      }

      const budget = parseBudgetChange(text);
      const currencyCode = parseCurrencyChange(text);
      if (budget !== null || currencyCode !== null) {
        const request: ChatActionRequest = budget !== null
          ? { kind: 'update_budget', amount: budget }
          : { kind: 'update_currency', currency: currencyCode as string };
        const result = await aiChatService.executeChatAction(request, 'request', userMessage);
        if (result.status === 'requires_approval') {
          await persistExchange(text, `This change requires your approval: ${result.approval.summary}.`, image?.uri);
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'approval', text: result.approval.summary, approval: { request, approval: result.approval } }]);
        } else if (result.status === 'unsupported') {
          await persistExchange(text, TIER2_UNSUPPORTED_TEXT, image?.uri);
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: TIER2_UNSUPPORTED_TEXT }]);
        }
        return;
      }

      if (isSearchQuery(text)) {
        const expenses = await databaseService.getExpenses();
        const context = await buildSearchContext(isOffline);
        const response = await searchExpenses(expenses, text, context);
        const summary = buildSearchSummary(response);
        await persistExchange(text, summary, image?.uri);
        appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'search', text: summary, search: response }]);
        return;
      }

      const reply = await aiChatService.sendMessage(userMessage, image?.uri);

      // S-05R-03: only execute a model-emitted action when sendMessage marked it
      // authorized (the current user message is a logging request). The executor
      // is given the same user message so it independently refuses anything else.
      if (reply.action && reply.actionAuthorized) {
        const request: ChatActionRequest = { kind: 'log_expense', action: reply.action };
        const result = await aiChatService.executeChatAction(request, 'request', userMessage);
        if (result.status === 'not_authorized') {
          appendEntries([
            { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: reply.reply },
            { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'unauthorized_action', text: '', unauthorizedAction: { action: reply.action } },
          ]);
        } else if (result.status === 'saved') {
          await runSideEffects(result, request);
          const titles = await categoryTitles();
          setPendingUndo({ expenseId: result.expenseId, label: reply.action.merchant, remaining: UNDO_WINDOW_MS / 1000 });
          appendEntries([
            { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: reply.reply },
            {
              id: localId(),
              role: 'assistant',
              createdAt: Date.now(),
              kind: 'confirmation',
              text: '',
              confirmation: {
                expenseId: result.expenseId,
                merchant: reply.action.merchant,
                amount: reply.action.amount,
                currency: (await databaseService.getSetting('currency')) || settings.currency || 'NGN',
                category: reply.action.category,
                categoryTitle: titles.get(reply.action.category) ?? humanizeCategory(reply.action.category),
                date: reply.action.date === 'today' || !reply.action.date ? new Date().toLocaleDateString() : new Date(reply.action.date).toLocaleDateString(),
              },
            },
          ]);
        } else if (result.status === 'duplicate') {
          appendEntries([
            { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: reply.reply },
            { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'duplicate', text: '', duplicate: { match: result.duplicate, action: reply.action } },
          ]);
        } else if (result.status === 'discarded') {
          appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: 'No expense was saved.' }]);
        }
        return;
      }

      const chart = await buildChartForQuery(text);
      if (chart) {
        appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'chart', text: reply.reply, chart }]);
      } else {
        appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: reply.reply }]);
      }
    } catch (error) {
      const normalized = normalizeAiError(error, provider);
      const message = getAiErrorMessage(normalized.code);
      appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'error', text: message, errorCode: normalized.code, retryable: normalized.retryable }]);
      toast.showToast(message, 'error');
    } finally {
      setIsProcessing(false);
      setProcessingImage(false);
    }
  }, [appendEntries, buildChartForQuery, categoryTitles, importMode, isOffline, provider, runSideEffects, settings.currency, toast]);

  const handleSend = useCallback(() => {
    if (isProcessing) return;
    const text = inputText.trim();
    if (!text && !attachedImage) return;
    void runSend(text, attachedImage, true);
  }, [attachedImage, inputText, isProcessing, runSend]);

  const handleRetry = useCallback(() => {
    const { text, image } = lastSendRef.current;
    if (!text && !image) return;
    void runSend(text, image, false);
  }, [runSend]);

  const handleAttach = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    setAttachedImage({
      uri: asset.uri,
      name: asset.fileName || asset.uri.split('/').pop() || 'attachment',
      size: asset.fileSize ?? undefined,
    });
  }, []);

  const handleSuggestion = useCallback((prompt: string) => {
    if (isProcessing) return;
    void runSend(prompt, null, true);
  }, [isProcessing, runSend]);

  const handleUndo = useCallback(async () => {
    if (!pendingUndo) return;
    const { expenseId } = pendingUndo;
    try {
      await aiChatService.undoExpense(expenseId);
      setEntries((prev) => [
        ...prev.filter((entry) => entry.kind !== 'confirmation' || entry.confirmation?.expenseId !== expenseId),
        { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'system', text: 'The expense was removed from your ledger.' },
      ]);
      toast.showToast('Expense undone', 'success');
    } catch {
      toast.showToast('Failed to undo', 'error');
    } finally {
      setPendingUndo(null);
    }
  }, [pendingUndo, toast]);

  const resolveDuplicate = useCallback(async (entry: ChatEntry, decision: 'save_anyway' | 'discard') => {
    if (!entry.duplicate || actionBusy) return;
    setActionBusy(true);
    try {
      const request: ChatActionRequest = { kind: 'log_expense', action: entry.duplicate.action };
      const result = await aiChatService.executeChatAction(request, decision);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (result.status === 'saved') {
        await runSideEffects(result, request);
        const titles = await categoryTitles();
        const currency = (await databaseService.getSetting('currency')) || settings.currency || 'NGN';
        setPendingUndo({ expenseId: result.expenseId, label: entry.duplicate.action.merchant, remaining: UNDO_WINDOW_MS / 1000 });
        appendEntries([{
          id: localId(),
          role: 'assistant',
          createdAt: Date.now(),
          kind: 'confirmation',
          text: '',
          confirmation: {
            expenseId: result.expenseId,
            merchant: entry.duplicate.action.merchant,
            amount: entry.duplicate.action.amount,
            currency,
            category: entry.duplicate.action.category,
            categoryTitle: titles.get(entry.duplicate.action.category) ?? humanizeCategory(entry.duplicate.action.category),
            date: new Date().toLocaleDateString(),
          },
        }]);
      } else {
        appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'system', text: 'Duplicate discarded. No duplicate was saved.' }]);
      }
    } catch {
      toast.showToast('Could not resolve the duplicate. Nothing was saved.', 'error');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, appendEntries, categoryTitles, runSideEffects, settings.currency, toast]);

  // S-05R-03: resolve a held model-emitted expense. Confirming re-runs the exact
  // Tier 1 path with no user message, which is the explicit user authorization the
  // executor requires; discarding only drops the card and writes nothing.
  const resolveUnauthorized = useCallback(async (entry: ChatEntry, decision: 'confirm' | 'discard') => {
    if (!entry.unauthorizedAction || actionBusy) return;
    const action = entry.unauthorizedAction.action;
    const request: ChatActionRequest = { kind: 'log_expense', action };
    if (decision === 'discard') {
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'system', text: 'No expense was saved.' }]);
      return;
    }
    setActionBusy(true);
    try {
      const result = await aiChatService.executeChatAction(request, 'request');
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (result.status === 'saved') {
        await runSideEffects(result, request);
        const titles = await categoryTitles();
        const currency = (await databaseService.getSetting('currency')) || settings.currency || 'NGN';
        setPendingUndo({ expenseId: result.expenseId, label: action.merchant, remaining: UNDO_WINDOW_MS / 1000 });
        appendEntries([{
          id: localId(),
          role: 'assistant',
          createdAt: Date.now(),
          kind: 'confirmation',
          text: '',
          confirmation: {
            expenseId: result.expenseId,
            merchant: action.merchant,
            amount: action.amount,
            currency,
            category: action.category,
            categoryTitle: titles.get(action.category) ?? humanizeCategory(action.category),
            date: action.date === 'today' || !action.date ? new Date().toLocaleDateString() : new Date(action.date).toLocaleDateString(),
          },
        }]);
      } else if (result.status === 'duplicate') {
        appendEntries([
          { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: 'That looks like an existing transaction. Save Anyway to keep it, or Discard.' },
          { id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'duplicate', text: '', duplicate: { match: result.duplicate, action } },
        ]);
      } else {
        appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'system', text: 'No expense was saved.' }]);
      }
    } catch {
      toast.showToast('Could not save the expense. Nothing was changed.', 'error');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, appendEntries, categoryTitles, runSideEffects, settings.currency, toast]);

  const resolveApproval = useCallback(async (entry: ChatEntry, decision: 'approve' | 'discard') => {
    if (!entry.approval || actionBusy) return;
    setActionBusy(true);
    try {
      const result = await aiChatService.executeChatAction(entry.approval.request, decision);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      const message = (() => {
        if (result.status === 'batch_saved') return `Saved ${result.expenseIds.length} expense${result.expenseIds.length === 1 ? '' : 's'}.`;
        if (result.status === 'settings_applied') return 'Your change was applied.';
        if (result.status === 'batch_needs_review') return 'Some items matched existing records and need review. Nothing was changed here.';
        if (result.status === 'unsupported') return TIER2_UNSUPPORTED_TEXT;
        if (result.status === 'discarded') return 'Operation cancelled. No changes were made.';
        return 'The action could not be completed. Nothing was changed.';
      })();
      appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'assistant_text', text: message }]);
    } catch {
      toast.showToast('Could not complete the action. Nothing was changed.', 'error');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, appendEntries, toast]);

  // FR-12.1/FR-12.6: the chat hand-off never writes. Confirm consumes the Tier 2
  // card and hands the parsed batch to S-12's single shared preview
  // (prepareImportPreview), where the one import commit boundary lives. Cancel
  // drops the card and stages nothing.
  const resolveImportApproval = useCallback((entry: ChatEntry, decision: 'approve' | 'discard') => {
    if (!entry.importBatch || entry.importBatch.length === 0) return;
    setEntries((prev) => prev.filter((item) => item.id !== entry.id));
    if (decision === 'approve') {
      router.replace({ pathname: '/import', params: { parsed: JSON.stringify(entry.importBatch) } });
    } else {
      appendEntries([{ id: localId(), role: 'assistant', createdAt: Date.now(), kind: 'system', text: 'No import was started.' }]);
    }
  }, [appendEntries, router]);

  const togglePrivacy = useCallback(async () => {
    try {
      await updateSetting('prices_visible', pricesVisible ? 'false' : 'true');
    } catch {
      toast.showToast('Could not update the privacy setting.', 'error');
    }
  }, [pricesVisible, toast, updateSetting]);

  const openProviderSheet = useCallback(async () => {
    setModelSearch('');
    setShowProviderSheet(true);
    try {
      if (provider === 'openrouter') setOrModels(await aiChatService.getCachedOpenRouterModels());
      else setGeminiModels(await aiChatService.getCachedGeminiModels());
    } catch {
      // An empty list renders the honest "no models cached" state.
    }
  }, [provider]);

  const loadModelsFor = useCallback(async (next: AiProvider) => {
    try {
      if (next === 'openrouter') setOrModels(await aiChatService.getCachedOpenRouterModels());
      else setGeminiModels(await aiChatService.getCachedGeminiModels());
    } catch {
      // An empty list renders the honest "no models cached" state.
    }
  }, []);

  const selectProvider = useCallback(async (next: AiProvider) => {
    setProvider(next);
    await databaseService.updateSetting('chat_provider', next);
    if (next === 'openrouter') {
      const model = (await databaseService.getSetting('chat_openrouter_model')) || '';
      const display = (await databaseService.getSetting('chat_openrouter_model_display')) || model;
      setActiveModelId(model);
      setActiveModelLabel(display || model);
    } else {
      const model = (await databaseService.getSetting('chat_gemini_model')) || '';
      const display = (await databaseService.getSetting('chat_gemini_model_display')) || model;
      setActiveModelId(model);
      setActiveModelLabel(display || model);
    }
    setModelSearch('');
    await loadModelsFor(next);
  }, [loadModelsFor]);

  const selectModel = useCallback(async (id: string, display: string) => {
    if (provider === 'openrouter') {
      await databaseService.updateSetting('chat_openrouter_model', id);
      await databaseService.updateSetting('chat_openrouter_model_display', display);
    } else {
      await databaseService.updateSetting('chat_gemini_model', id);
      await databaseService.updateSetting('chat_gemini_model_display', display);
    }
    setActiveModelId(id);
    setActiveModelLabel(display);
    setShowProviderSheet(false);
    toast.showToast(`Active model set to ${display}`, 'success');
  }, [provider, toast]);

  const missingActiveKey = keyState ? keyState[provider].status === 'absent' : false;

  const filteredModels = useMemo<{ id: string; displayName: string; isFree?: boolean }[]>(() => {
    const query = modelSearch.trim().toLowerCase();
    if (provider === 'openrouter') {
      return orModels
        .filter((model) => !query || model.displayName.toLowerCase().includes(query) || model.id.toLowerCase().includes(query))
        .map((model) => ({ id: model.id, displayName: model.displayName, isFree: model.isFree }));
    }
    return geminiModels
      .filter((model) => !query || model.displayName.toLowerCase().includes(query) || model.name.toLowerCase().includes(query))
      .map((model) => ({ id: model.name, displayName: model.displayName }));
  }, [geminiModels, modelSearch, orModels, provider]);

  const renderEntry = useCallback((entry: ChatEntry) => {
    if (entry.kind === 'user_text') return <UserBubble entry={entry} />;
    if (entry.kind === 'system') return <SystemPill text={entry.text} />;
    if (entry.kind === 'confirmation' && entry.confirmation) return <AssistantBubble><ConfirmationCard payload={entry.confirmation} /></AssistantBubble>;
    if (entry.kind === 'duplicate' && entry.duplicate) {
      return (
        <AssistantBubble>
          <DuplicateCard
            payload={entry.duplicate}
            incomingCurrency={settings.currency || 'NGN'}
            busy={actionBusy}
            onSaveAnyway={() => { void resolveDuplicate(entry, 'save_anyway'); }}
            onDiscard={() => { void resolveDuplicate(entry, 'discard'); }}
          />
        </AssistantBubble>
      );
    }
    if (entry.kind === 'approval' && entry.approval) {
      return (
        <AssistantBubble>
          <ApprovalCard
            summary={entry.approval.approval.summary}
            busy={actionBusy}
            onApprove={() => { void resolveApproval(entry, 'approve'); }}
            onCancel={() => { void resolveApproval(entry, 'discard'); }}
          />
        </AssistantBubble>
      );
    }
    if (entry.kind === 'import_approval' && entry.importApproval) {
      return (
        <AssistantBubble>
          <View style={{ gap: Spacing.s2 }}>
            <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>{entry.text}</Text>
            <ApprovalCard
              summary={entry.importApproval.approval.summary}
              busy={actionBusy}
              onApprove={() => resolveImportApproval(entry, 'approve')}
              onCancel={() => resolveImportApproval(entry, 'discard')}
            />
          </View>
        </AssistantBubble>
      );
    }
    if (entry.kind === 'unauthorized_action' && entry.unauthorizedAction) {
      return (
        <AssistantBubble>
          <UnauthorizedActionCard
            payload={entry.unauthorizedAction}
            incomingCurrency={settings.currency || 'NGN'}
            busy={actionBusy}
            onConfirm={() => { void resolveUnauthorized(entry, 'confirm'); }}
            onDiscard={() => { void resolveUnauthorized(entry, 'discard'); }}
          />
        </AssistantBubble>
      );
    }
    if (entry.kind === 'blocked' && entry.deepLink) {
      return <AssistantBubble><BlockedCard deepLink={entry.deepLink} onOpenStewardship={() => router.push('/(tabs)/settings')} /></AssistantBubble>;
    }
    if (entry.kind === 'chart' && entry.chart) {
      return (
        <AssistantBubble>
          <View style={{ gap: Spacing.s2 }}>
            <ChartCard chart={entry.chart} onOpenInsights={() => router.push('/(tabs)/analytics')} />
            {entry.text ? <ScopedMarkdown content={entry.text} /> : null}
          </View>
        </AssistantBubble>
      );
    }
    if (entry.kind === 'search' && entry.search) {
      return (
        <AssistantBubble>
          <View style={{ gap: Spacing.s2 }}>
            <ScopedMarkdown content={entry.text} />
            <SearchCard response={entry.search} onOpenResult={(id) => router.push(`/expense/${id}`)} />
          </View>
        </AssistantBubble>
      );
    }
    if (entry.kind === 'error') {
      return (
        <AssistantBubble>
          <ErrorCard
            text={entry.text}
            retryable={entry.retryable === true}
            code={entry.errorCode}
            onRetry={handleRetry}
            onOpenSettings={() => router.push('/settings/chat')}
          />
        </AssistantBubble>
      );
    }
    return (
      <AssistantBubble>
        <ScopedMarkdown content={entry.text} />
      </AssistantBubble>
    );
  }, [actionBusy, handleRetry, resolveApproval, resolveDuplicate, resolveImportApproval, resolveUnauthorized, router, settings.currency, ts]);

  const renderEmpty = useCallback(() => {
    if (loadingHistory) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.s6 }}>
          <ActivityIndicator color={ts.raw.primary} />
        </View>
      );
    }
    if (importMode) {
      return (
        <View style={{ paddingTop: Spacing.s4 }}>
          <AssistantBubble>
            <View style={{ gap: Spacing.s3 }}>
              <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>
                Paste transaction lines, bank SMS text, or attach a receipt image. I will structure them into a batch you review before anything is saved.
              </Text>
              <View style={{ gap: Spacing.s2, borderTopWidth: 1, borderTopColor: ts.raw.outline, paddingTop: Spacing.s3 }}>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1.2 }]}>
                  Prefer another method?
                </Text>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Import for CSV, paste, or the external prompt"
                  onPress={() => router.push('/import')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: Spacing.s2,
                    minHeight: 48,
                    paddingHorizontal: Spacing.s3,
                    paddingVertical: Spacing.s2,
                    borderRadius: Radii.sm,
                    borderWidth: 1,
                    borderColor: ts.raw.outline,
                    backgroundColor: ts.bg.low,
                  }}
                >
                  <Text style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>Open Import for CSV, paste, or the external prompt</Text>
                  <ArrowRight size={14} color={ts.text.primary} />
                </ScalePressable>
              </View>
            </View>
          </AssistantBubble>
        </View>
      );
    }
    const name = settings.profile_name ? `, ${settings.profile_name}` : '';
    return (
      <View style={{ paddingTop: Spacing.s4 }}>
        <AssistantBubble>
          <View style={{ gap: Spacing.s3 }}>
            <Text style={[Typography.labelMd, { color: ts.text.onSurface }]}>
              Hi{name}, I am Peach. I can help you log expenses, compare weekly spending, or search past receipts. How can I help right now?
            </Text>
            <View style={{ gap: Spacing.s2, borderTopWidth: 1, borderTopColor: ts.raw.outline, paddingTop: Spacing.s3 }}>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1.2 }]}>
                Suggested actions
              </Text>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <ScalePressable
                  key={prompt}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                  onPress={() => handleSuggestion(prompt)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: Spacing.s2,
                    minHeight: 48,
                    paddingHorizontal: Spacing.s3,
                    paddingVertical: Spacing.s2,
                    borderRadius: Radii.sm,
                    borderWidth: 1,
                    borderColor: ts.raw.outline,
                    backgroundColor: ts.bg.low,
                  }}
                >
                  <Text style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>{prompt}</Text>
                  <ArrowRight size={14} color={ts.text.primary} />
                </ScalePressable>
              ))}
            </View>
          </View>
        </AssistantBubble>
      </View>
    );
  }, [handleSuggestion, importMode, loadingHistory, router, settings.profile_name, ts]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: ts.bg.screen }} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View
        style={{
          paddingHorizontal: Spacing.s4,
          paddingVertical: Spacing.s2,
          borderBottomWidth: 1,
          borderBottomColor: ts.border.subtle,
          backgroundColor: ts.raw.surface,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            alignSelf: 'center',
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
          }}
        >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 }}>
          <LinearGradient
            colors={ts.isDark ? Gradients.dark : Gradients.light}
            start={{ x: 0.33, y: 0 }}
            end={{ x: 0.67, y: 1 }}
            style={{ width: 36, height: 36, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' }}
          >
            <Sparkles size={18} color={ts.raw.onPrimary} />
          </LinearGradient>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
              <Text accessibilityRole="header" style={[Typography.labelBold, { color: ts.text.onSurface }]}>Peach AI</Text>
              <View style={{ width: 8, height: 8, borderRadius: Radii.full, backgroundColor: isOffline ? ts.raw.warning : ts.raw.successText }} />
            </View>
            <ScalePressable
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Select AI model provider"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => { void openProviderSheet(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, minHeight: 32 }}
            >
              <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.primary, flexShrink: 1 }]}>
                {activeModelLabel || 'Choose a model'}
              </Text>
              <ChevronDown size={12} color={ts.text.primary} />
            </ScalePressable>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel={pricesVisible ? 'Hide amounts in the rest of the app' : 'Show amounts in the rest of the app'}
            accessibilityState={{ selected: !pricesVisible }}
            onPress={() => { void togglePrivacy(); }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            {pricesVisible ? <Eye size={18} color={ts.text.onSurfaceVariant} /> : <EyeOff size={18} color={ts.text.primary} />}
          </ScalePressable>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Open AI chat settings"
            onPress={() => router.push('/settings/chat')}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Settings size={18} color={ts.text.onSurfaceVariant} />
          </ScalePressable>
        </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {importMode ? (
          <View style={{ paddingHorizontal: Spacing.s4, paddingTop: Spacing.s3 }}>
            <View style={{ alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2, padding: Spacing.s3, borderRadius: Radii.md, backgroundColor: ts.raw.purple100, borderWidth: 1, borderColor: ts.border.primary20 }}>
              <Sparkles size={16} color={ts.text.primary} />
              <Text style={[Typography.micro, { color: ts.text.onSurface, flex: 1 }]}>
                Import context: paste transactions or attach a receipt. I parse them into a batch you confirm before anything is written.
              </Text>
            </View>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderEntry(item)}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={
            entries.length === 0
              ? { flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH }
              : { paddingVertical: Spacing.s3, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH }
          }
          keyboardShouldPersistTaps="handled"
        />

        {pendingUndo && undoRemaining > 0 ? (
          <View style={{ paddingHorizontal: Spacing.s3, paddingBottom: Spacing.s2, alignItems: 'center' }}>
            <Animated.View
              entering={reduceMotion ? undefined : FadeInUp.duration(200)}
              style={{
                width: '100%',
                maxWidth: MAX_CONTENT_WIDTH,
                padding: Spacing.s2,
                borderRadius: Radii.md,
                // Canonical Tier 1 toast is the dark purple bar in both themes.
                backgroundColor: ts.isDark ? ts.raw.surfaceContainerLowest : Colors.black,
                borderWidth: 1,
                borderColor: ts.raw.primary,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: Spacing.s2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 }}>
                <View style={{ width: 24, height: 24, borderRadius: Radii.full, backgroundColor: Colors.success + '33', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={14} color={Colors.success} />
                </View>
                <View style={{ flexShrink: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[Typography.labelMd, { color: Colors.white, fontFamily: 'Manrope_700Bold' }]}>Saved {pendingUndo.label}</Text>
                  <Text style={[Typography.micro, { color: 'rgba(255,255,255,0.7)' }]}>Auto-saved to ledger</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
                <Text accessibilityLiveRegion="polite" style={[Typography.micro, { color: 'rgba(255,255,255,0.7)' }]}>{undoRemaining}s</Text>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo saved expense"
                  onPress={() => { void handleUndo(); }}
                  style={{ minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.full, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={[Typography.micro, { color: Colors.black, fontFamily: 'Manrope_700Bold' }]}>Undo</Text>
                </ScalePressable>
              </View>
            </Animated.View>
          </View>
        ) : null}

        {attachedImage ? (
          <View style={{ paddingHorizontal: Spacing.s4, paddingVertical: Spacing.s2, borderTopWidth: 1, borderTopColor: ts.raw.outline }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH }}>
              <View style={{ width: 32, height: 32, borderRadius: Radii.sm, backgroundColor: ts.raw.purple100, alignItems: 'center', justifyContent: 'center' }}>
                <Paperclip size={16} color={ts.text.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface }]}>{attachedImage.name}</Text>
                {formatFileSize(attachedImage.size) ? (
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{formatFileSize(attachedImage.size)} - ready to send</Text>
                ) : null}
              </View>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Remove attached image"
                onPress={() => setAttachedImage(null)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} color={ts.text.onSurfaceVariant} />
              </ScalePressable>
            </View>
          </View>
        ) : null}

        {/* Input bar */}
        <View
          style={{
            paddingHorizontal: Spacing.s3,
            paddingTop: Spacing.s2,
            paddingBottom: Math.max(Spacing.s2, insets.bottom),
            borderTopWidth: 1,
            borderTopColor: ts.border.subtle,
            backgroundColor: ts.raw.surface,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: Spacing.s2,
              alignSelf: 'center',
              width: '100%',
              maxWidth: MAX_CONTENT_WIDTH,
            }}
          >
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel={importMode ? 'Attach a receipt image to parse' : 'Attach a receipt or image'}
            onPress={() => { void handleAttach(); }}
            style={{ width: 44, height: 44, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: ts.bg.low }}
          >
            <Paperclip size={18} color={ts.text.onSurfaceVariant} />
          </ScalePressable>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={importMode ? 'Paste transactions or attach a receipt...' : 'Ask Peach or log an expense...'}
            placeholderTextColor={ts.text.onSurfaceVariant}
            selectionColor={ts.raw.primary}
            multiline
            maxLength={2000}
            accessibilityLabel="Message Peach"
            style={[
              Typography.labelMd,
              {
                flex: 1,
                minHeight: 44,
                maxHeight: 120,
                paddingHorizontal: Spacing.s3,
                paddingVertical: Spacing.s2,
                borderRadius: Radii.full,
                borderWidth: 1,
                borderColor: ts.raw.outline,
                backgroundColor: ts.bg.low,
                color: ts.text.onSurface,
              },
            ]}
          />
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: isProcessing || (!inputText.trim() && !attachedImage) }}
            disabled={isProcessing || (!inputText.trim() && !attachedImage)}
            onPress={handleSend}
            style={{
              width: 44,
              height: 44,
              borderRadius: Radii.full,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: isProcessing || (!inputText.trim() && !attachedImage) ? ts.bg.elevated : 'transparent',
            }}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={ts.raw.primary} />
            ) : !inputText.trim() && !attachedImage ? (
              <Send size={18} color={ts.text.onSurfaceVariant} />
            ) : (
              <>
                <LinearGradient
                  colors={ts.isDark ? Gradients.dark : Gradients.light}
                  start={{ x: 0.33, y: 0 }}
                  end={{ x: 0.67, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <Send size={18} color={ts.raw.onPrimary} />
              </>
            )}
          </ScalePressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <AIProcessingOverlay
        visible={isProcessing && processingImage}
        contextLabel="Chat attachment"
        title="Analyzing image"
        description="Reading the attached image and matching it to your records."
      />

      {/* Provider sheet: selection only, never a key field */}
      {showProviderSheet ? (
        <Pressable
          accessibilityViewIsModal
          onPress={() => setShowProviderSheet(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: ts.bg.overlay, justifyContent: 'flex-end', zIndex: 40 }}
        >
          <Pressable onPress={() => undefined}>
            <View
              style={{
                maxHeight: windowHeight * MODEL_SHEET_MAX_HEIGHT_RATIO,
                backgroundColor: ts.raw.surface,
                borderTopLeftRadius: Radii.lg,
                borderTopRightRadius: Radii.lg,
                borderTopWidth: 1,
                borderColor: ts.raw.outline,
                padding: Spacing.s5,
                paddingBottom: Math.max(Spacing.s5, insets.bottom),
                gap: Spacing.s3,
              }}
            >
              <View style={{ width: 40, height: 4, borderRadius: Radii.full, backgroundColor: ts.raw.outline, alignSelf: 'center' }} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.s2 }}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>Select AI Model Provider</Text>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                    Pure model selection. API keys are strictly managed in S-17.
                  </Text>
                </View>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="Close provider sheet"
                  onPress={() => setShowProviderSheet(false)}
                  style={{ width: 44, height: 44, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: ts.bg.low }}
                >
                  <X size={18} color={ts.text.onSurfaceVariant} />
                </ScalePressable>
              </View>

              <View style={{ flexDirection: 'row', gap: Spacing.s2 }}>
                {(['gemini', 'openrouter'] as const).map((option) => {
                  const active = provider === option;
                  return (
                    <ScalePressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => { void selectProvider(option); }}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: Radii.sm,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: active ? ts.raw.primary : ts.raw.outline,
                        backgroundColor: active ? ts.bg.primary10 : ts.bg.low,
                      }}
                    >
                      <Text numberOfLines={1} style={[Typography.labelMd, { color: active ? ts.text.primary : ts.text.onSurfaceVariant }]}>
                        {option === 'gemini' ? 'Gemini' : 'OpenRouter'}
                      </Text>
                    </ScalePressable>
                  );
                })}
              </View>

              {missingActiveKey ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, padding: Spacing.s2, borderRadius: Radii.sm, backgroundColor: ts.raw.warningContainer, borderWidth: 1, borderColor: ts.raw.warningBorder }}>
                  <AlertTriangle size={16} color={ts.raw.warning} />
                  <Text style={[Typography.micro, { color: ts.raw.warningContainerText, flex: 1 }]}>
                    No API key configured for {provider === 'gemini' ? 'Gemini' : 'OpenRouter'}.
                  </Text>
                  <ScalePressable
                    accessibilityRole="button"
                    accessibilityLabel="Add API key in S-17"
                    onPress={() => { setShowProviderSheet(false); router.push('/settings/chat'); }}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.s2 }}
                  >
                    <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>Open S-17</Text>
                  </ScalePressable>
                </View>
              ) : null}

              <SearchFilterBar
                expanded
                onExpandedChange={() => undefined}
                query={modelSearch}
                onQueryChange={setModelSearch}
                placeholder="Filter models by provider or name..."
                resultCount={filteredModels.length}
                resultLabel="models"
              />

              <FlatList
                data={filteredModels}
                keyExtractor={(model) => model.id}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: Math.round(windowHeight * 0.4) }}
                ListEmptyComponent={
                  <View style={{ paddingVertical: Spacing.s5, alignItems: 'center' }}>
                    <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
                      {missingActiveKey
                        ? 'Add a provider key in S-17 to load models.'
                        : 'No models cached yet. Open S-17 to load the model list.'}
                    </Text>
                  </View>
                }
                renderItem={({ item: model }) => {
                  const id = model.id;
                  const display = model.displayName;
                  const isActive = id === activeModelId;
                  const isFree = model.isFree;
                  return (
                    <ScalePressable
                      haptic={false}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={display}
                      disabled={missingActiveKey}
                      onPress={() => { void selectModel(id, display); }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: Spacing.s2,
                        minHeight: 48,
                        padding: Spacing.s2,
                        marginBottom: Spacing.s2,
                        borderRadius: Radii.sm,
                        borderWidth: 1,
                        borderColor: isActive ? ts.raw.primary : ts.raw.outline,
                        backgroundColor: isActive ? ts.bg.primary10 : ts.bg.low,
                        opacity: missingActiveKey ? 0.6 : 1,
                      }}
                    >
                      <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>{display}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
                        {isFree === true ? (
                          <View style={{ borderRadius: Radii.sm, paddingHorizontal: Spacing.s1, paddingVertical: 1, backgroundColor: ts.raw.successContainer }}>
                            <Text style={[Typography.micro, { color: ts.raw.successText }]}>FREE</Text>
                          </View>
                        ) : null}
                        {isActive ? <Check size={16} color={ts.text.primary} /> : null}
                      </View>
                    </ScalePressable>
                  );
                }}
              />

              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Open S-17 settings"
                onPress={() => { setShowProviderSheet(false); router.push('/settings/chat'); }}
                style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={[Typography.labelMd, { color: ts.text.primary }]}>Need to add, revoke, or test your API keys? Open S-17 Settings</Text>
              </ScalePressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
