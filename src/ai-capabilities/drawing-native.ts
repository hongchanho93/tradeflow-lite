import type { DrawingExport } from '../drawing-state.ts';
import { CapabilityError, sameSelection, type JsonValue, type SelectionRef } from './contracts.ts';
import { DEFAULT_DRAWING_TYPES, DrawingTypeRegistry, sameDrawing, type DrawingBatch, type DrawingDocumentPort,
  type DrawingSlot, type DrawingSpec, type SavedDrawingChange } from './drawing-contract.ts';
import { DrawingAttachments } from './drawing-attachments.ts';
import { DrawingJournalStorage, DRAWING_JOURNAL_LIMITS, type NativeImage, type NativeReceipt } from './drawing-journal.ts';
import { snapshotJson } from './json.ts';
import { defaultDrawingStyle, readNativeStyle, writeNativeStyle } from './drawing-style-map.ts';
import { DRAWING_COLOR_FIELDS, normalizeDrawingColor } from './drawing-colors.ts';

export interface NativeDrawingHost {
  context(): SelectionRef;
  scope(): string;
  ready(): boolean;
  locked(): boolean;
  priceStep(): number;
  roundPrice(price: number, step: number): number;
  readonly attachments: DrawingAttachments;
  readonly journal: DrawingJournalStorage;
  readonly plugin: {
    createOrUpdateLineTool(type: any, points: any, options: any, id: string): void;
    removeLineToolsById(ids: string[]): void;
    getLineToolByID(id: string): string;
  };
  /** Persist through the journal decorator; must propagate failure. */
  save(snapshot: string): void;
  /** Save UI history without exposing the global Undo stack to a model. */
  captureUi(): () => void;
  changed(): void;
}

const supported = new Set(DEFAULT_DRAWING_TYPES.map(type=>type.type));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fingerprint = (value: unknown) => snapshotJson(value, DRAWING_JOURNAL_LIMITS.maxNativeObjectBytes).text;
function color(value: unknown): string {
  try { return normalizeDrawingColor(value); } catch { throw new CapabilityError('drawing_host_failed'); }
}

/** Only this trusted adapter knows the line-tools option structure. */
export function projectNativeDrawing(raw: DrawingExport, types = new DrawingTypeRegistry()): DrawingSpec {
  if (!supported.has(raw.toolType)) throw new CapabilityError('drawing_unavailable');
  const style=readNativeStyle(raw.toolType,raw.options as Record<string,any>);
  return types.validate({ type: raw.toolType, points: raw.points.map(point => ({ time: point.timestamp, price: point.price })), style });
}

function targetNative(id: string, spec: DrawingSpec, before: DrawingExport | null): DrawingExport {
  const options=writeNativeStyle(spec.type,spec.style,before?.options??{});
  return { id, toolType: spec.type, points: spec.points.map(point => ({ timestamp: point.time, price: point.price })), options };
}

type BatchState = {
  batch: DrawingBatch; scope: string; before: NativeImage[];
  prior: NativeReceipt | undefined; order: readonly object[]; orderIds: string[];
  attempts: string[]; observed: Map<string, DrawingExport | null>;
  restoreUi: () => void; flushed: boolean; rolledBack: boolean;
};

