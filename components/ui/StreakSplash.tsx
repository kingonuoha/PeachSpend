import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, CalendarCheck, Check, Flame, X } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BadgeGlyph } from './BadgeGlyph';
import { LuminousCard } from './LuminousCard';
import { PeachButton } from './PeachButton';
import { ScalePressable } from './ScalePressable';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import type { AchievementState } from '../../data/ProfileContracts';

// SH-02a Streak Splash. The single canonical streak-detail overlay, opened from
// the S-02 quiet streak badge (FR-02.6) and by the daily StreakGate. It reads
// the real streak, the real streak start date and a real badge-progress cross
// link, and reuses the shared card, button, press and glyph primitives. Card
// shape, tokens and motion match SH-05b so the streak and achievement systems
// read as one story (FR-05.3). On Home the streak badge stays a small secondary
// pill; this overlay is the only place the streak becomes focal.

export interface StreakSplashProps {
  // Live streak from ProfileSnapshot.stats.streak or DatabaseService.getStreak.
  currentStreak: number;
  // Real streak start date (ISO yyyy-mm-dd from the streak_start_date setting).
  // Absent renders an honest continuity line instead of a fabricated date.
  streakStartDate?: string | null;
  // Real next badge to cross-link. Null hides the badge bridge card rather than
  // inventing progress.
  nextBadge?: AchievementState | null;
  onDismiss: () => void;
  // Optional progressive-disclosure bridge to SH-05a. Hidden when the mounting
  // origin has no detail surface.
  onViewDetails?: (badge: AchievementState) => void;
}

const CARD_MAX_WIDTH = 350;
const CARD_MAX_HEIGHT = 640;
const CLOSE_SIZE = 32;
// Earns the remainder of the 44pt target through hitSlop (32 + 6 + 6).
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
const EMBLEM_SIZE = 80;
const EMBLEM_GLYPH_SIZE = 42;
const AURA_SIZE = 96;
const TRACK_HEIGHT = 6;
const EXIT_DURATION = 200;
// Locked pair emblem gradient (purple-950, purple-600, warning), code.html 166.
const EMBLEM_COLORS = ['#1E0B3D', '#7C3AED', '#F59E0B'] as const;
// Fixed purple-950 for the overline chip (code.html 170), matching the emblem.
const PURPLE_950 = '#1E0B3D';
const CHIP_TEXT = '#EDE9FE';

// Selects the real badge the streak splash should cross-link to: an unearned
// streak-family badge (its description is day based) whose target is not yet
// reached. The smallest remaining gap is the next milestone. Returns null when
// nothing qualifies, so the bridge card is hidden instead of faked.
export function selectNextStreakBadge(achievements: AchievementState[]): AchievementState | null {
  const candidates = achievements.filter(
    (badge) =>
      !badge.earned &&
      /day/i.test(badge.description) &&
      badge.progress.current < badge.progress.target,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, badge) => {
    const bestRemaining = best.progress.target - best.progress.current;
    const remaining = badge.progress.target - badge.progress.current;
    if (remaining !== bestRemaining) return remaining < bestRemaining ? badge : best;
    return badge.progress.target < best.progress.target ? badge : best;
  });
}

