import React from 'react';
import { View, Text } from 'react-native';
import { LuminousCard } from '../ui/LuminousCard';

interface SpendingDonutProps {
  total: number;
  timeframe: 'week' | 'month';
}

export const SpendingDonut: React.FC<SpendingDonutProps> = ({ total, timeframe }) => {
  return (
    <LuminousCard containerStyle="items-center justify-center py-10">
      <View className="w-48 h-48 rounded-full border-[12px] border-surfaceContainerHighest items-center justify-center">
        <View className="absolute w-48 h-48 rounded-full border-[12px] border-primary" style={{ borderRightColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '45deg' }] }} />
        <Text className="text-textSecondary font-manrope-medium uppercase tracking-widest text-xs">Total Spent</Text>
        <Text className="text-white text-3xl font-manrope-bold mt-1">${total.toFixed(2)}</Text>
      </View>
    </LuminousCard>
  );
};
