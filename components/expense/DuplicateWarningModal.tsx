import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, ClipboardList, Info } from 'lucide-react-native';
import { format } from 'date-fns';
import { CategoryTints, Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { DuplicateMatch } from '../../data/contracts';
import { CategoryGlyph } from '../capture/CategoryGlyph';
import { PeachButton } from '../ui/PeachButton';
import { formatCurrency } from '../../utils/currency';
import { formatRelativeDate, formatRelativeDateWithTime } from '../../utils/dateFormat';

// Pair caps the sheet at 92% of the viewport and the comparison/explainer body
// above a fixed action footer. Both are upper bounds, never device widths.
const SHEET_MAX_HEIGHT = 720;
const SHEET_MAX_WIDTH = 560;
const SHEET_HEIGHT_RATIO = 0.92;

/** The pending entry awaiting the duplicate decision. */
export interface DuplicateEntryPreview {
  /** Expense merchant or income source name. */
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  type: 'expense' | 'income';
  /** Epoch ms of the pending entry. Defaults to now when omitted. */
  date?: number;
}

interface DuplicateWarningModalProps {
  visible: boolean;
  duplicate: DuplicateMatch | null;
  /** Live pending entry from the owning capture flow. Never a placeholder. */
  incoming: DuplicateEntryPreview;
  onSaveAnyway: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
}

type PendingAction = 'save' | 'discard' | null;

function tintFor(category: string): { light: readonly [string, string]; dark: readonly [string, string] } {
  const key = category.trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CategoryTints, key);
  return known ? CategoryTints[key as keyof typeof CategoryTints] : CategoryTints.other;
}

