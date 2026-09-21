import {
  CAPABILITY_LIMITS, CapabilityError, SELECTION_SCHEMA, APP_SCHEMA, isAppRef, sameSelection,
  type CapabilityErrorCode, type CapabilityLimits, type Permission, type CapabilityContext, type SelectionRef,
  type ToolDefinition, type ToolReply, type ToolRequest, type ToolSessionScope, type ToolTransaction, type AsyncToolTransaction,
} from './contracts.ts';
import { parseJson, snapshotJson, validateValue, ValueValidationError } from './json.ts';
import { CapabilityRegistry } from './registry.ts';

export interface CapabilityClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

const defaultClock: CapabilityClock = {
  now: () => performance.now(),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

type RuntimeLimits = Pick<CapabilityLimits,
  'maxRequestBytes' | 'maxOutputBytes' | 'maxSessions' | 'maxRequestsPerSession'
  | 'maxStoredBytesPerSession' | 'maxActiveGlobal' | 'maxActivePerSession' | 'timeoutMs'>;

const errorCodes = new Set<CapabilityErrorCode>([
  'invalid_request', 'unsupported_version', 'invalid_contract', 'unknown_tool',
  'permission_denied', 'write_requires_changeset', 'context_stale', 'request_conflict',
  'session_closed', 'session_capacity', 'busy', 'cancelled', 'timeout', 'invalid_output',
  'tool_failed', 'not_awaiting_approval',
  'data_not_ready', 'invalid_chart_data', 'snapshot_unavailable', 'snapshot_capacity',
  'field_unavailable', 'numeric_overflow',
  'drawing_conflict', 'drawing_unavailable', 'drawing_capacity', 'drawing_host_failed',
  'changeset_unavailable', 'changeset_state', 'rollback_failed',
  'state_conflict', 'storage_failed', 'indicator_failed', 'navigation_failed',
  'tool_changed', 'registry_capacity',
]);

function errorReply(requestId: string, error: unknown): ToolReply {
  const code = error instanceof CapabilityError && errorCodes.has(error.code) ? error.code : 'tool_failed';
  if (error instanceof ValueValidationError) {
    const details = Object.freeze({ path: error.path, reason: error.reason, expected: error.expected });
    return Object.freeze({
      status: 'error', requestId, code,
      path: error.path, reason: error.reason, expected: error.expected, details,
    });
  }
  return Object.freeze({ status: 'error', requestId, code,
    ...(error instanceof CapabilityError && error.details !== undefined ? { details: error.details } : {}) });
}

function readSelection(value: unknown): CapabilityContext {
  const snapshot = snapshotJson(value, CAPABILITY_LIMITS.maxRequestBytes).value;
  const app = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && (snapshot as Record<string, unknown>).scope === 'app';
  validateValue(snapshot, app ? APP_SCHEMA : SELECTION_SCHEMA);
  if (Object.values(snapshot as object).some(item => typeof item === 'string' && !item.length)) {
    throw new CapabilityError('invalid_request');
  }
  return snapshot as unknown as CapabilityContext;
}

function sameContext(a: CapabilityContext, b: CapabilityContext): boolean {
  return isAppRef(a) ? isAppRef(b) && a.appInstanceId === b.appInstanceId
    : !isAppRef(b) && sameSelection(a, b);
}

function decodeRequest(text: string, maxBytes: number): { request: ToolRequest; fingerprint: string; bytes: number } {
  const parsed = parseJson(text, maxBytes);
  const value = parsed.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CapabilityError('invalid_request');
  const record = value as Record<string, unknown>;
  const fields = ['protocolVersion', 'requestId', 'toolId', 'context', 'input'];
  if (Object.keys(record).length !== fields.length || fields.some(key => !Object.hasOwn(record, key))) {
    throw new CapabilityError('invalid_request');
  }
  if (record.protocolVersion !== 1) throw new CapabilityError('unsupported_version');
  if (typeof record.requestId !== 'string' || !/^[a-zA-Z0-9_:-]{1,128}$/.test(record.requestId)
      || typeof record.toolId !== 'string' || record.toolId.length > 128) throw new CapabilityError('invalid_request');
  readSelection(record.context);
  return { request: value as unknown as ToolRequest, fingerprint: parsed.text, bytes: parsed.bytes };
}

interface Entry {
  request: ToolRequest;
  tool: ToolDefinition;
  fingerprint: string;
  reservedOutputBytes: number;
  phase: 'approval' | 'running' | 'done';
  promise: Promise<ToolReply>;
  reply?: ToolReply;
  resolve?: (reply: ToolReply) => void;
  controller?: AbortController;
  timer?: unknown;
  deadline?: number;
  committing?: boolean;
  pendingFailure?: CapabilityErrorCode;
}

/** No transport, credential storage, UI mutation or user-code execution lives here. */
export class CapabilityCore {
  readonly #registry: CapabilityRegistry;
  readonly #limits: RuntimeLimits;
  readonly #clock: CapabilityClock;
  readonly #sessions = new Set<CapabilitySession>();
  #active = 0;

  constructor(registry: CapabilityRegistry, options: {
    readonly limits?: Partial<RuntimeLimits>;
    readonly clock?: CapabilityClock;
  } = {}) {
    this.#registry = registry;
    const configurable = new Set([
      'maxRequestBytes', 'maxOutputBytes', 'maxSessions', 'maxRequestsPerSession',
      'maxStoredBytesPerSession', 'maxActiveGlobal', 'maxActivePerSession', 'timeoutMs',
    ]);
    if (Object.keys(options.limits ?? {}).some(key => !configurable.has(key))) {
      throw new CapabilityError('invalid_contract');
    }
    const limits = { ...CAPABILITY_LIMITS, ...options.limits };
    // A1 permits tighter host budgets only; wider product budgets need benchmarks.
    for (const [key, value] of Object.entries(limits)) {
      if (!Object.hasOwn(CAPABILITY_LIMITS, key) || !Number.isSafeInteger(value) || value <= 0
          || value > CAPABILITY_LIMITS[key as keyof CapabilityLimits]) throw new CapabilityError('invalid_contract');
    }
    this.#limits = Object.freeze(limits);
    this.#clock = options.clock ?? defaultClock;
  }

  /** Trusted UI/transport-auth code calls this; wire requests cannot create sessions. */
  openSession(options: {
    readonly context: CapabilityContext;
    readonly currentContext: () => CapabilityContext;
    readonly permissions: Readonly<Record<string, Permission>>;
  }): CapabilitySession {
    if (this.#sessions.size >= this.#limits.maxSessions) throw new CapabilityError('session_capacity');
    const scope = readSelection(options.context);
    if (!sameContext(scope, readSelection(options.currentContext()))) throw new CapabilityError('context_stale');
    const permissions = new Map<string, Permission>();
    for (const [id, permission] of Object.entries(options.permissions)) {
      this.#registry.resolve(id);
      if (!['allow', 'ask', 'deny'].includes(permission)) throw new CapabilityError('invalid_contract');
      permissions.set(id, permission);
    }
    const session = new CapabilitySession(this.#registry, scope, options.currentContext, permissions,
      this.#limits, this.#clock, {
        acquire: () => {
          if (this.#active >= this.#limits.maxActiveGlobal) return false;
          this.#active += 1;
          return true;
        },
        release: () => { this.#active -= 1; },
        close: () => { this.#sessions.delete(session); },
      });
    this.#sessions.add(session);
    return session;
  }

  get activeTasks(): number { return this.#active; }
  get openSessions(): number { return this.#sessions.size; }
  closeSessions(): void { for (const session of [...this.#sessions]) session.close(); }
  invalidateCharts(): void { for (const session of this.#sessions) session.invalidateChart(); }
}

/** Host-owned object capability. Never serialize its approval methods to a model. */
export class CapabilitySession {
  readonly #registry: CapabilityRegistry;
  #scope: CapabilityContext;
  readonly #currentContext: () => CapabilityContext;
  #permissions: ReadonlyMap<string, Permission>;
  readonly #permissionTools = new Map<string, ToolDefinition>();
  readonly #toolScopes = new Map<ToolDefinition, { scope: ToolSessionScope; close(): void }>();
  readonly #unsubscribeRegistry: () => void;
  readonly #limits: RuntimeLimits;
  readonly #clock: CapabilityClock;
  readonly #lifecycle: { acquire(): boolean; release(): void; close(): void };
  readonly #entries = new Map<string, Entry>();
  readonly #sessionController = new AbortController();
  readonly #sessionIdentity = Object.freeze({});
  readonly #sessionScope: ToolSessionScope = Object.freeze({ signal: this.#sessionController.signal, sessionIdentity: this.#sessionIdentity });
  #chartController = new AbortController();
  #chartSessionScope: ToolSessionScope = Object.freeze({ signal: this.#chartController.signal, sessionIdentity: this.#sessionIdentity });
  #closed = false;
  #active = 0;
  #storedBytes = 0;

  constructor(registry: CapabilityRegistry, scope: CapabilityContext, currentContext: () => CapabilityContext,
    permissions: ReadonlyMap<string, Permission>, limits: RuntimeLimits, clock: CapabilityClock,
    lifecycle: { acquire(): boolean; release(): void; close(): void }) {
    this.#registry = registry;
    this.#scope = scope;
    this.#currentContext = currentContext;
    this.#permissions = permissions;
    for (const id of permissions.keys()) this.#permissionTools.set(id, registry.resolve(id));
    this.#limits = limits;
    this.#clock = clock;
    this.#lifecycle = lifecycle;
    this.#unsubscribeRegistry = registry.subscribe(() => this.#invalidateTools());
  }

  /** Trusted host refresh after discovery, not a wire grant. Existing data/session identity stays intact. */
  refreshTools(permissions: Readonly<Record<string, Permission>>): void {
    if (this.#closed) throw new CapabilityError('session_closed');
    const next = new Map<string, Permission>(), tools = new Map<string, ToolDefinition>();
    for (const [id, permission] of Object.entries(permissions)) {
      if (!['allow', 'ask', 'deny'].includes(permission)) throw new CapabilityError('invalid_contract');
      tools.set(id, this.#registry.resolve(id)); next.set(id, permission);
    }
    this.#permissions = next; this.#permissionTools.clear();
    for (const [id, tool] of tools) this.#permissionTools.set(id, tool);
    for (const entry of this.#entries.values()) {
      if (entry.phase !== 'done' && (next.get(entry.tool.id) ?? 'deny') === 'deny') this.#fail(entry, 'permission_denied');
    }
  }
  #invalidateTools(): void {
    for (const entry of this.#entries.values()) {
      if (entry.phase !== 'done' && !this.#registry.isCurrent(entry.tool)) this.#fail(entry, 'tool_changed');
    }
    for (const [tool, resource] of this.#toolScopes) if (!this.#registry.isCurrent(tool)) resource.close();
  }
  #registrationScope(tool: ToolDefinition, parent: ToolSessionScope): ToolSessionScope | undefined {
    if (tool.source !== 'extension') return undefined;
    const existing = this.#toolScopes.get(tool); if (existing) return existing.scope;
    const controller = new AbortController(), lifetime = this.#registry.signal(tool);
    const close = () => {
      controller.abort(); this.#toolScopes.delete(tool);
      lifetime.removeEventListener('abort', close); parent.signal.removeEventListener('abort', close);
    };
    const scope = Object.freeze({ signal: controller.signal, sessionIdentity: parent.sessionIdentity });
    this.#toolScopes.set(tool, { scope, close });
    lifetime.addEventListener('abort', close, { once: true }); parent.signal.addEventListener('abort', close, { once: true });
    if (lifetime.aborted || parent.signal.aborted) close();
    return scope;
  }

  invoke(json: string): Promise<ToolReply> {
    let requestId = '';
    try {
      if (this.#closed) throw new CapabilityError('session_closed');
      const { request, fingerprint, bytes } = decodeRequest(json, this.#limits.maxRequestBytes);
      requestId = request.requestId;
      const previous = this.#entries.get(requestId);
      if (previous && !this.#registry.isCurrent(previous.tool)) throw new CapabilityError('tool_changed');
      const tool = this.#registry.resolve(request.toolId);
      this.#assertScope(request.context, tool);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CapabilityError('request_conflict');
        return previous.promise;
      }
      const permission = this.#permissionTools.get(tool.id) === tool ? this.#permissions.get(tool.id) ?? 'deny' : 'deny';
      if (permission === 'deny') throw new CapabilityError('permission_denied');
      if (tool.effect === 'write' && !tool.prepare && !tool.prepareAsync) throw new CapabilityError('write_requires_changeset');
      validateValue(request.input, tool.inputSchema);
      const reservation = this.#limits.maxOutputBytes + 256;
      if (this.#entries.size >= this.#limits.maxRequestsPerSession
          || this.#storedBytes + bytes + reservation > this.#limits.maxStoredBytesPerSession) {
        throw new CapabilityError('session_capacity');
      }
      const waiting: ToolReply = Object.freeze({ status: 'approval_required', requestId });
      const entry: Entry = {
        request, tool, fingerprint, reservedOutputBytes: reservation,
        phase: 'approval', promise: Promise.resolve(waiting), reply: waiting,
      };
      this.#storedBytes += bytes + reservation;
      this.#entries.set(requestId, entry);
      return permission === 'ask' ? entry.promise : this.#start(entry);
    } catch (error) {
      return Promise.resolve(errorReply(requestId, error));
    }
  }

  /** Trusted user confirmation of this exact stored request, not a wire command. */
  approve(requestId: string): Promise<ToolReply> {
    if (this.#closed) return Promise.resolve(errorReply(requestId, new CapabilityError('session_closed')));
    const entry = this.#entries.get(requestId);
    if (!entry || entry.phase !== 'approval') {
      return Promise.resolve(errorReply(requestId, new CapabilityError('not_awaiting_approval')));
    }
    return this.#start(entry);
  }

  cancel(requestId: string): boolean {
    const entry = this.#entries.get(requestId);
    if (!entry || entry.phase === 'done') return false;
    this.#fail(entry, 'cancelled');
    return true;
  }

  /** Also the revocation path. Previously submitted tasks cannot deliver results. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribeRegistry();
    this.#sessionController.abort();
    this.#chartController.abort();
    for (const entry of this.#entries.values()) {
      if (entry.phase !== 'done') this.#fail(entry, 'session_closed');
    }
    this.#entries.clear();
    this.#storedBytes = 0;
    this.#lifecycle.close();
  }

  /** Chart selection changes revoke only chart grants; App grants retain their own lifetime. */
  invalidateChart(): void {
    if (this.#closed || this.#chartController.signal.aborted) return;
    this.#chartController.abort();
    for (const entry of this.#entries.values()) {
      if (entry.tool.scope !== 'app' && entry.phase !== 'done') this.#fail(entry, 'context_stale');
    }
  }

  /** Trusted navigation completion only. Never exposed as a wire method or a user tool. */
  rebindChart(next: SelectionRef): void {
    if (this.#closed) throw new CapabilityError('session_closed');
    if (isAppRef(this.#scope)) throw new CapabilityError('permission_denied');
    const validated = readSelection(next), current = readSelection(this.#currentContext());
    if (isAppRef(validated) || isAppRef(current)
      || validated.appInstanceId !== this.#scope.appInstanceId || validated.chartId !== this.#scope.chartId
      || validated.selectionGeneration <= this.#scope.selectionGeneration
      || !sameSelection(validated, current)) throw new CapabilityError('context_stale');
    this.invalidateChart();
    this.#scope = validated;
    this.#chartController = new AbortController();
    this.#chartSessionScope = Object.freeze({ signal: this.#chartController.signal, sessionIdentity: this.#sessionIdentity });
  }

  #assertScope(context: CapabilityContext, tool: ToolDefinition): void {
    if (this.#closed) throw new CapabilityError('session_closed');
    try {
      const current = readSelection(this.#currentContext());
      if (tool.scope === 'app') {
        if (!isAppRef(context) || context.appInstanceId !== this.#scope.appInstanceId
          || context.appInstanceId !== current.appInstanceId) throw new Error();
      } else if (this.#chartController.signal.aborted || isAppRef(this.#scope) || isAppRef(context) || isAppRef(current)
        || !sameSelection(this.#scope, context) || !sameSelection(this.#scope, current)) throw new Error();
    } catch {
      throw new CapabilityError('context_stale');
    }
  }

  #checkpoint(entry: Entry): void {
    if (!this.#registry.isCurrent(entry.tool)) throw new CapabilityError('tool_changed');
    this.#assertScope(entry.request.context, entry.tool);
    if (entry.phase === 'done' || entry.controller?.signal.aborted) {
      throw new CapabilityError(entry.pendingFailure ?? (entry.reply?.status === 'error' ? entry.reply.code : 'cancelled'));
    }
    if (entry.deadline !== undefined && this.#clock.now() >= entry.deadline) throw new CapabilityError('timeout');
  }

  #settle(entry: Entry, reply: ToolReply, outputBytes = 128): void {
    if (entry.phase === 'done') return;
    entry.phase = 'done';
    entry.reply = reply;
    if (entry.timer !== undefined) this.#clock.clearTimer(entry.timer);
    if (!this.#closed) this.#storedBytes -= entry.reservedOutputBytes - (outputBytes + 128);
    if (entry.resolve) entry.resolve(reply);
    else entry.promise = Promise.resolve(reply);
  }

  #fail(entry: Entry, code: CapabilityErrorCode): void {
    // Synchronous host callbacks can revoke a session during commit. Do not deliver
    // a cancellation reply until rollback has finished (or explicitly failed).
    if (entry.committing) {
      entry.pendingFailure ??= code;
      entry.controller?.abort();
      return;
    }
    this.#settle(entry, errorReply(entry.request.requestId, new CapabilityError(code)));
    entry.controller?.abort();
  }

  #start(entry: Entry): Promise<ToolReply> {
    let releaseRegistration = () => {};
    try {
      this.#checkpoint(entry);
      if (this.#active >= this.#limits.maxActivePerSession) throw new CapabilityError('busy');
      releaseRegistration = this.#registry.acquire(entry.tool);
      if (!this.#lifecycle.acquire()) throw new CapabilityError('busy');
    } catch (error) {
      releaseRegistration();
      this.#settle(entry, errorReply(entry.request.requestId, error));
      return entry.promise;
    }
    this.#active += 1;
    entry.phase = 'running';
    entry.reply = undefined;
    entry.controller = new AbortController();
    const timeoutMs = entry.tool.timeoutMs ?? this.#limits.timeoutMs;
    entry.deadline = this.#clock.now() + timeoutMs;
    entry.promise = new Promise(resolve => { entry.resolve = resolve; });
    entry.timer = this.#clock.setTimer(() => this.#fail(entry, 'timeout'), timeoutMs);
    const sessionScope = entry.tool.scope === 'app' ? this.#sessionScope : this.#chartSessionScope;
    const registration = this.#registrationScope(entry.tool, sessionScope);
    const executionContext = Object.freeze({
      context: entry.request.context, signal: entry.controller.signal,
      session: sessionScope, ...(registration ? { registration } : {}),
      checkpoint: () => this.#checkpoint(entry),
    });
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (entry.timer !== undefined) this.#clock.clearTimer(entry.timer);
      this.#active -= 1;
      this.#lifecycle.release();
      releaseRegistration();
    };
    let transaction: ToolTransaction | AsyncToolTransaction | undefined;
    let disposed = false;
    const dispose = (): void => {
      if (!disposed && transaction) { disposed = true; transaction.dispose?.(); }
    };
    void Promise.resolve().then(async () => {
      this.#checkpoint(entry);
      let value;
      if (entry.tool.effect === 'write') {
        transaction = entry.tool.prepareAsync
          ? await entry.tool.prepareAsync(entry.request.input, executionContext)
          : await entry.tool.prepare!(entry.request.input, executionContext);
        if (!transaction || typeof transaction.commit !== 'function' || typeof transaction.rollback !== 'function'
            || (!entry.tool.prepareAsync && (Object.prototype.toString.call(transaction.commit) !== '[object Function]'
              || Object.prototype.toString.call(transaction.rollback) !== '[object Function]'))
            || (transaction.dispose !== undefined && typeof transaction.dispose !== 'function')) {
          throw new CapabilityError('invalid_contract');
        }
        value = transaction.result;
      } else value = await entry.tool.run(entry.request.input, executionContext);
      this.#checkpoint(entry);
      let output: ReturnType<typeof snapshotJson>;
      try {
        output = snapshotJson(value, this.#limits.maxOutputBytes);
        validateValue(output.value, entry.tool.outputSchema);
      } catch {
        throw new CapabilityError('invalid_output');
      }
      this.#checkpoint(entry);
      if (transaction) {
        entry.committing = true;
        try {
          const returned = entry.tool.prepareAsync ? await transaction.commit() : transaction.commit();
          if (returned !== undefined) throw new CapabilityError('invalid_contract');
          this.#checkpoint(entry);
        } catch (error) {
          try {
            const returned = entry.tool.prepareAsync ? await transaction.rollback() : transaction.rollback();
            if (returned !== undefined) throw new Error();
          } catch { throw new CapabilityError('rollback_failed'); }
          throw error;
        } finally { entry.committing = false; }
      }
      // No await between commit, final checkpoint and success settlement. Once
      // acknowledged, cancellation cannot silently undo an already committed edit.
      // The actual handler has settled; free capacity before notifying the caller.
      dispose();
      release();
      this.#settle(entry, Object.freeze({ status: 'ok', requestId: entry.request.requestId, data: output.value }), output.bytes);
    }).catch(error => {
      try { dispose(); } catch { error = new CapabilityError('rollback_failed'); }
      release();
      this.#settle(entry, errorReply(entry.request.requestId, error));
      entry.controller?.abort();
    }).finally(() => {
      // Cancellation is cooperative: retain the slot until the actual handler settles.
      release();
    });
    return entry.promise;
  }
}
