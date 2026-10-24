import { describe, expect, it } from 'vitest';
import {
  SqliteReceiptDraftStore, ReceiptDraftValidationError,
  type ReceiptDraft, type ReceiptDraftStatus,
} from './ReceiptDrafts';

// The row shape the real table holds. The fake stores rows exactly as SQLite would,
// in snake_case, so the store's own row mapping is exercised rather than bypassed.
interface FakeRow {
  id: string;
  image_uri: string;
  source: string;
  status: string;
  attempts: number;
  last_error_code: string | null;
  created_at: number;
  updated_at: number;
}

// The store is exercised against a fake that keeps rows and honours the statements
// the store issues. An unrecognised statement throws instead of being ignored, so a
// change to the SQL fails loudly here rather than passing quietly. The claim is
// modelled on SQLite's semantics for one UPDATE: the subquery sees the status the
// previous statement left behind, which is what makes a second claim find nothing.
class FakeDraftDatabase {
  rows: FakeRow[] = [];

  private sorted() {
    return [...this.rows].sort((a, b) => a.created_at - b.created_at);
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.startsWith('INSERT INTO receipt_drafts')) {
      const [id, image_uri, source, status, attempts, last_error_code, created_at, updated_at] =
        params as [string, string, string, string, number, string | null, number, number];
      this.rows.push({ id, image_uri, source, status, attempts, last_error_code, created_at, updated_at });
      return;
    }
    if (sql.includes("SET status = 'saved'")) {
      const [now, id] = params as [number, string];
      this.patch(id, { status: 'saved', last_error_code: null, updated_at: now });
      return;
    }
    if (sql.includes("SET status = 'failed'")) {
      const [errorCode, now, id] = params as [string, number, string];
      const row = this.rows.find(candidate => candidate.id === id);
      if (row) this.patch(id, { status: 'failed', attempts: row.attempts + 1, last_error_code: errorCode, updated_at: now });
      return;
    }
    if (sql.includes("SET status = 'pending_ocr'")) {
      const [now, id] = params as [number, string];
      const row = this.rows.find(candidate => candidate.id === id);
      if (row?.status === 'failed' || row?.status === 'processing') this.patch(id, { status: 'pending_ocr', updated_at: now });
      return;
    }
    if (sql.startsWith('DELETE FROM receipt_drafts WHERE id = ?')) {
      this.rows = this.rows.filter(row => row.id !== params[0]);
      return;
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (sql.includes("SET status = 'processing'")) {
      const [now] = params as [number];
      const next = this.sorted().find(row => row.status === 'pending_ocr');
      if (!next) return null;
      this.patch(next.id, { status: 'processing', updated_at: now });
      return { ...next, status: 'processing', updated_at: now } as T;
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('WHERE status = ?')) {
      return this.rows.filter(row => row.status === (params[0] as ReceiptDraftStatus)).sort((a, b) => b.created_at - a.created_at) as T[];
    }
    if (sql.startsWith('SELECT')) return [...this.rows].sort((a, b) => b.created_at - a.created_at) as T[];
    throw new Error(`unrecognised statement: ${sql}`);
  }

  private patch(id: string, changes: Partial<FakeRow>): void {
    this.rows = this.rows.map(row => (row.id === id ? { ...row, ...changes } : row));
  }
}

const store = () => {
  const db = new FakeDraftDatabase();
  return { db, drafts: new SqliteReceiptDraftStore(db as never) };
};

const imageUris = (drafts: ReceiptDraft[]) => drafts.map((draft: ReceiptDraft) => draft.imageUri);

