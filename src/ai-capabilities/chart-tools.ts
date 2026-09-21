import { sma } from '../indicators.ts';
import { CapabilityError, SELECTION_SCHEMA, type JsonValue, type ToolDefinition, type ToolExecutionContext } from './contracts.ts';
import {
  CHART_DATA_LIMITS, ChartSnapshotStore, countSchema, numberSchema, objectSchema,
  snapshotDescriptorSchema, snapshotIdSchema, type ChartSnapshot,
} from './chart-data.ts';
import type { MarketResultStore } from './market-data.ts';

const snapshotInput = { snapshotId: snapshotIdSchema };
const computeDatasetInput = { snapshotId: snapshotIdSchema, datasetId: { type: 'string', maxLength: 128 } as const };
const offsetSchema = { type: 'integer', minimum: 0, maximum: CHART_DATA_LIMITS.maxRows } as const;
const limitSchema = { type: 'integer', minimum: 1, maximum: CHART_DATA_LIMITS.maxPageRows } as const;
const fieldSchema = { type: 'string', enum: ['open', 'high', 'low', 'close', 'volume', 'amount', 'value'] } as const;
const barSchema = objectSchema({
  time: numberSchema, open: numberSchema, high: numberSchema, low: numberSchema,
  close: numberSchema, volume: numberSchema, amount: numberSchema,
}, ['time', 'open', 'high', 'low', 'close', 'volume']);
const referenceProperties = {
  snapshotId: snapshotIdSchema, context: SELECTION_SCHEMA, capturedAtMs: countSchema, dataRevision: countSchema,
};
const pageProperties = {
  ...referenceProperties, offset: countSchema, nextOffset: countSchema, totalRows: countSchema,
  hasMore: { type: 'boolean' } as const,
};
type Input = Readonly<Record<string, JsonValue>>;
type ComputeDataset = Readonly<{
  source: 'chart' | 'market';
  seriesKind: 'ohlcv' | 'probability';
  rows: readonly Readonly<Record<string, number>>[];
  reference: Readonly<Record<string, JsonValue>>;
}>;

function reference(snapshot: ChartSnapshot) {
  const { snapshotId, context, capturedAtMs, dataRevision } = snapshot.descriptor;
  return { snapshotId, context, capturedAtMs, dataRevision };
}

function pageRange(snapshot: ChartSnapshot, input: Input): { offset: number; end: number } {
  const offset = (input.offset ?? 0) as number;
  if (offset > snapshot.rows.length) throw new CapabilityError('invalid_request');
  return { offset, end: Math.min(snapshot.rows.length, offset + ((input.limit ?? CHART_DATA_LIMITS.defaultPageRows) as number)) };
}

function selectedValues(snapshot: ChartSnapshot, field: string, start: number, end: number,
  execution: ToolExecutionContext): number[] {
  if ((snapshot.seriesKind === 'probability') !== (field === 'value')) throw new CapabilityError('field_unavailable');
  const result: number[] = [];
  for (let index = start; index < end; index += 1) {
    if (index % 256 === 0) execution.checkpoint();
    const value = snapshot.rows[index][field];
    if (typeof value !== 'number') throw new CapabilityError('field_unavailable');
    result.push(value);
  }
  return result;
}

function datasetForCompute(
  chartStore: ChartSnapshotStore,
  marketStore: MarketResultStore | undefined,
  input: Input,
  execution: ToolExecutionContext,
): ComputeDataset {
  const snapshotId = typeof input.snapshotId === 'string' ? input.snapshotId : undefined;
  const datasetId = typeof input.datasetId === 'string' ? input.datasetId : undefined;
  if ((snapshotId === undefined) === (datasetId === undefined)) throw new CapabilityError('invalid_request');
  if (snapshotId !== undefined) {
    const snapshot = chartStore.getForCompute(snapshotId, execution);
    return Object.freeze({
      source: 'chart',
      seriesKind: snapshot.seriesKind,
      rows: snapshot.rows,
      reference: Object.freeze({ source: 'chart', ...reference(snapshot) }),
    });
  }
  if (!marketStore) throw new CapabilityError('snapshot_unavailable');
  const dataset = marketStore.getForCompute(datasetId!, execution);
  const capturedAtMs = dataset.descriptor.capturedAtMs;
  if (typeof capturedAtMs !== 'number') throw new CapabilityError('invalid_output');
  return Object.freeze({
    source: 'market',
    seriesKind: dataset.seriesKind,
    rows: dataset.rows,
    reference: Object.freeze({ source: 'market', datasetId: datasetId!, capturedAtMs }),
  });
}

