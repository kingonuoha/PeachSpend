import React, { useEffect, useState, useRef } from 'react';
import { View } from 'react-native';
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

export default function StreakGate({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [splash, setSplash] = useState<StreakSplashState | null>(null);
  const [selectedBadge, setSelectedBadge] = useState<AchievementState | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    (async () => {
      try {
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const lastOpened = settings.last_opened_date;

        if (lastOpened === todayStr) return;

        // FR-11.3: logging activity of any type advances the streak, so an
        // income-only user is not stuck at zero. Spend-threshold badges remain
        // expense-specific and are unaffected by this gate.
        const hasActivity = await databaseService.hasAnyLoggingActivity();
        if (!hasActivity) return;

        const prevStreak = parseInt(settings.last_streak || '0') || 0;
        const newStreak = await databaseService.incrementStreak();

        const startsToday = prevStreak === 0 && newStreak === 1;
        if (startsToday) {
          await databaseService.updateSetting('streak_start_date', todayStr);
        }

        const showAnimation = newStreak !== prevStreak || prevStreak === 0;

        if (showAnimation) {
          let badge: AchievementState | null = null;
          try {
            const snapshot = await profileDataService.getSnapshot();
            badge = selectNextStreakBadge(snapshot.achievements);
          } catch {
            badge = null;
          }
          setSplash({
            streak: newStreak,
            streakStartDate: startsToday ? todayStr : (settings.streak_start_date ?? null),
            badge,
          });
        }

        await databaseService.updateSetting('last_opened_date', todayStr);
      } catch (e) {
        logger.error('StreakGate check failed', e);
      }
    })();
  }, [settings.last_opened_date, settings.last_streak, settings.streak_start_date]);

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
