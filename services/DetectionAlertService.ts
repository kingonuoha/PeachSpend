import { v4 as uuid } from 'uuid';
import type { Expense } from '../types/database';
import { formatCurrency } from '../utils/currency';
import { formatRelativeDateWithTime } from '../utils/dateFormat';
import type {
  CaptureCandidate,
  DetectionAlertContent,
  PendingAlertAction,
  SaveResolution,
} from '../data/contracts';
import type {
  DetectionDraft,
  DetectionDraftInput,
  DraftConfirmOutcome,
  DraftSnoozeOutcome,
} from '../data/DetectionDrafts';

// Phase 14 M2 detection alert service. Bridges the native rich alert and the
// D1 draft queue without adding a second writer: every table write below goes
// through the store or the insert function handed in, and the native receiver
// writes no table at all. Two entry points:
//
// - raiseDetectionAlert: a background detection becomes one pending draft plus
//   one unread inbox row plus one device ping. Foreground detections never
//   reach it (the overlay sheet owns those), so one detection yields exactly
//   one draft.
// - applyAlertAction: a Confirm or Remind later intent recorded by the native
//   receiver is applied through the shared store boundary, then the device
//   ping for that draft is canceled. Snooze never touches the accounted flag,
//   so the inbox row stays unread (pinned by D1 tests).

export const DETECTED_FROM_PREFIX = 'Detected from ';
const FALLBACK_SOURCE_LABEL = 'Payment app';

export function sourceLabelFor(candidate: Pick<CaptureCandidate, 'note'>): string {
  const note = candidate.note?.trim() ?? '';
  if (note.startsWith(DETECTED_FROM_PREFIX)) {
    const label = note.slice(DETECTED_FROM_PREFIX.length).trim();
    if (label) return label;
  }
  return FALLBACK_SOURCE_LABEL;
}

export interface DetectionInboxRow {
  id: string;
  title: string;
  body: string;
  type: string;
  data: string;
}

// Builds the inbox row for a fresh draft. The data payload carries the draft
// id link the S-14 read path keys on; the title and body carry formatted
// parsed fields only, never raw notification text.
export function buildDetectionInboxRow(draftId: string, candidate: CaptureCandidate, amountText: string, sourceLabel: string): DetectionInboxRow {
  return {
    id: uuid(),
    title: `Payment detected: ${candidate.merchant}`,
    body: `${amountText} from ${sourceLabel}. Open to confirm, edit, or snooze.`,
    type: 'transaction',
    data: JSON.stringify({ draftId }),
  };
}

export interface RaiseDetectionAlertDeps {
  createDraft: (input: DetectionDraftInput) => Promise<DetectionDraft>;
  linkDraftRow: (draftId: string, notificationId: string) => Promise<DetectionDraft | null>;
  insertInboxRow: (row: DetectionInboxRow) => Promise<void>;
  showAlert: (content: DetectionAlertContent) => Promise<{ posted: boolean }>;
}

export interface RaisedDetectionAlert {
  draft: DetectionDraft;
  inboxId: string;
  posted: boolean;
}

export async function raiseDetectionAlert(
  deps: RaiseDetectionAlertDeps,
  candidate: CaptureCandidate,
  detectedAt: number,
): Promise<RaisedDetectionAlert> {
  const amountText = formatCurrency(candidate.amount, candidate.currency);
  const sourceLabel = sourceLabelFor(candidate);
  // The draft validates first, so a malformed amount fails before any row or
  // ping exists. The draft carries the inbox row id from creation, and the
  // row carries the draft id back: the pair the accounted contract needs.
  const draft = await deps.createDraft({
    merchant: candidate.merchant,
    amount: candidate.amount,
    currency: candidate.currency,
    category: candidate.category,
    note: candidate.note,
    source: 'auto_capture',
    detectedAt,
  });
  const row = buildDetectionInboxRow(draft.id, candidate, amountText, sourceLabel);
  await deps.insertInboxRow(row);
  // Link the draft to its row for the accounted write. Without the link the
  // resolve path could never mark the row accounted, so a null link fails the
  // raise loudly instead of shipping a row that stays unread forever.
  const linked = await deps.linkDraftRow(draft.id, row.id);
  if (!linked) throw new Error('Detection draft row link failed');
  let posted = false;
  try {
    posted = (await deps.showAlert({
      draftId: draft.id,
      merchant: candidate.merchant,
      amountText,
      sourceLabel,
      timeText: formatRelativeDateWithTime(detectedAt),
    })).posted;
  } catch {
    posted = false;
  }
  return { draft: linked, inboxId: row.id, posted };
}

export type AlertActionOutcome =
  | { status: 'confirmed'; expenseId: string }
  | { status: 'duplicate' }
  | { status: 'snoozed'; snoozedUntil: number }
  | { status: 'already_resolved' }
  | { status: 'not_found' };

export interface ApplyAlertActionDeps {
  confirmDraft: (id: string, resolveSave: (candidate: CaptureCandidate) => Promise<SaveResolution<Expense>>) => Promise<DraftConfirmOutcome>;
  snoozeDraft: (id: string) => Promise<DraftSnoozeOutcome>;
  cancelAlert: (draftId: string) => Promise<void>;
  resolveSave: (candidate: CaptureCandidate) => Promise<SaveResolution<Expense>>;
}

// Applies one receiver action through the shared store boundary, then clears
// the device ping for that draft in every outcome: the user acted, so the ping
// has served its purpose even when the draft itself stays pending (duplicate)
// or is already gone (a sheet resolved it first). Snooze sets the 24 hour
// device suppression and never touches the accounted flag, so the inbox row
// stays unread until the draft is confirmed, discarded, or filed.
//
// The saved expense side effects (saved notification, achievements check) are
// deliberately skipped here: the answered ping is notification enough, and a
// second device ping for the same detection would be noise. Both run on the
// next foreground save path as today.
export async function applyAlertAction(
  deps: ApplyAlertActionDeps,
  action: PendingAlertAction,
): Promise<AlertActionOutcome> {
  if (action.action === 'snooze') {
    const outcome = await deps.snoozeDraft(action.draftId);
    await deps.cancelAlert(action.draftId).catch(() => undefined);
    if (outcome.status === 'snoozed') return { status: 'snoozed', snoozedUntil: outcome.snoozedUntil };
    return { status: outcome.status };
  }
  const outcome = await deps.confirmDraft(action.draftId, deps.resolveSave);
  await deps.cancelAlert(action.draftId).catch(() => undefined);
  if (outcome.status === 'confirmed') return { status: 'confirmed', expenseId: outcome.expenseId };
  return { status: outcome.status };
}
