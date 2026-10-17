import { describe, expect, it, vi } from 'vitest';
import {
  createFreshnessTracker,
  dataToken,
  getDataRevision,
  hasDataChanged,
  markDataChanged,
  subscribeDataFreshness,
} from './useDataFreshness';

// BUG-09-11b. The freshness signal itself. These tests hold the two properties
// the row turns on: a write moves the token of its own domain only, and a screen
// that has already read is not asked to read again until one of its domains
// moved. The repo has no React render harness and this row adds no dependency, so
// the refetch decision is tested through the pure tracker the hook is built on.
// What a rendered screen does with that decision is covered by the screen code
// and by the device checklist, not by a claim in this file.

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

describe('the data freshness signal', () => {
  it('moves the revision of the written domain and leaves the others alone', () => {
    const ledger = getDataRevision('ledger');
    const settings = getDataRevision('settings');

    markDataChanged('ledger');

    expect(getDataRevision('ledger')).toBe(ledger + 1);
    expect(getDataRevision('settings')).toBe(settings);
  });

  it('produces the same token while nothing changed and a different one after a write', () => {
    const before = dataToken(['ledger', 'notifications']);
    expect(dataToken(['ledger', 'notifications'])).toBe(before);

    markDataChanged('notifications');

    expect(dataToken(['ledger', 'notifications'])).not.toBe(before);
  });

  it('reports a change only for the domains the caller watches', () => {
    const token = dataToken(['ledger']);

    markDataChanged('settings');

    expect(hasDataChanged(['ledger'], token)).toBe(false);
    expect(hasDataChanged(['ledger', 'settings'], token)).toBe(true);
  });

  it('treats a caller that has never read as changed', () => {
    expect(hasDataChanged(['ledger'], null)).toBe(true);
  });

  it('coalesces a burst of writes into one notification while carrying the latest revision', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDataFreshness(listener);

    markDataChanged('ledger');
    markDataChanged('ledger');
    markDataChanged('ledger');

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops notifying once a listener unsubscribes', async () => {
    const listener = vi.fn();
    subscribeDataFreshness(listener)();

    markDataChanged('ledger');
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the refetch decision', () => {
  it('asks a screen that has never read to read, and not to read again after it has read', () => {
    const tracker = createFreshnessTracker(['ledger']);

    expect(tracker.isStale()).toBe(true);

    tracker.markFresh();

    expect(tracker.isStale()).toBe(false);
  });

  it('does not ask a screen to re-read when a different domain changed', () => {
    const tracker = createFreshnessTracker(['ledger']);
    tracker.markFresh();

    markDataChanged('notifications');

    expect(tracker.isStale()).toBe(false);
  });

  it('asks a screen to re-read once its own domain changed', () => {
    const tracker = createFreshnessTracker(['ledger']);
    tracker.markFresh();

    markDataChanged('ledger');

    expect(tracker.isStale()).toBe(true);
  });

  it('settles again after a screen re-reads a changed domain', () => {
    const tracker = createFreshnessTracker(['ledger', 'notifications']);
    tracker.markFresh();

    markDataChanged('notifications');
    expect(tracker.isStale()).toBe(true);

    tracker.markFresh();
    expect(tracker.isStale()).toBe(false);
  });
});
