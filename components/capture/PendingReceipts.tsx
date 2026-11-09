import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight, ImageDown, RotateCcw, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { formatRelativeDateWithTime } from '../../utils/dateFormat';
import { getAiErrorMessage, type AiErrorCode } from '../../ai/contracts';
import type { ReceiptDraft } from '../../data/ReceiptDrafts';

// Phase 11 B2-1, thumbnail added by B2-7. A queued receipt is real user data, so it
// gets a visible surface rather than living only in the database. Nothing here invents
// a value: the count, the source, the capture time, the attempt count and the stored
// error all come from the draft row the wave 0 store returns.
//
// This is a new component rather than an extension of an existing one: no surface in
// the tree renders receipt draft rows, and the two nearest candidates are the
// verification sheet (which edits one parsed candidate) and the processing overlay
// (which reports one in-flight request). Neither can list stored drafts, and
// stretching either would add a second job to a locked-pair component.
//
// Each row shows the stored draft image, because a list of receipts a user must
// recognise is not identifiable from a timestamp alone. The image is decorative: it
// carries no label, so a screen reader is never read a file path. When it cannot be
// loaded the row falls back to the glyph tile and stays fully operable, because image
// loading and the row's actions are independent.

const SOURCE_LABEL: Record<ReceiptDraft['source'], string> = {
  scan: 'Scanned photo',
  share: 'Shared photo',
};

const STATUS_LABEL: Record<ReceiptDraft['status'], string> = {
  pending_ocr: 'Waiting to process',
  processing: 'Interrupted last time',
  failed: 'Needs another try',
  saved: 'Saved',
};

const AI_ERROR_CODE_SET: ReadonlySet<string> = new Set<AiErrorCode>([
  'offline',
  'missing_key',
  'unauthorized',
  'rate_limited',
  'timeout',
  'illegible_image',
  'invalid_response',
  'provider',
]);

const isAiErrorCode = (value: string | null): value is AiErrorCode => value !== null && AI_ERROR_CODE_SET.has(value);

// The stored error code is the app's own vocabulary, so it is rendered through the
// same copy table the capture screens already use instead of a second wording.
export function draftFailureCopy(draft: ReceiptDraft): string | null {
  if (draft.status !== 'failed' || !isAiErrorCode(draft.lastErrorCode)) return null;
  return getAiErrorMessage(draft.lastErrorCode, 'receipt');
}

interface PendingReceiptsBarProps {
  count: number;
  onOpen: () => void;
}

