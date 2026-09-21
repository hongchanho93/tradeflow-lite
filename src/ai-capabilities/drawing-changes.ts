import {
  CapabilityError, sameSelection, requireChartSelection, type JsonValue, type SelectionRef,
  type ToolExecutionContext, type ToolSessionScope, type ToolTransaction,
} from './contracts.ts';
import { snapshotJson } from './json.ts';
import {
  DRAWING_LIMITS, DrawingTypeRegistry, sameDrawing, validDrawingId,
  type DrawingDocumentPort, type DrawingSlot, type DrawingSpec,
} from './drawing-contract.ts';

type Delta = { readonly before: DrawingSlot; readonly after: DrawingSpec | null; readonly wasOwn: boolean };
type Change = {
  readonly id: string; readonly session: ToolSessionScope; readonly context: SelectionRef;
  readonly deltas: readonly Delta[]; readonly expiresAt: number; readonly bytes: number;
  state: 'proposed' | 'applied' | 'reverted' | 'failed';
  afterSlots: readonly DrawingSlot[];
  dispose(): void;
};
type Attempt = { before: DrawingSlot; target: DrawingSpec | null; ownBefore: boolean; observedAfter?: DrawingSlot };

/** Object-level journal. No global Undo, arbitrary execution or native chart access. */
export class DrawingChangeManager {
  readonly #port: DrawingDocumentPort;
  readonly #current: () => SelectionRef;
  readonly #now: () => number;
  readonly types: DrawingTypeRegistry;
  readonly #changes = new Map<string, Change>();
  readonly #owners = new Map<string, { identity: object; version: number }>();
  readonly #sessions = new Map<ToolSessionScope, () => void>();
  #storedBytes = 0;
  #busy = false;
  #poisoned = false;

  constructor(port: DrawingDocumentPort, current: () => SelectionRef,
    options: { types?: DrawingTypeRegistry; now?: () => number } = {}) {
    this.#port = port;
    this.#current = current;
    this.#now = options.now ?? (() => performance.now());
    this.types = options.types ?? new DrawingTypeRegistry();
  }

  get retainedChanges(): number { this.#prune(); return this.#changes.size; }
  get retainedBytes(): number { this.#prune(); return this.#storedBytes; }
  get poisoned(): boolean { return this.#poisoned; }

  #check(execution: ToolExecutionContext): void {
    execution.checkpoint();
    if (execution.session.signal.aborted) throw new CapabilityError('session_closed');
    if (execution.signal.aborted) throw new CapabilityError('cancelled');
    if (!sameSelection(requireChartSelection(execution.context), this.#current())) throw new CapabilityError('context_stale');
  }

  #slot(raw: DrawingSlot, id = raw.id): DrawingSlot {
    try {
      if (!validDrawingId(id) || raw.id !== id || !Number.isSafeInteger(raw.version) || raw.version < 0
          || (raw.value !== null && raw.version === 0)) throw new Error();
      return Object.freeze({ id, version: raw.version, value: raw.value === null ? null : this.types.validate(raw.value) });
    } catch { throw new CapabilityError('drawing_host_failed'); }
  }

  #read(id: string): DrawingSlot { return this.#slot(this.#port.read(id), id); }

  #identity(session: ToolSessionScope): object { return session.sessionIdentity ?? session; }

  #own(slot: DrawingSlot, session: ToolSessionScope): boolean {
    const owner = this.#owners.get(slot.id);
    if (owner && owner.version !== slot.version) this.#owners.delete(slot.id);
    return slot.value !== null && owner?.identity === this.#identity(session) && owner.version === slot.version;
  }

  #setOwner(slot: DrawingSlot, session: ToolSessionScope, own: boolean): void {
    if (slot.value !== null && own && !session.signal.aborted) this.#owners.set(slot.id, { identity: this.#identity(session), version: slot.version });
    else this.#owners.delete(slot.id);
  }

  #list(): readonly DrawingSlot[] {
    const raw = this.#port.list();
    if (!Array.isArray(raw) || raw.length > DRAWING_LIMITS.maxObjects) throw new CapabilityError('drawing_capacity');
    const seen = new Set<string>();
    const result = raw.map(item => {
      const slot = this.#slot(item);
      if (slot.value === null || seen.has(slot.id)) throw new CapabilityError('drawing_host_failed');
      seen.add(slot.id);
      return slot;
    });
    const current = new Map(result.map(slot => [slot.id, slot.version]));
    for (const [id, owner] of this.#owners) {
      if (current.get(id) !== owner.version) this.#owners.delete(id);
    }
    return result;
  }

