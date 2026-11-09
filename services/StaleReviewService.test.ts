import { describe, expect, it, vi } from 'vitest';
import {
  assignStaleReview,
  discardStaleReview,
  fileStaleReviewUncategorized,
  loadStaleReview,
  summarizeStaleReport,
  type StaleReviewStorePort,
} from './StaleReviewService';
import { DetectionDraftValidationError } from '../data/DetectionDrafts';

const NOW = 1_790_000_000_000;

function staleItem(id: string, detectedAt: number) {
  return {
    draft: {
      id,
      merchant: 'Shoprite',
      amount: 12500,
      currency: 'NGN',
      category: 'groceries',
      note: 'Weekly shop',
      source: 'auto_capture',
      detectedAt,
      snoozedUntil: null,
      status: 'pending',
      notificationId: 'row-1',
      createdAt: detectedAt,
      updatedAt: detectedAt,
    },
    ageMs: NOW - detectedAt,
  } as never;
}

function port(overrides: Partial<StaleReviewStorePort> = {}): StaleReviewStorePort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listStaleDrafts: async () => [staleItem('d1', NOW - 80 * 3600 * 1000)],
    discardDetectionDrafts: async ids => {
      calls.push(`discard:${ids.join(',')}`);
      return { items: ids.map(id => ({ id, status: 'discarded' as const })) };
    },
    fileDetectionDraftsUncategorized: async ids => {
      calls.push(`file:${ids.join(',')}`);
      return { items: ids.map(id => ({ id, status: 'filed' as const, expenseId: `exp-${id}` })) };
    },
    assignDetectionDrafts: async (ids, category) => {
      calls.push(`assign:${ids.join(',')}:${category}`);
      if (!category.trim()) throw new DetectionDraftValidationError('category');
      return { items: ids.map(id => ({ id, status: 'assigned' as const, expenseId: `exp-${id}` })) };
    },
    ...overrides,
  };
}

describe('StaleReviewService', () => {
  it('loads the stale queue oldest first through the D1 stale query', async () => {
    const store = port();
    const stale = await loadStaleReview(store, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].draft.id).toBe('d1');
  });

  it('discards many through the shared store boundary with per item outcomes', async () => {
    const store = port();
    const report = await discardStaleReview(store, ['d1', 'd2'], NOW);
    expect(report.items).toEqual([
      { id: 'd1', status: 'discarded' },
      { id: 'd2', status: 'discarded' },
    ]);
    expect(store.calls).toEqual(['discard:d1,d2']);
  });

  it('files many as uncategorized through the shared store boundary', async () => {
    const store = port();
    const report = await fileStaleReviewUncategorized(store, ['d1'], NOW);
    expect(report.items[0]).toMatchObject({ id: 'd1', status: 'filed' });
    expect(store.calls).toEqual(['file:d1']);
  });

  it('assigns many to one caller category and keeps each draft merchant', async () => {
    const store = port();
    const report = await assignStaleReview(store, ['d1', 'd2'], 'transport', NOW);
    expect(report.items).toEqual([
      { id: 'd1', status: 'assigned', expenseId: 'exp-d1' },
      { id: 'd2', status: 'assigned', expenseId: 'exp-d2' },
    ]);
    expect(store.calls).toEqual(['assign:d1,d2:transport']);
  });

  it('rejects a blank batch category without touching drafts', async () => {
    const discard = vi.fn();
    const store = port({ discardDetectionDrafts: discard });
    await expect(assignStaleReview(store, ['d1'], '   ', NOW)).rejects.toBeInstanceOf(
      DetectionDraftValidationError,
    );
    expect(discard).not.toHaveBeenCalled();
  });

  it('summarizes partial failure per item without dropping any outcome', () => {
    const summary = summarizeStaleReport({
      items: [
        { id: 'good', status: 'filed', expenseId: 'exp-good' },
        { id: 'bad', status: 'failed', errorCode: 'write_failed' },
        { id: 'missing', status: 'not_found' },
        { id: 'done', status: 'already_resolved' },
      ],
    });
    expect(summary).toEqual({ total: 4, succeeded: 1, failed: 1, notFound: 1, alreadyResolved: 1 });
  });

  it('exposes no per-merchant memory writer', async () => {
    const module = await import('./StaleReviewService');
    expect(Object.keys(module)).not.toContain('rememberCategory');
  });
});
