import { describe, expect, it } from 'vitest';
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

describe('profile edit save boundary', () => {
  it('rejects an empty or over-long name', () => {
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
