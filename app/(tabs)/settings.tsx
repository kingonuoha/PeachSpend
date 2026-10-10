import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { EditProfileSheet } from '../../components/profile/EditProfileSheet';
import { CurrencyConversionModal } from '../../components/settings/CurrencyConversionModal';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { useExpenses } from '../../hooks/useExpenses';
import { useThemeStyles } from '../../hooks/useThemeStyles';
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
import { getCurrencyName } from '../../utils/currency';
import { resolveAvatarUri } from '../../utils/profileAvatar';
import type { ProfileSnapshot } from '../../data/ProfileContracts';
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
// Reference currency list for the SH-06a candidate options. Shared reference data
// only, the same set onboarding offers; symbols and names come from utils/currency.
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'] as const;
// Decorative code preview surface. The export sample block has no functional
// theme token in the pair, so it keeps a fixed dark code look in both modes.
const CODE_SURFACE = '#17162A';
const CODE_TEXT = '#D7D3E6';
const CODE_MUTED = '#8B8B99';

// Data Stewardship copy is built from the D8/D9 scope facts so the dialog can
// never claim a wider or narrower clear than the database and the media erasure
// boundary perform (S-06R-01, S-06R-02). The key-to-label maps are presentation
// only; every action named here is read from the exported scope constants.
const CLEAR_SCOPE_LABELS: Record<string, string> = {
  expenses: 'expenses',
  income: 'income',
  chat_expense_confirmations: 'chat expense confirmations',
  capture_events: 'capture records',
  capture_queue: 'queued captures',
};
const KEPT_SCOPE_LABELS: Record<string, string> = {
  categories: 'categories',
  settings: 'settings and budgets',
  api_keys: 'stored provider keys',
  achievements: 'achievements',
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
  `Removes ${joinLabels(CLEARED_RECORDS)} and their ${joinLabels(CLEAR_MEDIA)}; ` +
  `keeps ${joinLabels(KEPT_RECORDS)}.`;
const RESET_ROW_SUBTITLE =
  `Erases all local data and keys, and removes ${joinLabels(RESET_MEDIA)}; returns to onboarding.`;
const CLEAR_DIALOG_BODY =
  `This removes ${joinLabels(CLEARED_RECORDS)} from this device, along with their ` +
  `${joinLabels(CLEAR_MEDIA)}. ${capitalizeFirst(joinLabels(KEPT_RECORDS))} are kept.`;
const RESET_DIALOG_BODY =
  `This erases all local database content and every stored provider key, and removes ` +
  `${joinLabels(RESET_MEDIA)}. The app returns to onboarding.`;
const CLEAR_IMPACT = [
  `Removed: ${capitalizeFirst(joinLabels(CLEARED_RECORDS))}`,
  `Removed media: ${capitalizeFirst(joinLabels(CLEAR_MEDIA))}`,
  `Kept: ${capitalizeFirst(joinLabels(KEPT_RECORDS))}`,
];
const RESET_IMPACT = [
  'All local database content is cleared',
  'Stored provider keys are deleted',
  `Removed media: ${capitalizeFirst(joinLabels(RESET_MEDIA))}`,
  'Returns to onboarding',
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

function formatSampleDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
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

export default function SettingsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const { settings, refreshSettings, getCurrencySymbol } = useSettings();
  const { showToast } = useToast();
  const { expenses, refreshExpenses } = useExpenses();

  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [reloading, setReloading] = useState(false);
  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [recurringCount, setRecurringCount] = useState<number | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);

  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
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

  const loadSnapshot = useCallback(async () => {
    const next = await profileDataService.getSnapshot();
    setSnapshot(next);
  }, []);

  useEffect(() => {
    let active = true;
    void profileDataService.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, []);

  // Secondary metadata loads independently; each failure only hides its own value
  // instead of blanking the screen or inventing a default.
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      categoryService.list(),
      recurringDataService.list(),
      aiChatService.getProviderKeyState(),
    ]).then(([categories, recurring, keys]) => {
      if (!active) return;
      if (categories.status === 'fulfilled') setCategoryCount(categories.value.length);
      if (recurring.status === 'fulfilled') {
        setRecurringCount(recurring.value.status === 'ready' ? recurring.value.templates.length : 0);
      }
      if (keys.status === 'fulfilled') {
        setProviderConfigured(
          keys.value.gemini.status === 'configured' || keys.value.openrouter.status === 'configured',
        );
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const retry = async () => {
    setReloading(true);
    await loadSnapshot();
    setReloading(false);
  };

  const avatarUri = snapshot ? resolveAvatarUri(snapshot.avatarFile) : null;
  const memberSince = snapshot ? formatMemberSince(snapshot.joinDate) : null;
  const budgetLabel = settingsSnapshot.budget > 0
    ? `${getCurrencySymbol(settingsSnapshot.budgetCurrency)}${settingsSnapshot.budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  const startBudgetEdit = () => {
    setBudgetDraft(settingsSnapshot.budget > 0 ? String(settingsSnapshot.budget) : '');
    setBudgetError(null);
    setBudgetEditing(true);
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

  const openExport = () => {
    setExportPreview(buildExportPreview(expenses, { start: 0, end: Date.now() }, 3));
    setExportError(null);
    setExportOpen(true);
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
      if (outcome.status === 'converted') {
        await refreshExpenses();
        await refreshSettings();
        showToast(`Base currency changed to ${outcome.toCurrency}`, 'success');
      } else if (outcome.status === 'partial') {
        await refreshExpenses();
        await refreshSettings();
        showToast(`Converted ${outcome.convertedCount}, skipped ${outcome.skippedCount}: missing rate for ${outcome.missingRates.join(', ')}`, 'error');
      } else {
        showToast(`Missing conversion rate for ${outcome.missingRates.join(', ')}`, 'error');
      }
    },
    [refreshExpenses, refreshSettings, showToast],
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
    await refreshExpenses();
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
        await refreshExpenses();
        await refreshSettings();
      }
      showToast(feedback.title, feedback.tone === 'success' ? 'success' : feedback.tone === 'error' ? 'error' : 'info');
    } catch {
      setRestoreFeedback(describeContinuityFileReadFailure());
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreBusy, refreshExpenses, refreshSettings, showToast]);

  if (!snapshot) {
    return (
      <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
        <View style={styles.centerBox}>
          <ActivityIndicator color={ts.raw.primary} />
          <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s3 }]}>
            Loading settings
          </Text>
        </View>
      </SafeAreaView>
    );
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

  const sectionLabelInline = (label: string) => (
    <Text style={[Typography.captionBold, styles.sectionLabelInline, { color: ts.raw.onSurfaceVariant }]}>
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
          hitSlop={4}
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
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section 1: Account & Identity */}
          <View>
            {sectionLabel('Account & Identity')}
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
            </LuminousCard>
          </View>

          {/* Section 2: Preferences & Core Setup */}
          <View>
            {sectionLabel('Preferences & Core Setup')}
            <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
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
                onPress={() => setCurrencyOpen(true)}
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

              {/* AI Provider -> S-17, link only, no key field here */}
              <ScalePressable
                onPress={() => router.push('/settings/chat')}
                accessibilityRole="button"
                accessibilityLabel="AI provider and keys"
                style={styles.row}
              >
                <View style={styles.rowLeft}>
                  {iconChip(<Sparkles size={16} color={ts.raw.primary} />, ts.raw.purple100)}
                  <View style={styles.rowText}>
                    <View style={styles.titleRow}>
                      <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                        AI Provider &amp; Keys
                      </Text>
                      <View style={[styles.tagChip, { backgroundColor: ts.raw.warningContainer }]}>
                        <Text style={[Typography.micro, { color: ts.raw.warningContainerText, fontFamily: 'Manrope_700Bold' }]}>
                          S-17 Hub
                        </Text>
                      </View>
                    </View>
                    <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
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

          {/* Section 3: Sub-Systems & Workflows */}
          <View>
            {sectionLabel('Sub-Systems & Workflows')}
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
                style={[styles.row, styles.rowDivider, { borderBottomColor: ts.raw.outline }]}
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

              <ScalePressable
                onPress={() => router.push('/notifications')}
                accessibilityRole="button"
                accessibilityLabel="Notification channels"
                style={styles.row}
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
            </LuminousCard>
          </View>

          {/* Section 4: Data Portability & Stewardship */}
          <View>
            <View style={styles.sectionHeadRow}>
              {sectionLabelInline('Data Portability & Stewardship')}
              <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>
                SQLite Offline First
              </Text>
            </View>
            <LuminousCard variant="low" style={[styles.card, styles.stewardCard, { backgroundColor: ts.raw.surface }]}>
              <View style={styles.exportRow}>
                <View style={styles.rowText}>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>Export Financial Ledger</Text>
                  <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                    {expenses.length === 1 ? '1 record' : `${expenses.length} records`}
                  </Text>
                </View>
                <PeachButton
                  title="Export"
                  onPress={openExport}
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
            </LuminousCard>
          </View>

          {/* Section 5: About & Support */}
          <View>
            {sectionLabel('About & Support')}
            <LuminousCard variant="low" style={[styles.card, { backgroundColor: ts.raw.surface }]}>
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
            </LuminousCard>
            <View style={styles.footer}>
              {appVersion ? (
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>PeachSpend v{appVersion}</Text>
              ) : null}
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, textAlign: 'center' }]}>
                Your financial data stays on device
              </Text>
            </View>
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

            <ScrollView style={[styles.codeBlock, { backgroundColor: CODE_SURFACE }]} contentContainerStyle={styles.codeBlockContent}>
              <Text style={[styles.codeText, { color: CODE_MUTED }]}>
                {'date,merchant,amount,currency,category'}
              </Text>
              {(exportPreview?.sample ?? []).map((row, index) => (
                <Text key={`${row.date}-${index}`} style={[styles.codeText, { color: CODE_TEXT }]}>
                  {`${formatSampleDate(row.date)},${row.merchant},${row.amount.toFixed(2)},${row.currency},${row.category}`}
                </Text>
              ))}
              {exportPreview && exportPreview.validRowCount > exportPreview.sample.length ? (
                <Text style={[styles.codeText, { color: CODE_MUTED }]}>
                  {`... (+${exportPreview.validRowCount - exportPreview.sample.length} more records)`}
                </Text>
              ) : null}
              {exportPreview && exportPreview.validRowCount === 0 ? (
                <Text style={[styles.codeText, { color: CODE_MUTED }]}>No exportable records yet.</Text>
              ) : null}
            </ScrollView>

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
                  title="Cancel Safe"
                  onPress={() => setPendingAction(null)}
                  variant="quiet"
                  size="md"
                  fullWidth
                  disabled={stewardBusy}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PeachButton
                  title={pendingAction === 'reset_app' ? 'Erase Everything' : 'Clear Transactions'}
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
        expenses={expenses}
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
    width: 36,
    height: 36,
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
    paddingBottom: 120,
    gap: Spacing.s5,
  },
  sectionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.s1,
    marginBottom: Spacing.s2,
  },
  sectionLabelInline: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.s1,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
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
  tagChip: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.sm,
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
  footer: { alignItems: 'center', gap: 2, marginTop: Spacing.s3 },
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
  codeBlock: { borderRadius: Radii.sm, maxHeight: 180, marginBottom: Spacing.s4 },
  codeBlockContent: { padding: Spacing.s3, gap: 2 },
  codeText: { fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 16 },
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
