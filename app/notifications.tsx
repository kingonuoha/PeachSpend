import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CreditCard,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react-native';

import { LuminousCard } from '../components/ui/LuminousCard';
import { PeachButton } from '../components/ui/PeachButton';
import { ScalePressable } from '../components/ui/ScalePressable';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/ToastProvider';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { useSettings } from '../components/ui/SettingsProvider';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { Radii, Spacing, Typography } from '../constants/tokens';
import { notificationDataService } from '../services/DataServices';
import type {
  NotificationDestination,
  NotificationKind,
  NotificationRecord,
} from '../services/DataServices';
import { formatRelativeDate } from '../utils/dateFormat';

// S-14 Notifications. Rebuilt as the single S-14 surface (FR-14.1-FR-14.3):
// one mixed unread/read inbox whose rows route recap to S-23, transaction to S-08
// and recurring to S-15. Clear all and single delete are confirmation-backed and
// the list updates immediately after either. Reads and writes go through the
// typed notification contract, never screen SQL. The stored body is masked when
// amounts are hidden, matching the v1 read-state behavior (FR-14.1).

const MAX_CONTENT_WIDTH = 640;
// BUG-09-11b. Only a write to the notifications table can make this list wrong.
const NOTIFICATION_FRESHNESS_DOMAINS = ['notifications'] as const;
const BACK_SIZE = 40;
const BACK_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
const ICON_CHIP_SIZE = 44;
const DELETE_SIZE = 32;
const DELETE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
// Filter pills, Clear all and Mark read keep a compact 32pt visual and earn the
// remaining 44pt target vertically through hitSlop (app-wide chip convention).
const PILL_HIT_SLOP = { top: 6, bottom: 6 };
const UNREAD_DOT_SIZE = 12;
// Loading placeholder count. Three rows mirror the common first viewport of the
// real inbox so the skeleton-to-content swap has no layout shift.
const SKELETON_ROW_COUNT = 3;
// Revealed swipe action width. Wide enough for the trash glyph plus the Delete
// label and above the 44pt minimum target in both axes.
const SWIPE_ACTION_WIDTH = 88;

// A stored body can carry a formatted amount. When prices are hidden, any
// whitespace token containing a digit is masked before it reaches the screen so
// no amount leaks from a stored notification field. F-03R-01.
const AMOUNT_TOKEN = /\S*\d\S*/g;
const MASK = '••••';

function maskAmounts(text: string): string {
  return text.replace(AMOUNT_TOKEN, MASK);
}

type KindIcon = React.ComponentType<{ size?: number; color?: string }>;

function kindVisual(kind: NotificationKind, ts: ReturnType<typeof useThemeStyles>): {
  background: string;
  foreground: string;
  Icon: KindIcon;
} {
  if (kind === 'recap') {
    return { background: ts.raw.purple100, foreground: ts.raw.primary, Icon: TrendingUp };
  }
  if (kind === 'transaction') {
    return { background: ts.raw.statusSuccessContainer, foreground: ts.raw.statusSuccessText, Icon: CreditCard };
  }
  if (kind === 'recurring') {
    return { background: ts.raw.warningContainer, foreground: ts.raw.warning, Icon: RefreshCw };
  }
  return { background: ts.bg.low, foreground: ts.raw.onSurfaceVariant, Icon: Bell };
}

function destinationBadge(screen: NotificationDestination['screen']): string | null {
  if (screen === 'S-23') return 'View Recap';
  if (screen === 'S-08') return 'Inspect';
  if (screen === 'S-15') return 'Manage Rule';
  return null;
}

type PendingAction = { mode: 'clear' } | { mode: 'single'; id: string; title: string };

// Loading placeholder. Mirrors the loaded row geometry (same list padding/gap and
// the real rowCard/rowInner/iconChip styles) so content arrives with no shift.
// Decorative blocks stay hidden from assistive tech; the container exposes one
// busy label, matching the Home/Insights skeleton convention.
function NotificationsSkeleton() {
  const ts = useThemeStyles();
  const rowSurface = ts.isDark ? ts.bg.low : ts.bg.card;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading notifications"
      accessibilityState={{ busy: true }}
      style={styles.listWrap}
    >
      <View style={styles.listContent}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.rowCard,
              { backgroundColor: rowSurface, borderColor: ts.raw.outline, borderWidth: 1 },
            ]}
          >
            <View style={styles.rowInner}>
              <Skeleton width={ICON_CHIP_SIZE} height={ICON_CHIP_SIZE} borderRadius={Radii.md} />
              <View style={[styles.rowText, styles.skeletonStack]}>
                <Skeleton width="55%" height={11} />
                <Skeleton width="90%" height={11} />
                <Skeleton width={64} height={16} borderRadius={Radii.full} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

