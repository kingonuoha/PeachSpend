import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { LuminousCard } from '../ui/LuminousCard';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { formatCompactCurrency, formatCurrency } from '../../utils/currency';

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
  currency: string;
  // Canonical S-03 renders a compact donut inside a combined share card instead of
  // the stand-alone 200px card, and taps on a slice filter the list. Both are
  // optional so existing behaviour stays the default.
  size?: number;
  bare?: boolean;
  centerTopLabel?: string;
  centerLabel?: string;
  centerValue?: string;
  onCategoryPress?: (categoryName: string) => void;
  // The category the parent is currently filtering by. When it matches a slice the
  // ring reads as a selection state and the centre reports that slice.
  selectedName?: string | null;
}

// A slice thinner than this share of the ring gets an invisible hit band at least
// this wide, so a small category is still reachable. 6 percent is about 22 degrees,
// which is the largest floor that cannot overlap neighbouring bands until there are
// more than about 16 categories in the ring.
const HIT_MIN_PERCENT = 6;
// Radial tolerance for the invisible band, as a multiple of the visible stroke.
const HIT_STROKE_SCALE = 2.2;
// The selected slice thickens instead of moving, so the ring's geometry is stable.
const SELECTED_STROKE_SCALE = 1.35;
const DIMMED_OPACITY = 0.3;
// Near invisible rather than fully transparent: react-native-svg only hit-tests a
// stroke that is painted, so a zero opacity layer would never receive the tap.
const HIT_STROKE_OPACITY = 0.01;

export const SpendingDonut: React.FC<SpendingDonutProps> = ({
  total,
  distribution,
  pricesVisible = true,
  currency,
  size = 200,
  bare = false,
  centerTopLabel,
  centerLabel,
  centerValue,
  onCategoryPress,
  selectedName = null,
}) => {
  const strokeWidth = Math.max(10, Math.round(size * 0.11));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const styles = useThemeStyles();

  // A category with no spend never gets an arc: it would claim a share it does not
  // have. The legend still lists it.
  const items = distribution.filter((item) => item.amount > 0 && item.percentage > 0);

  // Each segment carries the fraction of the ring it starts at, so the visible arc
  // and its invisible hit band can be centred on the same midpoint.
  const segments = items.reduce<{ item: DistributionItem; start: number }[]>((result, item) => {
    const previous = result.length > 0
      ? result[result.length - 1].start + result[result.length - 1].item.percentage
      : 0;
    result.push({ item, start: previous });
    return result;
  }, []);

  const selectedItem = selectedName ? items.find((item) => item.name === selectedName) : undefined;
  const topItem = items.reduce<DistributionItem | undefined>(
    (largest, item) => (largest === undefined || item.amount > largest.amount ? item : largest),
    undefined,
  );
  const focus = selectedItem ?? topItem;

  const resolvedTopLabel = centerTopLabel ?? (selectedItem ? 'Selected' : 'Top');
  const resolvedLabel = centerLabel ?? focus?.label ?? focus?.name ?? 'No spending';
  const resolvedValue = centerValue ?? (focus
    ? selectedItem
      ? `${pricesVisible ? formatCurrency(selectedItem.amount, currency) : '••••'} ${selectedItem.percentage.toFixed(0)}%`
      : `${focus.percentage.toFixed(0)}%`
    : pricesVisible && total > 0
      ? formatCompactCurrency(total, currency)
      : '');

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
          {/* Visible slices */}
          {segments.map(({ item, start }) => {
            const isSelected = selectedItem !== undefined && selectedItem.name === item.name;
            const strokeDashoffset = circumference - (item.percentage / 100) * circumference;
            const rotation = (start / 100) * 360;

            return (
              <Circle
                key={item.name}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={item.color}
                strokeWidth={isSelected ? strokeWidth * SELECTED_STROKE_SCALE : strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                opacity={selectedItem !== undefined && !isSelected ? DIMMED_OPACITY : 1}
                transform={`rotate(${rotation}, ${size / 2}, ${size / 2})`}
                accessible={false}
              />
            );
          })}
          {/* Invisible hit bands, drawn above the slices. The press handler lives here
              so a thin slice still receives the tap, and the accessible label stays on
              this layer only. */}
          {onCategoryPress
            ? segments.map(({ item, start }) => {
              const hitPercent = Math.max(item.percentage, HIT_MIN_PERCENT);
              const extra = hitPercent - item.percentage;
              const hitStart = start - extra / 2;
              const hitCollapse = circumference - (hitPercent / 100) * circumference;

              return (
                <Circle
                  key={`hit-${item.name}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={item.color}
                  strokeOpacity={HIT_STROKE_OPACITY}
                  strokeWidth={strokeWidth * HIT_STROKE_SCALE}
                  strokeDasharray={circumference}
                  strokeDashoffset={hitCollapse}
                  strokeLinecap="butt"
                  fill="transparent"
                  transform={`rotate(${(hitStart / 100) * 360}, ${size / 2}, ${size / 2})`}
                  onPress={() => onCategoryPress(item.name)}
                  accessible
                  accessibilityLabel={`Filter transactions by ${item.label ?? item.name}`}
                />
              );
            })
            : null}
        </G>
      </Svg>

      <View className="absolute inset-0 items-center justify-center px-1">
        <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[9px] uppercase tracking-[0.16em]">
          {resolvedTopLabel}
        </Text>
        <Text
          style={{ color: styles.text.onSurface }}
          className="text-[11px] font-manrope-bold text-center mt-0.5"
          numberOfLines={1}
        >
          {resolvedLabel}
        </Text>
        <Text
          className="text-primary font-manrope-semibold text-[10px] mt-0.5 text-center"
          numberOfLines={2}
        >
          {resolvedValue}
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