export const DuplicateWarningModal: React.FC<DuplicateWarningModalProps> = ({
  visible,
  duplicate,
  incoming,
  onSaveAnyway,
  onDiscard,
}) => {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [pending, setPending] = useState<PendingAction>(null);
  const [failed, setFailed] = useState(false);
  // Captured once per mount. Consumers mount the sheet per duplicate session, so
  // this is the pending entry time and keeps render pure.
  const [openedAt] = useState(() => Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (action: PendingAction, handler: () => void | Promise<void>) => {
    if (pending) return;
    setPending(action);
    setFailed(false);
    try {
      await handler();
    } catch {
      if (mountedRef.current) setFailed(true);
    } finally {
      if (mountedRef.current) setPending(null);
    }
  }, [pending]);

  if (!duplicate) return null;

  const existing = duplicate.existing;
  const isIncome = 'source' in existing;
  const existingName = isIncome ? existing.source : existing.merchant;
  // Income has no stored capture-source label, so it is omitted rather than faked.
  const existingSourceLabel = isIncome ? null : (existing.scanned ? 'Scanned Receipt' : 'Manual Entry');
  const existingAmount = formatCurrency(existing.amount, existing.currency);
  const incomingAmount = formatCurrency(incoming.amount, incoming.currency);
  const incomingDate = incoming.date ?? openedAt;
  const month = format(new Date(incomingDate), 'MMMM');
  const busy = pending !== null;

  const explainer = isIncome
    ? `Keeping both will increase your recorded monthly inflow by another ${incomingAmount}. Discarding will cancel this capture with zero changes.`
    : `Keeping both will add another ${incomingAmount} to your ${month} spending totals. Discarding will cancel this capture with zero changes.`;

  const sheetMaxHeight = Math.min(SHEET_MAX_HEIGHT, windowHeight * SHEET_HEIGHT_RATIO);
  const sheetMaxWidth = Math.min(windowWidth, SHEET_MAX_WIDTH);
  const tintCategory = tintFor(incoming.category);
  const resolvedTint = ts.isDark ? tintCategory.dark : tintCategory.light;

  return (
    <Modal
      visible={visible}
      transparent
      // Slide translate is the pair's sheet transition; reduce-motion replaces it
      // with an instant present so no transform animation runs.
      animationType={reduceMotion ? 'none' : 'slide'}
      statusBarTranslucent
      // Design state 10: accidental dismissal is guarded. An explicit choice is required.
      onRequestClose={() => undefined}
    >
      <View style={[styles.overlay, { backgroundColor: ts.bg.overlay }]} accessibilityViewIsModal>
        <View
          accessibilityLabel="Possible duplicate entry"
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              maxWidth: sheetMaxWidth,
              width: '100%',
              paddingBottom: Math.max(Spacing.s7, insets.bottom),
              backgroundColor: ts.raw.surface,
              borderTopLeftRadius: Radii.xl,
              borderTopRightRadius: Radii.xl,
              borderTopWidth: 1,
              borderColor: ts.border.card,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: ts.border.card }]} />

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View
                style={[
                  styles.warningIcon,
                  { backgroundColor: ts.raw.warningContainer, borderColor: ts.raw.warningBorder },
                ]}
              >
                <AlertTriangle size={24} color={ts.raw.warning} />
              </View>
              <View style={styles.headerText}>
                <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]}>
                  Possible Duplicate Entry
                </Text>
                <Text style={[Typography.bodyRegular, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>
                  An identical transaction was already recorded in your ledger within the last 24 hours.
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.comparison,
                { backgroundColor: ts.bg.screen, borderColor: ts.border.card },
              ]}
            >
              <View style={styles.row}>
                <View style={styles.rowLabel}>
                  <View style={[styles.dot, { backgroundColor: ts.raw.primary }]} />
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6 }]}>
                    Attempted Entry
                  </Text>
                </View>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                  {formatRelativeDate(incomingDate)}
                </Text>
              </View>

              <View style={styles.entryRow}>
                <View style={styles.entryLeft}>
                  <View style={[styles.entryIcon, { backgroundColor: resolvedTint[0] }]}>
                    <CategoryGlyph size={16} color={resolvedTint[1]} />
                  </View>
                  <View style={styles.entryText}>
                    <Text numberOfLines={1} style={[Typography.labelBold, { color: ts.text.onSurface }]}>
                      {incoming.merchant}
                    </Text>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                      {incoming.category}
                    </Text>
                  </View>
                </View>
                <View style={styles.entryRight}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.headlineMd, { color: ts.text.onSurface, fontVariant: ['tabular-nums'] }]}>
                    {incomingAmount}
                  </Text>
                  <Text style={[Typography.micro, { color: incoming.type === 'income' ? Colors.success : ts.text.error }]}>
                    {incoming.type === 'income' ? '+ Income Inflow' : '- Expense Outflow'}
                  </Text>
                </View>
              </View>

              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: ts.border.card }]} />
                <View
                  style={[
                    styles.deltaBadge,
                    { backgroundColor: ts.raw.surface, borderColor: ts.border.card },
                  ]}
                >
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                    {`Logged ${formatRelativeDate(existing.date)}`}
                  </Text>
                </View>
                <View style={[styles.dividerLine, { backgroundColor: ts.border.card }]} />
              </View>

              <View style={[styles.entryRow, styles.existingRow]}>
                <View style={styles.entryLeft}>
                  <View
                    style={[
                      styles.entryIcon,
                      { backgroundColor: ts.raw.surface, borderWidth: 1, borderColor: ts.border.card },
                    ]}
                  >
                    <ClipboardList size={16} color={ts.text.onSurfaceVariant} />
                  </View>
                  <View style={styles.entryText}>
                    <View style={styles.inline}>
                      <Text numberOfLines={1} style={[Typography.labelLg, { color: ts.text.onSurface, flexShrink: 1 }]}>
                        {existingName}
                      </Text>
                      <View style={[styles.ledgerTag, { backgroundColor: ts.bg.elevated }]}>
                        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>In Ledger</Text>
                      </View>
                    </View>
                    <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                      {existingSourceLabel
                        ? `${formatRelativeDateWithTime(existing.date)} • ${existingSourceLabel}`
                        : formatRelativeDateWithTime(existing.date)}
                    </Text>
                  </View>
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.labelBold, { color: ts.text.onSurface, flexShrink: 0, fontVariant: ['tabular-nums'] }]}>
                  {existingAmount}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.explainer,
                { backgroundColor: ts.raw.warningContainer, borderColor: ts.raw.warningBorder },
              ]}
            >
              <Info size={16} color={ts.raw.warning} style={styles.explainerIcon} />
              <Text style={[Typography.labelMd, { color: ts.raw.warningContainerText, flex: 1 }]}>
                {explainer}
              </Text>
            </View>

            {failed ? (
              <View
                accessibilityRole="alert"
                style={[
                  styles.errorBox,
                  { backgroundColor: ts.bg.error10, borderColor: ts.border.error20 },
                ]}
              >
                <Text style={[Typography.labelMd, { color: ts.text.error }]}>
                  Could not complete that. Nothing was saved. Try again, or discard.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <PeachButton
              title={pending === 'save' ? 'Persisting to Ledger...' : 'Save Anyway (Keep Both)'}
              onPress={() => { void run('save', onSaveAnyway); }}
              variant="primary"
              size="xl"
              fullWidth
              isLoading={pending === 'save'}
              disabled={busy}
            />
            <PeachButton
              title={pending === 'discard' ? 'Discarding Record...' : 'Discard Duplicate'}
              onPress={() => { void run('discard', onDiscard); }}
              variant="secondary"
              size="xl"
              fullWidth
              isLoading={pending === 'discard'}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s5,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: Radii.full,
    alignSelf: 'center',
    marginBottom: Spacing.s3,
  },
  body: { flexShrink: 1 },
  bodyContent: { gap: Spacing.s4 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s3 },
  warningIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  headerText: { flex: 1, minWidth: 0 },
  comparison: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: Spacing.s3,
    gap: Spacing.s3,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: Radii.full },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
  },
  existingRow: { opacity: 0.8 },
  entryLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flex: 1, minWidth: 0 },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryText: { flex: 1, minWidth: 0 },
  entryRight: { alignItems: 'flex-end', flexShrink: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  ledgerTag: { paddingHorizontal: Spacing.s1, paddingVertical: 1, borderRadius: Radii.sm },
  dividerRow: { flexDirection: 'row', alignItems: 'center' },
  dividerLine: { flex: 1, height: 1 },
  deltaBadge: {
    paddingHorizontal: Spacing.s3,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 1,
    marginHorizontal: Spacing.s2,
  },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s2,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  explainerIcon: { marginTop: 2 },
  errorBox: { padding: Spacing.s3, borderRadius: Radii.md, borderWidth: 1 },
  actions: { marginTop: Spacing.s4, gap: Spacing.s2 },
});
