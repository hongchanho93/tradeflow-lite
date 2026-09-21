import { CapabilityError, SELECTION_SCHEMA, type AsyncToolTransaction, type JsonValue, type SelectionRef,
  type ToolDefinition, type ToolExecutionContext, type ValueSchema } from './contracts.ts';
import { objectSchema } from './chart-data.ts';
import type { MarketSymbolKind } from '../market-universe.ts';

export const CHART_NAVIGATION_TOOLS = new Set(['tf.chart.open', 'tf.chart.resolution', 'tf.chart.adjustment']);
export type ChartNavigation = { expected: SelectionRef } & (
  | { op: 'open'; providerId: string; symbol: string; kind: MarketSymbolKind; resolution?: string; adjustment?: 'none' | 'qfq' }
  | { op: 'resolution'; resolution: string }
  | { op: 'adjustment'; adjustment: 'none' | 'qfq' }
);
export interface ChartActionHost {
  current(): { selection: SelectionRef; ready: boolean; seriesKind: string; chartType: string };
  prepareNavigation(change: ChartNavigation, execution: ToolExecutionContext): Promise<AsyncToolTransaction>;
  visibleRange(): { available: boolean; from?: number; to?: number };
  dataWindow(): JsonValue;
}
const text = (maxLength = 256): ValueSchema => ({ type: 'string', maxLength });
const adjustment: ValueSchema = { type: 'string', enum: ['none', 'qfq'] };
const number: ValueSchema = { type: 'number' };
const currentSchema = objectSchema({ selection: SELECTION_SCHEMA, ready: { type: 'boolean' }, seriesKind: text(), chartType: text() });
const navigationSchema = objectSchema({ from: SELECTION_SCHEMA, selection: SELECTION_SCHEMA, ready: { type: 'boolean' } });

export function createChartActionTools(host: ChartActionHost): readonly ToolDefinition[] {
  const navigation = (id: string, description: string, properties: Record<string, ValueSchema>, required: string[], op: ChartNavigation['op']): ToolDefinition => ({
    id, version: 1, scope: 'app', effect: 'write', timeoutMs: 120_000, description,
    inputSchema: objectSchema({ expected: SELECTION_SCHEMA, ...properties }, ['expected', ...required]), outputSchema: navigationSchema,
    run() { throw new CapabilityError('invalid_contract'); }, prepareAsync: (input, ctx) => host.prepareNavigation({ ...(input as any), op }, ctx),
  });
  return [
    { id: 'tf.chart.current', version: 1, scope: 'app', effect: 'read', description: 'Read the actual current chart selection and readiness. Use its selection as expected for an intentional navigation.',
      inputSchema: objectSchema({}), outputSchema: currentSchema, run: () => host.current() as unknown as JsonValue },
    navigation('tf.chart.open', 'Open a symbol in the existing chart. Fetch before switching, preserve the old view on failure. Pass expected from tf_chart_current. Success returns the exact new selection.',
      { providerId: text(64), symbol: text(129), kind: { type: 'string', enum: ['stock','etf','index','crypto','prediction'] }, resolution: text(), adjustment }, ['providerId','symbol','kind'], 'open'),
    navigation('tf.chart.resolution', 'Change the current chart period, preserving its symbol. Reject unsupported periods and stale expected selections.', { resolution: text() }, ['resolution'], 'resolution'),
    navigation('tf.chart.adjustment', 'Change the chart adjustment only when supported by this provider. No silent fallback for an explicit request.', { adjustment }, ['adjustment'], 'adjustment'),
    { id: 'tf.chart.visible_range', version: 1, scope: 'chart', effect: 'read', description: 'Read the visible time range in Unix seconds. available=false means no usable range yet.',
      inputSchema: objectSchema({}), outputSchema: objectSchema({ available: { type: 'boolean' }, from: number, to: number }, ['available']), run: () => host.visibleRange() },
    { id: 'tf.chart.data_window', version: 1, scope: 'chart', effect: 'read', description: 'Read the bar selected by the data window/crosshair, otherwise the latest bar. Probability results do not invent OHLCV.',
      inputSchema: objectSchema({}), outputSchema: objectSchema({ available: { type:'boolean' }, seriesKind: text(), time: number,
        open: number, high: number, low: number, close: number, volume: number, amount: number, value: number }, ['available','seriesKind']), run: () => host.dataWindow() },
  ];
}
