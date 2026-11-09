import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { Radii, Spacing, Typography } from '../constants/tokens';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useToast } from '../components/ui/ToastProvider';
import { useAchievements } from '../components/ui/AchievementProvider';
import { PeachButton } from '../components/ui/PeachButton';
import { VerificationSheet } from '../components/expense/VerificationSheet';
import { DuplicateWarningModal } from '../components/expense/DuplicateWarningModal';
import { databaseService } from '../services/DatabaseService';
import { notificationService } from '../services/NotificationService';
import { logger } from '../utils/logger';
import { formatCurrency } from '../utils/currency';
import {
  resolveExpenseBatchSave,
  runCaptureSideEffects,
  type CaptureCandidate,
  type DuplicateMatch,
} from '../data';
import type { ScannedReceipt } from '../types/gemini';

// Phase 11 B2-4. `/expense-review` used to be a second, standalone receipt review
// screen: its own merchant/amount/category inputs, a free text category that bypassed
// the category table, and a red error banner raised at mount before the user had
// touched anything. That body is gone.
//
// The route still exists because `app/_layout.tsx` registers it and a deep link may
// still arrive with a payload. It is now a thin alias: it parses the payload into the
// shape the canonical component takes and mounts `VerificationSheet`, which owns every
// field, validation rule, item edit and duplicate check. Nothing here re-implements
// any of that. A link that carries no usable payload says so and offers the capture
// screen, rather than mounting an empty review.

type ReviewPayload = Partial<Pick<ScannedReceipt, 'merchant' | 'currency' | 'category' | 'note'>> & {
  amount?: number | string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export function parseReviewPayload(value: string | undefined): ScannedReceipt | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const payload = parsed as ReviewPayload;
  const amount = typeof payload.amount === 'number' ? payload.amount : Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const category = typeof payload.category === 'string' ? payload.category.trim() : '';
  if (!category) return null;
  const currency = typeof payload.currency === 'string' ? payload.currency.trim() : '';
  if (!currency) return null;
  return {
    merchant: typeof payload.merchant === 'string' ? payload.merchant : '',
    amount,
    category,
    currency,
    note: typeof payload.note === 'string' ? payload.note : undefined,
  };
}

export default function ExpenseReviewAlias() {
  const ts = useThemeStyles();
  const router = useRouter();
  const { showToast } = useToast();
  const { checkForNewAchievements } = useAchievements();
  const { data } = useLocalSearchParams<{ data?: string }>();
  const parsed = useMemo(() => parseReviewPayload(data), [data]);
  const [reviewed, setReviewed] = useState<ScannedReceipt[] | null>(parsed ? [parsed] : null);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMatch | null>(null);
  const [pendingBatch, setPendingBatch] = useState<ScannedReceipt[] | null>(null);

  const closeRoute = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/scan');
  }, [router]);

  const persist = useCallback(async (items: ScannedReceipt[], decision: 'confirm' | 'save_anyway') => {
    const repository = await databaseService.getCaptureRepository();
    const now = Date.now();
    const candidates: CaptureCandidate[] = items.map(item => ({
      merchant: item.merchant ?? '',
      amount: item.amount,
      currency: item.currency,
      category: item.category,
      source: 'ocr' as const,
      origin: 'scan' as const,
      note: item.note,
      scanned: true,
      date: item.date ?? now,
    }));
    const resolution = await resolveExpenseBatchSave(repository, candidates, decision);
    if (resolution.status === 'needs_review') {
      const firstMatch = resolution.matches.find(match => 'match' in match)?.match;
      if (firstMatch) {
        setDuplicateWarning(firstMatch);
        setPendingBatch(items);
      }
      return;
    }
    if (resolution.status !== 'saved') return;
    for (const [index, candidate] of candidates.entries()) {
      await runCaptureSideEffects(
        { status: 'saved', record: resolution.records[index], origin: { source: candidate.source, origin: 'scan', reviewed: true } },
        candidate,
        {
          onExpenseSaved: checkForNewAchievements,
          onIncomeSaved: async () => undefined,
          scheduleNotification: (savedCandidate) => {
            if ('merchant' in savedCandidate) {
              notificationService.scheduleExpenseNotification(savedCandidate.merchant, formatCurrency(savedCandidate.amount, savedCandidate.currency));
            }
          },
        },
      );
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setReviewed(null);
    showToast(`Saved ${formatCurrency(items.reduce((sum, item) => sum + item.amount, 0), items[0]?.currency ?? '')}`, 'success');
    closeRoute();
  }, [checkForNewAchievements, closeRoute, showToast]);

  const handleConfirm = useCallback(async (items: ScannedReceipt[]) => {
    try {
      await persist(items, 'confirm');
    } catch {
      logger.error('Failed to save reviewed expense', 'expense_review_save_failed');
      showToast('Could not save this receipt. Nothing was lost.', 'error');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [persist, showToast]);

  if (!reviewed) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top', 'bottom']}>
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.text.onSurface, textAlign: 'center' }]}>
            Nothing to review
          </Text>
          <Text style={[Typography.bodyRegular, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
            This link carried no usable receipt data, so there is nothing to verify. Scan or share a receipt and the
            same review opens with it.
          </Text>
          <PeachButton title="Go to capture" variant="primary" size="lg" fullWidth onPress={closeRoute} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: ts.bg.screen }]}>
      <VerificationSheet
        isVisible
        data={reviewed}
        origin="scan"
        onConfirm={handleConfirm}
        onCancel={() => { setReviewed(null); closeRoute(); }}
      />
      {duplicateWarning && pendingBatch ? (
        <DuplicateWarningModal
          visible
          duplicate={duplicateWarning}
          incoming={{
            merchant: pendingBatch[0]?.merchant ?? '',
            amount: pendingBatch.reduce((sum, item) => sum + item.amount, 0),
            currency: pendingBatch[0]?.currency ?? '',
            category: pendingBatch[0]?.category ?? '',
            type: 'expense',
          }}
          onSaveAnyway={() => {
            const batch = pendingBatch;
            setDuplicateWarning(null);
            setPendingBatch(null);
            void persist(batch, 'save_anyway');
          }}
          onDiscard={() => {
            setDuplicateWarning(null);
            setPendingBatch(null);
            setReviewed(null);
            closeRoute();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s4,
    paddingHorizontal: Spacing.s7,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    borderRadius: Radii.xl,
  },
});
