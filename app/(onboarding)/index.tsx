import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, Eye, RotateCcw, ShieldCheck, User } from 'lucide-react-native';
import { OnboardingSlide, onboardingIllustrationSize } from '../../components/onboarding/OnboardingSlide';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { Skeleton } from '../../components/ui/Skeleton';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import type { AutoCapturePermission } from '../../data/contracts';
import { getCurrencyPrefix, getCurrencyName, formatCurrency } from '../../utils/currency';

// Canonical S-01 setup currencies, first four shown as pills. Names and symbols
// come from the shared currency utility so no screen hardcodes a symbol.
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'] as const;

const VALUE_SLIDES = [
  {
    title: 'Log in seconds, not minutes.',
    subtitle: 'Frictionless manual capture designed for one-handed thumb entry. No slow bank logins or synced clutter.',
  },
  {
    title: 'See where your money actually goes.',
    subtitle: 'Mindful category breakdowns and pacing metrics give you clarity before you overspend, never after.',
  },
  {
    title: 'Snap receipts, ask questions.',
    subtitle: 'Instant AI receipt extraction and an on-device spending copilot ready whenever you need guidance.',
  },
] as const;

// Fluid gutter between the canonical 20px and 28px phone paddings.
const GUTTER_MIN = 20;
const GUTTER_MAX = 28;
const GUTTER_RATIO = 0.0615;

// FR-01.7 writes the setup through one local SQLite transaction, and there is no
// network step anywhere on this screen, so the only outcome the pair does not
// depict is a refused device write. The copy says exactly that and promises
// nothing it cannot keep: the write is transactional, so a failure saves nothing.
const SAVE_FAILURE_MESSAGE = 'Could not save your setup on this device. Nothing was saved. Try again.';

// Audit batch 1 (Screen 1, "Touch Target Expansion", line 89 of
// docs/ux-audit/batch-1-onboarding-dashboard.md) requires an interactive hit
// container of at least 44 by 44 points around each pagination dot while the
// drawn dot stays small. Each dot now sits in its own 44pt cell, so the target is
// earned by layout instead of by hitSlop: adjacent slops on a 16pt pitch would
// overlap and a tap in the overlap would resolve to whichever sibling React
// Native paints last. The drawn artwork below is untouched (8pt, 26pt active).
const DOT_TOUCH_TARGET = 44;

