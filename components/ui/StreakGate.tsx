import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { format } from 'date-fns';
import { useSettings } from './SettingsProvider';
import { databaseService } from '../../services/DatabaseService';
import { profileDataService } from '../../services/DataServices';
import { logger } from '../../utils/logger';
import StreakSplash, { selectNextStreakBadge } from './StreakSplash';
import { BadgeDetailModal } from './BadgeDetailModal';
import type { AchievementState } from '../../data/ProfileContracts';

interface StreakSplashState {
  streak: number;
  streakStartDate: string | null;
  badge: AchievementState | null;
}

// The streak day is the local calendar day. Deriving it from a UTC timestamp
// rolled the app's day over at 01:00 on a UTC+1 device (BUG-09-01).
const LOCAL_DAY_FORMAT = 'yyyy-MM-dd';

export type StreakDayOutcome =
  // The first open of this local day already earned the advance.
  | { kind: 'earned' }
  // Yesterday was opened, so the count continues.
  | { kind: 'continued'; streak: number }
  // A missed day, or a first ever open: the count restarts and the start date is
  // rewritten to the day the new streak began, per DEC-B02.
  | { kind: 'started'; streak: number; startDate: string };

export interface StreakDayInput {
  today: string;
  lastOpenedDate: string | null | undefined;
  currentStreak: number;
}

export function localDay(date: Date = new Date()): string {
  return format(date, LOCAL_DAY_FORMAT);
}

// Calendar arithmetic on the local Date, never 24 hours subtracted from a
// timestamp, so a month end, a year end, a leap day and a DST shift cannot land
// on the wrong day.
export function previousLocalDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const previous = new Date(year, month - 1, date);
  previous.setDate(previous.getDate() - 1);
  return format(previous, LOCAL_DAY_FORMAT);
}

// DEC-B01: the day is earned by the first open of the local calendar day, with no
// logging requirement, so nothing else gates this rule. A stored count below 1
// means no streak is in flight, so yesterday's open starts one rather than
// continuing a streak that does not exist.
export function decideStreakDay({ today, lastOpenedDate, currentStreak }: StreakDayInput): StreakDayOutcome {
  if (lastOpenedDate === today) return { kind: 'earned' };
  const continues = lastOpenedDate === previousLocalDay(today) && currentStreak > 0;
  if (!continues) return { kind: 'started', streak: 1, startDate: today };
  return { kind: 'continued', streak: currentStreak + 1 };
}

export interface StreakDayDeps {
  today: string;
  readSettings: () => Promise<Record<string, string>>;
  writeSetting: (key: string, value: string) => Promise<void>;
  writeSettings?: (entries: Record<string, string>) => Promise<void>;
  loadBadge: () => Promise<AchievementState | null>;
}

// One day pass: read the real stored values, apply the day rule, write the result
// back, then return the splash to show. Returns null when the local day was
// already earned, so a reveal happens only on a real advance. A read or write
// failure throws, and the caller decides what to log.
export async function advanceStreakForToday(deps: StreakDayDeps): Promise<StreakSplashState | null> {
  // The decision inputs come from the data layer. The settings context is empty
  // until loadSettings resolves, which is what made the old guard miss every cold
  // start (BUG-09-01), so it is never read for these values.
  const stored = await deps.readSettings();
  const decision = decideStreakDay({
    today: deps.today,
    lastOpenedDate: stored.last_opened_date,
    currentStreak: parseInt(stored.last_streak || '0', 10) || 0,
  });

  if (decision.kind === 'earned') return null;

  if (deps.writeSettings) {
    const batch: Record<string, string> = {
      last_streak: String(decision.streak),
      last_opened_date: deps.today,
    };
    if (decision.kind === 'started') {
      batch.streak_start_date = decision.startDate;
    }
    await deps.writeSettings(batch);
  } else {
    if (decision.kind === 'started') await deps.writeSetting('streak_start_date', decision.startDate);
    await deps.writeSetting('last_streak', String(decision.streak));
    await deps.writeSetting('last_opened_date', deps.today);
  }

  const streakStartDate = decision.kind === 'started' ? decision.startDate : (stored.streak_start_date ?? null);
  return { streak: decision.streak, streakStartDate, badge: await deps.loadBadge() };
}

async function loadNextBadge(): Promise<AchievementState | null> {
  try {
    const snapshot = await profileDataService.getSnapshot();
    return selectNextStreakBadge(snapshot.achievements);
  } catch {
    // A badge lookup failure must not cost the streak advance or its splash.
    return null;
  }
}

export default function StreakGate({ children }: { children: React.ReactNode }) {
  const { isLoading, updateSetting, updateSettings } = useSettings();
  const [splash, setSplash] = useState<StreakSplashState | null>(null);
  const [selectedBadge, setSelectedBadge] = useState<AchievementState | null>(null);
  // One day pass at a time, so a foreground return that arrives while a pass is
  // still writing cannot run the rule a second time.
  const running = useRef(false);
  // The provider mints a new writer on every settings render. Holding the latest
  // one in a ref keeps this pass stable and still routes every write through the
  // provider, so in-memory settings no longer go stale (BUG-09-01, secondary).
  const writeSetting = useRef(updateSetting);
  const writeSettingsRef = useRef(updateSettings);
  useEffect(() => {
    writeSetting.current = updateSetting;
    writeSettingsRef.current = updateSettings;
  }, [updateSetting, updateSettings]);

  const evaluateDay = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const nextSplash = await advanceStreakForToday({
        today: localDay(),
        readSettings: () => databaseService.getAllSettings(),
        writeSetting: (key, value) => writeSetting.current(key, value),
        writeSettings: (entries) => writeSettingsRef.current(entries),
        loadBadge: loadNextBadge,
      });
      if (nextSplash) setSplash(nextSplash);
    } catch (e) {
      // A settings read or write failure writes nothing and shows no splash, so
      // an unpersisted advance is never announced. The next foreground return
      // evaluates the day again.
      logger.error('StreakGate check failed', e);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    // The provider snapshot is empty until loadSettings resolves, and React runs
    // child effects before parent effects, so deciding before the loaded flag
    // clears would read no stored date at all (BUG-09-01, primary cause).
    if (isLoading) return;
    void evaluateDay();
    // An app kept alive across local midnight advances on its first return to the
    // foreground instead of waiting for a process restart.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void evaluateDay();
    });
    return () => subscription.remove();
  }, [isLoading, evaluateDay]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {splash ? (
        <StreakSplash
          currentStreak={splash.streak}
          streakStartDate={splash.streakStartDate}
          nextBadge={splash.badge}
          onDismiss={() => setSplash(null)}
          onViewDetails={(badge) => setSelectedBadge(badge)}
        />
      ) : null}
      <BadgeDetailModal
        visible={selectedBadge !== null}
        badge={selectedBadge}
        currentStreak={splash?.streak ?? 0}
        onClose={() => setSelectedBadge(null)}
      />
    </View>
  );
}
