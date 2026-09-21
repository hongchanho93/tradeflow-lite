import type { AsyncToolTransaction, ToolDefinition, ToolExecutionContext } from '../ai-capabilities/contracts.ts';
import type { CapabilityOwner } from '../ai-capabilities/registry.ts';
import { TASK_LIMITS, TaskError, exact, taskJson, text, validateTaskManifest } from './contracts.ts';
import { UserTaskManager, type ValidatedTask } from './manager.ts';
import type { TaskLibraryRecord, TaskLibraryStore } from './library-store.ts';

type Define = (validated: ValidatedTask, toolId: string, lifetime: AbortSignal) => ToolDefinition;
type Entry = { record: TaskLibraryRecord; validated?: ValidatedTask; abort?: AbortController; owner?: CapabilityOwner; toolName?: string; errorCode?: string };
export class UserTaskLibrary {
  readonly #manager: UserTaskManager; readonly #store: TaskLibraryStore; readonly #owner: (id: string) => CapabilityOwner; readonly #define: Define;
  readonly #records = new Map<string, Entry>(); readonly #listeners = new Set<() => void>(); readonly #lifetime = new AbortController();
  readonly #changes = new Set<Promise<void>>();
  #initializing?: Promise<void>; #ready = false; #busy = false; #closed = false; #corruptCount = 0;
  constructor(manager: UserTaskManager, store: TaskLibraryStore, owner: (id: string) => CapabilityOwner, define: Define) {
    this.#manager = manager; this.#store = store; this.#owner = owner; this.#define = define;
  }
  #check() { if (this.#closed) throw new TaskError('task_closed'); }
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #emit() { for (const listener of this.#listeners) { try { listener(); } catch { /* observer */ } } }
  get corruptCount() { return this.#corruptCount; }
  list() {
    this.#check(); return [...this.#records.values()].map(e => ({ id: e.record.id, revision: e.record.revision,
      name: e.record.manifest.name, version: e.record.manifest.version, status: e.validated && e.owner ? 'ready' : 'error',
      ...(e.toolName ? { toolName: e.toolName } : {}), ...(e.errorCode ? { errorCode: e.errorCode } : {}) }));
  }
  get(id: string) {
    this.#check(); const e = this.#records.get(id);
    if (!e?.validated || !e.abort || !e.owner || e.abort.signal.aborted || this.#busy) throw new TaskError('task_library_unavailable');
    return { record: e.record, validated: e.validated, signal: e.abort.signal };
  }
  async initialize(): Promise<void> {
    this.#check(); if (this.#ready) return;
    this.#initializing ??= (async () => {
      const rows = await this.#store.list(); this.#check();
      if (rows.length > TASK_LIMITS.libraryItems) throw new TaskError('task_library_limit');
      let bytes = 0;
      for (const raw of rows) {
        this.#check(); let record: TaskLibraryRecord;
        try {
          exact(raw, ['formatVersion','id','revision','source','hash','manifest','updatedAt']);
          if (raw.formatVersion !== 1 || !text(raw.id, 96) || !text(raw.revision, 128) || typeof raw.source !== 'string'
            || typeof raw.hash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.hash) || !Number.isSafeInteger(raw.updatedAt)) throw new TaskError('task_storage_corrupt');
          bytes += new TextEncoder().encode(raw.source).length;
          if (bytes > TASK_LIMITS.libraryBytes || new TextEncoder().encode(raw.source).length > TASK_LIMITS.sourceBytes) throw new TaskError('task_library_limit');
          const manifest = validateTaskManifest(taskJson(raw.manifest, TASK_LIMITS.manifestBytes)); if (manifest.id !== raw.id) throw new TaskError('task_storage_corrupt');
          record = Object.freeze({ formatVersion: 1, id: raw.id, revision: raw.revision, source: raw.source, hash: raw.hash, manifest, updatedAt: raw.updatedAt as number });
        } catch { this.#corruptCount++; continue; }
        const entry: Entry = { record }; this.#records.set(record.id, entry);
        try {
          // Check the stored source hash before executing even a sandbox validation.
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.source)))].map(n => n.toString(16).padStart(2, '0')).join('');
          if (hash !== record.hash) throw new TaskError('task_storage_corrupt');
          const validated = await this.#manager.validate(record.source, this.#lifetime.signal); this.#check();
          if (JSON.stringify(validated.manifest) !== JSON.stringify(record.manifest)) throw new TaskError('task_storage_corrupt');
          await this.#mount(record, validated);
        } catch (error) { entry.errorCode = error instanceof TaskError ? error.code : 'task_library_unavailable'; }
      }
      this.#check(); this.#ready = true; this.#emit();
    })();
    try { await this.#initializing; } catch (error) { this.#initializing = undefined; throw error; }
  }
  async #unmount(id: string): Promise<void> {
    const e = this.#records.get(id); if (!e) return;
    e.abort?.abort(); const owner = e.owner; e.owner = undefined; e.toolName = undefined;
    if (owner) await owner.dispose(); if (e.abort) await this.#manager.retireDefinition(e.abort.signal);
  }
  async #mount(record: TaskLibraryRecord, validated: ValidatedTask): Promise<void> {
    this.#check(); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.id)); this.#check();
    const namespace = `task_${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
    const owner = this.#owner(namespace), abort = new AbortController();
    try {
      const descriptor = owner.register(this.#define(validated, `user.${namespace}.run`, abort.signal));
      this.#records.set(record.id, { record, validated, abort, owner, toolName: descriptor.wireName }); this.#emit();
    } catch (error) { abort.abort(); await owner.dispose(); throw error; }
  }
  async prepareSave(validated: ValidatedTask, expectedRevision: string | null, context: ToolExecutionContext): Promise<AsyncToolTransaction> {
    this.#manager.assertValidated(validated);
    const record: TaskLibraryRecord = Object.freeze({ formatVersion: 1, id: validated.manifest.id, revision: crypto.randomUUID(),
      source: validated.source, hash: validated.hash, manifest: validated.manifest, updatedAt: Date.now() });
    return this.#prepare(record.id, expectedRevision, record, validated, context);
  }
  async prepareRemove(id: string, expectedRevision: string, context: ToolExecutionContext): Promise<AsyncToolTransaction> {
    return this.#prepare(id, expectedRevision, null, undefined, context);
  }
  async #prepare(id: string, expectedRevision: string | null, record: TaskLibraryRecord | null, validated: ValidatedTask | undefined, context: ToolExecutionContext): Promise<AsyncToolTransaction> {
    await this.initialize(); this.#check(); context.checkpoint();
    if (this.#busy) throw new TaskError('task_busy'); const before = this.#records.get(id);
    if ((before?.record.revision ?? null) !== expectedRevision || (!record && !before)) throw new TaskError('task_conflict');
    if (record && !before && this.#records.size >= TASK_LIMITS.libraryItems) throw new TaskError('task_library_limit');
    this.#busy = true; let written = false, disposed = false, entered = false, rolledBack = false;
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; }); this.#changes.add(done);
    return { result: { id, revision: record?.revision ?? expectedRevision!, state: record ? 'saved' : 'removed' },
      commit: async () => {
        if (disposed || entered) throw new TaskError('task_conflict'); entered = true;
        this.#check(); context.checkpoint(); await this.#unmount(id); context.checkpoint();
        await this.#store.compareAndSwap(id, expectedRevision, record); written = true; this.#check(); context.checkpoint();
        if (record) await this.#mount(record, validated!); else { this.#records.delete(id); this.#emit(); }
        context.checkpoint(); return undefined;
      },
      rollback: async () => {
        if (!entered || rolledBack) return undefined;
        await this.#unmount(id);
        if (written) await this.#store.compareAndSwap(id, record?.revision ?? null, before?.record ?? null);
        this.#records.delete(id);
        if (before) {
          if (before.validated && !this.#closed) await this.#mount(before.record, before.validated);
          else this.#records.set(id, { record: before.record, errorCode: before.errorCode });
        }
        rolledBack = true; this.#emit(); return undefined;
      },
      dispose: () => { if (!disposed) { disposed = true; this.#busy = false; this.#changes.delete(done); finish(); this.#emit(); } },
    };
  }
  async close(): Promise<void> {
    if (this.#closed) return; this.#closed = true; this.#lifetime.abort();
    await Promise.all([...this.#changes]);
    await Promise.all([...this.#records.keys()].map(id => this.#unmount(id)));
    this.#listeners.clear(); await this.#store.close();
  }
}
