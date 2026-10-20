import type { Expense } from '../types/database';
import { resolveDisplayCurrency } from '../utils/currency';
import { normalizeCurrencyTotal } from './currencyNormalization';
import { buildThemePackState } from './ThemePackContracts';
import { PROFILE_NAME_MAX_LENGTH } from './ProfileContracts';
import type {
  AchievementState, BadgeProgressRow, ProfileDataSource, ProfileEditDraft,
  ProfileEditResult, ProfileSnapshot, ProfileStats,
} from './ProfileContracts';
import type { SettingsPort } from './SettingsContracts';

export function buildAchievementState(row: BadgeProgressRow): AchievementState {
  const target = Number.isFinite(row.target) && row.target > 0 ? row.target : 1;
  const current = Number.isFinite(row.current) ? Math.max(0, Math.min(row.current, target)) : 0;
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    icon: row.icon,
    earned: row.earned_at !== null,
    earnedAt: row.earned_at,
    progress: { current, target, ratio: current / target },
  };
}

// Join date prefers the onboarding-written setting, then falls back to the
// earliest real record so existing installs still show a truthful date instead
// of a synthesized one.
export function resolveJoinDate(rawJoinDate: string | null, expenses: Expense[]): number | null {
  const parsed = rawJoinDate ? Number(rawJoinDate) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const earliest = expenses.reduce<number | null>(
    (min, expense) => (min === null || expense.created_at < min ? expense.created_at : min),
    null,
  );
  return earliest;
}

export function buildProfileStats(expenses: Expense[], streak: number, displayCurrency: string, rates: string | null): ProfileStats {
  const total = normalizeCurrencyTotal(
    expenses.map(expense => ({ amount: expense.amount, currency: expense.currency })),
    displayCurrency,
    rates,
  ).total;
  return {
    totalExpenses: total,
    streak,
    scansCount: expenses.filter(expense => expense.scanned === 1).length,
    transactionCount: expenses.length,
    currency: displayCurrency,
  };
}

export function validateProfileName(name: string): ProfileEditResult | { status: 'valid'; name: string } {
  const trimmed = name.trim();
  if (!trimmed) return { status: 'invalid', field: 'name', reason: 'empty' };
  if (trimmed.length > PROFILE_NAME_MAX_LENGTH) return { status: 'invalid', field: 'name', reason: 'too_long' };
  return { status: 'valid', name: trimmed };
}

// Single save boundary for SH-05c. Both Profile and Settings route here so the
// two entry points cannot diverge. The avatar is stored as its owned filename,
// never as a raw picker URI or a key.
export async function saveProfileEdit(port: SettingsPort, draft: ProfileEditDraft): Promise<ProfileEditResult> {
  const validation = validateProfileName(draft.name);
  if (validation.status === 'invalid') return validation;
  await port.updateSetting('profile_name', validation.name);
  await port.updateSetting('profile_picture', draft.avatarFile ?? '');
  return { status: 'saved', name: validation.name, avatarFile: draft.avatarFile };
}

export class ProfileDataService {
  constructor(private readonly source: ProfileDataSource) {}

  async getSnapshot(now = Date.now()): Promise<ProfileSnapshot> {
    try {
      const allSettings = this.source.getAllSettings ? await this.source.getAllSettings() : null;
      const [expenses, streak, badges, unreadNotificationCount, nameFallback, avatarFallback, joinDateFallback, pricesVisibleFallback, currencyFallback, ratesFallback, themePackFallback, themeFallback] = await Promise.all([
        this.source.getExpenses(),
        allSettings ? Number(allSettings.last_streak ?? 0) : this.source.getStreak(),
        this.source.getBadgeProgress(allSettings ?? undefined),
        this.source.getUnreadNotificationCount(),
        allSettings ? null : this.source.getSetting('profile_name'),
        allSettings ? null : this.source.getSetting('profile_picture'),
        allSettings ? null : this.source.getSetting('profile_join_date'),
        allSettings ? null : this.source.getSetting('prices_visible'),
        allSettings ? null : this.source.getSetting('currency'),
        allSettings ? null : this.source.getSetting('conversion_rates'),
        allSettings ? null : this.source.getSetting('theme_pack'),
        allSettings ? null : this.source.getSetting('theme'),
      ]);

      const name = allSettings ? (allSettings.profile_name ?? null) : nameFallback;
      const avatar = allSettings ? (allSettings.profile_picture ?? null) : avatarFallback;
      const joinDateSetting = allSettings ? (allSettings.profile_join_date ?? null) : joinDateFallback;
      const pricesVisible = allSettings ? (allSettings.prices_visible ?? null) : pricesVisibleFallback;
      const currency = allSettings ? (allSettings.currency ?? null) : currencyFallback;
      const rates = allSettings ? (allSettings.conversion_rates ?? null) : ratesFallback;
      const themePack = allSettings ? (allSettings.theme_pack ?? null) : themePackFallback;
      const theme = allSettings ? (allSettings.theme ?? null) : themeFallback;
      const displayCurrency = resolveDisplayCurrency(currency);
      return {
        state: expenses.length === 0 && badges.every(badge => badge.earned_at === null) ? 'empty' : 'ready',
        displayName: name?.trim() ?? '',
        avatarFile: avatar && avatar.trim() ? avatar : null,
        joinDate: resolveJoinDate(joinDateSetting, expenses),
        stats: buildProfileStats(expenses, streak, displayCurrency, rates),
        achievements: badges.map(buildAchievementState),
        themePack: buildThemePackState(themePack, theme),
        pricesVisible: pricesVisible !== 'false',
        unreadNotificationCount,
        refreshedAt: now,
        refresh: { status: 'idle' },
      };
    } catch {
      return {
        state: 'failure',
        displayName: '',
        avatarFile: null,
        joinDate: null,
        stats: { totalExpenses: 0, streak: 0, scansCount: 0, transactionCount: 0, currency: resolveDisplayCurrency(null) },
        achievements: [],
        themePack: buildThemePackState(null, null),
        pricesVisible: true,
        unreadNotificationCount: 0,
        refreshedAt: now,
        refresh: { status: 'failed', errorCode: 'failure' },
      };
    }
  }
}
