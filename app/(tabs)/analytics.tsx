import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  RotateCcw,
  Search,
  Sparkles,
  X,
  Zap,
} from 'lucide-react-native';

import { Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { PeachButton } from '../../components/ui/PeachButton';
import { SearchFilterBar } from '../../components/ui/SearchFilterBar';
import { DateRangePicker } from '../../components/ui/DateRangePicker';
import { SpendingDonut } from '../../components/analytics/SpendingDonut';
import { CategoryBreakdown } from '../../components/analytics/CategoryBreakdown';
import { ExpenseItem } from '../../components/expense/ExpenseItem';
import { INSIGHT_SORT_OPTIONS, useInsights, type InsightSortKey } from '../../hooks/useInsights';
import type { InsightTimeframe } from '../../data/InsightContracts';
import type { Expense } from '../../types/database';
import { formatCurrency, getCurrencyPrefix } from '../../utils/currency';

const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];
const DONUT_SIZE = 112;

const TIMEFRAMES: { key: InsightTimeframe; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];

interface PeriodLike {
  start: number;
  end: number;
}

function formatPeriod(period: PeriodLike): string {
  const start = new Date(period.start);
  const end = new Date(period.end);
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} to ${endLabel}`;
}

function digestTitle(timeframe: InsightTimeframe, period: PeriodLike): string {
  const month = new Date(period.start).toLocaleDateString(undefined, { month: 'long' });
  if (timeframe === 'week') return `${month} Weekly Digest`;
  if (timeframe === 'month') return `${month} Digest`;
  if (timeframe === 'all') return 'All-time Digest';
  return 'Custom Range Digest';
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { settings, currency: settingsCurrency } = useSettings();
  const params = useLocalSearchParams<{ category?: string }>();

  const {
    snapshot,
    expenses,
    categoryMeta,
    digest,
    query,
    loading,
    refreshing,
    error,
    isOffline,
    setTimeframe,
    retry,
    dismissDigest,
    retryDigest,
  } = useInsights();

  // Category-tap arrival from Home pre-filters the list. The active filter is
  // surfaced in the badge below so the reason for the shortened list is visible.
  // The route param is treated as the initial filter; a manual legend selection
  // overrides it, and clearing records the dismissed param so a later arrival
  // with a new category still applies.
  const paramCategory = typeof params.category === 'string' && params.category.length > 0 ? params.category : null;
  const [manualFilter, setManualFilter] = useState<string | null>(null);
  const [dismissedParam, setDismissedParam] = useState<string | null>(null);
  const categoryFilter = manualFilter ?? (paramCategory && paramCategory !== dismissedParam ? paramCategory : null);

  const applyCategoryFilter = useCallback((next: string | null) => {
    setManualFilter(next);
    if (next === null) setDismissedParam(paramCategory);
  }, [paramCategory]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<InsightSortKey>('newest');
  const [sortVisible, setSortVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const pricesVisible = settings.prices_visible !== 'false';
  const currency = snapshot?.currency ?? settingsCurrency;
  const currencySymbol = getCurrencyPrefix(currency);
  const activeSort = INSIGHT_SORT_OPTIONS.find(option => option.key === sortKey) ?? INSIGHT_SORT_OPTIONS[0];

  const periodExpenses = useMemo(() => {
    if (!snapshot) return [];
    return expenses.filter(expense => expense.date >= snapshot.period.start && expense.date <= snapshot.period.end);
  }, [expenses, snapshot]);

  const visibleExpenses = useMemo(() => {
    let list = periodExpenses;
    if (categoryFilter) {
      list = list.filter(expense => expense.category === categoryFilter);
    }
    const rawQuery = searchQuery.trim().toLowerCase();
    if (rawQuery) {
      list = list.filter(expense => {
        const title = (categoryMeta[expense.category]?.title ?? expense.category).toLowerCase();
        return (
          expense.merchant.toLowerCase().includes(rawQuery) ||
          (expense.note?.toLowerCase().includes(rawQuery) ?? false) ||
          title.includes(rawQuery) ||
          expense.category.toLowerCase().includes(rawQuery)
        );
      });
    }
    const sorted = [...list];
    sorted.sort((a: Expense, b: Expense) => {
      switch (sortKey) {
        case 'oldest': return a.date - b.date;
        case 'az': return a.merchant.localeCompare(b.merchant);
        case 'za': return b.merchant.localeCompare(a.merchant);
        case 'cheapest': return a.amount - b.amount;
        case 'expensive': return b.amount - a.amount;
        case 'newest':
        default: return b.date - a.date;
      }
    });
    return sorted;
  }, [periodExpenses, categoryFilter, searchQuery, sortKey, categoryMeta]);

  const distribution = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.categories.map(category => ({
      name: category.category,
      label: categoryMeta[category.category]?.title ?? category.category,
      amount: category.total,
      percentage: category.share * 100,
      color: categoryMeta[category.category]?.color ?? Colors.primary,
    }));
  }, [snapshot, categoryMeta]);

  const topCategory = distribution[0];
  const activeCategoryLabel = categoryFilter
    ? categoryMeta[categoryFilter]?.title ?? categoryFilter
    : null;

  const onSelectTimeframe = useCallback((timeframe: InsightTimeframe) => {
    if (timeframe === 'custom') {
      setDatePickerVisible(true);
      return;
    }
    setTimeframe(timeframe);
  }, [setTimeframe]);

  const onApplyCustomRange = useCallback((start: Date, end: Date) => {
    setDatePickerVisible(false);
    setTimeframe('custom', start.getTime(), end.getTime());
  }, [setTimeframe]);

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setManualFilter(null);
    setDismissedParam(paramCategory);
  }, [paramCategory]);

  const openRecap = useCallback(() => {
    router.push({ pathname: '/spending-recap', params: { origin: 'insights' } } as never);
  }, [router]);

  if (loading && !snapshot) {
    return (
      <View style={[styles.loading, { backgroundColor: ts.bg.screen, paddingTop: insets.top }]}>
        <ActivityIndicator color={ts.raw.primary} />
      </View>
    );
  }

  const insight = snapshot?.insight;
  const narrativeText = insight?.narrativeText ?? null;
  const narrativeUnavailable = snapshot?.state === 'offline' || snapshot?.state === 'failure';
  const direction = insight?.direction;
  const changePercent = insight?.changePercent ?? null;
  const showDeltaBadge = direction === 'up' || direction === 'down';
  const deltaPositive = direction === 'down';

  return (
    <View style={{ flex: 1, backgroundColor: ts.bg.screen }}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + Spacing.s1, borderBottomColor: ts.raw.outline, backgroundColor: ts.bg.screen },
        ]}
      >
        <View style={styles.headerInner}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerEyebrow, { color: ts.raw.primary }]}>PeachSpend</Text>
            <Text accessibilityRole="header" style={[styles.headerTitle, { color: ts.raw.onSurface }]}>Insights</Text>
          </View>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Open Spending Recap"
            onPress={openRecap}
            style={styles.recapButton}
          >
            <LinearGradient
              colors={ts.isDark ? Gradients.dark : Gradients.light}
              locations={GRADIENT_LOCATIONS}
              start={GRADIENT_START}
              end={GRADIENT_END}
              style={StyleSheet.absoluteFill}
            />
            <Zap size={14} color={Colors.white} />
            <Text style={styles.recapLabel} numberOfLines={1}>Spending Recap</Text>
          </ScalePressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: Spacing.s5,
          paddingTop: Spacing.s3,
          paddingBottom: 100 + insets.bottom,
          alignSelf: 'center',
          width: '100%',
          maxWidth: 640,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={ts.raw.primary} colors={[ts.raw.primary]} />
        }
      >
        {/* Timeframe selector (FR-03.5) */}
        <View style={[styles.timeframeBar, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
          {TIMEFRAMES.map(timeframe => {
            const active = query.timeframe === timeframe.key;
            return (
              <ScalePressable
                key={timeframe.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${timeframe.label} timeframe`}
                onPress={() => onSelectTimeframe(timeframe.key)}
                style={[styles.timeframeSegment, active ? { backgroundColor: ts.raw.primary } : null]}
              >
                <View style={styles.timeframeInner}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.timeframeLabel,
                      { color: active ? Colors.white : ts.raw.onSurfaceVariant },
                      active ? styles.timeframeLabelActive : null,
                    ]}
                  >
                    {timeframe.label}
                  </Text>
                  {timeframe.key === 'custom' ? (
                    <Calendar size={12} color={active ? Colors.white : ts.raw.onSurfaceVariant} />
                  ) : null}
                </View>
              </ScalePressable>
            );
          })}
        </View>

        {/* Active filter indicator (FR-03.7) */}
        {activeCategoryLabel ? (
          <View style={[styles.filterBadge, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primaryBorder + '44' }]}>
            <View style={styles.filterBadgeLeft}>
              <View style={[styles.filterDot, { backgroundColor: ts.raw.primary }]} />
              <Text style={[styles.filterText, { color: ts.raw.primary }]} numberOfLines={1}>
                Filter: {activeCategoryLabel}
              </Text>
            </View>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Clear category filter"
              onPress={() => applyCategoryFilter(null)}
              hitSlop={10}
              style={styles.filterClear}
            >
              <Text style={[styles.filterClearText, { color: ts.raw.primary }]}>Clear</Text>
              <X size={12} color={ts.raw.primary} />
            </ScalePressable>
          </View>
        ) : null}

        {/* Narrative comparative statement (FR-03.1), always above the charts */}
        <LinearGradient
          colors={ts.isDark ? Gradients.dark : Gradients.light}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={styles.narrative}
        >
          <View pointerEvents="none" style={styles.narrativeBlob} />
          <View style={styles.narrativeHeader}>
            <Text style={styles.narrativeEyebrow}>Period Comparison</Text>
            {showDeltaBadge && changePercent !== null ? (
              <View style={[styles.deltaBadge, deltaPositive ? styles.deltaBadgeGood : styles.deltaBadgeUp]}>
                {deltaPositive ? <ArrowDown size={12} color="#6EE7B7" /> : <ArrowUp size={12} color="#FCD34D" />}
                <Text style={[styles.deltaBadgeText, { color: deltaPositive ? '#6EE7B7' : '#FCD34D' }]}>
                  {deltaPositive ? `${Math.abs(changePercent).toFixed(0)}% Less` : `+${changePercent.toFixed(0)}% More`}
                </Text>
              </View>
            ) : null}
          </View>
          {narrativeUnavailable || !narrativeText ? (
            <Text style={styles.narrativeHeadline}>
              {snapshot?.state === 'offline'
                ? 'Insights are unavailable offline. Your saved data stays on this device.'
                : 'Could not load this period. Pull to refresh and try again.'}
            </Text>
          ) : (
            <>
              <Text style={styles.narrativeHeadline}>{narrativeText}</Text>
              <Text style={styles.narrativeDetail}>
                {topCategory
                  ? `Largest category: ${topCategory.label} at ${pricesVisible ? formatCurrency(topCategory.amount, currency) : '••••'}.`
                  : `${snapshot?.transactionCount ?? 0} transactions tracked in this period.`}
              </Text>
            </>
          )}
          <View style={styles.narrativeFooter}>
            <Text style={styles.narrativeTotalLabel}>
              Total Spent:{' '}
              <Text style={styles.narrativeTotalAmount}>
                {pricesVisible ? formatCurrency(snapshot?.totalSpent ?? 0, currency) : '••••'}
              </Text>
            </Text>
            {snapshot ? <Text style={styles.narrativePeriod}>{formatPeriod(snapshot.period)}</Text> : null}
          </View>
        </LinearGradient>

        {/* Digest relocated from Home (FR-03.2) */}
        {digest && digest.status !== 'dismissed' ? (
          <LuminousCard style={[styles.card, { borderColor: ts.raw.outline }]}>
            <View style={styles.digestHeader}>
              <View style={styles.digestIdentity}>
                <View style={[styles.digestIcon, { backgroundColor: ts.raw.purple100 }]}>
                  <Sparkles size={16} color={ts.raw.primary} />
                </View>
                <View style={{ flexShrink: 1, minWidth: 0 }}>
                  <Text style={[styles.digestTitle, { color: ts.raw.onSurface }]} numberOfLines={1}>
                    {snapshot ? digestTitle(query.timeframe, snapshot.period) : 'Digest'}
                  </Text>
                  <Text style={[styles.digestMeta, { color: ts.raw.onSurfaceVariant }]}>
                    {digest.status === 'generating'
                      ? 'Generating now'
                      : digest.generatedAt
                        ? `Generated ${new Date(digest.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                        : digest.status === 'available'
                          ? 'Generated'
                          : 'Local summary'}
                  </Text>
                </View>
              </View>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss digest"
                onPress={dismissDigest}
                hitSlop={10}
                style={styles.digestDismiss}
              >
                <X size={14} color={ts.raw.onSurfaceVariant} />
              </ScalePressable>
            </View>
            <View style={styles.digestBody}>
              {digest.status === 'generating' ? <ActivityIndicator size="small" color={ts.raw.primary} /> : null}
              <Text style={[styles.digestText, { color: ts.raw.onSurface }]}>
                {digest.status === 'available' && digest.text ? digest.text : digest.localText}
              </Text>
            </View>
            {digest.status === 'unavailable' && digest.retryable ? (
              <View style={styles.digestRetry}>
                <Text style={[styles.digestError, { color: ts.raw.onSurfaceVariant }]}>
                  {digest.errorCode === 'offline' ? 'AI summary unavailable offline.' : 'AI summary could not be generated.'}
                </Text>
                <PeachButton title="Retry" variant="secondary" size="xs" onPress={retryDigest} />
              </View>
            ) : null}
          </LuminousCard>
        ) : null}

        {/* Income vs Expense, relocated from Home (FR-03.4) */}
        <LuminousCard style={[styles.card, { borderColor: ts.raw.outline }]}>
          <View style={styles.cashflowHeader}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={[styles.sectionEyebrow, { color: ts.raw.onSurfaceVariant }]}>Cashflow Balance</Text>
              <Text style={[styles.sectionTitle, { color: ts.raw.onSurface }]}>Income vs. Expense</Text>
            </View>
            <View
              style={[
                styles.netPill,
                { backgroundColor: (snapshot?.netBalance ?? 0) >= 0 ? ts.raw.successContainer : ts.raw.dangerSoft },
              ]}
            >
              <Text
                style={[
                  styles.netPillText,
                  { color: (snapshot?.netBalance ?? 0) >= 0 ? ts.raw.successText : ts.raw.danger },
                ]}
                numberOfLines={1}
              >
                {pricesVisible
                  ? `${(snapshot?.netBalance ?? 0) >= 0 ? '+' : '-'}${formatCurrency(Math.abs(snapshot?.netBalance ?? 0), currency)} Net`
                  : '••••'}
              </Text>
            </View>
          </View>

          <View style={styles.cashflowCards}>
            <View
              style={[
                styles.cashflowCard,
                styles.cashflowCardIncome,
                { backgroundColor: ts.isDark ? ts.raw.surfaceContainerLowest : Colors.black },
              ]}
            >
              <View style={styles.cashflowCardHeader}>
                <Text style={styles.cashflowLabelOnDark}>Income</Text>
                <View style={[styles.cashflowIcon, styles.cashflowIconOnDark]}>
                  <ArrowDown size={12} color={Colors.white} />
                </View>
              </View>
              <Text style={styles.cashflowAmountLight} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {pricesVisible ? formatCurrency(snapshot?.totalIncome ?? 0, currency) : '••••'}
              </Text>
              <Text style={styles.cashflowSubOnDark} numberOfLines={1}>Earned this period</Text>
            </View>

            <LinearGradient
              colors={[ts.raw.primary, ts.raw.primaryContainer]}
              start={GRADIENT_START}
              end={GRADIENT_END}
              style={[styles.cashflowCard, { borderColor: ts.raw.primaryBorder + '4D' }]}
            >
              <View style={styles.cashflowCardHeader}>
                <Text style={styles.cashflowLabelLight}>Expenses</Text>
                <View style={styles.cashflowIconLight}>
                  <ArrowUp size={12} color={Colors.white} />
                </View>
              </View>
              <Text style={styles.cashflowAmountLight} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {pricesVisible ? formatCurrency(snapshot?.totalSpent ?? 0, currency) : '••••'}
              </Text>
              <Text style={styles.cashflowSubLight} numberOfLines={1}>
                {snapshot && snapshot.totalIncome > 0
                  ? `${Math.round((snapshot.totalSpent / snapshot.totalIncome) * 100)}% of total inflow`
                  : 'No inflow recorded'}
              </Text>
            </LinearGradient>
          </View>

          <View style={styles.cashflowTrackRow}>
            <View style={[styles.cashflowTrack, { backgroundColor: ts.bg.elevated }]}>
              <View
                style={[
                  styles.cashflowFill,
                  {
                    backgroundColor: ts.raw.primary,
                    width: `${snapshot && snapshot.totalIncome > 0 ? Math.min(100, Math.round((snapshot.totalSpent / snapshot.totalIncome) * 100)) : 0}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.cashflowTrackLabels}>
              <Text style={[styles.cashflowTrackLabel, { color: ts.raw.onSurfaceVariant }]}>
                Spent: {snapshot && snapshot.totalIncome > 0 ? `${Math.round((snapshot.totalSpent / snapshot.totalIncome) * 100)}%` : '--'}
              </Text>
              <Text style={[styles.cashflowTrackLabel, { color: ts.raw.onSurfaceVariant }]}>
                Savings / Surplus: {snapshot && snapshot.totalIncome > 0 ? `${Math.max(0, 100 - Math.round((snapshot.totalSpent / snapshot.totalIncome) * 100))}%` : '--'}
              </Text>
            </View>
          </View>
        </LuminousCard>

        {/* Donut and category share (FR-03.3) */}
        <LuminousCard style={[styles.card, { borderColor: ts.raw.outline }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={[styles.sectionEyebrow, { color: ts.raw.onSurfaceVariant }]}>Category Share</Text>
              <Text style={[styles.sectionTitle, { color: ts.raw.onSurface }]}>Spending Breakdown</Text>
            </View>
            <Text style={[styles.sectionHint, { color: ts.raw.onSurfaceVariant }]}>Tap slice to filter</Text>
          </View>

          <View style={styles.shareRow}>
            <SpendingDonut
              bare
              size={DONUT_SIZE}
              total={snapshot?.totalSpent ?? 0}
              distribution={distribution}
              pricesVisible={pricesVisible}
              currencySymbol={currencySymbol}
              centerTopLabel={topCategory ? 'Top' : 'No data'}
              centerLabel={topCategory?.label ?? '--'}
              centerValue={topCategory ? `${topCategory.percentage.toFixed(0)}%` : ''}
              onCategoryPress={name => applyCategoryFilter(categoryFilter === name ? null : name)}
            />
            <View style={styles.shareLegend}>
              <CategoryBreakdown
                variant="compact"
                distribution={distribution}
                pricesVisible={pricesVisible}
                currencySymbol={currencySymbol}
                onCategoryPress={name => applyCategoryFilter(categoryFilter === name ? null : name)}
              />
            </View>
          </View>
        </LuminousCard>

        {/* Search and six-option sort, exclusive to Insights (FR-03.6) */}
        <View style={styles.searchRow}>
          <View style={styles.searchFlex}>
            <SearchFilterBar
              expanded
              onExpandedChange={() => undefined}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              placeholder="Search merchant, note, or category..."
            />
          </View>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel={`Sort transactions, currently ${activeSort.triggerLabel}`}
            onPress={() => setSortVisible(true)}
            style={[styles.sortTrigger, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            <ArrowUpDown size={14} color={ts.raw.primary} />
            <Text style={[styles.sortTriggerText, { color: ts.raw.onSurface }]} numberOfLines={1}>{activeSort.triggerLabel}</Text>
          </ScalePressable>
        </View>

        <View style={styles.countRow}>
          <Text accessibilityLiveRegion="polite" style={[styles.countText, { color: ts.raw.onSurfaceVariant }]}>
            Showing {visibleExpenses.length} {visibleExpenses.length === 1 ? 'transaction' : 'transactions'}
          </Text>
          <Text style={[styles.countSort, { color: ts.raw.primary }]}>Sorted by {activeSort.triggerLabel}</Text>
        </View>

        {error || snapshot?.state === 'offline' || snapshot?.state === 'failure' ? (
          <LuminousCard style={[styles.errorCard, { borderColor: ts.raw.danger, backgroundColor: ts.raw.dangerSoft }]}>
            <View style={styles.errorRow}>
              <RotateCcw size={14} color={ts.raw.danger} />
              <Text style={[styles.errorText, { color: ts.raw.danger }]}>
                {isOffline || snapshot?.state === 'offline'
                  ? 'Sync offline. Retaining local data.'
                  : 'Could not load your ledger. Showing what is available.'}
              </Text>
            </View>
            <PeachButton title="Retry" variant="destructive" size="xs" onPress={retry} />
          </LuminousCard>
        ) : null}

        {visibleExpenses.length === 0 ? (
          <LuminousCard style={[styles.emptyCard, { borderColor: ts.raw.outline }]}>
            <View style={[styles.emptyIcon, { backgroundColor: ts.raw.purple100 }]}>
              <Search size={18} color={ts.raw.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: ts.raw.onSurface }]}>
              {periodExpenses.length === 0 ? 'No Transactions in This Period' : 'No Matching Transactions'}
            </Text>
            <Text style={[styles.emptyBody, { color: ts.raw.onSurfaceVariant }]}>
              {periodExpenses.length === 0
                ? 'Try a wider timeframe to see your spending history.'
                : 'Try adjusting your search terms or clearing the active category filter.'}
            </Text>
            {(categoryFilter || searchQuery.trim().length > 0) ? (
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Reset filters and search"
                onPress={resetFilters}
                style={styles.emptyReset}
              >
                <Text style={[styles.emptyResetText, { color: ts.raw.primary }]}>Reset Filters</Text>
              </ScalePressable>
            ) : null}
          </LuminousCard>
        ) : (
          <View style={styles.transactionList}>
            {visibleExpenses.map(expense => (
              <ExpenseItem
                key={expense.id}
                expense={expense}
                searchQuery={searchQuery}
                detailOrigin="insights"
                detailOrderIds={visibleExpenses.map(item => item.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <SortSheet
        visible={sortVisible}
        activeKey={sortKey}
        onSelect={key => {
          setSortKey(key);
          setSortVisible(false);
        }}
        onClose={() => setSortVisible(false)}
      />

      <DateRangePicker
        visible={datePickerVisible}
        startDate={null}
        endDate={null}
        onApply={onApplyCustomRange}
        onClose={() => setDatePickerVisible(false)}
      />
    </View>
  );
}

function SortSheet({
  visible,
  activeKey,
  onSelect,
  onClose,
}: {
  visible: boolean;
  activeKey: InsightSortKey;
  onSelect: (key: InsightSortKey) => void;
  onClose: () => void;
}) {
  const ts = useThemeStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close sort options"
        style={styles.modalBackdrop}
        onPress={onClose}
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          onPress={() => undefined}
        >
          <View style={[styles.sheetHandle, { backgroundColor: ts.bg.elevated }]} />
          <View style={styles.sheetHeaderRow}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={[styles.sheetTitle, { color: ts.raw.onSurface }]}>Sort Transactions</Text>
              <Text style={[styles.sheetSub, { color: ts.raw.onSurfaceVariant }]}>Choose one of 6 sort orders</Text>
            </View>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Close sort options"
              onPress={onClose}
              hitSlop={10}
              style={styles.sheetClose}
            >
              <X size={16} color={ts.raw.onSurfaceVariant} />
            </ScalePressable>
          </View>
          <View style={{ gap: Spacing.s1 }}>
            {INSIGHT_SORT_OPTIONS.map(option => {
              const active = option.key === activeKey;
              return (
                <ScalePressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  onPress={() => onSelect(option.key)}
                  style={[styles.sortRow, active ? { backgroundColor: ts.raw.purple100 } : null]}
                >
                  <Text
                    style={[
                      styles.sortLabel,
                      { color: active ? ts.raw.primary : ts.raw.onSurface },
                      active ? styles.sortLabelActive : null,
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {active ? <Check size={16} color={ts.raw.primary} /> : null}
                </ScalePressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  headerLeft: { flexShrink: 1, minWidth: 0 },
  headerEyebrow: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.8 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 20, lineHeight: 26, marginTop: 2 },
  recapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    minHeight: 44,
    paddingHorizontal: Spacing.s4,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  recapLabel: { ...Typography.micro, fontFamily: 'Manrope_700Bold', color: Colors.white },

  timeframeBar: {
    flexDirection: 'row',
    padding: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
    marginBottom: Spacing.s3,
  },
  timeframeSegment: { flex: 1, minHeight: 44, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  timeframeInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  timeframeLabel: { ...Typography.labelMd, fontFamily: 'Manrope_500Medium' },
  timeframeLabelActive: { fontFamily: 'Manrope_600SemiBold' },

  filterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
    marginBottom: Spacing.s3,
    gap: Spacing.s2,
  },
  filterBadgeLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 },
  filterDot: { width: 8, height: 8, borderRadius: Radii.full },
  filterText: { ...Typography.labelMd, fontFamily: 'Manrope_600SemiBold' },
  filterClear: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  filterClearText: { ...Typography.micro, fontFamily: 'Manrope_700Bold' },

  narrative: { borderRadius: Radii.md, padding: Spacing.s4, marginBottom: Spacing.s3, overflow: 'hidden' },
  narrativeBlob: {
    position: 'absolute',
    right: -24,
    bottom: -24,
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(139,92,246,0.25)',
  },
  narrativeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s2, gap: Spacing.s2 },
  narrativeEyebrow: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold', color: 'rgba(233,213,255,0.8)', textTransform: 'uppercase', letterSpacing: 0.8 },
  deltaBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full, borderWidth: 1 },
  deltaBadgeGood: { backgroundColor: 'rgba(16,185,129,0.2)', borderColor: 'rgba(52,211,153,0.3)' },
  deltaBadgeUp: { backgroundColor: 'rgba(245,158,11,0.2)', borderColor: 'rgba(251,191,36,0.3)' },
  deltaBadgeText: { ...Typography.micro, fontFamily: 'Manrope_700Bold' },
  narrativeHeadline: { fontFamily: 'Manrope_700Bold', fontSize: 16, lineHeight: 22, color: Colors.white },
  narrativeDetail: { ...Typography.labelMd, color: 'rgba(237,233,254,0.85)', marginTop: Spacing.s1 },
  narrativeFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.s3, paddingTop: Spacing.s3, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: Spacing.s2 },
  narrativeTotalLabel: { ...Typography.micro, color: 'rgba(233,213,255,0.9)', flexShrink: 1 },
  narrativeTotalAmount: { ...Typography.micro, fontFamily: 'Manrope_700Bold', color: Colors.white },
  narrativePeriod: { ...Typography.micro, color: 'rgba(233,213,255,0.8)', flexShrink: 1 },

  card: { borderRadius: Radii.md, padding: Spacing.s4, marginBottom: Spacing.s3 },

  digestHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.s2 },
  digestIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 },
  digestIcon: { width: 32, height: 32, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
  digestTitle: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold' },
  digestMeta: { ...Typography.micro, marginTop: 1 },
  digestDismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  digestBody: { marginTop: Spacing.s2, gap: Spacing.s2 },
  digestText: { ...Typography.labelMd, lineHeight: 18 },
  digestRetry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, marginTop: Spacing.s2 },
  digestError: { ...Typography.micro, flexShrink: 1 },

  cashflowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, marginBottom: Spacing.s3 },
  sectionEyebrow: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionTitle: { ...Typography.labelBold, marginTop: 1 },
  netPill: { paddingHorizontal: Spacing.s2, paddingVertical: 3, borderRadius: Radii.full },
  netPillText: { ...Typography.micro, fontFamily: 'Manrope_700Bold' },
  cashflowCards: { flexDirection: 'row', gap: Spacing.s2, marginBottom: Spacing.s3 },
  cashflowCard: { flex: 1, minWidth: 0, borderRadius: Radii.sm, borderWidth: 1, padding: Spacing.s3 },
  cashflowCardIncome: { borderColor: 'rgba(255,255,255,0.1)' },
  cashflowCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s1 },
  cashflowLabelOnDark: { ...Typography.micro, color: 'rgba(255,255,255,0.7)' },
  cashflowLabelLight: { ...Typography.micro, color: 'rgba(255,255,255,0.7)' },
  cashflowIcon: { width: 20, height: 20, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  cashflowIconOnDark: { backgroundColor: 'rgba(255,255,255,0.15)' },
  cashflowIconLight: { width: 20, height: 20, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  cashflowAmountLight: { ...Typography.labelBold, color: Colors.white, letterSpacing: -0.3 },
  cashflowSubOnDark: { ...Typography.micro, marginTop: 2, color: Colors.statusSuccessText },
  cashflowSubLight: { ...Typography.micro, color: 'rgba(237,233,254,0.95)', marginTop: 2 },
  cashflowTrackRow: { gap: Spacing.s1 },
  cashflowTrack: { height: 10, borderRadius: Radii.full, overflow: 'hidden' },
  cashflowFill: { height: '100%', borderRadius: Radii.full },
  cashflowTrackLabels: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.s2 },
  cashflowTrackLabel: { ...Typography.micro },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, marginBottom: Spacing.s2 },
  sectionHint: { ...Typography.micro },
  shareRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.s4, paddingVertical: Spacing.s1 },
  shareLegend: { flex: 1, minWidth: 180 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  searchFlex: { flex: 1, minWidth: 0 },
  sortTrigger: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, minHeight: 46, paddingHorizontal: Spacing.s4, borderRadius: Radii.full, borderWidth: 1, flexShrink: 0 },
  sortTriggerText: { ...Typography.micro, fontFamily: 'Manrope_700Bold' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, paddingHorizontal: Spacing.s1, marginTop: Spacing.s2, marginBottom: Spacing.s3 },
  countText: { ...Typography.micro, flexShrink: 1 },
  countSort: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold' },

  errorCard: { borderRadius: Radii.md, padding: Spacing.s3, marginBottom: Spacing.s3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flex: 1, minWidth: 0 },
  errorText: { ...Typography.micro, flexShrink: 1 },

  transactionList: { gap: 0 },
  emptyCard: { borderRadius: Radii.md, padding: Spacing.s5, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center' },
  emptyIcon: { width: 40, height: 40, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.s2 },
  emptyTitle: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold', textAlign: 'center' },
  emptyBody: { ...Typography.micro, textAlign: 'center', marginTop: Spacing.s1, maxWidth: 280 },
  emptyReset: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.s2 },
  emptyResetText: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, borderTopWidth: 1, padding: Spacing.s5, paddingBottom: Spacing.s8, gap: Spacing.s3 },
  sheetHandle: { width: 40, height: 4, borderRadius: Radii.full, alignSelf: 'center' },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.s2 },
  sheetTitle: { ...Typography.bodyBold },
  sheetSub: { ...Typography.micro, marginTop: 1 },
  sheetClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.sm, gap: Spacing.s2 },
  sortLabel: { ...Typography.labelMd, fontFamily: 'Manrope_500Medium', flexShrink: 1 },
  sortLabelActive: { fontFamily: 'Manrope_700Bold' },
});
