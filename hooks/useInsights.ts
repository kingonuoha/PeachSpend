import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { geminiClient, openRouterClient } from '../ai/providerClients';
import type { AiProvider } from '../ai/contracts';
import { databaseService } from '../services/DatabaseService';
import { useDataToken } from './useDataFreshness';
import {
  InsightDataService,
  dismissInsightDigest,
  generateInsightDigest,
  generatingInsightDigest,
} from '../data/InsightDataService';
import { createInsightDigestCache } from '../data/InsightDigestCache';
import type {
  InsightDigest,
  InsightDigestContext,
  InsightsSnapshot,
  InsightTimeframe,
  InsightTimeframeQuery,
} from '../data/InsightContracts';
import type { Expense } from '../types/database';

export interface InsightCategoryMeta {
  title: string;
  color: string;
  iconName: string;
}

export type InsightSortKey = 'newest' | 'oldest' | 'az' | 'za' | 'cheapest' | 'expensive';

export interface InsightSortOption {
  key: InsightSortKey;
  // Full label for the six-option sort sheet (canonical copy).
  label: string;
  // Compact label for the sort trigger pill.
  triggerLabel: string;
}

export const INSIGHT_SORT_OPTIONS: InsightSortOption[] = [
  { key: 'newest', label: 'Newest First (Default)', triggerLabel: 'Newest' },
  { key: 'oldest', label: 'Oldest First', triggerLabel: 'Oldest' },
  { key: 'az', label: 'Merchant: A → Z', triggerLabel: 'A → Z' },
  { key: 'za', label: 'Merchant: Z → A', triggerLabel: 'Z → A' },
  { key: 'cheapest', label: 'Amount: Low to High (Cheapest)', triggerLabel: 'Cheapest' },
  { key: 'expensive', label: 'Amount: High to Low (Most Expensive)', triggerLabel: 'Most Expensive' },
];

// Module singleton mirrors the Home data repository: the screen consumes the
// Data and AI service, never SQL.
const insightDataService = new InsightDataService(databaseService);

// In-memory cache for generated AI digests, keyed by the snapshot fingerprint. The
// loader is the only path to a provider call, so reading the cache cannot spend a
// token. See data/InsightDigestCache.ts for the decision and its tests.
const digestCache = createInsightDigestCache(async snapshot => {
  const context = await buildDigestContext();
  return generateInsightDigest(snapshot, context);
});

// BUG-09-11b. Insights reads the ledger (expenses, their categories and the
// period aggregates), so only a ledger write invalidates its snapshot.
const INSIGHT_FRESHNESS_DOMAINS = ['ledger'] as const;

// F-07. A digest is served only while the provider context that produced it still
// holds. A provider switch, a model switch and a key rotation are all settings
// writes that publish the settings token (DatabaseService.updateSetting), so the
// existing change signal is enough to drop the cache, with no second signal
// invented for it. The token is a revision integer per domain, so no provider
// value and no key material ever enters the cache or its key.
const DIGEST_CONTEXT_DOMAINS = ['settings'] as const;

// Provider context for the FR-03.2 digest. Gemini and OpenRouter run the same
// injected boundary so both are first-class; the key is read only to pass into
// the provider client and is never returned or logged.
async function buildDigestContext(): Promise<InsightDigestContext> {
  const provider: AiProvider = (await databaseService.getSetting('chat_provider')) === 'openrouter'
    ? 'openrouter'
    : 'gemini';
  const apiKey = provider === 'openrouter'
    ? await databaseService.getSecret('chat_openrouter_api_key')
    : await databaseService.getSecret('gemini_api_key');
  const model = provider === 'openrouter'
    ? (await databaseService.getSetting('chat_openrouter_model')) || 'openrouter/auto'
    : 'gemini-2.5-flash';
  const client = provider === 'openrouter' ? openRouterClient : geminiClient;
  return { isConnected: true, provider, apiKey, model, client };
}

