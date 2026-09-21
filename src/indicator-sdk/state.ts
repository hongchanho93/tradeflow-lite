import type {
  SavedIndicatorEnvelope,
  SavedIndicatorState,
  SavedUserIndicatorState,
} from './contracts';
import type { IndicatorRegistry } from './registry';

export const INDICATOR_STATE_STORAGE_KEY = 'tradeflow-lite.indicators.v1';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export type LoadedIndicatorState = {
  readonly instances: readonly SavedIndicatorState[];
  readonly unresolvedEntries: readonly unknown[];
  readonly mainOverlayOrder: SavedIndicatorEnvelope['mainOverlayOrder'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function structurallyValidInstance(value: unknown): value is SavedIndicatorState {
  if (!isRecord(value)
    || typeof value.instanceId !== 'string'
    || !value.instanceId.trim()
    || typeof value.indicatorId !== 'string'
    || typeof value.indicatorVersion !== 'number'
    || !Number.isInteger(value.indicatorVersion)
    || value.indicatorVersion < 1
    || typeof value.visible !== 'boolean'
    || typeof value.menuOrder !== 'number'
    || !Number.isInteger(value.menuOrder)
    || !isRecord(value.inputs)
    || !Array.isArray(value.panes)) return false;
  return value.panes.every((pane) => isRecord(pane)
    && typeof pane.key === 'string'
    && pane.key !== 'main'
    && typeof pane.renderOrder === 'number'
    && Number.isInteger(pane.renderOrder)
    && typeof pane.height === 'number'
    && Number.isFinite(pane.height)
    && pane.height > 0);
}

function recognizedInstance(value: unknown, registry: IndicatorRegistry): value is SavedIndicatorState {
  if (!structurallyValidInstance(value)) return false;
  const runtimeKind = value.runtimeKind ?? 'trusted';
  return runtimeKind === 'trusted'
    && value.sourceHash === undefined
    && registry.has(value.indicatorId);
}

const SOURCE_HASH = /^[0-9a-f]{64}$/;

export function isSavedUserIndicatorState(value: unknown): value is SavedUserIndicatorState {
  return structurallyValidInstance(value)
    && value.runtimeKind === 'user'
    && typeof value.sourceHash === 'string'
    && SOURCE_HASH.test(value.sourceHash);
}

export type UserIndicatorStateLibraryRecord = Readonly<{
  id: string;
  sourceHash: string;
  indicatorVersion: number;
}>;

export type ResolvedUserIndicatorState = Readonly<{
  instances: readonly SavedUserIndicatorState[];
  unresolvedEntries: readonly unknown[];
}>;

/**
 * User indicators are intentionally resolved after synchronous localStorage
 * loading. IndexedDB is asynchronous, so the first pass preserves user
 * entries verbatim as unresolved; this second pass only activates an entry
 * when the exact imported source hash and indicator version are still present.
 */
export function resolveUserIndicatorStateEntries(
  unresolvedEntries: readonly unknown[],
  libraryRecords: readonly UserIndicatorStateLibraryRecord[],
  occupiedInstanceIds: ReadonlySet<string> = new Set(),
): ResolvedUserIndicatorState {
  const library = new Map<string, UserIndicatorStateLibraryRecord>();
  const duplicateLibraryIds = new Set<string>();
  for (const record of libraryRecords) {
    if (!record.id || typeof record.sourceHash !== 'string' || !SOURCE_HASH.test(record.sourceHash)) continue;
    if (!Number.isInteger(record.indicatorVersion) || record.indicatorVersion < 1) continue;
    if (library.has(record.id)) {
      duplicateLibraryIds.add(record.id);
      library.delete(record.id);
      continue;
    }
    if (!duplicateLibraryIds.has(record.id)) library.set(record.id, record);
  }

  const instanceIds = new Set(occupiedInstanceIds);
  const instances: SavedUserIndicatorState[] = [];
  const stillUnresolved: unknown[] = [];
  for (const entry of unresolvedEntries) {
    if (!isSavedUserIndicatorState(entry)) {
      stillUnresolved.push(entry);
      continue;
    }
    const installed = library.get(entry.indicatorId);
    if (!installed
      || installed.sourceHash !== entry.sourceHash
      || installed.indicatorVersion !== entry.indicatorVersion
      || instanceIds.has(entry.instanceId)) {
      stillUnresolved.push(entry);
      continue;
    }
    instanceIds.add(entry.instanceId);
    instances.push(entry);
  }
  instances.sort((left, right) => left.menuOrder - right.menuOrder);
  return {
    instances,
    unresolvedEntries: stillUnresolved,
  };
}

function validMainOverlayOrder(value: unknown): value is SavedIndicatorEnvelope['mainOverlayOrder'] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry)
    && (entry.type === 'volume'
      || (entry.type === 'indicator' && typeof entry.instanceId === 'string' && entry.instanceId.length > 0)));
}