function formatStartDate(iso: string): string | null {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function StreakSplash({
  currentStreak,
  streakStartDate,
  nextBadge,
  onDismiss,
  onViewDetails,
}: StreakSplashProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const { height, width } = useWindowDimensions();
  // Pair uses `items-end sm:items-center` (code.html 155): bottom-anchored on a
  // phone, vertically centered once the viewport reaches the sm 640 breakpoint.
  const isWide = width >= 640;

  const dismissingRef = useRef(false);
  const [dismissing, setDismissing] = useState(false);
  const overlayOpacity = useSharedValue(0);
  // Drives the exit fade. Kept separate from the entrance opacity so dismissal
  // never writes a value the entrance effect depends on.
  const exitProgress = useSharedValue(1);
  const cardScale = useSharedValue(0.95);
  const pulseOpacity = useSharedValue(1);

  const cardMaxHeight = useMemo(
    () => Math.min(height - Spacing.s8 * 2, CARD_MAX_HEIGHT),
    [height],
  );

  const hasStreak = currentStreak > 0;
  const startLabel = streakStartDate ? formatStartDate(streakStartDate) : null;
  const continuityText = startLabel
    ? `Started ${startLabel}`
    : 'Every consecutive day builds your continuity';

  const headline = !hasStreak
    ? 'Your Habit Streak'
    : currentStreak === 1
      ? 'Day 1: Fresh Momentum'
      : `${currentStreak}-Day Habit Streak`;
  const narrative = !hasStreak
    ? 'Every entry builds clear financial intuition.'
    : currentStreak === 1
      ? "Your journey starts with a single honest record. Today's step builds financial clarity."
      : `Logged consistently for ${currentStreak} consecutive days. Every entry builds clear financial intuition.`;

  const badgePercent = nextBadge
    ? Math.max(0, Math.min(100, Math.round(nextBadge.progress.ratio * 100)))
    : 0;
  const badgeRemaining = nextBadge
    ? Math.max(0, nextBadge.progress.target - nextBadge.progress.current)
    : 0;

  useEffect(() => {
    overlayOpacity.value = withTiming(1, { duration: 300 });

    if (reduceMotion) {
      cardScale.value = 1;
      pulseOpacity.value = 1;
      return;
    }

    cardScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    return () => cancelAnimation(pulseOpacity);
  }, [reduceMotion, overlayOpacity, cardScale, pulseOpacity]);

  // Exit fade runs from an effect so the dismissal path never mutates a shared
  // value read by the entrance effect. The origin unmounts after onDismiss.
  useEffect(() => {
    if (!dismissing) return;
    exitProgress.value = withTiming(0, { duration: EXIT_DURATION, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDismiss)();
    });
    return () => cancelAnimation(exitProgress);
  }, [dismissing, exitProgress, onDismiss]);

  const close = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    if (reduceMotion) {
      onDismiss();
      return;
    }
    setDismissing(true);
  }, [onDismiss, reduceMotion]);

  const handleViewDetails = useCallback(() => {
    if (!nextBadge) return;
    onViewDetails?.(nextBadge);
    close();
  }, [nextBadge, onViewDetails, close]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value * exitProgress.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));
  const flameStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const overlayTint = ts.isDark ? ts.bg.overlay : 'rgba(15,11,30,0.45)';
  const trackColor = ts.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.7)';

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <Animated.View style={[styles.overlay, { justifyContent: isWide ? 'center' : 'flex-end' }, overlayStyle]}>
        <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: overlayTint }]}
          importantForAccessibility="no-hide-descendants"
        />

        <ScalePressable
          haptic={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={styles.backdrop}
        >
          <View />
        </ScalePressable>

        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <LuminousCard
            variant={ts.isDark ? 'low' : 'high'}
            style={[styles.card, { maxHeight: cardMaxHeight, shadowColor: ts.raw.primary }]}
          >
            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss streak detail"
              hitSlop={CLOSE_HIT_SLOP}
              onPress={close}
              style={[styles.close, { backgroundColor: ts.isDark ? ts.bg.card : ts.bg.low }]}
            >
              <X size={18} color={ts.raw.onSurfaceVariant} strokeWidth={2.5} />
            </ScalePressable>

            <ScrollView
              style={[styles.cardScroll, { maxHeight: cardMaxHeight }]}
              contentContainerStyle={styles.cardContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.emblemWrap}>
                <Animated.View
                  pointerEvents="none"
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.aura, { backgroundColor: ts.raw.primary }]}
                />
                <LinearGradient
                  colors={EMBLEM_COLORS}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.emblem}
                >
                  <Animated.View style={flameStyle}>
                    <Flame size={EMBLEM_GLYPH_SIZE} color="#FFFFFF" />
                  </Animated.View>
                </LinearGradient>
                <View style={styles.chip}>
                  <Text style={[Typography.micro, styles.chipText]}>CONSISTENCY</Text>
                </View>
              </View>

              <Text
                accessibilityRole="header"
                style={[Typography.headlineLg, styles.headline, { color: ts.raw.onSurface }]}
              >
                {headline}
              </Text>
              <Text style={[Typography.bodyRegular, styles.narrative, { color: ts.raw.onSurfaceVariant }]}>
                {narrative}
              </Text>

              <View style={[styles.context, { backgroundColor: ts.isDark ? ts.bg.card : ts.bg.low }]}>
                <CalendarCheck size={16} color={ts.raw.primary} />
                <Text
                  style={[Typography.micro, styles.contextText, { color: ts.raw.onSurface }]}
                  numberOfLines={2}
                >
                  {continuityText}
                </Text>
              </View>

              {nextBadge ? (
                <View style={[styles.badgeBox, { backgroundColor: ts.raw.purple100 }]}>
                  <View style={styles.badgeHeader}>
                    <View style={styles.badgeTitleRow}>
                      <BadgeGlyph name={nextBadge.icon} size={18} color={ts.raw.primary} />
                      <Text
                        style={[Typography.captionBold, styles.badgeTitle, { color: ts.raw.onSurface }]}
                        numberOfLines={1}
                      >
                        {nextBadge.label}
                      </Text>
                    </View>
                    <Text style={[Typography.micro, styles.badgeCount, { color: ts.raw.primary }]}>
                      {`${nextBadge.progress.current} / ${nextBadge.progress.target} Days`}
                    </Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: trackColor }]}>
                    <View
                      style={[
                        styles.trackFill,
                        { width: `${badgePercent}%`, backgroundColor: ts.raw.primary },
                      ]}
                    />
                  </View>
                  <Text
                    style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}
                    numberOfLines={2}
                  >
                    {`Next milestone: ${nextBadge.label} in ${badgeRemaining} ${
                      badgeRemaining === 1 ? 'day' : 'days'
                    }`}
                  </Text>
                </View>
              ) : null}

              <PeachButton
                title="Got It"
                variant="primary"
                size="xl"
                fullWidth
                trailingIcon={<Check size={20} color="#FFFFFF" />}
                onPress={close}
                style={styles.cta}
              />

              {nextBadge && onViewDetails ? (
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel="View linked badges"
                  onPress={handleViewDetails}
                  style={styles.bridge}
                >
                  <Text style={[Typography.captionBold, { color: ts.raw.primary }]}>
                    View Linked Badges
                  </Text>
                  <ArrowRight size={14} color={ts.raw.primary} />
                </ScalePressable>
              ) : null}
            </ScrollView>
          </LuminousCard>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.s4,
    paddingTop: Spacing.s4,
    paddingBottom: Spacing.s4,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardWrap: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    alignItems: 'center',
    zIndex: 10,
  },
  card: {
    width: '100%',
    borderRadius: Radii.xl,
    padding: 0,
    borderWidth: 0,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 32,
    elevation: 16,
  },
  close: {
    position: 'absolute',
    top: Spacing.s4,
    right: Spacing.s4,
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  cardScroll: {
    flexGrow: 0,
  },
  cardContent: {
    // Pair p-6 (HTML 157).
    padding: Spacing.s6,
    alignItems: 'center',
  },
  emblemWrap: {
    position: 'relative',
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    // Pair mt-1 mb-4 (HTML 163); the chip overhangs bottom by Spacing.s2.
    marginTop: Spacing.s1,
    marginBottom: Spacing.s4,
  },
  aura: {
    position: 'absolute',
    top: (EMBLEM_SIZE - AURA_SIZE) / 2,
    left: (EMBLEM_SIZE - AURA_SIZE) / 2,
    width: AURA_SIZE,
    height: AURA_SIZE,
    borderRadius: AURA_SIZE / 2,
    opacity: 0.2,
  },
  emblem: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
    borderRadius: EMBLEM_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },
  chip: {
    position: 'absolute',
    bottom: -Spacing.s2,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    backgroundColor: PURPLE_950,
  },
  chipText: {
    color: CHIP_TEXT,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headline: {
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  narrative: {
    textAlign: 'center',
    marginTop: Spacing.s1,
    paddingHorizontal: Spacing.s1,
  },
  context: {
    width: '100%',
    marginTop: Spacing.s4,
    paddingVertical: Spacing.s2,
    paddingHorizontal: Spacing.s3,
    borderRadius: Radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s1,
  },
  contextText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  badgeBox: {
    width: '100%',
    marginTop: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    gap: Spacing.s2,
  },
  badgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  badgeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    flexShrink: 1,
    minWidth: 0,
  },
  badgeTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  badgeCount: {
    fontFamily: 'Manrope_700Bold',
    flexShrink: 0,
  },
  track: {
    width: '100%',
    height: TRACK_HEIGHT,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: Radii.full,
  },
  cta: {
    marginTop: Spacing.s5,
  },
  bridge: {
    marginTop: Spacing.s2,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s1,
  },
});
