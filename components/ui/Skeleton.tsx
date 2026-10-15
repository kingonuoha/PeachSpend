import React, { useEffect } from 'react';
import {
  StyleSheet,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { Radii } from '../../constants/tokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';

// Two loading signals ship together (DEC-B19): a gentle opacity breathe and one
// low-contrast sheen pass, so the block reads as loading even if the eye catches only
// one of them. The original breathe floor of 0.5 was shallow enough to read as a
// static block on device, so it is gentler and slower here and the sheen carries the
// second signal.
const PULSE_DURATION = 1200;
const PULSE_MIN_OPACITY = 0.75;
const PULSE_MAX_OPACITY = 1;

// Reduce motion drops the sweep (DEC-B21), because the sweep is translation, and keeps
// a gentler indication of the same kind instead of the previous hard stop at full
// opacity, per POLISH.md Section 4.
const PULSE_REDUCED_DURATION = 1600;
const PULSE_REDUCED_MIN_OPACITY = 0.85;

// One sheen pass, then a pause before the next (DEC-B20), so a screenful of
// placeholders does not read as a progress bar that should have finished. A loading
// loop is not interaction motion, so the period is chosen for readability: 1000ms to
// cross, then 800ms of stillness.
const SHEEN_SWEEP_DURATION = 1000;
const SHEEN_PAUSE_DURATION = 800;

// Band width as a fraction of the block, so the sweep stays fluid at every width the
// call sites pass, both fixed numbers and percentages. The gradient fades to
// transparent at both ends, so the sweep has no hard leading edge.
const SHEEN_BAND_WIDTH_RATIO = 0.4;
const SHEEN_BAND_WIDTH = `${SHEEN_BAND_WIDTH_RATIO * 100}%` as DimensionValue;

export interface SkeletonProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

// Shared neutral loading placeholder. Exists once so every skeleton surface uses the
// same breathe, the same UI-thread sheen, and the same reduce-motion fallback instead
// of a per-screen copy. Color comes from the active theme tokens, never a raw palette
// value.
export function Skeleton({ width, height, borderRadius = Radii.sm, style }: SkeletonProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(PULSE_MAX_OPACITY);
  const sweep = useSharedValue(0);
  // Measured block width, written from onLayout so the sweep can resolve a percentage
  // width without a React re-render and without moving layout.
  const blockWidth = useSharedValue(0);

  useEffect(() => {
    const duration = reduceMotion ? PULSE_REDUCED_DURATION : PULSE_DURATION;
    const min = reduceMotion ? PULSE_REDUCED_MIN_OPACITY : PULSE_MIN_OPACITY;
    pulse.set(withRepeat(withTiming(min, { duration, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(sweep);
      sweep.set(0);
      return;
    }
    sweep.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: SHEEN_SWEEP_DURATION, easing: Easing.inOut(Easing.ease) }),
          // Hold at the end of the pass, then jump back to the start while the band is
          // still invisible, so the pause never shows a reset.
          withDelay(SHEEN_PAUSE_DURATION, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(sweep);
  }, [sweep, reduceMotion]);

  const handleLayout = (event: LayoutChangeEvent) => {
    blockWidth.set(event.nativeEvent.layout.width);
  };

  // Only opacity animates on the block. Width, height and radius stay static so the
  // block never re-runs layout while it breathes.
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  // Only transform and opacity animate on the band, both on the UI thread. The band
  // travels from just off the left edge to just off the right edge, and its opacity
  // peaks mid-crossing, so neither end of the pass shows a pop.
  const sheenStyle = useAnimatedStyle(() => {
    const measuredWidth = blockWidth.get();
    const bandWidth = measuredWidth * SHEEN_BAND_WIDTH_RATIO;
    const progress = sweep.get();
    return {
      opacity: Math.sin(progress * Math.PI),
      transform: [{ translateX: -bandWidth + progress * (measuredWidth + bandWidth) }],
    };
  });

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={handleLayout}
      style={[
        styles.base,
        { width, height, borderRadius, backgroundColor: ts.bg.elevated },
        pulseStyle,
        style,
      ]}
    >
      {reduceMotion ? null : (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.sheen, sheenStyle]}
        >
          <LinearGradient
            colors={['transparent', ts.bg.white10, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  // Absolutely positioned, content-less, and never the target of a layout animation.
  sheen: { position: 'absolute', top: 0, bottom: 0, left: 0, width: SHEEN_BAND_WIDTH },
});
