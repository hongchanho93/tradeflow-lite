export const DRAWING_STORAGE_KEY = 'tradeflow-lite.drawings.v1';
const MAX_SCOPES = 200;
const MAX_DRAWINGS_PER_SCOPE = 500;
const MAX_SERIALIZED_BYTES = 2_000_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type DrawingExport = {
  id: string;
  toolType: string;
  points: Array<{ timestamp: number; price: number }>;
  options: Record<string, unknown>;
};

export function drawingScope(symbol: string, adjustment: string): string {
  return `${symbol}|${adjustment}`;
}

function normalizeSnapshot(value: unknown, knownTypes: Set<string>): DrawingExport[] | null {
  if (!Array.isArray(value) || value.length > MAX_DRAWINGS_PER_SCOPE) return null;
  const ids = new Set<string>();
  const drawings: DrawingExport[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const drawing = item as Partial<DrawingExport>;
    if (typeof drawing.id !== 'string' || !drawing.id || ids.has(drawing.id)) return null;
    if (typeof drawing.toolType !== 'string' || !knownTypes.has(drawing.toolType)) return null;
    if (!Array.isArray(drawing.points) || drawing.points.length > 20_000) return null;
    if (!drawing.points.every((point) => point
      && Number.isFinite(point.timestamp)
      && Number.isFinite(point.price))) return null;
    if (!drawing.options || typeof drawing.options !== 'object' || Array.isArray(drawing.options)) return null;
    ids.add(drawing.id);
    drawings.push(drawing as DrawingExport);
  }
  return drawings;
}

export function validateDrawingSnapshot(json: string, knownTypes: Set<string>): string | null {
  if (json.length > MAX_SERIALIZED_BYTES) return null;
  try {
    const drawings = normalizeSnapshot(JSON.parse(json), knownTypes);
    return drawings ? JSON.stringify(drawings) : null;
  } catch {
    return null;
  }
}

export function loadDrawingScopes(storage: StorageLike, knownTypes: Set<string>): Map<string, string> {
  const scopes = new Map<string, string>();
  try {
    const parsed = JSON.parse(storage.getItem(DRAWING_STORAGE_KEY) ?? 'null');
    if (parsed?.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object') return scopes;
    for (const [scope, value] of Object.entries(parsed.scopes).slice(0, MAX_SCOPES)) {
      if (!/^(SH|SZ|BJ):\d{6}\|(none|qfq)$/.test(scope)) continue;
      const snapshot = validateDrawingSnapshot(JSON.stringify(value), knownTypes);
      if (snapshot) scopes.set(scope, snapshot);
    }
  } catch {
    return scopes;
  }
  return scopes;
}

export function saveDrawingScopes(storage: StorageLike, scopes: Map<string, string>): boolean {
  try {
    const serializedScopes = Object.fromEntries(
      [...scopes.entries()].slice(-MAX_SCOPES).map(([scope, snapshot]) => [scope, JSON.parse(snapshot)]),
    );
    const value = JSON.stringify({ version: 1, scopes: serializedScopes });
    if (value.length > MAX_SERIALIZED_BYTES) return false;
    storage.setItem(DRAWING_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export class DrawingHistory {
  private past: string[];
  private future: string[] = [];
  private readonly limit: number;

  constructor(initialSnapshot: string, limit = 50) {
    this.past = [initialSnapshot];
    this.limit = limit;
  }

  record(snapshot: string): void {
    if (snapshot === this.past.at(-1)) return;
    this.past.push(snapshot);
    if (this.past.length > this.limit + 1) this.past.shift();
    this.future = [];
  }

  undo(): string | null {
    if (this.past.length <= 1) return null;
    this.future.push(this.past.pop() as string);
    return this.past.at(-1) as string;
  }

  redo(): string | null {
    const snapshot = this.future.pop();
    if (snapshot === undefined) return null;
    this.past.push(snapshot);
    return snapshot;
  }

  get canUndo(): boolean { return this.past.length > 1; }
  get canRedo(): boolean { return this.future.length > 0; }
}