// Starter budget anchors from the same audit fix (line 76: "$1,000, $2,500,
// $5,000, Custom"). They are amounts offered to the user, not a reading of the
// ledger, and every one of them is rendered through the shared formatter for the
// currency currently selected, so no symbol or grouped figure is written here.
const BUDGET_PRESET_AMOUNTS = [1000, 2500, 5000] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const theme = useThemeStyles();
  const { settings, isLoading, completeOnboarding } = useSettings();
  const { showToast } = useToast();
  const reduceMotion = useReduceMotion();
  const listRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  // FR-01.4 and the canonical pair default the onboarding picker to USD, not
  // the app-wide fallback currency which may differ for an install.
  const currency = currencyOverride ?? 'USD';
  const [budget, setBudget] = useState('');
  // Which budget affordance is live. A preset writes its own formatted amount;
  // Custom reveals the free numeric input. Held beside `budget` so the chip's
  // selected state and the input's visibility cannot disagree.
  const [customBudget, setCustomBudget] = useState(false);
  const [permission, setPermission] = useState<AutoCapturePermission>('unsupported');
  const [canRequestPermission, setCanRequestPermission] = useState(false);
  // The setup write is the screen's only async commit, so it is the only state
  // that needs a busy flag and a spoken outcome.
  const [submitting, setSubmitting] = useState(false);
  const [saveFailure, setSaveFailure] = useState('');
  const isAndroid = Platform.OS === 'android';
  const isComplete = settings.onboarding_complete === 'true';
  const autoCaptureAdapter = useMemo(() => createNativeAutoCaptureAdapter(), []);

  const slideIds = useMemo(
    () => [...VALUE_SLIDES.map((_, i) => `value-${i}`), 'setup', ...(isAndroid ? ['auto-capture'] : [])],
    [isAndroid],
  );
  const totalDots = slideIds.length;
  const isSetup = index === VALUE_SLIDES.length;
  const isAutoCapture = isAndroid && index === totalDots - 1;
  const gutter = Math.min(Math.max(width * GUTTER_RATIO, GUTTER_MIN), GUTTER_MAX);

  // FR-01.8: checked before slide 1 renders, no flash. The redirect below is the
  // only path that runs on re-entry, and it renders the empty themed canvas so
  // onboarding never paints over Home while the replace lands.
  useEffect(() => {
    if (!isLoading && isComplete) router.replace('/(tabs)');
  }, [isComplete, isLoading, router]);

  useEffect(() => {
    if (!isAndroid) return;
    const refreshPermission = () => {
      void autoCaptureAdapter.getPermissionState().then((state) => {
        setPermission(state.status);
        setCanRequestPermission(state.canRequest);
      });
    };
    refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission();
    });
    return () => subscription.remove();
  }, [autoCaptureAdapter, isAndroid]);

  const goTo = useCallback((nextIndex: number) => {
    const bounded = Math.min(Math.max(nextIndex, 0), totalDots - 1);
    setIndex(bounded);
    // POLISH Section 4: a step change is a translation, so under reduce motion the
    // carousel moves instantly instead of sliding the full page width.
    listRef.current?.scrollTo({ x: bounded * width, animated: !reduceMotion });
  }, [reduceMotion, totalDots, width]);

  // FR-01.7: skip and complete both write the full onboarding state once, then
  // land on Home. Typed atomic store write, no direct SQL. The write is local, so
  // a failure is a device failure: it is surfaced instead of left as a silent
  // rejection, and the screen stays put so the retry is possible.
  const complete = useCallback(async () => {
    if (submitting) return;
    // A live region only speaks when its content changes, so the previous failure
    // is cleared as the attempt starts. The clear commits in the press handler and
    // the failure string commits later in the promise continuation, so an identical
    // retry is still announced rather than silently skipped.
    setSaveFailure('');
    setSubmitting(true);
    try {
      await completeOnboarding({ profileName: name, currency, monthlyBudget: budget });
      router.replace('/(tabs)');
    } catch {
      showToast(SAVE_FAILURE_MESSAGE, 'error');
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(SAVE_FAILURE_MESSAGE);
      } else {
        setSaveFailure(SAVE_FAILURE_MESSAGE);
      }
      setSubmitting(false);
    }
  }, [budget, completeOnboarding, currency, name, router, showToast, submitting]);

  const skip = useCallback(() => {
    void complete();
  }, [complete]);

  // FR-01.8: the loading read shows the shared skeleton mirroring the settled first
  // slide; the already-complete guard keeps the empty themed canvas, because a
  // redirect in flight is not a load and a placeholder there would depict one.
  if (isLoading) return <SetupSkeleton />;
  if (isComplete) return <View style={{ flex: 1, backgroundColor: theme.bg.screen }} />;

  const primaryLabel = isSetup && !isAndroid ? 'Get Started' : isSetup ? 'Next: Permissions' : 'Next';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg.screen }}>
      <View
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: gutter,
        }}
      >
        {index > 0 ? (
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Back to previous onboarding step"
            onPress={() => goTo(index - 1)}
            style={{ minWidth: 64, minHeight: 48, justifyContent: 'center' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
              <ChevronLeft color={theme.icon.primary} size={20} />
              <Text style={{ color: theme.icon.primary, ...Typography.labelLg }}>Back</Text>
            </View>
          </ScalePressable>
        ) : (
          <View style={{ minWidth: 64, minHeight: 48 }} />
        )}

        {/* Skip lives in the footer now: the audit (Screen 1, "Mobile Touch and
            Ergonomics Flaws", line 68) places it outside the one-handed thumb zone
            in the header. Its header slot is kept as a spacer so Back does not move
            between steps. */}
        <View style={{ minWidth: 64, minHeight: 48 }} />
      </View>

      <ScrollView
        ref={listRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {slideIds.map((slideId, slideIndex) => {
          if (slideIndex < VALUE_SLIDES.length) {
            const slide = VALUE_SLIDES[slideIndex];
            return (
              <OnboardingSlide
                key={slideId}
                title={slide.title}
                subtitle={slide.subtitle}
                slideNumber={(slideIndex + 1) as 1 | 2 | 3}
                active={slideIndex === index}
              />
            );
          }
          if (slideIndex === VALUE_SLIDES.length) {
            return (
              <SetupSlide
                key={slideId}
                width={width}
                gutter={gutter}
                name={name}
                setName={setName}
                currency={currency}
                setCurrency={setCurrencyOverride}
                budget={budget}
                setBudget={setBudget}
                customBudget={customBudget}
                setCustomBudget={setCustomBudget}
                completedSteps={index}
                totalSteps={totalDots}
                theme={theme}
              />
            );
          }
          return (
            <AutoCaptureSlide
              key={slideId}
              width={width}
              gutter={gutter}
              theme={theme}
              permission={permission}
              canRequestPermission={canRequestPermission}
              busy={submitting}
              onGrant={() => { void autoCaptureAdapter.openSystemSettings(); }}
              onSkip={complete}
            />
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: gutter, paddingBottom: Spacing.s4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
          {slideIds.map((slideId, dotIndex) => (
            <Pressable
              key={slideId}
              accessibilityRole="button"
              accessibilityLabel={`Go to onboarding step ${dotIndex + 1} of ${totalDots}`}
              accessibilityState={{ selected: dotIndex === index }}
              onPress={() => { void Haptics.selectionAsync(); goTo(dotIndex); }}
              style={{ width: DOT_TOUCH_TARGET, height: DOT_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  width: dotIndex === index ? 26 : 8,
                  height: 8,
                  borderRadius: Radii.full,
                  backgroundColor: dotIndex === index ? theme.raw.primary : theme.text.onSurfaceVariant30,
                }}
              />
            </Pressable>
          ))}
        </View>

        {!isAutoCapture && (
          <PeachButton
            title={primaryLabel}
            size="xl"
            fullWidth
            isLoading={submitting}
            onPress={() => (index < totalDots - 1 ? goTo(index + 1) : complete())}
            trailingIcon={<ChevronRight color={theme.text.white} size={18} />}
          />
        )}

        {/* Lower skip affordance. The canonical pair puts Skip in the header only,
            which a one-handed thumb cannot reach (audit line 68). Moving the single
            control here keeps one implementation and one meaning instead of adding a
            second Skip beside the header one. It stays text-only and quiet so it can
            never be mistaken for the primary action, and it is absent from the setup
            and auto-capture steps exactly as the pair hides it from slide 4 onward. */}
        {index < VALUE_SLIDES.length && (
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Skip setup and use the default preferences"
            onPress={skip}
            style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.s1 }}
          >
            <Text style={{ color: theme.text.onSurfaceVariant, ...Typography.labelLg }}>Skip</Text>
          </ScalePressable>
        )}
      </View>

      {/* POLISH Section 7: Android speaks the refused setup write through this polite
          live region. The node is a 1x1 clipped transparent box, so it renders
          nothing the locked pair does not show. */}
      <View accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
        <Text>{saveFailure}</Text>
      </View>
    </SafeAreaView>
  );
}

type Theme = ReturnType<typeof useThemeStyles>;

// POLISH Section 6. The settings read that gates the first slide used to paint an
// empty themed canvas, so a slow device showed nothing at all. The placeholder
// mirrors the settled first slide: the same header height, the same 24pt slide
// gutter, the same illustration geometry through the one shared size function, bars
// at the real title and description line heights, then the real dots row and the
// real 52pt pill. Only the text wrap differs, so the shift is bounded and the
// skeleton-to-content transition stays on the device checklist.
function SetupSkeleton() {
  const theme = useThemeStyles();
  const { width } = useWindowDimensions();
  const gutter = Math.min(Math.max(width * GUTTER_RATIO, GUTTER_MIN), GUTTER_MAX);
  const illustrationSize = onboardingIllustrationSize(width);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg.screen }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading PeachSpend setup"
        accessibilityState={{ busy: true }}
        style={{ flex: 1 }}
      >
        <View style={{ height: 48 }} />

        <View style={{ flex: 1, paddingHorizontal: Spacing.s6, paddingTop: Spacing.s4, alignItems: 'center' }}>
          <Skeleton
            width={illustrationSize * 0.76}
            height={illustrationSize * 0.85}
            borderRadius={Radii.xl}
            style={{ marginBottom: Spacing.s5 }}
          />
          <Skeleton width="82%" height={Typography.headlineLg.lineHeight} />
          <Skeleton width="48%" height={Typography.headlineLg.lineHeight} />
          <Skeleton width="92%" height={Typography.bodyMd.lineHeight} style={{ marginTop: Spacing.s2 }} />
          <Skeleton width="88%" height={Typography.bodyMd.lineHeight} />
          <Skeleton width="58%" height={Typography.bodyMd.lineHeight} />
        </View>

        <View style={{ paddingHorizontal: gutter, paddingBottom: Spacing.s4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: DOT_TOUCH_TARGET, height: DOT_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
              <Skeleton width={26} height={8} borderRadius={Radii.full} />
            </View>
            {Array.from({ length: 4 }).map((_, dotIndex) => (
              <View key={dotIndex} style={{ width: DOT_TOUCH_TARGET, height: DOT_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
                <Skeleton width={8} height={8} borderRadius={Radii.full} />
              </View>
            ))}
          </View>
          <Skeleton width="100%" height={52} borderRadius={Radii.full} />
          <View style={{ height: 44, marginTop: Spacing.s1, alignItems: 'center', justifyContent: 'center' }}>
            <Skeleton width={48} height={Typography.labelLg.lineHeight} />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

interface SetupSlideProps {
  width: number;
  gutter: number;
  name: string;
  setName: (value: string) => void;
  currency: string;
  setCurrency: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  customBudget: boolean;
  setCustomBudget: (value: boolean) => void;
  completedSteps: number;
  totalSteps: number;
  theme: Theme;
}

function SetupSlide({
  width,
  gutter,
  name,
  setName,
  currency,
  setCurrency,
  budget,
  setBudget,
  customBudget,
  setCustomBudget,
  completedSteps,
  totalSteps,
  theme,
}: SetupSlideProps) {
  const pillCodes = CURRENCY_CODES.slice(0, 4);
  const trimmedName = name.trim();
  return (
    <View style={{ width, flex: 1, paddingHorizontal: gutter, paddingTop: Spacing.s3 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.s5 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <StepProgress completed={completedSteps} total={totalSteps} theme={theme} />
        <Text style={[Typography.headlineLg, { fontSize: 24, color: theme.text.onSurface, marginBottom: Spacing.s1 }]}>
          Make it yours.
        </Text>
        <Text style={[Typography.labelMd, { color: theme.text.onSurfaceVariant, marginBottom: Spacing.s4 }]}>
          Set your basic preferences. You can adjust all of these in Settings at any time.
        </Text>

        <PreviewCard name={trimmedName} currency={currency} theme={theme} />

        <Text style={labelStyle(theme)}>Your Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Alex Morgan"
          placeholderTextColor={theme.text.onSurfaceVariant40}
          autoCapitalize="words"
          accessibilityLabel="Your name"
          style={inputStyle(theme)}
        />

        <View style={labelRow}>
          <Text style={labelStyle(theme)}>Default Currency</Text>
          <Text style={badgeStyle(theme)}>Base Unit</Text>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Default currency" style={{ flexDirection: 'row', gap: Spacing.s2, marginBottom: Spacing.s3 }}>
          {pillCodes.map((code) => {
            const selected = code === currency;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityLabel={`${getCurrencyName(code)}, ${code}`}
                accessibilityState={{ selected }}
                onPress={() => { void Haptics.selectionAsync(); setCurrency(code); }}
                style={[
                  currencyPill(theme),
                  selected && { backgroundColor: theme.raw.primary, borderColor: theme.raw.primary },
                ]}
              >
                <Text style={{ color: selected ? theme.text.white : theme.text.onSurface, ...Typography.captionBold, fontWeight: '700' }} numberOfLines={1}>
                  {code} {getCurrencyPrefix(code)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={labelRow}>
          <Text style={labelStyle(theme)}>Monthly Target Budget</Text>
          <Text style={badgeStyle(theme)}>Optional</Text>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Monthly target budget" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2 }}>
          {BUDGET_PRESET_AMOUNTS.map((amount) => {
            const selected = !customBudget && parseBudgetAmount(budget) === amount;
            const label = formatCurrency(amount, currency);
            return (
              <Pressable
                key={amount}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                onPress={() => { void Haptics.selectionAsync(); setBudget(String(amount)); setCustomBudget(false); }}
                style={[budgetChip(theme), selected && { backgroundColor: theme.raw.primary, borderColor: theme.raw.primary }]}
              >
                <Text style={{ color: selected ? theme.text.white : theme.text.onSurface, ...Typography.captionBold, fontWeight: '700' }} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="Custom monthly budget"
            accessibilityState={{ selected: customBudget }}
            onPress={() => { void Haptics.selectionAsync(); setCustomBudget(true); }}
            style={[budgetChip(theme), customBudget && { backgroundColor: theme.raw.primary, borderColor: theme.raw.primary }]}
          >
            <Text style={{ color: customBudget ? theme.text.white : theme.text.onSurface, ...Typography.captionBold, fontWeight: '700' }}>
              Custom
            </Text>
          </Pressable>
        </View>
        {customBudget && (
          <TextInput
            value={budget}
            onChangeText={setBudget}
            placeholder="Enter an amount"
            placeholderTextColor={theme.text.onSurfaceVariant40}
            keyboardType="numeric"
            autoFocus
            accessibilityLabel={`Custom monthly target budget in ${getCurrencyName(currency)}`}
            style={[inputStyle(theme), { marginTop: Spacing.s2 }]}
          />
        )}
      </ScrollView>
    </View>
  );
}

// Reads the budget string back as a number so a preset only shows selected when
// the stored value really equals it. A blank or unreadable entry is nothing
// selected, never a silent zero.
function parseBudgetAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// Setup progress, derived from the step the user has actually reached. `completed`
// is the carousel index (the steps already passed), never a fixed percentage, so
// the track is honest on both platform branches: 3 of 4 on iOS and 3 of 5 on
// Android, because Android has the extra auto-capture step.
function StepProgress({ completed, total, theme }: { completed: number; total: number; theme: Theme }) {
  const fraction = total > 0 ? Math.min(Math.max(completed / total, 0), 1) : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: completed }}
      accessibilityLabel={`Setup progress, ${completed} of ${total} steps done`}
      style={{ marginBottom: Spacing.s3 }}
    >
      <View style={{ height: 6, borderRadius: Radii.full, backgroundColor: theme.bg.elevated, overflow: 'hidden' }}>
        <View style={{ width: `${fraction * 100}%`, height: 6, borderRadius: Radii.full, backgroundColor: theme.raw.primary }} />
      </View>
      <Text style={[Typography.micro, { color: theme.text.onSurfaceVariant, marginTop: Spacing.s1 }]}>
        {completed} of {total} steps done
      </Text>
    </View>
  );
}

// Live preview of the Home header this setup will produce. It renders the name
// typed so far, or an explicit no-name placeholder, plus the currency currently
// selected. It shows no amount and no count, so there is nothing here to be
// mistaken for a ledger figure before one exists.
function PreviewCard({ name, currency, theme }: { name: string; currency: string; theme: Theme }) {
  const hasName = name.length > 0;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <View
      accessible
      accessibilityLabel={
        hasName
          ? `Home header preview. ${name}, ${getCurrencyName(currency)}.`
          : `Home header preview. No name entered yet, ${getCurrencyName(currency)}.`
      }
      style={previewCard(theme)}
    >
      <View style={previewAvatar(theme)}>
        {hasName ? (
          <Text style={{ color: theme.text.white, ...Typography.labelBold }}>{initials}</Text>
        ) : (
          <User color={theme.text.onSurfaceVariant} size={18} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[Typography.micro, { color: theme.text.onSurfaceVariant }]}>Your Home header</Text>
        <Text
          numberOfLines={1}
          style={[Typography.headlineMd, { color: hasName ? theme.text.onSurface : theme.text.onSurfaceVariant40 }]}
        >
          {hasName ? name : 'Your name'}
        </Text>
      </View>
      <Text style={previewCurrency(theme)} numberOfLines={1}>
        {currency} {getCurrencyPrefix(currency)}
      </Text>
    </View>
  );
}

interface AutoCaptureSlideProps {
  width: number;
  gutter: number;
  theme: Theme;
  permission: AutoCapturePermission;
  canRequestPermission: boolean;
  busy: boolean;
  onGrant: () => void;
  onSkip: () => void;
}

// Android-only slide. Grant action is inert until a native listener source is
// approved, so the primary control is honestly disabled and the unsupported
// state explains itself. Skip is always equal-weight and always proceeds.
function AutoCaptureSlide({ width, gutter, theme, permission, canRequestPermission, busy, onGrant, onSkip }: AutoCaptureSlideProps) {
  const unavailable = permission === 'unsupported' || !canRequestPermission;
  return (
    <View style={{ width, flex: 1, paddingHorizontal: gutter, paddingTop: Spacing.s3 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.s5 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: Spacing.s2, marginBottom: Spacing.s2 }}>
          <Text style={androidBadge(theme)}>Android Only</Text>
          <Text style={badgeStyle(theme)}>Privacy First</Text>
        </View>
        <Text style={[Typography.headlineLg, { fontSize: 23, color: theme.text.onSurface, marginBottom: Spacing.s1 }]}>
          Effortless Auto-Capture.
        </Text>
        <Text style={[Typography.labelMd, { color: theme.text.onSurfaceVariant }]}>
          Auto-capture is not available in this build. When it ships, PeachSpend will detect payment notifications from your banking apps and draft transactions for your review.
        </Text>

        <View style={permissionCard(theme)}>
          <Guarantee
            icon={<ShieldCheck color={theme.icon.primary} size={16} />}
            title="On-Device by Design"
            text="When auto-capture ships, notification text will be analyzed strictly on your device and never uploaded to any remote server."
            theme={theme}
          />
          <Guarantee
            icon={<RotateCcw color={theme.icon.primary} size={16} />}
            title="Completely Reversible"
            text="When it ships, you will be able to pause or disable auto-capture at any time from your Profile Settings."
            theme={theme}
          />
          <Guarantee
            icon={<Eye color={theme.icon.primary} size={16} />}
            title="Full Review Control"
            text="Captured items will appear as drafts for your one-tap review before joining your ledger."
            theme={theme}
          />
        </View>

        {unavailable && (
          <Text style={{ color: theme.text.onSurfaceVariant, ...Typography.labelMd, marginTop: Spacing.s3 }}>
            Auto-capture has no enabled path in this build. Continue without it and revisit it from Settings after a future update.
          </Text>
        )}

        <View style={{ gap: Spacing.s2, marginTop: Spacing.s4 }}>
          <PeachButton
            title="Enable Auto-Capture"
            size="xl"
            fullWidth
            variant={unavailable ? 'disabled' : 'primary'}
            disabled={unavailable || busy}
            onPress={onGrant}
          />
          <PeachButton
            title="Skip for now"
            size="xl"
            fullWidth
            variant="outline"
            isLoading={busy}
            onPress={onSkip}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Guarantee({ icon, title, text, theme }: { icon: React.ReactNode; title: string; text: string; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.s3, alignItems: 'flex-start' }}>
      <View style={{ width: 28, height: 28, borderRadius: Radii.full, backgroundColor: theme.bg.primary10, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[Typography.labelLg, { color: theme.text.onSurface, marginBottom: 2, fontWeight: '700' }]}>{title}</Text>
        <Text style={[Typography.labelMd, { color: theme.text.onSurfaceVariant }]}>{text}</Text>
      </View>
    </View>
  );
}

const labelStyle = (theme: Theme) => ({ ...Typography.labelMd, color: theme.text.onSurface, fontWeight: '700' as const, marginBottom: Spacing.s2 });
const badgeStyle = (theme: Theme) => ({
  ...Typography.micro,
  color: theme.text.onSurfaceVariant,
  backgroundColor: theme.bg.elevated,
  paddingHorizontal: Spacing.s2,
  paddingVertical: 2,
  borderRadius: Radii.full,
  overflow: 'hidden' as const,
  alignSelf: 'flex-start' as const,
});
const androidBadge = (theme: Theme) => ({
  ...badgeStyle(theme),
  backgroundColor: theme.raw.warningContainer,
  color: theme.raw.warningContainerText,
});
const labelRow = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginTop: Spacing.s3 };
const inputStyle = (theme: Theme) => ({
  ...Typography.bodyMd,
  color: theme.text.onSurface,
  backgroundColor: theme.bg.surface,
  borderColor: theme.border.card,
  borderWidth: 1,
  borderRadius: Radii.full,
  paddingHorizontal: Spacing.s5,
  minHeight: 50,
});
const currencyPill = (theme: Theme) => ({
  flex: 1,
  minHeight: 44,
  borderRadius: Radii.full,
  backgroundColor: theme.bg.surface,
  borderWidth: 1,
  borderColor: theme.border.card,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});
// Budget starter chips. Same pill anatomy as the currency pills, minimum 44pt
// tall so the target clears the 44pt/48dp floor on every width, and they wrap
// rather than compress so a longer formatted amount can never clip a label.
const budgetChip = (theme: Theme) => ({
  minHeight: 44,
  paddingHorizontal: Spacing.s4,
  borderRadius: Radii.full,
  backgroundColor: theme.bg.surface,
  borderWidth: 1,
  borderColor: theme.border.card,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});
const previewCard = (theme: Theme) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: Spacing.s3,
  backgroundColor: theme.bg.surface,
  borderWidth: 1,
  borderColor: theme.border.card,
  borderRadius: Radii.lg,
  padding: Spacing.s3,
  marginBottom: Spacing.s4,
});
const previewAvatar = (theme: Theme) => ({
  width: 40,
  height: 40,
  borderRadius: Radii.full,
  backgroundColor: theme.raw.primary,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});
// Mirrors the canonical form-badge pill so the preview reads as part of the form.
const previewCurrency = (theme: Theme) => ({
  ...Typography.micro,
  color: theme.text.onSurfaceVariant,
  backgroundColor: theme.bg.elevated,
  paddingHorizontal: Spacing.s2,
  paddingVertical: Spacing.s1,
  borderRadius: Radii.full,
  overflow: 'hidden' as const,
});
const permissionCard = (theme: Theme) => ({
  backgroundColor: theme.bg.surface,
  borderRadius: Radii.xl,
  padding: Spacing.s5,
  gap: Spacing.s3,
  marginTop: Spacing.s4,
  borderWidth: 1,
  borderColor: theme.border.card,
});
