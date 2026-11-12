import { describe, expect, it, vi } from 'vitest';
import type { Expense, Income } from '../types/database';
import {
  DRAFT_SNOOZE_MS,
  STALE_AFTER_MS,
  SqliteDetectionDraftStore,
  UNCATEGORIZED_FILING_CATEGORY,
  buildFilingNote,
  incomeSourceNameOf,
  isIncomeDraft,
  isRePingSuppressed,
  isStaleDraft,
  normalizeDraftKind,
  toIncomeCandidate,
  DetectionDraftValidationError,
  type DetectionDraft,
  type DetectionDraftInput,
  type IncomeDetectionDraftInput,
} from './DetectionDrafts';
import type { CaptureEventInput, IncomeCandidate } from './contracts';

// The store is exercised against a fake that keeps rows and honours the
// statements the store issues. An unrecognised statement throws instead of
// being ignored, so a change to the SQL fails loudly here. Expense and event
// writes are observed, never executed, and the fake records every statement
// so the no memory write contract is asserted from evidence, not assumed.
interface FakeDraftRow {
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

const NOW = 1_000_000_000_000;

class FakeDetectionDatabase {
  rows: FakeDraftRow[] = [];
  expenseMerges: unknown[][] = [];
  incomeMerges: unknown[][] = [];
  accountedNotifications: string[] = [];
  statements: string[] = [];
  userCurrency: string | null = 'USD';
  failExpenseInsertForMerchant = new Set<string>();
  failIncomeInsertForSource = new Set<string>();

