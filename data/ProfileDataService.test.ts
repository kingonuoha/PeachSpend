import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import { ProfileDataService, buildAchievementState, buildProfileStats, resolveJoinDate, saveProfileEdit, validateProfileName } from './ProfileDataService';
import type { BadgeProgressRow, ProfileDataSource } from './ProfileContracts';
import type { SettingsPort } from './SettingsContracts';

const expense = (overrides: Partial<Expense>): Expense => ({
  id: 'e', merchant: 'M', amount: 10, currency: 'USD', category: 'dining', scanned: 0,
  date: 1_700_000_000_000, created_at: 1_700_000_000_000, ...overrides,
});

function source(values: Record<string, string>, expenses: Expense[], badges: BadgeProgressRow[] = []): ProfileDataSource {
  return {
    getExpenses: async () => expenses,
    getSetting: async key => values[key] ?? null,
    getStreak: async () => Number(values.last_streak ?? 0),
    getBadgeProgress: async () => badges,
    getUnreadNotificationCount: async () => Number(values.unread_count ?? 0),
  };
}

class MemorySettings implements SettingsPort {
  values = new Map<string, string>();
  async getSetting(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async updateSetting(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

describe('profile aggregate contracts', () => {
  it('normalizes mixed currencies through the shared rule and counts scans', () => {
    const stats = buildProfileStats(
      [expense({ currency: 'USD', amount: 10 }), expense({ currency: 'EUR', amount: 10, scanned: 1 })],
      4,
      'USD',
      JSON.stringify({ USD: 1, EUR: 2 }),
    );
    expect(stats.totalExpenses).toBe(30);
    expect(stats.scansCount).toBe(1);
    expect(stats.transactionCount).toBe(2);
    expect(stats.streak).toBe(4);
  });

  it('maps badge rows to earned state with clamped progress', () => {
    const state = buildAchievementState({ id: 'first', label: 'First', description: 'Desc', icon: 'Seed', earned_at: 10, current: 3, target: 2 });
    expect(state.earned).toBe(true);
    expect(state.earnedAt).toBe(10);
    expect(state.progress).toEqual({ current: 2, target: 2, ratio: 1 });
  });

  it('prefers the stored join date and falls back to the earliest record', () => {
    expect(resolveJoinDate('1700000000000', [])).toBe(1_700_000_000_000);
    expect(resolveJoinDate(null, [expense({ created_at: 500 }), expense({ created_at: 100 })])).toBe(100);
    expect(resolveJoinDate(null, [])).toBeNull();
  });
});

describe('ProfileDataService snapshot', () => {
  it('is empty only when there is no activity and no badge earned', async () => {
    const service = new ProfileDataService(source({}, [], []));
    await expect(service.getSnapshot(1000)).resolves.toMatchObject({ state: 'empty' });
  });

  it('builds a ready snapshot with independent theme pack and mode', async () => {
    const service = new ProfileDataService(source(
      { profile_name: 'Peach', profile_picture: 'pic.jpg', profile_join_date: '111', theme_pack: 'purple', theme: 'light', currency: 'USD', prices_visible: 'false', conversion_rates: JSON.stringify({ USD: 1 }), unread_count: '3' },
      [expense({ amount: 5 })],
      [{ id: 'first', label: 'First', description: 'D', icon: 'I', earned_at: null, current: 1, target: 3 }],
    ));
    const snapshot = await service.getSnapshot(1000);
    expect(snapshot.state).toBe('ready');
    expect(snapshot.displayName).toBe('Peach');
    expect(snapshot.avatarFile).toBe('pic.jpg');
    expect(snapshot.joinDate).toBe(111);
    expect(snapshot.themePack).toMatchObject({ activePackId: 'purple', mode: 'light' });
    expect(snapshot.pricesVisible).toBe(false);
    expect(snapshot.unreadNotificationCount).toBe(3);
    expect(snapshot.stats.totalExpenses).toBe(5);
  });

  it('reports a failure state instead of fabricated aggregates', async () => {
    const failing: ProfileDataSource = {
      getExpenses: async () => { throw new Error('db down'); },
      getSetting: async () => null,
      getStreak: async () => 0,
      getBadgeProgress: async () => [],
      getUnreadNotificationCount: async () => 0,
    };
    const snapshot = await new ProfileDataService(failing).getSnapshot(1000);
    expect(snapshot.state).toBe('failure');
    expect(snapshot.stats.transactionCount).toBe(0);
    expect(snapshot.refresh).toEqual({ status: 'failed', errorCode: 'failure' });
  });
});

// F-06. The row's point is that Profile pays for one settings read, not seven
// per-key reads plus a second table read inside the badge pass. Each field is given
// a value that differs from what the per-key fallback would return, so a revert to
// `getSetting` fails on the value and not only on a call count.
describe('ProfileDataService single settings read (F-06)', () => {
  const badges: BadgeProgressRow[] = [
    { id: 'first', label: 'First', description: 'D', icon: 'I', earned_at: 111, current: 1, target: 1 },
  ];

  it('reads every profile preference from one settings map and never per key', async () => {
    const settings: Record<string, string> = {
      profile_name: 'Peach',
      profile_picture: 'avatar.png',
      profile_join_date: String(1_700_000_000_000),
      prices_visible: 'false',
      currency: 'EUR',
      conversion_rates: JSON.stringify({ EUR: 1, USD: 2 }),
      theme_pack: 'purple',
      theme: 'dark',
      last_streak: '12',
    };
    const getAllSettings = vi.fn(async () => settings);
    const getSetting = vi.fn(async () => 'fallback');
    const getStreak = vi.fn(async () => 99);
    const getBadgeProgress = vi.fn(async () => badges);
    const service = new ProfileDataService({
      getExpenses: async () => [expense({ amount: 10, currency: 'USD' })],
      getSetting,
      getAllSettings,
      getStreak,
      getBadgeProgress,
      getUnreadNotificationCount: async () => 3,
    });

    const snapshot = await service.getSnapshot(1000);

    expect(getAllSettings).toHaveBeenCalledTimes(1);
    expect(getSetting).not.toHaveBeenCalled();
    expect(getStreak).not.toHaveBeenCalled();
    // The badge pass receives the same map, so it cannot read settings again.
    expect(getBadgeProgress).toHaveBeenCalledTimes(1);
    expect(getBadgeProgress).toHaveBeenCalledWith(settings);

    expect(snapshot.displayName).toBe('Peach');
    expect(snapshot.avatarFile).toBe('avatar.png');
    expect(snapshot.joinDate).toBe(1_700_000_000_000);
    expect(snapshot.pricesVisible).toBe(false);
    expect(snapshot.themePack).toMatchObject({ activePackId: 'purple', mode: 'dark' });
    expect(snapshot.stats.streak).toBe(12);
    expect(snapshot.stats.currency).toBe('EUR');
    // conversion_rates came from the same map: 10 USD at 2 per EUR is 20 EUR.
    expect(snapshot.stats.totalExpenses).toBe(20);
    expect(snapshot.unreadNotificationCount).toBe(3);
    expect(snapshot.state).toBe('ready');
  });

  it('keeps the per-key fallback for a source without getAllSettings', async () => {
    const stored: Record<string, string> = {
      profile_name: 'Plum',
      profile_picture: '',
      profile_join_date: '1600000000000',
      prices_visible: 'false',
      currency: 'GBP',
      conversion_rates: JSON.stringify({ GBP: 1 }),
      theme_pack: 'purple',
      theme: 'light',
    };
    const getSetting = vi.fn(async (key: string) => stored[key] ?? null);
    const getStreak = vi.fn(async () => 4);
    const getBadgeProgress = vi.fn(async () => badges);
    const service = new ProfileDataService({
      getExpenses: async () => [expense({ amount: 7, currency: 'GBP' })],
      getSetting,
      getStreak,
      getBadgeProgress,
      getUnreadNotificationCount: async () => 0,
    });

    const snapshot = await service.getSnapshot(1000);

    expect(getSetting).toHaveBeenCalledTimes(8);
    expect(getSetting.mock.calls.map(([key]) => key).sort()).toEqual([
      'conversion_rates', 'currency', 'prices_visible', 'profile_join_date',
      'profile_name', 'profile_picture', 'theme', 'theme_pack',
    ]);
    expect(getStreak).toHaveBeenCalledTimes(1);
    expect(getBadgeProgress).toHaveBeenCalledWith(undefined);

    expect(snapshot.displayName).toBe('Plum');
    expect(snapshot.avatarFile).toBeNull();
    expect(snapshot.joinDate).toBe(1_600_000_000_000);
    expect(snapshot.pricesVisible).toBe(false);
    expect(snapshot.themePack).toMatchObject({ activePackId: 'purple', mode: 'light' });
    expect(snapshot.stats.streak).toBe(4);
    expect(snapshot.stats.currency).toBe('GBP');
    expect(snapshot.stats.totalExpenses).toBe(7);
  });
});

describe('profile edit save boundary', () => {  it('rejects an empty or over-long name', () => {
    expect(validateProfileName('   ')).toEqual({ status: 'invalid', field: 'name', reason: 'empty' });
    expect(validateProfileName('x'.repeat(41))).toEqual({ status: 'invalid', field: 'name', reason: 'too_long' });
  });

  it('writes name and avatar to the single boundary', async () => {
    const port = new MemorySettings();
    await expect(saveProfileEdit(port, { name: '  Peach  ', avatarFile: 'avatar.jpg' })).resolves.toEqual({
      status: 'saved', name: 'Peach', avatarFile: 'avatar.jpg',
    });
    expect(port.values.get('profile_name')).toBe('Peach');
    expect(port.values.get('profile_picture')).toBe('avatar.jpg');
  });

  it('does not write when the name is invalid', async () => {
    const port = new MemorySettings();
    await saveProfileEdit(port, { name: '', avatarFile: 'avatar.jpg' });
    expect(port.values.size).toBe(0);
  });
});

describe('ProfileDataService optimization and deduplication', () => {
  it('uses getProfileExpenseSummary when available and avoids calling getExpenses', async () => {
    const getExpenses = vi.fn(async () => []);
    const getProfileExpenseSummary = vi.fn(async () => ({
      transactionCount: 3,
      scansCount: 1,
      totalSpent: 45,
      earliestExpenseDate: 1_650_000_000_000,
      hasForeignCurrencies: false,
    }));
    const service = new ProfileDataService({
      getExpenses,
      getProfileExpenseSummary,
      getSetting: async () => null,
      getStreak: async () => 2,
      getBadgeProgress: async () => [],
      getUnreadNotificationCount: async () => 0,
    });

    const snapshot = await service.getSnapshot(1000);

    expect(getProfileExpenseSummary).toHaveBeenCalledTimes(1);
    expect(getExpenses).not.toHaveBeenCalled();
    expect(snapshot.stats.transactionCount).toBe(3);
    expect(snapshot.stats.scansCount).toBe(1);
    expect(snapshot.stats.totalExpenses).toBe(45);
    expect(snapshot.joinDate).toBe(1_650_000_000_000);
  });

  it('deduplicates concurrent in-flight getSnapshot calls', async () => {
    let finishFirst: () => void = () => {};
    const getAllSettings = vi.fn(() => new Promise<Record<string, string>>(resolve => {
      finishFirst = () => resolve({ currency: 'USD' });
    }));
    const service = new ProfileDataService({
      getExpenses: async () => [],
      getAllSettings,
      getSetting: async () => null,
      getStreak: async () => 0,
      getBadgeProgress: async () => [],
      getUnreadNotificationCount: async () => 0,
    });

    const firstPromise = service.getSnapshot(1000);
    const secondPromise = service.getSnapshot(1000);

    finishFirst();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe(second);
    expect(getAllSettings).toHaveBeenCalledTimes(1);
  });

  it('serves repeat reads from cache and refreshes when forced', async () => {
    const getAllSettings = vi.fn(async () => ({ profile_name: 'Cached' }));
    const service = new ProfileDataService({
      getExpenses: async () => [],
      getAllSettings,
      getSetting: async () => null,
      getStreak: async () => 0,
      getBadgeProgress: async () => [],
      getUnreadNotificationCount: async () => 0,
    });

    const first = await service.getSnapshot(1000);
    expect(service.getCachedSnapshot()).toBe(first);

    const second = await service.getSnapshot(1000);
    expect(second).toBe(first);
    expect(getAllSettings).toHaveBeenCalledTimes(1);

    const third = await service.getSnapshot(1000, true);
    expect(getAllSettings).toHaveBeenCalledTimes(2);
  });
});
