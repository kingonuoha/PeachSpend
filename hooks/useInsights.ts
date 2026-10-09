import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { geminiClient, openRouterClient } from '../ai/providerClients';
import type { AiProvider } from '../ai/contracts';
import { databaseService } from '../services/DatabaseService';
import {
  InsightDataService,
  dismissInsightDigest,
  generateInsightDigest,
  generatingInsightDigest,
} from '../data/InsightDataService';
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
  const [query, setQuery] = useState<InsightTimeframeQuery>({ timeframe: 'week' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [digestNonce, setDigestNonce] = useState(0);
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
      const [nextSnapshot, list, categories] = await Promise.all([
        insightDataService.getSnapshot(nextQuery),
        databaseService.getExpenses(),
        databaseService.getCategories(),
      ]);
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

  useEffect(() => {
    void load(query, 'initial');
  }, [query, load]);

  // Digest generation. The local narrative is always kept so an offline or
  // provider-failed digest still renders a real local summary, never a blank card.
  useEffect(() => {
    if (!snapshot) return;
    const localText = snapshot.insight.narrativeText ?? '';
    if (snapshot.state === 'offline' || snapshot.state === 'failure') {
      setDigest({
        status: 'unavailable',
        text: null,
        localText,
        generatedAt: null,
        errorCode: snapshot.refresh.errorCode === 'offline' ? 'offline' : 'provider',
        retryable: false,
      });
      return;
    }
    if (isOffline) {
      setDigest({ status: 'unavailable', text: null, localText, generatedAt: null, errorCode: 'offline', retryable: true });
      return;
    }
    let cancelled = false;
    setDigest(generatingInsightDigest(localText));
    void (async () => {
      const context = await buildDigestContext();
      const next = await generateInsightDigest(snapshot, context);
      if (!cancelled) setDigest(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot, isOffline, digestNonce]);

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

  const retryDigest = useCallback(() => {
    setDigestNonce(value => value + 1);
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
    retryDigest,
  };
}
