import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Eye, RotateCcw, ShieldCheck } from 'lucide-react-native';
import { OnboardingSlide } from '../../components/onboarding/OnboardingSlide';
import { PeachButton } from '../../components/ui/PeachButton';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import type { AutoCapturePermission } from '../../data/contracts';
import { getCurrencyPrefix, getCurrencyName } from '../../utils/currency';

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

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const theme = useThemeStyles();
  const { settings, isLoading, completeOnboarding } = useSettings();
  const listRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  // FR-01.4 and the canonical pair default the onboarding picker to USD, not
  // the app-wide fallback currency which may differ for an install.
  const currency = currencyOverride ?? 'USD';
  const [budget, setBudget] = useState('');
  const [permission, setPermission] = useState<AutoCapturePermission>('unsupported');
  const [canRequestPermission, setCanRequestPermission] = useState(false);
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

  // FR-01.8: checked before slide 1 renders, no flash. The guard renders an
  // empty themed canvas while loading or already complete so onboarding never
  // paints on re-entry.
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
    listRef.current?.scrollTo({ x: bounded * width, animated: true });
  }, [totalDots, width]);

  // FR-01.7: skip and complete both write the full onboarding state once, then
  // land on Home. Typed atomic store write, no direct SQL.
  const complete = useCallback(async () => {
    await completeOnboarding({ profileName: name, currency, monthlyBudget: budget });
    router.replace('/(tabs)');
  }, [budget, completeOnboarding, currency, name, router]);

  const skip = useCallback(() => {
    void complete();
  }, [complete]);

  if (isLoading || isComplete) return <View style={{ flex: 1, backgroundColor: theme.bg.screen }} />;

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to previous onboarding step"
            onPress={() => goTo(index - 1)}
            hitSlop={8}
            style={{ minWidth: 64, minHeight: 48, justifyContent: 'center' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 }}>
              <ChevronLeft color={theme.icon.primary} size={20} />
              <Text style={{ color: theme.icon.primary, ...Typography.labelLg }}>Back</Text>
            </View>
          </Pressable>
        ) : (
          <View style={{ minWidth: 64, minHeight: 48 }} />
        )}

        {index <= 2 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            onPress={skip}
            hitSlop={8}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.s2 }}
          >
            <Text style={{ color: theme.text.onSurfaceVariant, ...Typography.labelLg }}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ minWidth: 64, minHeight: 48 }} />
        )}
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
              onGrant={() => { void autoCaptureAdapter.openSystemSettings(); }}
              onSkip={complete}
            />
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: gutter, paddingBottom: Spacing.s4 }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.s2, height: 10, marginBottom: Spacing.s4 }}
        >
          {slideIds.map((slideId, dotIndex) => (
            <Pressable
              key={slideId}
              accessibilityRole="button"
              accessibilityLabel={`Go to onboarding step ${dotIndex + 1} of ${totalDots}`}
              accessibilityState={{ selected: dotIndex === index }}
              onPress={() => goTo(dotIndex)}
              hitSlop={18}
              style={{
                width: dotIndex === index ? 26 : 8,
                height: 8,
                borderRadius: Radii.full,
                backgroundColor: dotIndex === index ? theme.raw.primary : theme.text.onSurfaceVariant30,
              }}
            />
          ))}
        </View>

        {!isAutoCapture && (
          <PeachButton
            title={primaryLabel}
            size="xl"
            fullWidth
            onPress={() => (index < totalDots - 1 ? goTo(index + 1) : complete())}
            trailingIcon={<ChevronRight color={theme.text.white} size={18} />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

type Theme = ReturnType<typeof useThemeStyles>;

interface SetupSlideProps {
  width: number;
  gutter: number;
  name: string;
  setName: (value: string) => void;
  currency: string;
  setCurrency: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  theme: Theme;
}

function SetupSlide({ width, gutter, name, setName, currency, setCurrency, budget, setBudget, theme }: SetupSlideProps) {
  const pillCodes = CURRENCY_CODES.slice(0, 4);
  return (
    <View style={{ width, flex: 1, paddingHorizontal: gutter, paddingTop: Spacing.s3 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.s5 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={badgeStyle(theme)}>Step 1 of Setup</Text>
        <Text style={[Typography.headlineLg, { fontSize: 24, color: theme.text.onSurface, marginTop: Spacing.s3, marginBottom: Spacing.s1 }]}>
          Make it yours.
        </Text>
        <Text style={[Typography.labelMd, { color: theme.text.onSurfaceVariant, marginBottom: Spacing.s5 }]}>
          Set your basic preferences. You can adjust all of these in Settings at any time.
        </Text>

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
        <View style={{ flexDirection: 'row', gap: Spacing.s2, marginBottom: Spacing.s5 }}>
          {pillCodes.map((code) => {
            const selected = code === currency;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityLabel={`${getCurrencyName(code)}, ${code}`}
                accessibilityState={{ selected }}
                onPress={() => setCurrency(code)}
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
        <TextInput
          value={budget}
          onChangeText={setBudget}
          placeholder="Leave blank to skip"
          placeholderTextColor={theme.text.onSurfaceVariant40}
          keyboardType="numeric"
          accessibilityLabel="Monthly target budget, optional"
          style={inputStyle(theme)}
        />
      </ScrollView>
    </View>
  );
}

interface AutoCaptureSlideProps {
  width: number;
  gutter: number;
  theme: Theme;
  permission: AutoCapturePermission;
  canRequestPermission: boolean;
  onGrant: () => void;
  onSkip: () => void;
}

// Android-only slide. Grant action is inert until a native listener source is
// approved, so the primary control is honestly disabled and the unsupported
// state explains itself. Skip is always equal-weight and always proceeds.
function AutoCaptureSlide({ width, gutter, theme, permission, canRequestPermission, onGrant, onSkip }: AutoCaptureSlideProps) {
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
            disabled={unavailable}
            onPress={onGrant}
          />
          <PeachButton
            title="Skip for now"
            size="xl"
            fullWidth
            variant="outline"
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
const permissionCard = (theme: Theme) => ({
  backgroundColor: theme.bg.surface,
  borderRadius: Radii.xl,
  padding: Spacing.s5,
  gap: Spacing.s3,
  marginTop: Spacing.s4,
  borderWidth: 1,
  borderColor: theme.border.card,
});
