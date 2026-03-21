import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Plus, ArrowUpRight } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';
import React, { useMemo, useEffect } from 'react';

import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { useExpenses } from '../../hooks/useExpenses';
import { ExpenseList } from '../../components/expense/ExpenseList';

export default function HomeScreen() {
  const router = useRouter();
  const { expenses, isLoading } = useExpenses();
  const fabScale = useSharedValue(1);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return Strings.home.greeting_morning;
    if (hour < 18) return Strings.home.greeting_afternoon;
    return Strings.home.greeting_evening;
  }, []);


  const balance = useMemo(() => {
    return expenses.reduce((sum: number, exp: any) => sum - exp.amount, 1000); // Starting balance $1000 for demo
  }, [expenses]);

  useEffect(() => {
    fabScale.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 1000 }),
        withTiming(1.0, { duration: 1000 })
      ),
      -1,
      true
    );
  }, [fabScale]);

  const animatedFabStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="px-6 pt-8 mb-8">
          <Text className="text-onSurfaceVariant font-manrope-medium text-lg">
            {greeting},
          </Text>
          <Text className="text-onSurface font-noto-serif-bold text-3xl">
            Peach User
          </Text>
        </View>

        {/* Balance Card */}
        <View className="px-6 mb-10">
          <LinearGradient
            colors={[Colors.primaryContainer, Colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-xl p-8 shadow-xl"
          >
            <Text className="text-onPrimaryContainer font-manrope-medium mb-1">
              {Strings.home.total_balance}
            </Text>
            <View className="flex-row items-center justify-between mt-2">
              <Text className="text-peach-50 text-3xl font-bold">
                ${balance.toFixed(2)}
              </Text>
              <TouchableOpacity
                className="bg-peach-50/20 px-3 py-1.5 rounded-full flex-row items-center"
                onPress={() => {/* TODO: Add Funds logic */}}
              >
                <ArrowUpRight size={14} color="#FFF5F2" />
                <Text className="text-peach-50 text-xs font-semibold ml-1">
                  Add Funds
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* Recent Expenses List */}
        <ExpenseList expenses={expenses.slice(0, 10)} isLoading={isLoading} />
      </ScrollView>

      {/* Floating Action Button */}
      <View className="absolute bottom-6 right-6">
        <Animated.View style={animatedFabStyle}>
          <TouchableOpacity
            onPress={() => router.push('/scan')}
            className="bg-primary w-16 h-16 rounded-full items-center justify-center shadow-lg"
            activeOpacity={0.8}
          >
            <Plus color={Colors.onPrimary} size={32} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}
