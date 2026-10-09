import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, Check, Lock, Share2, X, Zap } from 'lucide-react-native';

import { BadgeGlyph } from './BadgeGlyph';
import { LuminousCard } from './LuminousCard';
import { PeachButton } from './PeachButton';
import { ScalePressable } from './ScalePressable';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors, Gradients, Radii, Spacing, Typography } from '../../constants/tokens';
import type { AchievementState } from '../../data/ProfileContracts';

// SH-05a Badge Detail. Single canonical achievement-detail surface, opened from
// the S-05 badge grid. Reads the typed AchievementState contract and reuses the
// shared card, button, press and glyph primitives instead of forking them. The
// visual language (brand gradient emblem, progress track, streak row) matches
// SH-05b and SH-02a so the streak and badge systems read as one story (FR-05.3).

interface BadgeDetailModalProps {
  visible: boolean;
  badge: AchievementState | null;
  // Real current streak from ProfileSnapshot.stats.streak. The cross-link row is
  // hidden when there is no active streak instead of showing a fabricated value.
  currentStreak?: number;
  onClose: () => void;
}

const EMBLEM_SIZE = 96;
const EMBLEM_RADIUS = Radii.lg;
const CLOSE_SIZE = 36;
// Earns the remainder of the 44pt target through hitSlop (36 + 4 + 4).
const CLOSE_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };
const SHEET_MAX_WIDTH = 640;

function formatEarnedDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BadgeDetailModal({ visible, badge, currentStreak = 0, onClose }: BadgeDetailModalProps) {
  const ts = useThemeStyles();
  const { height } = useWindowDimensions();

  const sheetMaxHeight = useMemo(() => Math.min(height * 0.85, 760), [height]);

  if (!badge) return null;

  const percent = Math.max(0, Math.min(100, Math.round(badge.progress.ratio * 100)));
  const showStreak = currentStreak > 0;
  const showEarnedDate = badge.earned && badge.earnedAt !== null;

  const handleShare = async () => {
    const stateLine = badge.earned
      ? `Earned${badge.earnedAt !== null ? ` ${formatEarnedDate(badge.earnedAt)}` : ''}.`
      : `Progress ${badge.progress.current} of ${badge.progress.target} (${percent}%).`;
    try {
      await Share.share({ message: `${badge.label}: ${badge.description} ${stateLine}` });
    } catch {
      // The OS share sheet can be dismissed or unavailable. No write, no retry.
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.root}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: ts.bg.overlay }]}
          importantForAccessibility="no-hide-descendants"
        />
        <ScalePressable
          haptic={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        >
          <View />
        </ScalePressable>

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: ts.raw.surface,
              borderTopColor: ts.raw.outline,
              maxHeight: sheetMaxHeight,
            },
          ]}
        >
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View
              style={[styles.handle, { backgroundColor: ts.raw.onSurfaceVariant + '66' }]}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            />

            <View style={styles.header}>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss badge detail"
                hitSlop={CLOSE_HIT_SLOP}
                onPress={onClose}
                style={[styles.close, { backgroundColor: ts.isDark ? ts.bg.card : ts.bg.low }]}
              >
                <X size={16} color={ts.raw.onSurfaceVariant} strokeWidth={2} />
              </ScalePressable>
            </View>

            <View style={styles.hero}>
              <View style={styles.emblemWrap}>
                <View
                  pointerEvents="none"
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.glow,
                    {
                      backgroundColor:
                        (badge.earned ? ts.raw.primary : ts.raw.onSurfaceVariant) + (badge.earned ? '40' : '1F'),
                    },
                  ]}
                />
                {badge.earned ? (
                  <LinearGradient
                    colors={ts.isDark ? Gradients.dark : Gradients.light}
                    locations={[0, 0.45, 1]}
                    start={{ x: 0.33, y: 0 }}
                    end={{ x: 0.67, y: 1 }}
                    style={[
                      styles.emblem,
                      // Pair border-white/40 light, border-white/20 dark (HTML 327).
                      { borderColor: ts.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.40)' },
                    ]}
                  >
                    <BadgeGlyph name={badge.icon} size={48} color={Colors.white} />
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      styles.emblem,
                      {
                        backgroundColor: ts.bg.elevated,
                        borderColor: ts.raw.outline,
                      },
                    ]}
                  >
                    <View style={{ opacity: 0.5 }}>
                      <BadgeGlyph name={badge.icon} size={48} color={ts.raw.onSurfaceVariant} />
                    </View>
                  </View>
                )}

                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: badge.earned ? Colors.success : ts.raw.onSurfaceVariant,
                      borderColor: ts.raw.surface,
                    },
                  ]}
                >
                  {badge.earned ? (
                    <Check size={12} color={Colors.white} strokeWidth={3} />
                  ) : (
                    <Lock size={12} color={Colors.white} strokeWidth={2.5} />
                  )}
                  <Text style={[Typography.micro, styles.statusText]}>
                    {badge.earned ? 'Earned' : 'In Progress'}
                  </Text>
                </View>
              </View>

              <Text style={[Typography.headlineSm, styles.title, { color: ts.raw.onSurface }]}>
                {badge.label}
              </Text>
              <Text
                style={[Typography.labelMd, styles.description, { color: ts.raw.onSurfaceVariant }]}
              >
                {badge.description}
              </Text>
            </View>

            <LuminousCard variant={ts.isDark ? 'high' : 'low'} style={styles.specBox}>
              <View>
                <View style={styles.progressHeader}>
                  <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
                    Milestone Progress
                  </Text>
                  <Text style={[Typography.labelBold, { color: ts.raw.primary }]}>
                    {badge.progress.current} / {badge.progress.target} ({percent}%)
                  </Text>
                </View>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel="Milestone progress"
                  accessibilityValue={{ min: 0, max: badge.progress.target, now: badge.progress.current }}
                  // Pair track bg-neutral-200 light, #151027 dark (HTML 351).
                  style={[styles.track, { backgroundColor: ts.isDark ? ts.bg.lowest : ts.bg.elevated }]}
                >
                  <LinearGradient
                    colors={ts.isDark ? Gradients.dark : Gradients.light}
                    locations={[0, 0.45, 1]}
                    start={{ x: 0.33, y: 0 }}
                    end={{ x: 0.67, y: 1 }}
                    style={[styles.trackFill, { width: `${percent}%` }]}
                  />
                </View>
              </View>

              {showEarnedDate ? (
                <View style={[styles.metaRow, { borderTopColor: ts.raw.outline }]}>
                  <View style={styles.metaLabel}>
                    <Calendar size={14} color={ts.raw.primary} />
                    <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
                      Date Earned:
                    </Text>
                  </View>
                  <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                    {formatEarnedDate(badge.earnedAt as number)}
                  </Text>
                </View>
              ) : null}

              {showStreak ? (
                <View style={[styles.metaRow, { borderTopColor: ts.raw.outline }]}>
                  <View style={styles.metaLabel}>
                    <Zap size={14} color={ts.raw.warning} />
                    <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
                      Linked Streak:
                    </Text>
                  </View>
                  <Text style={[Typography.labelBold, { color: ts.raw.warning }]}>
                    Current {currentStreak}-day active
                  </Text>
                </View>
              ) : null}
            </LuminousCard>

            <View style={styles.actions}>
              <PeachButton
                title={badge.earned ? 'Share Achievement' : 'Share Progress'}
                variant="primary"
                size="lg"
                icon={
                  badge.earned ? (
                    <Share2 size={16} color={Colors.white} />
                  ) : (
                    <Zap size={16} color={Colors.white} />
                  )
                }
                onPress={handleShare}
                style={styles.shareButton}
              />
              <PeachButton title="Done" variant="ghost" size="lg" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetContent: {
    // Pair p-5 pt-3 (HTML 307): 20 horizontal/bottom, 12 top.
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s5,
  },
  handle: {
    width: 48,
    height: 6,
    borderRadius: Radii.full,
    alignSelf: 'center',
    marginBottom: Spacing.s3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: Spacing.s2,
  },
  close: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginVertical: Spacing.s3,
  },
  emblemWrap: {
    position: 'relative',
    marginBottom: Spacing.s3,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: EMBLEM_RADIUS,
    transform: [{ scale: 1.25 }],
  },
  emblem: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
    borderRadius: EMBLEM_RADIUS,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 2,
  },
  statusText: {
    color: Colors.white,
    fontFamily: 'Manrope_700Bold',
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    maxWidth: 280,
    marginTop: Spacing.s1,
  },
  specBox: {
    // Pair rounded-2xl (HTML 343) = 16, overriding LuminousCard's base Radii.lg.
    borderRadius: Radii.md,
    marginVertical: Spacing.s4,
    padding: Spacing.s4,
    gap: Spacing.s3,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s2,
    gap: Spacing.s2,
  },
  track: {
    width: '100%',
    height: 10,
    borderRadius: Radii.full,
    overflow: 'hidden',
    // Pair track p-0.5 (HTML 351): a 6px fill inset in the 10px track. No 2px
    // spacing token exists, so the literal carries the canonical inset.
    padding: 2,
  },
  trackFill: {
    height: '100%',
    borderRadius: Radii.full,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.s2,
    borderTopWidth: 1,
    gap: Spacing.s2,
  },
  metaLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    paddingTop: Spacing.s1,
  },
  shareButton: {
    flex: 1,
  },
});
