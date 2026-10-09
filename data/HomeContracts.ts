import type { Expense, Income } from '../types/database';

export type HomeLoadState = 'ready' | 'empty' | 'offline' | 'failure';
export type HomeVisibility = 'visible' | 'hidden';
export type HomeAiState = 'not_requested' | 'ready' | 'offline' | 'failed';

export interface HomePeriod {
  start: number;
  end: number;
}

export interface HomeSnapshotHero {
  totalSpent: number;
  incomeTotal: number;
  transactionCount: number;
  currency: string;
  visibility: HomeVisibility;
}

export interface HomeComparativeInsight {
  currentTotal: number;
  previousTotal: number;
  changeAmount: number;
  changePercent: number | null;
  direction: 'up' | 'down' | 'unchanged' | 'no_previous_data';
  localText: string | null;
  aiText: string | null;
  aiState: HomeAiState;
}

export interface HomeCategorySnapshot {
  category: string;
  total: number;
  transactionCount: number;
  share: number;
}

export interface HomeStreak {
  days: number;
  hasActivity: boolean;
}

// Reports whether every period amount could be converted into the display
// currency by the shared normalization layer. When false, `missingRates` names
// the currencies that were excluded so the UI never shows a silently wrong total.
export interface HomeNormalization {
  complete: boolean;
  missingRates: string[];
}

export interface HomeSnapshot {
  state: HomeLoadState;
  refreshedAt: number;
  period: HomePeriod;
  hero: HomeSnapshotHero;
  comparativeInsight: HomeComparativeInsight;
  recentTransactions: Expense[];
  categories: HomeCategorySnapshot[];
  streak: HomeStreak;
  unreadNotificationCount: number;
  refresh: HomeRefreshState;
  normalization: HomeNormalization;
}

export interface HomeDataSource {
  getExpenses(): Promise<Expense[]>;
  getSetting(key: string): Promise<string | null>;
  getIncomeForPeriod(start: number, end: number): Promise<number>;
  getIncomesForPeriod(start: number, end: number): Promise<Income[]>;
  getStreak(): Promise<number>;
  getUnreadNotificationCount(): Promise<number>;
  getSecret?(key: 'gemini_api_key' | 'chat_openrouter_api_key'): Promise<string | null>;
}

export interface HomeRefreshState {
  status: 'idle' | 'refreshing' | 'failed';
  errorCode?: 'offline' | 'failure';
}
