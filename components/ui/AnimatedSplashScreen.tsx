import React, { useEffect } from 'react';
import { View, Text, Image, Dimensions, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Colors, LightTheme, Spacing } from '../../constants/tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOGO_SIZE = 150;
const GHOST_LOGO_SIZE = SCREEN_HEIGHT * 1.4;
const CIRCLE_START_SIZE = 120;

// Horizontal gutter between the wordmark block and the window edge, taken from
// the spacing token scale.
const TEXT_BLOCK_GUTTER = Spacing.s6;

// The wordmark and the tagline are brand lockup text, so the OS text scale is
// capped. 1.2 is the largest cap that keeps the title inside the block at the
// narrowest supported window. The title is one unbreakable 10 character word and
// measures 190.7px at scale 1.0, 229.9px at 1.2, 249.4px at 1.3, and 286.1px at
// 1.5 against 272px of available width at a 320px window with both gutters
// removed, so 1.2 keeps a margin and 1.5 would overflow.
const TEXT_BLOCK_MAX_FONT_SCALE = 1.2;

// The splash surface is one fixed brand purple in light, dark, and across every
// theme pack (DEC-B06), so it reads the locked light-theme primary token rather
// than a fresh literal (DEC-B05). Content on a purple surface is white, and the
// tagline label sits at 70 percent, per the design system contrast rule.
const SPLASH_BRAND_PURPLE = LightTheme.primary;
const SPLASH_ON_BRAND = Colors.onPrimary;
const SPLASH_LABEL_COLOR = 'rgba(255, 255, 255, 0.7)';

interface AnimatedSplashScreenProps {
  onFinish: () => void;
}

export default function AnimatedSplashScreen({ onFinish }: AnimatedSplashScreenProps) {
  const { width: windowWidth } = useWindowDimensions();
  // The block width is derived from the window, never from the text measurement,
  // so the layout cannot drift when the custom fonts load after the first paint
  // or when the platform measures letter spaced text differently from the way it
  // paints it. Clamped at zero so a degenerate window cannot yield a negative
  // width; at every real window the block is window minus two gutters.
  const textBlockWidth = Math.max(0, windowWidth - TEXT_BLOCK_GUTTER * 2);

  const logoScale = useSharedValue(0);
  const logoTranslateY = useSharedValue(50);
  const circleScale = useSharedValue(0);
  const circleOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(20);

  useEffect(() => {
    logoScale.value = withSpring(1, { damping: 12, stiffness: 100 });
    logoTranslateY.value = withSpring(0, { damping: 12, stiffness: 100 });

    circleScale.value = withDelay(
      600,
      withTiming(30, { duration: 1000, easing: Easing.out(Easing.cubic) })
    );
    circleOpacity.value = withDelay(
      600,
      withTiming(1, { duration: 800 })
    );

    textOpacity.value = withDelay(
      1600,
      withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) })
    );
    textTranslateY.value = withDelay(
      1600,
      withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })
    );

    const timer = setTimeout(() => {
      runOnJS(onFinish)();
    }, 8000);

    return () => clearTimeout(timer);
  }, [logoScale, logoTranslateY, circleScale, circleOpacity, textOpacity, textTranslateY, onFinish]);

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: logoScale.value },
      { translateY: logoTranslateY.value },
    ],
  }));

  const circleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
    opacity: circleOpacity.value,
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.background} />

      <Animated.View style={[styles.circle, circleAnimatedStyle]} />

      <Image
        source={require('../../assets/images/splash-logo-full.png')}
        style={styles.ghostLogo}
        tintColor={SPLASH_ON_BRAND}
        resizeMode="contain"
      />

      <Animated.Image
        source={require('../../assets/images/splash-logo-full.png')}
        style={[styles.logo, logoAnimatedStyle]}
        tintColor={SPLASH_ON_BRAND}
        resizeMode="contain"
      />

      <Animated.View style={[styles.textContainer, { width: textBlockWidth }, textAnimatedStyle]}>
        <Text style={styles.title} maxFontSizeMultiplier={TEXT_BLOCK_MAX_FONT_SCALE}>
          PeachSpend
        </Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={TEXT_BLOCK_MAX_FONT_SCALE}>
          Peach of mind for your spendings
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SPLASH_BRAND_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  background: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SPLASH_BRAND_PURPLE,
  },
  circle: {
    position: 'absolute',
    width: CIRCLE_START_SIZE,
    height: CIRCLE_START_SIZE,
    borderRadius: CIRCLE_START_SIZE / 2,
    backgroundColor: SPLASH_BRAND_PURPLE,
    left: SCREEN_WIDTH / 2 - CIRCLE_START_SIZE / 2,
    top: SCREEN_HEIGHT / 2 - CIRCLE_START_SIZE / 2,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    zIndex: 10,
  },
  ghostLogo: {
    position: 'absolute',
    width: GHOST_LOGO_SIZE,
    height: GHOST_LOGO_SIZE,
    top: -GHOST_LOGO_SIZE * 0.15,
    left: -GHOST_LOGO_SIZE * 0.15,
    opacity: 0.12,
  },
  textContainer: {
    position: 'absolute',
    // Explicit left edge plus the window derived width centres the block by
    // geometry rather than by the parent centring a shrink wrapped measurement.
    left: TEXT_BLOCK_GUTTER,
    bottom: SCREEN_HEIGHT * 0.32,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'NotoSerif_700Bold',
    fontSize: 32,
    color: SPLASH_ON_BRAND,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: SPLASH_LABEL_COLOR,
    marginTop: 4,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    // No numberOfLines and no shrink rule: when the width cannot hold the
    // letter spaced line it wraps to a second centred line, which keeps the
    // locked 13px size and 4px tracking. The longest single word is 120px at
    // the cap, well inside the narrowest block of 272px.
  },
});
