import type { Expense, Income } from '../types/database';
import type { HomeCategorySnapshot, HomeNormalization, HomePeriod } from './HomeContracts';

// S-23 Spending Recap contracts (FR-23.1-23.5). The contract carries numbers and
// honest states only; the screen owns all copy, which keeps the hard
// positive-framing rule (FR-23.2) out of the data layer and impossible to violate
// by adding a "failure"/"overspent" label here. There is deliberately no
// high-spend or guilt field on the snapshot.
export type SpendingRecapCadence = 'weekly' | 'monthly';

export type SpendingRecapDirection = 'up' | 'down' | 'unchanged' | 'no_previous_data';

export interface SpendingRecapHighlight {
  direction: SpendingRecapDirection;
  currentTotal: number;
  previousTotal: number;
  changeAmount: number;
  changePercent: number | null;
  // Neutral, descriptive text. Never a warning or blame statement, so the screen
  // has a real comparative sentence even before any copy enhancement.
  text: string;
}

// Peak-end close (FR-23.4): the contract names which real value the screen should
// affirm with, and the number. The screen writes the sentence.
export type SpendingRecapAffirmation =
  | { kind: 'streak_days'; value: number }
  | { kind: 'income_logged'; value: number; currency: string }
  | { kind: 'transactions_tracked'; value: number };

// D7 supporting micro chart series. One point per real bucket of the recap
// period: seven day buckets for a weekly recap, bounded week-of-month buckets
// for a monthly recap. `isPeak` marks the single highest bucket so the screen can
// highlight it. The array is empty when the period has no spending or fewer than
// two populated buckets, so the chart hides instead of rendering zero-filled
// bars that would imply activity that did not happen.
export interface SpendingRecapSeriesPoint {
  label: string;
  value: number;
  isPeak: boolean;
}

export interface SpendingRecapSnapshot {
  cadence: SpendingRecapCadence;
  period: HomePeriod;
  totalSpent: number;
  totalEarned: number;
  transactionCount: number;
  biggestCategory: HomeCategorySnapshot | null;
  comparativeHighlight: SpendingRecapHighlight;
  affirmation: SpendingRecapAffirmation;
  series: SpendingRecapSeriesPoint[];
  currency: string;
  generatedAt: number;
  normalization: HomeNormalization;
}

export type SpendingRecapLoadState = 'ready' | 'empty' | 'offline' | 'failure';

export interface SpendingRecapRead {
  state: SpendingRecapLoadState;
  snapshot: SpendingRecapSnapshot | null;
  errorCode?: 'offline' | 'failure';
}

export interface SpendingRecapDataSource {
  getExpenses(): Promise<Expense[]>;
  getIncomesForPeriod(start: number, end: number): Promise<Income[]>;
  getSetting(key: string): Promise<string | null>;
  getStreak(): Promise<number>;
}
