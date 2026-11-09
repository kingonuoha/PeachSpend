import { describe, expect, it, vi } from 'vitest';
import { advanceStreakForToday, decideStreakDay, localDay, previousLocalDay } from './StreakGate';

// StreakGate renders native UI and this suite only exercises the day rule, so the
// native and screen level modules are stubbed. Vitest hoists these above the
// import, and the day pass under test imports nothing from them.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  View: () => null,
}));
vi.mock('./SettingsProvider', () => ({
  useSettings: () => ({ isLoading: false, updateSetting: vi.fn() }),
}));
vi.mock('../../services/DatabaseService', () => ({
  databaseService: { getAllSettings: vi.fn() },
}));
vi.mock('../../services/DataServices', () => ({
  profileDataService: { getSnapshot: vi.fn() },
}));
vi.mock('./StreakSplash', () => ({ default: () => null, selectNextStreakBadge: () => null }));
vi.mock('./BadgeDetailModal', () => ({ BadgeDetailModal: () => null }));

const TODAY = '2026-03-15';

// In-memory settings table plus a write log, standing in for SQLite. The log is
// what makes a no-op day provable rather than assumed: BUG-09-01 wrote on every
// single launch.
function createStore(initial: Record<string, string> = {}) {
  const values: Record<string, string> = { ...initial };
  const writes: { key: string; value: string }[] = [];
  return {
    values,
    writes,
    readSettings: async () => ({ ...values }),
    writeSetting: async (key: string, value: string) => {
      writes.push({ key, value });
      values[key] = value;
    },
  };
}

async function runPass(store: ReturnType<typeof createStore>, today: string) {
  return advanceStreakForToday({
    today,
    readSettings: store.readSettings,
    writeSetting: store.writeSetting,
    loadBadge: async () => null,
  });
}

