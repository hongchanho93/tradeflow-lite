import { CapabilityError, SELECTION_SCHEMA, type JsonValue, type SelectionRef } from './contracts.ts';
import { DRAWING_STORAGE_KEY, drawingScope, validateDrawingSnapshot, type DrawingExport } from '../drawing-state.ts';
import { validDrawingId } from './drawing-contract.ts';
import { snapshotJson, validateValue } from './json.ts';

export const DRAWING_JOURNAL_LIMITS = Object.freeze({
  maxBytes: 2_000_000, maxReceipts: 64, maxReceiptBytes: 512 * 1024,
  maxSlots: 4096, maxNativeObjectBytes: 64 * 1024,
});
export type NativeImage = { readonly id: string; readonly version: number; readonly raw: DrawingExport | null };
export type NativeReceipt = {
  readonly id: string; readonly scope: string; readonly context: SelectionRef;
  readonly state: 'applied' | 'reverted'; readonly createdAtMs: number;
  readonly before: readonly NativeImage[]; readonly after: readonly NativeImage[];
  readonly orderBefore: readonly string[];
};
type Slot = { version: number; raw: DrawingExport | null };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const fail = (): never => { throw new CapabilityError('drawing_host_failed'); };
function fields(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) fail();
}
// Native exports are trusted plain data; do not apply AI object-size limits to
// the user's existing freehand drawings. The complete saved scene stays bounded.
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One atomic storage value contains BOTH the legacy scenes and their receipts.
 * This decorator also observes ordinary user saves, including Undo/Redo and ABA.
 * No credentials, session grants, executable callbacks or pending plans are saved.
 */
export class DrawingJournalStorage implements StoragePort {
  readonly #storage: StoragePort;
  readonly #known: Set<string>;
  #loaded = false;
  #baseline: string | null = null;
  #clock = 0;
  #documents = new Map<string, Map<string, Slot>>();
  #receipts: NativeReceipt[] = [];
  #staged: { id: string; receipt: NativeReceipt | null } | undefined;
  #saves = 0;

