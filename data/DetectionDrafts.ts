import type * as SQLite from 'expo-sqlite';
import { v4 as uuid } from 'uuid';
import type { Expense, Income } from '../types/database';
import { resolveCurrency } from '../utils/currency';
import { EXPENSE_INSERT_SQL, buildExpenseRecord, expenseInsertParams } from './CaptureRepository';
import {
  assertValidCaptureCandidate,
  type CaptureCandidate,
  type CaptureEventInput,
  type CaptureOrigin,
  type CaptureSource,
  type DuplicateMatch,
  type IncomeCandidate,
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

// Phase 16 D2. Expense drafts file through the expense boundary, income
// drafts (credit legs) through the saveIncome boundary. The kind travels on
// the row so a backgrounded income detection survives reboot with its
// direction intact instead of squeezing through the expense shape.
export type DetectionDraftKind = 'expense' | 'income';

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
  // D2 income shape. Optional so rows and literals predating D2 keep
  // compiling: an absent kind reads as expense, an absent origin falls back
  // to auto_capture at filing time, an absent sourceName means an expense
  // draft. The store always writes all three for new drafts of either kind.
  kind?: DetectionDraftKind;
  origin?: CaptureOrigin | null;
  // The income sender. Income drafts persist it here and mirror it into
  // merchant, so readers predating D2 (stale sheet, alert content, inbox copy)
  // keep rendering a real name with no change. Expense drafts keep NULL.
  sourceName?: string | null;
}

export interface DetectionDraftInput {
  id?: string;
  merchant: string;
  amount: number;
  currency: string;
  category?: string;
  note?: string;
  source?: CaptureSource;
  detectedAt?: number;
  notificationId?: string;
}

// D2 income create shape. The persisted income draft carries sourceName,
// amount, currency, category, date (detectedAt), note, and origin; source
// defaults to auto_capture like the expense input.
export interface IncomeDetectionDraftInput {
  id?: string;
  sourceName: string;
  amount: number;
  currency: string;
  category?: string;
  note?: string;
  source?: CaptureSource;
  origin?: CaptureOrigin;
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
  // Filed income record id. Expense items keep expenseId; income items carry
  // incomeId, so neither kind is misread as the other.
  incomeId?: string;
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

// D2 income confirm outcome. Mirrors the expense outcome, but the saved
// record is an income row, so the id travels as incomeId, never expenseId.
export type DraftIncomeConfirmOutcome =
  | { status: 'confirmed'; draft: DetectionDraft; incomeId: string }
  | { status: 'duplicate'; duplicate: DuplicateMatch }
  | { status: 'not_found'; id: string }
  | { status: 'already_resolved'; id: string };

// The shared confirm boundary, injected so the store never reimplements the
// duplicate check or the teaching write. Production passes
// candidate => resolveExpenseSave(repository, candidate).
export type ResolveDetectionSave = (candidate: CaptureCandidate) => Promise<SaveResolution<Expense>>;

// D2 income confirm boundary. Production passes
// candidate => resolveIncomeSave(repository, candidate).
export type ResolveIncomeSave = (candidate: IncomeCandidate) => Promise<SaveResolution<Income>>;

// The only event sink the store writes to. The app's capture repository
// satisfies this structurally (recordEvent is forwarded by its wrapper), so no
// new repository method is needed for the queue.
export interface DetectionDraftEvents {
  recordEvent(event: CaptureEventInput): Promise<string>;
}

export type DetectionDraftField = 'amount' | 'currency' | 'category' | 'sourceName' | 'date';

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
  kind: string | null;
  origin: string | null;
  source_name: string | null;
}

const SELECT_COLUMNS = 'id, merchant, amount, currency, category, note, source, detected_at, snoozed_until, status, notification_id, created_at, updated_at, kind, origin, source_name';

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
    // Pre-D2 rows read NULL here and normalize to expense, so expense drafts
    // stay byte compatible across the upgrade.
    kind: (row.kind ?? 'expense') as DetectionDraftKind,
    origin: (row.origin ?? null) as CaptureOrigin | null,
    sourceName: row.source_name ?? null,
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

// D2 kind helpers. Kind is optional on the type so rows and literals
// predating D2 keep compiling; every helper below treats an absent kind as
// expense, which is exactly what those rows are.
export function normalizeDraftKind(draft: Pick<DetectionDraft, 'kind'>): DetectionDraftKind {
  return draft.kind ?? 'expense';
}

export function isIncomeDraft(draft: Pick<DetectionDraft, 'kind'>): boolean {
  return normalizeDraftKind(draft) === 'income';
}

