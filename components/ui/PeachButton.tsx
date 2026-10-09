import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  StyleProp,
  ViewStyle,
  TextStyle,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { DarkTheme, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';

import { cssInterop } from 'react-native-css-interop';

type PeachButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'disabled' | 'neutral' | 'quiet';
type PeachButtonSize = 'xl' | 'lg' | 'md' | 'sm' | 'xs';
type PeachButtonTone = 'auto' | 'light' | 'dark';

interface PeachButtonProps {
  title: string;
  onPress: () => void;
  variant?: PeachButtonVariant;
  size?: PeachButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  tone?: PeachButtonTone;
  className?: string;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
  // Trailing icon renders after the label. Used where the canonical pair places
  // the affordance on the right (for example the S-01 Next chevron).
  trailingIcon?: React.ReactNode;
  // Optional corner override. Defaults to the shared full-pill shape; a screen
  // whose canonical pair uses a smaller radius passes the value instead of
  // forking the button.
  radius?: number;
  // Optional gradient override for pairs that ship their own 3-stop brand
  // gradient. Defaults to the shared Gradients pair.
  gradientColors?: readonly [string, string, ...string[]];
  // Lets a dynamic label (for example S-09's "Save Expense (<amount>)") shrink
  // to stay on one line on narrow widths instead of ellipsizing. Off by default
  // so every other button keeps its fixed label size.
  adjustsLabelFontSize?: boolean;
  // Optional label override for a pair whose canonical button keeps the surface
  // fill but uses the brand purple label (for example S-23's dismiss pill).
  // Defaults to the variant's palette colour so every other button is unchanged.
  labelColor?: string;
  // Optional accessibility label when the visible title is repeated across a
  // list (for example S-16's per-category Edit). Defaults to the title.
  accessibilityLabel?: string;
}

const PRESS_SCALE = 0.97;
const PRESS_DURATION = 150;
const SPINNER_SIZE = 20;
// Minimum touch target in points. Short buttons keep their visual height and
// earn the remainder through hitSlop so the design intent survives.
const MIN_TOUCH_TARGET = 44;
const TOUCH_HIT_SLOP = { top: 2, bottom: 2 };

// CSS 160deg gradient expressed as unit start/end points for expo-linear-gradient.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];

interface SizePreset {
  minHeight: number;
  padH: number;
  text: TextStyle;
}

const SIZES: Record<PeachButtonSize, SizePreset> = {
  // xl is the onboarding 52px pill from the canonical S-01 pair.
  xl: { minHeight: 52, padH: Spacing.s6, text: Typography.bodyBold },
  lg: { minHeight: 50, padH: Spacing.s6, text: Typography.bodyBold },
  md: { minHeight: 46, padH: Spacing.s6, text: Typography.labelBold },
  sm: { minHeight: 42, padH: Spacing.s5, text: Typography.labelBold },
  xs: { minHeight: 42, padH: Spacing.s4, text: Typography.captionBold },
};

// Tracks the OS reduce-motion setting so press scale and spinner rotation can
// be suppressed without adding a second motion implementation.
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

function ButtonSpinner({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const spin = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (reduceMotion) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        // Tailwind animate-spin is 1s linear infinite.
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, reduceMotion]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]}>
      <Svg width={SPINNER_SIZE} height={SPINNER_SIZE} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={3} strokeOpacity={0.25} />
        <Path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill={color} fillOpacity={0.75} />
      </Svg>
    </Animated.View>
  );
}

