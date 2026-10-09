import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDown,
  Bell,
  ChevronRight,
  Eye,
  EyeOff,
  Flame,
  Leaf,
  RotateCcw,
  Sparkles,
  User,
  Zap,
} from 'lucide-react-native';

import { CategoryTints, Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useToast } from '../../components/ui/ToastProvider';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import StreakSplash, { selectNextStreakBadge } from '../../components/ui/StreakSplash';
import { BadgeDetailModal } from '../../components/ui/BadgeDetailModal';
import { CategoryGlyph } from '../../components/capture/CategoryGlyph';
import { homeDataService } from '../../data/homeDataRepository';
import { databaseService } from '../../services/DatabaseService';
import { profileDataService } from '../../services/DataServices';
import { formatAmount } from '../../utils/format';
import { formatRelativeDateWithTime } from '../../utils/dateFormat';
import type { Expense } from '../../types/database';
import type { HomeSnapshot } from '../../data/HomeContracts';
import type { AchievementState } from '../../data/ProfileContracts';

const MASK = '••••••';
const MAX_CATEGORIES = 4;
const RECENT_LIMIT = 5;

interface CategoryInfo {
  title: string;
  icon_name: string;
}

interface HomeLoad {
  snapshot: HomeSnapshot;
  categories: Record<string, CategoryInfo>;
}

const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];

// Canonical S-02 avatar ring, code.html line 159: bg-gradient-to-tr from-amber-300
// to-rose-400 with purple-950 initials. Sourced from the locked pair, not a new palette.
const AVATAR_GRADIENT = ['#FCD34D', '#FB7185'] as const;
const AVATAR_INITIAL_COLOR = '#1E0B3D';

function monthLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'long' });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export default function HomeScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { settings, currency, getCurrencySymbol, convertAmount, updateSetting } = useSettings();

  const [load, setLoad] = useState<HomeLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [streakSplash, setStreakSplash] = useState<{ streak: number; badge: AchievementState | null } | null>(null);
  const [selectedBadge, setSelectedBadge] = useState<AchievementState | null>(null);

  // Income total and every other hero value come from the single typed snapshot.
  // The screen no longer issues a separate income query.
  const fetchHome = useCallback(async (): Promise<HomeLoad> => {
    const snapshot = await homeDataService.getSnapshot();
    const list = await databaseService.getCategories();
    const categories: Record<string, CategoryInfo> = {};
    for (const category of list) {
      categories[category.id] = { title: category.title, icon_name: category.icon_name };
    }
    return { snapshot, categories };
  }, []);

  const applyLoad = useCallback((next: HomeLoad) => {
    setLoad(next);
    setRefreshError(next.snapshot.state === 'offline' || next.snapshot.state === 'failure');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await fetchHome();
        if (active) applyLoad(next);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchHome, applyLoad]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      applyLoad(await fetchHome());
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchHome, applyLoad]);

  const retry = useCallback(() => {
    setRefreshError(false);
    void onRefresh();
  }, [onRefresh]);

  const snapshot = load?.snapshot;
  const visible = settings.prices_visible !== 'false';
  const symbol = getCurrencySymbol();
  const currencyCode = snapshot?.hero.currency ?? currency;
  const spend = snapshot?.hero.totalSpent ?? 0;
  const incomeTotal = snapshot?.hero.incomeTotal ?? 0;

  const budget = useMemo(() => {
    const raw = parseFloat(settings.monthly_budget) || 0;
    if (raw <= 0) return { state: 'none' as const, progress: 0, percent: 0 };
    const cap = convertAmount(raw, settings.budget_currency || currency).amount;
    if (cap <= 0) return { state: 'none' as const, progress: 0, percent: 0 };
    const progress = spend / cap;
    const state = progress > 1 ? 'over' as const : progress >= 0.8 ? 'near' as const : 'on' as const;
    return { state, progress, percent: Math.round(progress * 100) };
  }, [settings.monthly_budget, settings.budget_currency, currency, convertAmount, spend]);

  const insight = snapshot?.comparativeInsight;
  const month = snapshot ? monthLabel(snapshot.period.start) : '';
  const profileName = settings.profile_name?.trim() || '';
  const streakDays = snapshot?.streak.days ?? 0;
  const unread = snapshot?.unreadNotificationCount ?? 0;

  const recent = snapshot?.recentTransactions ?? [];
  const visibleRecent = recent.slice(0, RECENT_LIMIT);
  const categories = (snapshot?.categories ?? []).slice(0, MAX_CATEGORIES);

  const money = useCallback((value: number) => `${symbol}${formatAmount(value)}`, [symbol]);

  const toggleVisibility = useCallback(() => {
    const next = visible ? 'false' : 'true';
    void updateSetting('prices_visible', next);
    toast.showToast(next === 'false' ? 'Amounts hidden' : 'Amounts visible');
  }, [visible, updateSetting, toast]);

  // FR-02.6: the quiet Home streak badge opens SH-02a. The cross-link badge
  // comes from the real ProfileSnapshot achievements; a failed read falls back
  // to the live Home streak with no badge bridge rather than a fake claim.
  const openStreakSplash = useCallback(async () => {
    let streak = streakDays;
    let badge: AchievementState | null = null;
    try {
      const next = await profileDataService.getSnapshot();
      streak = next.stats.streak || streakDays;
      badge = selectNextStreakBadge(next.achievements);
    } catch {
      badge = null;
    }
    setStreakSplash({ streak, badge });
  }, [streakDays]);

  // TEMPORARY dev-only control (H6). Writes onboarding_complete through the
  // settings provider typed path, then routes to onboarding so the guard at
  // (onboarding)/index.tsx sees the fresh value. Remove before release.
  const resetOnboarding = useCallback(async () => {
    await updateSetting('onboarding_complete', 'false');
    router.push('/(onboarding)');
  }, [updateSetting, router]);

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: ts.bg.screen, paddingTop: insets.top }]}>
        <ActivityIndicator color={ts.raw.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: ts.bg.screen }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 90 + insets.bottom + Spacing.s6 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ts.raw.primary}
            colors={[ts.raw.primary]}
          />
        }
      >
        <LinearGradient
          colors={ts.isDark ? Gradients.dark : Gradients.light}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={[styles.hero, { paddingTop: insets.top + Spacing.s2 }]}
        >
          <View style={styles.heroHeader}>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.identity}
            >
              <LinearGradient
                colors={AVATAR_GRADIENT}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={styles.avatar}
              >
                {profileName ? (
                  <Text style={styles.avatarText}>{initialsOf(profileName)}</Text>
                ) : (
                  <User size={18} color={AVATAR_INITIAL_COLOR} />
                )}
              </LinearGradient>
              <View style={styles.identityText}>
                <View style={styles.cycleRow}>
                  <Text style={styles.cycleLabel}>{month} Cycle</Text>
                  <View style={styles.cycleDot} />
                  <Text style={styles.cycleYear}>{new Date().getFullYear()}</Text>
                </View>
                <Text style={styles.profileName} numberOfLines={1}>
                  {profileName || 'PeachSpend'}
                </Text>
              </View>
            </ScalePressable>

            <View style={styles.heroActions}>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={visible ? 'Hide amounts' : 'Show amounts'}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={toggleVisibility}
                style={styles.glassButton}
              >
                {visible ? (
                  <Eye size={16} color={Colors.white} />
                ) : (
                  <EyeOff size={16} color={Colors.white} />
                )}
              </ScalePressable>

              {streakDays > 0 ? (
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel={`Daily logging streak, ${streakDays} days`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={() => void openStreakSplash()}
                  style={[styles.glassButton, styles.streakPill]}
                >
                  <Flame size={14} color="#FCD34D" />
                  <Text style={styles.streakText}>{streakDays}d</Text>
                </ScalePressable>
              ) : null}

              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => router.push('/notifications')}
                style={styles.glassButton}
              >
                <Bell size={16} color={Colors.white} />
                {unread > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                ) : null}
              </ScalePressable>
            </View>
          </View>

          <View style={styles.outflowRow}>
            <Text style={styles.outflowLabel}>TOTAL OUTFLOW ({month.toUpperCase()})</Text>
            {budget.state !== 'none' ? <BudgetPill state={budget.state} percent={budget.percent} /> : null}
          </View>

          <View style={styles.amountRow}>
            <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {visible ? money(spend) : MASK}
            </Text>
            <Text style={styles.currencyCode}>{currencyCode}</Text>
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <View style={styles.incomeIcon}>
                <ArrowDown size={12} color={Colors.success} />
              </View>
              <Text style={styles.summaryLabel}>Income Inflow:</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {visible ? money(incomeTotal) : MASK}
              </Text>
            </View>
          </View>

          {budget.state !== 'none' ? (
            <View style={styles.budgetTrack}>
              {budget.state === 'on' ? (
                <LinearGradient
                  colors={[Colors.success, ts.raw.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.budgetFill, { width: `${Math.min(budget.progress, 1) * 100}%` }]}
                />
              ) : (
                <View
                  style={[
                    styles.budgetFill,
                    {
                      width: `${Math.min(budget.progress, 1) * 100}%`,
                      backgroundColor: budget.state === 'over' ? ts.raw.danger : ts.raw.warning,
                    },
                  ]}
                />
              )}
            </View>
          ) : null}

          {/* F-03R-02: the insight is derived from real period totals, so it is
              hidden with the amounts to avoid leaking direction or percent. */}
          {visible && insight?.localText ? (
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Open insights"
              onPress={() => router.push('/(tabs)/analytics')}
              style={[styles.insight, ts.isDark ? styles.insightDark : null]}
            >
              <View style={styles.insightLeft}>
                <Sparkles size={16} color={Colors.white} />
                <Text style={styles.insightText}>{insight.localText}</Text>
              </View>
              <ChevronRight size={16} color="rgba(255,255,255,0.7)" />
            </ScalePressable>
          ) : null}
        </LinearGradient>

        {refreshError ? (
          <View style={[styles.errorBanner, { backgroundColor: ts.raw.dangerSoft, borderColor: ts.raw.danger }]}>
            <View style={styles.errorLeft}>
              <RotateCcw size={14} color={ts.raw.danger} />
              <Text style={[styles.errorText, { color: ts.raw.danger }]}>
                {snapshot?.refresh.errorCode === 'offline'
                  ? 'Sync offline. Retaining local cache.'
                  : 'Could not load your ledger. Showing what is available.'}
              </Text>
            </View>
            <PeachButton title="Retry" variant="destructive" size="xs" onPress={retry} />
          </View>
        ) : null}

        {categories.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { color: ts.raw.onSurface }]}>Top Categories</Text>
                <Text style={[styles.sectionMeta, { color: ts.raw.onSurfaceVariant }]}>{month}</Text>
              </View>
              <PeachButton
                title="Recap"
                variant="secondary"
                size="xs"
                icon={<Zap size={14} color={ts.raw.primary} />}
                onPress={() => router.push({ pathname: '/spending-recap', params: { origin: 'home' } } as never)}
              />
            </View>

            <View style={styles.categoryRow}>
              {categories.map(category => {
                const info = load?.categories[category.category];
                const tint = CategoryTints[category.category as keyof typeof CategoryTints] ?? CategoryTints.other;
                const chip = ts.isDark ? tint.dark : tint.light;
                return (
                  <ScalePressable
                    key={category.category}
                    accessibilityRole="button"
                    accessibilityLabel={`${info?.title ?? category.category}, open insights`}
                    onPress={() => router.push(`/(tabs)/analytics?category=${encodeURIComponent(category.category)}` as never)}
                    style={[
                      styles.categoryChip,
                      { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline },
                    ]}
                  >
                    <View style={[styles.categoryIcon, { backgroundColor: chip[0] }]}>
                      <CategoryGlyph iconName={info?.icon_name} size={18} color={chip[1]} />
                    </View>
                    <Text style={[styles.categoryName, { color: ts.raw.onSurface }]} numberOfLines={1}>
                      {info?.title ?? category.category}
                    </Text>
                    <Text style={[styles.categoryAmount, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                      {visible ? money(category.total) : MASK}
                    </Text>
                  </ScalePressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitle, { color: ts.raw.onSurface }]}>Recent Flow</Text>
              <View style={[styles.countBadge, { backgroundColor: ts.bg.elevated }]}>
                <Text style={[styles.countBadgeText, { color: ts.raw.onSurfaceVariant }]}>
                  {visibleRecent.length} {visibleRecent.length === 1 ? 'item' : 'items'}
                </Text>
              </View>
            </View>
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="See all transactions in Insights"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              onPress={() => router.push('/(tabs)/analytics')}
              style={styles.seeAll}
            >
              <Text style={[styles.seeAllText, { color: ts.raw.primary }]}>See all</Text>
              <ChevronRight size={14} color={ts.raw.primary} />
            </ScalePressable>
          </View>

          {recent.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }]}>
              <View style={[styles.emptyIcon, { backgroundColor: ts.bg.primary10 }]}>
                <Leaf size={20} color={ts.raw.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: ts.raw.onSurface }]}>No transactions recorded yet</Text>
              <Text style={[styles.emptyBody, { color: ts.raw.onSurfaceVariant }]}>
                Use the plus button to log your first expense, scan a receipt, or log income.
              </Text>
            </View>
          ) : (
            <View style={styles.transactionList}>
              {visibleRecent.map(expense => (
                <TransactionRow
                  key={expense.id}
                  expense={expense}
                  info={load?.categories[expense.category]}
                  visible={visible}
                  symbol={symbol}
                  onPress={() => router.push({
                    pathname: '/expense/[id]',
                    params: { id: expense.id, origin: 'home', ids: visibleRecent.map(item => item.id).join(',') },
                  } as never)}
                />
              ))}
            </View>
          )}
        </View>

        {__DEV__ ? (
          <View style={styles.devResetSection}>
            <View style={[styles.devResetDivider, { backgroundColor: ts.raw.outline }]} />
            <Text style={[styles.devResetNote, { color: ts.raw.onSurfaceVariant }]}>
              Temporary development control. Remove before release.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dev: Reset onboarding"
              onPress={resetOnboarding}
              style={({ pressed }) => [
                styles.devResetButton,
                { borderColor: ts.raw.outline },
                pressed ? styles.devResetButtonPressed : null,
              ]}
            >
              <Text style={[styles.devResetButtonText, { color: ts.raw.onSurfaceVariant }]}>
                Dev: Reset onboarding
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {streakSplash ? (
        <StreakSplash
          currentStreak={streakSplash.streak}
          streakStartDate={settings.streak_start_date ?? null}
          nextBadge={streakSplash.badge}
          onDismiss={() => setStreakSplash(null)}
          onViewDetails={(badge) => setSelectedBadge(badge)}
        />
      ) : null}

      <BadgeDetailModal
        visible={selectedBadge !== null}
        badge={selectedBadge}
        currentStreak={streakSplash?.streak ?? streakDays}
        onClose={() => setSelectedBadge(null)}
      />
    </View>
  );
}

