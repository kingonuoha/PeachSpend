import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Colors, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

// Locked pair values (docs/designs/peachspend_spec_7._ai_processing_overlay). The
// processing panel is intentionally dark in both themes, so it derives its surface
// colors from locked tokens plus a fixed alpha rather than a raw hex literal.
const PANEL_BG = `${Colors.black}B3`; // #17162A at 70 percent (HTML 50)
const PANEL_BORDER = `${Colors.white}1A`; // white hairline at 10 percent
const PILL_BG = `${Colors.white}26`; // white at 15 percent (HTML 67)
const PILL_BORDER = `${Colors.white}33`; // white at 20 percent (HTML 67)
const TRACK_BG = `${Colors.white}33`; // white at 20 percent (HTML 78)
const ACCENT = Colors.primaryContainer; // #8B5CF6 purple-500 (HTML 59, 63, 79)
const ORB_INNER_BG = Gradients.light[0]; // #1E0B3D purple-950 (HTML 56, 57)
const WHITE_80 = `${Colors.white}CC`; // HTML 73
const WHITE_70 = `${Colors.white}B3`; // HTML 83

const PANEL_MAX_WIDTH = 420;
const PANEL_MIN_HEIGHT = 320;
const GLOW_SIZE = 160;
const ORB_SIZE = 80;
const ORB_INNER_SIZE = 76;
const PROGRESS_MAX_WIDTH = 192;
const PROGRESS_HEIGHT = 6;
const PULSE_DURATION = 1000; // pulseGlow 2s cycle, one leg each way (HTML 29 to 35)
const RADAR_DURATION = 1000; // Tailwind animate-spin is 1s linear (HTML 59)
const RING_DURATION = 1000; // Tailwind animate-ping is 1s (HTML 63)
const DOT_DURATION = 1000; // Tailwind animate-pulse is a 2s cycle, one leg each way (HTML 68)
const SWEEP_DURATION = 1200; // indeterminate sweep, no design state
const ENTER_DURATION = 180;
const CANCEL_MIN_HEIGHT = 44;

function ProcessingGlow({ reduceMotion }: { reduceMotion: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + pulse.value * 0.3,
    transform: [{ scale: 1 + pulse.value * 0.15 }],
  }));
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.glowWrap}>
      <Animated.View style={[styles.glow, animatedStyle]} />
    </View>
  );
}

function ProcessingCrystal({ reduceMotion }: { reduceMotion: boolean }) {
  const radar = useSharedValue(0);
  const ping = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(radar);
      cancelAnimation(ping);
      radar.value = 0;
      ping.value = 0;
      return;
    }
    radar.value = withRepeat(withTiming(1, { duration: RADAR_DURATION, easing: Easing.linear }), -1, false);
    ping.value = withRepeat(withTiming(1, { duration: RING_DURATION, easing: Easing.out(Easing.ease) }), -1, false);
    return () => {
      cancelAnimation(radar);
      cancelAnimation(ping);
    };
  }, [ping, radar, reduceMotion]);
  const radarStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${radar.value * 360}deg` }] }));
  // animate-ping: scale 1 to 2 and opacity 30 percent to 0 over 1s (HTML 62 to 63).
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.3 * (1 - ping.value), transform: [{ scale: 1 + ping.value }] }));
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.orbWrap}>
      <LinearGradient colors={Gradients.light} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.orbGradient}>
        <View style={styles.orbInner}>
          <Animated.View style={[styles.radar, radarStyle]}>
            <LinearGradient colors={['transparent', `${ACCENT}4D`, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.radarBeam} />
          </Animated.View>
          <Sparkles size={28} color={Colors.white} />
        </View>
      </LinearGradient>
      <Animated.View style={[styles.ring, ringStyle]} />
    </View>
  );
}

function ContextPill({ label, reduceMotion }: { label: string; reduceMotion: boolean }) {
  const dot = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(dot);
      dot.value = 0;
      return;
    }
    dot.value = withRepeat(withTiming(1, { duration: DOT_DURATION, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(dot);
  }, [dot, reduceMotion]);
  // animate-pulse: opacity 1 to 0.5 over a 2s cycle, one leg each way (HTML 68).
  const dotStyle = useAnimatedStyle(() => ({ opacity: 1 - dot.value * 0.5 }));
  return (
    <View style={styles.pill}>
      <Animated.View pointerEvents="none" style={[styles.pillDot, dotStyle]} />
      <Text numberOfLines={1} style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

// One indicator only. Determinate when the caller supplies a real 0..1 value;
// honest indeterminate sweep when no measurable progress source exists.
function ProcessingProgress({ progress, reduceMotion }: { progress?: number; reduceMotion: boolean }) {
  const isDeterminate = typeof progress === 'number';
  const clamped = isDeterminate ? Math.min(1, Math.max(0, progress)) : 0;
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (isDeterminate) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    if (reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0.5; // static sliver, no motion
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_DURATION, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => cancelAnimation(sweep);
  }, [isDeterminate, reduceMotion, sweep]);
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (-0.5 + sweep.value * 1.5) * PROGRESS_MAX_WIDTH }],
  }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Processing progress"
      accessibilityValue={isDeterminate ? { min: 0, max: 100, now: Math.round(clamped * 100) } : undefined}
      style={styles.track}
    >
      {isDeterminate ? (
        <LinearGradient colors={[ACCENT, Colors.white]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${clamped * 100}%` }]} />
      ) : (
        <Animated.View style={[styles.sweep, sweepStyle]}>
          <LinearGradient colors={['transparent', ACCENT, Colors.white, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.radarBeam} />
        </Animated.View>
      )}
    </View>
  );
}

