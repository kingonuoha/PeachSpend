import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Check, Pencil, X } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { RootAutoCaptureHost } from '../../data/AutoCaptureHost';
import type { AutoCaptureEvent, AutoCaptureHostState, CaptureCandidate, CaptureRepository, DuplicateMatch } from '../../data/contracts';
import { databaseService } from '../../services/DatabaseService';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import { createNotificationParser, createParsedAutoCaptureSource, parseNotificationCandidate } from '../../data/AutoCaptureSource';
import { DuplicateWarningModal } from '../expense/DuplicateWarningModal';
import { CategoryPickerSheet, type CaptureCategory } from '../capture/CategoryPickerSheet';
import { CategoryGlyph } from '../capture/CategoryGlyph';
import { PeachButton } from './PeachButton';
import { useSettings } from './SettingsProvider';
import { useAchievements } from './AchievementProvider';
import { notificationService } from '../../services/NotificationService';
import { resolveExpenseSave, runCaptureSideEffects } from '../../data/CaptureService';
import { CategoryTints, Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency, resolveCurrency } from '../../utils/currency';
import { formatRelativeDateWithTime } from '../../utils/dateFormat';

// Pair max-h-[85%] and a fixed 640 width ceiling for tablet. Both are upper
// bounds, never a device width or height.
const SHEET_MAX_WIDTH = 640;
const SHEET_MAX_HEIGHT = 760;
const SHEET_HEIGHT_RATIO = 0.85;

type SheetView = 'summary' | 'edit';

function tintFor(category: string): { light: readonly [string, string]; dark: readonly [string, string] } {
  const key = category.trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CategoryTints, key);
  return known ? CategoryTints[key as keyof typeof CategoryTints] : CategoryTints.other;
}

