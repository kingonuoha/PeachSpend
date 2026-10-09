import React from 'react';
import { Text, View } from 'react-native';
import { CategoryTints, Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { formatCurrency } from '../../utils/currency';
import { SpendingDonut } from '../analytics/SpendingDonut';
import type { ChatChartSpec } from '../../ai/chatCharts';

// FR-07.11 inline chart. Both kinds reuse the shared design-system tokens:
// the donut renders through the shared SpendingDonut primitive, and the bar
// chart uses the same brand purple pair the Insights/Recap charts use, so the
// chat surface introduces no one-off chart styling.

const BAR_CHART_HEIGHT = 112;
const BAR_MAX_WIDTH = 48;
const DONUT_SIZE = 132;

function palette(ts: ReturnType<typeof useThemeStyles>): string[] {
  return Object.values(CategoryTints).map((tint) => (ts.isDark ? tint.dark[1] : tint.light[1]));
}

function BarChart({ spec }: { spec: ChatChartSpec }) {
  const ts = useThemeStyles();
  const data = spec.data.filter((datum) => Number.isFinite(datum.value));
  const max = data.reduce((current, datum) => Math.max(current, datum.value), 0);
  if (data.length === 0 || max <= 0) return null;
  const colors = [ts.raw.primaryBorder, ts.raw.primary];
  const summary = data
    .map((datum) => `${datum.label} ${formatCurrency(datum.value, spec.currency)}`)
    .join(', ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${spec.title} chart. ${summary}`}
      style={{
        height: BAR_CHART_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        gap: Spacing.s4,
        paddingHorizontal: Spacing.s3,
        paddingTop: Spacing.s4,
        paddingBottom: Spacing.s2,
        backgroundColor: ts.raw.surface,
        borderRadius: Radii.sm,
        borderWidth: 1,
        borderColor: ts.raw.outline,
      }}
    >
      {data.map((datum, index) => {
        const heightPct = Math.max(6, Math.round((datum.value / max) * 100));
        return (
          <View key={`${datum.label}-${index}`} style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: Spacing.s1 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.micro, { fontFamily: 'Manrope_700Bold', color: ts.text.onSurface }]}>
            {formatCurrency(datum.value, spec.currency)}
          </Text>
          <View
            style={{
              width: '100%',
              maxWidth: BAR_MAX_WIDTH,
              height: `${heightPct}%`,
              borderTopLeftRadius: Radii.sm,
              borderTopRightRadius: Radii.sm,
              backgroundColor: datum.color ?? colors[Math.min(index, colors.length - 1)],
            }}
          />
          <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
            {datum.label}
          </Text>
          </View>
        );
      })}
    </View>
  );
}

function DonutChart({ spec }: { spec: ChatChartSpec }) {
  const ts = useThemeStyles();
  const data = spec.data.filter((datum) => Number.isFinite(datum.value) && datum.value > 0);
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  if (data.length === 0 || total <= 0) return null;
  const colors = palette(ts);

  return (
    <View style={{ alignItems: 'center', paddingVertical: Spacing.s2 }}>
      <SpendingDonut
        bare
        size={DONUT_SIZE}
        total={total}
        pricesVisible
        currencySymbol=""
        centerTopLabel="Total"
        centerLabel={spec.title}
        centerValue={formatCurrency(total, spec.currency)}
        distribution={data.map((datum, index) => ({
          name: `${datum.label}-${index}`,
          label: datum.label,
          amount: datum.value,
          percentage: (datum.value / total) * 100,
          color: datum.color ?? colors[index % colors.length],
        }))}
      />
    </View>
  );
}

export function ChatChartView({ spec }: { spec: ChatChartSpec }) {
  return spec.kind === 'donut' ? <DonutChart spec={spec} /> : <BarChart spec={spec} />;
}
