import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ArrowDown, ArrowUp, BarChart3, Check, Minus, Sparkles, Star, X } from 'lucide-react-native';

import { CategoryTints, Colors, Gradients, Radii, Spacing, Typography } from '../constants/tokens';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useSettings } from '../components/ui/SettingsProvider';
import { LuminousCard } from '../components/ui/LuminousCard';
import { ScalePressable } from '../components/ui/ScalePressable';
import { Skeleton } from '../components/ui/Skeleton';
import { PeachButton } from '../components/ui/PeachButton';
import { CategoryGlyph } from '../components/capture/CategoryGlyph';
import { useSpendingRecap } from '../hooks/useSpendingRecap';
import type {
  SpendingRecapAffirmation,
  SpendingRecapCadence,
  SpendingRecapDirection,
  SpendingRecapHighlight,
  SpendingRecapSeriesPoint,
} from '../data/RecapContracts';
import type { SpendingRecapRouteContract } from '../data/contracts';
import type { HomePeriod } from '../data/HomeContracts';
import { formatCurrency } from '../utils/currency';

const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];
const MASK = '••••';

type RecapOrigin = SpendingRecapRouteContract['origin'];

const ORIGINS: Record<RecapOrigin, { label: string; route: string }> = {
  home: { label: 'Home', route: '/(tabs)' },
  insights: { label: 'Insights', route: '/(tabs)/analytics' },
  profile: { label: 'Profile', route: '/(tabs)/profile' },
  notification: { label: 'Notifications', route: '/notifications' },
};

function parseOrigin(value: string | string[] | undefined): RecapOrigin {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'insights' || raw === 'profile' || raw === 'notification' ? raw : 'home';
}

function parseCadence(value: string | string[] | undefined): SpendingRecapCadence {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'monthly' ? 'monthly' : 'weekly';
}

// One source for the three non-ready read states, so the rendered card and the
// screen-reader announcement can never drift apart (POLISH Section 7).
const EMPTY_STATE_COPY = {
  title: 'Nothing to recap yet',
  message: 'Log a few expenses and your recap will show up here.',
} as const;
const OFFLINE_STATE_COPY = {
  title: 'Could not reach your data',
  message: 'We could not build this recap right now. Try again in a moment.',
} as const;
const FAILURE_STATE_COPY = {
  title: 'Recap unavailable',
  message: 'Something went wrong building this recap.',
} as const;

