// FR-07.11 inline chart contract. The chat bubble leads with this spec and a
// short explanation below it. The spec is render-agnostic and token-agnostic on
// purpose: the Mobile renderer maps `kind` and each datum to the same
// design-system chart tokens SpendingDonut/the Insights bar chart already use,
// so there is no one-off chart styling in the chat surface. A datum may carry the
// category color it already owns; otherwise the renderer assigns the shared
// palette by index.
export type ChatChartKind = 'bar' | 'donut';

export interface ChatChartDatum {
  label: string;
  value: number;
  color?: string;
}

export interface ChatChartSpec {
  kind: ChatChartKind;
  title: string;
  currency: string;
  data: ChatChartDatum[];
}

export interface ChatChartResponse {
  chart: ChatChartSpec;
  // 1-3 sentences, rendered below the chart, never above it.
  explanation: string;
}

export function buildDonutChart(title: string, currency: string, entries: ChatChartDatum[]): ChatChartSpec {
  return { kind: 'donut', title, currency, data: entries.filter(entry => Number.isFinite(entry.value) && entry.value > 0) };
}

export function buildComparisonChart(
  title: string,
  currency: string,
  current: { label: string; value: number },
  previous: { label: string; value: number },
): ChatChartSpec {
  return { kind: 'bar', title, currency, data: [current, previous] };
}
