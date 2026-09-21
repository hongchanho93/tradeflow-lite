import { CAPABILITY_LIMITS, CapabilityError, type ToolDefinition, type ToolDescriptor } from './contracts.ts';
import { compileRegistration, REGISTRY_LIMITS, type CapabilityOwner, type Registration, type RegistryChange } from './registration.ts';
export { REGISTRY_LIMITS, type CapabilityOwner, type RegistryChange } from './registration.ts';

type OwnerState = { id: string; closed: boolean; pending: Set<Promise<void>>; disposal?: Promise<void> };

/** One catalog for all transports. Only trusted host adapters receive owner handles. */
export class CapabilityRegistry {
  readonly #tools = new Map<string, Registration>();
  readonly #records = new WeakMap<ToolDefinition, Registration>();
  readonly #owners = new Map<string, OwnerState>();
  readonly #listeners = new Set<(change: RegistryChange) => void>();
  readonly #retiring = new Map<string, Set<Registration>>();
  #serial = 0;
  #revision = 0;
  #bytes = 0;
  #publishing = false;
  #snapshot: readonly ToolDescriptor[] = Object.freeze([]);

  constructor(definitions: readonly ToolDefinition[]) {
    if (definitions.length > CAPABILITY_LIMITS.maxTools) throw new CapabilityError('invalid_contract');
    for (const tool of definitions) {
      const entry = compileRegistration(tool, ++this.#serial);
      this.#checkInsert(entry); this.#put(entry);
    }
    this.#snapshot = Object.freeze([...this.#tools.values()].map(entry => entry.descriptor));
  }

  get revision(): number { return this.#revision; }
  describe(): readonly ToolDescriptor[] { return this.#snapshot; }
  list(): readonly ToolDescriptor[] { return this.describe(); }
  subscribe(listener: (change: RegistryChange) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }

  /** Host-only lookup. Do not expose this function itself over a transport. */
  resolve(id: string): ToolDefinition {
    const entry = this.#tools.get(id);
    if (!entry) throw new CapabilityError('unknown_tool'); return entry.tool;
  }
  isCurrent(tool: ToolDefinition): boolean { return this.#tools.get(tool.id)?.tool === tool; }
  signal(tool: ToolDefinition): AbortSignal {
    const entry = this.#records.get(tool);
    if (!entry) throw new CapabilityError('invalid_contract'); return entry.controller.signal;
  }
  /** Core-only lease. Retired handlers keep their slots until release. */
  acquire(tool: ToolDefinition): () => void {
    if (!this.isCurrent(tool)) throw new CapabilityError('tool_changed');
    if ([...this.#retiring.get(tool.id) ?? []].some(entry => entry.active > 0)) throw new CapabilityError('busy');
    const entry = this.#records.get(tool)!; entry.active++;
    let released = false;
    return () => {
      if (released) return; released = true; entry.active--;
      if (entry.retired && !entry.active) entry.drain();
    };
  }

  createOwner(id: string): CapabilityOwner {
    if (this.#publishing) throw new CapabilityError('busy');
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id)) throw new CapabilityError('invalid_contract');
    if (this.#owners.has(id)) throw new CapabilityError('state_conflict');
    if (this.#owners.size >= REGISTRY_LIMITS.owners) throw new CapabilityError('registry_capacity');
    const state: OwnerState = { id, closed: false, pending: new Set() }; this.#owners.set(id, state);
    const check = () => {
      if (state.closed || this.#owners.get(id) !== state) throw new CapabilityError('tool_changed');
      if (this.#publishing) throw new CapabilityError('busy');
    };
    const owned = (toolId: string) => {
      check(); const entry = this.#tools.get(toolId);
      if (!entry || entry.tool.ownerId !== id) throw new CapabilityError('permission_denied'); return entry;
    };
    const retire = (entries: Registration[]) => entries.map(entry => {
      state.pending.add(entry.drained);
      void entry.drained.then(() => state.pending.delete(entry.drained));
      return entry.drained;
    });
    return Object.freeze({
      id,
      register: (tool: ToolDefinition) => {
        check(); const entry = compileRegistration(tool, ++this.#serial, id); this.#checkInsert(entry); this.#put(entry);
        this.#publish([entry.tool.id], [], [], []); return entry.descriptor;
      },
      update: (tool: ToolDefinition) => {
        const before = owned(tool.id), after = compileRegistration(tool, ++this.#serial, id); this.#checkInsert(after, before);
        const draining = retire([before]); this.#bytes -= before.bytes; this.#put(after);
        this.#publish([], [tool.id], [], [before]); return Promise.all(draining).then(() => {});
      },
      unregister: (toolId: string) => {
        const entry = owned(toolId), draining = retire([entry]);
        this.#tools.delete(toolId); this.#bytes -= entry.bytes;
        this.#publish([], [], [toolId], [entry]); return Promise.all(draining).then(() => {});
      },
      describe: () => state.closed ? Object.freeze([]) : Object.freeze(this.describe().filter(t => t.ownerId === id)),
      dispose: () => {
        if (state.disposal) return state.disposal;
        check(); state.closed = true; this.#owners.delete(id);
        const entries = [...this.#tools.values()].filter(entry => entry.tool.ownerId === id);
        retire(entries);
        for (const entry of entries) { this.#tools.delete(entry.tool.id); this.#bytes -= entry.bytes; }
        state.disposal = Promise.all([...state.pending]).then(() => {});
        if (entries.length) this.#publish([], [], entries.map(e => e.tool.id), entries);
        return state.disposal;
      },
    });
  }
  #checkInsert(after: Registration, before?: Registration): void {
    if ((!before && this.#tools.has(after.tool.id)) || [...this.#tools.values()].some(entry => entry !== before
      && entry.descriptor.wireName === after.descriptor.wireName)) throw new CapabilityError('invalid_contract');
    if (this.#tools.size + (before ? 0 : 1) > CAPABILITY_LIMITS.maxTools
      || this.#bytes - (before?.bytes ?? 0) + after.bytes > REGISTRY_LIMITS.catalogBytes) throw new CapabilityError('registry_capacity');
  }
  #put(entry: Registration): void {
    this.#tools.set(entry.tool.id, entry); this.#records.set(entry.tool, entry); this.#bytes += entry.bytes;
  }
  #publish(added: string[], updated: string[], removed: string[], retiring: Registration[]): void {
    this.#snapshot = Object.freeze([...this.#tools.values()].map(entry => entry.descriptor));
    const change = Object.freeze({ revision: ++this.#revision,
      added: Object.freeze(added), updated: Object.freeze(updated), removed: Object.freeze(removed) });
    this.#publishing = true;
    try {
      for (const entry of retiring) {
        entry.retired = true;
        if (entry.active) {
          const pending = this.#retiring.get(entry.tool.id) ?? new Set<Registration>();
          pending.add(entry); this.#retiring.set(entry.tool.id, pending);
          void entry.drained.then(() => {
            pending.delete(entry);
            if (!pending.size && this.#retiring.get(entry.tool.id) === pending) this.#retiring.delete(entry.tool.id);
          });
        }
        entry.controller.abort(); if (!entry.active) entry.drain();
      }
      for (const listener of [...this.#listeners]) {
        try { listener(change); } catch { /* An observer cannot undo a committed catalog change. */ }
      }
    } finally { this.#publishing = false; }
  }
}
