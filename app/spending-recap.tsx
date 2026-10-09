import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BarChart3, Check, Sparkles, Star, X } from 'lucide-react-native';

import { CategoryTints, Gradients, Radii, Spacing, Typography } from '../constants/tokens';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useSettings } from '../components/ui/SettingsProvider';
import { LuminousCard } from '../components/ui/LuminousCard';
import { ScalePressable } from '../components/ui/ScalePressable';
import { PeachButton } from '../components/ui/PeachButton';
import { CategoryGlyph } from '../components/capture/CategoryGlyph';
import { useSpendingRecap } from '../hooks/useSpendingRecap';
import type {
  SpendingRecapAffirmation,
  SpendingRecapCadence,
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
  if (highlight.direction === 'down') return `${amount} lower`;
  if (highlight.direction === 'up') return `${amount} higher`;
  if (highlight.direction === 'unchanged') return 'Level with last period';
  return 'First period tracked';
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

// Capped per-period micro chart (HTML 294-325). Bars come only from the contract
// series; a zero bucket draws no bar rather than a fake stub, and the single
// `isPeak` bucket gets the brand fill and a bold label.
const BAR_MAX_HEIGHT = 88;
const BAR_MIN_HEIGHT = 4;

function RecapSeriesChart({
  series,
  accessibilityLabel,
}: {
  series: SpendingRecapSeriesPoint[];
  accessibilityLabel: string;
}) {
  const ts = useThemeStyles();
  const maxValue = Math.max(...series.map(point => point.value), 0);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.chartArea, { borderBottomColor: ts.raw.outline }]}
    >
      {series.map(point => {
        const height = point.value > 0 && maxValue > 0
          ? Math.max(BAR_MIN_HEIGHT, Math.round((point.value / maxValue) * BAR_MAX_HEIGHT))
          : 0;
        return (
          <View key={point.label} style={styles.chartColumn}>
            <View
              style={[
                styles.chartBar,
                {
                  height,
                  backgroundColor: point.isPeak ? ts.raw.primary : ts.raw.purple100,
                },
              ]}
            />
            <Text
              style={[
                Typography.micro,
                point.isPeak ? styles.chartLabelPeak : null,
                { color: point.isPeak ? ts.raw.primary : ts.raw.onSurfaceVariant },
              ]}
              numberOfLines={1}
            >
              {point.label}
            </Text>
          </View>
        );
      })}
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

  const deltaColor = useMemo(() => {
    const direction = snapshot?.comparativeHighlight.direction;
    if (direction === 'down') return ts.raw.statusSuccessText;
    if (direction === 'up') return ts.raw.primary;
    return ts.raw.onSurfaceVariant;
  }, [snapshot, ts.raw.statusSuccessText, ts.raw.primary, ts.raw.onSurfaceVariant]);

  const periodLabel = view?.periodLabel ?? null;

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
        <View style={styles.loading}>
          <ActivityIndicator color={ts.raw.primary} />
        </View>
      </View>
    );
  }

  if (!snapshot || !view) {
    const stateCopy = read?.state === 'empty'
      ? {
          title: 'Nothing to recap yet',
          message: 'Log a few expenses and your recap will show up here.',
        }
      : read?.state === 'offline'
        ? {
            title: 'Could not reach your data',
            message: 'We could not build this recap right now. Try again in a moment.',
          }
        : {
            title: 'Recap unavailable',
            message: 'Something went wrong building this recap.',
          };
    const showRetry = read?.state === 'offline' || read?.state === 'failure';
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
            <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
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

          <View style={[styles.kpiRow, { borderTopColor: ts.raw.outline }]}>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
              <Text style={[Typography.micro, styles.uppercase, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                Total Outflow
              </Text>
              <Text
                style={[Typography.labelBold, styles.kpiValue, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {view.spentText}
              </Text>
              <Text style={[Typography.micro, { color: deltaColor }]} numberOfLines={1}>
                {view.deltaText}
              </Text>
            </View>
            <View style={[styles.kpiPill, { backgroundColor: ts.bg.low }]}>
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
            <RecapSeriesChart series={view.series} accessibilityLabel={view.chartAccessibilityLabel} />
            {view.peakCaption ? (
              <Text style={[Typography.micro, styles.chartCaption, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                {view.peakCaption}
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

        {/* 5. Single immediate dismiss (FR-23.5) */}
        <View style={styles.dismissWrap}>
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
          <Text style={[Typography.micro, styles.dismissHint, { color: ts.raw.onSurfaceVariant }]}>
            Dismiss returns directly to the previous screen without saving state changes.
          </Text>
        </View>
      </ScrollView>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.s2,
    height: 112,
    paddingTop: Spacing.s2,
    paddingHorizontal: Spacing.s1,
    borderBottomWidth: 1,
  },
  chartColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
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
  dismissWrap: {
    marginTop: Spacing.s1,
  },
  dismissHint: {
    marginTop: Spacing.s2,
    textAlign: 'center',
  },
});
