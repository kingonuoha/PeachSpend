import type { RecurringTemplate } from '../types/database';

export type RecurrenceInterval = 'daily' | 'weekly' | 'monthly' | 'custom';
export type RecurringType = 'expense' | 'income';

export interface RecurringRecord {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note: string;
  interval: RecurrenceInterval;
  recurrenceDays: number[];
  nextDueDate: number;
  type: RecurringType;
  createdAt: number;
}

// One draft shape for both S-15's own create/edit and the S-09/S-11 Repeats
// shortcut (FR-15.1). No second recurring-creation path exists.
export interface RecurringDraft {
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note?: string;
  interval: RecurrenceInterval;
  recurrenceDays?: number[];
  type: RecurringType;
}

export interface RecurringInsert {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note?: string;
  interval: string;
  recurrence_days?: string;
  next_due_date: number;
  type?: string;
  created_at: number;
}

export type RecurringUpdate = Omit<RecurringInsert, 'id' | 'created_at'>;

export type RecurringInvalidField = 'merchant' | 'amount' | 'currency' | 'category' | 'interval' | 'custom_days';

export type RecurringMutationResult =
  | { status: 'saved'; template: RecurringRecord }
  | { status: 'invalid'; field: RecurringInvalidField; reason: string }
  | { status: 'not_found'; id: string };

export type RecurringDeleteResult = { status: 'deleted'; id: string } | { status: 'not_found'; id: string };

export type RecurringListState =
  | { status: 'ready'; templates: RecurringRecord[] }
  | { status: 'empty' };

export interface RecurringPort {
  getRecurringTemplates(type?: string): Promise<RecurringTemplate[]>;
  insertRecurringTemplate(template: RecurringInsert): Promise<void>;
  updateRecurringTemplate(id: string, patch: RecurringUpdate): Promise<void>;
  deleteRecurringTemplate(id: string): Promise<void>;
}

export function formatRecurrenceDays(days: number[] | null | undefined): string | undefined {
  if (!days || days.length === 0) return undefined;
  return JSON.stringify(days);
}