export function PendingReceiptsBar({ count, onOpen }: PendingReceiptsBarProps) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${count} receipt${count === 1 ? '' : 's'} saved on this device. Review saved receipts`}
      style={({ pressed }) => [styles.bar, pressed && styles.barPressed]}
    >
      <ImageDown size={16} color={Colors.primaryContainer} />
      <Text numberOfLines={1} style={styles.barText}>
        {count} receipt{count === 1 ? '' : 's'} saved on this device
      </Text>
      <View style={styles.barAction}>
        <Text style={styles.barActionText}>Review</Text>
        <ChevronRight size={12} color={Colors.white} />
      </View>
    </Pressable>
  );
}

interface PendingReceiptsSheetProps {
  visible: boolean;
  drafts: readonly ReceiptDraft[];
  canProcess: boolean;
  blockerMessage: string | null;
  isProcessing: boolean;
  onClose: () => void;
  onProcessQueue: () => void;
  onQueueAgain: (draft: ReceiptDraft) => void;
  onDiscard: (draft: ReceiptDraft) => void;
}

// One row's thumbnail. It is decorative and it owns nothing but its own failed flag,
// so an image that cannot be read degrades to the glyph and cannot affect the row's
// actions, its uri, or the queue.
function DraftThumbnail({ imageUri }: { imageUri: string }) {
  const ts = useThemeStyles();
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.thumb, { backgroundColor: ts.bg.primary10, borderColor: ts.border.primary20 }]}
      >
        <ImageDown size={20} color={ts.text.primary} />
      </View>
    );
  }

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.thumb, { backgroundColor: ts.bg.low, borderColor: ts.border.subtle }]}
    >
      <Image
        source={{ uri: imageUri }}
        style={styles.thumbImage}
        contentFit="cover"
        accessible={false}
        accessibilityElementsHidden
        onError={() => setFailed(true)}
      />
    </View>
  );
}

export function PendingReceiptsSheet({
  visible,
  drafts,
  canProcess,
  blockerMessage,
  isProcessing,
  onClose,
  onProcessQueue,
  onQueueAgain,
  onDiscard,
}: PendingReceiptsSheetProps) {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: ts.bg.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss saved receipts" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: ts.raw.surface,
              borderColor: ts.border.card,
              paddingBottom: Math.max(Spacing.s4, insets.bottom),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: ts.raw.outline }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface }]}>
                Saved receipts
              </Text>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>
                Photos stay on this device until you process them.
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close saved receipts" hitSlop={8} style={styles.closeButton}>
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Close</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {drafts.length === 0 ? (
              <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>
                Nothing is waiting on this device.
              </Text>
            ) : (
              drafts.map((draft) => {
                const failure = draftFailureCopy(draft);
                return (
                  <View key={draft.id} style={[styles.row, { backgroundColor: ts.bg.low, borderColor: ts.border.subtle }]}>
                    <DraftThumbnail imageUri={draft.imageUri} />
                    <View style={styles.rowBody}>
                      <Text numberOfLines={1} style={[Typography.labelLg, { color: ts.text.onSurface }]}>
                        {SOURCE_LABEL[draft.source]}
                      </Text>
                      <Text numberOfLines={2} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                        {failure ?? STATUS_LABEL[draft.status]}
                      </Text>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                        {formatRelativeDateWithTime(draft.createdAt)}
                        {draft.attempts > 0 ? ` · ${draft.attempts} failed attempt${draft.attempts === 1 ? '' : 's'}` : ''}
                      </Text>
                    </View>
                    <View style={styles.rowActions}>
                      {draft.status === 'pending_ocr' ? null : (
                        <Pressable
                          onPress={() => onQueueAgain(draft)}
                          accessibilityRole="button"
                          accessibilityLabel={`Queue the ${SOURCE_LABEL[draft.source].toLowerCase()} for another attempt`}
                          hitSlop={8}
                          style={styles.rowAction}
                        >
                          <RotateCcw size={14} color={ts.text.primary} />
                          <Text style={[Typography.micro, { color: ts.text.primary }]}>Queue again</Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => onDiscard(draft)}
                        accessibilityRole="button"
                        accessibilityLabel={`Discard the ${SOURCE_LABEL[draft.source].toLowerCase()} and its photo`}
                        hitSlop={8}
                        style={styles.rowAction}
                      >
                        <Trash2 size={14} color={ts.text.error} />
                        <Text style={[Typography.micro, { color: ts.text.error }]}>Discard</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.footer, { borderColor: ts.border.subtle }]}>
            <Pressable
              onPress={onProcessQueue}
              disabled={!canProcess || isProcessing || drafts.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Process the oldest saved receipt"
              accessibilityState={{ disabled: !canProcess || isProcessing || drafts.length === 0, busy: isProcessing }}
              style={({ pressed }) => [
                styles.processButton,
                { backgroundColor: ts.raw.primary },
                pressed && styles.processButtonPressed,
                (!canProcess || isProcessing || drafts.length === 0) && styles.processButtonDisabled,
              ]}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.processButtonText}>Process saved receipts</Text>
              )}
            </Pressable>
            {blockerMessage ? (
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
                {blockerMessage}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    alignSelf: 'center',
    width: '92%',
    maxWidth: 600,
    minHeight: 44,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: `${Colors.primary}66`,
    backgroundColor: '#1C1730',
  },
  barPressed: { opacity: 0.85 },
  barText: { ...Typography.micro, color: Colors.white, flex: 1, minWidth: 0 },
  barAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, flexShrink: 0 },
  barActionText: { ...Typography.micro, color: Colors.white, fontFamily: 'Manrope_700Bold' },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxHeight: '78%',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    borderTopWidth: 1,
    paddingTop: Spacing.s3,
  },
  handle: { width: 40, height: 6, borderRadius: Radii.full, alignSelf: 'center', marginBottom: Spacing.s3 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingBottom: Spacing.s3,
  },
  sheetTitleWrap: { flexShrink: 1 },
  closeButton: { minHeight: 44, justifyContent: 'center' },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: Spacing.s5, paddingBottom: Spacing.s3, gap: Spacing.s2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, padding: Spacing.s2, borderRadius: Radii.sm, borderWidth: 1 },
  thumb: { width: 44, height: 44, borderRadius: Radii.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 0 },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, minHeight: 44, paddingHorizontal: Spacing.s1 },
  footer: { paddingHorizontal: Spacing.s5, paddingTop: Spacing.s3, gap: Spacing.s2, borderTopWidth: 1 },
  processButton: { minHeight: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.s4 },
  processButtonPressed: { opacity: 0.9 },
  processButtonDisabled: { opacity: 0.5 },
  processButtonText: { ...Typography.labelBold, color: Colors.white },
});
