import type * as SQLite from 'expo-sqlite';
import { v4 as uuid } from 'uuid';
import type { Expense, Income } from '../types/database';
import { resolveCurrency } from '../utils/currency';
import { assertValidCaptureCandidate, IncomeValidationError, type BatchDuplicateMatch, type CaptureCandidate, type CaptureEventInput, type CaptureEventQuery, type CaptureEventRead, type CaptureRepository, type CaptureSource, type DuplicateMatch, type IncomeCandidate, type QueuedCapture, type RecurringTemplateHandoff } from './contracts';
import { buildRecurringInsert, normalizeInterval, parseRecurrenceDays } from './RecurringDataService';
import type { RecurrenceInterval } from './RecurringContracts';

const keyFor = (merchant: string) => merchant.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const QUEUE_RETENTION_MS = 7 * 86400000;
const DUPLICATE_WINDOW_MS = 86400000;
// FR-22.3 scopes the Diagnostic Activity log to a recent window rather than an
// unbounded scan. The repository clamps both bounds so a caller cannot ask for
// the whole table.
const CAPTURE_EVENT_RETENTION_MS = 30 * 86400000;
const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 200;
const rowToExpense = (candidate: CaptureCandidate, id: string): Expense => ({
  id, merchant: candidate.merchant, amount: candidate.amount, currency: candidate.currency, category: candidate.category,
  note: candidate.note, scanned: candidate.scanned ? 1 : 0, date: candidate.date, created_at: Date.now(), image_uri: candidate.imageUri,
  unit_price: candidate.unitPrice, units: candidate.units, is_reimbursable: candidate.isReimbursable ? 1 : 0, source: candidate.source,
});
const rowToCaptureEvent = (row: { id: string; source: string; status: string; merchant: string | null; amount: number | null; category: string | null; error_code: string | null; created_at: number; updated_at: number }): CaptureEventRead => ({
  id: row.id, source: row.source as CaptureSource, status: row.status as CaptureEventRead['status'], merchant: row.merchant,
  amount: row.amount, category: row.category, errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at,
});

export class SqliteCaptureRepository implements CaptureRepository {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async findDuplicate(candidate: Pick<CaptureCandidate, 'merchant' | 'amount' | 'date'>): Promise<DuplicateMatch | null> {
    const row = await this.db.getFirstAsync<Expense>('SELECT * FROM expenses WHERE LOWER(TRIM(merchant)) = LOWER(TRIM(?)) AND amount = ? AND date BETWEEN ? AND ? LIMIT 1', [candidate.merchant, candidate.amount, candidate.date - DUPLICATE_WINDOW_MS, candidate.date + DUPLICATE_WINDOW_MS]);
    return row ? { existing: row, reason: 'merchant_amount_24h' } : null;
  }