export interface AIProcessingSurfaceProps {
  contextLabel: string;
  title: string;
  description: string;
  /** Real 0..1 progress from the caller. Omit when no measurable source exists. */
  progress?: number;
  onCancel?: () => void;
  style?: StyleProp<ViewStyle>;
}

// Canonical overlay anatomy from the locked pair. Rendered by the production modal
// and by the dev showcase so the surface exists once.
export function AIProcessingSurface({ contextLabel, title, description, progress, onCancel, style }: AIProcessingSurfaceProps) {
  const reduceMotion = useReduceMotion();
  const pressCancel = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel?.();
  };
  return (
    <View accessibilityState={{ busy: true }} style={[styles.panel, style]}>
      <ProcessingGlow reduceMotion={reduceMotion} />
      <ProcessingCrystal reduceMotion={reduceMotion} />
      <ContextPill label={contextLabel} reduceMotion={reduceMotion} />
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <ProcessingProgress progress={progress} reduceMotion={reduceMotion} />
      {onCancel ? (
        <Pressable
          onPress={pressCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel operation"
          hitSlop={8}
          style={styles.cancel}
        >
          {({ pressed }) => <Text style={[styles.cancelLabel, pressed && styles.cancelLabelPressed]}>Cancel Operation</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

export interface AIProcessingOverlayProps {
  visible: boolean;
  contextLabel: string;
  title: string;
  description: string;
  progress?: number;
  onCancel?: () => void;
}

export function AIProcessingOverlay({ visible, contextLabel, title, description, progress, onCancel }: AIProcessingOverlayProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(opacity);
      opacity.value = visible ? 1 : 0;
      return;
    }
    opacity.value = withTiming(visible ? 1 : 0, { duration: visible ? ENTER_DURATION : 120 });
  }, [opacity, reduceMotion, visible]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: (1 - opacity.value) * 8 }],
  }));
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" accessibilityViewIsModal statusBarTranslucent onRequestClose={onCancel}>
      <Animated.View style={[styles.scrim, { backgroundColor: ts.bg.overlay }, animatedStyle]}>
        <AIProcessingSurface
          contextLabel={contextLabel}
          title={title}
          description={description}
          progress={progress}
          onCancel={onCancel}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: Spacing.s5 },
  panel: {
    width: '100%',
    maxWidth: PANEL_MAX_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: Spacing.s6,
    backgroundColor: PANEL_BG,
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 12,
  },
  glowWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.xl, overflow: 'hidden' },
  glow: { width: GLOW_SIZE, height: GLOW_SIZE, borderRadius: Radii.full, backgroundColor: `${LightTheme.primary}66`, shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 60 },
  orbWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.s4 },
  orbGradient: { width: ORB_SIZE, height: ORB_SIZE, borderRadius: Radii.full, padding: 2, alignItems: 'center', justifyContent: 'center', shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 8 },
  orbInner: { width: ORB_INNER_SIZE, height: ORB_INNER_SIZE, borderRadius: Radii.full, backgroundColor: ORB_INNER_BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  radar: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  radarBeam: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: Radii.full, borderWidth: 1, borderColor: `${ACCENT}80` },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: Spacing.s1 + 2, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.full, backgroundColor: PILL_BG, borderWidth: 1, borderColor: PILL_BORDER, marginBottom: Spacing.s2, maxWidth: '100%' },
  pillDot: { width: 8, height: 8, borderRadius: Radii.full, backgroundColor: Colors.success },
  pillLabel: { ...Typography.micro, fontFamily: 'Manrope_600SemiBold', color: Colors.white, flexShrink: 1 },
  title: { ...Typography.headlineMd, color: Colors.white, textAlign: 'center', marginBottom: Spacing.s1 },
  description: { ...Typography.bodyRegular, color: WHITE_80, textAlign: 'center', maxWidth: 240, marginBottom: Spacing.s4 },
  track: { width: '100%', maxWidth: PROGRESS_MAX_WIDTH, height: PROGRESS_HEIGHT, borderRadius: Radii.full, backgroundColor: TRACK_BG, overflow: 'hidden', alignSelf: 'center', marginBottom: Spacing.s3 },
  fill: { height: '100%', borderRadius: Radii.full },
  sweep: { position: 'absolute', top: 0, left: 0, width: PROGRESS_MAX_WIDTH * 0.4, height: '100%', borderRadius: Radii.full, overflow: 'hidden' },
  cancel: { minHeight: CANCEL_MIN_HEIGHT, justifyContent: 'center', paddingHorizontal: Spacing.s3 },
  cancelLabel: { ...Typography.labelMd, color: WHITE_70, textDecorationLine: 'underline' },
  cancelLabelPressed: { color: Colors.white },
});