export default function AutoCaptureConfirmHost() {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const hostRef = useRef<RootAutoCaptureHost | null>(null);
  const repositoryRef = useRef<CaptureRepository | null>(null);
  const [state, setState] = useState<AutoCaptureHostState | null>(null);
  const [event, setEvent] = useState<AutoCaptureEvent | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [view, setView] = useState<SheetView>('summary');
  const [confirming, setConfirming] = useState(false);
  const [rememberRule, setRememberRule] = useState(false);
  const [ruleLearned, setRuleLearned] = useState(false);
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<{ merchant: string; amount: string; categoryId: string }>({ merchant: '', amount: '0', categoryId: '' });
  const { settings } = useSettings();
  const { checkForNewAchievements } = useAchievements();
  const adapter = useMemo(() => createNativeAutoCaptureAdapter(), []);

  useEffect(() => {
    let unsubscribe = () => {};
    let disposed = false;
    let refreshGeneration = 0;
    const refreshLifecycle = () => {
      const generation = ++refreshGeneration;
      void Promise.all([adapter.getPermissionState(), adapter.getSupportedSources()]).then(([permission, sources]) => {
        if (disposed || generation !== refreshGeneration) return;
        const host = hostRef.current;
        if (!host) return;
        host.setCapability(adapter.capability, sources);
        const source = createParsedAutoCaptureSource(adapter, createNotificationParser(parseNotificationCandidate), sources);
        host.syncLifecycle(settings.auto_capture_enabled === 'true', permission.status, source, false);
      });
    };
    void databaseService.getCaptureRepository().then(repository => {
      if (disposed) return;
      const host = new RootAutoCaptureHost(repository);
      repositoryRef.current = repository;
      hostRef.current = host;
      const hostUnsubscribe = host.subscribe(setState);
      unsubscribe = () => { hostUnsubscribe(); host.stop(); };
      setHostReady(true);
      refreshLifecycle();
    });
    const appState = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' || !hostRef.current) return;
      refreshLifecycle();
    });
    const previousUnsubscribe = unsubscribe;
    unsubscribe = () => { appState.remove(); previousUnsubscribe(); };
    return () => { disposed = true; unsubscribe(); };
  }, [adapter, settings.auto_capture_enabled]);

  // Claim the next queued detection whenever the host has none rendered. This
  // covers the first event and each release, so the FIFO queue drains in order.
  useEffect(() => {
    if (!hostReady || event) return;
    const next = hostRef.current?.claimOverlay() ?? null;
    if (next) setEvent(next);
  }, [hostReady, event, state?.pendingCount]);

  useEffect(() => {
    hostRef.current?.setEnabled(settings.auto_capture_enabled === 'true');
  }, [settings.auto_capture_enabled]);

  // Load the shared category list once the sheet has a real candidate.
  useEffect(() => {
    if (!event) return;
    void databaseService.getCategories().then(setCategories).catch(() => setCategories([]));
  }, [event]);

  // Reset per-detection UI state on the event edge during render, mirroring the
  // shared CategoryPickerSheet reset pattern, so no synchronous setState runs in
  // an effect body. The async remembered-category lookup still runs in an effect.
  const [seededEventId, setSeededEventId] = useState<string | null>(null);
  if (event && event.id !== seededEventId) {
    setSeededEventId(event.id);
    setDraft({ merchant: event.candidate.merchant, amount: String(event.candidate.amount), categoryId: event.candidate.category });
    setRememberRule(false);
    setRuleLearned(false);
    setView('summary');
    setSaveError(false);
    setConfirming(false);
    setPickerOpen(false);
  }

  // Pull any per-merchant correction already stored for FR-SHNEW.4 and prefer it
  // over the parser guess. This is a real read; no correction means no change.
  useEffect(() => {
    if (!event) return;
    let active = true;
    void repositoryRef.current?.getRememberedCategory(event.candidate.merchant).then(stored => {
      if (!active || !stored) return;
      setDraft(prev => ({ ...prev, categoryId: stored }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [event]);

  // Pure overlay release, used after a successful save. It never writes an
  // outcome because the save boundary already recorded the confirmed event.
  const dismiss = useCallback(() => {
    void Haptics.selectionAsync();
    const host = hostRef.current;
    host?.releaseOverlay();
    setEvent(null);
    setDuplicate(null);
    setSaveError(false);
    setView('summary');
    setConfirming(false);
    setPickerOpen(false);
  }, []);

  // User-initiated discard routes through the shared save/outcome boundary so
  // the audit log records a `discarded` event (FR-22.3). A failed write never
  // blocks the release; the overlay still closes.
  const discard = useCallback(() => {
    const host = hostRef.current;
    const repository = repositoryRef.current;
    if (event && repository && host) {
      const candidate: CaptureCandidate = { ...event.candidate, category: draft.categoryId || event.candidate.category };
      void resolveExpenseSave(repository, candidate, 'discard').catch(() => undefined);
    }
    dismiss();
  }, [event, draft.categoryId, dismiss]);

  const confirm = useCallback(async (decision: 'confirm' | 'save_anyway' = 'confirm', overrideCategory?: string) => {
    const host = hostRef.current;
    const repository = repositoryRef.current;
    if (!event || !repository || !host) return;
    if (decision === 'confirm') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setConfirming(true);
      setSaveError(false);
    }
    const candidate: CaptureCandidate = { ...event.candidate, category: overrideCategory ?? (draft.categoryId || event.candidate.category) };
    try {
      const resolution = await resolveExpenseSave(repository, candidate, decision);
      if (resolution.status === 'duplicate') {
        setDuplicate(resolution.duplicate);
        setConfirming(false);
        return;
      }
      if (resolution.status !== 'saved') {
        setConfirming(false);
        return;
      }
      await runCaptureSideEffects(resolution, candidate, {
        onExpenseSaved: checkForNewAchievements,
        onIncomeSaved: async () => undefined,
        scheduleNotification: saved => {
          if ('merchant' in saved) notificationService.scheduleExpenseNotification(saved.merchant, formatCurrency(saved.amount, saved.currency));
        },
      });
      // Persist a corrected category per merchant only when the user asked to
      // remember it. The write is fire-and-forget; a failure never blocks the save.
      if (rememberRule && candidate.category !== event.candidate.category) {
        await repository.rememberCategory(candidate.merchant, candidate.category, 'auto_capture').catch(() => undefined);
        setRuleLearned(true);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dismiss();
    } catch {
      setConfirming(false);
      setSaveError(true);
    }
  }, [event, draft.categoryId, rememberRule, checkForNewAchievements, dismiss]);

  const openEdit = () => {
    if (!event) return;
    void Haptics.selectionAsync();
    setDraft(prev => ({ ...prev, merchant: event.candidate.merchant, amount: String(event.candidate.amount) }));
    setView('edit');
  };

  const closeEdit = () => {
    void Haptics.selectionAsync();
    setView('summary');
  };

  const openPicker = () => {
    void Haptics.selectionAsync();
    setPickerOpen(true);
  };

  // Honest unsupported path: no claimed event, or the host cannot surface one.
  // Nothing renders, so no granted or success state is ever faked.
  if (!event || !state?.overlayActive) return null;

  const candidate = event.candidate;
  const amountValue = parseFloat(draft.amount);
  const editValid = draft.merchant.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;
  const categoryTitle = categories.find(category => category.id === draft.categoryId)?.title ?? candidate.category;
  const categoryTint = tintFor(draft.categoryId);
  const resolvedTint = ts.isDark ? categoryTint.dark : categoryTint.light;
  const amountText = formatCurrency((view === 'edit' ? amountValue : candidate.amount), candidate.currency);
  const currencyCode = resolveCurrency(candidate.currency);
  const pending = state.pendingCount;
  const busy = confirming;

  const sheetMaxHeight = Math.min(SHEET_MAX_HEIGHT, windowHeight * SHEET_HEIGHT_RATIO);
  const sheetMaxWidth = Math.min(windowWidth, SHEET_MAX_WIDTH);

  return (
    <>
      <Modal
        visible={!duplicate}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        statusBarTranslucent
        onRequestClose={discard}
      >
        <View style={[styles.overlay, { backgroundColor: ts.bg.overlay }]} accessibilityViewIsModal>
          <Pressable
            style={styles.scrim}
            accessibilityRole="button"
            accessibilityLabel="Dismiss detected transaction"
            onPress={discard}
          />
          <View
            accessibilityLabel="Auto-capture confirmation"
            style={[
              styles.sheet,
              {
                width: '100%',
                maxWidth: sheetMaxWidth,
                maxHeight: sheetMaxHeight,
                backgroundColor: ts.raw.surface,
                borderColor: ts.border.primary20,
                paddingBottom: Math.max(Spacing.s5, insets.bottom),
              },
            ]}
          >
            <View style={styles.handleTrack}>
              <View style={[styles.handle, { backgroundColor: ts.border.card }]} />
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={[styles.bodyContent, { paddingHorizontal: Spacing.s5 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {pending > 1 ? (
                <View
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`${pending} auto-captures pending`}
                  style={[styles.queueBanner, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}
                >
                  <View style={styles.queueLeft}>
                    <View style={[styles.queueDot, { backgroundColor: ts.raw.primary }]} />
                    <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_600SemiBold' }]}>
                      {`1 of ${pending} pending auto-captures`}
                    </Text>
                  </View>
                  <Text style={[Typography.micro, { color: ts.text.primary }]}>Queued FIFO</Text>
                </View>
              ) : null}

              <View style={styles.topRow}>
                <View style={[styles.sourceBadge, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
                  <View style={[styles.sourceDot, { backgroundColor: ts.raw.primary }]} />
                  <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_600SemiBold', flexShrink: 1, textTransform: 'uppercase' }]}>
                    {`${candidate.source === 'auto_capture' ? 'Notification' : candidate.source} • On-device OCR`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => { Keyboard.dismiss(); discard(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss detected transaction"
                  hitSlop={8}
                  style={styles.dismiss}
                >
                  <View style={[styles.dismissVisual, { backgroundColor: ts.bg.elevated }]}>
                    <X size={16} color={ts.icon.muted} />
                  </View>
                </Pressable>
              </View>

              <View style={styles.headerBlock}>
                <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]}>Detected Transaction</Text>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Zero-Guilt preview • Nothing saved to ledger yet</Text>
              </View>

              <View style={[styles.amountCard, { backgroundColor: ts.bg.low, borderColor: ts.border.card }]}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6 }]}>Amount Inferred</Text>
                  <View style={styles.amountRow}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.displayMd, { color: ts.text.onSurface, flexShrink: 1 }]}>{amountText}</Text>
                    <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', flexShrink: 0 }]}>{currencyCode}</Text>
                  </View>
                </View>
              </View>

              {view === 'summary' ? (
                <>
                  <View style={[styles.card, { backgroundColor: ts.bg.lowest, borderColor: ts.border.card }]}>
                    <View style={styles.cardLeft}>
                      <View style={[styles.merchantIcon, { backgroundColor: resolvedTint[0] }]}>
                        <CategoryGlyph iconName={categories.find(c => c.id === candidate.category)?.icon_name} size={18} color={resolvedTint[1]} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>{candidate.merchant}</Text>
                        <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{formatRelativeDateWithTime(candidate.date)}</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={openEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Edit detected transaction"
                      hitSlop={8}
                      style={styles.editTarget}
                    >
                      <Text style={[Typography.labelMd, { color: ts.text.primary, fontFamily: 'Manrope_600SemiBold' }]}>Edit</Text>
                    </Pressable>
                  </View>

                  <View style={[styles.card, { backgroundColor: ts.bg.lowest, borderColor: ts.border.card }]}>
                    <View style={styles.cardLeft}>
                      <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Category:</Text>
                      <View style={[styles.categoryBadge, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
                        <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.primary, flexShrink: 1 }]}>{categoryTitle}</Text>
                      </View>
                    </View>
                    <Text style={[Typography.micro, { color: ts.text.primary, flexShrink: 0 }]}>Auto-inferred</Text>
                  </View>

                  {ruleLearned ? (
                    <View style={[styles.ruleBanner, { backgroundColor: ts.raw.successContainer, borderColor: ts.raw.successBorder }]}>
                      <Text style={[Typography.micro, { color: ts.raw.successText, fontFamily: 'Manrope_700Bold' }]}>Rule Auto-Learned</Text>
                      <Text style={[Typography.micro, { color: ts.raw.successText, marginTop: 2 }]}>
                        {`Future ${candidate.merchant} auto-captures will use this category without asking.`}
                      </Text>
                    </View>
                  ) : null}

                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center', fontStyle: 'italic' }]}>
                    Parsed strictly on-device via the local notification listener. No merchant tracking or receipt images uploaded.
                  </Text>

                  <View style={styles.actions}>
                    <PeachButton
                      title={confirming ? 'Verifying Ledger & Saving...' : `Confirm & Save (${amountText})`}
                      onPress={() => { void confirm(); }}
                      variant="primary"
                      size="lg"
                      radius={12}
                      fullWidth
                      isLoading={confirming}
                      disabled={busy}
                    />
                    <View style={styles.secondaryRow}>
                      <View style={styles.half}>
                        <PeachButton title="Edit Details" onPress={openEdit} variant="secondary" size="sm" radius={12} fullWidth disabled={busy} icon={<Pencil size={14} color={ts.text.primary} />} />
                      </View>
                      <View style={styles.half}>
                        <PeachButton title="Discard Safe" onPress={discard} variant="neutral" size="sm" radius={12} fullWidth disabled={busy} />
                      </View>
                    </View>
                  </View>

                  {saveError ? (
                    <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}>
                      <Text style={[Typography.labelMd, { color: ts.text.error }]}>
                        Transaction could not be saved. Nothing was written. Try again, or discard.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <View style={[styles.editHeader, { borderBottomColor: ts.border.card }]}>
                    <Text style={[Typography.captionBold, { color: ts.text.onSurface }]}>Refine Inferred Fields</Text>
                    <Text style={[Typography.micro, { color: ts.text.primary }]}>Auto-saves memory</Text>
                  </View>

                  <View>
                    <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', marginBottom: Spacing.s1 }]}>Merchant Name</Text>
                    <TextInput
                      value={draft.merchant}
                      onChangeText={value => setDraft(prev => ({ ...prev, merchant: value }))}
                      placeholder="Merchant"
                      placeholderTextColor={ts.text.onSurfaceVariant}
                      selectionColor={ts.raw.primary}
                      accessibilityLabel="Merchant name"
                      style={[styles.input, { backgroundColor: ts.bg.screen, borderColor: ts.border.card, color: ts.text.onSurface }]}
                    />
                  </View>

                  <View style={styles.editGrid}>
                    <View style={styles.editColumn}>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', marginBottom: Spacing.s1 }]}>Amount</Text>
                      <TextInput
                        value={draft.amount}
                        onChangeText={value => setDraft(prev => ({ ...prev, amount: value }))}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={ts.text.onSurfaceVariant}
                        selectionColor={ts.raw.primary}
                        accessibilityLabel="Amount"
                        style={[styles.input, styles.amountInput, { backgroundColor: ts.bg.screen, borderColor: ts.border.card, color: ts.text.onSurface }]}
                      />
                    </View>
                    <View style={styles.editColumn}>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', marginBottom: Spacing.s1 }]}>Category</Text>
                      <Pressable
                        onPress={openPicker}
                        accessibilityRole="button"
                        accessibilityLabel="Choose category"
                        style={[styles.input, styles.categoryTrigger, { backgroundColor: ts.bg.screen, borderColor: ts.border.card }]}
                      >
                        <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>{categoryTitle}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => { void Haptics.selectionAsync(); setRememberRule(prev => !prev); }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rememberRule }}
                    accessibilityLabel={`Remember this category rule for future ${candidate.merchant} auto-captures`}
                    style={[styles.rememberBox, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { backgroundColor: rememberRule ? ts.raw.primary : ts.bg.surface, borderColor: rememberRule ? ts.raw.primary : ts.border.card },
                      ]}
                    >
                      {rememberRule ? <Check size={14} color={ts.text.white} strokeWidth={3} /> : null}
                    </View>
                    <Text style={[Typography.micro, { color: ts.text.onSurface, flex: 1 }]}>
                      {`Remember this category rule for future ${candidate.merchant} auto-captures.`}
                    </Text>
                  </Pressable>

                  <View style={styles.editActions}>
                    <View style={styles.half}>
                      <PeachButton
                        title="Save Changes & Confirm"
                        onPress={() => { void confirm('confirm'); }}
                        variant="primary"
                        size="md"
                        radius={12}
                        fullWidth
                        isLoading={confirming}
                        disabled={busy || !editValid}
                      />
                    </View>
                    <View style={styles.half}>
                      <PeachButton title="Back to Summary" onPress={closeEdit} variant="neutral" size="md" radius={12} fullWidth disabled={busy} />
                    </View>
                  </View>

                  {saveError ? (
                    <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}>
                      <Text style={[Typography.labelMd, { color: ts.text.error }]}>
                        Transaction could not be saved. Nothing was written. Try again, or discard.
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <CategoryPickerSheet
        visible={pickerOpen}
        categories={categories}
        selectedId={draft.categoryId}
        flowType="expense"
        originLabel={draft.merchant.trim() || candidate.merchant}
        originAmount={Number.isFinite(amountValue) && amountValue > 0 ? formatCurrency(amountValue, candidate.currency) : undefined}
        onSelect={category => { setDraft(prev => ({ ...prev, categoryId: category.id })); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />

      {duplicate ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicate}
          incoming={{
            merchant: draft.merchant.trim() || candidate.merchant,
            amount: Number.isFinite(amountValue) && amountValue > 0 ? amountValue : candidate.amount,
            currency: candidate.currency,
            category: categoryTitle,
            type: 'expense',
            date: candidate.date,
          }}
          onSaveAnyway={() => { setDuplicate(null); void confirm('save_anyway', draft.categoryId); }}
          onDiscard={() => { setDuplicate(null); dismiss(); }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: {
    alignSelf: 'center',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  handleTrack: { alignItems: 'center', paddingTop: Spacing.s3, paddingBottom: Spacing.s2 },
  handle: { width: 40, height: 4, borderRadius: Radii.full },
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.s3, paddingBottom: Spacing.s5 },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  queueLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 },
  queueDot: { width: 8, height: 8, borderRadius: Radii.full },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3 },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  sourceDot: { width: 6, height: 6, borderRadius: Radii.full, flexShrink: 0 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dismissVisual: { width: 28, height: 28, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  headerBlock: { paddingTop: Spacing.s1 },
  amountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.s1, marginTop: Spacing.s1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flex: 1, minWidth: 0 },
  merchantIcon: { width: 36, height: 36, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  editTarget: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  categoryBadge: { paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.sm, borderWidth: 1, flexShrink: 1, minWidth: 0 },
  ruleBanner: { padding: Spacing.s3, borderRadius: Radii.sm, borderWidth: 1, gap: 2 },
  actions: { paddingTop: Spacing.s2, gap: Spacing.s2 },
  secondaryRow: { flexDirection: 'row', gap: Spacing.s2 },
  half: { flex: 1 },
  errorBox: { padding: Spacing.s3, borderRadius: Radii.md, borderWidth: 1 },
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: Spacing.s2, borderBottomWidth: 1 },
  input: { minHeight: 44, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s2, borderRadius: Radii.sm, borderWidth: 1, ...Typography.labelMd },
  amountInput: { fontFamily: 'Manrope_600SemiBold' },
  categoryTrigger: { justifyContent: 'center' },
  editGrid: { flexDirection: 'row', gap: Spacing.s2 },
  editColumn: { flex: 1, minWidth: 0 },
  rememberBox: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2, padding: Spacing.s3, borderRadius: Radii.sm, borderWidth: 1 },
  checkbox: { width: 22, height: 22, borderRadius: Radii.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  editActions: { flexDirection: 'row', gap: Spacing.s2, paddingTop: Spacing.s2 },
});
