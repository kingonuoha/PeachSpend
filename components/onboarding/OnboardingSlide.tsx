import React, { useEffect } from 'react';
import { View, Text, useWindowDimensions, Image, ImageSourcePropType } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, SharedValue } from 'react-native-reanimated';

interface OnboardingSlideProps {
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
}

export const OnboardingSlide: React.FC<OnboardingSlideProps> = ({ title, subtitle, image }) => {
  const { width } = useWindowDimensions();
  const imageOpacity = useSharedValue(0);
  const imageTranslate = useSharedValue(20);
  const titleOpacity = useSharedValue(0);
  const titleTranslate = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const subtitleTranslate = useSharedValue(20);

  useEffect(() => {
    const animate = (opacity: SharedValue<number>, translate: SharedValue<number>, delay: number) => {
      opacity.value = withDelay(delay, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
      translate.value = withDelay(delay, withTiming(0, { duration: 800, easing: Easing.out(Easing.cubic) }));
    };

    animate(imageOpacity, imageTranslate, 200);
    animate(titleOpacity, titleTranslate, 400);
    animate(subtitleOpacity, subtitleTranslate, 560);
  }, []);

  const imageStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
    transform: [{ translateY: imageTranslate.value }],
    marginBottom: 48,
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslate.value }],
    marginBottom: 24,
  }));

  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleTranslate.value }],
  }));

  return (
    <View style={{ width }} className="flex-1 items-center justify-center px-8">
      <Animated.View style={imageStyle}>
        <Image
          source={image}
          style={{ width: width * 0.7, height: width * 0.7 }}
          resizeMode="contain"
        />
      </Animated.View>

      <Animated.View style={titleStyle}>
        <Text className="text-4xl text-center text-onSurface font-noto-serif-bold">
          {title}
        </Text>
      </Animated.View>

      <Animated.View style={subtitleStyle}>
        <Text className="text-lg text-center text-onSurfaceVariant font-manrope-regular">
          {subtitle}
        </Text>
      </Animated.View>
    </View>
  );
};
