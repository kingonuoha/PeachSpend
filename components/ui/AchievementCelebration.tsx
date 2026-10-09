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
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ArrowRight, Flame, Info, Sparkles, X } from 'lucide-react-native';

import { BadgeGlyph } from './BadgeGlyph';
import { LuminousCard } from './LuminousCard';
import { PeachButton } from './PeachButton';
import { ScalePressable } from './ScalePressable';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import type { AchievementState } from '../../data/ProfileContracts';

// SH-05b Achievement Celebration. The single canonical badge-celebration surface,
// reused by the global AchievementProvider and the S-05 Profile streak entry. It
// reads the real AchievementState contract plus the live streak and reuses the
// shared card, button, press and glyph primitives. Visual language (celebration
// card, brand gradient, streak row) matches SH-02a so the streak and badge
// systems read as one story (FR-05.3). The overlay is event-scoped and always
// dismissible; it never auto-hides while the SH-05a bridge is reachable.

interface AchievementCelebrationProps {
  achievement: AchievementState;
  // Live streak from ProfileSnapshot.stats.streak or DatabaseService.getStreak.
  // Zero or undefined renders the non-guilt fallback instead of a fake value.
  currentStreak?: number;
  onDismiss: () => void;
  // Optional progressive-disclosure bridge to SH-05a. Hidden when the mounting
  // origin has no detail surface (for example the global provider).
  onViewDetails?: (achievement: AchievementState) => void;
}

const CARD_MAX_WIDTH = 420;
const CARD_MAX_HEIGHT = 720;
const CLOSE_SIZE = 32;
// Earns the remainder of the 44pt target through hitSlop (32 + 6 + 6).
const CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };
const BADGE_RING_SIZE = 112;
const BADGE_RING_PAD = 6;
// Pair badge glyph is text-5xl (48px), HTML 296.
const BADGE_GLYPH_SIZE = 48;
const AURA_SIZE = 288;
const RAY_SIZE = 440;
const EXIT_DURATION = 200;
const CONFETTI_COUNT = 24;
// Decorative celebration palette from the locked pair (code.html line 754).
// A colour set carries no data meaning, so it stays local to the confetti.
const CONFETTI_COLORS = ['#7C3AED', '#A78BFA', '#F59E0B', '#10B981', '#EC4899', '#FFFFFF'];
// Locked pair badge ring (purple-600, amber-400, purple-400), code.html line 292.
const BADGE_RING_COLORS = ['#7C3AED', '#F59E0B', '#A78BFA'] as const;
// Locked purple-950 used for the badge's inner navy disc and amber pill text.
const PURPLE_950 = '#1E0B3D';

interface Particle {
  x: number;
  y: number;
  drift: number;
  rotate: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
}

function buildParticles(width: number, height: number): Particle[] {
  return Array.from({ length: CONFETTI_COUNT }, () => {
    const x = Math.random() * width;
    return {
      x,
      y: height * 0.5 + (Math.random() - 0.5) * height * 0.25,
      drift: x > width / 2 ? 80 : -80,
      rotate: Math.random() * 360,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      delay: Math.random() * 500,
      duration: 1600 + Math.random() * 900,
    };
  });
}

function ConfettiParticle({ particle }: { particle: Particle }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      particle.delay,
      withTiming(1, { duration: particle.duration, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(progress);
  }, [progress, particle.delay, particle.duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: particle.x + progress.value * particle.drift },
      { translateY: particle.y - progress.value * 140 },
      { rotate: `${particle.rotate + progress.value * 360}deg` },
      { scale: 0.8 + progress.value * 0.3 },
    ],
    opacity: interpolate(progress.value, [0, 0.15, 0.8, 1], [0, 1, 1, 0]),
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        { width: particle.size, height: particle.size * 0.6, backgroundColor: particle.color },
        style,
      ]}
    />
  );
}