export function useInsights() {
  const [snapshot, setSnapshot] = useState<InsightsSnapshot | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categoryMeta, setCategoryMeta] = useState<Record<string, InsightCategoryMeta>>({});
  const [digest, setDigest] = useState<InsightDigest | null>(null);
  // Month is the default basis: a single week is easily distorted by one rent or
  // bulk grocery day, and most budgets run on a monthly cycle, so the first view
  // is not skewed by an unrepresentative window.
  const [query, setQuery] = useState<InsightTimeframeQuery>({ timeframe: 'month' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    const updateConnectivity = (state: NetInfoState) => {
      if (!active) return;
      setIsOffline(state.isConnected !== true || state.isInternetReachable !== true);
    };
    const unsubscribe = NetInfo.addEventListener(updateConnectivity);
    NetInfo.fetch().then(updateConnectivity).catch(() => {
      if (active) setIsOffline(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async (nextQuery: InsightTimeframeQuery, mode: 'initial' | 'refresh') => {
    const id = ++requestId.current;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    try {
      const [list, categories] = await Promise.all([
        databaseService.getExpenses(),
        databaseService.getCategories(),
      ]);
      const nextSnapshot = await insightDataService.getSnapshot(nextQuery, undefined, list);
      if (id !== requestId.current) return;
      const meta: Record<string, InsightCategoryMeta> = {};
      for (const category of categories) {
        meta[category.id] = { title: category.title, color: category.color, iconName: category.icon_name };
      }
      setSnapshot(nextSnapshot);
      setExpenses(list);
      setCategoryMeta(meta);
      setError(false);
    } catch {
      if (id !== requestId.current) return;
      // getSnapshot resolves its own failure snapshot; a throw here is a hard
      // source error, so surface a retry rather than inventing data.
      setError(true);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // BUG-09-11b. The snapshot re-reads on a timeframe change and when the ledger
  // itself changed. It is not re-run by a focus event, a tab switch or a plain
  // re-render, which the mount effect could not tell apart from a real change.
  // The change token is read from one place, so this screen is not reloading
  // because it was remounted.
  const ledgerToken = useDataToken(INSIGHT_FRESHNESS_DOMAINS);
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    const mode = hasLoadedRef.current ? 'refresh' : 'initial';
    hasLoadedRef.current = true;
    void load(query, mode);
  }, [query, ledgerToken, load]);

  // F-07. The token is passed on every read and write, so a provider change made
  // while this screen was unmounted still drops the old digests the first time it
  // comes back, not only when the change lands while it is mounted.
  const digestContextToken = useDataToken(DIGEST_CONTEXT_DOMAINS);

  // Digest resolution: a stored digest for this exact snapshot and provider
  // context, otherwise the instant, free local summary. Nothing on this path
  // reaches a provider.
  useEffect(() => {
    if (!snapshot) return;
    setDigest(digestCache.read(snapshot, query.timeframe, digestContextToken));
  }, [snapshot, query.timeframe, digestContextToken]);

  // Explicit user trigger for generating or retrying AI breakdown
  const requestAiDigest = useCallback(async () => {
    if (!snapshot) return;
    const localText = snapshot.insight.narrativeText ?? '';
    if (isOffline) {
      setDigest({ status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'offline', retryable: true });
      return;
    }

    setDigest(generatingInsightDigest(localText));
    try {
      setDigest(await digestCache.generate(snapshot, query.timeframe, digestContextToken));
    } catch {
      setDigest({ status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'provider', retryable: true });
    }
  }, [snapshot, isOffline, query.timeframe, digestContextToken]);

  const setTimeframe = useCallback((timeframe: InsightTimeframe, customStart?: number, customEnd?: number) => {
    setQuery(
      timeframe === 'custom' && customStart !== undefined && customEnd !== undefined
        ? { timeframe, customStart, customEnd }
        : { timeframe },
    );
  }, []);

  const retry = useCallback(() => {
    void load(query, 'refresh');
  }, [load, query]);

  const dismissDigest = useCallback(() => {
    setDigest(prev => (prev ? dismissInsightDigest(prev) : prev));
  }, []);

  return {
    snapshot,
    expenses,
    categoryMeta,
    digest,
    query,
    loading,
    refreshing,
    error,
    isOffline,
    setTimeframe,
    retry,
    dismissDigest,
    retryDigest: requestAiDigest,
    requestAiDigest,
  };
}
