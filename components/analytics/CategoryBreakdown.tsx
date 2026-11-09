import React from 'react';
import { View, Text } from 'react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { PeachButton } from '../ui/PeachButton';
import { ScalePressable } from '../ui/ScalePressable';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { formatCurrency, formatMoneyNumber, getCurrencyPrefix } from '../../utils/currency';

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
  currency: string;
  onCategoryPress?: (categoryName: string) => void;
  // 'cards' is the original vertical breakdown; 'compact' is the canonical S-03
  // legend that sits beside the donut inside one card. Both share this component.
  variant?: 'cards' | 'compact';
  // Optional route into the ledger for the empty state. Without it the empty state
  // still explains the next step, it just does not offer the button.
  onAddExpense?: () => void;
}

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({
  distribution,
  pricesVisible = true,
  currency,
  onCategoryPress,
  variant = 'cards',
  onAddExpense,
}) => {
  const styles = useThemeStyles();

  // Shares are recomputed from the rows themselves so the visible percentage can
  // never disagree with the amounts beside it, whatever the caller passed in.
  const distributionTotal = distribution.reduce((sum, item) => sum + (item.amount > 0 ? item.amount : 0), 0);
  const shareOf = (item: DistributionItem) => (distributionTotal > 0
    ? (item.amount / distributionTotal) * 100
    : item.percentage);

  if (distribution.length === 0) {
    return (
      <View style={{ paddingVertical: Spacing.s5, alignItems: 'center', gap: Spacing.s2 }}>
        <Text style={[Typography.labelBold, { color: styles.text.onSurface, textAlign: 'center' }]}>
          No category spend in this period
        </Text>
        <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant60, textAlign: 'center', maxWidth: 260 }]}>
          Log an expense or widen the range to see where your money goes, category by category.
        </Text>
        {onAddExpense ? (
          <PeachButton title="Add Expense" onPress={onAddExpense} variant="primary" size="sm" />
        ) : null}
      </View>
    );
  }

  if (variant === 'compact') {
    return (
      <View style={{ gap: Spacing.s1 }}>
        {distribution.map((item, index) => {
          const label = item.label ?? item.name;
          const share = shareOf(item);
          const amountLabel = pricesVisible ? formatCurrency(item.amount, currency) : '••••';
          return (
            <ScalePressable
              key={item.name || index}
              haptic={false}
              disabled={onCategoryPress === undefined}
              onPress={() => onCategoryPress?.(item.name)}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${share.toFixed(0)} percent, ${pricesVisible ? amountLabel : 'amount hidden'}`}
              hitSlop={{ top: 4, bottom: 4 }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: Spacing.s2,
                minHeight: 44,
                paddingHorizontal: Spacing.s2,
                borderRadius: Radii.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 }}>
                <View style={{ width: 10, height: 10, borderRadius: Radii.full, backgroundColor: item.color }} />
                <Text
                  style={[Typography.labelMd, { color: styles.text.onSurface, fontFamily: 'Manrope_500Medium', flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <Text style={[Typography.labelMd, { color: styles.text.onSurface, fontFamily: 'Manrope_700Bold' }]} numberOfLines={1}>
                  {amountLabel}
                </Text>
                {/* The share sits in the amount's own column. Placing it inline beside
                    the amount squeezed the category label into an ellipsis at 390, and a
                    share is useless if the name it belongs to is cut off. */}
                <Text style={[Typography.micro, { color: styles.text.onSurfaceVariant60 }]} numberOfLines={1}>
                  {`${share.toFixed(0)}%`}
                </Text>
              </View>
            </ScalePressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ gap: Spacing.s3 }}>
      {distribution.map((item, index) => {
        const label = item.label ?? item.name;
        const share = shareOf(item);
        return (
          <ScalePressable
            key={item.name || index}
            haptic={false}
            disabled={onCategoryPress === undefined}
            onPress={() => onCategoryPress?.(item.name)}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${share.toFixed(0)} percent, ${pricesVisible ? formatCurrency(item.amount, currency) : 'amount hidden'}`}
            style={{
              backgroundColor: styles.bg.surfaceContainerLow,
              borderLeftWidth: 3,
              borderLeftColor: item.color,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: styles.border.subtle,
              paddingHorizontal: Spacing.s4,
              paddingVertical: Spacing.s4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s3, gap: Spacing.s2 }}>
              <Text
                numberOfLines={1}
                style={{ color: styles.text.onSurface, flexShrink: 1 }}
                className="font-manrope-bold text-sm uppercase tracking-wide"
              >
                {label}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', flexShrink: 0 }}>
                <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-[10px] mr-2">
                  {share.toFixed(0)}%
                </Text>
                <Text className="text-primary font-noto-serif-bold text-xs">{pricesVisible ? getCurrencyPrefix(currency) : ''}</Text>
                <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-lg tracking-tighter">
                  {pricesVisible ? formatMoneyNumber(item.amount) : '••••'}
                </Text>
              </View>
            </View>

            <View style={{ backgroundColor: styles.bg.white5 }} className="h-1.5 rounded-full overflow-hidden">
              <View
                style={{
                  width: `${Math.max(share, 2)}%`,
                  backgroundColor: item.color,
                }}
                className="h-full rounded-full"
              />
            </View>
          </ScalePressable>
        );
      })}
    </View>
  );
};
