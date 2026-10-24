import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Home, Image as ImageIcon, Pencil, RotateCcw, ScanLine, Share2, ShieldCheck, TriangleAlert, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';

import { Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { AIProcessingOverlay } from '../../components/capture/AIProcessingOverlay';
import { pipelineSteps, type PipelineStage } from '../../components/capture/pipelineStages';
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
import { AiError, getAiErrorMessage, getReceiptOcrAvailability, normalizeAiError, type AiErrorCode } from '../../ai/contracts';

// Recovery kind selects the honest primary action for a state the canonical pair
// does not itself show (missing key, offline). Everything else uses the pair's
// "Choose Another Image" primary action.
type RecoveryKind = 'generic' | 'missing_key' | 'offline';

interface RecoveryState {
  message: string;
  // The AI failure code behind this state, or null for the one non-AI state: a
  // share handoff token that was already consumed. The kind is derived from it
  // rather than stored beside it, so the two cannot disagree.
  code: AiErrorCode | null;
}

// The manual entry route the scan surface and the offline state already use, so a
// user whose shared image cannot be read still has a way to log the expense.
export const RECOVERY_MANUAL_ROUTE = '/expense/manual';

export function recoveryKind(code: AiErrorCode | null): RecoveryKind {
  if (code === 'offline') return 'offline';
  if (code === 'missing_key') return 'missing_key';
  return 'generic';
}

// The app only ever establishes a photographic cause for `illegible_image`, where
// the provider reported that the image itself could not be read. Every other
// failure is about the provider request or the response it returned, so it is
// answered with its own honest heading and no photographic remedy (DEC-B75).
const PHOTOGRAPHIC_ADVICE = [
  'Share an image with all four corners visible.',
  'Avoid strong glare on thermal paper totals.',
  'Ensure the merchant and grand total are legible.',
] as const;

export interface RecoveryPresentation {
  // The heading names the same cause class as the body, so a response the app
  // could not use is never headed as an image that could not be read.
  heading: string;
  // Photographic advice, empty unless the app established that the image itself
  // could not be read.
  advice: readonly string[];
  // True when the card adds a manual entry action beside its primary action. The
  // offline state already routes to manual entry as its primary action, and the
  // missing key state keeps its provider settings action, so neither adds one.
  manualEntry: boolean;
}

export function resolveRecoveryPresentation(code: AiErrorCode | null): RecoveryPresentation {
  return {
    heading: code === 'invalid_response' ? "Couldn't Use the AI Response" : "Couldn't Read Shared Image",
    advice: code === 'illegible_image' ? PHOTOGRAPHIC_ADVICE : [],
    manualEntry: recoveryKind(code) === 'generic',
  };
}

// POLISH Section 7: a failure is async, so it is spoken rather than only rendered.
// Building the spoken text from the same presentation the render uses keeps the heading
// the screen reader hears identical to the heading on screen (DEC-B75).
export function describeRecoveryAnnouncement(code: AiErrorCode | null, message: string): string {
  return `${resolveRecoveryPresentation(code).heading}. ${message}`;
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

// The success block heading, shared by the render and the POLISH Section 7 announcement
// so the two cannot drift.
const SUCCESS_HEADING = 'Expense Saved to Ledger';

// Upper bound for the image bed. The real height is driven by aspectRatio; this
// only stops a tablet-width card from growing unreasonably tall.
const IMAGE_MAX_HEIGHT = 340;
const CONTENT_MAX_WIDTH = 640;
const RECOVERY_MAX_WIDTH = 360;
const IMAGE_ASPECT_RATIO = 1.35;

// Pair header close is a 36pt circle (w-9 h-9). The painted circle stays 36 so the
// header row keeps its canonical geometry; the touch target is earned through hitSlop
// alone, at 6pt a side, so the effective target is 48 and clears the 48dp Android floor
// in POLISH Section 7 as well as the 44pt iOS one.
const CLOSE_BUTTON_SIZE = 36;
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
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

// Phase 11 B2-6. The screen only ever moves through these, in this order. The
// pre-flight step is the guard the audit asks for: the image is on this device and
// nothing has left it, and the user can cancel from there.
type SharePhase = 'preflight' | 'processing' | 'review' | 'queued' | 'saved' | 'recovery';

// Why processing cannot run right now, in the user's words. Null means it can.
const BLOCKER_COPY: Record<'offline' | 'missing_key', string> = {
  offline: 'You are offline, so the shared image has not been sent to your AI provider.',
  missing_key: 'No AI provider key is set, so the shared image has not been sent to your AI provider.',
};

const humanizeCategory = (id: string): string => id
  .replace(/[-_]+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

// The success sentence in one place, used by the render and by the POLISH Section 7
// announcement, so the rendered result and the spoken one cannot drift.
export function describeSavedBatch(items: ScannedReceipt[]): { merchant: string | null; tail: string } {
  const first = items[0];
  if (items.length === 1 && first) {
    return {
      merchant: `${first.merchant} (${formatCurrency(first.amount, first.currency)})`,
      tail: ` has been logged under ${humanizeCategory(first.category)}.`,
    };
  }
  return { merchant: null, tail: `${items.length} shared receipts have been logged to your ledger.` };
}

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

  const [phase, setPhase] = useState<SharePhase>('preflight');
  const [pipelineStage, setPipelineStage] = useState<PipelineStage | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [scanResult, setScanResult] = useState<ScannedReceipt[] | null>(null);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [pendingBatch, setPendingBatch] = useState<ScannedReceipt[] | null>(null);
  const [savedItems, setSavedItems] = useState<ScannedReceipt[] | null>(null);
  const [savedWithImage, setSavedWithImage] = useState(false);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [ownedImageUri, setOwnedImageUri] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<OwnedImageMeta | null>(null);
  // Why processing cannot run right now. It is re-checked on every attempt, so it can
  // never go stale behind a settings change or a reconnect.
  const [blocker, setBlocker] = useState<'offline' | 'missing_key' | null>(null);
  // The draft row that owns this image on this device. It exists from the moment the
  // image is copied, which is what lets the image survive a consumed handoff token.
  const [draftId, setDraftId] = useState<string | null>(null);
  // POLISH Section 7: the ingestion outcome is async, so it is spoken, not only
  // rendered. iOS has no live region and speaks through announceForAccessibility;
  // Android reads the polite live region rendered at the bottom of this screen. A live
  // region speaks only when its content changes, so the previous outcome is cleared
  // when a new attempt starts, which keeps a repeat of the same failure a distinct
  // announcement on Android instead of silence.
  const [outcomeAnnouncement, setOutcomeAnnouncement] = useState('');

  const ownedImageRef = useRef<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
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

  // Releasing the app's own copy. When a draft row owns the file, the ref has already
  // been cleared and nothing is deleted; the row is the only pointer to it.
  const cleanupOwnedImage = useCallback(async () => {
    const uri = ownedImageRef.current;
    ownedImageRef.current = null;
    if (mountedRef.current) {
      setOwnedImageUri(null);
      setImageMeta(null);
    }
    await deleteOwnedImage(uri ?? undefined);
  }, []);

  // A draft row is durable local data. Discarding the flow deletes the row and then the
  // file it pointed at, in that order, so there is never a row without a file or a file
  // without a row.
  const discardDraft = useCallback(async (): Promise<void> => {
    const id = draftIdRef.current;
    draftIdRef.current = null;
    if (mountedRef.current) setDraftId(null);
    const uri = ownedImageRef.current;
    ownedImageRef.current = null;
    if (mountedRef.current) {
      setOwnedImageUri(null);
      setImageMeta(null);
    }
    if (id) {
      try {
        const store = await databaseService.getReceiptDraftStore();
        await store.deleteReceiptDraft(id);
      } catch {
        logger.error('Failed to remove the shared receipt draft', 'share_draft_delete_failed');
      }
    }
    await deleteOwnedImage(uri ?? undefined);
  }, []);

  // Keep the image on this device and remember which row owns it. The app copy is not
  // deleted while a row points at it, so a consumed handoff token can never destroy it.
  const keepDraft = useCallback(async (uri: string, errorCode: string | null): Promise<string | null> => {
    try {
      const store = await databaseService.getReceiptDraftStore();
      const draft = await store.enqueueReceiptDraft({ imageUri: uri, source: 'share' });
      if (errorCode) await store.markReceiptDraftFailed(draft.id, errorCode);
      draftIdRef.current = draft.id;
      ownedImageRef.current = null;
      if (mountedRef.current) {
        setDraftId(draft.id);
        setOwnedImageUri(uri);
      }
      return draft.id;
    } catch {
      logger.error('Failed to keep the shared image on this device', 'share_draft_enqueue_failed');
      return null;
    }
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

  const announceOutcome = useCallback((message: string) => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    else setOutcomeAnnouncement(message);
  }, []);

  const clearOutcomeAnnouncement = useCallback(() => setOutcomeAnnouncement(''), []);

  // One commit point for every failure this screen can reach, so a failure always
  // carries the same error haptic (POLISH Section 4, matching the sibling scan surface)
  // and the same screen-reader announcement (POLISH Section 7), whichever of the four
  // writers produced it. The AI-failure, offline, missing-key and consumed-token states
  // each keep their own code and their own message.
  const commitRecovery = useCallback((state: RecoveryState) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setRecovery(state);
    announceOutcome(describeRecoveryAnnouncement(state.code, state.message));
  }, [announceOutcome]);

  const applyAiError = useCallback((error: unknown) => {
    const normalized = normalizeAiError(error, 'gemini');
    logger.error('Failed to process shared image', normalized.code);
    commitRecovery({ code: normalized.code, message: getAiErrorMessage(normalized.code, 'receipt') });
  }, [commitRecovery]);

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
    setPhase('processing');
    setPipelineStage('captured');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPipelineStage('requesting');
      const base64 = await readOwnedReceiptImageAsBase64(uri);
      const rawItems = await geminiService.scanReceipt(base64, 'receipt', { signal: controller.signal });
      setPipelineStage('parsing');
      if (!rawItems || !Array.isArray(rawItems)) {
        throw new AiError('invalid_response', 'gemini', 'AI response did not match the receipt contract');
      }
      if (rawItems.some((item) => !hasRequiredReceiptFields(item))) {
        throw new AiError('invalid_response', 'gemini', 'Receipt is missing required data');
      }
      const items = convertToUserCurrency(rawItems);
      if (!mountedRef.current) return;
      setPipelineStage('ready');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanResult(items);
      setIsSheetVisible(true);
      setPhase('review');
    } catch (error) {
      // A user cancel is not an AI failure; the image stays on this device in its draft.
      if (!(error instanceof AiError && error.code === 'cancelled')) {
        const normalized = normalizeAiError(error, 'gemini');
        applyAiError(error);
        const id = draftIdRef.current;
        if (id) {
          try {
            const store = await databaseService.getReceiptDraftStore();
            await store.markReceiptDraftFailed(id, normalized.code);
          } catch {
            logger.error('Failed to record the share failure on the draft', 'share_draft_fail_marker_failed');
          }
        }
        if (mountedRef.current) setPhase('queued');
      } else if (mountedRef.current) {
        setPhase('queued');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setPipelineStage(null);
    }
  }, [applyAiError, convertToUserCurrency]);

  // The one entry point for a shared payload: copy it locally, record the draft row,
  // then decide whether processing can run. Nothing has left the device at any point
  // before the user presses the scan action.
  const prepareShare = useCallback(async (record: ShareIntentFileRecord) => {
    setRecovery(null);
    clearOutcomeAnnouncement();
    try {
      const copied = await copyReceiptImageToAppCache(record.uri, record.mimeType, record.fileSize);
      ownedImageRef.current = copied;
      setOwnedImageUri(copied);
      setImageMeta({ mimeType: record.mimeType, fileSize: record.fileSize });
      await keepDraft(copied, null);
      const availability = await checkAvailability();
      if (!mountedRef.current) return;
      if (availability === 'ready') {
        setBlocker(null);
        setPhase('preflight');
      } else {
        setBlocker(availability);
        setPhase('queued');
      }
    } catch (error) {
      applyAiError(error);
      await discardDraft();
      if (mountedRef.current) setPhase('recovery');
    }
  }, [applyAiError, checkAvailability, clearOutcomeAnnouncement, discardDraft, keepDraft]);

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
            commitRecovery({ code: null, message: 'This shared image is no longer available. Share it again to retry.' });
            setPhase('recovery');
          }
          return;
        }
        await prepareShare(record);
      } catch {
        if (mountedRef.current) setPhase('recovery');
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
                `${formatCurrency(savedCandidate.amount, savedCandidate.currency)}`,
              );
            }
          },
        },
      );
    }
  }, [checkForNewAchievements]);

  const finalizeBatchSave = useCallback(async (items: ScannedReceipt[], recordId: string) => {
    const hadImage = Boolean(ownedImageRef.current) || Boolean(draftIdRef.current);
    // The draft row has done its job: the expense now points at the same file, so the
    // row is marked saved and removed while the image stays on disk.
    const id = draftIdRef.current;
    draftIdRef.current = null;
    if (id) {
      try {
        const store = await databaseService.getReceiptDraftStore();
        await store.markReceiptDraftSaved(id);
        await store.deleteReceiptDraft(id);
      } catch {
        logger.error('Failed to close the shared receipt draft', 'share_draft_save_marker_failed');
      }
    }
    ownedImageRef.current = null;
    setIsSheetVisible(false);
    setScanResult(null);
    setOwnedImageUri(null);
    setImageMeta(null);
    setDraftId(null);
    setSavedWithImage(hadImage);
    setSavedItems(items);
    setSavedRecordId(recordId);
    setPhase('saved');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // POLISH Section 7: a committed save is async, so the success is spoken, not only
    // rendered. The sentence comes from the same helper the render uses, so the two
    // cannot drift.
    const saved = describeSavedBatch(items);
    announceOutcome(`${SUCCESS_HEADING}. ${saved.merchant ?? ''}${saved.tail}`);
    showToast(`Saved ${items.length} expense${items.length > 1 ? 's' : ''} from shared receipt`, 'success');
  }, [announceOutcome, showToast]);

  // Save Anyway only. A clean confirm persists inside handleConfirm through the
  // same shared boundary, so calling this on a clean batch would insert twice.
  const executeSave = useCallback(async (items: ScannedReceipt[]) => {
    if (items.length === 0 || items.some((item) => !hasRequiredReceiptFields(item))) {
      showToast('Review missing receipt fields before saving.', 'error');
      return;
    }
    const repository = await databaseService.getCaptureRepository();
    const candidates = buildCandidates(items, ownedImageRef.current ?? ownedImageUri);
    const resolution = await resolveExpenseBatchSave(repository, candidates, 'save_anyway');
    if (resolution.status !== 'saved') throw new Error('capture_save_failed');
    await runBatchSideEffects(resolution.records, candidates);
    await finalizeBatchSave(items, resolution.records[0].id);
  }, [finalizeBatchSave, ownedImageUri, runBatchSideEffects, showToast]);

  const handleConfirm = useCallback(async (items: ScannedReceipt[]) => {
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (items.length === 0) return;
      if (items.some((item) => !hasRequiredReceiptFields(item))) {
        showToast('Review missing receipt fields before saving.', 'error');
        return;
      }
      const repository = await databaseService.getCaptureRepository();
      const candidates = buildCandidates(items, ownedImageRef.current ?? ownedImageUri);
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
      await finalizeBatchSave(items, resolutions.records[0].id);
    } catch {
      logger.error('Failed to save shared receipt', 'save_failed');
      showToast('Failed to save expenses', 'error');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [finalizeBatchSave, ownedImageUri, runBatchSideEffects, showToast]);

  const handleChooseAnother = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: false, quality: 0.5 });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      if (!asset.mimeType) throw new Error('unsupported_image_type');
      setRecovery(null);
      clearOutcomeAnnouncement();
      // A new image replaces the old one, so the old draft and its file go first.
      await discardDraft();
      const copied = await copyReceiptImageToAppCache(asset.uri, asset.mimeType, asset.fileSize);
      ownedImageRef.current = copied;
      setOwnedImageUri(copied);
      setImageMeta({ mimeType: asset.mimeType, fileSize: asset.fileSize });
      await keepDraft(copied, null);
      const availability = await checkAvailability();
      if (!mountedRef.current) return;
      if (availability === 'ready') {
        setBlocker(null);
        setPhase('preflight');
      } else {
        setBlocker(availability);
        setPhase('queued');
      }
    } catch (error) {
      applyAiError(error);
      await discardDraft();
      if (mountedRef.current) setPhase('recovery');
    }
  }, [applyAiError, checkAvailability, clearOutcomeAnnouncement, discardDraft, keepDraft]);

  // Leaving before anything was saved discards the local copy: the user cancelled the
  // flow, so there is nothing to keep.
  const leaveWithCleanup = useCallback(() => {
    void (async () => {
      await discardDraft();
      returnToOrigin();
    })();
  }, [discardDraft, returnToOrigin]);

  // Leaving from the queued state keeps the draft: the screen already told the user the
  // image is saved on the device, so leaving must not quietly delete it.
  const leaveKeepingDraft = useCallback(() => {
    returnToOrigin();
  }, [returnToOrigin]);

  const handleHeaderClose = useCallback(() => {
    if (phase === 'queued' || phase === 'processing') leaveKeepingDraft();
    else leaveWithCleanup();
  }, [leaveKeepingDraft, leaveWithCleanup, phase]);

  const handleGoHome = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  const handleViewTransaction = useCallback(() => {
    if (!savedRecordId) return;
    router.replace({ pathname: '/expense/[id]', params: { id: savedRecordId } });
  }, [router, savedRecordId]);

  const handleCancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    setPipelineStage(null);
    // The image stays on this device in its draft row, so the user can try again.
    setPhase('queued');
    showToast('Processing cancelled. The shared image is still on this device.', 'info');
  }, [showToast]);

  const handleScanNow = useCallback(() => {
    const uri = ownedImageRef.current ?? ownedImageUri;
    if (!uri) return;
    void runOcr(uri);
  }, [ownedImageUri, runOcr]);

  // Re-check the blocker, then run. A still-blocked attempt explains itself instead of
  // pretending to start work it cannot do.
  const handleRetryQueued = useCallback(async () => {
    const uri = ownedImageRef.current ?? ownedImageUri;
    if (!uri) return;
    const availability = await checkAvailability();
    if (!mountedRef.current) return;
    if (availability !== 'ready') {
      setBlocker(availability);
      showToast(
        availability === 'offline'
          ? 'Still offline. The image stays saved on this device.'
          : 'Still no AI key. The image stays saved on this device.',
        'error',
      );
      return;
    }
    setBlocker(null);
    const id = draftIdRef.current;
    if (id) {
      try {
        const store = await databaseService.getReceiptDraftStore();
        await store.retryReceiptDraft(id);
      } catch {
        logger.error('Failed to requeue the shared draft', 'share_draft_requeue_failed');
      }
    }
    await runOcr(uri);
  }, [checkAvailability, ownedImageUri, runOcr, showToast]);

  const handleSheetCancel = useCallback(() => {
    setIsSheetVisible(false);
    setScanResult(null);
    // The extraction is abandoned, not the image: the draft keeps the file and the
    // queued state offers another attempt.
    setPhase('queued');
  }, []);

  const handleDuplicateDiscard = useCallback(() => {
    setDuplicateWarning(null);
    setPendingBatch(null);
    setIsSheetVisible(false);
    setScanResult(null);
    setPhase('queued');
  }, []);

  const showSuccess = phase === 'saved' && savedItems !== null;
  const showRecovery = phase === 'recovery' && recovery !== null;
  // Derived from the failure code rather than stored, so the presentation and the
  // primary action can never disagree with the code the state carries.
  const recoveryKindValue: RecoveryKind = recovery ? recoveryKind(recovery.code) : 'generic';
  const recoveryView: RecoveryPresentation | null = recovery ? resolveRecoveryPresentation(recovery.code) : null;
  const headerSubtitle = showSuccess
    ? 'Saved to your ledger'
    : showRecovery
      ? 'Could not read image'
      : phase === 'preflight'
        ? 'Review it before anything is sent'
        : phase === 'queued'
          ? 'Saved on this device'
          : `From ${Platform.OS === 'ios' ? 'iOS' : 'Android'} share sheet`;

  // Pair success body sets the merchant and amount in purple semibold ahead of
  // the plain result sentence. Multi-item saves keep the honest count sentence. This
  // is the one source for that sentence, shared with the Section 7 announcement.
  const savedCopy = describeSavedBatch(savedItems ?? []);

  return (
    <View style={[styles.screen, { backgroundColor: ts.bg.screen }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + PANEL_PADDING, backgroundColor: ts.bg.surface, borderBottomColor: ts.border.subtle },
        ]}
      >
        <ScalePressable
          onPress={handleHeaderClose}
          accessibilityRole="button"
          accessibilityLabel="Close shared receipt and return"
          hitSlop={CLOSE_HIT_SLOP}
          style={[styles.closeButton, { backgroundColor: ts.bg.elevated }]}
        >
          <X size={20} color={ts.icon.default} />
        </ScalePressable>
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
              {SUCCESS_HEADING}
            </Text>
            <Text style={[styles.recoveryBody, { color: ts.text.onSurfaceVariant }]}>
              {savedCopy.merchant ? (
                <Text style={[styles.successMerchant, { color: ts.text.primary }]}>{savedCopy.merchant}</Text>
              ) : null}
              {savedCopy.tail}
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
            <PeachButton title="View this transaction" onPress={handleViewTransaction} variant="primary" size="lg" fullWidth />
            <PeachButton title="Done" onPress={handleGoHome} variant="secondary" size="lg" fullWidth />
          </View>
        ) : phase === 'preflight' || phase === 'queued' ? (
          /* Phase 11 B2-6. The pre-flight guard: the image is on this device and nothing
             has left it. Queued is the same card with the reason processing cannot run
             and a real retry. */
          <View style={styles.section}>
            <View style={[styles.callout, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
              <View style={[styles.aiBadge, { backgroundColor: ts.bg.primary }]}>
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
              <View style={styles.calloutBody}>
                <Text style={[styles.calloutTitle, { color: ts.text.onSurface }]}>
                  {phase === 'preflight' ? 'Ready to read this receipt' : blocker ? 'Saved on this device' : 'Not processed yet'}
                </Text>
                <Text style={[styles.calloutText, { color: ts.text.onSurfaceVariant }]}>
                  {phase === 'preflight'
                    ? 'Nothing has been sent anywhere yet. Reading it uses your own AI provider key.'
                    : blocker
                      ? BLOCKER_COPY[blocker]
                      : recovery?.message ?? 'The last attempt did not finish. The image is still saved on this device.'}
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
                    {draftId ? 'Saved on this device until it is saved to your ledger' : 'Secure app copy ready for OCR'}
                  </Text>
                </View>
                <View style={[styles.autoChip, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
                  <Text style={[styles.autoChipText, { color: ts.text.primary }]}>
                    {phase === 'preflight' ? 'Not sent' : 'Saved'}
                  </Text>
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

            <View style={styles.actionStack}>
              {phase === 'preflight' ? (
                <PeachButton
                  title="Scan receipt"
                  onPress={handleScanNow}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<ScanLine size={16} color={Colors.white} />}
                />
              ) : (
                <PeachButton
                  title="Try again"
                  onPress={() => { void handleRetryQueued(); }}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<RotateCcw size={16} color={Colors.white} />}
                />
              )}
              <PeachButton
                title={phase === 'preflight' ? 'Cancel' : 'Go Home'}
                onPress={phase === 'preflight' ? leaveWithCleanup : handleGoHome}
                variant="neutral"
                size="lg"
                fullWidth
                icon={<Home size={16} color={ts.text.onSurface} />}
              />
              {phase === 'queued' ? (
                <PeachButton
                  title="Discard image"
                  onPress={leaveWithCleanup}
                  variant="outline"
                  size="lg"
                  fullWidth
                  labelColor={ts.raw.danger}
                />
              ) : null}
            </View>
          </View>
        ) : showRecovery && recovery && recoveryView ? (
          <View style={[styles.recoveryBlock, styles.errorBlock]}>
            <View style={[styles.recoveryIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <TriangleAlert size={32} color={ts.raw.danger} />
            </View>
            <Text accessibilityRole="header" style={[styles.recoveryTitle, { color: ts.text.onSurface }]}>
              {recoveryView.heading}
            </Text>
            <Text style={[styles.recoveryBody, { color: ts.text.onSurfaceVariant }]}>{recovery.message}</Text>
            {recoveryView.advice.length > 0 ? (
              <View style={[styles.fixCard, { backgroundColor: ts.bg.surface, borderColor: ts.border.card }]}>
                <Text style={[styles.fixTitle, { color: ts.text.onSurface }]}>Quick Fix Suggestions:</Text>
                {recoveryView.advice.map((line) => (
                  <View key={line} style={styles.fixRow}>
                    <View style={[styles.fixDot, { backgroundColor: ts.text.onSurfaceVariant }]} />
                    <Text style={[styles.fixText, { color: ts.text.onSurfaceVariant }]}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.actionStack}>
              {recoveryKindValue === 'missing_key' ? (
                <PeachButton
                  title="Open AI Provider Settings"
                  onPress={() => router.push('/settings/chat')}
                  variant="primary"
                  size="lg"
                  fullWidth
                />
              ) : recoveryKindValue === 'offline' ? (
                <PeachButton
                  title="Enter Manually"
                  onPress={() => router.push(RECOVERY_MANUAL_ROUTE)}
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
              {recoveryView.manualEntry ? (
                <PeachButton
                  title="Enter Manually"
                  onPress={() => router.push(RECOVERY_MANUAL_ROUTE)}
                  variant="secondary"
                  size="lg"
                  fullWidth
                />
              ) : null}
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
                  Peach received an image from your device&apos;s share sheet. Reading it uses your own AI provider key.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <AIProcessingOverlay
        visible={phase === 'processing'}
        contextLabel={PROCESSING_COPY.contextLabel}
        title={PROCESSING_COPY.title}
        description={PROCESSING_COPY.description}
        steps={pipelineSteps(pipelineStage, 'share')}
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

      {/* POLISH Section 7: Android speaks the async ingestion outcome through this
          polite live region. The node is a 1x1 clipped transparent box, so it shows
          nothing the locked pair does not show. */}
      <View accessibilityLiveRegion="polite" style={styles.announcement}>
        <Text>{outcomeAnnouncement}</Text>
      </View>
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
  // POLISH Section 7 screen-reader announcement channel. Absolutely positioned and
  // clipped, matching the sibling spending-recap, support-center and profile units, so it
  // renders nothing the locked pair does not show.
  announcement: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
