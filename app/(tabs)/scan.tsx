import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, CameraOff, Image as ImageIcon, Pencil, X, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { Colors, DarkTheme, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { geminiService } from '../../services/GeminiService';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { AIProcessingOverlay } from '../../components/capture/AIProcessingOverlay';
import { PeachButton } from '../../components/ui/PeachButton';
import { VerificationSheet } from '../../components/expense/VerificationSheet';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { AiError, getAiErrorMessage, normalizeAiError } from '../../ai/contracts';
import { resolveExpenseBatchSave, runCaptureSideEffects, normalizeCurrencyTotal, type DuplicateMatch, type CaptureCandidate } from '../../data';
import { copyReceiptImageToAppCache, deleteOwnedReceiptImage, readOwnedReceiptImageAsBase64 } from '../../utils/ownedReceiptImage';
import { ScannedReceipt } from '../../types/gemini';
import type { Expense } from '../../types/database';

// Pair values from the locked S-04 code.html. Fixed sizes are touch targets or
// decorative constants, never device widths: the viewfinder is percentage based.
const HUD_BUTTON_SIZE = 44;
const SHUTTER_SIZE = 72;
const SHUTTER_GLOW_SIZE = 84;
const SHUTTER_CORE_SIZE = 48;
const BRACKET_SIZE = 32;
const SCAN_LINE_HEIGHT = 2;
const VIEWFINDER_MAX_WIDTH = 300;
const VIEWFINDER_ASPECT = 280 / 380;
const RECOVERY_MAX_WIDTH = 320;
const ILLEGIBLE_MAX_WIDTH = 340;
const OFFLINE_TOP_OFFSET = 64;
// Mode segment visual height is compact (pair p-1 py-1); the segment earns the
// 44pt touch floor vertically through hitSlop without changing its look.
const MODE_OPTION_HIT_SLOP = { top: 10, bottom: 10 } as const;

type ScanMode = 'receipt' | 'product';
type ProcessingContext = 'receipt' | 'gallery' | 'product';

const isIllegibleCode = (code: string): boolean => code === 'illegible_image' || code === 'invalid_response';

const hasRequiredReceiptFields = (item: ScannedReceipt): boolean => (
  item.merchant.trim().length > 0 &&
  Number.isFinite(item.amount) &&
  item.amount > 0 &&
  item.currency.trim().length > 0 &&
  item.category.trim().length > 0
);

const PROCESSING_COPY: Record<ProcessingContext, { contextLabel: string; title: string; description: string }> = {
  receipt: {
    contextLabel: 'Scanning receipt...',
    title: 'Analyzing Line Items',
    description: 'Extracting merchant, date, taxes, and categorizing into your categories. Your expense stays unsaved until you confirm.',
  },
  gallery: {
    contextLabel: 'Reading gallery image...',
    title: 'Ingesting Image from Camera Roll',
    description: 'Scanning metadata and running high-res OCR. Your expense stays unsaved until you confirm.',
  },
  product: {
    contextLabel: 'Identifying product...',
    title: 'Reading Product',
    description: 'Extracting the item, price, and category. Your expense stays unsaved until you confirm.',
  },
};

function ScanLine({ trackHeight, reduceMotion }: { trackHeight: number; reduceMotion: boolean }) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || trackHeight <= 0) {
      cancelAnimation(translateY);
      translateY.value = reduceMotion ? trackHeight / 2 : 0;
      return;
    }
    // Pair scans top to bottom once per 2.8s cycle (translateY -100% to frame
    // height), then resets; not a back-and-forth ping-pong.
    translateY.value = withRepeat(
      withTiming(trackHeight, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
      -1,
    );
    return () => cancelAnimation(translateY);
  }, [trackHeight, reduceMotion, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.scanLine, animatedStyle]}>
      <LinearGradient
        colors={['transparent', Colors.primaryContainer, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function CornerBrackets() {
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={[styles.bracket, styles.bracketTopLeft]} />
      <View style={[styles.bracket, styles.bracketTopRight]} />
      <View style={[styles.bracket, styles.bracketBottomLeft]} />
      <View style={[styles.bracket, styles.bracketBottomRight]} />
      <View style={styles.gridBorder} />
      <View style={[styles.gridLine, styles.gridVertical, { left: '33.33%' }]} />
      <View style={[styles.gridLine, styles.gridVertical, { left: '66.66%' }]} />
      <View style={[styles.gridLine, styles.gridHorizontal, { top: '33.33%' }]} />
      <View style={[styles.gridLine, styles.gridHorizontal, { top: '66.66%' }]} />
    </View>
  );
}

function HudButton({ label, onPress, disabled, checked, children }: { label: string; onPress: () => void; disabled?: boolean; checked?: boolean; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true, ...(checked === undefined ? {} : { checked }) }}
      style={({ pressed }) => [styles.hudButton, pressed && styles.hudButtonPressed, disabled && styles.hudButtonDisabled]}
    >
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      {children}
    </Pressable>
  );
}

