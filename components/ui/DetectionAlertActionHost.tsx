import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { databaseService } from '../../services/DatabaseService';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import type { CaptureCandidate, IncomeCandidate, PendingAlertAction, SaveResolution } from '../../data/contracts';
import type { Expense, Income } from '../../types/database';
import { resolveExpenseSave, resolveIncomeSave } from '../../data/CaptureService';
import { applyAlertAction } from '../../services/DetectionAlertService';
import { drainNativeDetections, drainPendingNativeAndAlertActions } from '../../services/NativeDetectionDrainService';
import { logger } from '../../utils/logger';

// Phase 14 M2 + Phase 17 M2: drains queued native detections into SQLite first,
// then drains native detection alert actions (Confirm / Snooze) through the
// shared D1 store boundary. Mounted outside BiometricGate so background-queued
// detections and alert actions complete without waiting for biometric UI unlock,
// while rendering nothing itself.
export default function DetectionAlertActionHost() {
  const adapter = useMemo(() => createNativeAutoCaptureAdapter(), []);
  const draining = useRef(false);

  useEffect(() => {
    let disposed = false;

    const apply = async (action: PendingAlertAction): Promise<void> => {
      try {
        const draftStore = await databaseService.getDetectionDraftStore();
        const repository = await databaseService.getCaptureRepository();
        const resolveSave = (candidate: CaptureCandidate): Promise<SaveResolution<Expense>> =>
          resolveExpenseSave(repository, candidate);
        const resolveIncome = (candidate: IncomeCandidate): Promise<SaveResolution<Income>> =>
          resolveIncomeSave(repository, candidate);
        await applyAlertAction(
          {
            getDraft: id => draftStore.getDetectionDraft(id),
            confirmDraft: (id, saver) => draftStore.confirmDetectionDraft(id, saver),
            confirmIncomeDraft: (id, saver) => draftStore.confirmIncomeDetectionDraft(id, saver),
            snoozeDraft: id => draftStore.snoozeDetectionDraft(id),
            cancelAlert: id => adapter.cancelDetectionAlert?.(id) ?? Promise.resolve(),
            resolveSave,
            resolveIncomeSave: resolveIncome,
          },
          action,
        );
      } catch {
        logger.warn('Detection alert action failed', 'detection_alert_action_failed');
      }
    };

    const drain = async (): Promise<void> => {
      if (draining.current) return;
      draining.current = true;
      try {
        await drainPendingNativeAndAlertActions({
          drainNative: () => drainNativeDetections(adapter),
          consumeNextAction: async () => {
            if (disposed) return null;
            return (await adapter.consumePendingAlertAction?.()) ?? null;
          },
          applyAction: async action => {
            if (disposed) return;
            await apply(action);
          },
        });
      } catch {
        return;
      } finally {
        draining.current = false;
      }
    };

    void drain();
    const subscription = adapter.subscribeAlertActions?.(action => {
      void drainNativeDetections(adapter).then(() => apply(action));
    });
    const appState = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void drain();
    });
    return () => {
      disposed = true;
      subscription?.();
      appState.remove();
    };
  }, [adapter]);

  return null;
}
