import React, { useEffect } from 'react';
import { View, Text, Image, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOGO_SIZE = 150;
const GHOST_LOGO_SIZE = SCREEN_HEIGHT * 1.4;
const CIRCLE_START_SIZE = 120;

interface AnimatedSplashScreenProps {
  onFinish: () => void;
}

export default function AnimatedSplashScreen({ onFinish }: AnimatedSplashScreenProps) {
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
  }, []);

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
        resizeMode="contain"
      />

      <Animated.Image
        source={require('../../assets/images/splash-logo-full.png')}
        style={[styles.logo, logoAnimatedStyle]}
        resizeMode="contain"
      />

      <Animated.View style={[styles.textContainer, textAnimatedStyle]}>
        <Text style={styles.title}>PeachSpend</Text>
        <Text style={styles.subtitle}>Peach of mind for your spendings</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
  circle: {
    position: 'absolute',
    width: CIRCLE_START_SIZE,
    height: CIRCLE_START_SIZE,
    borderRadius: CIRCLE_START_SIZE / 2,
    backgroundColor: '#FFD2C4',
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
    bottom: SCREEN_HEIGHT * 0.32,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'NotoSerif_700Bold',
    fontSize: 32,
    color: '#1F1B1A',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#85736E',
    marginTop: 4,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
});