  async runAsync(sql: string, params: unknown[] = []): Promise<void> {
    this.statements.push(sql);
    if (sql.startsWith('INSERT INTO detection_drafts')) {
      const [id, merchant, amount, currency, category, note, source, detected_at, snoozed_until, status, notification_id, created_at, updated_at, kind, origin, source_name] =
        params as [string, string, number, string, string, string | null, string, number, number | null, string, string | null, number, number, string | null, string | null, string | null];
      this.rows.push({ id, merchant, amount, currency, category, note, source, detected_at, snoozed_until, status, notification_id, created_at, updated_at, kind, origin, source_name });
      return;
    }
    if (sql.startsWith('UPDATE detection_drafts SET snoozed_until')) {
      const [snoozed_until, updated_at, id] = params as [number, number, string];
      this.patch(id, { snoozed_until, updated_at });
      return;
    }
    // Phase 14 M2 row link. The raise path sets the draft to inbox row link
    // after the row exists; only the link and the timestamp move.
    if (sql.startsWith('UPDATE detection_drafts SET notification_id')) {
      const [notification_id, updated_at, id] = params as [string, number, string];
      this.patch(id, { notification_id, updated_at });
      return;
    }
    if (sql.startsWith('UPDATE detection_drafts SET status')) {
      const [status, updated_at, id] = params as [string, number, string];
      this.patch(id, { status, updated_at });
      return;
    }
    if (sql.startsWith('UPDATE notifications SET accounted = 1')) {
      this.accountedNotifications.push(params[0] as string);
      return;
    }
    if (sql.startsWith('INSERT INTO expenses')) {
      if (this.failExpenseInsertForMerchant.has(params[1] as string)) throw new Error('write_failed');
      this.expenseMerges.push(params);
      return;
    }
    if (sql.startsWith('INSERT INTO income')) {
      if (this.failIncomeInsertForSource.has(params[1] as string)) throw new Error('write_failed');
      this.incomeMerges.push(params);
      return;
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (sql.includes('FROM detection_drafts WHERE id = ?')) {
      return (this.rows.find(row => row.id === (params[0] as string)) ?? null) as T;
    }
    if (sql.includes('COUNT(*)')) {
      return { count: this.rows.filter(row => row.status === 'pending').length } as T;
    }
    if (sql.includes('FROM settings')) {
      return (this.userCurrency ? { value: this.userCurrency } : null) as T;
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes("status = 'pending'")) {
      const cutoff = sql.includes('detected_at < ?') ? (params[0] as number) : null;
      return this.rows
        .filter(row => row.status === 'pending' && (cutoff === null || row.detected_at < cutoff))
        .sort((a, b) => a.detected_at - b.detected_at) as T[];
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  private patch(id: string, changes: Partial<FakeDraftRow>): void {
    this.rows = this.rows.map(row => (row.id === id ? { ...row, ...changes } : row));
  }
}

const setup = () => {
  const db = new FakeDetectionDatabase();
  const recordEvent = vi.fn<(event: CaptureEventInput) => Promise<string>>(async () => 'event-1');
  const drafts = new SqliteDetectionDraftStore(db as never, { recordEvent });
  return { db, drafts, recordEvent };
};

const input = (overrides: Partial<DetectionDraftInput> = {}): DetectionDraftInput => ({
  merchant: 'Shoprite',
  amount: 12500,
  currency: 'NGN',
  category: 'groceries',
  note: 'Weekly shop',
  source: 'auto_capture',
  ...overrides,
});

const at = (hoursAgo: number): number => NOW - hoursAgo * 60 * 60 * 1000;

const savedExpense = (id: string): Expense => ({ id, merchant: 'Shoprite', amount: 12500, currency: 'NGN', category: 'groceries', scanned: 0, date: NOW, created_at: NOW }) as Expense;

const savedIncome = (id: string): Income => ({ id, source: 'KINGSLEY U', amount: 2000, currency: 'NGN', category: 'other', date: NOW, created_at: NOW }) as Income;

const incomeInput = (overrides: Partial<IncomeDetectionDraftInput> = {}): IncomeDetectionDraftInput => ({
  sourceName: 'KINGSLEY U',
  amount: 2000,
  currency: 'NGN',
  category: 'other',
  note: 'Detected from Messages',
  source: 'auto_capture',
  origin: 'auto_capture',
  ...overrides,
});

describe('detection draft stale query', () => {
  it('ships the stale window as one named 72 hour constant', () => {
    expect(STALE_AFTER_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('surfaces drafts older than 72 hours oldest first with their age, and stays quiet at exactly 72 hours', async () => {
    const { drafts } = setup();
    await drafts.createDetectionDraft({ ...input(), detectedAt: at(80) }, NOW);
    await drafts.createDetectionDraft({ ...input(), detectedAt: at(73) }, NOW);
    await drafts.createDetectionDraft({ ...input(), detectedAt: at(72) }, NOW);
    await drafts.createDetectionDraft({ ...input(), detectedAt: at(1) }, NOW);

    const stale = await drafts.listStaleDrafts(NOW);

    expect(stale.map(item => item.draft.detectedAt)).toEqual([at(80), at(73)]);
    expect(stale.map(item => item.ageMs)).toEqual([80 * 60 * 60 * 1000, 73 * 60 * 60 * 1000]);
  });

  it('keeps confirmed, discarded, and filed drafts out of the stale queue', async () => {
    const { drafts } = setup();
    const confirmed = await drafts.createDetectionDraft({ ...input(), detectedAt: at(90) }, NOW);
    const discarded = await drafts.createDetectionDraft({ ...input(), detectedAt: at(91) }, NOW);
    const filed = await drafts.createDetectionDraft({ ...input(), detectedAt: at(92) }, NOW);
    await drafts.resolveDetectionDraft(confirmed.id, 'confirmed', NOW);
    await drafts.resolveDetectionDraft(discarded.id, 'discarded', NOW);
    await drafts.resolveDetectionDraft(filed.id, 'filed', NOW);

    await expect(drafts.listStaleDrafts(NOW)).resolves.toEqual([]);
  });

  it('counts pending drafts including snoozed ones', async () => {
    const { drafts } = setup();
    const first = await drafts.createDetectionDraft(input(), NOW);
    await drafts.createDetectionDraft(input(), NOW);
    await drafts.snoozeDetectionDraft(first.id, NOW);

    await expect(drafts.countPendingDrafts()).resolves.toBe(2);
  });
});

describe('detection draft snooze', () => {
  it('ships the snooze window as one named 24 hour constant', () => {
    expect(DRAFT_SNOOZE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('sets remind later to now plus 24 hours and suppresses only the re-ping', async () => {
    const { drafts } = setup();
    const draft = await drafts.createDetectionDraft(input(), NOW);

    const outcome = await drafts.snoozeDetectionDraft(draft.id, NOW);

    expect(outcome).toMatchObject({ status: 'snoozed', snoozedUntil: NOW + DRAFT_SNOOZE_MS });
    const reloaded = await drafts.getDetectionDraft(draft.id);
    expect(isRePingSuppressed(reloaded as DetectionDraft, NOW)).toBe(true);
    expect(isRePingSuppressed(reloaded as DetectionDraft, NOW + DRAFT_SNOOZE_MS)).toBe(false);
    expect(await drafts.listPendingDrafts()).toHaveLength(1);
    await expect(drafts.countPendingDrafts()).resolves.toBe(1);
  });

  it('keeps the 72 hour stale clock running from first detection, never from the snooze', async () => {
    const { drafts } = setup();
    const draft = await drafts.createDetectionDraft({ ...input(), detectedAt: at(73) }, NOW);

    await drafts.snoozeDetectionDraft(draft.id, NOW);

    const stale = await drafts.listStaleDrafts(NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].ageMs).toBe(73 * 60 * 60 * 1000);
  });

  it('refuses to snooze a missing or already resolved draft without touching notifications', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-1' }, NOW);
    await drafts.resolveDetectionDraft(draft.id, 'discarded', NOW);
    db.accountedNotifications.length = 0;

    await expect(drafts.snoozeDetectionDraft('missing', NOW)).resolves.toMatchObject({ status: 'not_found' });
    await expect(drafts.snoozeDetectionDraft(draft.id, NOW)).resolves.toMatchObject({ status: 'already_resolved' });
    expect(db.accountedNotifications).toEqual([]);
  });
});

describe('detection draft batch discard', () => {
  it('discard many removes all listed with per item outcomes', async () => {
    const { db, drafts, recordEvent } = setup();
    const first = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-1' }, NOW);
    const second = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-2' }, NOW);
    const third = await drafts.createDetectionDraft(input(), NOW);

    const report = await drafts.discardDetectionDrafts([first.id, second.id, third.id], NOW);

    expect(report.items).toEqual([
      { id: first.id, status: 'discarded' },
      { id: second.id, status: 'discarded' },
      { id: third.id, status: 'discarded' },
    ]);
    expect(db.rows.every(row => row.status === 'discarded')).toBe(true);
    expect(recordEvent).toHaveBeenCalledTimes(3);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'discarded', merchant: 'Shoprite' }));
    expect(db.accountedNotifications).toEqual(['inbox-1', 'inbox-2']);
    await expect(drafts.countPendingDrafts()).resolves.toBe(0);
  });

  it('reports not found and already resolved per item without silently dropping them', async () => {
    const { drafts, recordEvent } = setup();
    const kept = await drafts.createDetectionDraft(input(), NOW);
    const done = await drafts.createDetectionDraft(input(), NOW);
    await drafts.discardDetectionDraft(done.id, NOW);
    recordEvent.mockClear();

    const report = await drafts.discardDetectionDrafts([kept.id, 'missing', done.id], NOW);

    expect(report.items).toEqual([
      { id: kept.id, status: 'discarded' },
      { id: 'missing', status: 'not_found' },
      { id: done.id, status: 'already_resolved' },
    ]);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });
});

describe('detection draft batch filing', () => {
  it('files uncategorized with category other, the filing note, and no memory write', async () => {
    const { db, drafts, recordEvent } = setup();
    const noted = await drafts.createDetectionDraft({ ...input(), note: 'Lunch', notificationId: 'inbox-1' }, NOW);
    const bare = await drafts.createDetectionDraft({ ...input(), note: undefined, notificationId: 'inbox-2' }, NOW);

    expect(UNCATEGORIZED_FILING_CATEGORY).toBe('other');
    const report = await drafts.fileDetectionDraftsUncategorized([noted.id, bare.id], NOW);

    expect(report.items).toEqual([
      { id: noted.id, status: 'filed', expenseId: expect.any(String) },
      { id: bare.id, status: 'filed', expenseId: expect.any(String) },
    ]);
    expect(db.expenseMerges).toHaveLength(2);
    // Category column is index 4, note column is index 5 in the shared insert.
    expect(db.expenseMerges.map(params => params[4])).toEqual(['other', 'other']);
    expect(db.expenseMerges.map(params => params[5])).toEqual(['Lunch | Filed from stale review', 'Filed from stale review']);
    expect(db.statements.join(' ')).not.toContain('merchant_category_memory');
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', category: 'other' }));
    expect(db.rows.every(row => row.status === 'filed')).toBe(true);
    expect(db.accountedNotifications).toEqual(['inbox-1', 'inbox-2']);
  });

  it('assign many applies one caller category with no memory write', async () => {
    const { db, drafts, recordEvent } = setup();
    const first = await drafts.createDetectionDraft(input(), NOW);
    const second = await drafts.createDetectionDraft(input(), NOW);

    const report = await drafts.assignDetectionDrafts([first.id, second.id], 'transport', NOW);

    expect(report.items).toEqual([
      { id: first.id, status: 'assigned', expenseId: expect.any(String) },
      { id: second.id, status: 'assigned', expenseId: expect.any(String) },
    ]);
    expect(db.expenseMerges.map(params => params[4])).toEqual(['transport', 'transport']);
    expect(db.expenseMerges.map(params => params[5])).toEqual(['Weekly shop', 'Weekly shop']);
    expect(db.statements.join(' ')).not.toContain('merchant_category_memory');
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', category: 'transport' }));
    expect(db.rows.every(row => row.status === 'filed')).toBe(true);
  });

  it('rejects a blank batch category without touching drafts', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createDetectionDraft(input(), NOW);

    await expect(drafts.assignDetectionDrafts([draft.id], '   ', NOW)).rejects.toBeInstanceOf(DetectionDraftValidationError);
    expect((await drafts.getDetectionDraft(draft.id))?.status).toBe('pending');
    expect(db.expenseMerges).toEqual([]);
  });

  it('reports a write failure per item and resolves the rest', async () => {
    const { db, drafts } = setup();
    db.failExpenseInsertForMerchant.add('Bad merchant');
    const bad = await drafts.createDetectionDraft({ ...input(), merchant: 'Bad merchant' }, NOW);
    const good = await drafts.createDetectionDraft(input(), NOW);

    const report = await drafts.fileDetectionDraftsUncategorized([bad.id, 'missing', good.id], NOW);

    expect(report.items).toEqual([
      { id: bad.id, status: 'failed', errorCode: 'write_failed' },
      { id: 'missing', status: 'not_found' },
      { id: good.id, status: 'filed', expenseId: expect.any(String) },
    ]);
    expect((await drafts.getDetectionDraft(bad.id))?.status).toBe('pending');
    expect((await drafts.getDetectionDraft(good.id))?.status).toBe('filed');
  });
});

describe('detection draft single confirm and accounted contract', () => {
  it('confirm saves through the shared boundary and marks the inbox row accounted', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-1' }, NOW);
    const resolveSave = vi.fn(async () => ({ status: 'saved', record: savedExpense('exp-1'), origin: { source: 'auto_capture', origin: 'auto_capture', reviewed: true } }));

    const outcome = await drafts.confirmDetectionDraft(draft.id, resolveSave as never, NOW);

    expect(outcome).toMatchObject({ status: 'confirmed', expenseId: 'exp-1' });
    expect(resolveSave).toHaveBeenCalledWith(expect.objectContaining({ merchant: 'Shoprite', category: 'groceries', origin: 'auto_capture' }));
    expect((await drafts.getDetectionDraft(draft.id))?.status).toBe('confirmed');
    expect(db.accountedNotifications).toEqual(['inbox-1']);
  });

  it('a duplicate keeps the draft pending and the inbox row unaccounted', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-1' }, NOW);
    const resolveSave = vi.fn(async () => ({ status: 'duplicate', duplicate: { existing: savedExpense('exp-0'), reason: 'merchant_amount_24h' }, origin: { source: 'auto_capture', origin: 'auto_capture', reviewed: true } }));

    const outcome = await drafts.confirmDetectionDraft(draft.id, resolveSave as never, NOW);

    expect(outcome.status).toBe('duplicate');
    expect((await drafts.getDetectionDraft(draft.id))?.status).toBe('pending');
    expect(db.accountedNotifications).toEqual([]);
  });

  it('confirm reports missing and resolved drafts without calling the boundary', async () => {
    const { drafts } = setup();
    const resolveSave = vi.fn();

    await expect(drafts.confirmDetectionDraft('missing', resolveSave as never, NOW)).resolves.toMatchObject({ status: 'not_found' });
    const draft = await drafts.createDetectionDraft(input(), NOW);
    await drafts.discardDetectionDraft(draft.id, NOW);
    await expect(drafts.confirmDetectionDraft(draft.id, resolveSave as never, NOW)).resolves.toMatchObject({ status: 'already_resolved' });
    expect(resolveSave).not.toHaveBeenCalled();
  });

  it('resolve without a linked inbox row writes no notification flag', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createDetectionDraft(input(), NOW);

    await drafts.resolveDetectionDraft(draft.id, 'filed', NOW);

    expect(db.accountedNotifications).toEqual([]);
  });

  it('refuses to create a draft with no amount or no currency', async () => {
    const { drafts } = setup();

    await expect(drafts.createDetectionDraft({ ...input(), amount: 0 }, NOW)).rejects.toBeInstanceOf(DetectionDraftValidationError);
    await expect(drafts.createDetectionDraft({ ...input(), currency: '  ' }, NOW)).rejects.toBeInstanceOf(DetectionDraftValidationError);
  });
});

describe('detection draft row link (M2 raise path)', () => {
  it('links a pending draft to its inbox row without changing status', async () => {
    const { drafts } = setup();
    const draft = await drafts.createDetectionDraft(input(), NOW);
    expect(draft.notificationId).toBeNull();

    const linked = await drafts.setDetectionDraftNotificationId(draft.id, 'row-1', NOW);

    expect(linked?.notificationId).toBe('row-1');
    expect(linked?.status).toBe('pending');
    expect((await drafts.getDetectionDraft(draft.id))?.notificationId).toBe('row-1');
  });

  it('refuses to link a missing or already resolved draft', async () => {
    const { drafts } = setup();

    await expect(drafts.setDetectionDraftNotificationId('missing', 'row-1', NOW)).resolves.toBeNull();
    const draft = await drafts.createDetectionDraft(input(), NOW);
    await drafts.discardDetectionDraft(draft.id, NOW);
    await expect(drafts.setDetectionDraftNotificationId(draft.id, 'row-1', NOW)).resolves.toBeNull();
    expect((await drafts.getDetectionDraft(draft.id))?.notificationId).toBeNull();
  });
});

describe('detection draft helpers', () => {
  it('marks only pending drafts past the window as stale', () => {
    const base: DetectionDraft = {
      id: 'd', merchant: 'Shoprite', amount: 1, currency: 'NGN', category: 'groceries', note: null,
      source: 'auto_capture', detectedAt: at(73), snoozedUntil: null, status: 'pending',
      notificationId: null, createdAt: NOW, updatedAt: NOW,
    };
    expect(isStaleDraft(base, NOW)).toBe(true);
    expect(isStaleDraft({ ...base, detectedAt: at(72) }, NOW)).toBe(false);
    expect(isStaleDraft({ ...base, detectedAt: at(1) }, NOW)).toBe(false);
    expect(isStaleDraft({ ...base, status: 'filed' }, NOW)).toBe(false);
  });

  it('records the filing path in the note without guessing a category', () => {
    expect(buildFilingNote('Lunch')).toBe('Lunch | Filed from stale review');
    expect(buildFilingNote(null)).toBe('Filed from stale review');
    expect(buildFilingNote('  ')).toBe('Filed from stale review');
  });
});

// Phase 16 D2. Income drafts persist with every field the saveIncome boundary
// needs, and the merchant mirror keeps readers predating D2 rendering a real
// name with no change.
describe('detection draft income shape', () => {
  it('persists an income draft and reloads every carried field', async () => {
    const { drafts } = setup();

    const created = await drafts.createIncomeDetectionDraft({ ...incomeInput(), detectedAt: at(1), notificationId: 'inbox-9' }, NOW);
    const reloaded = await drafts.getDetectionDraft(created.id);

    expect(created.kind).toBe('income');
    expect(reloaded).toMatchObject({
      kind: 'income',
      sourceName: 'KINGSLEY U',
      merchant: 'KINGSLEY U',
      amount: 2000,
      currency: 'NGN',
      category: 'other',
      detectedAt: at(1),
      note: 'Detected from Messages',
      origin: 'auto_capture',
      source: 'auto_capture',
      status: 'pending',
      notificationId: 'inbox-9',
    });
  });

  it('keeps expense drafts expense shaped and byte compatible', async () => {
    const { drafts } = setup();

    const created = await drafts.createDetectionDraft(input(), NOW);
    const reloaded = await drafts.getDetectionDraft(created.id);

    expect(reloaded).toMatchObject({
      kind: 'expense',
      origin: 'auto_capture',
      sourceName: null,
      merchant: 'Shoprite',
      amount: 12500,
      currency: 'NGN',
      category: 'groceries',
      note: 'Weekly shop',
    });
  });

  it('reads a pre-D2 row with null kind columns as an expense draft', async () => {
    const { db, drafts } = setup();
    db.rows.push({
      id: 'legacy-1', merchant: 'Shoprite', amount: 12500, currency: 'NGN', category: 'groceries',
      note: 'Weekly shop', source: 'auto_capture', detected_at: at(80), snoozed_until: null,
      status: 'pending', notification_id: null, created_at: at(80), updated_at: at(80),
      kind: null, origin: null, source_name: null,
    });

    const reloaded = await drafts.getDetectionDraft('legacy-1');

    expect(reloaded).toMatchObject({ kind: 'expense', origin: null, sourceName: null, merchant: 'Shoprite' });
    expect(isIncomeDraft(reloaded as DetectionDraft)).toBe(false);
    expect(await drafts.listStaleDrafts(NOW)).toHaveLength(1);
  });

  it('reads an absent kind as expense, so M3 era literals keep compiling and behaving', () => {
    const legacy: DetectionDraft = {
      id: 'd', merchant: 'KINGSLEY U', amount: 2000, currency: 'NGN', category: 'other',
      note: 'Detected from Messages', source: 'auto_capture', detectedAt: NOW, snoozedUntil: null,
      status: 'pending', notificationId: null, createdAt: NOW, updatedAt: NOW,
    };
    expect(normalizeDraftKind(legacy)).toBe('expense');
    expect(isIncomeDraft(legacy)).toBe(false);
    expect(incomeSourceNameOf({ ...legacy, sourceName: 'KINGSLEY U' })).toBe('KINGSLEY U');
    expect(incomeSourceNameOf({ ...legacy, sourceName: null })).toBe('KINGSLEY U');
  });

  it('rebuilds the pure D1 income candidate with no merchant key', () => {
    const draft: DetectionDraft = {
      id: 'd', merchant: 'KINGSLEY U', amount: 2000, currency: 'NGN', category: 'other',
      note: 'Detected from Messages', source: 'auto_capture', detectedAt: NOW, snoozedUntil: null,
      status: 'pending', notificationId: null, createdAt: NOW, updatedAt: NOW,
      kind: 'income', origin: 'auto_capture', sourceName: 'KINGSLEY U',
    };
    const candidate: IncomeCandidate = toIncomeCandidate(draft);
    expect('merchant' in candidate).toBe(false);
    expect(candidate).toMatchObject({
      sourceName: 'KINGSLEY U',
      amount: 2000,
      currency: 'NGN',
      category: 'other',
      date: NOW,
      note: 'Detected from Messages',
      source: 'auto_capture',
      origin: 'auto_capture',
    });
  });

  it('rejects an income draft with no sender, no amount, or no currency', async () => {
    const { drafts } = setup();

    await expect(drafts.createIncomeDetectionDraft({ ...incomeInput(), sourceName: '   ' }, NOW)).rejects.toMatchObject({ code: 'detection_draft_validation', field: 'sourceName' });
    await expect(drafts.createIncomeDetectionDraft({ ...incomeInput(), amount: 0 }, NOW)).rejects.toBeInstanceOf(DetectionDraftValidationError);
    await expect(drafts.createIncomeDetectionDraft({ ...incomeInput(), currency: '  ' }, NOW)).rejects.toBeInstanceOf(DetectionDraftValidationError);
  });
});

describe('detection draft income stale, snooze, and discard parity', () => {
  it('applies the stale window to income drafts exactly like expense drafts', async () => {
    const { drafts } = setup();
    await drafts.createIncomeDetectionDraft({ ...incomeInput(), detectedAt: at(80) }, NOW);
    await drafts.createDetectionDraft({ ...input(), detectedAt: at(73) }, NOW);
    await drafts.createIncomeDetectionDraft({ ...incomeInput(), detectedAt: at(72) }, NOW);
    await drafts.createIncomeDetectionDraft({ ...incomeInput(), detectedAt: at(1) }, NOW);

    const stale = await drafts.listStaleDrafts(NOW);

    expect(stale.map(item => item.draft.detectedAt)).toEqual([at(80), at(73)]);
    expect(stale.map(item => item.draft.kind)).toEqual(['income', 'expense']);
    expect(stale.map(item => item.ageMs)).toEqual([80 * 60 * 60 * 1000, 73 * 60 * 60 * 1000]);
  });

  it('snoozes an income draft with the same 24 hour suppression and running stale clock', async () => {
    const { drafts } = setup();
    const draft = await drafts.createIncomeDetectionDraft({ ...incomeInput(), detectedAt: at(73) }, NOW);

    const outcome = await drafts.snoozeDetectionDraft(draft.id, NOW);

    expect(outcome).toMatchObject({ status: 'snoozed', snoozedUntil: NOW + DRAFT_SNOOZE_MS });
    const reloaded = await drafts.getDetectionDraft(draft.id);
    expect(isRePingSuppressed(reloaded as DetectionDraft, NOW)).toBe(true);
    expect(await drafts.listPendingDrafts()).toHaveLength(1);
    expect(await drafts.countPendingDrafts()).toBe(1);
    const stale = await drafts.listStaleDrafts(NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].draft.kind).toBe('income');
  });

  it('discards an income draft with the sender as the event name and the linked row accounted', async () => {
    const { db, drafts, recordEvent } = setup();
    const draft = await drafts.createIncomeDetectionDraft({ ...incomeInput(), notificationId: 'inbox-7' }, NOW);

    const report = await drafts.discardDetectionDrafts([draft.id], NOW);

    expect(report.items).toEqual([{ id: draft.id, status: 'discarded' }]);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'discarded', merchant: 'KINGSLEY U' }));
    expect(db.accountedNotifications).toEqual(['inbox-7']);
  });
});

