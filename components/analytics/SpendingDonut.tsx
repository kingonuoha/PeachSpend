import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { LuminousCard } from '../ui/LuminousCard';
import { useThemeStyles } from '../../hooks/useThemeStyles';

interface DistributionItem {
  // `name` is the stable id used for filtering. `label` is the display title when
  // it differs from the id (category ids are lower-case keys, titles are human).
  name: string;
  label?: string;
  amount: number;
  percentage: number;
  color: string;
}

interface SpendingDonutProps {
  total: number;
  distribution: DistributionItem[];
  pricesVisible?: boolean;
  currencySymbol: string;
  // Canonical S-03 renders a compact donut inside a combined share card instead of
  // the stand-alone 200px card, and taps on a slice filter the list. Both are
  // optional so existing behaviour stays the default.
  size?: number;
  bare?: boolean;
  centerTopLabel?: string;
  centerLabel?: string;
  centerValue?: string;
  onCategoryPress?: (categoryName: string) => void;
}

export const SpendingDonut: React.FC<SpendingDonutProps> = ({
  total,
  distribution,
  pricesVisible = true,
  currencySymbol,
  size = 200,
  bare = false,
  centerTopLabel = 'Total',
  centerLabel = 'Overview',
  centerValue,
  onCategoryPress,
}) => {
  const strokeWidth = Math.max(10, Math.round(size * 0.11));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const styles = useThemeStyles();

  const segments = distribution.reduce<{ item: DistributionItem; rotation: number }[]>((result, item) => {
    const previousTotal = result.reduce((sum, segment) => sum + segment.item.percentage, 0);
    result.push({ item, rotation: (previousTotal / 100) * 360 });
    return result;
  }, []);

  const chart = (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Background circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={styles.bg.white10}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {/* Data segments */}
          {segments.map(({ item, rotation }, index) => {
            const strokeDashoffset = circumference - (item.percentage / 100) * circumference;

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
                onPress={onCategoryPress ? () => onCategoryPress(item.name) : undefined}
                // A slice is a touch target. Label it so the filter action is not
                // color-only; the compact legend rows are an equivalent labelled path.
                accessible={onCategoryPress ? true : false}
                accessibilityLabel={
                  onCategoryPress ? `Filter transactions by ${item.label ?? item.name}` : undefined
                }
              />
            );
          })}
        </G>
      </Svg>

      <View className="absolute inset-0 items-center justify-center px-1">
        <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[9px] uppercase tracking-[0.16em]">
          {centerTopLabel}
        </Text>
        <Text
          style={{ color: styles.text.onSurface }}
          className="text-[11px] font-manrope-bold text-center mt-0.5"
          numberOfLines={1}
        >
          {centerLabel}
        </Text>
        <Text
          className="text-primary font-manrope-semibold text-[10px] mt-0.5"
          numberOfLines={1}
        >
          {centerValue ?? (pricesVisible ? `${currencySymbol}${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '••••')}
        </Text>
      </View>
    </View>
  );

  if (bare) {
    return chart;
  }

  return (
    <LuminousCard className="items-center justify-center py-10" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
      {chart}
    </LuminousCard>
  );
};