  constructor(storage: StoragePort, knownTypes: Set<string>) { this.#storage = storage; this.#known = knownTypes; }
  getItem(key: string): string | null { return this.#storage.getItem(key); }

  #scene(value: unknown): DrawingExport[] {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return fail();
    const valid = validateDrawingSnapshot(json, this.#known);
    if (!valid) return fail();
    return JSON.parse(valid) as DrawingExport[];
  }

  #load(): void {
    if (this.#loaded) return;
    const text = this.#storage.getItem(DRAWING_STORAGE_KEY);
    if (text !== null && new TextEncoder().encode(text).length > DRAWING_JOURNAL_LIMITS.maxBytes) fail();
    try {
      const root = text === null ? { version: 1, scopes: {} } : JSON.parse(text);
      if (root?.version !== 1 || !root.scopes || typeof root.scopes !== 'object' || Array.isArray(root.scopes)) fail();
      const documents = new Map<string, Map<string, Slot>>();
      for (const [scope, raw] of Object.entries(root.scopes)) {
        const slots = new Map<string, Slot>();
        for (const drawing of this.#scene(raw)) slots.set(drawing.id, { version: 0, raw: drawing });
        documents.set(scope, slots);
      }
      const meta = root.aiDrawingJournal;
      let clock = 0;
      let receipts: NativeReceipt[] = [];
      if (meta !== undefined) {
        fields(meta, ['version', 'clock', 'slots', 'receipts']);
        if (!meta || meta.version !== 1 || !Number.isSafeInteger(meta.clock) || meta.clock < 0
            || !Array.isArray(meta.slots) || meta.slots.length > DRAWING_JOURNAL_LIMITS.maxSlots
            || !Array.isArray(meta.receipts) || meta.receipts.length > DRAWING_JOURNAL_LIMITS.maxReceipts) fail();
        clock = meta.clock;
        const seen = new Set<string>();
        for (const slot of meta.slots) {
          fields(slot, ['scope', 'id', 'version']);
          if (!slot || typeof slot.scope !== 'string' || typeof slot.id !== 'string'
              || !documents.has(slot.scope) || !Number.isSafeInteger(slot.version)
              || slot.version < 1 || slot.version > clock) fail();
          const key = JSON.stringify([slot.scope, slot.id]);
          if (seen.has(key)) fail();
          seen.add(key);
          const document = documents.get(slot.scope)!;
          document.set(slot.id, { version: slot.version, raw: document.get(slot.id)?.raw ?? null });
        }
        const ids = new Set<string>();
        receipts = meta.receipts.map((item: unknown) => {
          const receipt = this.#receipt(item);
          if (ids.has(receipt.id) || !documents.has(receipt.scope)) fail();
          if ([...receipt.before, ...receipt.after].some(image => image.version > clock)) fail();
          ids.add(receipt.id); return receipt;
        });
        // Missing current-object versions are corruption, not a new trusted epoch.
        for (const slots of documents.values()) for (const slot of slots.values()) if (!slot.version) fail();
      } else {
        for (const slots of documents.values()) for (const slot of slots.values()) slot.version = ++clock;
      }
      this.#documents = documents; this.#clock = clock; this.#receipts = receipts;
      this.#baseline = text; this.#loaded = true;
    } catch { fail(); }
  }

  #receipt(input: unknown): NativeReceipt {
    // Receipts contain full native options but are never passed to a model as tools.
    const value = snapshotJson(input, DRAWING_JOURNAL_LIMITS.maxReceiptBytes).value as unknown as NativeReceipt;
    fields(value, ['id', 'scope', 'context', 'state', 'createdAtMs', 'before', 'after', 'orderBefore']);
    if (!value || typeof value.id !== 'string' || !/^change-[a-zA-Z0-9-]+$/.test(value.id)
        || typeof value.scope !== 'string' || !['applied', 'reverted'].includes(value.state)
        || !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0
        || !value.context || !Array.isArray(value.before) || !value.before.length || value.before.length > 32
        || !Array.isArray(value.after) || value.before.length !== value.after.length
        || !Array.isArray(value.orderBefore) || value.orderBefore.length > 500
        || value.orderBefore.some(id => typeof id !== 'string')
        || new Set(value.orderBefore).size !== value.orderBefore.length) return fail();
    try { validateValue(value.context as unknown as JsonValue, SELECTION_SCHEMA); } catch { return fail(); }
    if (Object.values(value.context).some(item => typeof item === 'string' && !item.length)
        || value.scope !== drawingScope(value.context.instrument, value.context.adjustment, value.context.provider)) return fail();
    const ids = new Set<string>();
    value.before.forEach((image, i) => {
      const after = value.after[i];
      if (ids.has(image.id) || after.id !== image.id) fail();
      ids.add(image.id);
      for (const entry of [image, after]) {
        fields(entry, ['id', 'version', 'raw']);
        if (!validDrawingId(entry.id) || !Number.isSafeInteger(entry.version) || entry.version < 0
            || (entry.raw !== null && (entry.raw.id !== entry.id || entry.version === 0))) fail();
        if (entry.raw !== null) this.#scene([entry.raw]);
      }
      if (after.version <= image.version) fail();
    });
    return value;
  }

  /** Fail closed on concurrent windows/processes instead of overwriting their save. */
  assertCurrent(): void {
    this.#load();
    if (this.#storage.getItem(DRAWING_STORAGE_KEY) !== this.#baseline) throw new CapabilityError('drawing_conflict');
  }

  observe(scope: string, scene: readonly DrawingExport[], touched: readonly string[] = []): void {
    this.assertCurrent();
    let document = this.#documents.get(scope);
    if (!document) { document = new Map(); this.#documents.set(scope, document); }
    const active = new Set<string>();
    const force = new Set(touched);
    const bump = () => { if (!Number.isSafeInteger(this.#clock + 1)) fail(); return ++this.#clock; };
    for (const raw of scene) {
      active.add(raw.id);
      const old = document.get(raw.id);
      if (!old || !equal(old.raw, raw) || force.has(raw.id)) {
        document.set(raw.id, { version: bump(), raw: JSON.parse(JSON.stringify(raw)) });
      }
    }
    for (const [id, old] of document) if (!active.has(id) && old.raw !== null) {
      document.set(id, { version: bump(), raw: null });
    }
    if ([...this.#documents.values()].reduce((n, slots) => n + slots.size, 0) > DRAWING_JOURNAL_LIMITS.maxSlots) {
      throw new CapabilityError('drawing_capacity');
    }
  }

  image(scope: string, id: string): NativeImage {
    this.assertCurrent();
    const slot = this.#documents.get(scope)?.get(id);
    return { id, version: slot?.version ?? 0, raw: slot?.raw ? JSON.parse(JSON.stringify(slot.raw)) : null };
  }

  /** CAS/readback touches one object. Full-scene reconciliation belongs to the
   * batch boundary and manual saves, not every object read within a batch. */
  observeOne(scope: string, id: string, raw: DrawingExport | null, acceptedWrite = false): void {
    this.assertCurrent();
    if (raw !== null && raw.id !== id) fail();
    let document = this.#documents.get(scope);
    if (!document) { document = new Map(); this.#documents.set(scope, document); }
    const old = document.get(id);
    if (!old && raw === null) return;
    if (old && equal(old.raw, raw) && !acceptedWrite) return;
    if (!Number.isSafeInteger(this.#clock + 1)) fail();
    if (!old && [...this.#documents.values()].reduce((n, slots) => n + slots.size, 0) >= DRAWING_JOURNAL_LIMITS.maxSlots) {
      throw new CapabilityError('drawing_capacity');
    }
    document.set(id, { version: ++this.#clock, raw: raw === null ? null : JSON.parse(JSON.stringify(raw)) });
  }
  receipts(scope: string): readonly NativeReceipt[] {
    this.assertCurrent();
    return this.#receipts.filter(receipt => receipt.scope === scope);
  }

  /** Stage the record for exactly the synchronous save below. No independent log write. */
  withReceipt(id: string, receipt: NativeReceipt | null, save: () => void): void {
    this.assertCurrent();
    if (this.#staged) throw new CapabilityError('busy');
    const previousSaves = this.#saves;
    this.#staged = { id, receipt: receipt === null ? null : this.#receipt(receipt) };
    try { save(); if (this.#saves !== previousSaves + 1) fail(); }
    finally { this.#staged = undefined; }
  }

  setItem(key: string, value: string): void {
    if (key !== DRAWING_STORAGE_KEY) return fail();
    this.assertCurrent();
    const root = JSON.parse(value);
    if (root?.version !== 1 || !root.scopes || Array.isArray(root.scopes)
        || typeof root.scopes !== 'object' || Object.keys(root.scopes).length > 200) fail();
    for (const [scope, raw] of Object.entries(root.scopes)) this.observe(scope, this.#scene(raw));
    const receipts = this.#receipts.filter(receipt => Object.hasOwn(root.scopes, receipt.scope)
      && receipt.id !== this.#staged?.id);
    if (this.#staged?.receipt) receipts.push(this.#staged.receipt);
    if (receipts.length > DRAWING_JOURNAL_LIMITS.maxReceipts) throw new CapabilityError('drawing_capacity');
    if (new TextEncoder().encode(JSON.stringify(receipts)).length > DRAWING_JOURNAL_LIMITS.maxReceiptBytes) {
      throw new CapabilityError('drawing_capacity');
    }
    const referenced = new Set(receipts.flatMap(receipt => receipt.before.map(image => JSON.stringify([receipt.scope, image.id]))));
    const slots: { scope: string; id: string; version: number }[] = [];
    for (const [scope, document] of this.#documents) {
      if (!Object.hasOwn(root.scopes, scope)) continue;
      for (const [id, slot] of document) if (slot.raw || referenced.has(JSON.stringify([scope, id]))) {
        slots.push({ scope, id, version: slot.version });
      }
    }
    const text = JSON.stringify({ version: 1, scopes: root.scopes,
      aiDrawingJournal: { version: 1, clock: this.#clock, slots, receipts } });
    if (new TextEncoder().encode(text).length > DRAWING_JOURNAL_LIMITS.maxBytes) throw new CapabilityError('drawing_capacity');
    this.#storage.setItem(key, text); // Web Storage setItem is the sole commit point.
    this.#baseline = text; this.#receipts = receipts; this.#saves++;
    for (const [scope, document] of this.#documents) {
      if (!Object.hasOwn(root.scopes, scope)) { this.#documents.delete(scope); continue; }
      for (const [id, slot] of document) {
        if (slot.raw === null && !referenced.has(JSON.stringify([scope, id]))) document.delete(id);
      }
    }
  }
}
