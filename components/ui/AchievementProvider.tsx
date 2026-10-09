import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View } from 'react-native';
import { databaseService } from '../../services/DatabaseService';
import { buildAchievementState } from '../../data/ProfileDataService';
import type { AchievementState } from '../../data/ProfileContracts';
import AchievementCelebration from './AchievementCelebration';

// Global host for passive badge celebrations (S-02/S-04/S-07/S-09/S-13 saves).
// It maps the newly earned ids against the one real badge catalogue
// (DatabaseService.getBadgeProgress through the shared buildAchievementState
// mapper) instead of keeping a second local metadata table, then queues each
// earned badge through the single canonical SH-05b surface.

interface AchievementContextType {
  checkForNewAchievements: () => Promise<void>;
}

const AchievementContext = createContext<AchievementContextType>({ checkForNewAchievements: async () => {} });

export function AchievementProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<AchievementState | null>(null);
  const [streak, setStreak] = useState(0);
  const pendingRef = useRef<AchievementState[]>([]);

  const handleDismiss = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length > 0) {
      const [next, ...rest] = pending;
      pendingRef.current = rest;
      setCurrent(next);
    } else {
      setCurrent(null);
    }
  }, []);

  const checkForNewAchievements = useCallback(async () => {
    try {
      const newBadgeIds = await databaseService.checkAchievements();
      if (newBadgeIds.length === 0) return;

      const [rows, currentStreak] = await Promise.all([
        databaseService.getBadgeProgress(),
        databaseService.getStreak(),
      ]);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const badges = newBadgeIds
        .map((id) => {
          const row = byId.get(id);
          return row ? buildAchievementState(row) : null;
        })
        .filter((badge): badge is AchievementState => badge !== null);

      if (badges.length === 0) return;

      setStreak(currentStreak);
      pendingRef.current = badges.slice(1);
      setCurrent(badges[0]);
    } catch {
      // Silence matches the previous provider contract: a failed achievement
      // check must never interrupt the save that triggered it.
    }
  }, []);

  return (
    <AchievementContext.Provider value={{ checkForNewAchievements }}>
      <View style={{ flex: 1 }}>
        {children}
        {current ? (
          <AchievementCelebration
            key={current.id}
            achievement={current}
            currentStreak={streak}
            onDismiss={handleDismiss}
          />
        ) : null}
      </View>
    </AchievementContext.Provider>
  );
}

export function useAchievements() {
  return useContext(AchievementContext);
}
