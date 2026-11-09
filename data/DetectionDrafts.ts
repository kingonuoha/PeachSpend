import type * as SQLite from 'expo-sqlite';
import { v4 as uuid } from 'uuid';
import type { Expense } from '../types/database';
import { resolveCurrency } from '../utils/currency';
import { EXPENSE_INSERT_SQL, buildExpenseRecord, expenseInsertParams } from './CaptureRepository';
import {
  assertValidCaptureCandidate,
  type CaptureCandidate,
  type CaptureEventInput,
  type CaptureSource,
  type DuplicateMatch,
  type SaveResolution,
} from './contracts';

// Phase 14 D1. Detection draft queue. An auto-capture detection that awaits
// user confirmation is persisted here, so it survives reboot, can be snoozed,
// and ages into the stale review queue. The queue never files on its own:
// every filing is a user tap through the resolve functions below.

// A draft still pending this long after first detection joins the forced
// review queue. One named constant, so ESC-14-01 can move it in one line.
// The stale clock runs from first detection, never from a snooze.
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;
// Remind later snoozes the device re-ping this long. It suppresses only the
// re-ping: the draft stays pending and countable, and the stale clock above
// keeps running from first detection.
export const DRAFT_SNOOZE_MS = 24 * 60 * 60 * 1000;
// The only category the stale queue may file without a caller supplied one.
// It is a fixed bucket, never a guessed category.
export const UNCATEGORIZED_FILING_CATEGORY = 'other';

export const DETECTION_DRAFT_STATUSES = ['pending', 'confirmed', 'discarded', 'filed'] as const;
export type DetectionDraftStatus = (typeof DETECTION_DRAFT_STATUSES)[number];
export type DetectionDraftTerminalStatus = 'confirmed' | 'discarded' | 'filed';

