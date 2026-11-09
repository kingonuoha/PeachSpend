// Phase 14 M5 stale review service. Thin UI boundary over the D1 draft
// store, so the stale queue sheet and the inbox section share one caller
// without touching SQL or adding a second writer. Every filing is a user
// tap: discard many, file many as uncategorized (category other), or assign
// many to one caller supplied category. Batch assign never writes
// per-merchant memory (DEC-14-03): this module imports no memory writer and
// calls only the three D1 batch methods, which D1 pins as memory free.
import type {
  DraftBatchReport,
  StaleDetectionDraft,
} from '../data/DetectionDrafts';

export interface StaleReviewStorePort {
  listStaleDrafts(now?: number): Promise<StaleDetectionDraft[]>;
  discardDetectionDrafts(ids: string[], now?: number): Promise<DraftBatchReport>;
  fileDetectionDraftsUncategorized(ids: string[], now?: number): Promise<DraftBatchReport>;
  assignDetectionDrafts(ids: string[], category: string, now?: number): Promise<DraftBatchReport>;
}

export async function loadStaleReview(
  store: StaleReviewStorePort,
  now = Date.now(),
): Promise<StaleDetectionDraft[]> {
  return store.listStaleDrafts(now);
}

export async function discardStaleReview(
  store: StaleReviewStorePort,
  ids: string[],
  now = Date.now(),
): Promise<DraftBatchReport> {
  return store.discardDetectionDrafts(ids, now);
}

export async function fileStaleReviewUncategorized(
  store: StaleReviewStorePort,
  ids: string[],
  now = Date.now(),
): Promise<DraftBatchReport> {
  return store.fileDetectionDraftsUncategorized(ids, now);
}

export async function assignStaleReview(
  store: StaleReviewStorePort,
  ids: string[],
  category: string,
  now = Date.now(),
): Promise<DraftBatchReport> {
  return store.assignDetectionDrafts(ids, category, now);
}

export interface StaleReviewSummary {
  total: number;
  succeeded: number;
  failed: number;
  notFound: number;
  alreadyResolved: number;
}

// Counts per item outcomes so the sheet can report a partial failure
// honestly instead of treating a mixed report as all done.
export function summarizeStaleReport(report: DraftBatchReport): StaleReviewSummary {
  let succeeded = 0;
  let failed = 0;
  let notFound = 0;
  let alreadyResolved = 0;
  for (const item of report.items) {
    if (item.status === 'discarded' || item.status === 'filed' || item.status === 'assigned') {
      succeeded += 1;
    } else if (item.status === 'not_found') {
      notFound += 1;
    } else if (item.status === 'already_resolved') {
      alreadyResolved += 1;
    } else {
      failed += 1;
    }
  }
  return { total: report.items.length, succeeded, failed, notFound, alreadyResolved };
}
