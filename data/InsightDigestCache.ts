import type { InsightDigest, InsightsSnapshot, InsightTimeframe } from './InsightContracts';

// Phase 10 post-fixes, BUG 6 (FR-03.2) and F-07. The digest cache decision lives
// here rather than in the hook so it can be tested without React, and the provider
// boundary is injected so a test can prove which path reaches it.
//
// The contract the screen depends on: `read` is the only thing a mount, a section
// switch or a timeframe change calls, and it never runs the loader. `generate` is
// the only path to a provider call, and the hook calls it from the one user action.
export type InsightDigestLoader = (
  snapshot: InsightsSnapshot,
  timeframe: InsightTimeframe,
) => Promise<InsightDigest>;

// F-07. `contextToken` is opaque to this module. The caller passes the settings
// revision token, which moves on a provider switch, a model switch and a key
// rotation, so a digest produced under a previous provider context cannot be
// served after the change. No provider name, model id or key material enters this
// module or the cache key.
export interface InsightDigestCache {
  read(snapshot: InsightsSnapshot, timeframe: InsightTimeframe, contextToken: string): InsightDigest;
  generate(snapshot: InsightsSnapshot, timeframe: InsightTimeframe, contextToken: string): Promise<InsightDigest>;
  clear(): void;
  readonly size: number;
}

// The local narrative is real data derived from the period, so it is always the
// fallback text and never a placeholder.
function localText(snapshot: InsightsSnapshot): string {
  return snapshot.insight.narrativeText ?? '';
}

// The fingerprint named in the phase brief: timeframe, both period bounds, the
// transaction count and the period total. Any one of them moving means the digest
// was written about different figures, so it cannot be reused.
export function buildInsightDigestKey(snapshot: InsightsSnapshot, timeframe: InsightTimeframe): string {
  return `${timeframe}_${snapshot.period.start}_${snapshot.period.end}_${snapshot.transactionCount}_${snapshot.totalSpent}`;
}

// A snapshot that did not load has nothing real to summarise, so the card reports
// the typed failure instead of offering a stale or invented text.
function failedSnapshotDigest(snapshot: InsightsSnapshot): InsightDigest | null {
  if (snapshot.state !== 'offline' && snapshot.state !== 'failure') return null;
  return {
    status: 'unavailable',
    text: null,
    localText: localText(snapshot),
    generatedAt: null,
    errorCode: snapshot.refresh.errorCode === 'offline' ? 'offline' : 'provider',
    retryable: false,
  };
}

// The instant, free summary shown when no digest has been generated for this
// snapshot. `retryable` marks the on-demand AI control as available.
function localSummaryDigest(snapshot: InsightsSnapshot): InsightDigest {
  return {
    status: 'unavailable',
    text: null,
    localText: localText(snapshot),
    generatedAt: null,
    errorCode: undefined,
    retryable: true,
  };
}

export function createInsightDigestCache(load: InsightDigestLoader): InsightDigestCache {
  // Only an `available` digest is stored, so a hit is always text a provider
  // actually returned. An unavailable outcome is not cached, otherwise a retry
  // could never reach the provider again.
  const entries = new Map<string, InsightDigest>();
  // The context the stored entries were produced under. Checked on every call, so
  // it holds across a screen remount as well as across a change while mounted.
  let contextToken: string | null = null;

  const syncContext = (next: string): void => {
    if (contextToken === next) return;
    contextToken = next;
    entries.clear();
  };

  return {
    read(snapshot, timeframe, nextContextToken) {
      syncContext(nextContextToken);
      const failed = failedSnapshotDigest(snapshot);
      if (failed) return failed;
      return entries.get(buildInsightDigestKey(snapshot, timeframe)) ?? localSummaryDigest(snapshot);
    },
    async generate(snapshot, timeframe, nextContextToken) {
      syncContext(nextContextToken);
      const digest = await load(snapshot, timeframe);
      if (digest.status === 'available') entries.set(buildInsightDigestKey(snapshot, timeframe), digest);
      return digest;
    },
    clear() {
      entries.clear();
      contextToken = null;
    },
    get size() {
      return entries.size;
    },
  };
}
