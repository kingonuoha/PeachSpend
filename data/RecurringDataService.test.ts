import { beforeEach, describe, expect, it } from 'vitest';
import type { RecurringTemplate } from '../types/database';
import type { RecurringDraft, RecurringInsert, RecurringPort, RecurringUpdate } from './RecurringContracts';
import { RecurringDataService, buildRecurringInsert, computeNextDueDate, parseRecurrenceDays } from './RecurringDataService';

class MemoryRecurringPort implements RecurringPort {
  rows: RecurringTemplate[] = [];
  inserted: RecurringInsert[] = [];
  updated: { id: string; patch: RecurringUpdate }[] = [];
  async getRecurringTemplates(type?: string): Promise<RecurringTemplate[]> {
    return type ? this.rows.filter(row => row.type === type) : this.rows;
  }
  async insertRecurringTemplate(template: RecurringInsert): Promise<void> { this.inserted.push(template); }
  async updateRecurringTemplate(id: string, patch: RecurringUpdate): Promise<void> { this.updated.push({ id, patch }); }
  async deleteRecurringTemplate(id: string): Promise<void> { this.rows = this.rows.filter(row => row.id !== id); }
}

const draft = (overrides: Partial<RecurringDraft> = {}): RecurringDraft => ({
  merchant: 'Gym', amount: 40, currency: 'USD', category: 'health', interval: 'monthly', type: 'expense', ...overrides,
});

describe('next due computation', () => {
  it('advances daily, weekly, and monthly from the anchor day', () => {
    const anchor = new Date(2026, 0, 1, 15, 30).getTime();
    expect(new Date(computeNextDueDate('daily', [], anchor)).getDate()).toBe(2);
    expect(new Date(computeNextDueDate('weekly', [], anchor)).getDate()).toBe(8);
    expect(new Date(computeNextDueDate('monthly', [], anchor)).getMonth()).toBe(1);
  });

  it('picks the next matching weekday for a custom schedule and sanitizes days', () => {
    const anchor = new Date(2026, 0, 1).getTime(); // Thursday
    const next = computeNextDueDate('custom', [1], anchor); // Monday
    expect(new Date(next).getDay()).toBe(1);
    expect(parseRecurrenceDays('[1,9,"x",1,-2]')).toEqual([1]);
  });
});

describe('recurring ownership boundary', () => {
  let port: MemoryRecurringPort;
  beforeEach(() => { port = new MemoryRecurringPort(); });

  it('creates an expense template with a computed next-due date', async () => {
    const service = new RecurringDataService(port);
    const result = await service.create(draft(), 'template-1', new Date(2026, 0, 1).getTime());

    expect(result).toMatchObject({ status: 'saved', template: { id: 'template-1', interval: 'monthly', type: 'expense' } });
    expect(port.inserted[0]).toMatchObject({ id: 'template-1', category: 'health', type: 'expense' });
  });

  it('requires custom days and rejects invalid amounts', async () => {
    const service = new RecurringDataService(port);
    await expect(service.create(draft({ interval: 'custom', recurrenceDays: [] }), 't', 0)).resolves.toMatchObject({ status: 'invalid', field: 'custom_days' });
    await expect(service.create(draft({ amount: 0 }), 't', 0)).resolves.toMatchObject({ status: 'invalid', field: 'amount' });
  });

  it('supports income templates with custom weekdays', async () => {
    const service = new RecurringDataService(port);
    const result = await service.create(draft({ type: 'income', interval: 'custom', recurrenceDays: [5], merchant: 'Payroll' }), 'income-1', new Date(2026, 0, 1).getTime());

    expect(result).toMatchObject({ status: 'saved', template: { type: 'income', recurrenceDays: [5] } });
    expect(port.inserted[0].recurrence_days).toBe('[5]');
  });

  it('updates an existing template and reports a missing one', async () => {
    port.rows = [{ id: 't1', merchant: 'Old', amount: 1, currency: 'USD', category: 'other', interval: 'monthly', next_due_date: 0, type: 'expense', created_at: 0 }];
    const service = new RecurringDataService(port);

    await expect(service.update('t1', draft({ merchant: 'New' }), 1000)).resolves.toMatchObject({ status: 'saved', template: { merchant: 'New' } });
    expect(port.updated[0].id).toBe('t1');
    await expect(service.update('missing', draft(), 1000)).resolves.toEqual({ status: 'not_found', id: 'missing' });
  });

  it('deletes only an existing template', async () => {
    port.rows = [{ id: 't1', merchant: 'M', amount: 1, currency: 'USD', category: 'other', interval: 'daily', next_due_date: 0, type: 'expense', created_at: 0 }];
    const service = new RecurringDataService(port);
    await expect(service.delete('t1')).resolves.toEqual({ status: 'deleted', id: 't1' });
    await expect(service.delete('t1')).resolves.toEqual({ status: 'not_found', id: 't1' });
  });

  it('reports an empty list rather than an invented template', async () => {
    await expect(new RecurringDataService(port).list()).resolves.toEqual({ status: 'empty' });
  });
});

describe('shared recurring normalization', () => {
  it('normalizes both the S-15 path and the capture handoff identically', () => {
    const insert = buildRecurringInsert({
      id: 'x', merchant: '  Gym  ', amount: 40, currency: 'USD', category: ' ', note: undefined,
      interval: 'custom', recurrenceDays: [1, 3], type: 'expense', nextDueDate: 123, now: 456,
    });
    expect(insert).toMatchObject({ merchant: 'Gym', category: 'other', note: '', recurrence_days: '[1,3]', next_due_date: 123, created_at: 456 });
    const monthly = buildRecurringInsert({
      id: 'y', merchant: 'Gym', amount: 40, currency: 'USD', category: 'health',
      interval: 'monthly', recurrenceDays: [1], type: 'expense', nextDueDate: 1, now: 1,
    });
    expect(monthly.recurrence_days).toBeUndefined();
  });
});
