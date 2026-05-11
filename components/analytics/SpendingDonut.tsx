import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { LuminousCard } from '../ui/LuminousCard';
import { Colors } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';

interface DistributionItem {
  name: string;
  amount: number;
  percentage: number;
  color: string;
}

interface SpendingDonutProps {
  total: number;
  distribution: DistributionItem[];
  pricesVisible?: boolean;
}

export const SpendingDonut: React.FC<SpendingDonutProps> = ({ total, distribution, pricesVisible = true }) => {
  const size = 200;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const styles = useThemeStyles();

  let currentOffset = 0;

  return (
    <LuminousCard className="items-center justify-center py-10" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            {/* Background circle */}
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Data segments */}
            {distribution.map((item, index) => {
              const strokeDashoffset = circumference - (item.percentage / 100) * circumference;
              const rotation = (currentOffset / 100) * 360;
              currentOffset += item.percentage;

              return (
                <Circle
                  key={index}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={item.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  transform={`rotate(${rotation}, ${size / 2}, ${size / 2})`}
                />
              );
            })}
          </G>
        </Svg>
        
        <View className="absolute inset-0 items-center justify-center">
          <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-[0.2em]">Total</Text>
          <Text style={{ color: styles.text.onSurface }} className="text-3xl font-noto-serif-bold mt-1">
            {pricesVisible ? `$${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '••••'}
          </Text>
          <Text className="text-primary font-manrope-medium text-[10px] mt-1 tracking-widest uppercase">Overview</Text>
        </View>
      </View>
    </LuminousCard>
  );
};
