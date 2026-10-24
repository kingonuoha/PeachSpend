import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Undo2,
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
// Filter pills, Clear all, Mark read and the undo action keep a compact 32pt
// visual and earn the remaining 44pt target vertically through hitSlop (app-wide
// chip convention).
const PILL_HIT_SLOP = { top: 6, bottom: 6 };
const UNREAD_DOT_SIZE = 12;
// Loading placeholder count. Three rows mirror the common first viewport of the
// real inbox so the skeleton-to-content swap has no layout shift.
const SKELETON_ROW_COUNT = 3;
// Revealed swipe action width. Wide enough for the trash glyph plus the Delete
// label and above the 44pt minimum target in both axes.
const SWIPE_ACTION_WIDTH = 88;
// Undo window for a swiped row. The row leaves the list immediately but the store
// write is held for this window, so Undo restores the exact record rather than
// writing a copy with a new id. When the window closes, or the screen unmounts,
// the held delete is committed.
const UNDO_WINDOW_MS = 5000;

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

type UndoPending = { record: NotificationRecord; index: number };

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
}

function NotificationRow({ record, pricesVisible, onOpen }: NotificationRowProps) {
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
    </ScalePressable>
  );
}

// Swipe-to-reveal Delete wrapper. The card face holds exactly one control: the row
// itself. The revealed Delete is a visible-button alternative to the gesture and is
// the only delete affordance on the row; it starts the undo window rather than
// opening a blocking confirmation (audit Screen 5 lines 316 to 324). It stays
// hidden from assistive tech until the row is swiped open, so a closed row never
// exposes a phantom second Delete control.
interface SwipeableNotificationRowProps extends NotificationRowProps {
  onDelete: (record: NotificationRecord) => void;
}

