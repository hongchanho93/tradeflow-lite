export type Resolution = '1' | '5' | '15' | '30' | '60' | '120' | '240' | '1D' | '1W' | '1M';

export type ResolutionGroup = '分钟' | '小时' | '天';

export type ResolutionOption = {
  value: Resolution;
  label: string;
  shortLabel: string;
  group: ResolutionGroup;
};

export const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: '1', label: '1 分钟', shortLabel: '1分', group: '分钟' },
  { value: '5', label: '5 分钟', shortLabel: '5分', group: '分钟' },
  { value: '15', label: '15 分钟', shortLabel: '15分', group: '分钟' },
  { value: '30', label: '30 分钟', shortLabel: '30分', group: '分钟' },
  { value: '60', label: '1 小时', shortLabel: '1小时', group: '小时' },
  { value: '120', label: '2 小时', shortLabel: '2小时', group: '小时' },
  { value: '240', label: '4 小时', shortLabel: '4小时', group: '小时' },
  { value: '1D', label: '1 日', shortLabel: '日', group: '天' },
  { value: '1W', label: '1 周', shortLabel: '周', group: '天' },
  { value: '1M', label: '1 月', shortLabel: '月', group: '天' },
];

export const DEFAULT_FAVORITE_RESOLUTIONS: readonly Resolution[] = ['1', '5', '15', '30', '60', '1D'];
export const RESOLUTION_FAVORITES_KEY = 'tradeflow_lite_resolution_favorites_v1';

const knownResolutions = new Set<Resolution>(RESOLUTION_OPTIONS.map((option) => option.value));

export function loadFavoriteResolutions(storage: Pick<Storage, 'getItem'>): Resolution[] {
  try {
    const parsed = JSON.parse(storage.getItem(RESOLUTION_FAVORITES_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [...DEFAULT_FAVORITE_RESOLUTIONS];
    const favorites = parsed.filter((value): value is Resolution => knownResolutions.has(value));
    return [...new Set(favorites)];
  } catch {
    return [...DEFAULT_FAVORITE_RESOLUTIONS];
  }
}

export function saveFavoriteResolutions(
  storage: Pick<Storage, 'setItem'>,
  favorites: readonly Resolution[],
): boolean {
  try {
    storage.setItem(RESOLUTION_FAVORITES_KEY, JSON.stringify(favorites));
    return true;
  } catch {
    return false;
  }
}

export function toggleFavoriteResolution(
  favorites: readonly Resolution[],
  resolution: Resolution,
): Resolution[] {
  const selected = new Set(favorites);
  if (selected.has(resolution)) selected.delete(resolution);
  else selected.add(resolution);
  return RESOLUTION_OPTIONS.map((option) => option.value).filter((value) => selected.has(value));
}

export type TradingTimeChoice = 'exchange' | 'system' | string;

export type TradingTimeZoneOption = {
  value: TradingTimeChoice;
  label: string;
};

export const TRADING_TIME_KEY = 'tradeflow_lite_trading_time_v1';

export const TRADING_TIME_ZONE_OPTIONS: readonly TradingTimeZoneOption[] = [
  { value: 'UTC', label: '世界统一时间' },
  { value: 'exchange', label: '交易所' },
  { value: 'system', label: '系统时间' },
  { value: 'Pacific/Honolulu', label: '檀香山' },
  { value: 'America/Anchorage', label: '安克雷奇' },
  { value: 'America/Juneau', label: '朱诺' },
  { value: 'America/Los_Angeles', label: '洛杉矶' },
  { value: 'America/Vancouver', label: '温哥华' },
  { value: 'America/Phoenix', label: '菲尼克斯' },
  { value: 'America/Denver', label: '丹佛' },
  { value: 'America/Mexico_City', label: '墨西哥城' },
  { value: 'America/El_Salvador', label: '圣萨尔瓦多' },
  { value: 'America/Chicago', label: '芝加哥' },
  { value: 'America/Bogota', label: '波哥大' },
  { value: 'America/Lima', label: '利马' },
  { value: 'America/New_York', label: '纽约' },
  { value: 'America/Toronto', label: '多伦多' },
  { value: 'America/Halifax', label: '哈利法克斯' },
  { value: 'America/Sao_Paulo', label: '圣保罗' },
  { value: 'Atlantic/Azores', label: '亚速尔群岛' },
  { value: 'Europe/London', label: '伦敦' },
  { value: 'Europe/Paris', label: '巴黎' },
  { value: 'Europe/Berlin', label: '柏林' },
  { value: 'Europe/Zurich', label: '苏黎世' },
  { value: 'Europe/Vilnius', label: '维尔纽斯' },
  { value: 'Africa/Johannesburg', label: '约翰内斯堡' },
  { value: 'Africa/Cairo', label: '开罗' },
  { value: 'Europe/Moscow', label: '莫斯科' },
  { value: 'Asia/Dubai', label: '迪拜' },
  { value: 'Asia/Kolkata', label: '加尔各答' },
  { value: 'Asia/Bangkok', label: '曼谷' },
  { value: 'Asia/Singapore', label: '新加坡' },
  { value: 'Asia/Shanghai', label: '上海' },
  { value: 'Asia/Hong_Kong', label: '香港' },
  { value: 'Asia/Tokyo', label: '东京' },
  { value: 'Asia/Seoul', label: '首尔' },
  { value: 'Australia/Sydney', label: '悉尼' },
  { value: 'Pacific/Auckland', label: '奥克兰' },
];

const knownTradingTimeChoices = new Set(TRADING_TIME_ZONE_OPTIONS.map((option) => option.value));

export function loadTradingTimeChoice(storage: Pick<Storage, 'getItem'>): TradingTimeChoice {
  try {
    const value = storage.getItem(TRADING_TIME_KEY);
    return value && knownTradingTimeChoices.has(value) ? value : 'exchange';
  } catch {
    return 'exchange';
  }
}

export function saveTradingTimeChoice(
  storage: Pick<Storage, 'setItem'>,
  choice: TradingTimeChoice,
): boolean {
  try {
    storage.setItem(TRADING_TIME_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

export function resolveTradingTimeZone(
  choice: TradingTimeChoice,
  exchangeTimeZone: string,
  systemTimeZone: string,
): string {
  if (choice === 'exchange') return exchangeTimeZone;
  if (choice === 'system') return systemTimeZone;
  return choice;
}

export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const localAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    hour, Number(values.minute), Number(values.second),
  );
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `UTC${sign}${hours}${remainder ? `:${String(remainder).padStart(2, '0')}` : ''}`;
}