export function legacyIndicatorInstanceId(indicatorId: string): string {
  return indicatorId.startsWith('builtin.') ? indicatorId.slice('builtin.'.length) : `${indicatorId}:1`;
}

export function loadIndicatorState(
  storage: StorageReader,
  registry: IndicatorRegistry,
  legacyActive: readonly string[] = [],
  legacyHidden: ReadonlySet<string> = new Set(),
): LoadedIndicatorState {
  try {
    const raw = storage.getItem(INDICATOR_STATE_STORAGE_KEY);
    if (raw) {
      const envelope = JSON.parse(raw) as unknown;
      if (isRecord(envelope)
        && envelope.schemaVersion === 1
        && Array.isArray(envelope.instances)) {
        const instances: SavedIndicatorState[] = [];
        const unresolvedEntries: unknown[] = [];
        const instanceIds = new Set<string>();
        for (const entry of envelope.instances) {
          if (recognizedInstance(entry, registry) && !instanceIds.has(entry.instanceId)) {
            instances.push(entry);
            instanceIds.add(entry.instanceId);
          } else {
            unresolvedEntries.push(entry);
          }
        }
        instances.sort((left, right) => left.menuOrder - right.menuOrder);
        const mainOverlayOrder = validMainOverlayOrder(envelope.mainOverlayOrder)
          ? envelope.mainOverlayOrder
          : [
              { type: 'volume' as const },
              ...instances.map((instance) => ({ type: 'indicator' as const, instanceId: instance.instanceId })),
            ];
        return { instances, unresolvedEntries, mainOverlayOrder };
      }
    }
  } catch {
    // Corrupt storage falls back to the previous fixed preferences below.
  }
  const instances = legacyActive.flatMap((legacyId, menuOrder) => {
    const indicatorId = legacyId.startsWith('builtin.') ? legacyId : `builtin.${legacyId}`;
    const definition = registry.get(indicatorId);
    if (!definition) return [];
    return [{
      instanceId: legacyIndicatorInstanceId(indicatorId),
      indicatorId,
      indicatorVersion: definition.indicatorVersion,
      visible: !legacyHidden.has(legacyId),
      menuOrder,
      panes: [],
      inputs: {},
    } satisfies SavedIndicatorState];
  });
  return {
    instances,
    unresolvedEntries: [],
    mainOverlayOrder: [
      { type: 'volume' },
      ...instances.map((instance) => ({ type: 'indicator' as const, instanceId: instance.instanceId })),
    ],
  };
}

export function saveIndicatorState(
  storage: StorageWriter,
  state: LoadedIndicatorState,
): boolean {
  const envelope: SavedIndicatorEnvelope = {
    schemaVersion: 1,
    instances: [...state.instances, ...state.unresolvedEntries],
    mainOverlayOrder: state.mainOverlayOrder,
  };
  try {
    storage.setItem(INDICATOR_STATE_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}
