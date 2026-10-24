import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  Dimensions,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextLayoutEvent,
} from 'react-native';
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
// theme pack (DEC-B06), so it reads a locked light-theme token rather than a
// fresh literal (DEC-B05). This fill is the lighter primary container shade: the
// accent circle below grows to cover the viewport, so the circle, not this fill,
// is the surface the text is finally read against (DEC-B38).
const SPLASH_BRAND_PURPLE = LightTheme.primaryContainer;
const SPLASH_ON_BRAND = Colors.onPrimary;

// The accent circle carries the brand primary, the darker of the two shades
// (DEC-B38). Because it covers the viewport as it scales it is the settled
// surface, so it is the fill the tagline contrast is measured against. The two
// fills keep the same separation DEC-B35 introduced, now read the other way
// round, so the expanding accent stays visible against the surface. Same token
// access pattern as the surface above; no new hex. The tagline is full white
// rather than the 70 percent label treatment, a splash only departure from the
// design system label rule taken because the tagline is the only text on the
// screen (DEC-B38).
const SPLASH_ACCENT_CIRCLE = LightTheme.primary;

// The block's top edge is pinned at the y a one line tagline occupies, so a
// wrapped second line grows downward into empty space instead of upward into
// the mark above it (BUG-09-06). That y is derived from the block's measured
// height at the running OS text scale; this constant is only the
// pre-measurement fallback, the title line box plus the tagline margin plus one
// tagline line box at the base scale.
const TEXT_BLOCK_DESIGN_HEIGHT = 66;

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

  // The block's rendered height and the tagline's own line metrics are measured
  // so its one line height can be recovered at any OS text scale: any wrapped
  // extra lines are subtracted from the block height. Anchoring the top edge at
  // that one line height keeps the block in place when the tagline is one line
  // and lets it grow downward when it is two.
  const [blockHeight, setBlockHeight] = useState(0);
  const [taglineLineHeight, setTaglineLineHeight] = useState(0);
  const [taglineLineCount, setTaglineLineCount] = useState(1);

  const handleBlockLayout = useCallback((event: LayoutChangeEvent) => {
    setBlockHeight(event.nativeEvent.layout.height);
  }, []);

  const handleTaglineLayout = useCallback((event: TextLayoutEvent) => {
    const lines = event.nativeEvent.lines;
    if (lines.length > 0) {
      setTaglineLineHeight(lines[0].height);
      setTaglineLineCount(lines.length);
    }
  }, []);

  const wrappedExtraHeight =
    taglineLineCount > 1 ? (taglineLineCount - 1) * taglineLineHeight : 0;
  const oneLineBlockHeight =
    blockHeight > 0 ? blockHeight - wrappedExtraHeight : TEXT_BLOCK_DESIGN_HEIGHT;
  // bottom: SCREEN_HEIGHT * 0.32 places the block's bottom at 0.68 of the
  // window; pinning the top there for a one line block reproduces that position
  // exactly and extends downward once the tagline wraps.
  const textBlockTop = SCREEN_HEIGHT * 0.68 - oneLineBlockHeight;

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
    }, 2400);

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

      <Animated.View
        style={[styles.textContainer, { width: textBlockWidth, top: textBlockTop }, textAnimatedStyle]}
        onLayout={handleBlockLayout}
      >
        <Text style={styles.title} maxFontSizeMultiplier={TEXT_BLOCK_MAX_FONT_SCALE}>
          PeachSpend
        </Text>
        <Text
          style={styles.subtitle}
          maxFontSizeMultiplier={TEXT_BLOCK_MAX_FONT_SCALE}
          onTextLayout={handleTaglineLayout}
        >
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
    backgroundColor: SPLASH_ACCENT_CIRCLE,
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
    // The vertical edge is the top, applied inline from the measured one line
    // height, so the block stays put when the tagline is one line and grows
    // downward into empty space when it is two.
    left: TEXT_BLOCK_GUTTER,
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
    color: SPLASH_ON_BRAND,
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