describe('detection draft income batch filing', () => {
  it('files uncategorized as income rows with the filing note and no memory write', async () => {
    const { db, drafts, recordEvent } = setup();
    const income = await drafts.createIncomeDetectionDraft({ ...incomeInput(), notificationId: 'inbox-1' }, NOW);
    const expense = await drafts.createDetectionDraft({ ...input(), notificationId: 'inbox-2' }, NOW);

    const report = await drafts.fileDetectionDraftsUncategorized([income.id, expense.id], NOW);

    expect(report.items).toEqual([
      { id: income.id, status: 'filed', incomeId: expect.any(String) },
      { id: expense.id, status: 'filed', expenseId: expect.any(String) },
    ]);
    // Income insert columns: id, source, amount, currency, category, note, is_recurring, date, created_at.
    expect(db.incomeMerges).toHaveLength(1);
    expect(db.incomeMerges[0]?.slice(1, 6)).toEqual(['KINGSLEY U', 2000, 'NGN', 'other', 'Detected from Messages | Filed from stale review']);
    expect(db.expenseMerges).toHaveLength(1);
    expect(db.expenseMerges.map(params => params[4])).toEqual(['other']);
    expect(db.statements.join(' ')).not.toContain('merchant_category_memory');
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', merchant: 'KINGSLEY U', category: 'other' }));
    expect(db.accountedNotifications).toEqual(['inbox-1', 'inbox-2']);
    expect(db.rows.every(row => row.status === 'filed')).toBe(true);
  });

  it('assigns one caller category to income drafts with no memory write and the original note kept', async () => {
    const { db, drafts, recordEvent } = setup();
    const income = await drafts.createIncomeDetectionDraft(incomeInput(), NOW);
    const expense = await drafts.createDetectionDraft(input(), NOW);

    const report = await drafts.assignDetectionDrafts([income.id, expense.id], 'salary', NOW);

    expect(report.items).toEqual([
      { id: income.id, status: 'assigned', incomeId: expect.any(String) },
      { id: expense.id, status: 'assigned', expenseId: expect.any(String) },
    ]);
    expect(db.incomeMerges.map(params => params[4])).toEqual(['salary']);
    expect(db.incomeMerges.map(params => params[5])).toEqual(['Detected from Messages']);
    expect(db.expenseMerges.map(params => params[4])).toEqual(['salary']);
    expect(db.statements.join(' ')).not.toContain('merchant_category_memory');
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', merchant: 'KINGSLEY U', category: 'salary' }));
    expect(db.rows.every(row => row.status === 'filed')).toBe(true);
  });
});

