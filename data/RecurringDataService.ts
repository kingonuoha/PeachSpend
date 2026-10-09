import type { RecurringTemplate } from '../types/database';
import {
  formatRecurrenceDays, type RecurrenceInterval, type RecurringDraft, type RecurringInsert,
  type RecurringInvalidField, type RecurringListState, type RecurringMutationResult, type RecurringPort,
  type RecurringRecord, type RecurringType, type RecurringUpdate,
} from './RecurringContracts';

const DAY_MS = 86_400_000;
const INTERVALS: readonly RecurrenceInterval[] = ['daily', 'weekly', 'monthly', 'custom'];

export function parseRecurrenceDays(value: string | number[] | null | undefined): number[] {
  if (Array.isArray(value)) return sanitizeDays(value);
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? sanitizeDays(parsed) : [];
  } catch {
    return [];
  }
}

function sanitizeDays(values: unknown[]): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6))].sort();
}

export function normalizeInterval(value: string | null | undefined): RecurrenceInterval {
  return INTERVALS.includes(value as RecurrenceInterval) ? (value as RecurrenceInterval) : 'monthly';
}

export function normalizeRecurringType(value: string | null | undefined): RecurringType {
  return value === 'income' ? 'income' : 'expense';
}

// Single next-due rule shared by DatabaseService.getNextDueDate and this
// service, so S-15 and the Repeats shortcuts cannot schedule differently.
export function computeNextDueDate(
  interval: RecurrenceInterval,
  recurrenceDays: number[] | null | undefined,
  fromDate?: number,
): number {
  const base = fromDate ? new Date(fromDate) : new Date();
  base.setHours(0, 0, 0, 0);
  if (interval === 'daily') return base.setDate(base.getDate() + 1);
  if (interval === 'weekly') return base.setDate(base.getDate() + 7);
  if (interval === 'monthly') return base.setMonth(base.getMonth() + 1);
  const days = recurrenceDays ?? [];
  if (interval === 'custom' && days.length > 0) {
    const currentDay = base.getDay();
    for (let offset = 1; offset <= 7; offset += 1) {
      const nextDay = (currentDay + offset) % 7;
      if (days.includes(nextDay)) {
        const next = new Date(base);
        next.setDate(base.getDate() + offset);
        next.setHours(0, 0, 0, 0);
        return next.getTime();
      }
    }
  }
  return base.getTime() + DAY_MS;
}

export interface RecurringInsertInput {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note?: string;
  interval: RecurrenceInterval;
  recurrenceDays?: number[] | null;
  type: RecurringType;
  nextDueDate: number;
  now: number;
}

// Normalizes every field of a recurring template exactly once, for both the
// S-15/Repeats boundary and the capture handoff, so their stored rows match.
export function buildRecurringInsert(input: RecurringInsertInput): RecurringInsert {
  const days = parseRecurrenceDays(input.recurrenceDays ?? []);
  return {
    id: input.id,
    merchant: input.merchant.trim(),
    amount: input.amount,
    currency: input.currency,
    category: input.category.trim() || 'other',
    note: input.note ?? '',
    interval: input.interval,
    recurrence_days: input.interval === 'custom' ? formatRecurrenceDays(days) : undefined,
    next_due_date: input.nextDueDate,
    type: input.type,
    created_at: input.now,
  };
}

export function toRecurringRecord(row: RecurringTemplate): RecurringRecord {
  return {
    id: row.id,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    note: row.note ?? '',
    interval: normalizeInterval(row.interval),
    recurrenceDays: parseRecurrenceDays(row.recurrence_days),
    nextDueDate: row.next_due_date,
    type: normalizeRecurringType(row.type),
    createdAt: row.created_at,
  };
}

export function validateRecurringDraft(
  draft: RecurringDraft,
): { valid: true } | { valid: false; field: RecurringInvalidField; reason: string } {
  if (!draft.merchant.trim()) return { valid: false, field: 'merchant', reason: 'empty' };
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) return { valid: false, field: 'amount', reason: 'not_positive' };
  if (!draft.currency.trim()) return { valid: false, field: 'currency', reason: 'empty' };
  if (!draft.category.trim()) return { valid: false, field: 'category', reason: 'empty' };
  if (!INTERVALS.includes(draft.interval)) return { valid: false, field: 'interval', reason: 'unsupported' };
  if (draft.interval === 'custom' && parseRecurrenceDays(draft.recurrenceDays ?? []).length === 0) {
    return { valid: false, field: 'custom_days', reason: 'empty' };
  }
  return { valid: true };
}

export class RecurringDataService {
  constructor(private readonly port: RecurringPort) {}

  async list(type?: RecurringType): Promise<RecurringListState> {
    const rows = await this.port.getRecurringTemplates(type);
    const templates = rows.map(toRecurringRecord);
    return templates.length > 0 ? { status: 'ready', templates } : { status: 'empty' };
  }

  async create(draft: RecurringDraft, id: string, now = Date.now()): Promise<RecurringMutationResult> {
    const validation = validateRecurringDraft(draft);
    if (!validation.valid) return { status: 'invalid', field: validation.field, reason: validation.reason };
    const days = parseRecurrenceDays(draft.recurrenceDays ?? []);
    const insert = buildRecurringInsert({
      id,
      merchant: draft.merchant,
      amount: draft.amount,
      currency: draft.currency,
      category: draft.category,
      note: draft.note,
      interval: draft.interval,
      recurrenceDays: days,
      type: draft.type,
      nextDueDate: computeNextDueDate(draft.interval, days, now),
      now,
    });
    await this.port.insertRecurringTemplate(insert);
    return {
      status: 'saved',
      template: {
        id,
        merchant: insert.merchant,
        amount: insert.amount,
        currency: insert.currency,
        category: insert.category,
        note: insert.note ?? '',
        interval: draft.interval,
        recurrenceDays: days,
        nextDueDate: insert.next_due_date,
        type: draft.type,
        createdAt: now,
      },
    };
  }

  async update(id: string, draft: RecurringDraft, now = Date.now()): Promise<RecurringMutationResult> {
    const validation = validateRecurringDraft(draft);
    if (!validation.valid) return { status: 'invalid', field: validation.field, reason: validation.reason };
    const existing = await this.port.getRecurringTemplates();
    if (!existing.some(row => row.id === id)) return { status: 'not_found', id };
    const days = parseRecurrenceDays(draft.recurrenceDays ?? []);
    const patch: RecurringUpdate = {
      merchant: draft.merchant.trim(),
      amount: draft.amount,
      currency: draft.currency,
      category: draft.category.trim() || 'other',
      note: draft.note ?? '',
      interval: draft.interval,
      recurrence_days: draft.interval === 'custom' ? formatRecurrenceDays(days) : undefined,
      next_due_date: computeNextDueDate(draft.interval, days, now),
      type: draft.type,
    };
    await this.port.updateRecurringTemplate(id, patch);
    const record: RecurringRecord = {
      id,
      merchant: patch.merchant,
      amount: patch.amount,
      currency: patch.currency,
      category: patch.category,
      note: patch.note ?? '',
      interval: draft.interval,
      recurrenceDays: days,
      nextDueDate: patch.next_due_date,
      type: draft.type,
      createdAt: now,
    };
    return { status: 'saved', template: record };
  }

  async delete(id: string): Promise<{ status: 'deleted'; id: string } | { status: 'not_found'; id: string }> {
    const existing = await this.port.getRecurringTemplates();
    if (!existing.some(row => row.id === id)) return { status: 'not_found', id };
    await this.port.deleteRecurringTemplate(id);
    return { status: 'deleted', id };
  }
}
