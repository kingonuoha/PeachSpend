import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { cacheDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  ChevronRight,
  CircleDollarSign,
  Download,
  Moon,
  Repeat,
  Sparkles,
  Sun,
  Tag,
  Target,
  Upload,
  User,
  Zap,
} from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { Skeleton } from '../../components/ui/Skeleton';
import { EditProfileSheet } from '../../components/profile/EditProfileSheet';
import { CurrencyConversionModal } from '../../components/settings/CurrencyConversionModal';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useTokenReload } from '../../hooks/useDataFreshness';
import { useBottomClearance } from '../../components/navigation/useBottomClearance';
import { Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import {
  buildExportPreview,
  buildSettingsSnapshot,
  categoryService,
  CLEAR_ALL_DATA_MEDIA_SCOPE,
  CLEAR_ALL_DATA_SCOPE,
  dataStewardshipPort,
  executeDataStewardship,
  executeExport,
  MEDIA_ERASURE_SCOPES,
  profileDataService,
  recurringDataService,
  RESET_APP_MEDIA_SCOPE,
  settingsPort,
  updateBudget,
} from '../../services/DataServices';
import type {
  BulkConversionOutcome,
  DataStewardshipAction,
  DataStewardshipResult,
  ExportOutcome,
  ExportPreview,
  ExportWriter,
  MediaErasureScope,
  SettingsSnapshot,
} from '../../services/DataServices';
import { setThemeMode } from '../../data/ThemePackContracts';
import { aiChatService } from '../../services/AIChatService';
import { databaseService } from '../../services/DatabaseService';
import { formatCurrency, getCurrencyName } from '../../utils/currency';
import { resolveAvatarUri } from '../../utils/profileAvatar';
import type { ProfileSnapshot } from '../../data/ProfileContracts';
import type { Expense } from '../../types/database';
import {
  describeContinuityFileReadFailure,
  describeContinuityMigration,
  type ContinuityFeedback,
} from '../../services/ContinuityUiService';

// S-06 Settings. Rebuilt as a replacement for the legacy screen: sectioned
// control center with an editable budget, an independent light/dark toggle, a
// currency row that opens the shared SH-06a surface, an AI provider link with no
// key field, real navigation rows, a lightweight export preview, and Data
// Stewardship as the only destructive executor. Reads come from typed contracts,
// never from screen SQL. X-06.

const MAX_CONTENT_WIDTH = 640;
const ICON_CHIP = 32;
const ROW_MIN_HEIGHT = 56;
// B4-3: the back control keeps its proportionate visual circle and gets a real 44pt
// target by growing the circle to 40 and the slop to 4 on each side, which is 48.
const HEADER_CIRCLE = 40;
const HEADER_CIRCLE_SLOP = 4;
// BUG-09-11b. The ledger rows this screen reads on demand feed the export and the
// currency conversion dialogs, so a read failure has to be stated rather than
// leaving a dialog showing nothing.
const EXPORT_READ_FAILURE_MESSAGE = 'Could not read your records. Please try again.';
// BUG-09-11b. The profile snapshot and the two metadata counts both read the
// ledger, so a ledger write is the only external change that invalidates them.
const SETTINGS_FRESHNESS_DOMAINS = ['ledger'] as const;
// Reference currency list for the SH-06a candidate options. Shared reference data
// only, the same set onboarding offers; symbols and names come from utils/currency.
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'] as const;

// B4-3: the export preview names its columns instead of printing a comma separated
// header. The record is keyed by the sample row contract, so a column added to or
// removed from the export shape fails the type check here rather than leaving the
// summary describing a file that changed underneath it.
type ExportSampleRowShape = ExportPreview['sample'][number];
const EXPORT_COLUMN_LABELS: Record<keyof ExportSampleRowShape, string> = {
  date: 'Date',
  merchant: 'Merchant',
  amount: 'Amount',
  currency: 'Currency',
  category: 'Category',
};
const EXPORT_COLUMN_SUMMARY = (Object.keys(EXPORT_COLUMN_LABELS) as (keyof ExportSampleRowShape)[])
  .map((key) => EXPORT_COLUMN_LABELS[key])
  .join(', ');

// Data Stewardship copy is built from the D8/D9 scope facts so the dialog can
// never claim a wider or narrower clear than the database and the media erasure
// boundary perform (S-06R-01, S-06R-02). The key-to-label maps are presentation
// only; every action named here is read from the exported scope constants. B4-3:
// the labels are written in plain human terms, because the scope keys that named
// database tables were never meant for a user to read.
const CLEAR_SCOPE_LABELS: Record<string, string> = {
  expenses: 'expense records',
  income: 'income records',
  chat_expense_confirmations: 'expenses you saved from chat',
  capture_events: 'auto-capture history',
  capture_queue: 'pending auto-captures',
};
const KEPT_SCOPE_LABELS: Record<string, string> = {
  categories: 'your categories',
  settings: 'your settings and budget',
  api_keys: 'your saved provider keys',
  achievements: 'your badges',
  merchant_category_memory: 'merchant memory',
};
type MediaScopeKey = 'receiptImages' | 'profileAvatars' | 'exportFiles';
const MEDIA_SCOPE_LABELS: Record<MediaScopeKey, string> = {
  receiptImages: 'receipt images',
  profileAvatars: 'profile avatars',
  exportFiles: 'exported CSV files',
};

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function scopeLabels(keys: readonly string[], map: Record<string, string>): string[] {
  return keys.map((key) => map[key] ?? key.replace(/_/g, ' '));
}

function mediaLabels(scope: MediaErasureScope): string[] {
  const spec = MEDIA_ERASURE_SCOPES[scope];
  return (Object.keys(MEDIA_SCOPE_LABELS) as MediaScopeKey[])
    .filter((key) => spec[key])
    .map((key) => MEDIA_SCOPE_LABELS[key]);
}

function capitalizeFirst(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

const CLEARED_RECORDS = scopeLabels(CLEAR_ALL_DATA_SCOPE.clears, CLEAR_SCOPE_LABELS);
const KEPT_RECORDS = scopeLabels(CLEAR_ALL_DATA_SCOPE.keeps, KEPT_SCOPE_LABELS);
const CLEAR_MEDIA = mediaLabels(CLEAR_ALL_DATA_MEDIA_SCOPE);
const RESET_MEDIA = mediaLabels(RESET_APP_MEDIA_SCOPE);

const CLEAR_ROW_SUBTITLE =
  `Deletes ${joinLabels(CLEARED_RECORDS)} and their ${joinLabels(CLEAR_MEDIA)}. ` +
  `Keeps ${joinLabels(KEPT_RECORDS)}.`;
const RESET_ROW_SUBTITLE =
  `Deletes every financial record, every saved provider key and ${joinLabels(RESET_MEDIA)}, and returns the app to setup.`;
const CLEAR_DIALOG_BODY =
  `This deletes ${joinLabels(CLEARED_RECORDS)} from this device, along with their ` +
  `${joinLabels(CLEAR_MEDIA)}. ${capitalizeFirst(joinLabels(KEPT_RECORDS))} stay exactly as they are.`;
const RESET_DIALOG_BODY =
  `This deletes every financial record and every saved provider key, and removes ` +
  `${joinLabels(RESET_MEDIA)}. The app returns to setup with nothing in it.`;
const CLEAR_IMPACT = [
  `Deleted: ${capitalizeFirst(joinLabels(CLEARED_RECORDS))}`,
  `Deleted files: ${capitalizeFirst(joinLabels(CLEAR_MEDIA))}`,
  `Kept: ${capitalizeFirst(joinLabels(KEPT_RECORDS))}`,
];
const RESET_IMPACT = [
  'Deleted: every financial record',
  'Deleted: every saved provider key',
  `Deleted files: ${capitalizeFirst(joinLabels(RESET_MEDIA))}`,
  'Afterwards: the app returns to setup',
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '';
}

function formatMemberSince(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

type ThemeRaw = ReturnType<typeof useThemeStyles>['raw'];

// Tone palette for the continuity feedback card, drawn from the existing theme
// tokens rather than a new palette. Mirrors the S-12 parse-notice treatment.
function continuityTone(raw: ThemeRaw, tone: ContinuityFeedback['tone']) {
  switch (tone) {
    case 'success':
      return { background: raw.successContainer, border: raw.successBorder, text: raw.statusSuccessText };
    case 'warning':
      return { background: raw.warningContainer, border: raw.warningBorder, text: raw.warningContainerText };
    case 'info':
      return { background: raw.purple100, border: raw.primary + '33', text: raw.primary };
    case 'error':
    default:
      return { background: raw.dangerSoft, border: raw.danger + '40', text: raw.danger };
  }
}

// Loading placeholder. Mirrors the loaded header and the two settings cards with
// their real row geometry (card/row/spacing styles) so content arrives with no
// layout shift. Decorative blocks stay hidden from assistive tech; the container
// exposes a single busy label, matching the Home/notifications skeleton convention.
function SettingsSkeleton() {
  const ts = useThemeStyles();
  const bottomClearance = useBottomClearance();
  return (
    <SafeAreaView
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading settings"
      accessibilityState={{ busy: true }}
      style={{ backgroundColor: ts.bg.screen, flex: 1 }}
      edges={['top']}
    >
      <View style={[styles.header, { borderBottomColor: ts.raw.outline }]}>
        <Skeleton width={36} height={36} borderRadius={Radii.full} />
        <Skeleton width={96} height={20} />
        <View style={styles.headerCircle} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: bottomClearance }]}>
        {/* Daily Preferences */}
        <View>
          <Skeleton width={140} height={11} style={styles.skeletonSectionLabel} />
          <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
            <View style={styles.profileRow}>
              <View style={styles.rowLeft}>
                <Skeleton width={48} height={48} borderRadius={Radii.full} />
                <View style={[styles.rowText, styles.skeletonStack]}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="70%" height={11} />
                </View>
              </View>
              <Skeleton width={64} height={36} borderRadius={Radii.full} />
            </View>
            <View style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}>
              <View style={styles.rowLeft}>
                <Skeleton width={ICON_CHIP} height={ICON_CHIP} />
                <View style={[styles.rowText, styles.skeletonStack]}>
                  <Skeleton width="45%" height={14} />
                  <Skeleton width="70%" height={11} />
                </View>
              </View>
              <Skeleton width={48} height={28} borderRadius={Radii.full} />
            </View>
            <View style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}>
              <View style={styles.rowLeft}>
                <Skeleton width={ICON_CHIP} height={ICON_CHIP} />
                <View style={[styles.rowText, styles.skeletonStack]}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="65%" height={11} />
                </View>
              </View>
              <View style={styles.rowRight}>
                <Skeleton width={56} height={14} />
                <Skeleton width={40} height={32} borderRadius={Radii.sm} />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Skeleton width={ICON_CHIP} height={ICON_CHIP} />
                <View style={[styles.rowText, styles.skeletonStack]}>
                  <Skeleton width="45%" height={14} />
                  <Skeleton width="55%" height={11} />
                </View>
              </View>
              <View style={styles.rowRight}>
                <Skeleton width={72} height={14} />
                <Skeleton width={12} height={12} />
              </View>
            </View>
          </LuminousCard>
        </View>

        {/* Financial System */}
        <View>
          <Skeleton width={150} height={11} style={styles.skeletonSectionLabel} />
          <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
            {Array.from({ length: 3 }).map((_, index) => (
              <View
                key={index}
                style={[styles.row, index < 2 ? styles.rowDivider : null, index < 2 ? { borderBottomColor: ts.raw.outline } : null]}
              >
                <View style={styles.rowLeft}>
                  <Skeleton width={ICON_CHIP} height={ICON_CHIP} />
                  <View style={[styles.rowText, styles.skeletonStack]}>
                    <Skeleton width="55%" height={14} />
                    <Skeleton width="70%" height={11} />
                  </View>
                </View>
                <Skeleton width={12} height={12} />
              </View>
            ))}
          </LuminousCard>
        </View>

        {/* Data Vault and Privacy */}
        <View>
          <Skeleton width={180} height={11} style={styles.skeletonSectionLabel} />
          <LuminousCard variant="low" style={[styles.card, styles.stewardCard, { backgroundColor: ts.raw.surface }]}>
            {Array.from({ length: 3 }).map((_, index) => (
              <View key={index} style={styles.actionRow}>
                <View style={[styles.rowText, styles.skeletonStack]}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="90%" height={11} />
                </View>
                <Skeleton width={72} height={32} borderRadius={Radii.sm} />
              </View>
            ))}
          </LuminousCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const bottomClearance = useBottomClearance();
  const { settings, refreshSettings, getCurrencySymbol } = useSettings();
  const { showToast } = useToast();

  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(() => profileDataService.getCachedSnapshot());
  const [reloading, setReloading] = useState(false);
  // BUG-09-11b. The export and currency-conversion flows are the only readers of
  // the full ledger on this screen, and both only when the user opens them. This
  // screen used to call useExpenses() on mount, which read the whole expense table
  // on every visit to Settings for a count and for two dialogs that may never be
  // opened. The rows are now read when a dialog opens, which also means they can
  // never be a stale copy of the ledger.
  const [ledgerRows, setLedgerRows] = useState<Expense[]>([]);
  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [recurringCount, setRecurringCount] = useState<number | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);

  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  // D6 suggestion, offered only when there is no budget yet. Null means "no
  // suggestion", which renders as nothing rather than a made up amount.
  const [budgetSuggestion, setBudgetSuggestion] = useState<{ amount: number; currency: string } | null>(null);
  const [budgetSuggestionLoading, setBudgetSuggestionLoading] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<DataStewardshipAction | null>(null);
  const [stewardBusy, setStewardBusy] = useState(false);

  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<ContinuityFeedback | null>(null);

  const settingsSnapshot: SettingsSnapshot = useMemo(() => buildSettingsSnapshot(settings), [settings]);

  // One mount path for everything this screen reads, issued as a single wave
  // instead of the profile snapshot followed by the metadata. Each secondary read
  // keeps its own failure behaviour: a failure only hides its own value instead of
  // blanking the screen or inventing a default.
  const loadAll = useCallback(async () => {
    const results = await Promise.allSettled([
      profileDataService.getSnapshot(),
      categoryService.list(),
      recurringDataService.list(),
      aiChatService.getProviderKeyState(),
    ]);
    const [profile, categories, recurring, keys] = results;
    if (profile.status === 'fulfilled') setSnapshot(profile.value);
    if (categories.status === 'fulfilled') setCategoryCount(categories.value.length);
    if (recurring.status === 'fulfilled') {
      setRecurringCount(recurring.value.status === 'ready' ? recurring.value.templates.length : 0);
    }
    if (keys.status === 'fulfilled') {
      setProviderConfigured(
        keys.value.gemini.status === 'configured' || keys.value.openrouter.status === 'configured',
      );
    }
  }, []);

  // BUG-09-11b. Re-reads on first mount and when the ledger changed while this
  // screen was mounted, not on a focus event or a re-render. Category and recurring
  // edits are ledger writes, so those metadata counts refresh with the snapshot
  // instead of needing their own effect.
  useTokenReload(SETTINGS_FRESHNESS_DOMAINS, loadAll);

  // The export and currency conversion flows read the ledger rows on open, so the
  // rows they act on are the current ones rather than a copy taken when Settings
  // mounted.
  const loadLedgerRows = useCallback(async (): Promise<Expense[]> => {
    const rows = await databaseService.getExpenses();
    setLedgerRows(rows);
    return rows;
  }, []);

  const retry = async () => {
    setReloading(true);
    await loadAll();
    setReloading(false);
  };

  const avatarUri = snapshot ? resolveAvatarUri(snapshot.avatarFile) : null;
  const memberSince = snapshot ? formatMemberSince(snapshot.joinDate) : null;
  const budgetLabel = settingsSnapshot.budget > 0
    ? formatCurrency(settingsSnapshot.budget, settingsSnapshot.budgetCurrency)
    : null;

  const startBudgetEdit = () => {
    setBudgetDraft(settingsSnapshot.budget > 0 ? String(settingsSnapshot.budget) : '');
    setBudgetError(null);
    setBudgetSuggestion(null);
    setBudgetEditing(true);
    // D6 is asked for only when there is nothing to edit, so an existing budget is
    // never replaced by a suggestion. A null result, a different currency, or a read
    // failure all leave the editor alone; none of them produce an amount.
    if (settingsSnapshot.budget <= 0) void loadBudgetSuggestion();
  };

  const loadBudgetSuggestion = async () => {
    setBudgetSuggestionLoading(true);
    try {
      const suggestion = await databaseService.getSuggestedMonthlyBudget();
      if (suggestion && suggestion.currency === settingsSnapshot.budgetCurrency) {
        setBudgetSuggestion(suggestion);
      }
    } catch {
      // No suggestion is an honest outcome here, not a failure the user must act on.
    } finally {
      setBudgetSuggestionLoading(false);
    }
  };

  const saveBudget = async () => {
    if (budgetSaving) return;
    setBudgetSaving(true);
    setBudgetError(null);
    try {
      const result = await updateBudget(settingsPort, budgetDraft, settingsSnapshot.budgetCurrency);
      if (result.status === 'invalid') {
        setBudgetError('Enter a valid amount of zero or more.');
        return;
      }
      setBudgetEditing(false);
      await refreshSettings();
      showToast('Monthly budget updated', 'success');
    } catch {
      setBudgetError('Could not save your budget. Please try again.');
    } finally {
      setBudgetSaving(false);
    }
  };

  const applyThemeMode = async () => {
    if (themeBusy) return;
    const next = settingsSnapshot.theme === 'dark' ? 'light' : 'dark';
    setThemeBusy(true);
    try {
      await setThemeMode(settingsPort, next);
      await refreshSettings();
    } catch {
      showToast('Could not change the appearance. Please try again.', 'error');
    } finally {
      setThemeBusy(false);
    }
  };

  const handleProfileSaved = async (result: { name: string; avatarFile: string | null }) => {
    setEditingProfile(false);
    setSnapshot((prev) => (prev ? { ...prev, displayName: result.name, avatarFile: result.avatarFile } : prev));
    await refreshSettings();
  };

  // Both dialogs read the ledger rows at open time. The read is one table scan
  // behind an explicit user action instead of one on every visit to Settings, and
  // it means the rows the dialog works on are the current ones.
  const openExport = async () => {
    setExportError(null);
    try {
      const rows = await loadLedgerRows();
      setExportPreview(buildExportPreview(rows, { start: 0, end: Date.now() }, 3));
      setExportOpen(true);
    } catch {
      showToast(EXPORT_READ_FAILURE_MESSAGE, 'error');
    }
  };

  const openCurrencyConversion = async () => {
    try {
      await loadLedgerRows();
      setCurrencyOpen(true);
    } catch {
      showToast(EXPORT_READ_FAILURE_MESSAGE, 'error');
    }
  };

  // The contract keeps the CSV body in the data layer and the file/share UI on
  // the screen, so this adapter is the screen's side of the export boundary.
  const exportWriter: ExportWriter = useMemo(
    () => ({
      exportToCSV: (start, end, categories) => databaseService.exportToCSV(start, end, categories),
      writeExportFile: async (fileName, content) => {
        if (!cacheDirectory) throw new Error('storage_unavailable');
        const uri = `${cacheDirectory}${fileName}`;
        await writeAsStringAsync(uri, content, { encoding: 'utf8' });
        return uri;
      },
      shareFile: async (uri) => {
        const available = await Sharing.isAvailableAsync();
        if (!available) throw new Error('sharing_unavailable');
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export PeachSpend Data' });
      },
    }),
    [],
  );

  const confirmExport = async () => {
    if (!exportPreview || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const outcome: ExportOutcome = await executeExport(exportWriter, exportPreview);
      if (outcome.status === 'exported') {
        setExportOpen(false);
        showToast(`Exported ${outcome.rowCount} transactions`, 'success');
      } else if (outcome.errorCode === 'storage_unavailable') {
        setExportError('Temporary export storage is unavailable on this device.');
      } else if (outcome.errorCode === 'sharing_unavailable') {
        setExportError('Sharing is unavailable on this device.');
      } else {
        setExportError('The export could not be generated. Please try again.');
      }
    } catch {
      setExportError('The export could not be generated. Please try again.');
    } finally {
      setExportBusy(false);
    }
  };

  const handleCurrencyConverted = useCallback(
    async (outcome: BulkConversionOutcome) => {
      // The conversion writes the expense rows, which publishes the ledger change
      // token, so this screen's own snapshot re-reads through the same path as any
      // other ledger write. Only the settings mirror needs refreshing here.
      if (outcome.status === 'converted') {
        await refreshSettings();
        showToast(`Base currency changed to ${outcome.toCurrency}`, 'success');
      } else if (outcome.status === 'partial') {
        await refreshSettings();
        showToast(`Converted ${outcome.convertedCount}, skipped ${outcome.skippedCount}: missing rate for ${outcome.missingRates.join(', ')}`, 'error');
      } else {
        showToast(`Missing conversion rate for ${outcome.missingRates.join(', ')}`, 'error');
      }
    },
    [refreshSettings, showToast],
  );

  const confirmStewardship = async () => {
    if (!pendingAction || stewardBusy) return;
    setStewardBusy(true);
    const action = pendingAction;
    let result: DataStewardshipResult | null = null;
    try {
      result = await executeDataStewardship(dataStewardshipPort, action, true);
    } catch {
      result = null;
    } finally {
      setStewardBusy(false);
    }
    setPendingAction(null);
    if (!result || result.status !== 'completed') {
      showToast('That action could not be completed.', 'error');
      return;
    }
    // Clearing the ledger publishes the ledger token, so the record count above
    // refreshes from the same path as any other write.
    await refreshSettings();
    if (result.action === 'reset_app') {
      showToast('App reset. Returning to onboarding.', 'success');
      router.replace('/(onboarding)');
    } else {
      showToast('Transaction records cleared', 'success');
    }
  };

  // DEC-32 manual fallback. The data layer owns the bytes-to-records boundary;
  // this handler owns only the picker, the read, and the honest result copy. A
  // non-v1 file routes the user to the S-12 Import screen, which owns every other
  // format. No SQL and no second migration path.
  const handleRestoreV1 = useCallback(async () => {
    if (restoreBusy) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setRestoreBusy(true);
      setRestoreFeedback(null);
      const content = await readAsStringAsync(asset.uri);
      const result = await databaseService.migrateV1Export({ content, fileName: asset.name });
      const feedback = describeContinuityMigration(result);
      setRestoreFeedback(feedback);
      if (result.status === 'imported' || result.status === 'partially_imported' || result.status === 'already_current') {
        // The restore publishes the ledger token, so the count above refreshes
        // from the same path as any other write.
        await refreshSettings();
      }
      showToast(feedback.title, feedback.tone === 'success' ? 'success' : feedback.tone === 'error' ? 'error' : 'info');
    } catch {
      setRestoreFeedback(describeContinuityFileReadFailure());
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreBusy, refreshSettings, showToast]);

  if (!snapshot) {
    return <SettingsSkeleton />;
  }

  const autoCaptureEnabled = settings.auto_capture_enabled === 'true';
  const autoCaptureGranted = settings.auto_capture_permission === 'granted';
  const autoCaptureActive = autoCaptureEnabled && autoCaptureGranted;
  const autoCaptureLabel = autoCaptureActive ? 'ON' : autoCaptureEnabled ? 'Action needed' : 'OFF';
  const autoCaptureTone = autoCaptureActive
    ? ts.raw.statusSuccessText
    : autoCaptureEnabled
      ? ts.raw.warningContainerText
      : ts.raw.onSurfaceVariant;

  const appVersion = Constants.expoConfig?.version;

  const sectionLabel = (label: string) => (
    <Text style={[Typography.captionBold, styles.sectionLabel, { color: ts.raw.onSurfaceVariant }]}>
      {label}
    </Text>
  );

  const iconChip = (node: React.ReactNode, background: string) => (
    <View style={[styles.iconChip, { backgroundColor: background }]}>{node}</View>
  );

  const chevron = <ChevronRight size={16} color={ts.raw.onSurfaceVariant} />;
  const restoreToneStyle = restoreFeedback ? continuityTone(ts.raw, restoreFeedback.tone) : null;

  return (
    <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: ts.raw.outline }]}>
        <ScalePressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HEADER_CIRCLE_SLOP}
          style={[styles.headerCircle, { backgroundColor: ts.bg.card, borderColor: ts.raw.outline }]}
        >
          <ArrowLeft size={18} color={ts.raw.onSurface} />
        </ScalePressable>
        <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
          Settings
        </Text>
        <View style={styles.headerCircle} />
      </View>

      {snapshot.state === 'failure' ? (
        <View style={styles.centerBox}>
          <LuminousCard variant="low" style={styles.errorCard}>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Settings could not load</Text>
            <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s1 }]}>
              Your device data is still safe. Try again to read your settings.
            </Text>
            <PeachButton
              title={reloading ? 'Retrying...' : 'Retry'}
              onPress={retry}
              variant="primary"
              size="sm"
              isLoading={reloading}
              style={{ marginTop: Spacing.s3 }}
            />
          </LuminousCard>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: bottomClearance }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Group 1: Daily Preferences. Identity, appearance, budget, currency and the
              AI provider link, all in one card. Grouping only, nothing collapsible. */}
          <View>
            {sectionLabel('Daily Preferences')}
            <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
              <ScalePressable
                onPress={() => setEditingProfile(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                style={styles.profileRow}
              >
                <View style={styles.rowLeft}>
                  <View style={[styles.avatar, { borderColor: ts.raw.primary + '33' }]}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
                    ) : initialsOf(snapshot.displayName) ? (
                      <LinearGradient
                        colors={ts.isDark ? Gradients.dark : Gradients.light}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.avatarFill}
                      >
                        <Text style={[Typography.bodyBold, { color: '#FFFFFF' }]}>
                          {initialsOf(snapshot.displayName)}
                        </Text>
                      </LinearGradient>
                    ) : (
                      <User size={22} color={ts.raw.primary} />
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>
                      {snapshot.displayName || 'Add your name'}
                    </Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      {memberSince ? `Member since ${memberSince}` : 'Local profile on this device'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.editPill, { backgroundColor: ts.raw.purple100 }]}>
                  <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_700Bold' }]}>
                    Edit
                  </Text>
                  <ChevronRight size={13} color={ts.raw.primary} />
                </View>
              </ScalePressable>

              <View style={[styles.divider, { backgroundColor: ts.raw.outline }]} />

              {/* Appearance: light/dark only, independent of the theme pack */}
              <View style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}>
                <View style={styles.rowLeft}>
                  {iconChip(
                    settingsSnapshot.theme === 'dark'
                      ? <Moon size={16} color={ts.raw.primary} />
                      : <Sun size={16} color={ts.raw.primary} />,
                    ts.raw.purple100,
                  )}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Appearance</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      Independent from theme-pack
                    </Text>
                  </View>
                </View>
                <Switch
                  value={settingsSnapshot.theme === 'dark'}
                  onValueChange={() => void applyThemeMode()}
                  disabled={themeBusy}
                  accessibilityRole="switch"
                  accessibilityLabel="Dark mode"
                  trackColor={{ false: ts.raw.outline, true: ts.raw.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Notification Channels. DEC-11-08: alerts are a daily preference, so
                  this row lives here and not with the financial workflow modules. */}
              <ScalePressable
                onPress={() => router.push('/notifications')}
                accessibilityRole="button"
                accessibilityLabel="Notification channels"
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Bell size={16} color={ts.raw.danger} />, ts.raw.dangerSoft)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Notification Channels</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      Recap and threshold digests
                    </Text>
                  </View>
                </View>
                {chevron}
              </ScalePressable>

              {/* Monthly Budget: display + inline editor */}
              <View style={[styles.rowBlock, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    {iconChip(<Target size={16} color={ts.raw.statusSuccessText} />, ts.raw.statusSuccessContainer)}
                    <View style={styles.rowText}>
                      <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Monthly Budget</Text>
                      <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                        Used for Home pacing and recap math
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      {budgetLabel ?? 'Not set'}
                    </Text>
                    <ScalePressable
                      onPress={startBudgetEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Edit monthly budget"
                      hitSlop={Spacing.s2}
                      style={[styles.smallPill, { backgroundColor: ts.raw.purple100 }]}
                    >
                      <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_700Bold' }]}>
                        Edit
                      </Text>
                    </ScalePressable>
                  </View>
                </View>

                {budgetEditing && budgetSuggestion ? (
                  /* D6 anchor: a real trailing 30 day figure, offered rather than
                     applied, so a blank field is never the only starting point. */
                  <View style={[styles.budgetSuggestion, { backgroundColor: ts.bg.primary10, borderColor: ts.raw.primaryBorder + '40' }]}>
                    <Text style={[Typography.micro, { color: ts.raw.onSurface, flex: 1 }]}>
                      Based on your last 30 days: {formatCurrency(budgetSuggestion.amount, budgetSuggestion.currency)}
                    </Text>
                    <PeachButton
                      title="Apply"
                      onPress={() => {
                        setBudgetDraft(String(budgetSuggestion.amount));
                        setBudgetError(null);
                      }}
                      variant="secondary"
                      size="xs"
                      accessibilityLabel="Apply the suggested monthly budget"
                    />
                  </View>
                ) : null}
                {budgetEditing && budgetSuggestionLoading && !budgetSuggestion ? (
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s2, paddingHorizontal: Spacing.s4 }]}>
                    Checking your recent spending for a starting point
                  </Text>
                ) : null}

                {budgetEditing ? (
                  <View style={[styles.budgetTray, { borderTopColor: ts.raw.outline }]}>
                    <View style={[styles.budgetInputWrap, { borderColor: budgetError ? ts.raw.danger : ts.raw.outline, backgroundColor: ts.bg.low }]}>
                      <Text style={[Typography.bodyBold, { color: ts.raw.onSurfaceVariant }]}>
                        {getCurrencySymbol(settingsSnapshot.budgetCurrency)}
                      </Text>
                      <TextInput
                        value={budgetDraft}
                        onChangeText={(text) => {
                          setBudgetDraft(text);
                          setBudgetError(null);
                        }}
                        keyboardType="decimal-pad"
                        editable={!budgetSaving}
                        accessibilityLabel="Monthly budget amount"
                        placeholder="0"
                        placeholderTextColor={ts.text.onSurfaceVariant60}
                        style={[styles.budgetInput, Typography.bodyBold, { color: ts.raw.onSurface }]}
                      />
                    </View>
                    <PeachButton
                      title="Save"
                      onPress={() => void saveBudget()}
                      variant="primary"
                      size="xs"
                      isLoading={budgetSaving}
                      disabled={budgetSaving}
                    />
                    <PeachButton
                      title="Cancel"
                      onPress={() => {
                        setBudgetEditing(false);
                        setBudgetError(null);
                        setBudgetSuggestion(null);
                      }}
                      variant="quiet"
                      size="xs"
                      disabled={budgetSaving}
                    />
                  </View>
                ) : null}
                {budgetError ? (
                  <Text accessibilityLiveRegion="polite" style={[Typography.micro, { color: ts.raw.danger, marginTop: Spacing.s2 }]}>
                    {budgetError}
                  </Text>
                ) : null}
              </View>

              {/* Base Currency -> SH-06a */}
              <ScalePressable
                onPress={() => void openCurrencyConversion()}
                accessibilityRole="button"
                accessibilityLabel="Base currency"
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<CircleDollarSign size={16} color={ts.raw.primary} />, ts.bg.primary10)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Base Currency</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                      {getCurrencyName(settingsSnapshot.currency)}
                    </Text>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                    {settingsSnapshot.currency} ({getCurrencySymbol(settingsSnapshot.currency)})
                  </Text>
                  {chevron}
                </View>
              </ScalePressable>

              {/* AI Provider -> the AI settings screen, link only, no key field here */}
              <ScalePressable
                onPress={() => router.push('/settings/chat')}
                accessibilityRole="button"
                accessibilityLabel="AI provider and keys"
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Sparkles size={16} color={ts.raw.primary} />, ts.raw.purple100)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      AI Provider &amp; Keys
                    </Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                      Manage provider keys and model selection
                    </Text>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  {providerConfigured === null ? null : (
                    <Text
                      style={[
                        Typography.micro,
                        {
                          color: providerConfigured ? ts.raw.statusSuccessText : ts.raw.onSurfaceVariant,
                          fontFamily: 'Manrope_700Bold',
                        },
                      ]}
                    >
                      {providerConfigured ? 'Configured' : 'Not configured'}
                    </Text>
                  )}
                  {chevron}
                </View>
              </ScalePressable>
            </LuminousCard>
          </View>

          {/* Group 2: Financial System. Every workflow module that shapes the ledger. */}
          <View>
            {sectionLabel('Financial System')}
            <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
              <ScalePressable
                onPress={() => router.push('/settings/categories')}
                accessibilityRole="button"
                accessibilityLabel="Categories and limits"
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Tag size={16} color={ts.raw.warningContainerText} />, ts.raw.warningContainer)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Categories &amp; Limits</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      {categoryCount === null ? 'Manage expense categories' : `${categoryCount} categories on this device`}
                    </Text>
                  </View>
                </View>
                {chevron}
              </ScalePressable>

              <ScalePressable
                onPress={() => router.push('/recurring')}
                accessibilityRole="button"
                accessibilityLabel="Recurring and subscriptions"
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Repeat size={16} color={ts.raw.statusSuccessText} />, ts.raw.statusSuccessContainer)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Recurring &amp; Subscriptions</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      {recurringCount === null ? 'Manage recurring schedules' : `${recurringCount} schedules`}
                    </Text>
                  </View>
                </View>
                {chevron}
              </ScalePressable>

              <ScalePressable
                onPress={() => router.push('/auto-capture-settings')}
                accessibilityRole="button"
                accessibilityLabel="Push notification auto-capture"
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Zap size={16} color={ts.raw.warningContainerText} />, ts.raw.warningContainer)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      Push Notification Auto-Capture
                    </Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                      Detect transactions from notification sources
                    </Text>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <View style={[styles.statusDot, { backgroundColor: autoCaptureTone }]} />
                  <Text style={[Typography.micro, { color: autoCaptureTone, fontFamily: 'Manrope_700Bold' }]}>
                    {autoCaptureLabel}
                  </Text>
                  {chevron}
                </View>
              </ScalePressable>

              <ScalePressable
                onPress={() => router.push('/import')}
                accessibilityRole="button"
                accessibilityLabel="Statement and CSV import"
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Download size={16} color={ts.raw.primary} />, ts.bg.primary10)}
                  <View style={styles.rowText}>
                    <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Statement &amp; CSV Import</Text>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      Bring in bank statements and spreadsheets
                    </Text>
                  </View>
                </View>
                {chevron}
              </ScalePressable>
            </LuminousCard>
          </View>

          {/* Group 3: Data Vault and Privacy. Export, restore, the two destructive
              actions, and the app level policy and help rows, in one card. */}
          <View>
            {sectionLabel('Data Vault and Privacy')}
            <LuminousCard variant="low" style={[styles.card, styles.stewardCard, { backgroundColor: ts.raw.surface }]}>
              <View style={styles.exportRow}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Export Financial Ledger</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                    {(snapshot?.stats.transactionCount ?? 0) === 1 ? '1 record' : `${snapshot?.stats.transactionCount ?? 0} records`}
                  </Text>
                </View>
                <PeachButton
                  title="Export"
                  onPress={() => void openExport()}
                  variant="secondary"
                  size="xs"
                  icon={<Download size={14} color={ts.raw.primary} />}
                />
              </View>

              <View style={[styles.divider, { backgroundColor: ts.raw.outline }]} />

              <View style={styles.actionRow}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Restore PeachSpend v1 Data</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                    Import an older v1 export file if this device did not find it automatically
                  </Text>
                </View>
                <PeachButton
                  title="Choose File"
                  onPress={() => void handleRestoreV1()}
                  variant="secondary"
                  size="xs"
                  accessibilityLabel="Choose a PeachSpend v1 export file to restore"
                  icon={<Upload size={14} color={ts.raw.primary} />}
                  isLoading={restoreBusy}
                  disabled={restoreBusy}
                />
              </View>

              {restoreFeedback && restoreToneStyle ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.restoreFeedback,
                    { backgroundColor: restoreToneStyle.background, borderColor: restoreToneStyle.border },
                  ]}
                >
                  <Text style={[Typography.labelBold, { color: restoreToneStyle.text }]}>
                    {restoreFeedback.title}
                  </Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s1 }]}>
                    {restoreFeedback.message}
                  </Text>
                  {restoreFeedback.routeToImport ? (
                    <PeachButton
                      title="Open Import"
                      onPress={() => router.push('/import')}
                      variant="secondary"
                      size="xs"
                      accessibilityLabel="Open the Import screen for other file formats"
                      style={{ marginTop: Spacing.s2, alignSelf: 'flex-start' }}
                    />
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.divider, { backgroundColor: ts.raw.outline }]} />

              <View style={styles.actionRow}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Clear Transaction Records</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={3}>
                    {CLEAR_ROW_SUBTITLE}
                  </Text>
                </View>
                <PeachButton
                  title="Clear Data"
                  onPress={() => setPendingAction('clear_all_data')}
                  variant="destructive"
                  size="xs"
                />
              </View>

              <View style={styles.actionRow}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.danger }]}>Full Factory App Reset</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={3}>
                    {RESET_ROW_SUBTITLE}
                  </Text>
                </View>
                <PeachButton
                  title="Reset App"
                  onPress={() => setPendingAction('reset_app')}
                  variant="destructive"
                  size="xs"
                />
              </View>

              <View style={[styles.divider, { backgroundColor: ts.raw.outline }]} />

              <ScalePressable
                onPress={() => router.push('/privacy-policy')}
                accessibilityRole="button"
                accessibilityLabel="Privacy policy and data security"
                style={[styles.linkRow, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Privacy Policy &amp; Data Security</Text>
                {chevron}
              </ScalePressable>
              <ScalePressable
                onPress={() => router.push('/support-center')}
                accessibilityRole="button"
                accessibilityLabel="Help center and FAQ"
                style={[styles.linkRow, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
              >
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Help Center &amp; FAQ</Text>
                {chevron}
              </ScalePressable>
              <ScalePressable
                onPress={() => router.push('/whats-new')}
                accessibilityRole="button"
                accessibilityLabel="Release notes"
                style={styles.linkRow}
              >
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Release Notes</Text>
                {chevron}
              </ScalePressable>

              {/* DEC-11-08: the version row belongs to this group too. It is one block
                  of two lines, so both move together and neither is dropped. */}
              <View style={[styles.divider, { backgroundColor: ts.raw.outline }]} />
              <View style={styles.footerRow}>
                {appVersion ? (
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, textAlign: 'center' }]}>
                    PeachSpend v{appVersion}
                  </Text>
                ) : null}
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, textAlign: 'center' }]}>
                  Your financial data stays on device
                </Text>
              </View>
            </LuminousCard>
          </View>
        </ScrollView>
      )}

      {/* Export preview sheet */}
      <Modal
        visible={exportOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setExportOpen(false)}
      >
        <View style={styles.sheetFill}>
          <Pressable style={[styles.sheetBackdrop, { backgroundColor: ts.bg.overlay }]} onPress={() => setExportOpen(false)} />
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: ts.raw.onSurfaceVariant + '66' }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.rowText}>
                <Text accessibilityRole="header" style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>
                  Export Financial Data
                </Text>
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                  Preview the ledger before generating
                </Text>
              </View>
              <ScalePressable
                onPress={() => setExportOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close export preview"
                hitSlop={Spacing.s2}
                style={[styles.sheetClose, { backgroundColor: ts.bg.low }]}
              >
                <Text style={[Typography.labelBold, { color: ts.raw.onSurfaceVariant }]}>X</Text>
              </ScalePressable>
            </View>

            <View style={[styles.formatChip, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary }]}>
              <Text style={[Typography.labelBold, { color: ts.raw.primary }]}>CSV (Spreadsheet)</Text>
            </View>

            <View style={[styles.scopeCard, { backgroundColor: ts.bg.primary10, borderColor: ts.raw.primaryBorder + '40' }]}>
              <View style={styles.rowText}>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>All-Time Ledger Scope</Text>
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                  {exportPreview
                    ? `${exportPreview.validRowCount} transactions${categoryCount !== null ? ` • ${categoryCount} categories` : ''}`
                    : ''}
                </Text>
              </View>
            </View>

            <View style={[styles.exportSummary, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
              <View style={styles.exportSummaryHead}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Spreadsheet columns</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                    {EXPORT_COLUMN_SUMMARY}
                  </Text>
                </View>
                <View style={[styles.readyBadge, { backgroundColor: ts.raw.successContainer }]}>
                  <Text style={[Typography.micro, { color: ts.raw.statusSuccessText, fontFamily: 'Manrope_700Bold' }]}>
                    CSV Spreadsheet Ready
                  </Text>
                </View>
              </View>

              {(exportPreview?.sample ?? []).map((row, index) => (
                <View key={`${row.date}-${index}`} style={[styles.exportSampleRow, { borderTopColor: ts.raw.outline }]}>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                      {row.merchant}
                    </Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                      {new Date(row.date).toLocaleDateString()} | {row.category}
                    </Text>
                  </View>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                    {formatCurrency(row.amount, row.currency)}
                  </Text>
                </View>
              ))}

              {exportPreview && exportPreview.validRowCount > exportPreview.sample.length ? (
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                  {`and ${exportPreview.validRowCount - exportPreview.sample.length} more rows`}
                </Text>
              ) : null}
              {exportPreview && exportPreview.validRowCount === 0 ? (
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>No exportable records yet.</Text>
              ) : null}
            </View>

            {exportError ? (
              <Text accessibilityLiveRegion="polite" style={[Typography.micro, { color: ts.raw.danger, marginBottom: Spacing.s2 }]}>
                {exportError}
              </Text>
            ) : null}

            <View style={styles.sheetActions}>
              <View style={{ flex: 1 }}>
                <PeachButton
                  title="Cancel"
                  onPress={() => setExportOpen(false)}
                  variant="quiet"
                  size="lg"
                  fullWidth
                  disabled={exportBusy}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PeachButton
                  title="Confirm & Download"
                  onPress={() => void confirmExport()}
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={exportBusy}
                  disabled={exportBusy || !exportPreview || exportPreview.validRowCount === 0}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Destructive confirmation (sole executor for Clear and Reset) */}
      <Modal
        visible={pendingAction !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPendingAction(null)}
      >
        <Pressable style={[styles.dialogBackdrop, { backgroundColor: ts.bg.overlay }]} onPress={() => setPendingAction(null)}>
          <Pressable
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
            style={[styles.dialogCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.danger }]}
          >
            <View style={[styles.dialogIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <AlertTriangle size={22} color={ts.raw.danger} />
            </View>
            <Text accessibilityRole="header" style={[Typography.bodyBold, styles.dialogTitle, { color: ts.raw.onSurface }]}>
              {pendingAction === 'reset_app' ? 'Factory Reset PeachSpend?' : 'Clear Transaction Records?'}
            </Text>
            <Text style={[Typography.labelMd, styles.dialogBody, { color: ts.raw.onSurfaceVariant }]}>
              {pendingAction === 'reset_app' ? RESET_DIALOG_BODY : CLEAR_DIALOG_BODY}
            </Text>
            <View style={[styles.impactBox, { backgroundColor: ts.raw.dangerSoft, borderColor: ts.raw.danger + '40' }]}>
              {(pendingAction === 'reset_app' ? RESET_IMPACT : CLEAR_IMPACT).map((item) => (
                <View key={item} style={styles.impactRow}>
                  <Text style={[Typography.micro, { color: ts.raw.danger }]}>•</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurface, flex: 1 }]}>{item}</Text>
                </View>
              ))}
            </View>
            <View style={styles.dialogActions}>
              <View style={{ flex: 1 }}>
                <PeachButton
                  title="Keep My Data"
                  onPress={() => setPendingAction(null)}
                  variant="quiet"
                  size="md"
                  fullWidth
                  disabled={stewardBusy}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PeachButton
                  title={pendingAction === 'reset_app' ? 'Reset Everything' : 'Clear Transactions'}
                  onPress={() => void confirmStewardship()}
                  variant="destructive"
                  size="md"
                  fullWidth
                  isLoading={stewardBusy}
                  disabled={stewardBusy}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <CurrencyConversionModal
        visible={currencyOpen}
        onClose={() => setCurrencyOpen(false)}
        fromCurrency={settingsSnapshot.currency}
        expenses={ledgerRows}
        candidateCurrencies={SUPPORTED_CURRENCIES}
        rates={settings.conversion_rates ?? null}
        onConverted={handleCurrencyConverted}
      />

      {editingProfile ? (
        <EditProfileSheet
          initialName={snapshot.displayName}
          initialAvatarFile={snapshot.avatarFile}
          initialAvatarUri={avatarUri}
          memberSince={snapshot.joinDate}
          onClose={() => setEditingProfile(false)}
          onSaved={handleProfileSaved}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.s5 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  headerCircle: {
    width: HEADER_CIRCLE,
    height: HEADER_CIRCLE,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s4,
    gap: Spacing.s5,
  },
  sectionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.s1,
    marginBottom: Spacing.s2,
  },
  skeletonSectionLabel: {
    paddingHorizontal: Spacing.s1,
    marginBottom: Spacing.s2,
  },
  skeletonStack: { gap: Spacing.s1 },
  card: { padding: 0, borderRadius: Radii.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s3,
    minHeight: ROW_MIN_HEIGHT,
  },
  rowBlock: { paddingHorizontal: 0 },
  rowDivider: { borderBottomWidth: 1 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexWrap: 'wrap' },
  iconChip: {
    width: ICON_CHIP,
    height: ICON_CHIP,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    padding: Spacing.s4,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.full,
    minHeight: 36,
  },
  smallPill: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  budgetSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    marginTop: Spacing.s2,
    marginHorizontal: Spacing.s4,
    borderRadius: Radii.sm,
    borderWidth: 1,
    padding: Spacing.s2,
  },
  budgetTray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s4,
    paddingBottom: Spacing.s3,
    marginTop: Spacing.s2,
    borderTopWidth: 1,
    paddingTop: Spacing.s3,
    flexWrap: 'wrap',
  },
  budgetInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    flexGrow: 1,
    minWidth: 120,
    borderWidth: 1,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.s3,
    minHeight: 44,
  },
  budgetInput: { flex: 1, minWidth: 60, paddingVertical: Spacing.s2 },
  stewardCard: { padding: Spacing.s4, gap: Spacing.s3 },
  restoreFeedback: { borderRadius: Radii.sm, borderWidth: 1, padding: Spacing.s3 },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
  },
  divider: { height: 1, width: '100%' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s4,
    minHeight: 48,
  },
  statusDot: { width: 8, height: 8, borderRadius: Radii.full },
  errorCard: { padding: Spacing.s5, gap: Spacing.s1 },
  footerRow: { alignItems: 'center', gap: 2, paddingHorizontal: Spacing.s4, paddingVertical: Spacing.s3 },
  sheetFill: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    borderTopWidth: 1,
    padding: Spacing.s5,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: Spacing.s9,
    height: 6,
    borderRadius: Radii.full,
    alignSelf: 'center',
    marginBottom: Spacing.s3,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s3,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    marginBottom: Spacing.s3,
  },
  scopeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.sm,
    borderWidth: 1,
    padding: Spacing.s3,
    marginBottom: Spacing.s3,
  },
  exportSummary: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    padding: Spacing.s3,
    gap: Spacing.s2,
    marginBottom: Spacing.s4,
  },
  exportSummaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  readyBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
    flexShrink: 0,
  },
  exportSampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    borderTopWidth: 1,
    paddingTop: Spacing.s2,
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3 },
  dialogBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.s6,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s5,
    gap: Spacing.s3,
  },
  dialogIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  dialogTitle: { textAlign: 'center' },
  dialogBody: { textAlign: 'center' },
  impactBox: { borderRadius: Radii.sm, borderWidth: 1, padding: Spacing.s3, gap: Spacing.s1 },
  impactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2 },
  dialogActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3 },
});