/** Full native before-images remain host-only. Reads sent to AI are typed projections. */
export class NativeDrawingPort implements DrawingDocumentPort {
  readonly #host: NativeDrawingHost;
  readonly #types = new DrawingTypeRegistry();
  #transaction: BatchState | undefined;
  readonly #orders = new Map<string, readonly object[]>();
  #mutating = false;
  #poisoned = false;
  constructor(host: NativeDrawingHost) { this.#host = host; }
  get mutating(): boolean { return this.#mutating; }
  resetTransient(): void { if (!this.#mutating) { this.#transaction = undefined; this.#orders.clear(); } }

  #guard(write = false): void {
    this.#host.journal.assertCurrent();
    if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
    if (!this.#host.ready()) throw new CapabilityError('data_not_ready');
    if (write && this.#host.locked()) throw new CapabilityError('permission_denied');
  }
  #scene(): DrawingExport[] {
    return this.#host.attachments.export().map(raw => clone(raw));
  }
  #sync(): DrawingExport[] {
    this.#guard();
    const scene = this.#scene();
    this.#host.journal.observe(this.#host.scope(), scene);
    return scene;
  }
  #image(id: string): NativeImage { return this.#host.journal.image(this.#host.scope(), id); }
  #slot(image: NativeImage): DrawingSlot {
    return { id: image.id, version: image.version, value: image.raw === null ? null : projectNativeDrawing(image.raw, this.#types) };
  }
  read(id: string): DrawingSlot {
    this.#guard();
    this.#host.journal.observeOne(this.#host.scope(), id, this.#raw(id));
    return this.#slot(this.#image(id));
  }
  list(): readonly DrawingSlot[] {
    const rows = this.#sync();
    return rows.filter(raw => supported.has(raw.toolType)).flatMap(raw => {
      try { return [this.#slot(this.#image(raw.id))]; } catch { return []; }
    });
  }
  count(): number { return this.#sync().length; }

  normalize(id: string, spec: DrawingSpec): DrawingSpec {
    this.read(id);
    const before = this.#image(id).raw;
    const base = before ? projectNativeDrawing(before, this.#types).style : defaultDrawingStyle(spec.type);
    const style: Record<string, JsonValue> = { ...base, ...spec.style };
    for (const key of DRAWING_COLOR_FIELDS) if (style[key] !== undefined) style[key] = color(style[key]);
    if(Array.isArray(style.levels))style.levels=style.levels.map(value=>{const level=value as Record<string,JsonValue>;return {...level,color:color(level.color),opacity:level.opacity??0};});
    const step = this.#host.priceStep();
    if (!Number.isFinite(step) || step <= 0) throw new CapabilityError('drawing_host_failed');
    return this.#types.validate({ ...spec, style,
      points: spec.points.map(point => ({ time: point.time, price: this.#host.roundPrice(point.price, step) })) });
  }

  /** Called by real manual edit/save hooks. Never increments versions from a read. */
  observeManual(touched: readonly string[] = []): void {
    if (this.#mutating) throw new CapabilityError('busy');
    this.#host.journal.observe(this.#host.scope(), this.#scene(), touched);
  }

  beginBatch(batch: DrawingBatch): void {
    this.#guard(true);
    if (this.#mutating) throw new CapabilityError('busy');
    this.#sync();
    const scope = this.#host.scope();
    const prior = this.#host.journal.receipts(scope).find(item => item.id === batch.id);
    const applied = new Set(this.#host.journal.receipts(scope).filter(item => item.state === 'applied').map(item => item.id));
    for (const id of this.#orders.keys()) if (!applied.has(id)) this.#orders.delete(id);
    if (batch.direction === 'apply' && prior) throw new CapabilityError('changeset_state');
    if (batch.direction === 'revert' && (!prior || prior.state !== 'applied')) throw new CapabilityError('changeset_unavailable');
    this.#transaction = { batch, scope, prior, before: batch.deltas.map(delta => this.#image(delta.before.id)),
      order: this.#host.attachments.checkpoint(), orderIds: this.#scene().map(raw => raw.id), attempts: [], observed: new Map(),
      restoreUi: this.#host.captureUi(), flushed: false, rolledBack: false };
  }

  #raw(id: string): DrawingExport | null {
    const items = JSON.parse(this.#host.plugin.getLineToolByID(id));
    if (!Array.isArray(items) || items.length > 1 || items[0] && items[0].id !== id) throw new CapabilityError('drawing_host_failed');
    if (items[0]) fingerprint(items[0]);
    return items[0] ?? null;
  }
  #put(id: string, raw: DrawingExport | null, exact: boolean): void {
    const { plugin, attachments } = this.#host;
    if (raw === null) {
      plugin.removeLineToolsById([id]);
      if (this.#raw(id) !== null || attachments.drawing(id)) throw new CapabilityError('drawing_host_failed');
      return;
    }
    plugin.createOrUpdateLineTool(raw.toolType, clone(raw.points), clone(raw.options), id);
    const handle = attachments.drawing(id);
    if (!handle) throw new CapabilityError('drawing_host_failed');
    if (exact) handle.setPoints(clone(raw.points));
    let actual = this.#raw(id);
    if (exact && fingerprint(actual) !== fingerprint(raw)) {
      // Merge cannot remove an added property. Recreate ONLY this object, then
      // restore its layer using retained public primitive handles.
      plugin.removeLineToolsById([id]);
      plugin.createOrUpdateLineTool(raw.toolType, clone(raw.points), clone(raw.options), id);
      attachments.drawing(id)?.setPoints(clone(raw.points));
      actual = this.#raw(id);
    }
    if (!actual || (exact && fingerprint(actual) !== fingerprint(raw))) throw new CapabilityError('drawing_host_failed');
  }

  write(id: string, expectedVersion: number, value: DrawingSpec | null): void {
    this.#guard(true);
    const tx = this.#transaction;
    if (!tx || tx.flushed || tx.rolledBack || !sameSelection(tx.batch.context, this.#host.context())
        || tx.scope !== this.#host.scope()) throw new CapabilityError('context_stale');
    const current = this.read(id);
    if (current.version !== expectedVersion) throw new CapabilityError('drawing_conflict');
    const delta = tx.batch.deltas.find(item => item.before.id === id);
    if (!delta || !sameDrawing(value, delta.after) || tx.attempts.includes(id)) throw new CapabilityError('invalid_contract');
    const raw = value === null ? null : tx.batch.direction === 'revert'
      ? tx.prior!.before.find(image => image.id === id)!.raw : targetNative(id, value, this.#image(id).raw);
    tx.attempts.push(id);
    this.#mutating = true;
    try {
      this.#put(id, raw, tx.batch.direction === 'revert');
      if (this.#host.attachments.faulted) throw new CapabilityError('drawing_host_failed');
      const actual = this.#raw(id);
      if (!sameDrawing(actual === null ? null : projectNativeDrawing(actual, this.#types), value)) {
        throw new CapabilityError('drawing_host_failed');
      }
    } finally {
      this.#mutating = false;
      tx.observed.set(id, this.#raw(id));
      this.#host.journal.observeOne(tx.scope, id, tx.observed.get(id)!, true);
    }
  }

  flush(): void {
    this.#guard(true);
    const tx = this.#transaction;
    if (!tx || !sameSelection(tx.batch.context, this.#host.context()) || tx.scope !== this.#host.scope()) {
      throw new CapabilityError('context_stale');
    }
    this.#mutating = true;
    try {
      this.#host.attachments.restore(tx.batch.direction === 'revert' ? this.#orders.get(tx.batch.id) ?? tx.order : tx.order,
        tx.batch.direction === 'revert' ? tx.prior!.orderBefore : tx.orderIds);
      const after = tx.batch.deltas.map(delta => this.#image(delta.before.id));
      const receipt: NativeReceipt = tx.batch.direction === 'apply'
        ? { id: tx.batch.id, scope: tx.scope, context: tx.batch.context, state: 'applied', createdAtMs: Date.now(),
          before: tx.before, after, orderBefore: tx.orderIds }
        : { ...tx.prior!, state: 'reverted' };
      this.#host.journal.withReceipt(tx.batch.id, receipt, () => this.#host.save(JSON.stringify(this.#scene())));
      tx.flushed = true;
      if (tx.batch.direction === 'apply') this.#orders.set(tx.batch.id, tx.order);
      this.#host.changed();
    } finally { this.#mutating = false; }
  }

  rollbackBatch(): void {
    const tx = this.#transaction;
    if (!tx || tx.rolledBack) return;
    if (!sameSelection(tx.batch.context, this.#host.context()) || tx.scope !== this.#host.scope()) {
      this.#poisoned = true; throw new CapabilityError('rollback_failed');
    }
    this.#mutating = true;
    try {
      for (const id of [...tx.attempts].reverse()) {
        const before = tx.before.find(item => item.id === id)!;
        if (fingerprint(this.#raw(id)) !== fingerprint(tx.observed.get(id) ?? null)) throw new Error('intervening_edit');
        this.#put(id, before.raw, true);
      }
      this.#host.attachments.restore(tx.order, tx.orderIds);
      this.#host.journal.observe(tx.scope, this.#scene());
      const restored = tx.prior ? { ...tx.prior, after: tx.prior.after.map(image => this.#image(image.id)) } : null;
      this.#host.journal.withReceipt(tx.batch.id, restored, () => this.#host.save(JSON.stringify(this.#scene())));
      tx.restoreUi();
      if (!tx.prior) this.#orders.delete(tx.batch.id);
      tx.rolledBack = true;
    } catch {
      this.#poisoned = true; throw new CapabilityError('rollback_failed');
    } finally { this.#mutating = false; }
  }

  savedChange(id: string): SavedDrawingChange | undefined {
    this.#sync();
    const receipt = this.#host.journal.receipts(this.#host.scope()).find(item => item.id === id);
    if (!receipt) return undefined;
    // Exact raw checks cover fields deliberately absent from the AI-facing schema.
    if (receipt.state === 'applied') for (const image of receipt.after) {
      const current = this.#image(image.id);
      if (current.version !== image.version || fingerprint(current.raw) !== fingerprint(image.raw)) throw new CapabilityError('drawing_conflict');
    }
    return { id, state: receipt.state, before: receipt.before.map(image => this.#slot(image)), after: receipt.after.map(image => this.#slot(image)) };
  }
  history(): JsonValue {
    this.#sync();
    return this.#host.journal.receipts(this.#host.scope()).map(receipt => ({
      changeSetId: receipt.id, state: receipt.state, createdAtMs: receipt.createdAtMs, objectCount: receipt.before.length,
    }));
  }
}