function BudgetPill({ state, percent }: { state: 'on' | 'near' | 'over'; percent: number }) {
  const label = state === 'over' ? `Exceeded (+${Math.max(percent - 100, 1)}%)` : state === 'near' ? `Near Limit (${percent}%)` : 'On Pace';
  const color = state === 'over' ? '#FCA5A5' : state === 'near' ? '#FCD34D' : '#DDD6FE';
  const background = state === 'over' ? 'rgba(244,63,94,0.25)' : state === 'near' ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.15)';
  return (
    <View style={[styles.budgetPill, { backgroundColor: background }]}>
      <Text style={[styles.budgetPillText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TransactionRow({
  expense,
  info,
  visible,
  symbol,
  onPress,
}: {
  expense: Expense;
  info?: CategoryInfo;
  visible: boolean;
  symbol: string;
  onPress: () => void;
}) {
  const ts = useThemeStyles();
  const { currency, convertAmount } = useSettings();
  const tint = CategoryTints[expense.category as keyof typeof CategoryTints] ?? CategoryTints.other;
  const chip = ts.isDark ? tint.dark : tint.light;
  const converted = convertAmount(expense.amount, expense.currency || currency).amount;

  return (
    <ScalePressable
      accessibilityRole="button"
      accessibilityLabel={`${expense.merchant}, ${info?.title ?? expense.category}`}
      onPress={onPress}
      style={[styles.transaction, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }]}
    >
      <View style={styles.transactionLeft}>
        <View style={[styles.transactionIcon, { backgroundColor: chip[0] }]}>
          <CategoryGlyph iconName={info?.icon_name} size={18} color={chip[1]} />
        </View>
        <View style={styles.transactionText}>
          <View style={styles.transactionTitleRow}>
            <Text style={[styles.transactionTitle, { color: ts.raw.onSurface }]} numberOfLines={1}>
              {expense.merchant}
            </Text>
            {expense.scanned === 1 ? (
              <View style={[styles.ocrBadge, { backgroundColor: ts.bg.primary10 }]}>
                <Text style={[styles.ocrBadgeText, { color: ts.raw.primary }]}>OCR</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.transactionMeta, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
            {info?.title ?? expense.category} • {formatRelativeDateWithTime(expense.date)}
          </Text>
        </View>
      </View>
      <Text style={[styles.transactionAmount, { color: ts.raw.onSurface }]} numberOfLines={1}>
        {visible ? `-${symbol}${formatAmount(converted)}` : MASK}
      </Text>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: {
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s6,
    borderBottomLeftRadius: Radii.xxl,
    borderBottomRightRadius: Radii.xxl,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s4,
  },
  identity: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: AVATAR_INITIAL_COLOR, fontFamily: 'Manrope_700Bold', fontSize: 14 },
  identityText: { marginLeft: Spacing.s3, flexShrink: 1, minWidth: 0 },
  cycleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  cycleLabel: {
    ...Typography.micro,
    fontFamily: 'Manrope_600SemiBold',
    color: 'rgba(233,213,255,0.9)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cycleDot: { width: 5, height: 5, borderRadius: Radii.full, backgroundColor: 'rgba(233,213,255,0.7)' },
  cycleYear: { ...Typography.micro, color: 'rgba(233,213,255,0.7)' },
  profileName: { ...Typography.headlineMd, color: Colors.white },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  glassButton: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: Spacing.s2,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  streakPill: { flexDirection: 'row', gap: Spacing.s1 },
  streakText: { ...Typography.micro, color: '#FCD34D', fontFamily: 'Manrope_700Bold' },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: Radii.full,
    backgroundColor: '#F43F5E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: Colors.white, fontFamily: 'Manrope_700Bold', fontSize: 9, lineHeight: 12 },
  outflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  outflowLabel: { ...Typography.labelMd, color: 'rgba(255,255,255,0.7)', flexShrink: 1 },
  budgetPill: {
    maxWidth: '55%',
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  budgetPillText: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.s2, marginTop: Spacing.s1 },
  amount: { ...Typography.displayLg, color: Colors.white, letterSpacing: -0.5, flexShrink: 1 },
  currencyCode: { ...Typography.labelMd, color: 'rgba(233,213,255,0.9)', fontFamily: 'Manrope_500Medium' },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.s4,
    marginTop: Spacing.s3,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, flexShrink: 1 },
  incomeIcon: {
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.2)',
  },
  summaryLabel: { ...Typography.labelMd, color: 'rgba(255,255,255,0.7)' },
  summaryValue: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold', color: Colors.white },
  budgetTrack: {
    height: 6,
    borderRadius: Radii.full,
    overflow: 'hidden',
    marginTop: Spacing.s4,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  budgetFill: { height: '100%', borderRadius: Radii.full },
  insight: {
    marginTop: Spacing.s4,
    padding: Spacing.s3,
    minHeight: 44,
    borderRadius: Radii.md,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  insightLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flex: 1, minWidth: 0 },
  insightDark: { backgroundColor: 'rgba(255,255,255,0.05)' },
  insightText: { ...Typography.labelMd, fontFamily: 'Manrope_600SemiBold', color: Colors.white, flex: 1 },
  errorBanner: {
    marginHorizontal: Spacing.s5,
    marginTop: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  errorLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flex: 1, minWidth: 0 },
  errorText: { ...Typography.micro, flex: 1 },
  section: { marginTop: Spacing.s6, paddingHorizontal: Spacing.s5 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s3,
    gap: Spacing.s2,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 },
  sectionTitle: { ...Typography.labelBold },
  sectionMeta: { ...Typography.micro },
  categoryRow: { flexDirection: 'row', gap: Spacing.s2 },
  categoryChip: {
    flex: 1,
    minWidth: 0,
    padding: Spacing.s2,
    borderRadius: Radii.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s1,
  },
  categoryName: { ...Typography.labelMd, fontFamily: 'Manrope_600SemiBold' },
  categoryAmount: { ...Typography.micro, fontFamily: 'Manrope_700Bold', marginTop: 2 },
  countBadge: { paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full },
  countBadgeText: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  seeAllText: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold' },
  transactionList: { gap: Spacing.s2 },
  transaction: {
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  transactionLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionText: { flex: 1, minWidth: 0 },
  transactionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  transactionTitle: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold', flexShrink: 1 },
  ocrBadge: { paddingHorizontal: Spacing.s1, borderRadius: 4 },
  ocrBadgeText: { ...Typography.micro, fontFamily: 'Manrope_700Bold', fontSize: 10, lineHeight: 12 },
  transactionMeta: { ...Typography.micro },
  transactionAmount: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold', flexShrink: 0 },
  empty: {
    padding: Spacing.s5,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s2,
  },
  emptyTitle: { ...Typography.labelMd, fontFamily: 'Manrope_700Bold' },
  emptyBody: { ...Typography.micro, textAlign: 'center', marginTop: Spacing.s1, maxWidth: 240 },
  // TEMPORARY H6 dev-only control. Subdued, separated from canonical sections.
  devResetSection: {
    marginTop: Spacing.s8,
    paddingHorizontal: Spacing.s5,
    alignItems: 'center',
  },
  devResetDivider: { width: '100%', height: 1, marginBottom: Spacing.s3 },
  devResetNote: { ...Typography.micro, textAlign: 'center', marginBottom: Spacing.s2 },
  devResetButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.s4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radii.md,
  },
  devResetButtonPressed: { opacity: 0.6 },
  devResetButtonText: { ...Typography.labelMd, fontFamily: 'Manrope_600SemiBold' },
});