function formatPeriodLabel(cadence: SpendingRecapCadence, period: HomePeriod): string {
  const start = new Date(period.start);
  if (cadence === 'monthly') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const end = new Date(period.end);
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${startLabel} to ${endLabel}`;
}

function heroHeadline(cadence: SpendingRecapCadence, amount: string, period: HomePeriod): string {
  if (cadence === 'monthly') {
    const month = new Date(period.start).toLocaleDateString(undefined, { month: 'long' });
    return `You spent ${amount} in ${month}.`;
  }
  return `You spent ${amount} this week.`;
}

function deltaLabel(
  highlight: SpendingRecapHighlight,
  currency: string,
  pricesVisible: boolean,
): string {
  const amount = pricesVisible ? formatCurrency(Math.abs(highlight.changeAmount), currency) : MASK;
  if (highlight.direction === 'down') return `${amount} lower than the prior period`;
  if (highlight.direction === 'up') return `${amount} higher than the prior period`;
  if (highlight.direction === 'unchanged') return 'Level with the prior period';
  return 'No earlier period to compare with yet';
}

function affirmationCopy(affirmation: SpendingRecapAffirmation): { headline: string; message: string } {
  if (affirmation.kind === 'streak_days') {
    return {
      headline: `You have logged ${affirmation.value} ${affirmation.value === 1 ? 'day' : 'days'} in a row.`,
      message: 'Consistency like this makes your numbers easier to trust. Keep it going.',
    };
  }
  if (affirmation.kind === 'income_logged') {
    return {
      headline: `You logged ${formatCurrency(affirmation.value, affirmation.currency)} of income this period.`,
      message: 'With income in view, your picture is clearer. Keep it up.',
    };
  }
  return {
    headline: `You tracked ${affirmation.value} ${affirmation.value === 1 ? 'expense' : 'expenses'} this period.`,
    message: 'Every entry makes your picture clearer. Keep tracking at your own pace.',
  };
}

// Direction cue for the period comparison. The icon is a second channel beside the
// colour and the sentence, so a reader with a colour vision difference still gets
// the direction. No icon for `no_previous_data`, because there is no direction.
function DeltaCue({
  direction,
  theme,
}: {
  direction: SpendingRecapDirection;
  theme: ReturnType<typeof useThemeStyles>;
}) {
  if (direction === 'down') return <ArrowDown size={12} color={theme.raw.statusSuccessText} strokeWidth={2.4} />;
  if (direction === 'up') return <ArrowUp size={12} color={theme.raw.warningContainerText} strokeWidth={2.4} />;
  if (direction === 'unchanged') return <Minus size={12} color={theme.raw.onSurfaceVariant} strokeWidth={2.4} />;
  return null;
}

// Capped per-period micro chart (HTML 294-325). Bars come only from the contract
// series; a zero bucket draws no bar rather than a fake stub, and the single
// `isPeak` bucket gets the brand fill and a bold label.
//
// Each column is a real 44pt wide selection target. Seven of them are 308pt, which
// does not fit the 240pt of usable card width at a 320pt viewport, so the row
// scrolls instead of shrinking the targets below the 44pt floor. Selecting a
// column shows that bucket's exact total in the caption below the chart; the
// series carries a label, a value and a peak flag only, so there is no merchant to
// show and none is invented.
const BAR_MAX_HEIGHT = 88;
const BAR_MIN_HEIGHT = 4;
const BAR_TOUCH_TARGET = 44;

function RecapSeriesChart({
  series,
  accessibilityLabel,
  currency,
  pricesVisible,
  selectedIndex,
  onSelect,
}: {
  series: SpendingRecapSeriesPoint[];
  accessibilityLabel: string;
  currency: string;
  pricesVisible: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const ts = useThemeStyles();
  const maxValue = Math.max(...series.map(point => point.value), 0);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chartArea, { borderBottomColor: ts.raw.outline }]}
      contentContainerStyle={styles.chartContent}
      accessibilityLabel={accessibilityLabel}
    >
      {series.map((point, index) => {
        const height = point.value > 0 && maxValue > 0
          ? Math.max(BAR_MIN_HEIGHT, Math.round((point.value / maxValue) * BAR_MAX_HEIGHT))
          : 0;
        const selected = selectedIndex === index;
        return (
          <ScalePressable
            key={point.label}
            haptic={false}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${point.label}, ${pricesVisible ? formatCurrency(point.value, currency) : 'amount hidden'}`}
            accessibilityHint="Shows this bucket's exact total below the chart"
            onPress={() => onSelect(index)}
            style={styles.chartColumn}
          >
            <View
              style={[
                styles.chartBar,
                {
                  height,
                  backgroundColor: point.isPeak ? ts.raw.primary : ts.raw.purple100,
                  // Selection is carried by a border as well as the fill, so it is
                  // never a colour-only state.
                  borderWidth: selected ? 2 : 0,
                  borderColor: ts.raw.onSurface,
                },
              ]}
            />
            <Text
              style={[
                Typography.micro,
                point.isPeak || selected ? styles.chartLabelPeak : null,
                { color: selected || point.isPeak ? ts.raw.primary : ts.raw.onSurfaceVariant },
              ]}
              numberOfLines={1}
            >
              {point.label}
            </Text>
          </ScalePressable>
        );
      })}
    </ScrollView>
  );
}

