import React from 'react';
import { View, Text } from 'react-native';
import { LuminousCard } from '../ui/LuminousCard';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors } from '../../constants/tokens';

interface DistributionItem {
  name: string;
  amount: number;
  percentage: number;
  color: string;
}

interface CategoryBreakdownProps {
  distribution: DistributionItem[];
  pricesVisible?: boolean;
}

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({ distribution, pricesVisible = true }) => {
  const styles = useThemeStyles();

  if (distribution.length === 0) {
    return (
      <View className="py-10 items-center">
        <Text className="text-onSurfaceVariant font-manrope-medium">No activity in this period.</Text>
      </View>
    );
  }

  return (
    <View style={{ flexWrap: 'wrap', flexDirection: 'row', gap: 12 }}>
      {distribution.map((item, index) => {
        const isLarge = index < 2;
        
        return (
          <LuminousCard 
            key={index} 
            className={`${isLarge ? 'w-full' : 'w-[48%]'} py-5 px-5`}
            style={{ borderColor: styles.border.subtle, borderWidth: 1 }}
          >
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: item.color }} />
                <Text className="text-onSurfaceVariant font-manrope-bold text-xs uppercase tracking-widest">
                  {item.name}
                </Text>
              </View>
              <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px]">
                {item.percentage.toFixed(0)}%
              </Text>
            </View>

            <View className="flex-row items-baseline">
              <Text className="text-primary font-noto-serif-bold text-xs mr-0.5">{pricesVisible ? '$' : ''}</Text>
              <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl tracking-tighter">
                {pricesVisible ? item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '••••'}
              </Text>
            </View>
          </LuminousCard>
        );
      })}
    </View>
  );
};
