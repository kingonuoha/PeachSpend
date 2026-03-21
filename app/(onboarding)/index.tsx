import React, { useState, useRef } from 'react';
import { View, FlatList, useWindowDimensions, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingSlide } from '../../components/onboarding/OnboardingSlide';
import { PeachButton } from '../../components/ui/PeachButton';
import { Strings } from '../../constants/strings';
import { databaseService } from '../../services/DatabaseService';


const slides = [
  {
    title: Strings.onboarding.slide1_title,
    subtitle: Strings.onboarding.slide1_subtitle,
    image: require('../../assets/images/onboarding-1.png'),
  },
  {
    title: Strings.onboarding.slide2_title,
    subtitle: Strings.onboarding.slide2_subtitle,
    image: require('../../assets/images/onboarding-2.png'),
  },
  {
    title: Strings.onboarding.slide3_title,
    subtitle: Strings.onboarding.slide3_subtitle,
    image: require('../../assets/images/onboarding-3.png'),
  },
];

export default function OnboardingScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  const handleScroll = (event: any) => {
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / width);
    setActiveIndex(index);
  };

  const handleGetStarted = async () => {
    await databaseService.updateSetting('onboarding_complete', 'true');
    router.replace('/(tabs)');
  };

  const isLastSlide = activeIndex === slides.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-[3]">
        <FlatList
          ref={flatListRef}
          data={slides}
          renderItem={({ item }) => (
            <OnboardingSlide 
              title={item.title} 
              subtitle={item.subtitle} 
              image={item.image}
            />
          )}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          keyExtractor={(_, index) => index.toString()}
        />
      </View>

      <View className="flex-1 px-8 items-center justify-center">
        {/* Progress Dots */}
        <View className="flex-row mb-8">
          {slides.map((_, i) => (
            <View
              key={i}
              className={`h-2 w-2 rounded-full mx-1 ${
                i === activeIndex ? 'bg-primary' : 'bg-surfaceContainerHigh'
              }`}
            />
          ))}
        </View>

        {isLastSlide && (
          <PeachButton 
            title={Strings.onboarding.get_started} 
            onPress={handleGetStarted}
            className="w-full"
          />
        )}
      </View>
    </SafeAreaView>
  );
}
