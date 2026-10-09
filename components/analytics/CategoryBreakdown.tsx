import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Radii, Spacing } from '../../constants/tokens';

interface DistributionItem {
  // `name` is the stable id used for filtering; `label` is the display title.
  name: string;
  label?: string;
  amount: number;
  percentage: number;
  color: string;
}

interface CategoryBreakdownProps {
  distribution: DistributionItem[];
  pricesVisible?: boolean;
  currencySymbol: string;
  onCategoryPress?: (categoryName: string) => void;
  // 'cards' is the original vertical breakdown; 'compact' is the canonical S-03
  // legend that sits beside the donut inside one card. Both share this component.
  variant?: 'cards' | 'compact';
}

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({
  distribution,
  pricesVisible = true,
  currencySymbol,
  onCategoryPress,
  variant = 'cards',
}) => {
  const styles = useThemeStyles();

  if (distribution.length === 0) {
    return (
      <View className="py-6 items-center">
        <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm">No activity in this period.</Text>
      </View>
    );
  }

  if (variant === 'compact') {
    return (
      <View style={{ gap: Spacing.s1 }}>
        {distribution.map((item, index) => (
          <TouchableOpacity
            key={item.name || index}
            activeOpacity={onCategoryPress ? 0.7 : 1}
            onPress={() => onCategoryPress?.(item.name)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label ?? item.name}, ${item.percentage.toFixed(0)} percent`}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 44,
              paddingHorizontal: Spacing.s2,
              borderRadius: Radii.sm,
            }}
          >
            <View className="flex-row items-center flex-shrink" style={{ gap: Spacing.s2 }}>
              <View style={{ width: 10, height: 10, borderRadius: Radii.full, backgroundColor: item.color }} />
              <Text
                style={{ color: styles.text.onSurface }}
                className="font-manrope-medium text-xs flex-shrink"
                numberOfLines={1}
              >
                {item.label ?? item.name}
              </Text>
            </View>
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-xs" numberOfLines={1}>
              {pricesVisible ? `${currencySymbol}${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View className="gap-3">
      {distribution.map((item, index) => (
        <TouchableOpacity
          key={item.name || index}
          activeOpacity={onCategoryPress ? 0.7 : 1}
          onPress={() => onCategoryPress?.(item.name)}
          style={{
            backgroundColor: styles.bg.surfaceContainerLow,
            borderLeftWidth: 3,
            borderLeftColor: item.color,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: styles.border.subtle,
          }}
          className="px-4 py-4"
        >
          <View className="flex-row items-center justify-between mb-3">
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-sm uppercase tracking-wide">
              {item.label ?? item.name}
            </Text>
            <View className="flex-row items-baseline">
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-[10px] mr-2">
                {item.percentage.toFixed(0)}%
              </Text>
              <Text className="text-primary font-noto-serif-bold text-xs">{pricesVisible ? currencySymbol : ''}</Text>
              <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-lg tracking-tighter">
                {pricesVisible ? item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '••••'}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: styles.bg.white5 }} className="h-1.5 rounded-full overflow-hidden">
            <View
              style={{
                width: `${Math.max(item.percentage, 2)}%`,
                backgroundColor: item.color,
              }}
              className="h-full rounded-full"
            />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};