describe('detection draft income confirm and accounted contract', () => {
  it('confirms an income draft through the shared saveIncome boundary and marks the row accounted', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createIncomeDetectionDraft({ ...incomeInput(), notificationId: 'inbox-1' }, NOW);
    const resolveSave = vi.fn(async (candidate: IncomeCandidate) => ({ status: 'saved', record: savedIncome('inc-1'), origin: { source: 'auto_capture', origin: 'auto_capture', reviewed: true } }));

    const outcome = await drafts.confirmIncomeDetectionDraft(draft.id, resolveSave as never, NOW);

    expect(outcome).toMatchObject({ status: 'confirmed', incomeId: 'inc-1' });
    expect(resolveSave).toHaveBeenCalledWith(expect.objectContaining({ sourceName: 'KINGSLEY U', amount: 2000, currency: 'NGN', category: 'other', origin: 'auto_capture' }));
    expect(resolveSave.mock.calls[0]?.[0]).not.toHaveProperty('merchant');
    expect((await drafts.getDetectionDraft(draft.id))?.status).toBe('confirmed');
    expect(db.accountedNotifications).toEqual(['inbox-1']);
  });

  it('a duplicate keeps the income draft pending and the inbox row unaccounted', async () => {
    const { db, drafts } = setup();
    const draft = await drafts.createIncomeDetectionDraft({ ...incomeInput(), notificationId: 'inbox-1' }, NOW);
    const resolveSave = vi.fn(async () => ({ status: 'duplicate', duplicate: { existing: savedIncome('inc-0'), reason: 'source_amount_24h' }, origin: { source: 'auto_capture', origin: 'auto_capture', reviewed: true } }));

    const outcome = await drafts.confirmIncomeDetectionDraft(draft.id, resolveSave as never, NOW);

    expect(outcome.status).toBe('duplicate');
    expect((await drafts.getDetectionDraft(draft.id))?.status).toBe('pending');
    expect(db.accountedNotifications).toEqual([]);
  });

  it('refuses to cross kinds without calling either saver', async () => {
    const { drafts } = setup();
    const income = await drafts.createIncomeDetectionDraft(incomeInput(), NOW);
    const expense = await drafts.createDetectionDraft(input(), NOW);
    const incomeSave = vi.fn();
    const expenseSave = vi.fn();

    await expect(drafts.confirmIncomeDetectionDraft(expense.id, incomeSave as never, NOW)).resolves.toMatchObject({ status: 'already_resolved' });
    await expect(drafts.confirmDetectionDraft(income.id, expenseSave as never, NOW)).resolves.toMatchObject({ status: 'already_resolved' });
    expect(incomeSave).not.toHaveBeenCalled();
    expect(expenseSave).not.toHaveBeenCalled();
    expect((await drafts.getDetectionDraft(income.id))?.status).toBe('pending');
    expect((await drafts.getDetectionDraft(expense.id))?.status).toBe('pending');
  });

  it('confirm reports missing and resolved income drafts without calling the saver', async () => {
    const { drafts } = setup();
    const resolveSave = vi.fn();

    await expect(drafts.confirmIncomeDetectionDraft('missing', resolveSave as never, NOW)).resolves.toMatchObject({ status: 'not_found' });
    const draft = await drafts.createIncomeDetectionDraft(incomeInput(), NOW);
    await drafts.discardDetectionDraft(draft.id, NOW);
    await expect(drafts.confirmIncomeDetectionDraft(draft.id, resolveSave as never, NOW)).resolves.toMatchObject({ status: 'already_resolved' });
    expect(resolveSave).not.toHaveBeenCalled();
  });

  it('preserves caller-supplied native draftId idempotently for both expense and income', async () => {
    const { db, drafts } = setup();
    const firstExpense = await drafts.createDetectionDraft({ ...input(), id: 'native-exp-1' }, NOW);
    const repeatExpense = await drafts.createDetectionDraft({ ...input(), id: 'native-exp-1' }, NOW + 10);
    expect(firstExpense.id).toBe('native-exp-1');
    expect(repeatExpense.id).toBe('native-exp-1');

    const firstIncome = await drafts.createIncomeDetectionDraft({ ...incomeInput(), id: 'native-inc-1' }, NOW);
    const repeatIncome = await drafts.createIncomeDetectionDraft({ ...incomeInput(), id: 'native-inc-1' }, NOW + 10);
    expect(firstIncome.id).toBe('native-inc-1');
    expect(repeatIncome.id).toBe('native-inc-1');
    expect(db.rows).toHaveLength(2);
  });
});