  async findBatchDuplicates(candidates: CaptureCandidate[]): Promise<BatchDuplicateMatch[]> {
    const matches: BatchDuplicateMatch[] = [];
    const rowsByCandidate = await Promise.all(candidates.map(candidate => this.db.getAllAsync<Expense>('SELECT * FROM expenses WHERE LOWER(TRIM(merchant)) = LOWER(TRIM(?)) AND amount = ? AND date BETWEEN ? AND ?', [candidate.merchant, candidate.amount, candidate.date - DUPLICATE_WINDOW_MS, candidate.date + DUPLICATE_WINDOW_MS])));
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      const rows = rowsByCandidate[candidateIndex];
      rows.forEach(existing => matches.push({ candidateIndex, match: { existing, reason: 'merchant_amount_24h' } }));
      for (let otherCandidateIndex = 0; otherCandidateIndex < candidateIndex; otherCandidateIndex += 1) {
        const other = candidates[otherCandidateIndex];
        if (keyFor(candidate.merchant) === keyFor(other.merchant) && candidate.amount === other.amount && Math.abs(candidate.date - other.date) <= DUPLICATE_WINDOW_MS) matches.push({ candidateIndex, otherCandidateIndex, reason: 'same_batch_24h' });
      }
    }
    return matches;
  }

  async save(candidate: CaptureCandidate, allowDuplicate = false): Promise<Expense> {
    const resolvedCandidate = { ...candidate, currency: resolveCurrency(candidate.currency, await this.getUserCurrency()) };
    assertValidCaptureCandidate(resolvedCandidate);
    const duplicate = allowDuplicate ? null : await this.findDuplicate(resolvedCandidate);
    if (duplicate) throw new Error('duplicate');
    const id = uuid();
    const expense = rowToExpense(resolvedCandidate, id);
    await this.db.runAsync('INSERT INTO expenses (id, merchant, amount, currency, category, note, scanned, date, created_at, image_uri, unit_price, units, is_reimbursable, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [expense.id, expense.merchant, expense.amount, expense.currency, expense.category, expense.note || null, expense.scanned, expense.date, expense.created_at, expense.image_uri || null, expense.unit_price ?? null, expense.units ?? null, expense.is_reimbursable ?? 0, expense.source ?? null]);
    await this.rememberCategory(resolvedCandidate.merchant, resolvedCandidate.category, resolvedCandidate.source);
    await this.recordEvent({ source: resolvedCandidate.source, status: 'confirmed', merchant: resolvedCandidate.merchant, amount: resolvedCandidate.amount, category: resolvedCandidate.category, payload: JSON.stringify({ origin: resolvedCandidate.origin ?? 'home' }) });
    return expense;
  }

  private async getUserCurrency(): Promise<string | null> {
    const setting = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['currency']);
    return setting?.value ?? null;
  }

  async saveBatch(candidates: CaptureCandidate[], allowDuplicates = false): Promise<Expense[]> {
    return this.withTransaction(async () => {
      if (!allowDuplicates && (await this.findBatchDuplicates(candidates)).length > 0) throw new Error('duplicate');
      const records: Expense[] = [];
      for (const candidate of candidates) records.push(await this.save(candidate, true));
      return records;
    });
  }

  async findIncomeDuplicate(candidate: Pick<IncomeCandidate, 'sourceName' | 'amount' | 'date'>): Promise<DuplicateMatch | null> {
    const row = await this.db.getFirstAsync<Income>('SELECT * FROM income WHERE LOWER(TRIM(source)) = LOWER(TRIM(?)) AND amount = ? AND date BETWEEN ? AND ? LIMIT 1', [candidate.sourceName, candidate.amount, candidate.date - DUPLICATE_WINDOW_MS, candidate.date + DUPLICATE_WINDOW_MS]);
    return row ? { existing: row, reason: 'source_amount_24h' } : null;
  }

  async saveIncome(candidate: IncomeCandidate, allowDuplicate = false): Promise<Income> {
    if (!candidate.sourceName.trim()) throw new IncomeValidationError('sourceName');
    if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) throw new IncomeValidationError('amount');
    const currency = resolveCurrency(candidate.currency, await this.getUserCurrency());
    if (!Number.isFinite(candidate.date)) throw new IncomeValidationError('date');
    if (!allowDuplicate && await this.findIncomeDuplicate(candidate)) throw new Error('duplicate');
    const category = candidate.category.trim();
    const income: Income = { id: uuid(), source: candidate.sourceName, amount: candidate.amount, currency, category, note: candidate.note, is_recurring: candidate.isRecurring ? 1 : 0, date: candidate.date, created_at: Date.now() };
    await this.db.runAsync('INSERT INTO income (id, source, amount, currency, category, note, is_recurring, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [income.id, income.source, income.amount, income.currency, income.category, income.note || null, income.is_recurring || 0, income.date, income.created_at]);
    await this.recordEvent({ source: candidate.source, status: 'confirmed', merchant: candidate.sourceName, amount: candidate.amount, category, payload: JSON.stringify({ origin: candidate.origin ?? 'home' }) });
    return income;
  }

  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.db.execAsync('BEGIN');
    try {
      const result = await operation();
      await this.db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await this.db.execAsync('ROLLBACK');
      throw error;
    }
  }

  getRecurringTemplateHandoff(): RecurringTemplateHandoff {
    return {
      createFromCapture: async candidate => {
        const isIncome = 'sourceName' in candidate;
        const merchant = isIncome ? candidate.sourceName : candidate.merchant;
        const interval = (candidate.recurrenceInterval as RecurrenceInterval) ?? 'monthly';
        const currency = resolveCurrency(candidate.currency, await this.getUserCurrency());
        const id = uuid();
        // Same field normalization as the S-15/Repeats boundary, so the capture
        // shortcut cannot write a divergent recurring template.
        const insert = buildRecurringInsert({
          id,
          merchant,
          amount: candidate.amount,
          currency,
          category: candidate.category?.trim() || 'other',
          note: candidate.note,
          interval: normalizeInterval(interval),
          recurrenceDays: parseRecurrenceDays(candidate.recurrenceDays ?? null),
          type: isIncome ? 'income' : 'expense',
          nextDueDate: candidate.date,
          now: Date.now(),
        });
        await this.db.runAsync(
          'INSERT INTO recurring_templates (id, merchant, amount, currency, category, note, interval, recurrence_days, next_due_date, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [insert.id, insert.merchant, insert.amount, insert.currency, insert.category, insert.note || null, insert.interval, insert.recurrence_days || null, insert.next_due_date, insert.type || 'expense', insert.created_at],
        );
        return id;
      },
    };
  }

  async rememberCategory(merchant: string, category: string, source: CaptureCandidate['source']): Promise<void> {
    await this.db.runAsync('INSERT OR REPLACE INTO merchant_category_memory (merchant_key, merchant, category, source, updated_at) VALUES (?, ?, ?, ?, ?)', [keyFor(merchant), merchant, category, source, Date.now()]);
  }

  async getRememberedCategory(merchant: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ category: string }>('SELECT category FROM merchant_category_memory WHERE merchant_key = ?', [keyFor(merchant)]);
    return row?.category || null;
  }

  async recordEvent(event: CaptureEventInput): Promise<string> {
    const id = uuid(); const now = Date.now();
    await this.db.runAsync('INSERT INTO capture_events (id, source, status, merchant, amount, category, payload, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, event.source, event.status, event.merchant || null, event.amount ?? null, event.category || null, event.payload || null, event.errorCode || null, now, now]);
    return id;
  }

  async listEvents(query: CaptureEventQuery = {}): Promise<CaptureEventRead[]> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_EVENT_LIMIT, 1), MAX_EVENT_LIMIT);
    const since = query.since ?? Date.now() - CAPTURE_EVENT_RETENTION_MS;
    const params: (string | number)[] = [since];
    let sql = 'SELECT id, source, status, merchant, amount, category, error_code, created_at, updated_at FROM capture_events WHERE created_at >= ?';
    if (query.sources?.length) {
      sql += ` AND source IN (${query.sources.map(() => '?').join(', ')})`;
      params.push(...query.sources);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = await this.db.getAllAsync<Parameters<typeof rowToCaptureEvent>[0]>(sql, params);
    return rows.map(rowToCaptureEvent);
  }

  async enqueueAutoCapture(payload: CaptureCandidate): Promise<string> {
    const id = uuid();
    const now = Date.now();
    await this.db.runAsync('INSERT INTO capture_queue (id, source, payload, attempts, available_at, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)', [id, payload.source, JSON.stringify({ ...payload, imageUri: undefined }), now, now + QUEUE_RETENTION_MS, now]);
    await this.recordEvent({ source: 'auto_capture', status: 'queued', merchant: payload.merchant, amount: payload.amount, category: payload.category });
    return id;
  }

  async claimQueuedAutoCaptures(now = Date.now()): Promise<QueuedCapture[]> {
    await this.db.runAsync('DELETE FROM capture_queue WHERE expires_at <= ?', [now]);
    const rows = await this.db.getAllAsync<{ id: string; payload: string; attempts: number }>('SELECT id, payload, attempts FROM capture_queue WHERE available_at <= ? AND expires_at > ? ORDER BY created_at ASC', [now, now]);
    return rows.flatMap(row => { try { return [{ id: row.id, payload: JSON.parse(row.payload) as CaptureCandidate, attempts: row.attempts }]; } catch { return []; } });
  }

  async completeQueuedAutoCapture(id: string): Promise<void> { await this.db.runAsync('DELETE FROM capture_queue WHERE id = ?', [id]); }
  async failQueuedAutoCapture(id: string, errorCode: string, retryAt: number): Promise<void> { await this.db.runAsync('UPDATE capture_queue SET attempts = attempts + 1, available_at = ?, last_error_code = ? WHERE id = ?', [retryAt, errorCode, id]); }
  async discardQueuedAutoCaptures(): Promise<void> {
    await this.db.runAsync('DELETE FROM capture_queue WHERE source = ?', ['auto_capture']);
  }
}
