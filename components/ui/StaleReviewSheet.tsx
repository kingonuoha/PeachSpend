import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { History, X } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { databaseService } from '../../services/DatabaseService';
import {
  assignStaleReview,
  discardStaleReview,
  fileStaleReviewUncategorized,
  loadStaleReview,
  summarizeStaleReport,
} from '../../services/StaleReviewService';
import type { StaleDetectionDraft } from '../../data/DetectionDrafts';
import { PeachButton } from './PeachButton';
import { CategoryPickerSheet, type CaptureCategory } from '../capture/CategoryPickerSheet';
import { CategoryGlyph } from '../capture/CategoryGlyph';
import { CategoryTints, Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency } from '../../utils/currency';

const SHEET_MAX_WIDTH = 640;
const SHEET_MAX_HEIGHT = 720;
const SHEET_HEIGHT_RATIO = 0.92;

interface StaleReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

function tintFor(category: string): { light: readonly [string, string]; dark: readonly [string, string] } {
  const key = category.trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CategoryTints, key);
  return known ? CategoryTints[key as keyof typeof CategoryTints] : CategoryTints.other;
}

function ageLabel(ageMs: number): string {
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} overdue`;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  return `${hours} hour${hours === 1 ? '' : 's'} overdue`;
}

type LoadState = 'idle' | 'loading' | 'failed' | 'ready';
type BusyAction = null | 'discard' | 'file' | 'assign';

export function StaleReviewSheet({ visible, onClose, onCompleted }: StaleReviewSheetProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [stale, setStale] = useState<StaleDetectionDraft[]>([]);
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [reportLine, setReportLine] = useState<string | null>(null);
  const [failedLine, setFailedLine] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadState('loading');
    setReportLine(null);
    setFailedLine(null);
    try {
      const store = await databaseService.getDetectionDraftStore();
      const items = await loadStaleReview(store, Date.now());
      setStale(items);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, []);

  // Opening edge resets transient UI without setState in an effect body: the
  // render below derives on the visible edge, mirroring CategoryPickerSheet.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLoadState('loading');
      setReportLine(null);
      setFailedLine(null);
      setPickerOpen(false);
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void databaseService
      .getDetectionDraftStore()
      .then(store => loadStaleReview(store, Date.now()))
      .then(items => {
        if (!active) return;
        setStale(items);
        setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('failed');
      });
    return () => {
      active = false;
    };
  }, [visible, wasVisible]);

  useEffect(() => {
    if (!visible || loadState !== 'ready') return;
    void databaseService.getCategories().then(setCategories).catch(() => setCategories([]));
  }, [visible, loadState]);

  const runBatch = useCallback(
    async (action: Exclude<BusyAction, null>, work: (ids: string[]) => Promise<{ items: { id: string; status: string }[] }>) => {
      if (busy) return;
      const ids = stale.map(item => item.draft.id);
      if (ids.length === 0) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setBusy(action);
      setReportLine(null);
      setFailedLine(null);
      try {
        const report = await work(ids);
        const summary = summarizeStaleReport(report as never);
        const remaining = await loadStaleReview(await databaseService.getDetectionDraftStore(), Date.now());
        setStale(remaining);
        if (summary.failed > 0 || summary.notFound > 0 || summary.alreadyResolved > 0) {
          setFailedLine(
            `${summary.succeeded} of ${summary.total} filed. ${summary.failed + summary.notFound + summary.alreadyResolved} need another look and stay pending.`,
          );
        } else {
          setReportLine(
            action === 'discard'
              ? `Discarded ${summary.succeeded} of ${summary.total}.`
              : action === 'file'
                ? `Filed ${summary.succeeded} of ${summary.total} as uncategorized.`
                : `Assigned ${summary.succeeded} of ${summary.total} to the chosen category.`,
          );
        }
        onCompleted?.();
      } catch {
        setFailedLine('Could not complete that. Nothing was lost. Try again.');
      } finally {
        setBusy(null);
      }
    },
    [busy, onCompleted, stale],
  );

  const onDiscardAll = useCallback(() => {
    void runBatch('discard', async ids => discardStaleReview(await databaseService.getDetectionDraftStore(), ids, Date.now()));
  }, [runBatch]);

  const onFileAll = useCallback(() => {
    void runBatch('file', async ids =>
      fileStaleReviewUncategorized(await databaseService.getDetectionDraftStore(), ids, Date.now()),
    );
  }, [runBatch]);

  const onPickCategory = useCallback(
    (category: CaptureCategory) => {
      setPickerOpen(false);
      void runBatch('assign', async ids =>
        assignStaleReview(await databaseService.getDetectionDraftStore(), ids, category.id, Date.now()),
      );
    },
    [runBatch],
  );

  if (!visible) return null;

  const sheetMaxHeight = Math.min(SHEET_MAX_HEIGHT, windowHeight * SHEET_HEIGHT_RATIO);
  const sheetMaxWidth = Math.min(windowWidth, SHEET_MAX_WIDTH);
  const count = stale.length;
  const busyAll = busy !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { backgroundColor: ts.bg.overlay }]} accessibilityViewIsModal>
        <View
          accessibilityLabel="Stale detection review"
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              maxWidth: sheetMaxWidth,
              width: '100%',
              paddingBottom: Math.max(Spacing.s5, insets.bottom),
              backgroundColor: ts.raw.surface,
              borderColor: ts.border.card,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: ts.border.card }]} />
          <View style={[styles.header, { borderBottomColor: ts.border.subtle }]}>
            <View style={styles.headerText}>
              <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]}>
                {count === 0 ? 'Review pending detections' : `${count} pending ${count === 1 ? 'detection needs' : 'detections need'} review`}
              </Text>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>
                Older than 72 hours. Discard, file as uncategorized, or assign to one category.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close stale review"
              hitSlop={8}
              style={[styles.closeButton, { backgroundColor: ts.bg.elevated }]}
            >
              <X size={16} color={ts.icon.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loadState === 'loading' ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Loading stale detections"
                accessibilityState={{ busy: true }}
                style={styles.center}
              >
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Loading stale detections…</Text>
              </View>
            ) : loadState === 'failed' ? (
              <View style={styles.center}>
                <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>Could not load the review queue</Text>
                <Text style={[Typography.labelMd, styles.centerCopy, { color: ts.text.onSurfaceVariant }]}>
                  Something went wrong while reading it. Nothing was filed or discarded.
                </Text>
                <PeachButton title="Retry" onPress={() => void refresh()} variant="primary" size="md" />
              </View>
            ) : count === 0 ? (
              <View style={styles.center}>
                <Text style={[Typography.bodyBold, { color: ts.text.onSurface }]}>Nothing waiting for review</Text>
                <Text style={[Typography.labelMd, styles.centerCopy, { color: ts.text.onSurfaceVariant }]}>
                  Every detection is handled. New stale drafts will appear here after 72 hours.
                </Text>
                <PeachButton title="Done" onPress={onClose} variant="primary" size="md" />
              </View>
            ) : (
              <>
                <View style={styles.list}>
                  {stale.map(item => {
                    const tint = tintFor(item.draft.category);
                    const resolved = ts.isDark ? tint.dark : tint.light;
                    return (
                      <View
                        key={item.draft.id}
                        style={[styles.row, { backgroundColor: ts.bg.screen, borderColor: ts.border.card }]}
                      >
                        <View style={[styles.rowIcon, { backgroundColor: resolved[0] }]}>
                          <CategoryGlyph size={16} color={resolved[1]} />
                        </View>
                        <View style={styles.rowText}>
                          <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>
                            {item.draft.merchant}
                          </Text>
                          <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                            {ageLabel(item.ageMs)}
                          </Text>
                        </View>
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 0 }]}
                        >
                          {formatCurrency(item.draft.amount, item.draft.currency)}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.actions}>
                  <PeachButton
                    title={busy === 'assign' ? 'Assigning…' : `Assign all to one category (${count})`}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setPickerOpen(true);
                    }}
                    variant="primary"
                    size="lg"
                    radius={12}
                    fullWidth
                    isLoading={busy === 'assign'}
                    disabled={busyAll}
                  />
                  <View style={styles.secondaryRow}>
                    <View style={styles.half}>
                      <PeachButton
                        title={busy === 'file' ? 'Filing…' : 'File uncategorized'}
                        onPress={onFileAll}
                        variant="secondary"
                        size="sm"
                        radius={12}
                        fullWidth
                        isLoading={busy === 'file'}
                        disabled={busyAll}
                      />
                    </View>
                    <View style={styles.half}>
                      <PeachButton
                        title={busy === 'discard' ? 'Discarding…' : 'Discard all'}
                        onPress={onDiscardAll}
                        variant="destructive"
                        size="sm"
                        radius={12}
                        fullWidth
                        isLoading={busy === 'discard'}
                        disabled={busyAll}
                      />
                    </View>
                  </View>
                  <PeachButton
                    title="Review later"
                    onPress={onClose}
                    variant="neutral"
                    size="md"
                    radius={12}
                    fullWidth
                    disabled={busyAll}
                  />
                </View>

                {reportLine ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[styles.noteBox, { backgroundColor: ts.raw.successContainer, borderColor: ts.raw.successBorder }]}
                  >
                    <Text style={[Typography.labelMd, { color: ts.raw.successText }]}>{reportLine}</Text>
                  </View>
                ) : null}
                {failedLine ? (
                  <View
                    accessibilityRole="alert"
                    style={[styles.noteBox, { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 }]}
                  >
                    <Text style={[Typography.labelMd, { color: ts.text.error }]}>{failedLine}</Text>
                    <PeachButton title="Reload queue" onPress={() => void refresh()} variant="secondary" size="sm" disabled={busyAll} />
                  </View>
                ) : null}

                <View style={[styles.memoryBox, { backgroundColor: ts.bg.primary5, borderColor: ts.border.primary20 }]}>
                  <History size={14} color={ts.text.primary} />
                  <Text style={[Typography.micro, { color: ts.text.primary, flex: 1 }]}>
                    Batch assign keeps each item name and never writes per-merchant memory.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <CategoryPickerSheet
        visible={pickerOpen}
        categories={categories}
        flowType="expense"
        originLabel={count === 0 ? 'Stale review' : `${count} stale ${count === 1 ? 'detection' : 'detections'}`}
        onSelect={onPickCategory}
        onClose={() => setPickerOpen(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
  },
  handle: { width: 40, height: 4, borderRadius: Radii.full, alignSelf: 'center', marginBottom: Spacing.s3 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  headerText: { flex: 1, minWidth: 0 },
  closeButton: { width: 44, height: 44, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.s3, paddingVertical: Spacing.s3 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.s8, gap: Spacing.s2 },
  centerCopy: { textAlign: 'center' },
  list: { gap: Spacing.s2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  rowIcon: { width: 36, height: 36, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowText: { flex: 1, minWidth: 0 },
  actions: { gap: Spacing.s2, paddingTop: Spacing.s2 },
  secondaryRow: { flexDirection: 'row', gap: Spacing.s2 },
  half: { flex: 1 },
  noteBox: { padding: Spacing.s3, borderRadius: Radii.md, borderWidth: 1, gap: Spacing.s2 },
  memoryBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
});