function selectedDatasetValues(dataset: ComputeDataset, field: string, start: number, end: number,
  execution: ToolExecutionContext): number[] {
  if ((dataset.seriesKind === 'probability') !== (field === 'value')) throw new CapabilityError('field_unavailable');
  const result: number[] = [];
  for (let index = start; index < end; index += 1) {
    if (index % 256 === 0) execution.checkpoint();
    const value = dataset.rows[index][field];
    if (typeof value !== 'number') throw new CapabilityError('field_unavailable');
    result.push(value);
  }
  return result;
}

/** All functions are bounded trusted computations; no code string is evaluated. */
export function createChartReadTools(store: ChartSnapshotStore, marketStore?: MarketResultStore): readonly ToolDefinition[] {
  return [
    {
      id: 'tf.chart.snapshot', version: 1, effect: 'read',
      description: 'Capture the committed chart window as an immutable session-owned dataset. Returns metadata, not all rows. capturedAtMs is capture time, not an exchange freshness guarantee. Release unused datasets.',
      inputSchema: objectSchema({}), outputSchema: snapshotDescriptorSchema,
      run: (_input, execution) => store.capture(execution).descriptor,
    },
    {
      id: 'tf.dataset.page', version: 1, effect: 'read',
      description: 'Read a page of a captured chart dataset, ordered oldest to newest. OHLCV returns bars; probability returns points without synthetic OHLCV or volume. Live ticks do not change this dataset.',
      inputSchema: objectSchema({ ...snapshotInput, offset: offsetSchema, limit: limitSchema }, ['snapshotId']),
      outputSchema: objectSchema({
        ...pageProperties, seriesKind: { type: 'string', enum: ['ohlcv', 'probability'] },
        bars: { type: 'array', items: barSchema, maxItems: CHART_DATA_LIMITS.maxPageRows },
        points: { type: 'array', items: objectSchema({ time: numberSchema, value: numberSchema }), maxItems: CHART_DATA_LIMITS.maxPageRows },
      }, [...Object.keys(pageProperties), 'seriesKind']),
      run: (raw, execution) => {
        const input = raw as Input;
        const snapshot = store.get(input.snapshotId as string, execution);
        const { offset, end } = pageRange(snapshot, input);
        return {
          ...reference(snapshot), offset, nextOffset: end, totalRows: snapshot.rows.length,
          hasMore: end < snapshot.rows.length, seriesKind: snapshot.seriesKind,
          [snapshot.seriesKind === 'probability' ? 'points' : 'bars']: snapshot.rows.slice(offset, end),
        };
      },
    },
    {
      id: 'tf.dataset.release', version: 1, effect: 'read',
      description: 'Release only this session-owned temporary dataset. Does not modify the chart, history cache, files or workspace. Already returned request replies stay immutable until session close.',
      inputSchema: objectSchema(snapshotInput), outputSchema: objectSchema({ released: { type: 'boolean' } }),
      run: (raw, execution) => { store.release((raw as Input).snapshotId as string, execution); return { released: true }; },
    },
    {
      id: 'tf.compute.summary', version: 1, effect: 'read',
      description: 'Compute count, first, last, sum, min, max and arithmetic mean over either a chart snapshotId or an independent market datasetId. Pass exactly one reference; no chart navigation is needed.',
      inputSchema: objectSchema({
        ...computeDatasetInput, field: fieldSchema, offset: offsetSchema,
        count: { type: 'integer', minimum: 1, maximum: CHART_DATA_LIMITS.maxRows },
      }, ['field']),
      outputSchema: objectSchema({
        source: { type: 'string', enum: ['chart', 'market'] },
        snapshotId: snapshotIdSchema, datasetId: { type: 'string', maxLength: 128 },
        context: SELECTION_SCHEMA, capturedAtMs: countSchema, dataRevision: countSchema,
        field: fieldSchema, offset: countSchema, count: countSchema,
        fromTime: numberSchema, toTime: numberSchema,
        first: numberSchema, last: numberSchema, sum: numberSchema, mean: numberSchema,
        min: numberSchema, max: numberSchema, minTime: numberSchema, maxTime: numberSchema,
      }, ['source', 'capturedAtMs', 'field', 'offset', 'count', 'fromTime', 'toTime',
        'first', 'last', 'sum', 'mean', 'min', 'max', 'minTime', 'maxTime']),
      run: (raw, execution) => {
        const input = raw as Input;
        const dataset = datasetForCompute(store, marketStore, input, execution);
        const offset = (input.offset ?? 0) as number;
        const count = (input.count ?? dataset.rows.length - offset) as number;
        if (offset >= dataset.rows.length || count < 1 || offset + count > dataset.rows.length) {
          throw new CapabilityError('invalid_request');
        }
        const field = input.field as string;
        const values = selectedDatasetValues(dataset, field, offset, offset + count, execution);
        let sum = 0;
        let compensation = 0;
        let minIndex = 0;
        let maxIndex = 0;
        for (let index = 0; index < values.length; index += 1) {
          if (index % 256 === 0) execution.checkpoint();
          const corrected = values[index] - compensation;
          const next = sum + corrected;
          compensation = (next - sum) - corrected;
          sum = next;
          if (values[index] < values[minIndex]) minIndex = index;
          if (values[index] > values[maxIndex]) maxIndex = index;
          if (!Number.isFinite(sum) || !Number.isFinite(compensation)) throw new CapabilityError('numeric_overflow');
        }
        execution.checkpoint();
        return {
          ...dataset.reference, field, offset, count,
          fromTime: dataset.rows[offset].time, toTime: dataset.rows[offset + count - 1].time,
          first: values[0], last: values.at(-1)!, sum, mean: sum / count,
          min: values[minIndex], max: values[maxIndex],
          minTime: dataset.rows[offset + minIndex].time, maxTime: dataset.rows[offset + maxIndex].time,
        };
      },
    },
    {
      id: 'tf.compute.sma', version: 1, effect: 'read',
      description: 'Calculate SMA over either a chart snapshotId or independent market datasetId using the same implementation as built-in indicators. Pass exactly one reference; no chart navigation is required.',
      inputSchema: objectSchema({
        ...computeDatasetInput, field: fieldSchema,
        period: { type: 'integer', minimum: 1, maximum: CHART_DATA_LIMITS.maxRows },
        offset: offsetSchema, limit: limitSchema,
      }, ['field', 'period']),
      outputSchema: objectSchema({
        source: { type: 'string', enum: ['chart', 'market'] },
        snapshotId: snapshotIdSchema, datasetId: { type: 'string', maxLength: 128 },
        context: SELECTION_SCHEMA, capturedAtMs: countSchema, dataRevision: countSchema,
        offset: countSchema, nextOffset: countSchema, totalRows: countSchema,
        hasMore: { type: 'boolean' }, field: fieldSchema, period: countSchema,
        points: { type: 'array', maxItems: CHART_DATA_LIMITS.maxPageRows,
          items: objectSchema({ time: numberSchema, ready: { type: 'boolean' }, value: numberSchema }, ['time', 'ready']) },
      }, ['source', 'capturedAtMs', 'offset', 'nextOffset', 'totalRows', 'hasMore', 'field', 'period', 'points']),
      run: (raw, execution) => {
        const input = raw as Input;
        const dataset = datasetForCompute(store, marketStore, input, execution);
        const offset = (input.offset ?? 0) as number;
        if (offset > dataset.rows.length) throw new CapabilityError('invalid_request');
        const end = Math.min(dataset.rows.length, offset + ((input.limit ?? CHART_DATA_LIMITS.defaultPageRows) as number));
        const field = input.field as string;
        const period = input.period as number;
        const values = selectedDatasetValues(dataset, field, 0, end, execution);
        const calculated = sma(values, period);
        if (calculated.some(value => value !== null && !Number.isFinite(value))) throw new CapabilityError('numeric_overflow');
        execution.checkpoint();
        return {
          ...dataset.reference, offset, nextOffset: end, totalRows: dataset.rows.length,
          hasMore: end < dataset.rows.length, field, period,
          points: dataset.rows.slice(offset, end).map((row, index): JsonValue => {
            const value = calculated[offset + index];
            return value === null ? { time: row.time, ready: false } : { time: row.time, ready: true, value };
          }),
        };
      },
    },
  ];
}