export default function AchievementCelebration({
  achievement,
  currentStreak = 0,
  onDismiss,
  onViewDetails,
}: AchievementCelebrationProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const { width, height } = useWindowDimensions();

  const dismissingRef = useRef(false);
  const [dismissing, setDismissing] = useState(false);
  const overlayOpacity = useSharedValue(0);
  // Drives the exit fade. Kept separate from the entrance opacity so the
  // dismissal path never writes a value that the entrance effect depends on.
  const exitProgress = useSharedValue(1);
  const cardScale = useSharedValue(0.9);
  const cardTranslate = useSharedValue(24);
  const badgeScale = useSharedValue(0.3);
  const badgeRotate = useSharedValue(-15);
  const auraScale = useSharedValue(1);
  const auraOpacity = useSharedValue(0.6);
  const raySpin = useSharedValue(0);

  const particles = useMemo(() => buildParticles(width, height), [width, height]);
  const cardMaxHeight = useMemo(
    () => Math.min(height - Spacing.s7 * 2, CARD_MAX_HEIGHT),
    [height],
  );

  const hasStreak = currentStreak > 0;

  useEffect(() => {
    overlayOpacity.value = withTiming(1, { duration: 300 });

    // Reduce motion keeps the opacity fade only: the card and badge snap into
    // place instead of scaling, translating or overshooting (HTML 79-92 motion).
    if (reduceMotion) {
      cardScale.value = 1;
      cardTranslate.value = 0;
      badgeScale.value = 1;
      badgeRotate.value = 0;
      return;
    }

    cardScale.value = withTiming(1, { duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1) });
    cardTranslate.value = withTiming(0, { duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1) });

    badgeScale.value = withDelay(150, withSpring(1, { damping: 10, stiffness: 120, mass: 0.8 }));
    badgeRotate.value = withDelay(150, withSpring(0, { damping: 12 }));
    auraScale.value = withRepeat(
      withSequence(
        withTiming(1.22, { duration: 1750, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1750, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    auraOpacity.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 1750, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.6, { duration: 1750, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    raySpin.value = withRepeat(withTiming(360, { duration: 25000, easing: Easing.linear }), -1, false);

    return () => {
      cancelAnimation(badgeScale);
      cancelAnimation(badgeRotate);
      cancelAnimation(auraScale);
      cancelAnimation(auraOpacity);
      cancelAnimation(raySpin);
    };
  }, [reduceMotion, overlayOpacity, cardScale, cardTranslate, badgeScale, badgeRotate, auraScale, auraOpacity, raySpin]);

  // Exit fade runs from an effect (never from a handler) so the dismissal path
  // does not mutate a shared value read by the entrance effect. The overlay
  // stays mounted until the fade finishes, then the origin unmounts it.
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
    onViewDetails?.(achievement);
    close();
  }, [onViewDetails, achievement, close]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value * exitProgress.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }, { translateY: cardTranslate.value }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }, { rotate: `${badgeRotate.value}deg` }],
  }));
  const auraStyle = useAnimatedStyle(() => ({
    transform: [{ scale: auraScale.value }],
    opacity: auraOpacity.value,
  }));
  const rayStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${raySpin.value}deg` }] }));

  const overlayTint = ts.isDark ? 'rgba(0,0,0,0.85)' : 'rgba(30,11,61,0.75)';
  const badgeInner = ts.isDark ? ts.raw.background : PURPLE_950;
  const badgeBorder = ts.raw.warning + '66';
  // NEW pill text is the fixed purple-950 from the pair (HTML 300).
  const newPillText = PURPLE_950;
  // Pair close and streak-row fills sit on the raised surface in dark (HTML 285,
  // 322); ts.bg.low equals the dark card surface, so use bg.card there.
  const closeBackground = ts.isDark ? ts.bg.card : ts.bg.low;
  const streakSurface = ts.isDark ? ts.bg.card : ts.bg.low;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <Animated.View style={[styles.overlay, overlayStyle]}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: overlayTint }]}
          importantForAccessibility="no-hide-descendants"
        />

        <Animated.View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={[styles.ray, rayStyle]}
        >
          <Svg width={RAY_SIZE} height={RAY_SIZE} viewBox="0 0 200 200">
            <Path
              d="M100 0 L107 85 L180 30 L120 95 L200 100 L120 105 L180 170 L107 115 L100 200 L93 115 L20 170 L80 105 L0 100 L80 95 L20 30 L93 85 Z"
              fill={ts.raw.primary}
              opacity={0.35}
            />
          </Svg>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={[styles.aura, { backgroundColor: ts.raw.primary }, auraStyle]}
        />

        {!reduceMotion
          ? particles.map((particle) => (
              <ConfettiParticle key={`${particle.x}-${particle.y}-${particle.delay}`} particle={particle} />
            ))
          : null}

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
            style={[styles.card, { maxHeight: cardMaxHeight }]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={['transparent', ts.raw.primary, 'transparent']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.accent}
              importantForAccessibility="no-hide-descendants"
            />

            <ScalePressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss achievement celebration"
              hitSlop={CLOSE_HIT_SLOP}
              onPress={close}
              style={[styles.close, { backgroundColor: closeBackground }]}
            >
              <X size={15} color={ts.raw.onSurfaceVariant} strokeWidth={2.5} />
            </ScalePressable>

            <ScrollView
              style={[styles.cardScroll, { maxHeight: cardMaxHeight }]}
              contentContainerStyle={styles.cardContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.badgeWrap}>
                <Animated.View style={badgeStyle}>
                  <LinearGradient
                    colors={BADGE_RING_COLORS}
                    start={{ x: 0, y: 1 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.badgeRing, { shadowColor: ts.raw.primary }]}
                  >
                    <View
                      style={[
                        styles.badgeInner,
                        { backgroundColor: badgeInner, borderColor: badgeBorder },
                      ]}
                    >
                      <BadgeGlyph name={achievement.icon} size={BADGE_GLYPH_SIZE} color={ts.raw.warning} />
                    </View>
                  </LinearGradient>
                </Animated.View>

                {achievement.earned ? (
                  <View
                    style={[
                      styles.newPill,
                      { backgroundColor: ts.raw.warning, borderColor: Colors.white },
                    ]}
                  >
                    <Sparkles size={10} color={newPillText} />
                    <Text style={[Typography.micro, styles.newPillText, { color: newPillText }]}>
                      NEW
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text
                style={[Typography.headlineLg, styles.title, { color: ts.raw.onSurface }]}
                accessibilityRole="header"
              >
                {achievement.label}
              </Text>
              <Text
                style={[Typography.bodyRegular, styles.description, { color: ts.raw.onSurfaceVariant }]}
              >
                {achievement.description}
              </Text>

              <View
                style={[
                  styles.streak,
                  {
                    backgroundColor: hasStreak ? streakSurface : ts.raw.warningContainer,
                    borderColor: hasStreak ? ts.raw.outline : ts.raw.warningBorder,
                  },
                ]}
              >
                <View style={[styles.streakIcon, { backgroundColor: ts.raw.warningContainer }]}>
                  <Flame size={18} color={ts.raw.warning} />
                </View>
                <View style={styles.streakText}>
                  <Text
                    style={[Typography.micro, styles.streakLabel, { color: ts.raw.onSurfaceVariant }]}
                    numberOfLines={1}
                  >
                    CURRENT ACTIVE STREAK
                  </Text>
                  <Text
                    style={[
                      Typography.labelBold,
                      { color: hasStreak ? ts.raw.onSurface : ts.raw.warningContainerText },
                    ]}
                    numberOfLines={1}
                  >
                    {hasStreak
                      ? `${currentStreak} ${currentStreak === 1 ? 'Day' : 'Days'} Active`
                      : 'Start your streak today!'}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <PeachButton
                  title="Keep It Up"
                  variant="primary"
                  size="lg"
                  fullWidth
                  trailingIcon={<ArrowRight size={16} color={Colors.white} />}
                  onPress={close}
                />
                {onViewDetails ? (
                  <PeachButton
                    title="View Full Badge Details"
                    variant="ghost"
                    size="lg"
                    fullWidth
                    icon={<Info size={16} color={ts.raw.primary} />}
                    onPress={handleViewDetails}
                  />
                ) : null}
              </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.s6,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  ray: {
    position: 'absolute',
    width: RAY_SIZE,
    height: RAY_SIZE,
    opacity: 0.15,
  },
  aura: {
    position: 'absolute',
    width: AURA_SIZE,
    height: AURA_SIZE,
    borderRadius: AURA_SIZE / 2,
  },
  particle: {
    position: 'absolute',
    borderRadius: 4,
  },
  cardWrap: {
    width: '100%',
    alignItems: 'center',
    zIndex: 10,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: Radii.xxl,
    padding: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 16,
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: Spacing.s7,
    right: Spacing.s7,
    height: Spacing.s1,
    zIndex: 2,
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
    // Pair p-6 (HTML 279).
    padding: Spacing.s6,
    alignItems: 'center',
  },
  badgeWrap: {
    position: 'relative',
    marginTop: Spacing.s2,
    marginBottom: Spacing.s4,
  },
  badgeRing: {
    width: BADGE_RING_SIZE,
    height: BADGE_RING_SIZE,
    borderRadius: BADGE_RING_SIZE / 2,
    padding: BADGE_RING_PAD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 8,
  },
  badgeInner: {
    width: '100%',
    height: '100%',
    borderRadius: BADGE_RING_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPill: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 2,
  },
  newPillText: {
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1,
  },
  title: {
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  description: {
    textAlign: 'center',
    marginTop: Spacing.s2,
    paddingHorizontal: Spacing.s1,
  },
  streak: {
    width: '100%',
    marginTop: Spacing.s4,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  streakIcon: {
    width: 36,
    height: 36,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakText: {
    flex: 1,
    minWidth: 0,
  },
  streakLabel: {
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.5,
  },
  actions: {
    width: '100%',
    marginTop: Spacing.s5,
    gap: Spacing.s2,
  },
});
