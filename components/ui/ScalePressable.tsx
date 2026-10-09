import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

// Shared press primitive for custom (non-PeachButton) touch surfaces. The S-02
// canonical pair applies a `tap-bounce` scale(0.96) over 150ms to every
// interactive surface, so cards, chips and icon controls use the same motion
// instead of forking a pressed treatment per screen.
const PRESS_SCALE = 0.96;
const PRESS_DURATION = 150;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Mirrors PeachButton's reduce-motion handling so a device with "reduce motion"
// on gets the press without the scale animation.
function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export interface ScalePressableProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // Light haptic on press, matching the app-wide button convention. Disable for
  // surfaces where the OS already gives feedback.
  haptic?: boolean;
}

export const ScalePressable: React.FC<ScalePressableProps> = ({
  children,
  style,
  haptic = true,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}) => {
  const reduceMotion = useReduceMotion();
  const scale = useState(() => new Animated.Value(1))[0];

  const animate = (toValue: number) => {
    if (reduceMotion) {
      scale.setValue(toValue);
      return;
    }
    Animated.timing(scale, {
      toValue,
      duration: PRESS_DURATION,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        animate(PRESS_SCALE);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
};