export const PeachButton: React.FC<PeachButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'sm',
  fullWidth = false,
  isLoading = false,
  disabled = false,
  tone = 'auto',
  className = '',
  style,
  icon,
  trailingIcon,
  radius,
  gradientColors,
  adjustsLabelFontSize = false,
  labelColor,
  accessibilityLabel,
}) => {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const scale = useState(() => new Animated.Value(1))[0];
  const [isPressed, setPressed] = useState(false);

  const preset = SIZES[size];
  const minHeight = Math.max(preset.minHeight, MIN_TOUCH_TARGET);
  const isDisabledVariant = variant === 'disabled';
  const isInteractive = !disabled && !isDisabledVariant && !isLoading;

  // Destructive and disabled content-width buttons use px-4 (16) in the design,
  // primary and secondary use px-5 (20).
  const compactPad = variant === 'destructive' || variant === 'disabled';
  const padH = compactPad ? Math.min(preset.padH, Spacing.s4) : preset.padH;
  // Destructive icon rows use gap-1 (4), other icon rows use gap-1.5 (6) mapped
  // to the nearest spacing token.
  const iconGap = variant === 'destructive' ? Spacing.s1 : Spacing.s2;

  const isDark = tone === 'auto' ? ts.isDark : tone === 'dark';
  const raw = isDark ? DarkTheme : LightTheme;
  const gradient = gradientColors ?? (isDark ? Gradients.dark : Gradients.light);
  const cornerRadius = radius ?? Radii.full;

  const pressedBackground = !isDark && (variant === 'secondary' || variant === 'ghost')
    ? LightTheme.secondaryPressed
    : undefined;

  const palette: Record<PeachButtonVariant, { background: string; text: string }> = {
    primary: { background: 'transparent', text: '#FFFFFF' },
    secondary: { background: raw.purple100, text: raw.primary },
    ghost: { background: raw.purple100, text: raw.primary },
    // Canonical S-01 equal-weight skip: surface fill with a purple border,
    // overriding the design-system ghost per DEC-02.
    outline: { background: raw.surface, text: raw.onSurface },
    destructive: { background: raw.dangerSoft, text: raw.danger },
    // SH-NEW-a neutral secondary: elevated gray fill with a card border. Used by
    // the auto-capture sheet's Discard Safe and Back to Summary actions.
    neutral: { background: raw.surfaceContainerHighest, text: raw.onSurface },
    // S-09 pair Cancel: surface fill, hairline card border, secondary label. The
    // lowest-emphasis action in a two-button row, distinct from `neutral`.
    quiet: { background: raw.surface, text: raw.onSurfaceVariant },
    disabled: { background: raw.disabledBg, text: raw.disabledText },
  };
  const colors = palette[variant];

  const isGradient = variant === 'primary' && !isDisabledVariant;
  const isOutline = variant === 'outline';
  const isNeutral = variant === 'neutral';
  const isQuiet = variant === 'quiet';
  const textColor = colors.text;
  const background = isGradient
    ? 'transparent'
    : isPressed && pressedBackground
      ? pressedBackground
      : colors.background;

  const animateScale = (toValue: number) => {
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

  const handlePress = () => {
    if (!isInteractive) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const handlePressIn = () => {
    setPressed(true);
    if (isInteractive) animateScale(PRESS_SCALE);
  };

  const handlePressOut = () => {
    setPressed(false);
    animateScale(1);
  };

  const shadowStyle = isGradient
    ? {
        shadowColor: raw.primary,
        shadowOffset: { width: 0, height: isDark ? 0 : 4 },
        shadowOpacity: isDark ? 0.35 : 0.12,
        shadowRadius: isDark ? 16 : 12,
        elevation: isDark ? 0 : 3,
      }
    : {};

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !isInteractive, busy: isLoading }}
      accessibilityLabel={accessibilityLabel ?? title}
      hitSlop={TOUCH_HIT_SLOP}
      className={className}
      style={[
        styles.container,
        { minHeight, borderRadius: cornerRadius },
        fullWidth ? styles.fullWidth : styles.contentWidth,
        shadowStyle,
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            minHeight,
            borderRadius: cornerRadius,
            backgroundColor: background,
            paddingHorizontal: padH,
            opacity: isLoading ? 0.9 : 1,
            // Canonical S-01 skip outline is 1.5px purple-600 (purple-400 dark).
            ...(isOutline ? { borderWidth: 1.5, borderColor: raw.primaryBorder } : null),
            // SH-NEW-a neutral actions carry a 1px card hairline over the gray fill.
            ...(isNeutral ? { borderWidth: 1, borderColor: raw.outline } : null),
            // S-09 quiet Cancel carries a 1px card hairline over the surface fill.
            ...(isQuiet ? { borderWidth: 1, borderColor: raw.outline } : null),
          },
          { transform: [{ scale }] },
        ]}
      >
        {isGradient ? (
          <LinearGradient
            colors={gradient}
            locations={GRADIENT_LOCATIONS}
            start={GRADIENT_START}
            end={GRADIENT_END}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {isLoading ? <ButtonSpinner color={textColor} reduceMotion={reduceMotion} /> : icon ? <View style={[styles.icon, { marginRight: iconGap }]}>{icon}</View> : null}
        <Text
          style={[preset.text, { color: labelColor ?? textColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit={adjustsLabelFontSize}
          minimumFontScale={adjustsLabelFontSize ? 0.7 : undefined}
        >
          {title}
        </Text>
        {!isLoading && trailingIcon ? (
          <View style={[styles.icon, { marginLeft: iconGap }]}>{trailingIcon}</View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  contentWidth: {
    alignSelf: 'flex-start',
  },
  fill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginRight: Spacing.s2,
  },
});

cssInterop(PeachButton, {
  className: 'style',
});
