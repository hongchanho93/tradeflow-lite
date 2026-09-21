import type { DrawingExport } from '../drawing-state.ts';
import { CapabilityError } from './contracts.ts';

type Primitive = object;
type Drawable = Primitive & { id(): string; getExportData(): DrawingExport; setPoints(points: DrawingExport['points']): void };
type PanePort = { detachPrimitive(primitive: any): void };
type SeriesPort = { attachPrimitive(primitive: any): void; detachPrimitive(primitive: any): void; getPane?(): PanePort };
function isDrawing(value: Primitive): value is Drawable {
  return typeof (value as Drawable).id === 'function' && typeof (value as Drawable).getExportData === 'function';
}

/** Decorate only two PUBLIC series methods, retaining its original identity.
 * Tracks all primitives, not just drawings, so restoring order does not move an
 * indicator/marker overlay above or below unrelated primitives. No private maps.
 */
export class DrawingAttachments {
  readonly #attach: (primitive: Primitive) => void;
  readonly #detach: (primitive: Primitive) => void;
  readonly #panes = new WeakSet<PanePort>();
  #order: Primitive[] = [];
  #faulted = false;
  constructor(series: SeriesPort) {
    this.#attach = series.attachPrimitive.bind(series);
    this.#detach = series.detachPrimitive.bind(series);
    series.attachPrimitive = primitive => {
      if (!this.#order.includes(primitive)) this.#order.push(primitive);
      try { this.#attach(primitive); this.#bindPane(series); } catch (error) { this.#faulted = true; throw error; }
    };
    series.detachPrimitive = primitive => {
      try { this.#detach(primitive); } catch (error) { this.#faulted = true; throw error; }
      this.#order = this.#order.filter(item => item !== primitive);
    };
    this.#bindPane(series);
  }

  /** The pinned vendor attaches drawings to a SERIES, but InteractionManager
   * removes them through getPane().detachPrimitive(). Those are separate LWC
   * registries. Route only drawings owned here back to their real series; leave
   * pane-native primitives and other series untouched. Keep all API identities.
   */
  #bindPane(series: SeriesPort): void {
    const pane = series.getPane?.();
    if (!pane || this.#panes.has(pane)) return;
    const detachPane = pane.detachPrimitive.bind(pane);
    pane.detachPrimitive = primitive => {
      if (this.#order.includes(primitive) && isDrawing(primitive)) series.detachPrimitive(primitive);
      else detachPane(primitive);
    };
    this.#panes.add(pane);
  }
  get faulted(): boolean { return this.#faulted; }
  drawing(id: string): Drawable | undefined { return this.#order.find(item => isDrawing(item) && item.id() === id) as Drawable | undefined; }
  export(): DrawingExport[] { return this.#order.filter(isDrawing).map(item => item.getExportData()); }
  checkpoint(): readonly Primitive[] { return [...this.#order]; }

  /** Reorder live handles only; never destroy/recreate unrelated objects. */
  restore(checkpoint: readonly Primitive[], oldDrawingOrder: readonly string[]): void {
    const drawingById = new Map(this.#order.filter(isDrawing).map(item => [item.id(), item]));
    const included = new Set<Primitive>();
    const next: Primitive[] = [];
    for (const old of checkpoint) {
      const live = isDrawing(old) ? drawingById.get(old.id()) : this.#order.includes(old) ? old : undefined;
      if (live && !included.has(live)) { next.push(live); included.add(live); }
    }
    for (const live of this.#order) if (!included.has(live)) next.push(live);
    // Saved receipts do not serialize primitive references. Insert recreated
    // drawings next to their surviving original neighbours, preserving others.
    const positions = new Map(oldDrawingOrder.map((id, i) => [id, i]));
    for (const id of [...oldDrawingOrder].reverse()) {
      const handle = drawingById.get(id);
      if (!handle || checkpoint.some(p => isDrawing(p) && p.id() === id)) continue;
      const current = next.indexOf(handle); next.splice(current, 1);
      const successor = next.findIndex(item => isDrawing(item) && positions.has(item.id())
        && positions.get(item.id())! > positions.get(id)!);
      if (successor >= 0) next.splice(successor, 0, handle);
      else {
        let predecessor = -1;
        next.forEach((item, index) => {
          if (isDrawing(item) && positions.has(item.id()) && positions.get(item.id())! < positions.get(id)!) predecessor = index;
        });
        if (predecessor >= 0) next.splice(predecessor + 1, 0, handle);
        else next.push(handle);
      }
    }
    const first = this.#faulted ? 0 : next.findIndex((primitive, i) => primitive !== this.#order[i]);
    if (first < 0) return;
    const previous = this.#order;
    // Keep the complete logical roster while reattaching. A partial native
    // failure must not make a still-live, merely detached object disappear from
    // export/persistence. Rollback reattaches the roster instead of losing it.
    this.#order = next;
    try {
      for (const primitive of previous.slice(first)) this.#detach(primitive);
      for (const primitive of next.slice(first)) this.#attach(primitive);
    } catch (error) {
      this.#faulted = true;
      throw error;
    }
    this.#faulted = false;
    if (this.#order.length !== next.length || next.some((item, i) => this.#order[i] !== item)) {
      throw new CapabilityError('drawing_host_failed');
    }
  }
}