// Independent reference: pure UTC arithmetic on the date parts, offset by whole
// days. UTC has no time zone and no DST, so this disagrees with the
// implementation anywhere the implementation crosses a boundary wrongly.
function referenceDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + offset));
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDate = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${shiftedMonth}-${shiftedDate}`;
}

describe('streak day rule', () => {
  it('earns one advance on the first open of a local day and makes the second a no-op', async () => {
    const store = createStore({ last_opened_date: '2026-03-14', last_streak: '2', streak_start_date: '2026-03-13' });

    const first = await runPass(store, TODAY);
    expect(first).toEqual({ streak: 3, streakStartDate: '2026-03-13', badge: null });
    expect(store.writes).toEqual([
      { key: 'last_streak', value: '3' },
      { key: 'last_opened_date', value: TODAY },
    ]);

    // Second launch in the same local day: the reported defect.
    const second = await runPass(store, TODAY);
    expect(second).toBeNull();
    expect(store.writes).toHaveLength(2);
    expect(store.values).toEqual({ last_opened_date: TODAY, last_streak: '3', streak_start_date: '2026-03-13' });
  });

  it('decides nothing and writes nothing when the stored date is already today', async () => {
    const store = createStore({ last_opened_date: TODAY, last_streak: '4', streak_start_date: '2026-03-12' });
    expect(await runPass(store, TODAY)).toBeNull();
    expect(store.writes).toEqual([]);
    expect(store.values).toEqual({ last_opened_date: TODAY, last_streak: '4', streak_start_date: '2026-03-12' });
  });

  it('restarts at 1 and rewrites the streak start date after a missed day', async () => {
    const store = createStore({ last_opened_date: '2026-03-12', last_streak: '9', streak_start_date: '2026-02-01' });
    expect(await runPass(store, TODAY)).toEqual({ streak: 1, streakStartDate: TODAY, badge: null });
    expect(store.writes).toEqual([
      { key: 'streak_start_date', value: TODAY },
      { key: 'last_streak', value: '1' },
      { key: 'last_opened_date', value: TODAY },
    ]);
  });

  it('starts at 1 on a first ever open with no stored date and no stored streak', async () => {
    const store = createStore();
    expect(await runPass(store, TODAY)).toEqual({ streak: 1, streakStartDate: TODAY, badge: null });
    expect(store.values).toEqual({ streak_start_date: TODAY, last_streak: '1', last_opened_date: TODAY });
  });

  it('starts a new streak when the stored count is missing or unusable', () => {
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: '2026-03-14', currentStreak: 0 }))
      .toEqual({ kind: 'started', streak: 1, startDate: TODAY });
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: '2026-03-14', currentStreak: -2 }))
      .toEqual({ kind: 'started', streak: 1, startDate: TODAY });
  });

  it('starts a new streak when the stored date is empty, malformed, or not yesterday', () => {
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: '', currentStreak: 3 }))
      .toEqual({ kind: 'started', streak: 1, startDate: TODAY });
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: 'not-a-date', currentStreak: 3 }))
      .toEqual({ kind: 'started', streak: 1, startDate: TODAY });
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: null, currentStreak: 3 }))
      .toEqual({ kind: 'started', streak: 1, startDate: TODAY });
  });

  it('continues the count when the stored date is exactly yesterday', () => {
    expect(decideStreakDay({ today: TODAY, lastOpenedDate: '2026-03-14', currentStreak: 7 }))
      .toEqual({ kind: 'continued', streak: 8 });
  });

  it('evaluates the rolled over day once and repeats no splash when the app returns twice', async () => {
    const store = createStore({ last_opened_date: '2026-03-14', last_streak: '5', streak_start_date: '2026-03-10' });

    // Foreground return after local midnight.
    expect(await runPass(store, TODAY)).toEqual({ streak: 6, streakStartDate: '2026-03-10', badge: null });
    // A second return to active in the same day: no write, no splash.
    expect(await runPass(store, TODAY)).toBeNull();
    expect(store.writes).toHaveLength(2);
    expect(store.values.last_streak).toBe('6');
  });
});

describe('local day boundary', () => {
  it('reads the local calendar day, not the UTC day', () => {
    // Both instants are the same local calendar day. A UTC derived day gives one
    // of them another date on any machine that is not on UTC.
    expect(localDay(new Date(2026, 2, 15, 0, 30))).toBe('2026-03-15');
    expect(localDay(new Date(2026, 2, 15, 23, 30))).toBe('2026-03-15');
  });

  it('walks back exactly one calendar day across month, year, leap day and DST edges', () => {
    expect(previousLocalDay('2026-03-01')).toBe('2026-02-28');
    expect(previousLocalDay('2026-01-01')).toBe('2025-12-31');
    expect(previousLocalDay('2024-03-01')).toBe('2024-02-29');
    // EU DST start and end, then US DST start and end.
    expect(previousLocalDay('2026-03-29')).toBe('2026-03-28');
    expect(previousLocalDay('2026-10-25')).toBe('2026-10-24');
    expect(previousLocalDay('2026-03-08')).toBe('2026-03-07');
    expect(previousLocalDay('2026-11-01')).toBe('2026-10-31');
  });

  it('holds for every day of a year and a leap February', () => {
    for (let offset = 0; offset < 400; offset += 1) {
      const day = referenceDay('2026-01-01', offset);
      expect(previousLocalDay(day)).toBe(referenceDay(day, -1));
    }
  });

  it('advances the streak across a month boundary and across a year boundary', async () => {
    const monthStore = createStore({ last_opened_date: '2026-02-28', last_streak: '3', streak_start_date: '2026-02-26' });
    expect((await runPass(monthStore, '2026-03-01'))?.streak).toBe(4);

    const yearStore = createStore({ last_opened_date: '2026-12-31', last_streak: '30', streak_start_date: '2026-12-02' });
    expect((await runPass(yearStore, '2027-01-01'))?.streak).toBe(31);
  });
});