function SwipeableNotificationRow(props: SwipeableNotificationRowProps) {
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
      <NotificationRow
        record={props.record}
        pricesVisible={props.pricesVisible}
        onOpen={props.onOpen}
      />
    </ReanimatedSwipeable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
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
  // Clear all is the only destructive action that still asks first, because it
  // removes every row at once. A single row delete is swipe plus undo.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [undo, setUndo] = useState<UndoPending | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `undo` for the unmount cleanup, which cannot read state.
  const undoRef = useRef<UndoPending | null>(null);

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
    // A held swipe delete has to land before a re-read, or the reloaded list would
    // show a row the undo bar says is gone. The held row is committed here rather
    // than restored, because a reload is a fresh read of the store.
    const held = undoRef.current;
    if (held) {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
        undoTimer.current = null;
      }
      undoRef.current = null;
      setUndo(null);
      void notificationDataService.delete(held.record.id).catch(() => undefined);
    }
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
    setConfirmClear(true);
  }, [records.length]);

  // Puts a held row back at the position it was removed from. Guarded against a
  // duplicate id, so a retry or a double tap cannot insert the same record twice.
  const restoreRecord = useCallback((entry: UndoPending) => {
    setRecords((prev) => {
      if (prev.some((record) => record.id === entry.record.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.record);
      return next;
    });
  }, []);

  // The held write. A failure restores the row and says so, which is the only
  // honest outcome: the row is still in the inbox.
  const commitDelete = useCallback(async (entry: UndoPending) => {
    try {
      await notificationDataService.delete(entry.record.id);
    } catch {
      restoreRecord(entry);
      showToast('Could not remove that notification. It is back in your inbox.', 'error');
    }
  }, [restoreRecord, showToast]);

  // Swipe delete. The row leaves the list at once and the store write is held for
  // the undo window, so Undo restores the same row with the same id instead of
  // re-inserting a copy. A second swipe commits the first pending delete before it
  // starts its own window, so only one row is ever held.
  const startDelete = useCallback((record: NotificationRecord) => {
    const held = undoRef.current;
    if (held) {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
        undoTimer.current = null;
      }
      void commitDelete(held);
    }
    const index = records.findIndex((item) => item.id === record.id);
    const entry: UndoPending = { record, index: index < 0 ? 0 : index };
    setRecords((prev) => prev.filter((item) => item.id !== record.id));
    // Set the ref at the same time as the state so a second swipe in the same tick
    // still sees the row that is currently held.
    undoRef.current = entry;
    setUndo(entry);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndo(null);
      void commitDelete(entry);
    }, UNDO_WINDOW_MS);
  }, [commitDelete, records]);

  const undoDelete = useCallback(() => {
    const entry = undoRef.current;
    if (!entry) return;
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setUndo(null);
    restoreRecord(entry);
    showToast('Notification restored', 'success');
  }, [restoreRecord, showToast]);

  // Keep the ref in step with the state the renderer uses, and commit a held row
  // when the screen goes away so a swipe is never silently discarded.
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const held = undoRef.current;
    if (held) void notificationDataService.delete(held.record.id).catch(() => undefined);
  }, []);

  const cancelClear = useCallback(() => {
    if (clearing) return;
    setConfirmClear(false);
  }, [clearing]);

  const confirmClearAll = useCallback(async () => {
    setClearing(true);
    // Clear all supersedes any held row, so the window closes with it.
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    undoRef.current = null;
    setUndo(null);
    try {
      await notificationDataService.clearAll();
      setRecords([]);
      showToast('All notifications cleared', 'success');
      setConfirmClear(false);
    } catch {
      showToast('Could not clear notifications. Please try again.', 'error');
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }, [showToast]);

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
                onDelete={startDelete}
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
                <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Your inbox is clear</Text>
                <Text style={[Typography.labelMd, styles.emptyCopy, { color: ts.raw.onSurfaceVariant }]}>
                  New activity summaries, receipts, and recaps will appear here.
                </Text>
                {/* Real next action (task B1-5 bullet 4). Insights is a different
                    destination from this inbox, so the empty state leads somewhere
                    new instead of repeating the header back control. */}
                <PeachButton
                  title="View insights"
                  variant="secondary"
                  size="md"
                  onPress={() => router.push('/(tabs)/analytics')}
                  style={styles.emptyAction}
                />
              </View>
            }
          />
        </View>
      )}

      {/* Undo surface for a swiped row. It sits above the list rather than inside
          it so the restored row never moves while the bar is visible, and it is
          announced politely so a screen reader hears both the removal and the
          recovery path. */}
      {undo ? (
        <View
          pointerEvents="box-none"
          style={[styles.undoLayer, { bottom: insets.bottom + Spacing.s4 }]}
        >
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.undoBar,
              {
                backgroundColor: ts.bg.surfaceContainerHighest,
                borderColor: ts.border.card,
              },
            ]}
          >
            <Text style={[Typography.labelMd, styles.undoText, { color: ts.raw.onSurface }]} numberOfLines={1}>
              Notification deleted
            </Text>
            <ScalePressable
              onPress={undoDelete}
              accessibilityRole="button"
              accessibilityLabel="Undo delete"
              hitSlop={PILL_HIT_SLOP}
              style={styles.undoAction}
            >
              <Undo2 size={16} color={ts.raw.primary} />
              <Text style={[Typography.labelBold, { color: ts.raw.primary }]}>Undo</Text>
            </ScalePressable>
          </View>
        </View>
      ) : null}

      <Modal
        visible={confirmClear}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        statusBarTranslucent
        onRequestClose={cancelClear}
      >
        <View
          style={[
            styles.modalBackdrop,
            { backgroundColor: ts.bg.overlay, justifyContent: isWide ? 'center' : 'flex-end' },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={cancelClear}
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
              Clear all notifications?
            </Text>
            <Text style={[Typography.labelMd, styles.modalCopy, { color: ts.raw.onSurfaceVariant }]}>
              {`This will permanently remove all ${records.length} notifications from your inbox. Past transactions and budgets remain untouched.`}
            </Text>
            <View style={styles.modalActions}>
              <PeachButton
                title="Yes, clear notifications"
                onPress={() => void confirmClearAll()}
                variant="destructive"
                size="lg"
                fullWidth
                isLoading={clearing}
                disabled={clearing}
              />
              <PeachButton
                title="Cancel"
                onPress={cancelClear}
                variant="neutral"
                size="lg"
                fullWidth
                disabled={clearing}
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
  emptyAction: {
    marginTop: Spacing.s5,
  },
  // Floating undo bar. Above the list, above the safe area inset, and never part of
  // the list so the restored row cannot shift while it is visible. The layer is
  // full width so the bar can centre and cap at the same content width as the list.
  undoLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.s4,
  },
  undoBar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    minHeight: 52,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  undoText: {
    flex: 1,
    minWidth: 0,
  },
  undoAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    minHeight: 44,
    paddingHorizontal: Spacing.s2,
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