function PermissionRecovery({ onGrant, onManual, canAskAgain }: { onGrant: () => void; onManual: () => void; canAskAgain: boolean }) {
  return (
    <View style={styles.recoveryLayer}>
      <View style={styles.recoveryIcon}>
        <CameraOff size={30} color={Colors.primary} />
      </View>
      <Text accessibilityRole="header" style={styles.recoveryTitle}>Camera Access Required</Text>
      <Text style={styles.recoveryBody}>
        Allow camera access to scan receipts. Your capture stays on this device until you confirm it.
      </Text>
      <PeachButton
        title={canAskAgain ? 'Grant Camera Permission' : 'Open Settings'}
        onPress={onGrant}
        variant="primary"
        size="lg"
        fullWidth
        style={styles.recoveryAction}
      />
      <Pressable onPress={onManual} accessibilityRole="button" accessibilityLabel="Enter expense manually" hitSlop={8} style={styles.recoveryLink}>
        <Text style={styles.recoveryLinkText}>Enter Manually</Text>
      </Pressable>
    </View>
  );
}

export default function ScanScreen() {
  const cameraRef = useRef<CameraView>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const { settings, conversionRates } = useSettings();
  const { checkForNewAchievements } = useAchievements();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();

  const [isScanning, setIsScanning] = useState(false);
  const [processingContext, setProcessingContext] = useState<ProcessingContext>('receipt');
  const [illegibleVisible, setIllegibleVisible] = useState(false);
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [scanMode, setScanMode] = useState<ScanMode>('receipt');
  const [scanResult, setScanResult] = useState<ScannedReceipt[] | null>(null);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [isOffline, setIsOffline] = useState<boolean | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [pendingBatch, setPendingBatch] = useState<ScannedReceipt[] | null>(null);
  const [ownedImageUri, setOwnedImageUri] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);

  useEffect(() => {
    const checkApiKey = async () => {
      const apiKey = await databaseService.getSecret('gemini_api_key');
      if (!apiKey) showToast('Gemini API key missing. Open AI Provider Settings.', 'error');
    };
    void checkApiKey();
  }, [showToast]);

  useEffect(() => {
    let isMounted = true;
    const updateConnectivity = (state: NetInfoState) => {
      if (!isMounted) return;
      setIsOffline(state.isConnected !== true || state.isInternetReachable !== true);
    };
    const unsubscribe = NetInfo.addEventListener(updateConnectivity);
    NetInfo.fetch().then(updateConnectivity).catch(() => {
      if (isMounted) setIsOffline(true);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // A cancelled scan must stop the outbound OCR request, not just hide the
  // overlay. Abort the in-flight provider call on unmount as well.
  useEffect(() => () => {
    scanAbortRef.current?.abort();
  }, []);

  const ensureOnline = useCallback(async () => {
    try {
      const state = await NetInfo.fetch();
      const offline = state.isConnected !== true || state.isInternetReachable !== true;
      setIsOffline(offline);
      return !offline;
    } catch {
      setIsOffline(true);
      return false;
    }
  }, []);

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

  const resolveItems = useCallback(async (base64: string, context: ProcessingContext, signal: AbortSignal): Promise<ScannedReceipt[]> => {
    const rawItems = await geminiService.scanReceipt(base64, context === 'product' ? 'product' : 'receipt', { signal });
    if (!rawItems || !Array.isArray(rawItems)) throw new AiError('invalid_response', 'gemini', 'AI response did not match the receipt contract');
    return convertToUserCurrency(rawItems);
  }, [convertToUserCurrency]);

  const handleFailure = useCallback((error: unknown, logMessage: string) => {
    const normalized = normalizeAiError(error, 'gemini');
    logger.error(logMessage, normalized.code);
    if (isIllegibleCode(normalized.code)) setIllegibleVisible(true);
    else showToast(getAiErrorMessage(normalized.code, 'receipt'), 'error');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [showToast]);

  const runBatchSideEffects = useCallback(async (records: Expense[], candidates: CaptureCandidate[]) => {
    for (const [index, candidate] of candidates.entries()) {
      await runCaptureSideEffects({ status: 'saved', record: records[index], origin: { source: candidate.source, origin: 'scan', reviewed: true } }, candidate, {
        onExpenseSaved: checkForNewAchievements,
        onIncomeSaved: async () => undefined,
        scheduleNotification: (savedCandidate) => {
          if ('merchant' in savedCandidate) notificationService.scheduleExpenseNotification(savedCandidate.merchant, `${savedCandidate.currency} ${savedCandidate.amount.toFixed(2)}`);
        },
      });
    }
  }, [checkForNewAchievements]);

  const finalizeBatchSave = useCallback(async (items: ScannedReceipt[]) => {
    setIsSheetVisible(false);
    showToast(`Successfully saved ${items.length} expense${items.length > 1 ? 's' : ''}`, 'success');
    await checkForNewAchievements();
    setOwnedImageUri(null);
    returnToOrigin();
  }, [checkForNewAchievements, returnToOrigin, showToast]);

  const buildCandidates = useCallback((items: ScannedReceipt[]): CaptureCandidate[] => {
    const now = Date.now();
    return items.map(item => ({
      merchant: item.merchant,
      amount: item.amount,
      currency: item.currency,
      category: item.category,
      source: 'ocr' as const,
      origin: 'scan' as const,
      imageUri: ownedImageUri ?? undefined,
      note: item.note,
      scanned: true,
      date: now,
    }));
  }, [ownedImageUri]);

  // Save Anyway only. A clean confirm persists inside handleConfirm through the
  // same shared boundary, so calling this on a clean batch would insert twice.
  const executeSave = useCallback(async (items: ScannedReceipt[]) => {
    if (items.length === 0 || items.some(item => !hasRequiredReceiptFields(item))) {
      showToast('Review missing receipt fields before saving.', 'error');
      return;
    }
    const repository = await databaseService.getCaptureRepository();
    const candidates = buildCandidates(items);
    const resolution = await resolveExpenseBatchSave(repository, candidates, 'save_anyway');
    if (resolution.status !== 'saved') throw new Error('capture_save_failed');
    await runBatchSideEffects(resolution.records, candidates);
    await finalizeBatchSave(items);
  }, [buildCandidates, finalizeBatchSave, runBatchSideEffects, showToast]);

  const handleConfirm = useCallback(async (items: ScannedReceipt[]) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (items.length === 0) return;
      if (items.some(item => !hasRequiredReceiptFields(item))) {
        showToast('Review missing receipt fields before saving.', 'error');
        return;
      }
      const repository = await databaseService.getCaptureRepository();
      const candidates = buildCandidates(items);
      const resolutions = await resolveExpenseBatchSave(repository, candidates, 'confirm');
      if (resolutions.status === 'needs_review') {
        const firstMatch = resolutions.matches.find(match => 'match' in match)?.match;
        if (!firstMatch) return;
        setDuplicateWarning(firstMatch);
        setPendingBatch(items);
        return;
      }
      if (resolutions.status !== 'saved') return;
      // The confirm pass already persisted the batch. Run side effects on those
      // real records only; never re-enter executeSave (save_anyway) here.
      await runBatchSideEffects(resolutions.records, candidates);
      await finalizeBatchSave(items);
    } catch {
      logger.error('Failed to save scanned expense', 'save_failed');
      showToast('Failed to save expenses', 'error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [buildCandidates, finalizeBatchSave, runBatchSideEffects, showToast]);

  const runScan = useCallback(async (base64: string, context: ProcessingContext) => {
    setProcessingContext(context);
    setIsScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const controller = new AbortController();
    scanAbortRef.current = controller;
    try {
      const items = await resolveItems(base64, context, controller.signal);
      setScanResult(items);
      setIsSheetVisible(true);
    } catch (error) {
      // A user cancel owns its own cleanup in cancelProcessing; do not surface it
      // as an OCR failure.
      if (!(error instanceof AiError && error.code === 'cancelled')) {
        handleFailure(error, 'Failed to scan receipt');
        await deleteOwnedReceiptImage(ownedImageUri ?? undefined);
        setOwnedImageUri(null);
        setCameraActive(true);
      }
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
      setIsScanning(false);
    }
  }, [handleFailure, ownedImageUri, resolveItems]);

  const cancelProcessing = useCallback(async () => {
    scanAbortRef.current?.abort();
    setIsScanning(false);
    await deleteOwnedReceiptImage(ownedImageUri ?? undefined);
    setOwnedImageUri(null);
    setCameraActive(true);
  }, [ownedImageUri]);

  const handleGalleryPick = useCallback(async () => {
    if (isScanning) return;
    let copiedUri: string | undefined;
    try {
      if (!(await ensureOnline())) return;
      const apiKey = await databaseService.getSecret('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API key missing. Open AI Provider Settings.', 'error');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: false, quality: 0.5 });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      if (!asset.mimeType) throw new Error('unsupported_image_type');
      copiedUri = await copyReceiptImageToAppCache(asset.uri, asset.mimeType, asset.fileSize);
      setOwnedImageUri(copiedUri);
      await runScan(await readOwnedReceiptImageAsBase64(copiedUri), 'gallery');
    } catch (error) {
      handleFailure(error, 'Failed to scan gallery image');
      await deleteOwnedReceiptImage(copiedUri ?? ownedImageUri ?? undefined);
      setOwnedImageUri(null);
    }
  }, [ensureOnline, handleFailure, isScanning, ownedImageUri, runScan, showToast]);

  const handleCapture = useCallback(async () => {
    if (isScanning) return;
    let copiedUri: string | undefined;
    try {
      if (!(await ensureOnline())) return;
      const apiKey = await databaseService.getSecret('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API key missing. Open AI Provider Settings.', 'error');
        return;
      }
      if (!cameraRef.current) return;
      setFlash('off');
      const photo = await cameraRef.current.takePictureAsync({ base64: false, quality: 0.5 });
      setCameraActive(false);
      if (!photo?.uri) {
        setCameraActive(true);
        return;
      }
      copiedUri = await copyReceiptImageToAppCache(photo.uri, 'image/jpeg');
      setOwnedImageUri(copiedUri);
      await runScan(await readOwnedReceiptImageAsBase64(copiedUri), scanMode === 'product' ? 'product' : 'receipt');
    } catch (error) {
      handleFailure(error, 'Failed to capture or scan receipt');
      await deleteOwnedReceiptImage(copiedUri ?? ownedImageUri ?? undefined);
      setOwnedImageUri(null);
      setCameraActive(true);
    }
  }, [ensureOnline, handleFailure, isScanning, ownedImageUri, runScan, scanMode, showToast]);

  const handleRetryScan = useCallback(async () => {
    if (!ownedImageUri || isScanning) return;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    try {
      if (!(await ensureOnline())) return;
      const apiKey = await databaseService.getSecret('gemini_api_key');
      if (!apiKey) {
        showToast('Gemini API key missing. Open AI Provider Settings.', 'error');
        return;
      }
      setProcessingContext(scanMode === 'product' ? 'product' : 'receipt');
      setIsScanning(true);
      const items = await resolveItems(await readOwnedReceiptImageAsBase64(ownedImageUri), scanMode === 'product' ? 'product' : 'receipt', controller.signal);
      setScanResult(items);
    } catch (error) {
      if (!(error instanceof AiError && error.code === 'cancelled')) handleFailure(error, 'Failed to retry receipt extraction');
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
      setIsScanning(false);
    }
  }, [ensureOnline, handleFailure, isScanning, ownedImageUri, resolveItems, scanMode, showToast]);

  const resetCamera = useCallback(() => {
    setCameraActive(true);
    void deleteOwnedReceiptImage(ownedImageUri ?? undefined);
    setOwnedImageUri(null);
  }, [ownedImageUri]);

  const handleCloseSheet = useCallback(() => {
    setIsSheetVisible(false);
    setScanResult(null);
    resetCamera();
  }, [resetCamera]);

  const handleGrantPermission = useCallback(async () => {
    if (permission?.canAskAgain === false) {
      void Linking.openSettings();
      return;
    }
    const requested = await requestPermission();
    if (!requested.granted) showToast('Camera permission is required to scan receipts.', 'error');
  }, [permission?.canAskAgain, requestPermission, showToast]);

  if (permission === null || isOffline === null) {
    return <View style={styles.screen} />;
  }

  const granted = permission.granted;
  const canCapture = granted && !isOffline && !isScanning;
  const instruction = scanMode === 'product' ? 'Point at barcode or grocery item' : 'Align receipt within the frame';
  const processing = PROCESSING_COPY[processingContext];

  return (
    <View style={styles.screen}>
      {granted && cameraActive ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={flash === 'on'} />
      ) : (
        <LinearGradient colors={[Gradients.dark[0], Colors.black]} style={StyleSheet.absoluteFill} />
      )}

      {granted ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Top controls */}
          <View style={[styles.topBar, { paddingTop: insets.top + Spacing.s3 }]}>
            <HudButton label="Close receipt scanner" onPress={returnToOrigin}>
              <X size={22} color={Colors.white} />
            </HudButton>
            <View style={styles.modePill}>
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
              <Pressable
                onPress={() => { void Haptics.selectionAsync(); setScanMode('receipt'); }}
                hitSlop={MODE_OPTION_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Receipt mode"
                accessibilityState={{ selected: scanMode === 'receipt' }}
                style={[styles.modeOption, scanMode === 'receipt' && styles.modeOptionActive]}
              >
                <Text style={[styles.modeLabel, scanMode === 'receipt' && styles.modeLabelActive]}>Receipt</Text>
              </Pressable>
              <Pressable
                onPress={() => { void Haptics.selectionAsync(); setScanMode('product'); }}
                hitSlop={MODE_OPTION_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Product mode"
                accessibilityState={{ selected: scanMode === 'product' }}
                style={[styles.modeOption, scanMode === 'product' && styles.modeOptionActive]}
              >
                <Text style={[styles.modeLabel, scanMode === 'product' && styles.modeLabelActive]}>Product</Text>
              </Pressable>
            </View>
            <HudButton label={flash === 'on' ? 'Turn flash off' : 'Turn flash on'} checked={flash === 'on'} onPress={() => setFlash(current => (current === 'on' ? 'off' : 'on'))}>
              <Zap size={22} color={flash === 'on' ? Colors.warning : Colors.white} fill={flash === 'on' ? Colors.warning : 'transparent'} />
            </HudButton>
          </View>

          {/* Viewfinder */}
          <View pointerEvents="none" style={styles.viewfinderArea}>
            <View style={styles.viewfinderFrame} onLayout={(event) => setFrameHeight(event.nativeEvent.layout.height)}>
              <ScanLine trackHeight={frameHeight} reduceMotion={reduceMotion} />
              <CornerBrackets />
            </View>
            <View style={styles.alignPill}>
              <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
              <View style={styles.alignDot} />
              <Text numberOfLines={2} style={styles.alignText}>{instruction}</Text>
            </View>
          </View>

          {/* Offline banner */}
          {isOffline ? (
            <View accessibilityLiveRegion="polite" style={[styles.offlineBanner, { top: insets.top + OFFLINE_TOP_OFFSET }]}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineText}>Offline. OCR needs a connection.</Text>
              <Pressable onPress={() => router.push('/expense/manual')} accessibilityRole="button" accessibilityLabel="Enter expense manually" style={styles.offlineAction}>
                <Text style={styles.offlineActionText}>Manual Entry</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Bottom thumb-zone controls */}
          <View style={[styles.bottomRow, { paddingBottom: Math.max(insets.bottom, Spacing.s8) }]} pointerEvents="box-none">
            <HudButton label="Choose image from gallery" onPress={() => { void handleGalleryPick(); }} disabled={!canCapture}>
              <ImageIcon size={22} color={Colors.white} />
            </HudButton>
            <Pressable
              onPress={() => { void handleCapture(); }}
              disabled={!canCapture}
              accessibilityRole="button"
              accessibilityLabel="Capture receipt for OCR"
              accessibilityState={{ disabled: !canCapture, busy: isScanning }}
              style={({ pressed }) => [styles.shutterWrap, pressed && !reduceMotion && styles.shutterPressed, !canCapture && styles.shutterDisabled]}
            >
              <View style={styles.shutterGlow} />
              <LinearGradient colors={[Colors.primaryContainer, Gradients.light[0]]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.shutterRing}>
                <View style={styles.shutterInnerRing}>
                  <View style={styles.shutterCore} />
                </View>
              </LinearGradient>
            </Pressable>
            <HudButton label="Enter expense manually" onPress={() => router.push('/expense/manual')}>
              <Pencil size={20} color={Colors.white} />
            </HudButton>
          </View>
        </View>
      ) : (
        <PermissionRecovery
          onGrant={() => { void handleGrantPermission(); }}
          onManual={() => router.push('/expense/manual')}
          canAskAgain={permission.canAskAgain !== false}
        />
      )}

      {/* Illegible image recovery */}
      {illegibleVisible ? (
        <View style={styles.illegibleScrim}>
          <View style={styles.illegibleCard} accessibilityViewIsModal>
            <View style={styles.illegibleIcon}>
              <Camera size={24} color={Colors.primary} />
            </View>
            <Text accessibilityRole="header" style={styles.illegibleTitle}>Receipt Unclear</Text>
            <Text style={styles.illegibleBody}>
              Text was too blurry or lighting was too dim to reliably parse the merchant and totals.
            </Text>
            <PeachButton title="Try Again" onPress={() => setIllegibleVisible(false)} variant="primary" size="lg" fullWidth tone="dark" />
            <PeachButton
              title="Enter Manually"
              onPress={() => { setIllegibleVisible(false); router.push('/expense/manual'); }}
              variant="secondary"
              tone="dark"
              size="lg"
              fullWidth
              style={styles.illegibleSecondary}
            />
          </View>
        </View>
      ) : null}

      <AIProcessingOverlay
        visible={isScanning}
        contextLabel={processing.contextLabel}
        title={processing.title}
        description={processing.description}
        onCancel={() => { void cancelProcessing(); }}
      />

      <VerificationSheet
        isVisible={isSheetVisible}
        data={scanResult}
        origin="scan"
        imageUri={ownedImageUri}
        onRetry={ownedImageUri ? () => { void handleRetryScan(); } : undefined}
        onConfirm={handleConfirm}
        onCancel={handleCloseSheet}
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
          onDiscard={() => {
            setDuplicateWarning(null);
            setPendingBatch(null);
            setIsSheetVisible(false);
            setScanResult(null);
            resetCamera();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DarkTheme.background },
  viewfinderArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.s6 },
  viewfinderFrame: {
    width: '72%',
    maxWidth: VIEWFINDER_MAX_WIDTH,
    aspectRatio: VIEWFINDER_ASPECT,
    position: 'relative',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SCAN_LINE_HEIGHT,
    overflow: 'hidden',
  },
  bracket: { position: 'absolute', width: BRACKET_SIZE, height: BRACKET_SIZE, borderColor: Colors.primaryContainer },
  bracketTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: Radii.sm },
  bracketTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radii.sm },
  bracketBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: Radii.sm },
  bracketBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: Radii.sm },
  gridLine: { position: 'absolute', backgroundColor: `${Colors.primaryContainer}26` },
  // Pair draws the 3x3 grid as a bordered box (purple-300/30 at 15 percent).
  gridBorder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: `${Colors.primaryContainer}26` },
  gridVertical: { top: 0, bottom: 0, width: 1 },
  gridHorizontal: { left: 0, right: 0, height: 1 },
  alignPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.s2,
    marginTop: Spacing.s4,
    maxWidth: '90%',
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  alignDot: { width: 8, height: 8, borderRadius: Radii.full, backgroundColor: Colors.primaryContainer },
  alignText: { ...Typography.labelMd, color: 'rgba(255,255,255,0.9)', flexShrink: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.s5 },
  hudButton: {
    width: HUD_BUTTON_SIZE,
    height: HUD_BUTTON_SIZE,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hudButtonPressed: { backgroundColor: 'rgba(0,0,0,0.65)' },
  hudButtonDisabled: { opacity: 0.45 },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  modeOption: { paddingHorizontal: Spacing.s3 + 2, paddingVertical: 5, borderRadius: Radii.full },
  modeOptionActive: { backgroundColor: Colors.primaryContainer },
  modeLabel: { ...Typography.captionBold, color: 'rgba(255,255,255,0.7)' },
  modeLabelActive: { color: Colors.white },
  offlineBanner: {
    position: 'absolute',
    width: '92%',
    alignSelf: 'center',
    maxWidth: 600,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.primary + '66',
    // Solid surface so the notice stays legible over an arbitrary camera frame.
    backgroundColor: DarkTheme.surface,
  },
  offlineDot: { width: 10, height: 10, borderRadius: Radii.full, backgroundColor: Colors.warning },
  offlineText: { ...Typography.micro, color: Colors.white, flex: 1, minWidth: 0 },
  offlineAction: { paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.sm, backgroundColor: Colors.primaryContainer, minHeight: HUD_BUTTON_SIZE, justifyContent: 'center' },
  offlineActionText: { ...Typography.micro, color: Colors.white, fontFamily: 'Manrope_700Bold' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.s7 },
  shutterWrap: { width: SHUTTER_GLOW_SIZE, height: SHUTTER_GLOW_SIZE, alignItems: 'center', justifyContent: 'center' },
  shutterPressed: { transform: [{ scale: 0.95 }] },
  shutterDisabled: { opacity: 0.5 },
  shutterGlow: { position: 'absolute', width: SHUTTER_GLOW_SIZE, height: SHUTTER_GLOW_SIZE, borderRadius: Radii.full, backgroundColor: Colors.primaryContainer, opacity: 0.35 },
  shutterRing: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: Radii.full, padding: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInnerRing: { flex: 1, width: '100%', borderRadius: Radii.full, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  shutterCore: { width: SHUTTER_CORE_SIZE, height: SHUTTER_CORE_SIZE, borderRadius: Radii.full, backgroundColor: Colors.white },
  recoveryLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.s8 },
  recoveryIcon: {
    width: 64,
    height: 64,
    borderRadius: Radii.xl,
    backgroundColor: Colors.primary + '1A',
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s4,
  },
  recoveryTitle: { ...Typography.headlineMd, color: Colors.white, textAlign: 'center', marginBottom: Spacing.s2 },
  recoveryBody: { ...Typography.labelMd, color: 'rgba(255,255,255,0.75)', textAlign: 'center', maxWidth: RECOVERY_MAX_WIDTH, alignSelf: 'center', marginBottom: Spacing.s6 },
  recoveryAction: { maxWidth: RECOVERY_MAX_WIDTH, alignSelf: 'center' },
  recoveryLink: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.s3 },
  recoveryLinkText: { ...Typography.labelMd, color: Colors.primary, fontFamily: 'Manrope_700Bold', textDecorationLine: 'underline' },
  illegibleScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: Spacing.s6, zIndex: 30 },
  illegibleCard: {
    width: '100%',
    maxWidth: ILLEGIBLE_MAX_WIDTH,
    alignSelf: 'center',
    alignItems: 'center',
    padding: Spacing.s6,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.primary + '66',
    backgroundColor: Gradients.light[0],
  },
  illegibleIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    // Pair icon disc is a solid purple-900/60; nearest dark-purple container token.
    backgroundColor: DarkTheme.purple100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s3,
  },
  illegibleTitle: { ...Typography.headlineMd, color: Colors.white, marginBottom: Spacing.s1 },
  illegibleBody: { ...Typography.labelMd, color: 'rgba(255,255,255,0.75)', textAlign: 'center', alignSelf: 'center', maxWidth: 260, marginBottom: Spacing.s5 },
  illegibleSecondary: { marginTop: Spacing.s2 },
});
