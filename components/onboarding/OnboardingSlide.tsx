import React from 'react';
import { View, Text, useWindowDimensions, Image, ImageSourcePropType } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';


interface OnboardingSlideProps {
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
}

export const OnboardingSlide: React.FC<OnboardingSlideProps> = ({
  title,
  subtitle,
  image,
}) => {
  const { width } = useWindowDimensions();

  return (
    <View style={{ width }} className="flex-1 items-center justify-center px-8">
      <Animated.View entering={FadeInUp.delay(200).duration(800)} className="mb-12">
        <Image 
          source={image} 
          style={{ width: width * 0.7, height: width * 0.7 }} 
          resizeMode="contain"
        />
      </Animated.View>
      
      <Animated.View 
        entering={FadeInUp.delay(400).duration(800)}
        className="mb-6"
      >
        <Text className="text-4xl text-center text-onSurface font-noto-serif-bold">
          {title}
        </Text>
      </Animated.View>
      
      <Animated.View 
        entering={FadeInUp.delay(160).duration(500)}
      >
        <Text className="text-lg text-center text-onSurfaceVariant font-manrope-regular">
          {subtitle}
        </Text>
      </Animated.View>
    </View>
  );
};
