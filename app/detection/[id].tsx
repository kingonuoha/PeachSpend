import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Check, Pencil } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { databaseService } from '../../services/DatabaseService';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import type { CaptureCandidate, DuplicateMatch, IncomeCandidate } from '../../data/contracts';
import type { DetectionDraft } from '../../data/DetectionDrafts';
import { incomeSourceNameOf, isIncomeDraft, toIncomeCandidate } from '../../data/DetectionDrafts';
import { resolveExpenseSave, resolveIncomeSave, runCaptureSideEffects } from '../../data/CaptureService';
import { buildIncomeSaveCandidate } from '../../components/ui/autoCaptureConfirmIncome';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { CategoryPickerSheet, type CaptureCategory } from '../../components/capture/CategoryPickerSheet';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { PeachButton } from '../../components/ui/PeachButton';
import { useToast } from '../../components/ui/ToastProvider';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { notificationService } from '../../services/NotificationService';
import { CategoryTints, Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency } from '../../utils/currency';
import { formatRelativeDateWithTime } from '../../utils/dateFormat';

// Phase 14 M2 queued draft sheet. The single destination for the detection
// deep link contract (app://detection/<id>, optional ?view=edit): the device
// alert content tap, the Edit action, and (from M4) the inbox row tap all land
// here. Cold start keeps the native splash, then expo-router delivers the link
// straight to this route with no intermediate screen. The biometric gate wraps
// the whole tree above this route, so the sheet stays behind the prompt
// exactly like a manual open.
//
// The UI mirrors the live auto-capture confirm sheet section for section
// (summary, edit with prefilled fields, duplicate, save error) but binds to a
// persisted draft instead of a live host event, so a receiver action and this
// sheet can never double apply: every terminal move resolves the draft through
// the D1 store, and an already resolved draft renders the handled state, never
// a second save.

type SheetView = 'summary' | 'edit';
type LoadState = 'loading' | 'failed' | 'missing' | 'ready';

const SHEET_MAX_WIDTH = 640;

function tintFor(category: string): { light: readonly [string, string]; dark: readonly [string, string] } {
  const key = category.trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CategoryTints, key);
  return known ? CategoryTints[key as keyof typeof CategoryTints] : CategoryTints.other;
}