// The sender an income draft files under. Income drafts persist it in
// source_name; merchant mirrors it for readers predating D2, so the mirror is
// the fallback, never the other way round.
export function incomeSourceNameOf(draft: Pick<DetectionDraft, 'merchant' | 'sourceName'>): string {
  return draft.sourceName?.trim() ? draft.sourceName : draft.merchant;
}

function assertValidIncomeFilingCandidate(candidate: IncomeCandidate): void {
  if (!candidate.sourceName.trim()) throw new DetectionDraftValidationError('sourceName');
  if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) throw new DetectionDraftValidationError('amount');
  if (!candidate.currency.trim()) throw new DetectionDraftValidationError('currency');
  if (!candidate.category.trim()) throw new DetectionDraftValidationError('category');
  if (!Number.isFinite(candidate.date)) throw new DetectionDraftValidationError('date');
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
    origin: draft.origin ?? 'auto_capture',
  };
}

// D2 income filing candidate. Carries the same seven fields the saveIncome
// boundary needs: sourceName, amount, currency, category, date, note, origin.
function toIncomeFilingCandidate(draft: DetectionDraft, category: string, note: string | null): IncomeCandidate {
  return {
    sourceName: incomeSourceNameOf(draft),
    amount: draft.amount,
    currency: draft.currency,
    category,
    date: draft.detectedAt,
    note: note ?? undefined,
    source: draft.source,
    origin: draft.origin ?? 'auto_capture',
  };
}

// D2 typed read contract for Mobile M4: an income draft rebuilds the pure D1
// income candidate for the shared saveIncome boundary. The merchant mirror
// never reaches the ledger, only the sourceName above.
export function toIncomeCandidate(draft: DetectionDraft): IncomeCandidate {
  return toIncomeFilingCandidate(draft, draft.category, draft.note);
}

export class SqliteDetectionDraftStore {
  constructor(
    private readonly db: SQLite.SQLiteDatabase,
    private readonly events: DetectionDraftEvents,
  ) {}

