import React, { useEffect } from 'react';
import { StyleSheet, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radii } from '../../constants/tokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';

// One leg each way of a slow, shallow opacity cycle. The design system rules out an
// aggressive shimmer (mobile-design motion-haptics, "do not shimmer aggressively"),
// so a screenful of placeholders reads as loading without strobing.
const PULSE_DURATION = 900;
const PULSE_MIN_OPACITY = 0.5;
const PULSE_MAX_OPACITY = 1;

export interface SkeletonProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

// Shared neutral loading placeholder. Exists once so every skeleton surface uses the
// same pulse, the same UI thread, and the same reduce-motion fallback instead of a
// per-screen copy. Color comes from the active theme tokens, never a raw palette value.
export function Skeleton({ width, height, borderRadius = Radii.sm, style }: SkeletonProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(PULSE_MAX_OPACITY);

  useEffect(() => {
    if (reduceMotion) {
      // Static block: no pulse when the platform asks for reduced motion.
      cancelAnimation(pulse);
      pulse.set(PULSE_MAX_OPACITY);
      return;
    }
    pulse.set(
      withRepeat(
        withTiming(PULSE_MIN_OPACITY, {
          duration: PULSE_DURATION,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  // Only opacity animates, on the UI thread. Width, height and radius stay static so
  // the block never re-runs layout while it pulses.
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        { width, height, borderRadius, backgroundColor: ts.bg.elevated },
        reduceMotion ? null : pulseStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
});
