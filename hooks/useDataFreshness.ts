import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// BUG-09-11b. A change token for the local database, so a screen re-reads when
// local data actually changed instead of on every mount, focus or navigation.
//
// This is not a read cache. It stores one integer per domain and never stores a
// row, a snapshot or a query result, so it cannot show stale money: it only
// answers the question "has anything been written since I last read?".
//
// A domain is the coarsest grouping a screen reads together, so a write wakes
// only the screens that can display it.
//   ledger         expenses, income, categories, recurring templates, achievements
//   settings       the settings table, which Home reads for currency and visibility
//   notifications  the notifications table, which Home reads for its unread badge
//
// The invalidation path is one publisher per write, all of them in
// services/DatabaseService.ts, which is the single writer per table:
//   manual save, scan confirm, share intake, auto capture, chat action and the
//   import commit all write expenses and income through the capture repository,
//   so those publish from the repository decorator there;
//   the continuity v1 restore, the ledger edits and deletes, the category,
//   recurring and income writers, the settings writers and the notification
//   writers publish from their own method.
// A writer that forgets to publish leaves its screen stale, which is why the
// publishers live at the writer rather than at each call site.
export type DataDomain = 'ledger' | 'settings' | 'notifications';

const revisions: Record<DataDomain, number> = { ledger: 0, settings: 0, notifications: 0 };

const listeners = new Set<() => void>();
let notificationScheduled = false;

// Coalesces a burst of writes into one notification. A bulk import writes one row
// at a time, and without this the mounted screens would be asked to re-read once
// per row. The token is read live at the moment a listener runs, so a coalesced
// notification always carries the latest revision.
function scheduleNotification(): void {
  if (notificationScheduled) return;
  notificationScheduled = true;
  queueMicrotask(() => {
    notificationScheduled = false;
    for (const listener of listeners) listener();
  });
}

export function getDataRevision(domain: DataDomain): number {
  return revisions[domain];
}

// Called after a write that changed local data. Every publisher passes the domain
// its write belongs to; see the path table above.
export function markDataChanged(domain: DataDomain): void {
  revisions[domain] += 1;
  scheduleNotification();
}

export function subscribeDataFreshness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A comparable token for a set of domains. Two reads of the same unchanged data
// produce the same string, so a caller compares tokens instead of comparing
// snapshots, and a token survives a screen remount while a snapshot cannot.
export function dataToken(domains: readonly DataDomain[]): string {
  return domains.map(domain => `${domain}:${revisions[domain]}`).join('|');
}

// True when the caller must re-read: either it has never read, or the revision it
// read at is no longer current. A screen that reads and then records its token is
// not asked to re-read again until a write moves one of its domains.
export function hasDataChanged(domains: readonly DataDomain[], lastReadToken: string | null): boolean {
  return lastReadToken === null || lastReadToken !== dataToken(domains);
}

export interface FreshnessTracker {
  isStale: () => boolean;
  markFresh: () => void;
}

// The read-tracking half of the signal, with no React in it so the refetch
// decision is testable on its own. `isStale` answers "would a read now return
// something other than what I last read", and `markFresh` records a read.
export function createFreshnessTracker(domains: readonly DataDomain[]): FreshnessTracker {
  let lastReadToken: string | null = null;
  return {
    isStale: () => hasDataChanged(domains, lastReadToken),
    markFresh: () => {
      lastReadToken = dataToken(domains);
    },
  };
}

const EMPTY_DOMAINS: readonly DataDomain[] = [];

export function useDataToken(domains: readonly DataDomain[]): string {
  return useSyncExternalStore(
    subscribeDataFreshness,
    () => dataToken(domains),
    () => dataToken(EMPTY_DOMAINS),
  );
}

// Re-reads on first mount, and then only when one of `domains` changed. It does
// not re-read on focus, on a tab switch bookkeeping event, or on a re-render.
//
// A change that lands while a read is still in flight is coalesced into a single
// follow-up read, so a bulk import that writes row by row cannot turn into one
// read per row.
export function useTokenReload(domains: readonly DataDomain[], reload: () => void | Promise<void>): void {
  const token = useDataToken(domains);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    void (async () => {
      try {
        await reloadRef.current();
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          setNonce(value => value + 1);
        }
      }
    })();
  }, [token, nonce]);
}

// The focus-driven half. A screen that reloads on focus reads `isStale()` first
// and returns early when nothing changed, then calls `markFresh()` after a
// successful read. `token` is exposed for screens that drive their read from an
// effect instead.
export function useDataFreshness(domains: readonly DataDomain[]): FreshnessTracker & { token: string } {
  const token = useDataToken(domains);
  const trackerRef = useRef<FreshnessTracker | null>(null);
  if (trackerRef.current === null) trackerRef.current = createFreshnessTracker(domains);
  const tracker = trackerRef.current;
  return {
    token,
    isStale: tracker.isStale,
    markFresh: tracker.markFresh,
  };
}