describe('receipt draft store', () => {
  it('enqueues a captured receipt as a pending draft with no attempts yet', async () => {
    const { db, drafts } = store();

    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/peachspend-receipt-a.jpg', source: 'scan' }, 1_000);

    expect(draft).toMatchObject({
      imageUri: 'cache/peachspend-receipt-a.jpg',
      source: 'scan',
      status: 'pending_ocr',
      attempts: 0,
      lastErrorCode: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(db.rows).toHaveLength(1);
  });

  it('refuses an empty image uri or an unknown source instead of storing it', async () => {
    const { db, drafts } = store();

    await expect(drafts.enqueueReceiptDraft({ imageUri: '   ', source: 'scan' })).rejects.toBeInstanceOf(ReceiptDraftValidationError);
    await expect(drafts.enqueueReceiptDraft({ imageUri: 'cache/x.jpg', source: 'camera' as never })).rejects.toBeInstanceOf(ReceiptDraftValidationError);
    expect(db.rows).toEqual([]);
  });

  it('claims the oldest pending draft and moves it to processing', async () => {
    const { db, drafts } = store();
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/first.jpg', source: 'scan' }, 1_000);
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/second.jpg', source: 'share' }, 2_000);

    const claimed = await drafts.claimNextReceiptDraft(3_000);

    expect(claimed?.imageUri).toBe('cache/first.jpg');
    expect(claimed?.status).toBe('processing');
    expect(claimed?.updatedAt).toBe(3_000);
    expect(db.rows.find(row => row.image_uri === 'cache/first.jpg')?.status).toBe('processing');
  });

  it('never hands the same draft to a second caller', async () => {
    const { drafts } = store();
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/only.jpg', source: 'scan' }, 1_000);
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/next.jpg', source: 'scan' }, 2_000);

    const [first, second] = await Promise.all([drafts.claimNextReceiptDraft(3_000), drafts.claimNextReceiptDraft(3_000)]);

    const claimed = [first, second].filter((draft): draft is NonNullable<typeof draft> => draft !== null);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map(draft => draft.id)).size).toBe(2);
    expect(claimed.map(draft => draft.imageUri).sort()).toEqual(['cache/next.jpg', 'cache/only.jpg']);
  });

  it('returns null when nothing is pending', async () => {
    const { drafts } = store();
    expect(await drafts.claimNextReceiptDraft()).toBeNull();
  });

  it('marks a draft saved and clears the stored error code', async () => {
    const { db, drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'share' }, 1_000);
    await drafts.markReceiptDraftFailed(draft.id, 'ocr_failed', 2_000);

    await drafts.markReceiptDraftSaved(draft.id, 3_000);

    expect(db.rows[0]).toMatchObject({ status: 'saved', last_error_code: null, updated_at: 3_000 });
    expect(db.rows[0]?.attempts).toBe(1);
  });

  it('increments attempts and keeps the draft readable on each failure', async () => {
    const { db, drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'scan' }, 1_000);

    await drafts.markReceiptDraftFailed(draft.id, 'offline', 2_000);
    await drafts.markReceiptDraftFailed(draft.id, 'offline', 3_000);

    expect(db.rows[0]).toMatchObject({ status: 'failed', attempts: 2, last_error_code: 'offline' });
    // A read never deletes: the row is still there for the user to retry.
    const listed = await drafts.listReceiptDrafts('failed');
    expect(listed).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
  });

  it('refuses a failure with no error code', async () => {
    const { drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'scan' }, 1_000);

    await expect(drafts.markReceiptDraftFailed(draft.id, '  ')).rejects.toBeInstanceOf(ReceiptDraftValidationError);
  });

  it('puts a failed draft back in the queue only when the user asks to retry', async () => {
    const { db, drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'scan' }, 1_000);
    await drafts.markReceiptDraftFailed(draft.id, 'timeout', 2_000);

    await drafts.retryReceiptDraft(draft.id, 3_000);

    expect(db.rows[0]).toMatchObject({ status: 'pending_ocr', attempts: 1, last_error_code: 'timeout' });
    expect((await drafts.claimNextReceiptDraft(4_000))?.id).toBe(draft.id);
  });

  it('does not retry a draft that is already saved', async () => {
    const { db, drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'scan' }, 1_000);
    await drafts.markReceiptDraftSaved(draft.id, 2_000);

    await drafts.retryReceiptDraft(draft.id, 3_000);

    expect(db.rows[0]?.status).toBe('saved');
  });

  it('lets a draft stuck in processing be put back in the queue', async () => {
    // A crash between the claim and the save leaves a row in processing that nothing
    // would otherwise pick up again. The user's retry is the recovery path.
    const { db, drafts } = store();
    const draft = await drafts.enqueueReceiptDraft({ imageUri: 'cache/a.jpg', source: 'scan' }, 1_000);
    await drafts.claimNextReceiptDraft(2_000);

    await drafts.retryReceiptDraft(draft.id, 3_000);

    expect(db.rows[0]?.status).toBe('pending_ocr');
    expect((await drafts.claimNextReceiptDraft(4_000))?.id).toBe(draft.id);
  });

  it('lists every draft newest first and filters by status on request', async () => {
    const { drafts } = store();
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/old.jpg', source: 'scan' }, 1_000);
    const failed = await drafts.enqueueReceiptDraft({ imageUri: 'cache/new.jpg', source: 'share' }, 2_000);
    await drafts.markReceiptDraftFailed(failed.id, 'no_key', 3_000);

    expect(imageUris(await drafts.listReceiptDrafts())).toEqual(['cache/new.jpg', 'cache/old.jpg']);
    expect(imageUris(await drafts.listReceiptDrafts('pending_ocr'))).toEqual(['cache/old.jpg']);
    expect(imageUris(await drafts.listReceiptDrafts('failed'))).toEqual(['cache/new.jpg']);
  });

  it('refuses an unknown status filter rather than returning a misleading empty list', async () => {
    const { drafts } = store();
    await expect(drafts.listReceiptDrafts('done' as never)).rejects.toBeInstanceOf(ReceiptDraftValidationError);
  });

  it('deletes one draft and leaves the rest alone', async () => {
    const { db, drafts } = store();
    const first = await drafts.enqueueReceiptDraft({ imageUri: 'cache/first.jpg', source: 'scan' }, 1_000);
    await drafts.enqueueReceiptDraft({ imageUri: 'cache/second.jpg', source: 'scan' }, 2_000);

    await drafts.deleteReceiptDraft(first.id);

    expect(db.rows.map(row => row.image_uri)).toEqual(['cache/second.jpg']);
  });
});