interface NotificationRowProps {
  record: NotificationRecord;
  pricesVisible: boolean;
  onOpen: (record: NotificationRecord) => void;
  onDelete: (record: NotificationRecord) => void;
}

function NotificationRow({ record, pricesVisible, onOpen, onDelete }: NotificationRowProps) {
  const ts = useThemeStyles();
  const visual = kindVisual(record.kind, ts);
  const Icon = visual.Icon;
  const unread = !record.read;
  const badge = destinationBadge(record.destination.screen);
  const body = pricesVisible ? record.body : maskAmounts(record.body);
  // The canonical row is `bg-white dark:bg-[#1C1730]`: white card in light,
  // surface (not raised) in dark. LuminousCard `high` is surfaceContainerHigh,
  // so dark must use `low` to land on #1C1730 rather than #241D3D.
  const rowSurface = ts.isDark ? ts.bg.low : ts.bg.card;

  return (
    <ScalePressable
      onPress={() => onOpen(record)}
      accessibilityRole="button"
      accessibilityLabel={`${record.title}, ${unread ? 'unread' : 'read'}`}
      style={styles.rowWrap}
    >
      <LuminousCard
        variant={ts.isDark ? 'low' : 'high'}
        style={[
          styles.rowCard,
          {
            borderColor: unread ? ts.raw.primary + (ts.isDark ? '99' : '66') : ts.raw.outline,
            opacity: unread ? 1 : 0.9,
          },
          // purple-shadow-sm (0 4px 12px primary/12) on unread rows, light mode
          // only, matching the app card-shadow convention (dark relies on the
          // primary border accent instead of a dark drop shadow).
          unread && !ts.isDark
            ? {
                shadowColor: ts.raw.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 12,
                elevation: 3,
              }
            : null,
        ]}
      >
        <View style={styles.rowInner}>
          <View style={[styles.iconChip, { backgroundColor: visual.background }]}>
            <Icon size={20} color={visual.foreground} />
            {unread ? (
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={[styles.unreadDot, { backgroundColor: ts.raw.primary, borderColor: rowSurface }]}
              />
            ) : null}
          </View>

          <View style={styles.rowText}>
            <View style={styles.titleRow}>
              <Text
                style={[Typography.captionBold, styles.rowTitle, { color: ts.raw.onSurface }]}
                numberOfLines={1}
              >
                {record.title}
              </Text>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                {formatRelativeDate(record.createdAt)}
              </Text>
            </View>
            <Text
              style={[Typography.micro, styles.rowBody, { color: ts.raw.onSurfaceVariant }]}
              numberOfLines={2}
            >
              {body}
            </Text>
            {badge ? (
              <View style={styles.badgeWrap}>
                <View style={[styles.destBadge, { backgroundColor: ts.raw.purple100 }]}>
                  <Text style={[Typography.micro, styles.badgeText, { color: ts.raw.primary }]}>
                    {badge}
                  </Text>
                  <ChevronRight size={10} color={ts.raw.primary} />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </LuminousCard>

      <ScalePressable
        onPress={() => onDelete(record)}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${record.title}`}
        hitSlop={DELETE_HIT_SLOP}
        style={styles.deleteButton}
      >
        <Trash2 size={15} color={ts.raw.onSurfaceVariant} />
      </ScalePressable>
    </ScalePressable>
  );
}

// Swipe-to-reveal Delete wrapper. NotificationRow stays untouched so the resting
// row is unchanged; the swipeable only adds the revealed action behind it. The
// action is the visible-button alternative to the inline trash and routes to the
// same confirmation flow, never a direct delete. It stays hidden from assistive
// tech until the row is swiped open so a closed row never exposes a phantom
// second Delete control.
function SwipeableNotificationRow(props: NotificationRowProps) {
  const ts = useThemeStyles();
  const [swipeOpen, setSwipeOpen] = useState(false);
  const handleSwipeOpen = useCallback(() => setSwipeOpen(true), []);
  const handleSwipeClose = useCallback(() => setSwipeOpen(false), []);
  const { record, onDelete } = props;

  return (
    <ReanimatedSwipeable
      // Keep the row's own shadow unclipped (the component default is overflow
      // hidden, which would crop the unread Android elevation shadow).
      containerStyle={styles.swipeContainer}
      overshootRight={false}
      friction={2}
      onSwipeableOpen={handleSwipeOpen}
      onSwipeableClose={handleSwipeClose}
      renderRightActions={(_progress, _translation, methods) => (
        <View
          style={styles.swipeActionWrap}
          accessibilityElementsHidden={!swipeOpen}
          importantForAccessibility={swipeOpen ? 'auto' : 'no-hide-descendants'}
        >
          <ScalePressable
            onPress={() => {
              methods.close();
              onDelete(record);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${record.title}`}
            style={[styles.swipeDelete, { backgroundColor: ts.raw.dangerSoft }]}
          >
            <Trash2 size={18} color={ts.raw.danger} />
            <Text style={[Typography.micro, styles.semibold, { color: ts.raw.danger }]}>
              Delete
            </Text>
          </ScalePressable>
        </View>
      )}
    >
      <NotificationRow {...props} />
    </ReanimatedSwipeable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const { showToast } = useToast();
  const { settings } = useSettings();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  // Canonical overlay is `items-end sm:items-center`: bottom-anchored on phone
  // widths, vertically centered once the sm breakpoint (640) is reached.
  const isWide = width >= MAX_CONTENT_WIDTH;
  const pricesVisible = settings.prices_visible !== 'false';

  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const unreadCount = useMemo(() => records.filter((record) => !record.read).length, [records]);
  const visible = useMemo(
    () => (filter === 'unread' ? records.filter((record) => !record.read) : records),
    [filter, records],
  );

  // The notifications list is its own stale domain. A write from any other surface
  // (a capture, an import, a recurring run) cannot make this list wrong, so it does
  // not wake it.
  const { isStale, markFresh } = useDataFreshness(NOTIFICATION_FRESHNESS_DOMAINS);

  const load = useCallback(async () => {
    try {
      const state = await notificationDataService.list();
      setRecords(state.status === 'ready' ? state.notifications : []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // Read-state behavior unchanged from v1: the loaded snapshot drives the
    // visible unread treatment, then the persisted rows are marked read so the
    // next visit shows them as read. A failure here is non-blocking.
    await notificationDataService.markAllRead().catch(() => undefined);
    // BUG-09-11b. The read and the read-state write it triggers are the revision
    // this screen is now current with. Recording it after the write is what stops
    // the next focus from re-reading the same rows, and it is why the read-state
    // writes are not allowed to invalidate this screen on their own.
    markFresh();
  }, [markFresh]);

  // Refetch discipline: a focus re-reads only when something was written since the
  // last read. Today's behaviour re-ran the list query and the mark-all-read write
  // on every focus, including a focus that followed no change at all.
  useFocusEffect(
    useCallback(() => {
      if (!isStale()) return;
      void load();
    }, [isStale, load]),
  );

  const retry = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Pull-to-refresh re-runs the same load without the full skeleton: only the
  // native refresh spinner shows, so an existing list stays on screen while it
  // revalidates.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  const openRecord = useCallback(
    (record: NotificationRecord) => {
      if (!record.read) {
        setRecords((prev) =>
          prev.map((item) => (item.id === record.id ? { ...item, read: true } : item)),
        );
        void notificationDataService.markRead(record.id).catch(() => undefined);
      }

      const destination = record.destination;
      if (destination.screen === 'S-23') {
        router.push({ pathname: '/spending-recap', params: { origin: 'notification' } } as never);
        return;
      }
      if (destination.screen === 'S-15') {
        router.push('/recurring');
        return;
      }
      if (destination.screen === 'S-08') {
        if (destination.transactionId) {
          router.push({
            pathname: '/expense/[id]',
            params: { id: destination.transactionId, origin: 'notification' },
          } as never);
          return;
        }
        showToast('This notification has no linked transaction.', 'info');
        return;
      }
      showToast('This notification has no destination.', 'info');
    },
    [router, showToast],
  );

  const markAllReadNow = useCallback(async () => {
    // Optimistic: flip every row to read immediately, but capture the prior rows
    // so a failed persist rolls the UI back to the real state.
    const previous = records;
    setRecords((prev) => prev.map((record) => ({ ...record, read: true })));
    try {
      await notificationDataService.markAllRead();
      showToast('All notifications marked as read', 'success');
    } catch {
      setRecords(previous);
      showToast('Could not mark notifications as read.', 'error');
    }
  }, [records, showToast]);

  const requestClearAll = useCallback(() => {
    if (records.length === 0) return;
    setPending({ mode: 'clear' });
  }, [records.length]);

  const requestDelete = useCallback((record: NotificationRecord) => {
    setPending({ mode: 'single', id: record.id, title: record.title });
  }, []);

  const cancelConfirm = useCallback(() => {
    if (deleting) return;
    setPending(null);
  }, [deleting]);

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      if (pending.mode === 'clear') {
        await notificationDataService.clearAll();
        setRecords([]);
        showToast('All notifications cleared', 'success');
      } else {
        await notificationDataService.delete(pending.id);
        setRecords((prev) => prev.filter((record) => record.id !== pending.id));
        showToast('Notification removed', 'success');
      }
      setPending(null);
    } catch {
      showToast('Could not remove notification. Please try again.', 'error');
      setPending(null);
    } finally {
      setDeleting(false);
    }
  }, [pending, showToast]);

  const isClear = pending?.mode === 'clear';
  const unreadLabel = `${unreadCount} unread ${unreadCount === 1 ? 'update' : 'updates'}`;
  const selectedPillText = ts.isDark ? '#17162A' : '#FFFFFF';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.headerWrap, { borderBottomColor: ts.border.subtle, backgroundColor: ts.bg.screen }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <ScalePressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={BACK_HIT_SLOP}
              style={[styles.backButton, { backgroundColor: ts.bg.elevated }]}
            >
              <ArrowLeft size={20} color={ts.raw.onSurface} />
            </ScalePressable>
            <View style={styles.headerText}>
              <Text
                style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                accessibilityRole="header"
              >
                Notifications
              </Text>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
                {unreadLabel}
              </Text>
            </View>
          </View>

          {records.length > 0 ? (
            <ScalePressable
              onPress={requestClearAll}
              accessibilityRole="button"
              accessibilityLabel="Clear all notifications"
              hitSlop={PILL_HIT_SLOP}
              style={[styles.clearButton, { backgroundColor: ts.raw.purple100 }]}
            >
              <Text style={[Typography.micro, styles.semibold, { color: ts.raw.primary }]}>
                Clear all
              </Text>
            </ScalePressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.filterBar, { borderBottomColor: ts.border.subtle }]}>
        <ScalePressable
          onPress={() => setFilter('all')}
          accessibilityRole="tab"
          accessibilityState={{ selected: filter === 'all' }}
          accessibilityLabel="All notifications"
          hitSlop={PILL_HIT_SLOP}
          style={[
            styles.pill,
            { backgroundColor: filter === 'all' ? ts.raw.onSurface : ts.bg.elevated },
          ]}
        >
          <Text
            style={[
              Typography.micro,
              styles.semibold,
              { color: filter === 'all' ? selectedPillText : ts.raw.onSurfaceVariant },
            ]}
          >
            All
          </Text>
        </ScalePressable>
        <ScalePressable
          onPress={() => setFilter('unread')}
          accessibilityRole="tab"
          accessibilityState={{ selected: filter === 'unread' }}
          accessibilityLabel="Unread notifications"
          hitSlop={PILL_HIT_SLOP}
          style={[
            styles.pill,
            { backgroundColor: filter === 'unread' ? ts.raw.onSurface : ts.bg.elevated },
          ]}
        >
          <Text
            style={[
              Typography.micro,
              styles.semibold,
              { color: filter === 'unread' ? selectedPillText : ts.raw.onSurfaceVariant },
            ]}
          >
            Unread
          </Text>
        </ScalePressable>
        <ScalePressable
          onPress={() => void markAllReadNow()}
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications as read"
          hitSlop={PILL_HIT_SLOP}
          style={styles.markRead}
        >
          <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Mark read</Text>
        </ScalePressable>
      </View>

      {loading ? (
        <NotificationsSkeleton />
      ) : failed ? (
        <View style={styles.center}>
          <LuminousCard variant="low" style={styles.failureCard}>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>
              Could not load notifications
            </Text>
            <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
              Something went wrong while reading your inbox. Please try again.
            </Text>
            <PeachButton title="Retry" onPress={retry} variant="primary" size="md" />
          </LuminousCard>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SwipeableNotificationRow
                record={item}
                pricesVisible={pricesVisible}
                onOpen={openRecord}
                onDelete={requestDelete}
              />
            )}
            contentContainerStyle={[styles.listContent, visible.length === 0 ? styles.listContentEmpty : null]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={ts.raw.primary}
                colors={[ts.raw.primary]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.emptyChip, { backgroundColor: ts.raw.purple100 }]}
                >
                  <Bell size={32} color={ts.raw.primary} />
                </View>
                <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>All caught up</Text>
                <Text style={[Typography.labelMd, styles.emptyCopy, { color: ts.raw.onSurfaceVariant }]}>
                  No new notifications right now. New activity summaries, receipts, and recaps will
                  appear here.
                </Text>
              </View>
            }
          />
        </View>
      )}

      <Modal
        visible={pending !== null}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        statusBarTranslucent
        onRequestClose={cancelConfirm}
      >
        <View
          style={[
            styles.modalBackdrop,
            { backgroundColor: ts.bg.overlay, justifyContent: isWide ? 'center' : 'flex-end' },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={cancelConfirm}
            accessibilityLabel="Dismiss confirmation"
          />
          <View
            accessibilityViewIsModal
            style={[styles.modalCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
          >
            <View style={[styles.modalIcon, { backgroundColor: ts.raw.dangerSoft }]}>
              <Trash2 size={22} color={ts.raw.danger} />
            </View>
            <Text style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
              {isClear ? 'Clear all notifications?' : 'Delete notification?'}
            </Text>
            <Text style={[Typography.labelMd, styles.modalCopy, { color: ts.raw.onSurfaceVariant }]}>
              {isClear
                ? `This will permanently remove all ${records.length} notifications from your inbox. Past transactions and budgets remain untouched.`
                : `Remove "${pending?.mode === 'single' ? pending.title : ''}" from your updates list?`}
            </Text>
            <View style={styles.modalActions}>
              <PeachButton
                title={isClear ? 'Yes, clear notifications' : 'Delete notification'}
                onPress={() => void confirmPending()}
                variant="destructive"
                size="lg"
                fullWidth
                isLoading={deleting}
                disabled={deleting}
              />
              <PeachButton
                title="Cancel"
                onPress={cancelConfirm}
                variant="neutral"
                size="lg"
                fullWidth
                disabled={deleting}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerWrap: {
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s4,
    gap: Spacing.s3,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    flex: 1,
    minWidth: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  backButton: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    minHeight: 32,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semibold: {
    fontFamily: 'Manrope_600SemiBold',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
    borderBottomWidth: 1,
  },
  pill: {
    minHeight: 32,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markRead: {
    marginLeft: 'auto',
    minHeight: 32,
    paddingHorizontal: Spacing.s1,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.s5,
  },
  failureCard: {
    width: '100%',
    maxWidth: 420,
    gap: Spacing.s3,
    alignItems: 'flex-start',
  },
  listWrap: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  listContent: {
    paddingHorizontal: Spacing.s4,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s9,
    gap: Spacing.s3,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  rowWrap: {
    position: 'relative',
  },
  // ReanimatedSwipeable defaults the container to overflow hidden, which would
  // crop the row's own unread shadow on Android. Keep it visible so the resting
  // row is byte-for-byte the same as before the gesture was added.
  swipeContainer: {
    overflow: 'visible',
  },
  swipeActionWrap: {
    width: SWIPE_ACTION_WIDTH,
  },
  swipeDelete: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s1,
    borderRadius: Radii.md,
  },
  skeletonStack: {
    gap: Spacing.s1,
  },
  rowCard: {
    borderRadius: Radii.md,
    padding: Spacing.s4,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
  },
  iconChip: {
    width: ICON_CHIP_SIZE,
    height: ICON_CHIP_SIZE,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: -Spacing.s1,
    right: -Spacing.s1,
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: Radii.full,
    borderWidth: 2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.s6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    marginBottom: 2,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
  },
  rowBody: {
    lineHeight: 15,
  },
  badgeWrap: {
    marginTop: Spacing.s2,
    flexDirection: 'row',
  },
  destBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  badgeText: {
    fontFamily: 'Manrope_600SemiBold',
  },
  deleteButton: {
    position: 'absolute',
    top: Spacing.s3,
    right: Spacing.s3,
    width: DELETE_SIZE,
    height: DELETE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s6,
    paddingVertical: Spacing.s9,
  },
  emptyChip: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s4,
  },
  emptyCopy: {
    textAlign: 'center',
    marginTop: Spacing.s1,
    maxWidth: 260,
  },
  modalBackdrop: {
    flex: 1,
    padding: Spacing.s4,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s6,
  },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s4,
  },
  modalCopy: {
    marginTop: Spacing.s1,
    lineHeight: 17,
  },
  modalActions: {
    marginTop: Spacing.s6,
    gap: Spacing.s2,
  },
});
