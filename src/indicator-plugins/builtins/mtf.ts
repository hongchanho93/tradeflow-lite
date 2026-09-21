import type { IndicatorContext, IndicatorDataRequest } from '../../indicator-sdk/contracts.ts';

export const SOURCE_RESOLUTION_OPTIONS = [
  { value: 'current', label: { 'zh-CN': '当前图表', 'en-US': 'Current chart' } },
  { value: '1', label: '1 分钟' },
  { value: '5', label: '5 分钟' },
  { value: '15', label: '15 分钟' },
  { value: '30', label: '30 分钟' },
  { value: '60', label: '1 小时' },
  { value: '120', label: '2 小时' },
  { value: '240', label: '4 小时' },
  { value: '1D', label: '日线' },
  { value: '1W', label: '周线' },
  { value: '1M', label: '月线' },
] as const;

export type SourceResolution = typeof SOURCE_RESOLUTION_OPTIONS[number]['value'];

export function sourceDataRequests(
  sourceResolution: SourceResolution,
  selection: IndicatorContext['selection'],
): readonly IndicatorDataRequest[] {
  if (sourceResolution === 'current' || sourceResolution === selection.resolution) return [];
  return [{
    key: 'source',
    resolution: sourceResolution,
    count: sourceResolution === '1D' ? 12_000 : 8_000,
    adjustment: 'current',
  }];
}

