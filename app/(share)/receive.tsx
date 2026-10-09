import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Home, Image as ImageIcon, Pencil, Share2, ShieldCheck, TriangleAlert, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';

import { Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { PeachButton } from '../../components/ui/PeachButton';
import { AIProcessingOverlay } from '../../components/capture/AIProcessingOverlay';
import { VerificationSheet } from '../../components/expense/VerificationSheet';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { geminiService } from '../../services/GeminiService';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/currency';
import {
  cleanupOwnedImage as deleteOwnedImage,
  copyReceiptImageToAppCache,
  readOwnedReceiptImageAsBase64,
} from '../../utils/ownedReceiptImage';
import { consumeShareIntentHandoff, type ShareIntentFileRecord } from '../../utils/shareIntentHandoff';
import { ScannedReceipt } from '../../types/gemini';
import type { Expense } from '../../types/database';
import { resolveExpenseBatchSave, runCaptureSideEffects, normalizeCurrencyTotal, type CaptureCandidate, type DuplicateMatch } from '../../data';
import { AiError, getAiErrorMessage, getReceiptOcrAvailability, normalizeAiError } from '../../ai/contracts';

// Recovery kind selects the honest primary action for a state the canonical pair
// does not itself show (missing key, offline). Everything else uses the pair's
// "Choose Another Image" primary action.
type RecoveryKind = 'generic' | 'missing_key' | 'offline';

interface RecoveryState {
  kind: RecoveryKind;
  message: string;
}

interface OwnedImageMeta {
  mimeType: string;
  fileSize?: number;
}

// Shared AI-processing overlay copy (FR-13.4). "Your expense stays unsaved until
// you confirm" keeps the commit-safety promise truthful.
const PROCESSING_COPY = {
  contextLabel: 'Reading shared receipt...',
  title: 'Extracting items & merchant',
  description: 'Matching line totals, calculating sales tax, and validating historical duplicates. Your expense stays unsaved until you confirm.',
} as const;

// Upper bound for the image bed. The real height is driven by aspectRatio; this
// only stops a tablet-width card from growing unreasonably tall.
const IMAGE_MAX_HEIGHT = 340;
const CONTENT_MAX_WIDTH = 640;
const RECOVERY_MAX_WIDTH = 360;
const IMAGE_ASPECT_RATIO = 1.35;

// Pair header close is a 36pt circle (w-9 h-9); the 44pt floor is earned through
// hitSlop so the painted circle and the header row keep the canonical geometry.
const CLOSE_BUTTON_SIZE = 36;
const CLOSE_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };
// Pair p-3.5 (14) is not on the token scale; the nearest step plus the same
// half-step arithmetic already used by the callout and quick-fix cards.
const PANEL_PADDING = Spacing.s3 + 2;

const hasRequiredReceiptFields = (item: ScannedReceipt): boolean => (
  item.merchant.trim().length > 0 &&
  Number.isFinite(item.amount) &&
  item.amount > 0 &&
  item.currency.trim().length > 0 &&
  item.category.trim().length > 0
);

