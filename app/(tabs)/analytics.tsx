import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenses } from '../../hooks/useExpenses';
import { Strings } from '../../constants/strings';
import { SpendingDonut } from '../../components/analytics/SpendingDonut';
import { CategoryBreakdown } from '../../components/analytics/CategoryBreakdown';

export default function AnalyticsScreen() {
  const [timeframe, setTimeframe] = useState<'week' | 'month'>('week');
  const { expenses } = useExpenses();

  const totalSpending = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        <View className="mb-8">
          <View className="flex-row justify-between items-end mb-2">
            <Text className="text-white text-3xl font-manrope-bold">
              {Strings.analytics.title}
            </Text>
            <View className="flex-row bg-surfaceContainerLow p-1 rounded-xl">
              <TouchableOpacity 
                onPress={() => setTimeframe('week')}
                className={`px-4 py-1.5 rounded-lg ${timeframe === 'week' ? 'bg-surfaceContainerHigh' : ''}`}
              >
                <Text className={`font-manrope-medium ${timeframe === 'week' ? 'text-primary' : 'text-textSecondary'}`}>
                  Week
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => setTimeframe('month')}
                className={`px-4 py-1.5 rounded-lg ${timeframe === 'month' ? 'bg-surfaceContainerHigh' : ''}`}
              >
                <Text className={`font-manrope-medium ${timeframe === 'month' ? 'text-primary' : 'text-textSecondary'}`}>
                  Month
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text className="text-textSecondary font-manrope-medium">
            {Strings.analytics.subtitle}
          </Text>
        </View>

        {/* Charts & Breakdown */}
        <SpendingDonut total={totalSpending} timeframe={timeframe} />
        
        <View className="mt-8 mb-12">
          <CategoryBreakdown timeframe={timeframe} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
