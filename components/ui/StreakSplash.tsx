import React, { useEffect, useState } from 'react';
import { View, Text, Dimensions, Image } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { databaseService } from '../../services/DatabaseService';
import { Colors } from '../../constants/tokens';

const { width, height } = Dimensions.get('window');

export default function StreakSplash({ onFinish }: { onFinish: () => void }) {
  const [streak, setStreak] = useState(0);

  const fireScale = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  useEffect(() => {
    (async () => {
      const allSettings = await databaseService.getAllSettings();
      const currentStreak = await databaseService.getStreak();
      setStreak(currentStreak);
      await databaseService.updateSetting('last_streak', currentStreak.toString());

      fireScale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });

      contentOpacity.value = withDelay(700, withTiming(1, { duration: 400 }));

      containerOpacity.value = withDelay(4000, withTiming(0, { duration: 500 }));
    })();
  }, []);

  const fireStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fireScale.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  const handleLayout = () => {
    setTimeout(onFinish, 4500);
  };

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[{ position: 'absolute', width, height, backgroundColor: 'black', zIndex: 999, justifyContent: 'center', alignItems: 'center' }, containerStyle]}
    >
      <Animated.View style={[{ alignItems: 'center' }, fireStyle]}>
        <Image
          source={require('../../assets/images/flameheart-emoji.gif')}
          style={{ width: 120, height: 120, marginBottom: 16 }}
          resizeMode="contain"
        />
      </Animated.View>

      <Animated.View style={[{ alignItems: 'center', marginTop: 8 }, contentStyle]}>
        <Text style={{ color: Colors.primary, fontSize: 18, fontFamily: 'Manrope_700Bold', letterSpacing: 4, textTransform: 'uppercase' }}>
          Day Streak
        </Text>
      </Animated.View>

      <View style={{ height: 80, justifyContent: 'center', alignItems: 'center', marginTop: 24 }}>
        <Animated.View style={[{ position: 'absolute' }, contentStyle]}>
          <Text style={{ color: Colors.primary, fontSize: 72, fontFamily: 'NotoSerif_700Bold' }}>
            {streak}
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[{ alignItems: 'center', marginTop: 12 }, contentStyle]}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontFamily: 'Manrope_500Medium' }}>
          {streak === 1 ? 'day' : 'days'} and counting
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
