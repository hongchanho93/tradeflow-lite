import type {
  ChartKind,
  IndicatorBar,
  IndicatorBarStyle,
  IndicatorBarStyleContribution,
  IndicatorMainSeriesApi,
  IndicatorMarker,
  IndicatorMarkerContribution,
} from './contracts';

type StyleSlot = {
  key: string;
  priority: number;
  chartKinds: readonly ChartKind[];
  provider: ((bar: IndicatorBar, index: number) => IndicatorBarStyle | null) | null;
};

type MarkerSlot = {
  key: string;
  priority: number;
  chartKinds: readonly ChartKind[];
  markers: readonly IndicatorMarker[];
};

type InstanceSlot = {
  generation: number;
  visible: boolean;
  styles: Map<string, StyleSlot>;
  markers: Map<string, MarkerSlot>;
  claimedStyles: Set<string>;
  claimedMarkers: Set<string>;
  bindingSnapshot: {
    styles: Map<string, StyleSlot>;
    markers: Map<string, MarkerSlot>;
  } | null;
};

function keyOf(instanceId: string, key: string): string {
  if (!key.trim()) throw new Error('indicator contribution key must be non-empty');
  return `${instanceId}:${key}`;
}

export class IndicatorMainSeriesHost {
  private readonly instances = new Map<string, InstanceSlot>();
  private readonly chartKind: () => ChartKind;
  private readonly invalidateBars: (changedFrom: number) => void;
  private readonly invalidateMarkers: () => void;

  constructor(
    chartKind: () => ChartKind,
    invalidateBars: (changedFrom: number) => void,
    invalidateMarkers: () => void,
  ) {
    this.chartKind = chartKind;
    this.invalidateBars = invalidateBars;
    this.invalidateMarkers = invalidateMarkers;
  }

  private slot(instanceId: string): InstanceSlot {
    let slot = this.instances.get(instanceId);
    if (!slot) {
      slot = {
        generation: 0,
        visible: true,
        styles: new Map(),
        markers: new Map(),
        claimedStyles: new Set(),
        claimedMarkers: new Set(),
        bindingSnapshot: null,
      };
      this.instances.set(instanceId, slot);
    }
    return slot;
  }

  beginBinding(instanceId: string): IndicatorMainSeriesApi {
    const slot = this.slot(instanceId);
    slot.generation += 1;
    const generation = slot.generation;
    slot.bindingSnapshot = {
      styles: new Map(slot.styles),
      markers: new Map(slot.markers),
    };
    const assertCurrent = () => {
      if (slot.generation !== generation) {
        throw new Error(`indicator ${instanceId} main-series contribution belongs to a stale execution generation`);
      }
    };
    slot.claimedStyles.clear();
    slot.claimedMarkers.clear();
    for (const style of slot.styles.values()) style.provider = null;
    for (const marker of slot.markers.values()) marker.markers = [];
    this.invalidateMarkers();
    this.invalidateBars(0);
    return {
      createBarStyleContribution: (definition) => {
        const key = keyOf(instanceId, definition.key);
        slot.claimedStyles.add(key);
        let resource = slot.styles.get(key);
        if (!resource) {
          resource = { ...definition, key, provider: null };
          slot.styles.set(key, resource);
        } else {
          resource.priority = definition.priority;
          resource.chartKinds = [...definition.chartKinds];
        }
        const contribution: IndicatorBarStyleContribution = {
          key: definition.key,
          setProvider: (provider) => {
            assertCurrent();
            resource!.provider = provider;
          },
          invalidateFrom: (changedFrom) => {
            assertCurrent();
            if (slot.visible) this.invalidateBars(changedFrom);
          },
        };
        return contribution;
      },
      createMarkerContribution: (definition) => {
        const key = keyOf(instanceId, definition.key);
        slot.claimedMarkers.add(key);
        let resource = slot.markers.get(key);
        if (!resource) {
          resource = { ...definition, key, markers: [] };
          slot.markers.set(key, resource);
        } else {
          resource.priority = definition.priority;
          resource.chartKinds = [...definition.chartKinds];
        }
        const contribution: IndicatorMarkerContribution = {
          key: definition.key,
          set: (markers) => {
            assertCurrent();
            resource!.markers = Object.freeze(markers.map((marker) => Object.freeze({ ...marker })));
            if (slot.visible) this.invalidateMarkers();
          },
        };
        return contribution;
      },
    };
  }

  finishBinding(instanceId: string): void {
    const slot = this.instances.get(instanceId);
    if (!slot) return;
    for (const key of slot.styles.keys()) if (!slot.claimedStyles.has(key)) slot.styles.delete(key);
    for (const key of slot.markers.keys()) if (!slot.claimedMarkers.has(key)) slot.markers.delete(key);
    slot.bindingSnapshot = null;
    this.invalidateBars(0);
    this.invalidateMarkers();
  }

  abortBinding(instanceId: string): void {
    const slot = this.instances.get(instanceId);
    if (!slot?.bindingSnapshot) return;
    slot.generation += 1;
    slot.styles = new Map(slot.bindingSnapshot.styles);
    slot.markers = new Map(slot.bindingSnapshot.markers);
    slot.bindingSnapshot = null;
    for (const style of slot.styles.values()) style.provider = null;
    for (const marker of slot.markers.values()) marker.markers = [];
    this.invalidateBars(0);
    this.invalidateMarkers();
  }

  clear(instanceId: string): void {
    const slot = this.instances.get(instanceId);
    if (!slot) return;
    for (const style of slot.styles.values()) style.provider = null;
    for (const marker of slot.markers.values()) marker.markers = [];
    this.invalidateBars(0);
    this.invalidateMarkers();
  }

  setVisible(instanceId: string, visible: boolean): void {
    const slot = this.instances.get(instanceId);
    if (!slot) return;
    slot.visible = visible;
    this.invalidateBars(0);
    this.invalidateMarkers();
  }

  remove(instanceId: string): void {
    const slot = this.instances.get(instanceId);
    if (!slot) return;
    slot.generation += 1;
    this.instances.delete(instanceId);
    this.invalidateBars(0);
    this.invalidateMarkers();
  }

  styleFor(bar: IndicatorBar, index: number): IndicatorBarStyle {
    const result: Record<string, string> = {};
    const kind = this.chartKind();
    const entries = [...this.instances.entries()]
      .filter(([, slot]) => slot.visible)
      .flatMap(([instanceId, slot]) => [...slot.styles.values()].map((style) => ({ instanceId, style })))
      .filter(({ style }) => style.provider && style.chartKinds.includes(kind))
      .sort((left, right) => left.style.priority - right.style.priority
        || left.instanceId.localeCompare(right.instanceId)
        || left.style.key.localeCompare(right.style.key));
    for (const { style } of entries) Object.assign(result, style.provider?.(bar, index) ?? {});
    return result;
  }

  markerValues(): readonly IndicatorMarker[] {
    const kind = this.chartKind();
    return [...this.instances.entries()]
      .filter(([, slot]) => slot.visible)
      .flatMap(([instanceId, slot]) => [...slot.markers.values()].map((markers) => ({ instanceId, markers })))
      .filter(({ markers }) => markers.chartKinds.includes(kind))
      .sort((left, right) => left.markers.priority - right.markers.priority
        || left.instanceId.localeCompare(right.instanceId)
        || left.markers.key.localeCompare(right.markers.key))
      .flatMap(({ markers }) => markers.markers)
      .sort((left, right) => left.time - right.time);
  }
}