// Dismiss control pinned to the bottom of the screen. The canonical pair puts the
// only bottom dismiss at the very end of a long scroll, which the audit (Screen 3,
// "Ergonomic Dismiss Bottleneck", line 192) calls out. This footer is a sibling of
// the ScrollView rather than a child, so it stays reachable at every scroll
// position while the header close control above keeps canonical parity.
function RecapDismissFooter({
  originLabel,
  onDismiss,
  theme,
  insets,
}: {
  originLabel: string;
  onDismiss: () => void;
  theme: ReturnType<typeof useThemeStyles>;
  insets: { bottom: number };
}) {
  return (
    <View
      style={[
        styles.footer,
        {
          backgroundColor: theme.bg.screen,
          borderTopColor: theme.raw.outline,
          paddingBottom: insets.bottom + Spacing.s2,
        },
      ]}
    >
      <PeachButton
        title={`Got it, return to ${originLabel}`}
        variant="outline"
        size="xl"
        fullWidth
        onPress={onDismiss}
        labelColor={theme.raw.primary}
        trailingIcon={<Check size={16} color={theme.raw.primary} strokeWidth={2.2} />}
        adjustsLabelFontSize
      />
    </View>
  );
}

// Loading body (POLISH Section 6: no bare spinner where a skeleton fits, and
// Section 10 lists this screen's ActivityIndicator as a gap). It mirrors only
// the sections that render on every ready load: the hero narrative card, the
// affirming gradient block and the pinned dismiss footer, sharing the loaded
// screen's `scrollContent` wrap so the placeholder cannot drift from the layout it
// replaces. The category and chart cards are conditional on the snapshot (they
// hide when the period has no category or fewer than two populated buckets), so
// reserving space for them would shift content the other way on those loads; that
// matches the accepted Home skeleton convention in POLISH Section 13.
// Every block height is the token line height of the real content it stands in
// for, and decorative blocks stay hidden from assistive tech while the container
// exposes one busy label, matching the Home/Profile skeleton convention.
function RecapSkeleton() {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  // White at 15%, the existing hero glass convention from the Home skeleton, so
  // placeholder blocks read as glass over the gradient instead of flat grey.
  const onGradient = { backgroundColor: `${Colors.white}26` };

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your recap"
      accessibilityState={{ busy: true }}
      style={[styles.root, { backgroundColor: ts.bg.screen }]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.s7 + insets.bottom }]}
      >
        {/* Hero narrative card */}
        <LuminousCard variant="high" style={styles.heroCard}>
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowLeft}>
              <Skeleton width={13} height={13} />
              <Skeleton width={112} height={13} />
            </View>
            <Skeleton width={56} height={13} />
          </View>
          <Skeleton width="78%" height={26} />
          <Skeleton width="96%" height={20} style={{ marginTop: Spacing.s2 }} />
          <Skeleton width="64%" height={20} />
          <View style={[styles.kpiRow, { borderTopColor: ts.raw.outline }]}>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
              <Skeleton width="70%" height={13} />
              <Skeleton width="82%" height={20} style={styles.kpiValue} />
              <Skeleton width="58%" height={13} />
            </View>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
              <Skeleton width="70%" height={13} />
              <Skeleton width="82%" height={20} style={styles.kpiValue} />
              <Skeleton width="58%" height={13} />
            </View>
          </View>
        </LuminousCard>

        {/* Affirming, forward-looking close */}
        <LinearGradient
          colors={ts.isDark ? Gradients.dark : Gradients.light}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={styles.affirmCard}
        >
          <View style={styles.affirmRow}>
            <Skeleton width={40} height={40} borderRadius={Radii.md} style={onGradient} />
            <View style={styles.affirmText}>
              <Skeleton width={96} height={13} style={onGradient} />
              <Skeleton width="92%" height={22} style={[onGradient, { marginTop: Spacing.s1 }]} />
              <Skeleton width="70%" height={20} style={[onGradient, { marginTop: Spacing.s1 }]} />
            </View>
          </View>
        </LinearGradient>
      </ScrollView>

      {/* Pinned dismiss footer placeholder, same geometry as the real footer. */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: ts.bg.screen,
            borderTopColor: ts.raw.outline,
            paddingBottom: insets.bottom + Spacing.s2,
          },
        ]}
      >
        <Skeleton width="100%" height={52} borderRadius={Radii.full} />
      </View>
    </View>
  );
}

