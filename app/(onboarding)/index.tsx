import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, FlatList, useWindowDimensions, Platform, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { OnboardingSlide } from '../../components/onboarding/OnboardingSlide';
import { PeachButton } from '../../components/ui/PeachButton';
import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { databaseService } from '../../services/DatabaseService';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { ChevronDown } from 'lucide-react-native';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'];

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
  const ts = useThemeStyles();
  const { updateSetting } = useSettings();
  const [activeIndex, setActiveIndex] = useState(0);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [name, setName] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [budget, setBudget] = useState('');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useEffect(() => {
    (async () => {
      const completed = await databaseService.getSetting('onboarding_complete');
      if (completed === 'true') {
        router.replace('/(tabs)');
      }
    })();
  }, []);

  const handleScroll = (event: any) => {
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / width);
    setActiveIndex(index);
  };

  const handleGetStarted = async () => {
    await updateSetting('onboarding_complete', 'true');
    await updateSetting('profile_name', name || 'Peach User');
    await updateSetting('currency', selectedCurrency);
    if (budget) {
      await updateSetting('monthly_budget', budget);
    }
    router.replace('/(tabs)');
  };

  const handleSkip = async () => {
    await databaseService.updateSetting('onboarding_complete', 'true');
    router.replace('/(tabs)');
  };

  const totalSlides = 4;
  const isLastSlide = activeIndex === totalSlides - 1;
  const isSetupSlide = activeIndex === 3;

  const renderItem = useCallback(({ item, index }: any) => {
    if (index === 3) {
      return (
        <View style={{ width }} className="flex-1 items-center justify-center px-8">
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <Text className="text-onSurface font-noto-serif-bold text-3xl text-center mb-2">Quick Setup</Text>
            <Text className="text-onSurfaceVariant font-manrope-medium text-base text-center mb-8 leading-5">
              Personalise your experience to get the most out of PeachSpend.
            </Text>

            {/* Name Input */}
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2">Your Name</Text>
            <TextInput
              className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-manrope-medium text-base mb-5"
              placeholder="Enter your name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={name}
              onChangeText={setName}
              selectionColor={Colors.primary}
            />

            {/* Currency Selector */}
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2">Preferred Currency</Text>
            <TouchableOpacity
              onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}
              className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 flex-row items-center justify-between mb-5"
            >
              <Text className="text-white font-manrope-semibold text-base">{selectedCurrency}</Text>
              <ChevronDown size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
            {showCurrencyPicker && (
              <View className="bg-white/10 border border-white/10 rounded-2xl mb-5 overflow-hidden">
                {CURRENCIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => { setSelectedCurrency(c); setShowCurrencyPicker(false); }}
                    className={`px-5 py-4 ${selectedCurrency === c ? 'bg-primary/20' : ''}`}
                  >
                    <Text className={`font-manrope-semibold text-base ${selectedCurrency === c ? 'text-primary' : 'text-white'}`}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Budget Input */}
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2">Monthly Budget (optional)</Text>
            <TextInput
              className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-manrope-medium text-base mb-5"
              placeholder="Set a spending limit"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={budget}
              onChangeText={setBudget}
              keyboardType="numeric"
              selectionColor={Colors.primary}
            />

            <PeachButton
              title="Get Started"
              onPress={handleGetStarted}
              className="w-full mb-3"
            />

            <TouchableOpacity onPress={handleSkip} className="py-3 items-center">
              <Text className="text-onSurfaceVariant font-manrope-medium text-sm">Skip</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    return (
      <OnboardingSlide
        title={item.title}
        subtitle={item.subtitle}
        image={item.image}
      />
    );
  }, [width, name, selectedCurrency, budget, showCurrencyPicker]);

  const slideData = [...slides, { id: 'setup' }];

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: ts.bg.screen }}>
      <View className="flex-[3]">
        <FlatList
          ref={flatListRef}
          data={slideData}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          keyExtractor={(_, index) => index.toString()}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          windowSize={3}
          removeClippedSubviews={Platform.OS === 'android'}
        />
      </View>

      <View className="flex-1 px-8 items-center justify-center">
        {/* Progress Dots */}
        <View className="flex-row mb-8">
          {slideData.map((_, i) => (
            <View
              key={i}
              style={{ backgroundColor: i === activeIndex ? Colors.primary : ts.bg.card }}
              className="h-2 w-2 rounded-full mx-1"
            />
          ))}
        </View>

        {!isSetupSlide && isLastSlide && (
          <PeachButton 
            title={Strings.onboarding.get_started} 
            onPress={() => flatListRef.current?.scrollToIndex({ index: 3, animated: true })}
            className="w-full"
          />
        )}
      </View>
    </SafeAreaView>
  );
}
