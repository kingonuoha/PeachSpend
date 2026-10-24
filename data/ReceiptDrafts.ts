import type * as SQLite from 'expo-sqlite';
import { v4 as uuid } from 'uuid';

// Phase 11 D2, ESC-11-09. The offline receipt draft store.
//
// Why this is a new table rather than a reuse: capture_queue holds auto-capture
// push payloads (merchant, amount, category) claimed by the auto-capture host, and
// repurposing it would change that host's behaviour and mix two different life
// cycles in one table. A receipt draft instead holds one thing: the local uri of an
// image the user captured and the OCR state for it. ESC-11-09 authorises the new
// table on the condition that capture_queue behaviour does not change, so
// capture_queue is left exactly as it was.

export type ReceiptDraftStatus = 'pending_ocr' | 'processing' | 'saved' | 'failed';
export type ReceiptDraftSource = 'scan' | 'share';

export const RECEIPT_DRAFT_STATUSES: readonly ReceiptDraftStatus[] = ['pending_ocr', 'processing', 'saved', 'failed'];
export const RECEIPT_DRAFT_SOURCES: readonly ReceiptDraftSource[] = ['scan', 'share'];

export interface ReceiptDraft {
  id: string;
  imageUri: string;
  source: ReceiptDraftSource;
  status: ReceiptDraftStatus;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReceiptDraftInput {
  imageUri: string;
  source: ReceiptDraftSource;
}

export type ReceiptDraftField = 'imageUri' | 'source' | 'status' | 'errorCode';

export class ReceiptDraftValidationError extends Error {
  readonly code = 'receipt_draft_validation';
  constructor(readonly field: ReceiptDraftField) {
    super(`Receipt draft field is required or invalid: ${field}`);
    this.name = 'ReceiptDraftValidationError';
  }
}

export interface ReceiptDraftStore {
  enqueueReceiptDraft(input: ReceiptDraftInput, now?: number): Promise<ReceiptDraft>;
  listReceiptDrafts(status?: ReceiptDraftStatus): Promise<ReceiptDraft[]>;
  claimNextReceiptDraft(now?: number): Promise<ReceiptDraft | null>;
  markReceiptDraftSaved(id: string, now?: number): Promise<void>;
  markReceiptDraftFailed(id: string, errorCode: string, now?: number): Promise<void>;
  retryReceiptDraft(id: string, now?: number): Promise<void>;
  deleteReceiptDraft(id: string): Promise<void>;
}

interface ReceiptDraftRow {
  id: string;
  image_uri: string;
  source: string;
  status: string;
  attempts: number;
  last_error_code: string | null;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = 'id, image_uri, source, status, attempts, last_error_code, created_at, updated_at';

export function rowToReceiptDraft(row: ReceiptDraftRow): ReceiptDraft {
  return {
    id: row.id,
    imageUri: row.image_uri,
    source: row.source as ReceiptDraftSource,
    status: row.status as ReceiptDraftStatus,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assertReceiptDraftInput(input: ReceiptDraftInput): void {
  if (typeof input.imageUri !== 'string' || !input.imageUri.trim()) throw new ReceiptDraftValidationError('imageUri');
  if (!RECEIPT_DRAFT_SOURCES.includes(input.source)) throw new ReceiptDraftValidationError('source');
}

export function assertReceiptDraftStatus(status: string): asserts status is ReceiptDraftStatus {
  if (!RECEIPT_DRAFT_STATUSES.includes(status as ReceiptDraftStatus)) throw new ReceiptDraftValidationError('status');
}

// The claim is one statement, not a select followed by an update. Two callers that
// run at the same moment therefore cannot both receive the same row: SQLite applies
// each UPDATE whole, and the subquery re-evaluates against the status the previous
// statement left behind, so the second claim only ever sees drafts that are still
// pending. A transaction around a separate read and write could not promise that
// on one shared connection.
const CLAIM_SQL = `UPDATE receipt_drafts SET status = 'processing', updated_at = ? WHERE id = (SELECT id FROM receipt_drafts WHERE status = 'pending_ocr' ORDER BY created_at ASC, rowid ASC LIMIT 1) RETURNING ${SELECT_COLUMNS}`;

export class SqliteReceiptDraftStore implements ReceiptDraftStore {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async enqueueReceiptDraft(input: ReceiptDraftInput, now = Date.now()): Promise<ReceiptDraft> {
    assertReceiptDraftInput(input);
    const draft: ReceiptDraft = {
      id: uuid(),
      imageUri: input.imageUri,
      source: input.source,
      status: 'pending_ocr',
      attempts: 0,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.runAsync(
      `INSERT INTO receipt_drafts (${SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, draft.imageUri, draft.source, draft.status, draft.attempts, draft.lastErrorCode, draft.createdAt, draft.updatedAt],
    );
    return draft;
  }

  // A read, so it never deletes. A failed draft stays readable until the user
  // retries it or deletes it, which is why nothing here prunes by age or attempts.
  async listReceiptDrafts(status?: ReceiptDraftStatus): Promise<ReceiptDraft[]> {
    if (status !== undefined) assertReceiptDraftStatus(status);
    const rows = status === undefined
      ? await this.db.getAllAsync<ReceiptDraftRow>(`SELECT ${SELECT_COLUMNS} FROM receipt_drafts ORDER BY created_at DESC`)
      : await this.db.getAllAsync<ReceiptDraftRow>(`SELECT ${SELECT_COLUMNS} FROM receipt_drafts WHERE status = ? ORDER BY created_at DESC`, [status]);
    return rows.map(rowToReceiptDraft);
  }

  async claimNextReceiptDraft(now = Date.now()): Promise<ReceiptDraft | null> {
    const row = await this.db.getFirstAsync<ReceiptDraftRow>(CLAIM_SQL, [now]);
    return row ? rowToReceiptDraft(row) : null;
  }

  async markReceiptDraftSaved(id: string, now = Date.now()): Promise<void> {
    await this.db.runAsync("UPDATE receipt_drafts SET status = 'saved', last_error_code = NULL, updated_at = ? WHERE id = ?", [now, id]);
  }

  async markReceiptDraftFailed(id: string, errorCode: string, now = Date.now()): Promise<void> {
    if (typeof errorCode !== 'string' || !errorCode.trim()) throw new ReceiptDraftValidationError('errorCode');
    await this.db.runAsync("UPDATE receipt_drafts SET status = 'failed', attempts = attempts + 1, last_error_code = ?, updated_at = ? WHERE id = ?", [errorCode.trim(), now, id]);
  }

  // The explicit user retry. Without a transition back to pending_ocr a failed
  // draft could never be claimed again, and "the user can retry" would be false.
  // A `processing` row is included on purpose: a crash or a killed process between
  // the claim and the save would otherwise leave a draft in a state nothing can pick
  // up again, and the user needs a way to put it back in the queue. attempts and
  // last_error_code are kept so the surface can still say what failed and how many
  // times. A saved draft is never requeued.
  async retryReceiptDraft(id: string, now = Date.now()): Promise<void> {
    await this.db.runAsync("UPDATE receipt_drafts SET status = 'pending_ocr', updated_at = ? WHERE id = ? AND status IN ('failed', 'processing')", [now, id]);
  }

  // Deleting a draft never deletes its image. The caller owns the file decision,
  // because a draft can be deleted after a successful save (keep the image the
  // expense now points at) or because the user discarded it (delete the image).
  async deleteReceiptDraft(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM receipt_drafts WHERE id = ?', [id]);
  }
}