  async createDetectionDraft(input: DetectionDraftInput, now = Date.now()): Promise<DetectionDraft> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new DetectionDraftValidationError('amount');
    if (!input.currency.trim()) throw new DetectionDraftValidationError('currency');
    const explicitId = input.id?.trim() || null;
    if (explicitId) {
      const existing = await this.getDetectionDraft(explicitId);
      if (existing) return existing;
    }
    const draft: DetectionDraft = {
      id: explicitId ?? uuid(),
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
      kind: 'expense',
      origin: 'auto_capture',
      sourceName: null,
    };
    await this.db.runAsync(
      `INSERT INTO detection_drafts (${SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, draft.merchant, draft.amount, draft.currency, draft.category, draft.note, draft.source, draft.detectedAt, draft.snoozedUntil, draft.status, draft.notificationId, draft.createdAt, draft.updatedAt, draft.kind ?? 'expense', draft.origin ?? null, draft.sourceName ?? null],
    );
    return draft;
  }

  // D2 income create. The sender persists in source_name with a merchant
  // mirror for readers predating D2; every other column behaves exactly like
  // the expense create above, so snooze, stale, counted, and batch reads treat
  // both kinds identically without a kind filter anywhere.
  async createIncomeDetectionDraft(input: IncomeDetectionDraftInput, now = Date.now()): Promise<DetectionDraft> {
    const sourceName = input.sourceName.trim();
    if (!sourceName) throw new DetectionDraftValidationError('sourceName');
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new DetectionDraftValidationError('amount');
    if (!input.currency.trim()) throw new DetectionDraftValidationError('currency');
    const explicitId = input.id?.trim() || null;
    if (explicitId) {
      const existing = await this.getDetectionDraft(explicitId);
      if (existing) return existing;
    }
    const draft: DetectionDraft = {
      id: explicitId ?? uuid(),
      merchant: sourceName,
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
      kind: 'income',
      origin: input.origin ?? 'auto_capture',
      sourceName,
    };
    await this.db.runAsync(
      `INSERT INTO detection_drafts (${SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, draft.merchant, draft.amount, draft.currency, draft.category, draft.note, draft.source, draft.detectedAt, draft.snoozedUntil, draft.status, draft.notificationId, draft.createdAt, draft.updatedAt, draft.kind ?? 'expense', draft.origin ?? null, draft.sourceName ?? null],
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
  // Expense drafts only: an income id reads as already resolved without
  // calling the saver, so an expense saver can never file an income draft.
  async confirmDetectionDraft(id: string, resolveSave: ResolveDetectionSave, now = Date.now()): Promise<DraftConfirmOutcome> {
    const draft = await this.getDetectionDraft(id);
    if (!draft) return { status: 'not_found', id };
    if (draft.status !== 'pending' || isIncomeDraft(draft)) return { status: 'already_resolved', id };
    const resolution = await resolveSave(toFilingCandidate(draft, draft.category, draft.note));
    if (resolution.status === 'duplicate') return { status: 'duplicate', duplicate: resolution.duplicate };
    // The shared boundary only reports discarded on an explicit discard
    // decision, which this path never passes. Guarded so a custom saver
    // cannot leave the caller hanging, and the draft stays pending.
    if (resolution.status === 'discarded') return { status: 'already_resolved', id };
    const resolved = await this.resolveDetectionDraft(id, 'confirmed', now);
    return { status: 'confirmed', draft: resolved ?? draft, expenseId: resolution.record.id };
  }

  // D2 income confirm through the shared saveIncome boundary, with the same
  // duplicate, streak, and notification behavior the confirm sheet gets from
  // resolveIncomeSave. Nothing persists before this tap. Expense ids read as
  // already resolved without calling the saver, mirroring the expense guard.
  async confirmIncomeDetectionDraft(id: string, resolveSave: ResolveIncomeSave, now = Date.now()): Promise<DraftIncomeConfirmOutcome> {
    const draft = await this.getDetectionDraft(id);
    if (!draft) return { status: 'not_found', id };
    if (draft.status !== 'pending' || !isIncomeDraft(draft)) return { status: 'already_resolved', id };
    const resolution = await resolveSave(toIncomeFilingCandidate(draft, draft.category, draft.note));
    if (resolution.status === 'duplicate') return { status: 'duplicate', duplicate: resolution.duplicate };
    if (resolution.status === 'discarded') return { status: 'already_resolved', id };
    const resolved = await this.resolveDetectionDraft(id, 'confirmed', now);
    return { status: 'confirmed', draft: resolved ?? draft, incomeId: resolution.record.id };
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
        payload: JSON.stringify({ origin: draft.origin ?? 'auto_capture' }),
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
      // Kind branch, same terminal move either way. Income drafts file as
      // income rows through the income insert below; expense drafts file as
      // expense rows as today. Neither path writes per-merchant memory
      // (DEC-14-03): both inserts skip rememberCategory, unlike the save
      // boundary the confirm sheet uses.
      if (isIncomeDraft(draft)) {
        const income = await this.insertFiledIncome(toIncomeFilingCandidate(draft, UNCATEGORIZED_FILING_CATEGORY, buildFilingNote(draft.note)));
        await this.resolveDetectionDraft(draft.id, 'filed', now);
        return { id: draft.id, status: 'filed', incomeId: income.id };
      }
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
      // Same kind branch as uncategorized filing, with the caller supplied
      // category instead of the fixed bucket. Still no per-merchant memory
      // write for either kind.
      if (isIncomeDraft(draft)) {
        const income = await this.insertFiledIncome(toIncomeFilingCandidate(draft, trimmed, draft.note));
        await this.resolveDetectionDraft(draft.id, 'filed', now);
        return { id: draft.id, status: 'assigned', incomeId: income.id };
      }
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

  // Income-first ordering for the same reason as the expense insert above: a
  // failure after the insert leaves a visible income row the user can delete
  // with the draft still pending, never a filed draft with no income behind
  // it. Same column order as SqliteCaptureRepository.saveIncome, so queue
  // filed rows match boundary saved rows. Like the expense insert, this
  // deliberately skips rememberCategory: batch filing never teaches.
  private async insertFiledIncome(candidate: IncomeCandidate): Promise<Income> {
    const currency = resolveCurrency(candidate.currency, await this.readUserCurrency());
    const resolved = { ...candidate, currency };
    assertValidIncomeFilingCandidate(resolved);
    const income: Income = {
      id: uuid(),
      source: resolved.sourceName,
      amount: resolved.amount,
      currency,
      category: resolved.category,
      note: resolved.note,
      is_recurring: 0,
      date: resolved.date,
      created_at: Date.now(),
    };
    await this.db.runAsync(
      'INSERT INTO income (id, source, amount, currency, category, note, is_recurring, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [income.id, income.source, income.amount, income.currency, income.category, income.note || null, income.is_recurring || 0, income.date, income.created_at],
    );
    await this.events.recordEvent({
      source: resolved.source,
      status: 'confirmed',
      merchant: resolved.sourceName,
      amount: resolved.amount,
      category: resolved.category,
      payload: JSON.stringify({ origin: resolved.origin ?? 'auto_capture' }),
    });
    return income;
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