export interface DetectionDraft {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note: string | null;
  source: CaptureSource;
  detectedAt: number;
  snoozedUntil: number | null;
  status: DetectionDraftStatus;
  notificationId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DetectionDraftInput {
  merchant: string;
  amount: number;
  currency: string;
  category?: string;
  note?: string;
  source?: CaptureSource;
  detectedAt?: number;
  notificationId?: string;
}

export interface StaleDetectionDraft {
  draft: DetectionDraft;
  ageMs: number;
}

export type DraftItemStatus = 'discarded' | 'filed' | 'assigned' | 'not_found' | 'already_resolved' | 'failed';

export interface DraftItemOutcome {
  id: string;
  status: DraftItemStatus;
  expenseId?: string;
  errorCode?: string;
}

export interface DraftBatchReport {
  items: DraftItemOutcome[];
}

export type DraftSnoozeOutcome =
  | { status: 'snoozed'; snoozedUntil: number; draft: DetectionDraft }
  | { status: 'not_found'; id: string }
  | { status: 'already_resolved'; id: string };

export type DraftConfirmOutcome =
  | { status: 'confirmed'; draft: DetectionDraft; expenseId: string }
  | { status: 'duplicate'; duplicate: DuplicateMatch }
  | { status: 'not_found'; id: string }
  | { status: 'already_resolved'; id: string };

// The shared confirm boundary, injected so the store never reimplements the
// duplicate check or the teaching write. Production passes
// candidate => resolveExpenseSave(repository, candidate).
export type ResolveDetectionSave = (candidate: CaptureCandidate) => Promise<SaveResolution<Expense>>;

// The only event sink the store writes to. The app's capture repository
// satisfies this structurally (recordEvent is forwarded by its wrapper), so no
// new repository method is needed for the queue.
export interface DetectionDraftEvents {
  recordEvent(event: CaptureEventInput): Promise<string>;
}

export type DetectionDraftField = 'amount' | 'currency' | 'category';

export class DetectionDraftValidationError extends Error {
  readonly code = 'detection_draft_validation';
  constructor(readonly field: DetectionDraftField) {
    super(`Detection draft field is required or invalid: ${field}`);
    this.name = 'DetectionDraftValidationError';
  }
}

interface DetectionDraftRow {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note: string | null;
  source: string;
  detected_at: number;
  snoozed_until: number | null;
  status: string;
  notification_id: string | null;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = 'id, merchant, amount, currency, category, note, source, detected_at, snoozed_until, status, notification_id, created_at, updated_at';

function rowToDetectionDraft(row: DetectionDraftRow): DetectionDraft {
  return {
    id: row.id,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    note: row.note,
    source: row.source as CaptureSource,
    detectedAt: row.detected_at,
    snoozedUntil: row.snoozed_until,
    status: row.status as DetectionDraftStatus,
    notificationId: row.notification_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertDraftStatus(status: string): asserts status is DetectionDraftStatus {
  if (!(DETECTION_DRAFT_STATUSES as readonly string[]).includes(status)) throw new DetectionDraftValidationError('category');
}

export function isStaleDraft(draft: DetectionDraft, now = Date.now()): boolean {
  return draft.status === 'pending' && now - draft.detectedAt > STALE_AFTER_MS;
}

export function isRePingSuppressed(draft: DetectionDraft, now = Date.now()): boolean {
  return draft.snoozedUntil !== null && now < draft.snoozedUntil;
}

export function toStaleDraft(draft: DetectionDraft, now = Date.now()): StaleDetectionDraft {
  return { draft, ageMs: now - draft.detectedAt };
}

// The filing note records where the expense came from, never a guessed
// category. The original note is preserved in front of the marker.
export function buildFilingNote(note: string | null): string {
  const trimmed = note?.trim() ?? '';
  return trimmed ? `${trimmed} | Filed from stale review` : 'Filed from stale review';
}

function toFilingCandidate(draft: DetectionDraft, category: string, note: string | null): CaptureCandidate {
  return {
    merchant: draft.merchant,
    amount: draft.amount,
    currency: draft.currency,
    category,
    date: draft.detectedAt,
    note: note ?? undefined,
    source: draft.source,
    origin: 'auto_capture',
  };
}

export class SqliteDetectionDraftStore {
  constructor(
    private readonly db: SQLite.SQLiteDatabase,
    private readonly events: DetectionDraftEvents,
  ) {}

  async createDetectionDraft(input: DetectionDraftInput, now = Date.now()): Promise<DetectionDraft> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new DetectionDraftValidationError('amount');
    if (!input.currency.trim()) throw new DetectionDraftValidationError('currency');
    const draft: DetectionDraft = {
      id: uuid(),
      merchant: input.merchant,
      amount: input.amount,
      currency: input.currency,
      category: input.category?.trim() || UNCATEGORIZED_FILING_CATEGORY,
      note: input.note ?? null,
      source: input.source ?? 'auto_capture',
      detectedAt: input.detectedAt ?? now,
      snoozedUntil: null,
      status: 'pending',
      notificationId: input.notificationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.runAsync(
      `INSERT INTO detection_drafts (${SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, draft.merchant, draft.amount, draft.currency, draft.category, draft.note, draft.source, draft.detectedAt, draft.snoozedUntil, draft.status, draft.notificationId, draft.createdAt, draft.updatedAt],
    );
    return draft;
  }

  async getDetectionDraft(id: string): Promise<DetectionDraft | null> {
    const row = await this.db.getFirstAsync<DetectionDraftRow>(`SELECT ${SELECT_COLUMNS} FROM detection_drafts WHERE id = ?`, [id]);
    return row ? rowToDetectionDraft(row) : null;
  }

  // Links a fresh draft to its inbox row after the row exists. The raise path
  // creates the draft first (it validates strictly, so a malformed detection
  // fails before any row exists), inserts the row with the draft id, then
  // sets this link so confirm, discard, and file can mark the row accounted.
  // Only pending drafts link; anything else reads as null and the caller must
  // not proceed without the link.
  async setDetectionDraftNotificationId(id: string, notificationId: string, now = Date.now()): Promise<DetectionDraft | null> {
    const draft = await this.getDetectionDraft(id);
    if (!draft || draft.status !== 'pending') return null;
    await this.db.runAsync('UPDATE detection_drafts SET notification_id = ?, updated_at = ? WHERE id = ?', [notificationId, now, id]);
    return (await this.getDetectionDraft(id)) ?? { ...draft, notificationId, updatedAt: now };
  }

  async listPendingDrafts(): Promise<DetectionDraft[]> {
    const rows = await this.db.getAllAsync<DetectionDraftRow>(`SELECT ${SELECT_COLUMNS} FROM detection_drafts WHERE status = 'pending' ORDER BY detected_at ASC`);
    return rows.map(rowToDetectionDraft);
  }

  // Read contract: pending drafts whose first detection is older than
  // STALE_AFTER_MS, oldest first, each with its age in milliseconds. The
  // boundary is strict: exactly STALE_AFTER_MS old stays quiet, one
  // millisecond over surfaces. Snoozed drafts are included: snooze suppresses
  // only the device re-ping, never review eligibility.
  async listStaleDrafts(now = Date.now()): Promise<StaleDetectionDraft[]> {
    const cutoff = now - STALE_AFTER_MS;
    const rows = await this.db.getAllAsync<DetectionDraftRow>(
      `SELECT ${SELECT_COLUMNS} FROM detection_drafts WHERE status = 'pending' AND detected_at < ? ORDER BY detected_at ASC`,
      [cutoff],
    );
    return rows.map(row => toStaleDraft(rowToDetectionDraft(row), now));
  }

  // Snoozed drafts stay countable: suppression hides the re-ping, not the row.
  async countPendingDrafts(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM detection_drafts WHERE status = 'pending'");
    return row?.count ?? 0;
  }

  async snoozeDetectionDraft(id: string, now = Date.now()): Promise<DraftSnoozeOutcome> {
    const draft = await this.getDetectionDraft(id);
    if (!draft) return { status: 'not_found', id };
    if (draft.status !== 'pending') return { status: 'already_resolved', id };
    const snoozedUntil = now + DRAFT_SNOOZE_MS;
    await this.db.runAsync('UPDATE detection_drafts SET snoozed_until = ?, updated_at = ? WHERE id = ?', [snoozedUntil, now, id]);
    const resolved = await this.getDetectionDraft(id);
    return { status: 'snoozed', snoozedUntil, draft: resolved ?? { ...draft, snoozedUntil, updatedAt: now } };
  }

  // Single confirm through the shared boundary, so teaching and the duplicate
  // gate behave exactly as the confirm sheet. Only a saved confirmation marks
  // the draft and its inbox row accounted; a duplicate leaves both pending.
  async confirmDetectionDraft(id: string, resolveSave: ResolveDetectionSave, now = Date.now()): Promise<DraftConfirmOutcome> {
    const draft = await this.getDetectionDraft(id);
    if (!draft) return { status: 'not_found', id };
    if (draft.status !== 'pending') return { status: 'already_resolved', id };
    const resolution = await resolveSave(toFilingCandidate(draft, draft.category, draft.note));
    if (resolution.status === 'duplicate') return { status: 'duplicate', duplicate: resolution.duplicate };
    // The shared boundary only reports discarded on an explicit discard
    // decision, which this path never passes. Guarded so a custom saver
    // cannot leave the caller hanging, and the draft stays pending.
    if (resolution.status === 'discarded') return { status: 'already_resolved', id };
    const resolved = await this.resolveDetectionDraft(id, 'confirmed', now);
    return { status: 'confirmed', draft: resolved ?? draft, expenseId: resolution.record.id };
  }

  async discardDetectionDraft(id: string, now = Date.now()): Promise<DraftItemOutcome> {
    return (await this.discardDetectionDrafts([id], now)).items[0];
  }

  async discardDetectionDrafts(ids: string[], now = Date.now()): Promise<DraftBatchReport> {
    return this.resolveMany(ids, 'discarded', async draft => {
      await this.events.recordEvent({
        source: draft.source,
        status: 'discarded',
        merchant: draft.merchant,
        amount: draft.amount,
        category: draft.category,
        payload: JSON.stringify({ origin: 'auto_capture' }),
      });
      await this.resolveDetectionDraft(draft.id, 'discarded', now);
      return { id: draft.id, status: 'discarded' };
    });
  }

  async fileDetectionDraftUncategorized(id: string, now = Date.now()): Promise<DraftItemOutcome> {
    return (await this.fileDetectionDraftsUncategorized([id], now)).items[0];
  }

  async fileDetectionDraftsUncategorized(ids: string[], now = Date.now()): Promise<DraftBatchReport> {
    return this.resolveMany(ids, 'filed', async draft => {
      const expense = await this.insertFiledExpense(toFilingCandidate(draft, UNCATEGORIZED_FILING_CATEGORY, buildFilingNote(draft.note)));
      await this.resolveDetectionDraft(draft.id, 'filed', now);
      return { id: draft.id, status: 'filed', expenseId: expense.id };
    });
  }

  async assignDetectionDraft(id: string, category: string, now = Date.now()): Promise<DraftItemOutcome> {
    return (await this.assignDetectionDrafts([id], category, now)).items[0];
  }

  async assignDetectionDrafts(ids: string[], category: string, now = Date.now()): Promise<DraftBatchReport> {
    if (!category.trim()) throw new DetectionDraftValidationError('category');
    const trimmed = category.trim();
    return this.resolveMany(ids, 'assigned', async draft => {
      const expense = await this.insertFiledExpense(toFilingCandidate(draft, trimmed, draft.note));
      await this.resolveDetectionDraft(draft.id, 'filed', now);
      return { id: draft.id, status: 'assigned', expenseId: expense.id };
    });
  }

  // Terminal transition plus the unread contract write. Confirm, discard, and
  // file are the only callers: nothing else in this module touches the
  // notifications accounted flag.
  async resolveDetectionDraft(id: string, status: DetectionDraftTerminalStatus, now = Date.now()): Promise<DetectionDraft | null> {
    assertDraftStatus(status);
    const draft = await this.getDetectionDraft(id);
    if (!draft) return null;
    await this.db.runAsync('UPDATE detection_drafts SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
    if (draft.notificationId) {
      await this.db.runAsync('UPDATE notifications SET accounted = 1 WHERE id = ?', [draft.notificationId]);
    }
    return (await this.getDetectionDraft(id)) ?? { ...draft, status, updatedAt: now };
  }

  // Expense-first ordering is deliberate. A failure after the insert leaves a
  // visible expense the user can delete and the draft still pending for
  // retry; the reverse order could mark a draft filed with no expense behind
  // it, which is a silent loss. Either way the item outcome reports failed,
  // never silently dropped.
  private async insertFiledExpense(candidate: CaptureCandidate): Promise<Expense> {
    const currency = resolveCurrency(candidate.currency, await this.readUserCurrency());
    const resolved = { ...candidate, currency };
    assertValidCaptureCandidate(resolved);
    const expense = buildExpenseRecord(resolved, uuid());
    await this.db.runAsync(EXPENSE_INSERT_SQL, expenseInsertParams(expense));
    await this.events.recordEvent({
      source: resolved.source,
      status: 'confirmed',
      merchant: resolved.merchant,
      amount: resolved.amount,
      category: resolved.category,
      payload: JSON.stringify({ origin: resolved.origin ?? 'auto_capture' }),
    });
    return expense;
  }

  private async resolveMany(
    ids: string[],
    action: 'discarded' | 'filed' | 'assigned',
    perform: (draft: DetectionDraft) => Promise<DraftItemOutcome>,
  ): Promise<DraftBatchReport> {
    const items: DraftItemOutcome[] = [];
    for (const id of ids) {
      const draft = await this.getDetectionDraft(id);
      if (!draft) {
        items.push({ id, status: 'not_found' });
        continue;
      }
      if (draft.status !== 'pending') {
        items.push({ id, status: 'already_resolved' });
        continue;
      }
      try {
        items.push(await perform(draft));
      } catch (error) {
        items.push({ id, status: 'failed', errorCode: error instanceof DetectionDraftValidationError ? 'validation' : 'write_failed' });
      }
    }
    return { items };
  }

  // Mirrors the currency read in SqliteCaptureRepository. A read, so sharing
  // the settings row is safe; the insert helpers above keep the write single.
  private async readUserCurrency(): Promise<string | null> {
    const setting = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['currency']);
    return setting?.value ?? null;
  }
}
