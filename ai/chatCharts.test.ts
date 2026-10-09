import { describe, expect, it } from 'vitest';
import { buildComparisonChart, buildDonutChart } from './chatCharts';

describe('chat chart specs', () => {
  it('builds a donut that drops non-positive values', () => {
    const chart = buildDonutChart('By category', 'USD', [
      { label: 'Dining', value: 20 },
      { label: 'Empty', value: 0 },
      { label: 'Bad', value: Number.NaN },
      { label: 'Transport', value: 10 },
    ]);
    expect(chart.kind).toBe('donut');
    expect(chart.data.map(datum => datum.label)).toEqual(['Dining', 'Transport']);
    expect(chart.currency).toBe('USD');
  });

  it('builds a two-bar comparison chart for a direct data question', () => {
    const chart = buildComparisonChart('This month vs last', 'CAD', { label: 'This month', value: 120 }, { label: 'Last month', value: 100 });
    expect(chart.kind).toBe('bar');
    expect(chart.data).toEqual([{ label: 'This month', value: 120 }, { label: 'Last month', value: 100 }]);
  });
});
