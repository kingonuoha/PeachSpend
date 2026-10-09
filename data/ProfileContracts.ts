import type { Expense } from '../types/database';
import type { SettingsPort } from './SettingsContracts';
import type { ThemePackState } from './ThemePackContracts';

export type ProfileLoadState = 'ready' | 'empty' | 'failure';

export interface AchievementState {
  id: string;
  label: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: number | null;
  progress: { current: number; target: number; ratio: number };
}

export interface ProfileStats {
  totalExpenses: number;
  streak: number;
  scansCount: number;
  transactionCount: number;
  currency: string;
}

export interface ProfileSnapshot {
  state: ProfileLoadState;
  displayName: string;
  avatarFile: string | null;
  joinDate: number | null;
  stats: ProfileStats;
  achievements: AchievementState[];
  themePack: ThemePackState;
  pricesVisible: boolean;
  unreadNotificationCount: number;
  refreshedAt: number;
  refresh: { status: 'idle' | 'failed'; errorCode?: 'failure' };
}

// Raw badge row shape already returned by DatabaseService.getBadgeProgress. The
// contract maps it rather than re-deriving badge metadata in a second catalogue.
export interface BadgeProgressRow {
  id: string;
  label: string;
  description: string;
  icon: string;
  earned_at: number | null;
  current: number;
  target: number;
}

export interface ProfileDataSource {
  getExpenses(): Promise<Expense[]>;
  getSetting(key: string): Promise<string | null>;
  getStreak(): Promise<number>;
  getBadgeProgress(): Promise<BadgeProgressRow[]>;
  getUnreadNotificationCount(): Promise<number>;
}

// SH-05c save boundary (FR-05.4, FR-06.3). Only the canonical edit flow calls
// this, and it writes the same two settings from either entry point.
export interface ProfileEditDraft {
  name: string;
  avatarFile: string | null;
}

export type ProfileEditResult =
  | { status: 'saved'; name: string; avatarFile: string | null }
  | { status: 'invalid'; field: 'name'; reason: 'empty' | 'too_long' };

export const PROFILE_NAME_MAX_LENGTH = 40;
