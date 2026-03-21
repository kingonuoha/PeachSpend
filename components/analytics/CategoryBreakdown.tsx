import React from 'react';
import { View, Text } from 'react-native';
import { LuminousCard } from '../ui/LuminousCard';
import { Colors } from '../../constants/tokens';

interface CategoryBreakdownProps {
  timeframe: 'week' | 'month';
}

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({ timeframe }) => {
  const categories = [
    { name: 'Dining', amount: 120.50, color: Colors.primary, percentage: 40 },
    { name: 'Shopping', amount: 85.20, color: Colors.primaryContainer, percentage: 28 },
    { name: 'Transport', amount: 45.00, color: Colors.success, percentage: 15 },
    { name: 'Utilities', amount: 50.00, color: Colors.onSurfaceVariant, percentage: 17 },
  ];

  return (
    <View className="px-6 pb-20">
      <Text className="text-white font-manrope-bold text-lg mb-4">Categories</Text>
      {categories.map((cat, i) => (
        <LuminousCard key={i} containerStyle="flex-row items-center justify-between mb-3 py-4">
          <View className="flex-row items-center">
            <View className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: cat.color }} />
            <Text className="text-white font-manrope-medium">{cat.name}</Text>
          </View>
          <View className="items-end">
            <Text className="text-white font-manrope-bold">${cat.amount.toFixed(2)}</Text>
            <Text className="text-textTertiary text-xs">{cat.percentage}%</Text>
          </View>
        </LuminousCard>
      ))}
    </View>
  );
};