  list(execution: ToolExecutionContext): JsonValue {
    this.#check(execution);
    const result = this.#list().map(slot => ({ ...slot, ownership: this.#own(slot, execution.session) ? 'session' : 'user-or-other' }));
    this.#check(execution);
    return result;
  }

  #track(session: ToolSessionScope): void {
    if (this.#sessions.has(session)) return;
    const cleanup = () => {
      for (const change of [...this.#changes.values()]) if (change.session === session) this.#drop(change);
      this.#sessions.delete(session);
      session.signal.removeEventListener('abort', cleanup);
    };
    session.signal.addEventListener('abort', cleanup, { once: true });
    this.#sessions.set(session, cleanup);
  }

  #drop(change: Change): void {
    if (!this.#changes.delete(change.id)) return;
    this.#storedBytes -= change.bytes;
    change.dispose();
  }

  #prune(): void {
    for (const change of this.#changes.values()) {
      // Never expire an applied receipt then accidentally replay its mutation.
      if (change.state === 'proposed' && change.expiresAt <= this.#now()) this.#drop(change);
    }
  }

  propose(input: JsonValue, execution: ToolExecutionContext): JsonValue {
    this.#check(execution);
    if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
    if (this.#busy) throw new CapabilityError('busy');
    this.#prune();
    const value = snapshotJson(input, DRAWING_LIMITS.maxPlanBytes).value as { operations?: readonly Record<string, JsonValue>[] };
    if (!value || typeof value !== 'object' || Object.keys(value).join() !== 'operations'
        || !Array.isArray(value.operations) || !value.operations.length
        || value.operations.length > DRAWING_LIMITS.maxOperations) throw new CapabilityError('invalid_request');
    const ids = new Set<string>();
    const deltas = value.operations.map(operation => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new CapabilityError('invalid_request');
      const create = operation.op === 'create';
      const remove = operation.op === 'delete';
      if (!create && !remove && operation.op !== 'update') throw new CapabilityError('invalid_request');
      const fields = create ? ['op', 'drawing'] : remove ? ['op', 'id', 'version'] : ['op', 'id', 'version', 'drawing'];
      if (Object.keys(operation).length !== fields.length || fields.some(key => !Object.hasOwn(operation, key))) {
        throw new CapabilityError('invalid_request');
      }
      const id = create ? `ai-${crypto.randomUUID()}` : operation.id;
      if (!validDrawingId(id) || ids.has(id)) throw new CapabilityError('invalid_request');
      ids.add(id);
      const before = this.#read(id);
      if (create ? before.value !== null || before.version !== 0 : before.value === null) throw new CapabilityError('drawing_unavailable');
      if (!create && operation.version !== before.version) throw new CapabilityError('drawing_conflict');
      let after = remove ? null : this.types.validate(operation.drawing);
      if (after && this.#port.normalize) after = this.types.validate(this.#port.normalize(id, after));
      // Type replacement has different host/layer semantics; represent it as delete + create.
      if (before.value && after && before.value.type !== after.type) throw new CapabilityError('invalid_request');
      return Object.freeze({ before, after, wasOwn: this.#own(before, execution.session) });
    });
    this.#checkCapacity(deltas);
    const bytes = snapshotJson(deltas, DRAWING_LIMITS.maxPlanBytes).bytes * 3 + 512;
    if (this.#changes.size >= DRAWING_LIMITS.maxChanges || this.#storedBytes + bytes > DRAWING_LIMITS.maxStoredBytes) {
      throw new CapabilityError('drawing_capacity');
    }
    this.#check(execution);
    const change: Change = {
      id: `change-${crypto.randomUUID()}`, session: execution.session, context: requireChartSelection(execution.context),
      deltas: Object.freeze(deltas), expiresAt: this.#now() + DRAWING_LIMITS.proposalTtlMs,
      bytes, state: 'proposed', afterSlots: [], dispose: () => {},
    };
    // If proposal delivery is cancelled/rejected, the caller never received its ID.
    const abandon = () => { if (change.state === 'proposed') this.#drop(change); };
    execution.signal.addEventListener('abort', abandon, { once: true });
    change.dispose = () => execution.signal.removeEventListener('abort', abandon);
    this.#track(execution.session);
    this.#changes.set(change.id, change);
    this.#storedBytes += bytes;
    return {
      changeSetId: change.id, state: 'proposed', requiresExistingPermission: deltas.some(delta => delta.before.value !== null && !delta.wasOwn),
      operations: deltas.map(delta => ({
        id: delta.before.id, version: delta.before.version,
        op: delta.before.value === null ? 'create' : delta.after === null ? 'delete' : 'update',
        ...(delta.before.value ? { before: delta.before.value } : {}),
        ...(delta.after ? { after: delta.after } : {}),
      })),
    };
  }

  #checkCapacity(deltas: readonly Delta[]): void {
    const total = (this.#port.count?.() ?? this.#list().length) + deltas.reduce((count, delta) => count
      + (delta.before.value === null && delta.after !== null ? 1 : 0)
      - (delta.before.value !== null && delta.after === null ? 1 : 0), 0);
    if (total > DRAWING_LIMITS.maxObjects) throw new CapabilityError('drawing_capacity');
  }

  prepare(id: string, direction: 'apply' | 'revert', execution: ToolExecutionContext,
    existingPermission = false): ToolTransaction {
    if (!validDrawingId(id) || !['apply', 'revert'].includes(direction)) throw new CapabilityError('invalid_request');
    this.#check(execution);
    if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
    if (this.#busy) throw new CapabilityError('busy');
    this.#prune();
    const change = this.#changes.get(id);
    if (!change || change.session !== execution.session || !sameSelection(change.context, requireChartSelection(execution.context))) {
      throw new CapabilityError('changeset_unavailable');
    }
    const wanted = direction === 'apply' ? 'applied' : 'reverted';
    const initial = direction === 'apply' ? 'proposed' : 'applied';
    const result = { changeSetId: id, state: wanted };
    if (change.state === wanted) return Object.freeze({ result,
      commit: (): undefined => { this.#check(execution); }, rollback: (): undefined => {} });
    if (change.state !== initial) throw new CapabilityError('changeset_state');
    if (direction === 'apply' && !existingPermission && change.deltas.some(delta => delta.before.value && !delta.wasOwn)) {
      throw new CapabilityError('permission_denied');
    }
    const deltas: readonly Delta[] = direction === 'apply' ? change.deltas : change.deltas.map((delta, index) => ({
      before: change.afterSlots[index], after: delta.before.value,
      wasOwn: this.#own(change.afterSlots[index], execution.session),
    }));
    const attempts: Attempt[] = [];
    let completed = false;
    let rolledBack = false;
    let nativeBatch = false;
    return Object.freeze({
      result,
      commit: (): undefined => {
        this.#check(execution);
        if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
        if (this.#busy) throw new CapabilityError('busy');
        if (completed || change.state === wanted) return;
        if (change.state !== initial || !this.#changes.has(id)) throw new CapabilityError('changeset_state');
        if (direction === 'apply' && change.expiresAt <= this.#now()) throw new CapabilityError('changeset_unavailable');
        this.#busy = true;
        try {
          this.#checkCapacity(deltas);
          for (const delta of deltas) this.#expect(delta.before);
          if (this.#port.beginBatch) {
            this.#port.beginBatch({ id, direction, context: requireChartSelection(execution.context), deltas });
            nativeBatch = true;
          }
          for (const delta of deltas) {
            this.#check(execution);
            this.#expect(delta.before);
            const attempt: Attempt = { before: delta.before, target: delta.after, ownBefore: delta.wasOwn };
            attempts.push(attempt); // Include the operation that mutates and THEN throws.
            this.#port.write(delta.before.id, delta.before.version, delta.after);
            const after = this.#read(delta.before.id);
            if (after.version <= delta.before.version || !sameDrawing(after.value, delta.after)) throw new CapabilityError('drawing_host_failed');
            attempt.observedAfter = after;
            this.#check(execution);
          }
          this.#port.flush();
          this.#check(execution);
          const after = attempts.map(attempt => attempt.observedAfter!);
          after.forEach((slot, index) => this.#setOwner(slot, execution.session,
            direction === 'apply' ? change.deltas[index].before.value === null || change.deltas[index].wasOwn : change.deltas[index].wasOwn));
          change.state = wanted;
          if (direction === 'apply') change.afterSlots = Object.freeze(after);
          completed = true;
          change.dispose();
        } finally { this.#busy = false; }
      },
      rollback: (): undefined => {
        if (rolledBack || (!attempts.length && !nativeBatch)) return;
        rolledBack = true;
        this.#busy = true;
        let failed = false;
        const restored = new Map<string, DrawingSlot>();
        try {
          if (nativeBatch && this.#port.rollbackBatch) {
            try {
              this.#port.rollbackBatch();
              for (const attempt of attempts) {
                const slot = this.#read(attempt.before.id);
                if (!sameDrawing(slot.value, attempt.before.value)) throw new Error();
                restored.set(slot.id, slot);
                this.#setOwner(slot, execution.session, attempt.ownBefore);
              }
            } catch { failed = true; }
          } else {
          for (const attempt of [...attempts].reverse()) {
            try {
              const current = this.#read(attempt.before.id);
              if (current.version === attempt.before.version && sameDrawing(current.value, attempt.before.value)) {
                restored.set(current.id, current);
                continue;
              }
              // A later edit is not ours to overwrite, even if it looks identical.
              if (attempt.observedAfter && current.version !== attempt.observedAfter.version
                  || current.version <= attempt.before.version || !sameDrawing(current.value, attempt.target)) throw new Error();
              this.#port.write(current.id, current.version, attempt.before.value);
              const slot = this.#read(current.id);
              if (slot.version <= current.version || !sameDrawing(slot.value, attempt.before.value)) throw new Error();
              restored.set(slot.id, slot);
              this.#setOwner(slot, execution.session, attempt.ownBefore);
            } catch { failed = true; }
          }
          try { this.#port.flush(); } catch { failed = true; }
          }
          if (failed) {
            this.#poisoned = true;
            change.state = 'failed';
            throw new CapabilityError('rollback_failed');
          }
          // Failed apply cannot reuse an old version precondition. A failed undo
          // retains the applied receipt with the newly restored versions.
          change.state = direction === 'apply' ? 'failed' : 'applied';
          if (direction === 'revert') change.afterSlots = deltas.map(delta => restored.get(delta.before.id) ?? delta.before);
        } finally { this.#busy = false; }
      },
    });
  }

  prepareOwnedRemove(ids: readonly string[], execution: ToolExecutionContext): ToolTransaction {
    this.#check(execution);
    if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
    if (this.#busy) throw new CapabilityError('busy');
    if (!Array.isArray(ids) || !ids.length || ids.length > DRAWING_LIMITS.maxOperations) {
      throw new CapabilityError('invalid_request');
    }
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.some(id => !validDrawingId(id))) throw new CapabilityError('invalid_request');
    const before = ids.map(id => this.#read(id));
    for (const slot of before) {
      if (slot.value === null) throw new CapabilityError('drawing_unavailable');
      if (!this.#own(slot, execution.session)) throw new CapabilityError('permission_denied');
    }
    const deltas = Object.freeze(before.map(slot => Object.freeze({ before: slot, after: null as DrawingSpec | null })));
    // Native drawing receipts intentionally accept only the common change-* namespace.
    // Owned cleanup is still a normal atomic drawing change, so it must use the
    // same persisted receipt namespace instead of a private cleanup-* id.
    const batchId = `change-cleanup-${crypto.randomUUID()}`;
    const attempts: Attempt[] = [];
    let completed = false;
    let rolledBack = false;
    let nativeBatch = false;
    return Object.freeze({
      result: Object.freeze({ removed: Object.freeze([...ids]) }),
      commit: (): undefined => {
        this.#check(execution);
        if (this.#poisoned) throw new CapabilityError('drawing_host_failed');
        if (this.#busy) throw new CapabilityError('busy');
        if (completed) return;
        this.#busy = true;
        try {
          for (const slot of before) {
            this.#expect(slot);
            if (!this.#own(slot, execution.session)) throw new CapabilityError('permission_denied');
          }
          if (this.#port.beginBatch) {
            this.#port.beginBatch({ id: batchId, direction: 'apply', context: requireChartSelection(execution.context), deltas });
            nativeBatch = true;
          }
          for (const slot of before) {
            this.#check(execution);
            this.#expect(slot);
            if (!this.#own(slot, execution.session)) throw new CapabilityError('permission_denied');
            const attempt: Attempt = { before: slot, target: null, ownBefore: true };
            attempts.push(attempt);
            this.#port.write(slot.id, slot.version, null);
            const after = this.#read(slot.id);
            if (after.version <= slot.version || after.value !== null) throw new CapabilityError('drawing_host_failed');
            attempt.observedAfter = after;
            this.#check(execution);
          }
          this.#port.flush();
          this.#check(execution);
          for (const attempt of attempts) this.#setOwner(attempt.observedAfter!, execution.session, false);
          completed = true;
        } finally { this.#busy = false; }
      },
      rollback: (): undefined => {
        if (rolledBack || (!attempts.length && !nativeBatch)) return;
        rolledBack = true;
        this.#busy = true;
        let failed = false;
        try {
          if (nativeBatch && this.#port.rollbackBatch) {
            try {
              this.#port.rollbackBatch();
              for (const attempt of attempts) {
                const slot = this.#read(attempt.before.id);
                if (!sameDrawing(slot.value, attempt.before.value)) throw new Error();
                this.#setOwner(slot, execution.session, true);
              }
            } catch { failed = true; }
          } else {
            for (const attempt of [...attempts].reverse()) {
              try {
                const current = this.#read(attempt.before.id);
                if (current.version === attempt.before.version && sameDrawing(current.value, attempt.before.value)) {
                  this.#setOwner(current, execution.session, true);
                  continue;
                }
                if (!attempt.observedAfter || current.version !== attempt.observedAfter.version || current.value !== null) throw new Error();
                this.#port.write(current.id, current.version, attempt.before.value);
                const restored = this.#read(current.id);
                if (restored.version <= current.version || !sameDrawing(restored.value, attempt.before.value)) throw new Error();
                this.#setOwner(restored, execution.session, true);
              } catch { failed = true; }
            }
            try { this.#port.flush(); } catch { failed = true; }
          }
          if (failed) {
            this.#poisoned = true;
            throw new CapabilityError('rollback_failed');
          }
        } finally { this.#busy = false; }
      },
    });
  }

  #expect(expected: DrawingSlot): void {
    const current = this.#read(expected.id);
    if (current.version !== expected.version || !sameDrawing(current.value, expected.value)) throw new CapabilityError('drawing_conflict');
  }

  history(execution: ToolExecutionContext): JsonValue {
    this.#check(execution);
    const result = this.#port.history?.() ?? [];
    this.#check(execution);
    return result;
  }

  /** Explicit new authorization, never automatic revival of an old session or proposal. */
  prepareSavedRevert(id: string, execution: ToolExecutionContext): ToolTransaction {
    this.#check(execution);
    const saved = this.#port.savedChange?.(id);
    if (!saved) throw new CapabilityError('changeset_unavailable');
    if (saved.state === 'reverted') return { result: { changeSetId: id, state: 'reverted' },
      commit: (): undefined => { this.#check(execution); }, rollback: (): undefined => {} };
    const previous = this.#changes.get(id);
    if (previous && previous.session !== execution.session) throw new CapabilityError('permission_denied');
    if (!previous) {
      const deltas = saved.before.map((before, index) => ({
        before: this.#slot(before), after: this.#slot(saved.after[index]).value, wasOwn: false,
      }));
      const bytes = snapshotJson(deltas, DRAWING_LIMITS.maxPlanBytes).bytes * 3 + 512;
      if (this.#changes.size >= DRAWING_LIMITS.maxChanges || this.#storedBytes + bytes > DRAWING_LIMITS.maxStoredBytes) {
        throw new CapabilityError('drawing_capacity');
      }
      this.#track(execution.session);
      this.#changes.set(id, { id, context: requireChartSelection(execution.context), session: execution.session,
        deltas, expiresAt: Infinity, bytes, state: 'applied', afterSlots: saved.after.map(slot => this.#slot(slot)), dispose: () => {} });
      this.#storedBytes += bytes;
    }
    return this.prepare(id, 'revert', execution, true);
  }
}
