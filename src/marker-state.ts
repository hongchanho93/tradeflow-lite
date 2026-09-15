import { isCanonicalMarketSymbol } from './market-universe.ts';

export type MarkerShape = 'circle' | 'square' | 'arrowUp' | 'arrowDown';
export type MarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';

export type ChartMarker = {
  id: string;
  time: number;
  position: MarkerPosition;
  shape: MarkerShape;
  color: string;
  text: string;
  size: number;
  visible: boolean;
};

export const MARKER_STORAGE_KEY = 'tradeflow-lite.markers.v1';
const MAX_SCOPES = 500;
const MAX_MARKERS_PER_SCOPE = 500;
const MAX_SERIALIZED_BYTES = 2_000_000;
const markerShapes = new Set<MarkerShape>(['circle', 'square', 'arrowUp', 'arrowDown']);
const markerPositions = new Set<MarkerPosition>(['aboveBar', 'belowBar', 'inBar']);
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function markerScope(symbol: string, adjustment: string, resolution: string, providerId?: string): string {
  return providerId === undefined
    ? `${symbol}|${adjustment}|${resolution}`
    : `${providerId}|${symbol}|${adjustment}|${resolution}`;
}

function isProviderId(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && /^[A-Za-z0-9._-]+$/.test(value);
}

function isMarkerScope(scope: string): boolean {
  const parts = scope.split('|');
  const adjustment = parts.at(-2);
  const resolution = parts.at(-1);
  if (parts.length === 3) {
    return isCanonicalMarketSymbol(parts[0])
      && (adjustment === 'none' || adjustment === 'qfq')
      && /^(1|5|15|30|60|1D|1W|1M)$/.test(resolution ?? '');
  }
  return parts.length === 4
    && isProviderId(parts[0])
    && isCanonicalMarketSymbol(parts[1])
    && (adjustment === 'none' || adjustment === 'qfq')
    && /^(1|5|15|30|60|1D|1W|1M)$/.test(resolution ?? '');
}

export function normalizeMarkers(value: unknown): ChartMarker[] | null {
  if (!Array.isArray(value) || value.length > MAX_MARKERS_PER_SCOPE) return null;
  const ids = new Set<string>();
  const markers: ChartMarker[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const marker = raw as Partial<ChartMarker>;
    if (typeof marker.id !== 'string' || marker.id.length === 0 || ids.has(marker.id)) return null;
    if (!Number.isFinite(marker.time) || !markerShapes.has(marker.shape as MarkerShape)
      || !markerPositions.has(marker.position as MarkerPosition)) return null;
    if (typeof marker.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(marker.color)) return null;
    if (typeof marker.text !== 'string' || marker.text.length > 80) return null;
    if (!Number.isInteger(marker.size) || (marker.size as number) < 1 || (marker.size as number) > 3) return null;
    if (typeof marker.visible !== 'boolean') return null;
    ids.add(marker.id);
    markers.push(marker as ChartMarker);
  }
  return markers.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

export function loadMarkerScopes(storage: StorageLike): Map<string, ChartMarker[]> {
  const scopes = new Map<string, ChartMarker[]>();
  try {
    const parsed = JSON.parse(storage.getItem(MARKER_STORAGE_KEY) ?? 'null');
    if (parsed?.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object') return scopes;
    for (const [scope, value] of Object.entries(parsed.scopes).slice(0, MAX_SCOPES)) {
      if (!isMarkerScope(scope)) continue;
      const markers = normalizeMarkers(value);
      if (markers) scopes.set(scope, markers);
    }
  } catch {
    return scopes;
  }
  return scopes;
}

export function saveMarkerScopes(storage: Pick<StorageLike, 'setItem'>, scopes: Map<string, ChartMarker[]>): boolean {
  try {
    const serialized = JSON.stringify({ version: 1, scopes: Object.fromEntries([...scopes.entries()].slice(-MAX_SCOPES)) });
    if (serialized.length > MAX_SERIALIZED_BYTES) return false;
    storage.setItem(MARKER_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