const humanizeCategory = (id: string): string => id
  .replace(/[-_]+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function describeImageMeta(meta: OwnedImageMeta): string {
  const type = meta.mimeType.split('/')[1]?.toUpperCase() || meta.mimeType;
  const size = formatFileSize(meta.fileSize);
  return size ? `${type} • ${size}` : type;
}

// One candidate shape for both the duplicate check and the save so the shared
// resolution seam sees identical input on each pass.
function buildCandidates(items: ScannedReceipt[], imageUri: string | null): CaptureCandidate[] {
  return items.map((item) => ({
    merchant: item.merchant.trim(),
    amount: item.amount,
    currency: item.currency,
    category: item.category,
    source: 'share' as const,
    origin: 'share' as const,
    scanned: true,
    date: Date.now(),
    ...(imageUri ? { imageUri } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(item.unit_price !== undefined ? { unitPrice: item.unit_price } : {}),
    ...(item.units !== undefined ? { units: item.units } : {}),
  }));
}

export default function ShareReceiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ts = useThemeStyles();
  const { settings, conversionRates } = useSettings();
  const { showToast } = useToast();
  const { checkForNewAchievements } = useAchievements();
  const { handoffToken } = useLocalSearchParams<{ handoffToken?: string }>();

  const [processing, setProcessing] = useState(true);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [scanResult, setScanResult] = useState<ScannedReceipt[] | null>(null);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [pendingBatch, setPendingBatch] = useState<ScannedReceipt[] | null>(null);
  const [savedItems, setSavedItems] = useState<ScannedReceipt[] | null>(null);
  const [savedWithImage, setSavedWithImage] = useState(false);
  const [ownedImageUri, setOwnedImageUri] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<OwnedImageMeta | null>(null);

  const ownedImageRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cleanupOwnedImage = useCallback(async () => {
    const uri = ownedImageRef.current;
    ownedImageRef.current = null;
    if (mountedRef.current) {
      setOwnedImageUri(null);
      setImageMeta(null);
    }
    await deleteOwnedImage(uri ?? undefined);
  }, []);

  // Focus loss and unmount release the app-owned cache copy exactly once. A saved
  // record already reclaimed ownership, so the ref is null and this is a no-op.
  useFocusEffect(useCallback(() => () => {
    void cleanupOwnedImage();
  }, [cleanupOwnedImage]));

  const returnToOrigin = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  // One conversion rule for the whole app: the shared data layer owns it. An
  // item whose rate is missing stays in its source currency rather than being
  // counted at par, so the batch total never hides a wrong number.
  const convertToUserCurrency = useCallback((items: ScannedReceipt[]): ScannedReceipt[] => items.map((item) => {
    if (item.currency === settings.currency) return item;
    const normalized = normalizeCurrencyTotal(
      [{ amount: item.amount, currency: item.currency }],
      settings.currency,
      conversionRates,
    );
    if (!normalized.complete) return item;
    return { ...item, amount: normalized.total, currency: settings.currency };
  }), [conversionRates, settings.currency]);

  const applyAiError = useCallback((error: unknown) => {
    const normalized = normalizeAiError(error, 'gemini');
    logger.error('Failed to process shared image', normalized.code);
    const kind: RecoveryKind = normalized.code === 'offline'
      ? 'offline'
      : normalized.code === 'missing_key'
        ? 'missing_key'
        : 'generic';
    setRecovery({ kind, message: getAiErrorMessage(normalized.code, 'receipt') });
  }, []);

  const checkAvailability = useCallback(async (): Promise<'ready' | 'offline' | 'missing_key'> => {
    let connected = false;
    try {
      const state = await NetInfo.fetch();
      connected = state.isConnected === true && state.isInternetReachable === true;
    } catch {
      connected = false;
    }
    const apiKey = await databaseService.getSecret('gemini_api_key');
    return getReceiptOcrAvailability(connected, Boolean(apiKey));
  }, []);

  const runOcr = useCallback(async (uri: string) => {
    setProcessing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const base64 = await readOwnedReceiptImageAsBase64(uri);
      const rawItems = await geminiService.scanReceipt(base64, 'receipt', { signal: controller.signal });
      if (!rawItems || !Array.isArray(rawItems)) {
        throw new AiError('invalid_response', 'gemini', 'AI response did not match the receipt contract');
      }
      if (rawItems.some((item) => !hasRequiredReceiptFields(item))) {
        throw new AiError('invalid_response', 'gemini', 'Receipt is missing required data');
      }
      const items = convertToUserCurrency(rawItems);
      if (!mountedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanResult(items);
      setIsSheetVisible(true);
    } catch (error) {
      // A user cancel is not an AI failure; leave quietly (the screen unmounts).
      if (!(error instanceof AiError && error.code === 'cancelled')) applyAiError(error);
      await cleanupOwnedImage();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setProcessing(false);
    }
  }, [applyAiError, cleanupOwnedImage, convertToUserCurrency]);

  const processRecord = useCallback(async (record: ShareIntentFileRecord) => {
    setProcessing(true);
    setRecovery(null);
    try {
      const copied = await copyReceiptImageToAppCache(record.uri, record.mimeType, record.fileSize);
      ownedImageRef.current = copied;
      if (mountedRef.current) {
        setOwnedImageUri(copied);
        setImageMeta({ mimeType: record.mimeType, fileSize: record.fileSize });
      }
      await runOcr(copied);
    } catch (error) {
      applyAiError(error);
      await cleanupOwnedImage();
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  }, [applyAiError, cleanupOwnedImage, runOcr]);

  // One-shot handoff: the opaque token is consumed exactly once and the raw native
  // URI never reaches state, params, or the UI. The guard also protects against a
  // double effect invocation re-consuming an already-deleted token.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const token = Array.isArray(handoffToken) ? undefined : handoffToken;
        const record = token ? consumeShareIntentHandoff(token) : null;
        if (!record) {
          if (mountedRef.current) {
            setRecovery({ kind: 'generic', message: 'This shared image is no longer available. Share it again to retry.' });
            setProcessing(false);
          }
          return;
        }
        const availability = await checkAvailability();
        if (!mountedRef.current) return;
        if (availability === 'offline') {
          setRecovery({ kind: 'offline', message: getAiErrorMessage('offline', 'receipt') });
          setProcessing(false);
          return;
        }
        if (availability === 'missing_key') {
          setRecovery({ kind: 'missing_key', message: 'Gemini API key missing. Open AI Provider Settings.' });
          setProcessing(false);
          return;
        }
        await processRecord(record);
      } catch {
        if (mountedRef.current) setProcessing(false);
      }
    })();
    // The handoff is one-shot; re-running on callback identity changes would
    // re-consume the deleted token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffToken]);

  const runBatchSideEffects = useCallback(async (records: Expense[], candidates: CaptureCandidate[]) => {
    for (const [index, candidate] of candidates.entries()) {
      await runCaptureSideEffects(
        { status: 'saved', record: records[index], origin: { source: 'share', origin: 'share', reviewed: true } },
        candidate,
        {
          onExpenseSaved: checkForNewAchievements,
          onIncomeSaved: async () => undefined,
          scheduleNotification: (savedCandidate) => {
            if ('merchant' in savedCandidate) {
              notificationService.scheduleExpenseNotification(
                savedCandidate.merchant,
                `${savedCandidate.currency} ${savedCandidate.amount.toFixed(2)}`,
              );
            }
          },
        },
      );
    }
  }, [checkForNewAchievements]);

  const finalizeBatchSave = useCallback((items: ScannedReceipt[]) => {
    const hadImage = Boolean(ownedImageRef.current);
    // The persisted expense record now owns the cache copy, so release the ref
    // without deleting the file.
    ownedImageRef.current = null;
    setIsSheetVisible(false);
    setScanResult(null);
    setOwnedImageUri(null);
    setImageMeta(null);
    setSavedWithImage(hadImage);
    setSavedItems(items);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Saved ${items.length} expense${items.length > 1 ? 's' : ''} from shared receipt`, 'success');
  }, [showToast]);

  // Save Anyway only. A clean confirm persists inside handleConfirm through the
  // same shared boundary, so calling this on a clean batch would insert twice.
  const executeSave = useCallback(async (items: ScannedReceipt[]) => {
    if (items.length === 0 || items.some((item) => !hasRequiredReceiptFields(item))) {
      showToast('Review missing receipt fields before saving.', 'error');
      return;
    }
    const repository = await databaseService.getCaptureRepository();
    const candidates = buildCandidates(items, ownedImageRef.current);
    const resolution = await resolveExpenseBatchSave(repository, candidates, 'save_anyway');
    if (resolution.status !== 'saved') throw new Error('capture_save_failed');
    await runBatchSideEffects(resolution.records, candidates);
    finalizeBatchSave(items);
  }, [finalizeBatchSave, runBatchSideEffects, showToast]);

  const handleConfirm = useCallback(async (items: ScannedReceipt[]) => {
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (items.length === 0) return;
      if (items.some((item) => !hasRequiredReceiptFields(item))) {
        showToast('Review missing receipt fields before saving.', 'error');
        return;
      }
      const repository = await databaseService.getCaptureRepository();
      const candidates = buildCandidates(items, ownedImageRef.current);
      const resolutions = await resolveExpenseBatchSave(repository, candidates, 'confirm');
      if (resolutions.status === 'needs_review') {
        const firstMatch = resolutions.matches.find((match) => 'match' in match)?.match;
        if (!firstMatch) return;
        setDuplicateWarning(firstMatch);
        setPendingBatch(items);
        return;
      }
      if (resolutions.status !== 'saved') return;
      // The confirm pass already persisted the batch. Run side effects on those
      // real records only; never re-enter executeSave (save_anyway) here.
      await runBatchSideEffects(resolutions.records, candidates);
      finalizeBatchSave(items);
    } catch {
      logger.error('Failed to save shared receipt', 'save_failed');
      showToast('Failed to save expenses', 'error');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [finalizeBatchSave, runBatchSideEffects, showToast]);

  const handleChooseAnother = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: false, quality: 0.5 });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      if (!asset.mimeType) throw new Error('unsupported_image_type');
      setRecovery(null);
      setProcessing(true);
      const copied = await copyReceiptImageToAppCache(asset.uri, asset.mimeType, asset.fileSize);
      ownedImageRef.current = copied;
      if (mountedRef.current) {
        setOwnedImageUri(copied);
        setImageMeta({ mimeType: asset.mimeType, fileSize: asset.fileSize });
      }
      await runOcr(copied);
    } catch (error) {
      applyAiError(error);
      await cleanupOwnedImage();
      if (mountedRef.current) setProcessing(false);
    }
  }, [applyAiError, cleanupOwnedImage, runOcr]);

  const leaveWithCleanup = useCallback(() => {
    void (async () => {
      await cleanupOwnedImage();
      returnToOrigin();
    })();
  }, [cleanupOwnedImage, returnToOrigin]);

  const handleGoHome = useCallback(() => {
    void (async () => {
      await cleanupOwnedImage();
      router.replace('/(tabs)');
    })();
  }, [cleanupOwnedImage, router]);

  const handleCancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    setProcessing(false);
    leaveWithCleanup();
  }, [leaveWithCleanup]);

  const handleSheetCancel = useCallback(() => {
    setIsSheetVisible(false);
    setScanResult(null);
    leaveWithCleanup();
  }, [leaveWithCleanup]);

  const handleDuplicateDiscard = useCallback(() => {
    setDuplicateWarning(null);
    setPendingBatch(null);
    setIsSheetVisible(false);
    setScanResult(null);
    leaveWithCleanup();
  }, [leaveWithCleanup]);

  const showSuccess = savedItems !== null;
  const showRecovery = recovery !== null;
  const headerSubtitle = showSuccess
    ? 'Saved to your ledger'
    : showRecovery
      ? 'Could not read image'
      : `From ${Platform.OS === 'ios' ? 'iOS' : 'Android'} share sheet`;

  const firstSaved = savedItems?.[0];
  const savedCount = savedItems?.length ?? 0;
  const isSingleSaved = Boolean(firstSaved) && savedCount === 1;
  // Pair success body sets the merchant and amount in purple semibold ahead of
  // the plain result sentence. Multi-item saves keep the honest count sentence.
  const successMerchant = isSingleSaved && firstSaved
    ? `${firstSaved.merchant} (${formatCurrency(firstSaved.amount, firstSaved.currency)})`
    : null;
  const successTail = isSingleSaved && firstSaved
    ? ` has been logged under ${humanizeCategory(firstSaved.category)}.`
    : `${savedCount} shared receipts have been logged to your ledger.`;

  return (
    <View style={[styles.screen, { backgroundColor: ts.bg.screen }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + PANEL_PADDING, backgroundColor: ts.bg.surface, borderBottomColor: ts.border.subtle },
        ]}
      >
        <Pressable
          onPress={leaveWithCleanup}
          accessibilityRole="button"
          accessibilityLabel="Close shared receipt and return"
          hitSlop={CLOSE_HIT_SLOP}
          style={[styles.closeButton, { backgroundColor: ts.bg.elevated }]}
        >
          <X size={20} color={ts.icon.default} />
        </Pressable>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: ts.text.onSurface }]}>
            Shared Receipt
          </Text>
          <View style={styles.subtitleRow}>
            <View style={[styles.dot, { backgroundColor: ts.bg.primary }]} />
            <Text numberOfLines={1} style={[styles.subtitle, { color: ts.text.onSurfaceVariant }]}>
              {headerSubtitle}
            </Text>
          </View>
        </View>
        <View style={[styles.sharePill, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
          <Share2 size={12} color={ts.icon.primary} />
          <Text style={[styles.sharePillText, { color: ts.text.primary }]}>Shared</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.bodyContent} style={styles.body} keyboardShouldPersistTaps="handled">
        {showSuccess ? (
          <View style={[styles.recoveryBlock, styles.successBlock]}>
            <View style={[styles.successIcon, { backgroundColor: ts.raw.statusSuccessContainer }]}>
              <Check size={32} color={ts.raw.statusSuccessText} />
            </View>
            <Text accessibilityRole="header" style={[styles.recoveryTitle, { color: ts.text.onSurface }]}>
              Expense Saved to Ledger
            </Text>
            <Text style={[styles.recoveryBody, { color: ts.text.onSurfaceVariant }]}>
              {successMerchant ? (
                <Text style={[styles.successMerchant, { color: ts.text.primary }]}>{successMerchant}</Text>
              ) : null}
              {successTail}
            </Text>
            <View style={[styles.summaryCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: ts.text.onSurfaceVariant }]}>Origin</Text>
                <Text style={[styles.summaryValue, { color: ts.text.onSurface }]}>Shared image receive</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: ts.text.onSurfaceVariant }]}>Receipt Asset</Text>
                <Text style={[styles.summaryValue, { color: savedWithImage ? ts.raw.successText : ts.text.onSurfaceVariant }]}>
                  {savedWithImage ? 'Attached to ledger entry' : 'Not attached'}
                </Text>
              </View>
            </View>
            <PeachButton title="Return to Home Dashboard" onPress={handleGoHome} variant="primary" size="lg" fullWidth />
          </View>
        ) : showRecovery && recovery ? (
          <View style={[styles.recoveryBlock, styles.errorBlock]}>
            <View style={[styles.recoveryIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <TriangleAlert size={32} color={ts.raw.danger} />
            </View>
            <Text accessibilityRole="header" style={[styles.recoveryTitle, { color: ts.text.onSurface }]}>
              Couldn&apos;t Read Shared Image
            </Text>
            <Text style={[styles.recoveryBody, { color: ts.text.onSurfaceVariant }]}>{recovery.message}</Text>
            {recovery.kind === 'generic' ? (
              <View style={[styles.fixCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <Text style={[styles.fixTitle, { color: ts.text.onSurface }]}>Quick Fix Suggestions:</Text>
                {[
                  'Share an image with all four corners visible.',
                  'Avoid strong glare on thermal paper totals.',
                  'Ensure the merchant and grand total are legible.',
                ].map((line) => (
                  <View key={line} style={styles.fixRow}>
                    <View style={[styles.fixDot, { backgroundColor: ts.text.onSurfaceVariant }]} />
                    <Text style={[styles.fixText, { color: ts.text.onSurfaceVariant }]}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.actionStack}>
              {recovery.kind === 'missing_key' ? (
                <PeachButton
                  title="Open AI Provider Settings"
                  onPress={() => router.push('/settings/chat')}
                  variant="primary"
                  size="lg"
                  fullWidth
                />
              ) : recovery.kind === 'offline' ? (
                <PeachButton
                  title="Enter Manually"
                  onPress={() => router.push('/expense/manual')}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<Pencil size={16} color={Colors.white} />}
                />
              ) : (
                <PeachButton
                  title="Choose Another Image"
                  onPress={() => { void handleChooseAnother(); }}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<ImageIcon size={16} color={Colors.white} />}
                />
              )}
              <PeachButton
                title="Go Home"
                onPress={handleGoHome}
                variant="neutral"
                size="lg"
                fullWidth
                icon={<Home size={16} color={ts.text.onSurface} />}
              />
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={[styles.callout, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
              <View style={[styles.aiBadge, { backgroundColor: ts.bg.primary }]}>
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
              <View style={styles.calloutBody}>
                <Text style={[styles.calloutTitle, { color: ts.text.onSurface }]}>System Intent Detected</Text>
                <Text style={[styles.calloutText, { color: ts.text.onSurfaceVariant }]}>
                  Peach received an image from your device&apos;s share sheet. Starting automatic receipt scanning.
                </Text>
              </View>
            </View>

            <View style={[styles.imageCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
              <View style={[styles.imageArea, { backgroundColor: Gradients.light[0] }]}>
                <Image
                  source={ownedImageUri ? { uri: ownedImageUri } : undefined}
                  style={styles.imageFill}
                  contentFit="cover"
                  transition={150}
                  accessibilityLabel="Shared receipt image"
                />
                {imageMeta ? (
                  <View style={[styles.metaChip, { backgroundColor: ts.bg.overlay }]}>
                    <ImageIcon size={12} color={Colors.white} />
                    <Text numberOfLines={1} style={styles.metaChipText}>{describeImageMeta(imageMeta)}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.imageFooter}>
                <View style={styles.imageFooterText}>
                  <Text numberOfLines={1} style={[styles.imageTitle, { color: ts.text.onSurface }]}>
                    Incoming Share Ingestion
                  </Text>
                  <Text numberOfLines={1} style={[styles.imageMeta, { color: ts.text.onSurfaceVariant }]}>
                    Secure app copy ready for OCR
                  </Text>
                </View>
                <View style={[styles.autoChip, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
                  <Text style={[styles.autoChipText, { color: ts.text.primary }]}>Auto</Text>
                </View>
              </View>
            </View>

            <View style={styles.infoGrid}>
              <View style={[styles.infoCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <Text style={[styles.infoLabel, { color: ts.text.onSurfaceVariant }]}>Privacy Guard</Text>
                <View style={styles.infoValueRow}>
                  <ShieldCheck size={12} color={ts.raw.successText} />
                  <Text numberOfLines={2} style={[styles.infoValue, { color: ts.raw.successText }]}>
                    Sent via your own AI key
                  </Text>
                </View>
              </View>
              <View style={[styles.infoCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <Text style={[styles.infoLabel, { color: ts.text.onSurfaceVariant }]}>Commit Safety</Text>
                <Text numberOfLines={2} style={[styles.infoValue, { color: ts.text.onSurface }]}>Nothing saved yet</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <AIProcessingOverlay
        visible={processing && !showRecovery && !showSuccess}
        contextLabel={PROCESSING_COPY.contextLabel}
        title={PROCESSING_COPY.title}
        description={PROCESSING_COPY.description}
        onCancel={handleCancelProcessing}
      />

      <VerificationSheet
        isVisible={isSheetVisible}
        data={scanResult}
        origin="share"
        imageUri={ownedImageUri}
        onRetry={ownedImageUri ? () => { void runOcr(ownedImageUri); } : undefined}
        onConfirm={handleConfirm}
        onCancel={handleSheetCancel}
      />

      {duplicateWarning && pendingBatch && pendingBatch[0] ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicateWarning}
          incoming={{
            merchant: pendingBatch[0].merchant,
            amount: pendingBatch[0].amount,
            currency: pendingBatch[0].currency,
            category: pendingBatch[0].category,
            type: 'expense',
          }}
          onSaveAnyway={async () => {
            const batch = pendingBatch || [];
            setDuplicateWarning(null);
            setPendingBatch(null);
            await executeSave(batch);
          }}
          onDiscard={handleDuplicateDiscard}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingBottom: PANEL_PADDING,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: CLOSE_BUTTON_SIZE,
    height: CLOSE_BUTTON_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...Typography.headlineMd },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 + 2, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: Radii.full },
  subtitle: { ...Typography.micro, flexShrink: 1 },
  sharePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  sharePillText: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold' },
  body: { flex: 1 },
  bodyContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    padding: Spacing.s5,
    paddingBottom: Spacing.s8,
  },
  section: { gap: Spacing.s4 },
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: PANEL_PADDING,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  aiBadge: { width: 32, height: 32, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  aiBadgeText: { ...Typography.captionBold, color: Colors.white },
  calloutBody: { flex: 1, minWidth: 0 },
  calloutTitle: { ...Typography.labelBold },
  calloutText: { ...Typography.labelMd, marginTop: 2 },
  imageCard: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  imageArea: { width: '100%', aspectRatio: IMAGE_ASPECT_RATIO, maxHeight: IMAGE_MAX_HEIGHT },
  imageFill: { width: '100%', height: '100%' },
  metaChip: {
    position: 'absolute',
    bottom: Spacing.s3,
    left: Spacing.s3,
    maxWidth: '70%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1 + 2,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
  },
  metaChipText: { ...Typography.micro, color: Colors.white, flexShrink: 1 },
  imageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    padding: Spacing.s4,
  },
  imageFooterText: { flex: 1, minWidth: 0 },
  imageTitle: { ...Typography.labelBold },
  imageMeta: { ...Typography.micro, marginTop: 2 },
  autoChip: {
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
    flexShrink: 0,
  },
  autoChipText: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold' },
  infoGrid: { flexDirection: 'row', gap: Spacing.s3 },
  infoCard: { flex: 1, padding: Spacing.s3, borderRadius: Radii.md, borderWidth: 1, gap: Spacing.s1 },
  infoLabel: { ...Typography.micro },
  infoValueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  infoValue: { ...Typography.labelBold, flexShrink: 1 },
  recoveryBlock: {
    width: '100%',
    maxWidth: RECOVERY_MAX_WIDTH,
    alignSelf: 'center',
    alignItems: 'center',
  },
  // Pair error stack is space-y-5 (20) with pt-8 (32).
  errorBlock: { paddingTop: Spacing.s7, gap: Spacing.s5 },
  // Pair success stack is space-y-6 (24) with pt-10 (40).
  successBlock: { paddingTop: Spacing.s8, gap: Spacing.s6 },
  recoveryIcon: { width: 64, height: 64, borderRadius: Radii.lg, alignItems: 'center', justifyContent: 'center' },
  successIcon: { width: 64, height: 64, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  recoveryTitle: { ...Typography.headlineMd, textAlign: 'center' },
  // Pair body is max-w-xs (320) centered; the merchant span is semibold purple.
  recoveryBody: { ...Typography.labelMd, textAlign: 'center', maxWidth: 320, alignSelf: 'center' },
  successMerchant: { ...Typography.labelMd, fontFamily: 'Manrope_600SemiBold' },
  fixCard: { width: '100%', padding: PANEL_PADDING, borderRadius: Radii.md, borderWidth: 1, gap: Spacing.s2 },
  fixTitle: { ...Typography.labelBold },
  fixRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2 },
  fixDot: { width: 4, height: 4, borderRadius: Radii.full, marginTop: 6 },
  fixText: { ...Typography.micro, flex: 1, minWidth: 0 },
  // Pair actions sit in a space-y-2 stack with pt-4 (16) above it.
  actionStack: { width: '100%', gap: Spacing.s2, paddingTop: Spacing.s4 },
  summaryCard: { width: '100%', padding: Spacing.s4, borderRadius: Radii.md, borderWidth: 1, gap: Spacing.s2 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.s3 },
  summaryLabel: { ...Typography.micro, flexShrink: 0 },
  summaryValue: { ...Typography.labelLg, flexShrink: 1, textAlign: 'right' },
});
