import type { AiErrorCode, AiProvider, AiProviderClient } from '../ai/contracts';
import type { Expense, Income } from '../types/database';
import type {
  HomeCategorySnapshot, HomeComparativeInsight, HomeNormalization, HomePeriod,
} from './HomeContracts';

// S-03 Insights contracts (FR-03.1-03.5). The narrative is always computable
// locally from real period data; the AI text is an enhancement layered on top,
// never the only source. The timeframe drives both the snapshot and the digest.
export type InsightTimeframe = 'week' | 'month' | 'all' | 'custom';

export interface InsightTimeframeQuery {
  timeframe: InsightTimeframe;
  customStart?: number;
  customEnd?: number;
}

export interface InsightComparativeNarrative extends HomeComparativeInsight {
  // Non-null whenever the snapshot loaded (ready or empty) and always computed
  // from real data. Falls back to a factual statement when there is no earlier
  // period to compare against, so the block is never blank and never a
  // placeholder (FR-03.1). Null only on offline/failure, where there is no real
  // data to describe.
  narrativeText: string | null;
}

export interface InsightsSnapshot {
  state: 'ready' | 'empty' | 'offline' | 'failure';
  timeframe: InsightTimeframe;
  period: HomePeriod;
  previousPeriod: HomePeriod;
  totalSpent: number;
  totalIncome: number;
  netBalance: number;
  transactionCount: number;
  currency: string;
  categories: HomeCategorySnapshot[];
  insight: InsightComparativeNarrative;
  normalization: HomeNormalization;
  generatedAt: number;
  refresh: InsightsRefreshState;
}

export interface InsightsRefreshState {
  status: 'idle' | 'refreshing' | 'failed';
  errorCode?: 'offline' | 'failure';
}

// FR-03.2 digest. Available/generating/dismissed/unavailable are the only states
// the insights screen renders; the local text is always present so a provider
// failure still shows a real local summary instead of a blank card.
export type InsightDigestStatus = 'available' | 'generating' | 'dismissed' | 'unavailable';

export interface InsightDigest {
  status: InsightDigestStatus;
  text: string | null;
  localText: string;
  generatedAt: number | null;
  errorCode?: AiErrorCode;
  retryable: boolean;
}

export interface InsightDataSource {
  getExpenses(): Promise<Expense[]>;
  getIncomesForPeriod(start: number, end: number): Promise<Income[]>;
  getSetting(key: string): Promise<string | null>;
}

// Provider context for the digest boundary. Both providers flow through the same
// injected client, so Gemini and OpenRouter are first-class rather than one
// being the only wired path.
export interface InsightDigestContext {
  isConnected: boolean;
  provider: AiProvider;
  apiKey: string | null;
  model: string;
  client: AiProviderClient;
}