export default function SpendingRecapScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { settings, currency: settingsCurrency } = useSettings();
  const params = useLocalSearchParams<{ origin?: string; cadence?: string }>();

  const origin = parseOrigin(params.origin);
  const cadence = parseCadence(params.cadence);
  const originInfo = ORIGINS[origin];

  // Selection haptics follow the app's existing selection convention (the
  // onboarding dots and currency pills both call selectionAsync), so a bucket pick
  // feels like a pick rather than a button press.
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const selectBar = useCallback((index: number) => {
    void Haptics.selectionAsync();
    setSelectedBar(current => (current === index ? null : index));
  }, []);

  const { read, categoryMeta, loading, refreshing, retry } = useSpendingRecap(cadence);

  const pricesVisible = settings.prices_visible !== 'false';
  const snapshot = read?.state === 'ready' ? read.snapshot : null;
  const currency = snapshot?.currency ?? settingsCurrency;

  // The dismiss is a read-only return: back when a stack exists, otherwise an
  // explicit origin replace for a direct notification/foreign arrival.
  const dismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(originInfo.route as never);
  }, [router, originInfo.route]);

  const view = useMemo(() => {
    if (!snapshot) return null;
    const category = snapshot.biggestCategory;
    const meta = category ? categoryMeta[category.category] : undefined;
    const categoryTitle = meta?.title ?? category?.category ?? '';
    const tint = category
      ? CategoryTints[category.category as keyof typeof CategoryTints] ?? CategoryTints.other
      : CategoryTints.other;
    const tintPair = ts.isDark ? tint.dark : tint.light;
    const sharePct = category ? Math.max(0, Math.min(100, Math.round(category.share * 100))) : 0;
    const peak = snapshot.series.find(point => point.isPeak) ?? null;
    const peakCaption = peak
      ? (cadence === 'monthly' ? `Peak in ${peak.label}` : `Peak on ${peak.label}`)
      : null;
    // Screen-reader summary for the micro chart, since the bar values are drawn
    // shapes rather than text. The amount is omitted when prices are hidden.
    const chartAccessibilityLabel = peak
      ? `Bar chart of spending for this period. Peak ${peak.label}${
          pricesVisible ? ` at ${formatCurrency(peak.value, currency)}` : ''
        }.`
      : '';

    const spentText = pricesVisible ? formatCurrency(snapshot.totalSpent, currency) : MASK;
    const earnedText = pricesVisible ? formatCurrency(snapshot.totalEarned, currency) : MASK;
    const hasPriorPeriod = snapshot.comparativeHighlight.direction !== 'no_previous_data';
    const priorText = hasPriorPeriod
      ? pricesVisible
        ? formatCurrency(snapshot.comparativeHighlight.previousTotal, currency)
        : MASK
      : 'Not tracked';
    const categoryAmount = category
      ? pricesVisible
        ? formatCurrency(category.total, currency)
        : MASK
      : MASK;

    const contextParts: string[] = [];
    if (category) contextParts.push(`Most went to ${categoryTitle}.`);
    contextParts.push(snapshot.comparativeHighlight.text);

    return {
      categoryTitle,
      tintPair,
      sharePct,
      series: snapshot.series,
      peakCaption,
      chartAccessibilityLabel,
      spentText,
      earnedText,
      priorText,
      hasPriorPeriod,
      direction: snapshot.comparativeHighlight.direction,
      categoryAmount,
      categoryTransactions: category
        ? `${category.transactionCount} ${category.transactionCount === 1 ? 'transaction' : 'transactions'}`
        : '',
      contextText: contextParts.join(' '),
      headlineText: heroHeadline(cadence, spentText, snapshot.period),
      deltaText: deltaLabel(snapshot.comparativeHighlight, currency, pricesVisible),
      inflowSub: snapshot.totalEarned > 0 ? 'Income recorded' : 'No inflow logged',
      affirmation: affirmationCopy(snapshot.affirmation),
      periodLabel: formatPeriodLabel(cadence, snapshot.period),
    };
  }, [snapshot, categoryMeta, cadence, currency, pricesVisible, ts.isDark]);

  // A spending increase is a caution, not a brand accent (audit Screen 3 line 191:
  // the up direction used the primary purple, which reads as a reward). The warning
  // container text token is the designed text-on-warning tone in both modes, so the
  // sentence keeps its contrast; the icon and the word carry the meaning too.
  const deltaColor = useMemo(() => {
    const direction = snapshot?.comparativeHighlight.direction;
    if (direction === 'down') return ts.raw.statusSuccessText;
    if (direction === 'up') return ts.raw.warningContainerText;
    return ts.raw.onSurfaceVariant;
  }, [snapshot, ts.raw.statusSuccessText, ts.raw.warningContainerText, ts.raw.onSurfaceVariant]);

  // POLISH Section 7: the recap read is async, so a resolved offline or failure
  // state is spoken, not only rendered. iOS has no live region, so it speaks
  // through announceForAccessibility; Android reads the polite live region on
  // the state card title rendered below. The `refreshing` guard makes a retry
  // re-announce its outcome and skips the stale error while the retry is still
  // in flight. 'empty' is a normal resting state, not a failure, so it is
  // announced only through that live region.
  const readState = read?.state ?? null;
  useEffect(() => {
    if (Platform.OS !== 'ios' || refreshing) return;
    if (readState === 'offline') {
      AccessibilityInfo.announceForAccessibility(OFFLINE_STATE_COPY.title);
    } else if (readState === 'failure') {
      AccessibilityInfo.announceForAccessibility(FAILURE_STATE_COPY.title);
    }
  }, [readState, refreshing]);

  const periodLabel = view?.periodLabel ?? null;
  const selectedPoint = view && selectedBar !== null ? view.series[selectedBar] ?? null : null;
  // Selection shows the bucket's exact total. With nothing selected the caption
  // keeps the canonical peak line and names the interaction, so the bars are
  // discoverable as controls rather than only as artwork.
  const chartCaption = selectedPoint
    ? `${selectedPoint.label}: ${pricesVisible ? formatCurrency(selectedPoint.value, currency) : MASK}`
    : view?.peakCaption
      ? `${view.peakCaption} • Tap a bar for its total`
      : '';

  const header = (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + Spacing.s2,
          borderBottomColor: ts.raw.outline,
          backgroundColor: ts.bg.screen,
        },
      ]}
    >
      <View style={styles.headerInner}>
        <View style={styles.headerLeft}>
          <View style={[styles.cadencePill, { backgroundColor: ts.raw.purple100 }]}>
            <View style={[styles.cadenceDot, { backgroundColor: ts.raw.primary }]} />
            <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.primary }]} numberOfLines={1}>
              {cadence === 'monthly' ? 'Monthly Recap' : 'Weekly Recap'}
            </Text>
          </View>
          {periodLabel ? (
            <Text style={[Typography.micro, styles.flexShrink, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
              {periodLabel}
            </Text>
          ) : null}
        </View>
        <ScalePressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss Spending Recap"
          onPress={dismiss}
          style={[styles.closeButton, { backgroundColor: ts.raw.surfaceContainerHighest }]}
        >
          <X size={20} color={ts.raw.onSurfaceVariant} strokeWidth={2.2} />
        </ScalePressable>
      </View>
    </View>
  );

  if (loading && !read) {
    return (
      <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
        {header}
        <RecapSkeleton />
      </View>
    );
  }

  if (!snapshot || !view) {
    const stateCopy = readState === 'empty'
      ? EMPTY_STATE_COPY
      : readState === 'offline'
        ? OFFLINE_STATE_COPY
        : FAILURE_STATE_COPY;
    const showRetry = readState === 'offline' || readState === 'failure';
    return (
      <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
        {header}
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing.s7 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <LuminousCard variant="high" style={styles.stateCard}>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
            >
              {stateCopy.title}
            </Text>
            <Text style={[Typography.bodyRegular, styles.stateMessage, { color: ts.raw.onSurfaceVariant }]}>
              {stateCopy.message}
            </Text>
            <View style={styles.stateActions}>
              {showRetry ? (
                <PeachButton title="Try again" variant="secondary" size="md" onPress={retry} isLoading={refreshing} />
              ) : null}
              <PeachButton
                title={`Got it, return to ${originInfo.label}`}
                variant="outline"
                size="xl"
                fullWidth
                onPress={dismiss}
                labelColor={ts.raw.primary}
                trailingIcon={<Check size={16} color={ts.raw.primary} strokeWidth={2.2} />}
                adjustsLabelFontSize
              />
            </View>
          </LuminousCard>
        </ScrollView>
      </View>
    );
  }

  const normalizationNote = !snapshot.normalization.complete
    ? `Some amounts in ${snapshot.normalization.missingRates.join(', ')} were not converted.`
    : null;

  return (
    <View style={[styles.root, { backgroundColor: ts.bg.screen }]}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.s7 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={ts.raw.primary} colors={[ts.raw.primary]} />
        }
      >
        {/* 1. Hero narrative card (FR-23.3) */}
        <LuminousCard variant="high" style={styles.heroCard}>
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={[styles.heroGlow, { backgroundColor: ts.raw.primaryContainer }]}
          />
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowLeft}>
              <Star size={13} color={ts.raw.primary} fill={ts.raw.primary} />
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.primary }]} numberOfLines={1}>
                Recap Story Highlight
              </Text>
            </View>
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
              {cadence === 'monthly' ? '30-Day Cycle' : '7-Day Flow'}
            </Text>
          </View>

          <Text accessibilityRole="header" style={[styles.heroHeadline, { color: ts.raw.onSurface }]}>
            {view.headlineText}
          </Text>
          <Text style={[Typography.bodyRegular, styles.heroContext, { color: ts.raw.onSurfaceVariant }]}>
            {view.contextText}
          </Text>

          {/* Period-over-period comparison, side by side (task B1-3 bullet 1).
              Both figures are real contract totals in real currency. When the
              contract says there is no earlier period, the cell states that instead
              of rendering a zero the user would read as a real comparison. */}
          <View style={[styles.kpiRow, { borderTopColor: ts.raw.outline }]}>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                This period
              </Text>
              <Text
                style={[Typography.labelBold, styles.kpiValue, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {view.spentText}
              </Text>
            </View>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                Prior period
              </Text>
              <Text
                style={[
                  view.hasPriorPeriod ? Typography.labelBold : Typography.micro,
                  styles.kpiValue,
                  { color: view.hasPriorPeriod ? ts.raw.onSurface : ts.raw.onSurfaceVariant },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {view.priorText}
              </Text>
            </View>
          </View>

          {/* The difference, with an icon and a word so the direction is never
              carried by colour alone (audit Screen 3 line 191, and Rule 37). */}
          <View style={styles.deltaRow}>
            <DeltaCue direction={view.direction} theme={ts} />
            <Text style={[Typography.micro, styles.deltaText, { color: deltaColor }]} numberOfLines={2}>
              {view.deltaText}
            </Text>
          </View>

          <View style={[styles.kpiPill, styles.inflowPill, { backgroundColor: ts.bg.low }]}>
            <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
              Total Inflow
            </Text>
            <Text
              style={[Typography.labelBold, styles.kpiValue, { color: ts.raw.onSurface }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {view.earnedText}
            </Text>
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
              {view.inflowSub}
            </Text>
          </View>

          {normalizationNote ? (
            <Text style={[Typography.micro, styles.note, { color: ts.raw.warningContainerText }]}>{normalizationNote}</Text>
          ) : null}
        </LuminousCard>

        {/* 2. Biggest category spotlight */}
        {view.categoryTitle ? (
          <LuminousCard variant="high" style={styles.categoryCard}>
            <View style={styles.categoryHeader}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                Top Spending Category
              </Text>
              <View style={[styles.shareBadge, { backgroundColor: ts.raw.purple100 }]}>
                <Text style={[Typography.micro, { color: ts.raw.primary }]}>{view.sharePct}% of total</Text>
              </View>
            </View>

            <View style={styles.categoryRow}>
              <View style={[styles.categoryChip, { backgroundColor: view.tintPair[0] }]}>
                <CategoryGlyph
                  iconName={categoryMeta[snapshot.biggestCategory?.category ?? '']?.iconName}
                  size={22}
                  color={view.tintPair[1]}
                />
              </View>
              <View style={styles.categoryText}>
                <View style={styles.categoryTitleRow}>
                  <Text style={[Typography.labelBold, styles.flexShrink, { color: ts.raw.onSurface }]} numberOfLines={1}>
                    {view.categoryTitle}
                  </Text>
                  <Text
                    style={[Typography.labelBold, { color: ts.raw.onSurface }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {view.categoryAmount}
                  </Text>
                </View>
                <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                  {view.categoryTransactions}
                </Text>
              </View>
            </View>

            <View style={[styles.shareTrack, { backgroundColor: ts.bg.elevated }]}>
              <View style={[styles.shareFill, { width: `${view.sharePct}%`, backgroundColor: view.tintPair[1] }]} />
            </View>
            <Text style={[Typography.micro, styles.note, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
              {view.categoryTitle} {view.sharePct}%
            </Text>
          </LuminousCard>
        ) : null}

        {/* 3. Capped per-period micro chart, below the narrative (chart-absent when empty) */}
        {view.series.length > 0 ? (
          <LuminousCard variant="high" style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View style={styles.eyebrowLeft}>
                <BarChart3 size={16} color={ts.raw.primary} />
                <Text style={[Typography.captionBold, { color: ts.raw.onSurface }]} numberOfLines={1}>
                  {cadence === 'monthly' ? 'Week-by-Week Cadence' : 'Day-by-Day Cadence'}
                </Text>
              </View>
              <Text style={[Typography.micro, styles.flexShrink, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                Capped Recap View
              </Text>
            </View>
            <RecapSeriesChart
              series={view.series}
              accessibilityLabel={view.chartAccessibilityLabel}
              currency={currency}
              pricesVisible={pricesVisible}
              selectedIndex={selectedBar}
              onSelect={selectBar}
            />
            {chartCaption ? (
              <Text style={[Typography.micro, styles.chartCaption, { color: ts.raw.onSurfaceVariant }]} numberOfLines={2}>
                {chartCaption}
              </Text>
            ) : null}
          </LuminousCard>
        ) : null}

        {/* 4. Affirming, forward-looking close (FR-23.4) */}
        <LinearGradient
          colors={ts.isDark ? Gradients.dark : Gradients.light}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={styles.affirmCard}
        >
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={styles.affirmGlow}
          />
          <View style={styles.affirmRow}>
            <View style={styles.affirmIcon}>
              <Sparkles size={18} color="#FFFFFF" />
            </View>
            <View style={styles.affirmText}>
              <Text style={[Typography.micro, styles.uppercase, styles.affirmEyebrow]}>Looking Ahead</Text>
              <Text style={[Typography.headlineMd, styles.affirmHeadline]}>{view.affirmation.headline}</Text>
              <Text style={[Typography.bodyRegular, styles.affirmMessage]}>{view.affirmation.message}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* 5. Dismiss moved out of the scroll: see the pinned footer below. */}
      </ScrollView>

      <RecapDismissFooter
        originLabel={originInfo.label}
        onDismiss={dismiss}
        theme={ts}
        insets={insets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s2,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flex: 1,
    minWidth: 0,
  },
  cadencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
  },
  cadenceDot: {
    width: 6,
    height: 6,
    borderRadius: Radii.full,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexShrink: {
    flexShrink: 1,
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  scrollContent: {
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s4,
    gap: Spacing.s4,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  stateCard: {
    gap: Spacing.s2,
  },
  stateMessage: {
    marginTop: Spacing.s1,
  },
  stateActions: {
    marginTop: Spacing.s3,
    gap: Spacing.s3,
  },
  heroCard: {
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    opacity: 0.18,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    marginBottom: Spacing.s3,
  },
  eyebrowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    flexShrink: 1,
    minWidth: 0,
  },
  heroHeadline: {
    ...Typography.headlineSm,
    letterSpacing: -0.3,
  },
  heroContext: {
    marginTop: Spacing.s2,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: Spacing.s3,
    marginTop: Spacing.s4,
    paddingTop: Spacing.s4,
    borderTopWidth: 1,
  },
  kpiPill: {
    flex: 1,
    minWidth: 0,
    borderRadius: Radii.md,
    padding: Spacing.s3,
  },
  kpiValue: {
    marginTop: Spacing.s1,
  },
  note: {
    marginTop: Spacing.s2,
  },
  categoryCard: {
    gap: Spacing.s2,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  shareBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    marginTop: Spacing.s1,
  },
  categoryChip: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: {
    flex: 1,
    minWidth: 0,
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  shareTrack: {
    height: 8,
    borderRadius: Radii.full,
    overflow: 'hidden',
    marginTop: Spacing.s3,
  },
  shareFill: {
    height: '100%',
    borderRadius: Radii.full,
  },
  chartCard: {
    gap: Spacing.s3,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  chartArea: {
    height: 124,
    borderBottomWidth: 1,
  },
  chartContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.s1,
    minWidth: '100%',
    paddingHorizontal: Spacing.s1,
  },
  // 44pt wide selection target per bucket. Seven of them are 308pt, which is why
  // the chart scrolls horizontally on a narrow viewport instead of shrinking the
  // target below the floor.
  chartColumn: {
    width: BAR_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: Spacing.s2,
  },
  chartBar: {
    width: '100%',
    maxWidth: 24,
    borderTopLeftRadius: Radii.sm,
    borderTopRightRadius: Radii.sm,
  },
  chartLabelPeak: {
    fontFamily: 'Manrope_700Bold',
  },
  chartCaption: {
    marginTop: Spacing.s2,
    textAlign: 'center',
  },
  affirmCard: {
    position: 'relative',
    borderRadius: Radii.lg,
    padding: Spacing.s5,
    overflow: 'hidden',
  },
  affirmGlow: {
    position: 'absolute',
    right: -24,
    bottom: -24,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  affirmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
  },
  affirmIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  affirmText: {
    flex: 1,
    minWidth: 0,
  },
  affirmEyebrow: {
    color: 'rgba(255,255,255,0.72)',
  },
  affirmHeadline: {
    color: '#FFFFFF',
    marginTop: Spacing.s1,
  },
  affirmMessage: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: Spacing.s1,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    marginTop: Spacing.s2,
  },
  deltaText: {
    flexShrink: 1,
  },
  // Total Inflow keeps the canonical pill anatomy but sits on its own row, because
  // the two-cell comparison above now owns the pair slot.
  inflowPill: {
    marginTop: Spacing.s3,
  },
  footer: {
    borderTopWidth: 1,
    paddingTop: Spacing.s2,
    paddingHorizontal: Spacing.s5,
  },
});
