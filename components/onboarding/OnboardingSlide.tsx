import React, { useEffect } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { BarChart3, Check, ScanLine, Zap } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Radii, Spacing, Typography } from '../../constants/tokens';

interface OnboardingSlideProps {
  title: string;
  subtitle: string;
  slideNumber: 1 | 2 | 3;
  // Enter motion replays each time this slide becomes the active page, matching
  // the canonical transition-on-activation. Off-screen slides stay hidden.
  active: boolean;
}

// Canonical S-01 enter motion: opacity 220ms and translateX 50 to 0 over 240ms
// cubic-bezier(0.16, 1, 0.3, 1). Title and description stagger after the
// illustration. All values are fluid with min and max bounds.
const ENTER_EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ENTER_DURATION = 240;
const ILLUSTRATION_MIN = 190;
const ILLUSTRATION_MAX = 250;

export const OnboardingSlide: React.FC<OnboardingSlideProps> = ({ title, subtitle, slideNumber, active }) => {
  const { width } = useWindowDimensions();
  const theme = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const illustrationProgress = useSharedValue(0);
  const titleProgress = useSharedValue(0);
  const subtitleProgress = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    if (reduceMotion) {
      illustrationProgress.value = 1;
      titleProgress.value = 1;
      subtitleProgress.value = 1;
      return;
    }
    const enter = (progress: SharedValue<number>, delay: number) => {
      progress.value = 0;
      progress.value = withDelay(delay, withTiming(1, { duration: ENTER_DURATION, easing: ENTER_EASE }));
    };
    enter(illustrationProgress, 40);
    enter(titleProgress, 140);
    enter(subtitleProgress, 220);
  }, [active, illustrationProgress, reduceMotion, subtitleProgress, titleProgress]);

  const illustrationStyle = useAnimatedStyle(() => ({
    opacity: illustrationProgress.value,
    transform: [{ translateX: 50 * (1 - illustrationProgress.value) }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleProgress.value,
    transform: [{ translateX: 50 * (1 - titleProgress.value) }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleProgress.value,
    transform: [{ translateX: 50 * (1 - subtitleProgress.value) }],
  }));

  const illustrationSize = Math.min(Math.max(width * 0.64, ILLUSTRATION_MIN), ILLUSTRATION_MAX);
  const titleFontSize = width >= 430 ? 27 : width < 360 ? 23 : 26;
  const copyMaxWidth = Math.min(width - Spacing.s6 * 2, 320);

  return (
    <View style={{ width, flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: Spacing.s6, paddingTop: Spacing.s4, paddingBottom: Spacing.s5, alignItems: 'center', justifyContent: 'flex-start' }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[illustrationStyle, { marginBottom: Spacing.s5 }]}
          accessible
          accessibilityLabel={`${title} illustration`}
        >
          <Illustration slideNumber={slideNumber} size={illustrationSize} />
        </Animated.View>
        <Animated.View style={[titleStyle, { width: '100%', alignItems: 'center', marginBottom: Spacing.s2 }]}>
          <Text
            allowFontScaling
            style={[Typography.headlineLg, { fontSize: titleFontSize, color: theme.text.onSurface, textAlign: 'center', maxWidth: copyMaxWidth }]}
          >
            {title}
          </Text>
        </Animated.View>
        <Animated.View style={subtitleStyle}>
          <Text
            allowFontScaling
            style={[Typography.bodyMd, { color: theme.text.onSurfaceVariant, textAlign: 'center', maxWidth: copyMaxWidth }]}
          >
            {subtitle}
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

function Illustration({ slideNumber, size }: { slideNumber: 1 | 2 | 3; size: number }) {
  const theme = useThemeStyles();
  const cardWidth = size * 0.76;
  const cardHeight = size * 0.85;

  return (
    <View style={{ width: size, height: size * 0.92, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size * 0.72, height: size * 0.72, borderRadius: Radii.full, backgroundColor: theme.bg.primary20 }} />
      <View
        style={{
          width: cardWidth,
          height: cardHeight,
          borderRadius: Radii.xl,
          backgroundColor: theme.bg.surface,
          borderWidth: 1,
          borderColor: theme.border.card,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: theme.raw.primary,
          shadowOpacity: theme.isDark ? 0.35 : 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: theme.isDark ? 0 : 8,
        }}
      >
        {slideNumber === 1 && <SpeedMeter theme={theme} cardWidth={cardWidth} />}
        {slideNumber === 2 && <TrendBars theme={theme} />}
        {slideNumber === 3 && <ScanBubble theme={theme} />}
      </View>
    </View>
  );
}

// Slide 1 metric ring with a bolt, matching the speed-meter graphic.
function SpeedMeter({ theme, cardWidth }: { theme: ReturnType<typeof useThemeStyles>; cardWidth: number }) {
  const ring = cardWidth * 0.6;
  return (
    <View style={{ width: ring, height: ring, borderRadius: Radii.full, borderWidth: 8, borderColor: theme.bg.primary20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: ring * 0.56, height: ring * 0.56, borderRadius: Radii.full, backgroundColor: theme.raw.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Zap color={theme.text.white} size={Math.round(ring * 0.34)} />
      </View>
    </View>
  );
}

// Slide 2 two-tone trend bars with an insight badge, Von Restorff emphasis.
function TrendBars({ theme }: { theme: ReturnType<typeof useThemeStyles> }) {
  const bars = [42, 64, 30, 78, 56, 86];
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 92 }}>
        {bars.map((height, index) => (
          <View
            key={index}
            style={{ width: 14, height, borderRadius: 5, backgroundColor: index === bars.length - 1 ? theme.raw.primaryContainer : index % 2 === 0 ? theme.raw.primary : theme.bg.primary20 }}
          />
        ))}
        <BarChart3 color={theme.raw.primary} size={24} style={{ position: 'absolute', top: -10, right: -6 }} />
      </View>
    </View>
  );
}

// Slide 3 OCR viewfinder plus parsed receipt chip, matching the scan graphic.
function ScanBubble({ theme }: { theme: ReturnType<typeof useThemeStyles> }) {
  return (
    <View style={{ alignItems: 'center', gap: 16, width: '100%' }}>
      <View style={{ width: '78%', height: 76, borderRadius: Radii.md, backgroundColor: theme.bg.primary10, borderWidth: 2, borderColor: theme.raw.primary, alignItems: 'center', justifyContent: 'center' }}>
        <ScanLine color={theme.raw.primary} size={38} />
      </View>
      <View style={{ width: '78%', height: 38, borderRadius: Radii.full, backgroundColor: theme.bg.surface, borderWidth: 1, borderColor: theme.border.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: Radii.full, backgroundColor: theme.raw.success, alignItems: 'center', justifyContent: 'center' }}>
          <Check color={theme.text.white} size={13} />
        </View>
        <Text style={{ color: theme.text.onSurface, ...Typography.labelMd }}>Receipt parsed!</Text>
      </View>
    </View>
  );
}
