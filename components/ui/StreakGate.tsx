import React, { useEffect, useState, useRef } from 'react';
import { View } from 'react-native';
import { useSettings } from './SettingsProvider';
import { databaseService } from '../../services/DatabaseService';
import { logger } from '../../utils/logger';
import StreakSplash from './StreakSplash';

export default function StreakGate({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [showSplash, setShowSplash] = useState(false);
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

        const monthlyBudget = parseFloat(settings.monthly_budget) || 0;
        if (monthlyBudget <= 0) return;

        const streak = await databaseService.getStreak();
        if (streak <= 0) return;

        const prevLastStreak = settings.last_streak || '0';
        const prevStreak = parseInt(prevLastStreak) || 0;
        const showAnimation = prevStreak !== streak || prevStreak === 0;

        setShowSplash(showAnimation);

        await databaseService.updateSetting('last_opened_date', todayStr);
      } catch (e) {
        logger.error('StreakGate check failed', e);
      }
    })();
  }, [settings.last_opened_date, settings.monthly_budget, settings.last_streak]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {showSplash && <StreakSplash onFinish={() => setShowSplash(false)} />}
    </View>
  );
}