export default function DetectionDraftSheet() {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showToast } = useToast();
  const { checkForNewAchievements } = useAchievements();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string; view?: string }>();
  const draftId = typeof params.id === 'string' ? params.id : '';

  const [loadState, setLoadState] = useState<LoadState>(draftId ? 'loading' : 'missing');
  const [draft, setDraft] = useState<DetectionDraft | null>(null);
  const [view, setView] = useState<SheetView>(params.view === 'edit' ? 'edit' : 'summary');
  const [fields, setFields] = useState({ merchant: '', amount: '', categoryId: '' });
  const [rememberRule, setRememberRule] = useState(false);
  const [ruleLearned, setRuleLearned] = useState(false);
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    // A missing id reads as missing from the initial state above, so this
    // effect only resolves a real id and never sets state synchronously.
    if (!draftId) return;
    void databaseService.getDetectionDraftStore().then(async store => {
      const found = await store.getDetectionDraft(draftId);
      if (!active) return;
      if (!found || found.status !== 'pending') {
        setDraft(found);
        setLoadState('missing');
        return;
      }
      setDraft(found);
      // The merchant column mirrors the sender for income drafts (D2), so
      // this prefill serves both modes with no branch.
      setFields({ merchant: found.merchant, amount: String(found.amount), categoryId: found.category });
      setLoadState('ready');
    }).catch(() => {
      if (active) setLoadState('failed');
    });
    return () => { active = false; };
  }, [draftId]);

  // Prefer a stored per-merchant correction over the parser guess, exactly like
  // the live sheet: a real read, no correction means no change.
  useEffect(() => {
    if (!draft || loadState !== 'ready') return;
    let active = true;
    void databaseService.getCaptureRepository().then(async repository => {
      const stored = await repository.getRememberedCategory(draft.merchant).catch(() => null);
      if (!active || !stored) return;
      setFields(prev => ({ ...prev, categoryId: stored }));
      setRuleLearned(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [draft, loadState]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    void databaseService.getCategories().then(setCategories).catch(() => setCategories([]));
  }, [loadState]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  const buildCandidate = useCallback((base: DetectionDraft, overrideCategory?: string): CaptureCandidate => {
    const parsedAmount = parseFloat(fields.amount);
    const editedValid = fields.merchant.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;
    return {
      merchant: view === 'edit' ? (fields.merchant.trim() || base.merchant) : base.merchant,
      amount: view === 'edit' && editedValid ? parsedAmount : base.amount,
      currency: base.currency,
      category: overrideCategory ?? (fields.categoryId || base.category),
      date: base.detectedAt,
      note: base.note ?? undefined,
      source: 'auto_capture',
      origin: 'auto_capture',
    };
  }, [fields, view]);

  // Phase 16 M4 income derivation (D2 contract, FR-11.3). The persisted
  // income draft rebuilds the pure D1 income candidate, then the shared M3
  // edit merge applies, so summary and edit views share one derivation and
  // no second income implementation exists. Expense builds above unchanged.
  const buildIncomeCandidate = useCallback((base: DetectionDraft, overrideCategory?: string): IncomeCandidate => {
    return buildIncomeSaveCandidate(toIncomeCandidate(base), fields, view, overrideCategory);
  }, [fields, view]);

  const finishTerminal = useCallback(async (status: 'confirmed' | 'discarded') => {
    const store = await databaseService.getDetectionDraftStore();
    await store.resolveDetectionDraft(draftId, status);
    await createNativeAutoCaptureAdapter().cancelDetectionAlert?.(draftId).catch(() => undefined);
    goBack();
  }, [draftId, goBack]);

  const confirm = useCallback(async (decision: 'confirm' | 'save_anyway' = 'confirm', overrideCategory?: string) => {
    if (!draft) return;
    // Phase 16 M4 income path (D2 contract, FR-11.3): an income draft
    // confirms through the shared saveIncome boundary with duplicate check,
    // streak only achievement, and shared notification scheduling. Nothing
    // persists before this tap, same as expense. Expense below unchanged.
    if (isIncomeDraft(draft)) {
      if (decision === 'confirm') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setConfirming(true);
        setSaveError(false);
      }
      const incomeCandidate = buildIncomeCandidate(draft, overrideCategory);
      try {
        const repository = await databaseService.getCaptureRepository();
        const resolution = await resolveIncomeSave(repository, incomeCandidate, decision);
        if (resolution.status === 'duplicate') {
          setDuplicate(resolution.duplicate);
          setConfirming(false);
          return;
        }
        if (resolution.status !== 'saved') {
          setConfirming(false);
          return;
        }
        await runCaptureSideEffects(resolution, incomeCandidate, {
          onExpenseSaved: async () => undefined,
          // FR-11.3: income uses the income hook only, never the
          // expense-only spend badge path.
          onIncomeSaved: checkForNewAchievements,
          scheduleNotification: saved => {
            if ('sourceName' in saved) notificationService.scheduleExpenseNotification(saved.sourceName, formatCurrency(saved.amount, saved.currency));
          },
        });
        if (rememberRule && incomeCandidate.category !== draft.category) {
          await repository.rememberCategory(incomeCandidate.sourceName, incomeCandidate.category, 'auto_capture').catch(() => undefined);
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await finishTerminal('confirmed');
      } catch {
        setConfirming(false);
        setSaveError(true);
      }
      return;
    }
    if (decision === 'confirm') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setConfirming(true);
      setSaveError(false);
    }
    const candidate = buildCandidate(draft, overrideCategory);
    try {
      const repository = await databaseService.getCaptureRepository();
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
      if (rememberRule && candidate.category !== draft.category) {
        await repository.rememberCategory(candidate.merchant, candidate.category, 'auto_capture').catch(() => undefined);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await finishTerminal('confirmed');
    } catch {
      setConfirming(false);
      setSaveError(true);
    }
  }, [draft, buildCandidate, buildIncomeCandidate, checkForNewAchievements, rememberRule, finishTerminal]);

  const discard = useCallback(async () => {
    if (!draft) return;
    // M4: income discards audit through the income boundary, so the audit
    // names the source, mirroring the M3 overlay. Expense below unchanged.
    if (isIncomeDraft(draft)) {
      const incomeCandidate = buildIncomeCandidate(draft);
      try {
        const repository = await databaseService.getCaptureRepository();
        await resolveIncomeSave(repository, incomeCandidate, 'discard');
      } catch {
        // A failed audit write never blocks the release; the draft still
        // resolves below so the user is never stuck on a dead ping.
      }
      try {
        await finishTerminal('discarded');
      } catch {
        showToast('Could not discard that detection. Please try again.', 'error');
      }
      return;
    }
    const candidate = buildCandidate(draft);
    try {
      const repository = await databaseService.getCaptureRepository();
      await resolveExpenseSave(repository, candidate, 'discard');
    } catch {
      // A failed audit write never blocks the release; the draft still
      // resolves below so the user is never stuck on a dead ping.
    }
    try {
      await finishTerminal('discarded');
    } catch {
      showToast('Could not discard that detection. Please try again.', 'error');
    }
  }, [draft, buildCandidate, buildIncomeCandidate, finishTerminal, showToast]);

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Loading detection…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'failed') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>Could not load that detection</Text>
          <Text style={[Typography.labelMd, styles.centerCopy, { color: ts.text.onSurfaceVariant }]}>
            Something went wrong while reading it. Please try again.
          </Text>
          <PeachButton title="Back" onPress={goBack} variant="primary" size="md" />
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'missing' || !draft) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>This detection is already handled</Text>
          <Text style={[Typography.labelMd, styles.centerCopy, { color: ts.text.onSurfaceVariant }]}>
            It was confirmed, discarded, or filed from another action. Nothing more to do here.
          </Text>
          <PeachButton title="Back to inbox" onPress={goBack} variant="primary" size="md" />
        </View>
      </SafeAreaView>
    );
  }

  const amountValue = parseFloat(fields.amount);
  const editValid = fields.merchant.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;
  const categoryTitle = categories.find(category => category.id === fields.categoryId)?.title ?? draft.category;
  const categoryTint = tintFor(fields.categoryId);
  const resolvedTint = ts.isDark ? categoryTint.dark : categoryTint.light;
  // M4 two sheet modes (D2 contract): expense confirms as today through the
  // expense boundary; income confirms through the shared saveIncome boundary.
  // The sender renders from incomeSourceNameOf, so expense drafts read the
  // merchant and income drafts the sender with one name each.
  const isIncomeSheet = isIncomeDraft(draft);
  const displayName = isIncomeSheet ? incomeSourceNameOf(draft) : draft.merchant;
  const savePreview = buildCandidate(draft);
  const incomeSavePreview = isIncomeSheet ? buildIncomeCandidate(draft) : null;
  const amountText = formatCurrency(incomeSavePreview ? incomeSavePreview.amount : savePreview.amount, draft.currency);
  const busy = confirming;
  const contentWidth = Math.min(width, SHEET_MAX_WIDTH);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: ts.border.subtle }]}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={[styles.backButton, { backgroundColor: ts.bg.elevated }]}
        >
          <ArrowLeft size={20} color={ts.raw.onSurface} />
        </Pressable>
        <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
          Detected Transaction
        </Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingHorizontal: Spacing.s5, paddingBottom: Math.max(Spacing.s5, insets.bottom) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.sheet, { maxWidth: contentWidth }]}>
          <View style={styles.handleTrack}>
            <View style={[styles.handle, { backgroundColor: ts.border.card }]} />
          </View>

          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Zero-Guilt preview • Nothing saved to ledger yet</Text>

          <View style={[styles.amountCard, { backgroundColor: ts.bg.low, borderColor: ts.border.card }]}>
            <View style={{ flexShrink: 1 }}>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6 }]}>Amount Inferred</Text>
              <View style={styles.amountRow}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.displayMd, { color: ts.text.onSurface, flexShrink: 1 }]}>{amountText}</Text>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', flexShrink: 0 }]}>{draft.currency}</Text>
              </View>
            </View>
          </View>

          {view === 'summary' ? (
            <>
              <View style={[styles.card, { backgroundColor: ts.bg.lowest, borderColor: ts.border.card }]}>
                <View style={styles.cardLeft}>
                  <View style={[styles.merchantIcon, { backgroundColor: resolvedTint[0] }]}>
                    <CategoryGlyph iconName={categories.find(c => c.id === draft.category)?.icon_name} size={18} color={resolvedTint[1]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>{displayName}</Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{formatRelativeDateWithTime(draft.detectedAt)}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => { void Haptics.selectionAsync(); setView('edit'); }}
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
                    {`Future ${displayName} auto-captures will use this category without asking.`}
                  </Text>
                </View>
              ) : null}

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
                    <PeachButton title="Edit Details" onPress={() => { void Haptics.selectionAsync(); setView('edit'); }} variant="secondary" size="sm" radius={12} fullWidth disabled={busy} icon={<Pencil size={14} color={ts.text.primary} />} />
                  </View>
                  <View style={styles.half}>
                    <PeachButton title="Discard Safe" onPress={() => { void discard(); }} variant="neutral" size="sm" radius={12} fullWidth disabled={busy} />
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
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', marginBottom: Spacing.s1 }]}>{isIncomeSheet ? 'Income Source' : 'Merchant Name'}</Text>
                <TextInput
                  value={fields.merchant}
                  onChangeText={value => setFields(prev => ({ ...prev, merchant: value }))}
                  placeholder={isIncomeSheet ? 'Income source' : 'Merchant'}
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  accessibilityLabel={isIncomeSheet ? 'Income source name' : 'Merchant name'}
                  style={[styles.input, { backgroundColor: ts.bg.screen, borderColor: ts.border.card, color: ts.text.onSurface }]}
                />
              </View>

              <View style={styles.editGrid}>
                <View style={styles.editColumn}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, fontFamily: 'Manrope_600SemiBold', marginBottom: Spacing.s1 }]}>Amount</Text>
                  <TextInput
                    value={fields.amount}
                    onChangeText={value => setFields(prev => ({ ...prev, amount: value }))}
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
                    onPress={() => { void Haptics.selectionAsync(); setPickerOpen(true); }}
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
                accessibilityLabel={`Remember this category rule for future ${displayName} auto-captures`}
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
                  {`Remember this category rule for future ${displayName} auto-captures.`}
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
                  <PeachButton title="Back to Summary" onPress={() => { void Haptics.selectionAsync(); setView('summary'); }} variant="neutral" size="md" radius={12} fullWidth disabled={busy} />
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
        </View>
      </ScrollView>

      <CategoryPickerSheet
        visible={pickerOpen}
        categories={categories}
        selectedId={fields.categoryId}
        flowType={isIncomeSheet ? 'income' : 'expense'}
        originLabel={fields.merchant.trim() || displayName}
        originAmount={Number.isFinite(amountValue) && amountValue > 0 ? formatCurrency(amountValue, draft.currency) : undefined}
        onSelect={category => { setFields(prev => ({ ...prev, categoryId: category.id })); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />

      {duplicate ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicate}
          incoming={{
            merchant: incomeSavePreview ? incomeSavePreview.sourceName : savePreview.merchant,
            amount: incomeSavePreview ? incomeSavePreview.amount : savePreview.amount,
            currency: draft.currency,
            category: categoryTitle,
            type: isIncomeSheet ? 'income' : 'expense',
            date: draft.detectedAt,
          }}
          onSaveAnyway={() => { setDuplicate(null); void confirm('save_anyway', fields.categoryId); }}
          onDiscard={() => { setDuplicate(null); void discard(); }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.s5, gap: Spacing.s2 },
  centerCopy: { textAlign: 'center', marginBottom: Spacing.s3 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
    gap: Spacing.s3,
  },
  backButton: { width: 40, height: 40, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  backSpacer: { width: 40 },
  body: { flex: 1 },
  bodyContent: { alignItems: 'center' },
  sheet: { width: '100%', gap: Spacing.s3 },
  handleTrack: { alignItems: 'center', paddingTop: Spacing.s2 },
  handle: { width: 40, height: 4, borderRadius: Radii.full },
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
