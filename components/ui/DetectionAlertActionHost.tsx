import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { databaseService } from '../../services/DatabaseService';
import { createNativeAutoCaptureAdapter } from '../../data/NativeAutoCaptureAdapter';
import type { CaptureCandidate, PendingAlertAction, SaveResolution } from '../../data/contracts';
import type { Expense } from '../../types/database';
import { resolveExpenseSave } from '../../data/CaptureService';
import { applyAlertAction } from '../../services/DetectionAlertService';
import { logger } from '../../utils/logger';

// Phase 14 M2: drains native detection alert actions. The receiver records
// every Confirm and Remind later tap durably; this host applies each record
// through the shared D1 store boundary (confirm via the shared save boundary,
// snooze via the 24 hour device suppression) and cancels the device ping for
// that draft. It drains on mount (cold start after a dead process tap),
// subscribes to the live copy while the runtime is up, and re drains on
// foreground as a backup. It renders nothing and reads no ledger state.
//
// The loop consumes one record per native call until the queue is empty. A
// corrupt record parses to null and is skipped by the adapter; an apply
// failure is logged with the draft id only (never raw notification text) and
// the loop continues with the next record.
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
        await applyAlertAction(
          {
            confirmDraft: (id, saver) => draftStore.confirmDetectionDraft(id, saver),
            snoozeDraft: id => draftStore.snoozeDetectionDraft(id),
            cancelAlert: id => adapter.cancelDetectionAlert?.(id) ?? Promise.resolve(),
            resolveSave,
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
        for (let guard = 0; guard < 25; guard += 1) {
          if (disposed) return;
          const next = await adapter.consumePendingAlertAction?.();
          if (!next) return;
          await apply(next);
        }
      } catch {
        return;
      } finally {
        draining.current = false;
      }
    };

    void drain();
    const subscription = adapter.subscribeAlertActions?.(action => {
      void apply(action);
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
