import { AUTO_CAPTURE_INCOME_CATEGORY } from '../data/AutoCaptureSource';
import type {
  CaptureCandidate,
  NativeAutoCaptureSourceAdapter,
  PendingAlertAction,
  PendingNativeDetection,
} from '../data/contracts';
import type {
  DetectionDraft,
  DetectionDraftInput,
  IncomeDetectionDraftInput,
} from '../data/DetectionDrafts';
import { buildIncomeInboxRow } from '../components/ui/autoCaptureConfirmIncome';
import { formatCurrency } from '../utils/currency';
import {
  applyAlertAction,
  buildDetectionInboxRow,
  type ApplyAlertActionDeps,
  type DetectionInboxRow,
} from './DetectionAlertService';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';

const MAX_DRAIN_PER_PASS = 50;

export interface NativeDetectionDrainDeps {
  consumeNext: () => Promise<PendingNativeDetection | null>;
  getDraft: (id: string) => Promise<DetectionDraft | null>;
  createExpenseDraft: (input: DetectionDraftInput) => Promise<DetectionDraft>;
  createIncomeDraft: (input: IncomeDetectionDraftInput) => Promise<DetectionDraft>;
  linkDraftRow: (draftId: string, notificationId: string) => Promise<DetectionDraft | null>;
  insertInboxRow: (row: DetectionInboxRow) => Promise<void>;
}

export async function drainNativeDetectionsWithDeps(deps: NativeDetectionDrainDeps): Promise<number> {
  let drained = 0;
  for (let guard = 0; guard < MAX_DRAIN_PER_PASS; guard += 1) {
    const detection = await deps.consumeNext();
    if (!detection) break;

    const existing = await deps.getDraft(detection.draftId);
    const amountText = formatCurrency(detection.amount, detection.currency);
    const sourceLabel = detection.appName || 'Payment app';

    if (existing) {
      if (!existing.notificationId && existing.status === 'pending') {
        const row = existing.kind === 'income'
          ? buildIncomeInboxRow(existing.id, existing.sourceName || existing.merchant, amountText, sourceLabel)
          : buildDetectionInboxRow(
              existing.id,
              {
                merchant: existing.merchant,
                amount: existing.amount,
                currency: existing.currency,
                category: existing.category,
                date: existing.detectedAt,
                note: existing.note ?? undefined,
                source: existing.source,
                origin: existing.origin ?? 'auto_capture',
              },
              amountText,
              sourceLabel,
            );
        await deps.insertInboxRow(row);
        await deps.linkDraftRow(existing.id, row.id);
      }
      continue;
    }

    if (detection.kind === 'income') {
      const sourceName = detection.sourceName?.trim() || detection.merchant;
      const note = detection.note || `Detected from ${sourceLabel}`;
      const draft = await deps.createIncomeDraft({
        id: detection.draftId,
        sourceName,
        amount: detection.amount,
        currency: detection.currency,
        category: AUTO_CAPTURE_INCOME_CATEGORY,
        note,
        source: 'auto_capture',
        origin: 'auto_capture',
        detectedAt: detection.receivedAt,
      });
      if (!draft.notificationId) {
        const row = buildIncomeInboxRow(draft.id, sourceName, amountText, sourceLabel);
        await deps.insertInboxRow(row);
        await deps.linkDraftRow(draft.id, row.id);
      }
      drained += 1;
      continue;
    }

    const note = detection.note || `Detected from ${sourceLabel}`;
    const candidate: CaptureCandidate = {
      merchant: detection.merchant,
      amount: detection.amount,
      currency: detection.currency,
      category: 'other',
      date: detection.receivedAt,
      note,
      source: 'auto_capture',
      origin: 'auto_capture',
    };
    const draft = await deps.createExpenseDraft({
      id: detection.draftId,
      merchant: candidate.merchant,
      amount: candidate.amount,
      currency: candidate.currency,
      category: candidate.category,
      note: candidate.note,
      source: 'auto_capture',
      detectedAt: detection.receivedAt,
    });
    if (!draft.notificationId) {
      const row = buildDetectionInboxRow(draft.id, candidate, amountText, sourceLabel);
      await deps.insertInboxRow(row);
      await deps.linkDraftRow(draft.id, row.id);
    }
    drained += 1;
  }
  return drained;
}

export interface OrderedDrainDeps {
  drainNative: () => Promise<number>;
  consumeNextAction: () => Promise<PendingAlertAction | null>;
  applyAction: (action: PendingAlertAction) => Promise<void>;
}

// Guarantees queued native detections are persisted into SQLite before any
// pending Confirm or Snooze alert action runs against those draft IDs.
export async function drainPendingNativeAndAlertActions(deps: OrderedDrainDeps): Promise<void> {
  await deps.drainNative();
  for (let guard = 0; guard < 25; guard += 1) {
    const next = await deps.consumeNextAction();
    if (!next) return;
    await deps.applyAction(next);
  }
}

export async function applyPendingAlertActionWithDeps(
  deps: ApplyAlertActionDeps,
  action: PendingAlertAction,
): Promise<void> {
  await applyAlertAction(deps, action);
}

let inFlightNativeDrain: Promise<number> | null = null;

export function drainNativeDetections(adapter: NativeAutoCaptureSourceAdapter): Promise<number> {
  if (adapter.capability !== 'available' || typeof adapter.consumePendingNativeDetections !== 'function') {
    return Promise.resolve(0);
  }
  if (inFlightNativeDrain) return inFlightNativeDrain;

  const consume = adapter.consumePendingNativeDetections.bind(adapter);
  inFlightNativeDrain = (async () => {
    try {
      const draftStore = await databaseService.getDetectionDraftStore();
      return await drainNativeDetectionsWithDeps({
        consumeNext: consume,
        getDraft: id => draftStore.getDetectionDraft(id),
        createExpenseDraft: input => draftStore.createDetectionDraft(input),
        createIncomeDraft: input => draftStore.createIncomeDetectionDraft(input),
        linkDraftRow: (draftId, notificationId) => draftStore.setDetectionDraftNotificationId(draftId, notificationId),
        insertInboxRow: row => databaseService.insertNotification(row),
      });
    } catch {
      logger.warn('Native detection drain failed', 'native_detection_drain_failed');
      return 0;
    } finally {
      inFlightNativeDrain = null;
    }
  })();

  return inFlightNativeDrain;
}
