import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View } from 'react-native';
import { databaseService } from '../../services/DatabaseService';
import AchievementCelebration from './AchievementCelebration';

interface CelebrationBadge {
  id: string;
  label: string;
  icon: string;
}

const BADGE_META: Record<string, { label: string; icon: string }> = {
  first_step: { label: 'First Step', icon: '🌱' },
  eagle_eye: { label: 'Eagle Eye', icon: '📸' },
  on_repeat: { label: 'On Repeat', icon: '🔁' },
  week_warrior: { label: 'Week Warrior', icon: '🔥' },
  month_master: { label: 'Month Master', icon: '💎' },
  paper_trail: { label: 'Paper Trail', icon: '📤' },
  detail_devil: { label: 'Detail Devil', icon: '🏷️' },
  'getting-started': { label: 'Getting Started', icon: '🚀' },
  regular: { label: 'Regular', icon: '📊' },
  century: { label: 'Century', icon: '💯' },
  'sneak-peek': { label: 'Sneak Peek', icon: '👀' },
  shutterbug: { label: 'Shutterbug', icon: '📷' },
  'scanner-king': { label: 'Scanner King', icon: '👑' },
  fortnight: { label: 'Fortnight', icon: '🌙' },
  season: { label: 'Season', icon: '🍂' },
  'half-year-hero': { label: 'Half-Year Hero', icon: '⚡' },
  variety: { label: 'Variety', icon: '🎨' },
  explorer: { label: 'Explorer', icon: '🗺️' },
  completionist: { label: 'Completionist', icon: '🏆' },
  saver: { label: 'Saver', icon: '🐷' },
  shopper: { label: 'Shopper', icon: '🛍️' },
  'big-league': { label: 'Big League', icon: '💰' },
  habit: { label: 'Habit', icon: '♻️' },
  loyalist: { label: 'Loyalist', icon: '🏅' },
  novelist: { label: 'Novelist', icon: '📝' },
  'on-track': { label: 'On Track', icon: '📈' },
  disciplined: { label: 'Disciplined', icon: '🧘' },
};

interface AchievementContextType {
  checkForNewAchievements: () => Promise<void>;
}

const AchievementContext = createContext<AchievementContextType>({ checkForNewAchievements: async () => {} });

export function AchievementProvider({ children }: { children: React.ReactNode }) {
  const [currentSingle, setCurrentSingle] = useState<CelebrationBadge | null>(null);
  const [summaryBadges, setSummaryBadges] = useState<CelebrationBadge[] | null>(null);
  const pendingRef = useRef<CelebrationBadge[]>([]);
  const allEarnedRef = useRef<CelebrationBadge[]>([]);

  const handleSingleDismiss = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length > 0) {
      const [next, ...rest] = pending;
      pendingRef.current = rest;
      setCurrentSingle(next);
    } else {
      setCurrentSingle(null);
      if (allEarnedRef.current.length > 1) {
        setSummaryBadges(allEarnedRef.current);
      }
      allEarnedRef.current = [];
    }
  }, []);

  const handleSummaryDismiss = useCallback(() => {
    setSummaryBadges(null);
  }, []);

  const checkForNewAchievements = useCallback(async () => {
    try {
      const newBadgeIds = await databaseService.checkAchievements();
      if (newBadgeIds.length === 0) return;

      const badges = newBadgeIds
        .map(id => BADGE_META[id] ? { id, label: BADGE_META[id].label, icon: BADGE_META[id].icon } : null)
        .filter(Boolean) as CelebrationBadge[];

      allEarnedRef.current = badges;

      if (badges.length === 1) {
        pendingRef.current = [];
        setCurrentSingle(badges[0]);
      } else {
        pendingRef.current = badges.slice(1);
        setCurrentSingle(badges[0]);
      }
    } catch {
      // silently fail
    }
  }, []);

  return (
    <AchievementContext.Provider value={{ checkForNewAchievements }}>
      <View style={{ flex: 1 }}>
        {children}
        {currentSingle && (
          <AchievementCelebration
            key={currentSingle.id}
            badgeId={currentSingle.id}
            badgeLabel={currentSingle.label}
            badgeIcon={currentSingle.icon}
            onDismiss={handleSingleDismiss}
            duration={allEarnedRef.current.length > 1 ? 1800 : 3500}
          />
        )}
        {summaryBadges && (
          <AchievementCelebration
            key="summary"
            summaryBadges={summaryBadges}
            onDismiss={handleSummaryDismiss}
            duration={3000}
          />
        )}
      </View>
    </AchievementContext.Provider>
  );
}

export function useAchievements() {
  return useContext(AchievementContext);
}
