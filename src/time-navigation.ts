export type TimeRangePreset = '1d' | '5d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'all';

type Timed = { time: number };

export type CalendarDay = { iso: string; day: number; inMonth: boolean };

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function calendarMonthDays(year: number, month: number): CalendarDay[] {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - firstWeekday + 1));
    return {
      iso: isoDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    };
  });
}

export function resolutionShowsIntradayTime(resolution: string) {
  return ['1', '5', '15', '30', '60', '120', '240'].includes(resolution);
}

function subtractUtcMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp * 1000);
  date.setUTCMonth(date.getUTCMonth() - months);
  return Math.floor(date.getTime() / 1000);
}

function subtractUtcDays(timestamp: number, days: number): number {
  return timestamp - days * 86_400;
}

export function visibleRangeForPreset(bars: Timed[], preset: TimeRangePreset) {
  if (bars.length === 0) return null;
  const last = bars.at(-1)!.time;
  let target = bars[0].time;
  if (preset === '1d') target = subtractUtcDays(last, 1);
  if (preset === '5d') target = subtractUtcDays(last, 5);
  if (preset === '1m') target = subtractUtcMonths(last, 1);
  if (preset === '3m') target = subtractUtcMonths(last, 3);
  if (preset === '6m') target = subtractUtcMonths(last, 6);
  if (preset === '1y') target = subtractUtcMonths(last, 12);
  if (preset === '5y') target = subtractUtcMonths(last, 60);
  if (preset === 'ytd') {
    const date = new Date(last * 1000);
    target = Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / 1000);
  }
  const first = bars.find((bar) => bar.time >= target)?.time ?? bars[0].time;
  return { from: first, to: last };
}

export function parseShanghaiDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export function nearestBarIndex(bars: Timed[], timestamp: number): number | null {
  if (bars.length === 0 || !Number.isFinite(timestamp)) return null;
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].time < timestamp) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  return Math.abs(bars[low].time - timestamp) < Math.abs(bars[low - 1].time - timestamp) ? low : low - 1;
}

export function logicalRangeAround(index: number, total: number, width = 120) {
  const safeWidth = Math.max(10, Math.min(width, Math.max(total, 10)));
  const from = Math.max(-2, Math.min(index - safeWidth / 2, total - safeWidth + 2));
  return { from, to: from + safeWidth };
}
