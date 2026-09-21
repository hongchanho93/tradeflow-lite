import { CAPABILITY_LIMITS, SELECTION_SCHEMA, sameSelection, isAppRef, type JsonValue, type Permission,
  type SelectionRef, type CapabilityContext, type ToolDescriptor, type ToolReply, type ValueSchema } from '../ai-capabilities/contracts.ts';
import type { CapabilitySession } from '../ai-capabilities/core.ts';
import { parseJson, snapshotJson, validateValue, ValueValidationError } from '../ai-capabilities/json.ts';
import { CHART_NAVIGATION_TOOLS } from '../ai-capabilities/chart-actions.ts';
import { capabilityToolName } from '../ai-capabilities/tool-name.ts';

// Deliberately legacy stdio, with an explicit modern-discovery fallback. Do not
// advertise 2026's different lifecycle without implementing that binding.
export const MCP_VERSIONS = ['2025-11-25', '2025-06-18'] as const;
export const MCP_LIMITS = Object.freeze({ requests: 4096, retainedBytes: 64 * 1024 * 1024,
  activeCalls: 4, approvalMs: 120_000, replyBytes: 4 * 1024 * 1024 });
export type McpMode = 'analysis' | 'assist' | 'workbench';
export type McpAccess = 'pending' | 'authorized' | 'stale' | 'revoked' | 'closed';
type RpcId = string | number;
type RecordValue = Record<string, JsonValue>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const validId = (v: unknown): v is RpcId => typeof v === 'string' ? v.length > 0 && v.length <= 128
  : typeof v === 'number' && Number.isSafeInteger(v);
const objectSchema = (properties: Record<string, ValueSchema>): ValueSchema =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const toolArgumentsSchema = (tool: ToolDescriptor): ValueSchema => tool.scope === 'app'
  ? objectSchema({ input: tool.inputSchema }) : objectSchema({ context: SELECTION_SCHEMA, input: tool.inputSchema });
const bytes = (s: string) => new TextEncoder().encode(s).length;
const rpcReply = (id: RpcId | null, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcId | null, code: number, message: string, data?: JsonValue) =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const toolReply = (id: RpcId, value: unknown, isError = false) => rpcReply(id, {
  content: [{ type: 'text', text: JSON.stringify({ reply: value }) }],
  structuredContent: { reply: value }, isError,
});
const toolError = (id: RpcId, code: string) => toolReply(id, { status: 'error', code }, true);
const sameTool = (a: ToolDescriptor | undefined, b: ToolDescriptor | undefined): boolean => a === b
  || (!!a && !!b && (a.registrationRevision !== undefined || b.registrationRevision !== undefined
    ? a.id === b.id && a.registrationRevision === b.registrationRevision : JSON.stringify(a) === JSON.stringify(b)));
// Canonical JSON <=1 MiB, plus its escaped text copy and the outer envelope.
// Reserve BEFORE calling a potentially mutating business tool.
const OUTPUT_RESERVATION = 3 * CAPABILITY_LIMITS.maxOutputBytes + 4096;
export interface McpHost {
  context(): SelectionRef;
  describe(): readonly ToolDescriptor[];
  subscribeTools?(listener: () => void): () => void;
  open(permissions: Readonly<Record<string, Permission>>): CapabilitySession;
}
export interface McpApproval {
  readonly id: string;
  readonly toolId: string;
  readonly input: JsonValue;
  readonly context: CapabilityContext;
  readonly proposal?: JsonValue;
}
type RequestEntry = { fingerprint: string; epoch: number; chartEpoch: number; scope: 'app' | 'chart';
  name: string; tool?: ToolDescriptor; completed?: boolean; promise: Promise<string | null>; cancel?: () => void; cancelled: boolean };
type ApprovalEntry = { view: McpApproval; decide(accept: boolean): void };

/** Authentication happens in the native MCP bridge before frames reach here.
 * Production UI treats that pairing credential as the user's connection grant. */
export class McpConnection {
  readonly #host: McpHost;
  readonly #changed: () => void;
  readonly #approvalMs: number;
  readonly #tools = new Map<string, ToolDescriptor>();
  #listed = new Map<string, ToolDescriptor>();
  readonly #unsubscribeTools?: () => void;
  readonly #toolsChanged?: () => Promise<void> | void;
  #notificationDirty = false;
  #notificationQueued = false;
  #notificationRunning = false;
  #assistant = false;
  readonly #requests = new Map<string, RequestEntry>();
  readonly #approvals = new Map<string, ApprovalEntry>();
  readonly #proposals = new Map<string, JsonValue>();
  #session?: CapabilitySession;
  #scope?: SelectionRef;
  #initialized = false;
  #ready = false;
  #bytes = 0;
  #active = 0;
  #sequence = 0;
  #epoch = 0;
  #chartEpoch = 0;
  #chartNeedsRebind = false;
  #name = 'MCP client';
  #access: McpAccess = 'pending';
  #mode: McpMode = 'assist';

  constructor(host: McpHost, changed: () => void = () => {}, options: {
    approvalMs?: number; toolsChanged?: () => Promise<void> | void;
  } = {}) {
    this.#host = host; this.#changed = changed;
    this.#approvalMs = options.approvalMs ?? MCP_LIMITS.approvalMs;
    if (!Number.isSafeInteger(this.#approvalMs) || this.#approvalMs <= 0 || this.#approvalMs > MCP_LIMITS.approvalMs) throw new Error('invalid timeout');
    this.#toolsChanged = options.toolsChanged;
    this.#refreshCatalog(); this.#listed = new Map(this.#tools);
    this.#unsubscribeTools = host.subscribeTools?.(() => {
      if (this.#refreshCatalog()) this.#scheduleToolsChanged();
    });
  }
  #refreshCatalog(): boolean {
    const next = new Map<string, ToolDescriptor>();
    for (const tool of this.#host.describe()) {
      const name = capabilityToolName(tool.id);
      if (next.has(name) || name === 'tf_context_get') throw new Error('MCP tool name collision');
      next.set(name, tool);
    }
    const changed = next.size !== this.#tools.size || [...next].some(([name, tool]) => !sameTool(tool, this.#tools.get(name)));
    if (!changed) return false;
    const obsolete = new Set([...this.#tools].filter(([name, tool]) => !sameTool(tool, next.get(name))).map(([, tool]) => tool.id));
    this.#tools.clear(); for (const [name, tool] of next) this.#tools.set(name, tool);
    for (const approval of [...this.#approvals.values()]) if (obsolete.has(approval.view.toolId)) approval.decide(false);
    return true;
  }
  #scheduleToolsChanged(): void {
    if (!this.#toolsChanged || !this.#ready || this.#access === 'closed') return;
    this.#notificationDirty = true;
    if (this.#notificationQueued || this.#notificationRunning) return;
    this.#notificationQueued = true;
    queueMicrotask(() => { this.#notificationQueued = false; void this.#notifyToolsChanged(); });
  }
  async #notifyToolsChanged(): Promise<void> {
    if (!this.#notificationDirty || this.#access === 'closed' || !this.#toolsChanged) return;
    this.#notificationDirty = false; this.#notificationRunning = true;
    try { await this.#toolsChanged(); }
    catch { this.close(); }
    finally {
      this.#notificationRunning = false;
      if (this.#notificationDirty) this.#scheduleToolsChanged();
    }
  }
  #permissions(): Record<string, Permission> {
    const permissions: Record<string, Permission> = Object.create(null);
    for (const tool of this.#tools.values()) permissions[tool.id] = 'allow';
    return permissions;
  }
  view() { return { name: this.#name, ready: this.#ready, access: this.#access, mode: this.#mode,
    appAccess: !!this.#session && this.#access === 'authorized' && [...this.#tools.values()].some(tool => tool.scope === 'app'),
    context: this.#scope, active: this.#active, approvals: [...this.#approvals.values()].map(a => a.view) }; }

  authorize(_mode: McpMode = 'workbench'): void {
    this.#authorize('workbench', false);
  }
  /** In-process UI only, never callable through receive or MCP parameters. */
  authorizeAssistant(): void {
    this.#authorize('workbench', true);
  }
  #authorize(mode: McpMode, assistant: boolean): void {
    if (!this.#ready || !['analysis', 'assist', 'workbench'].includes(mode) || this.#access === 'closed') throw new Error('invalid MCP authorization');
    this.#endAccess('pending');
    this.#refreshCatalog(); this.#assistant = assistant; this.#mode = 'workbench';
    this.#listed = new Map(this.#tools);
    this.#scope = Object.freeze({ ...this.#host.context() });
    this.#session = this.#host.open(this.#permissions());
    this.#chartNeedsRebind = false;
    this.#access = 'authorized'; this.#changed();
  }
  approve(id: string, accept: boolean): void { this.#approvals.get(id)?.decide(accept); }
  invalidate(): void {
    if (this.#access !== 'authorized') return;
    this.#chartEpoch++;
    this.#session?.invalidateChart();
    this.#chartNeedsRebind = true;
    for (const item of [...this.#approvals.values()]) if (!isAppRef(item.view.context)) item.decide(false);
    this.#proposals.clear();
    for (const entry of this.#requests.values()) {
      // An explicit chart-navigation transaction changes the chart as part of
      // its own commit. Let that exact in-flight request finish verification
      // and rebind below; unrelated/manual invalidation still kills every
      // other old-chart request.
      const navigating = entry.tool && CHART_NAVIGATION_TOOLS.has(entry.tool.id) && !entry.completed;
      if (entry.scope !== 'app' && !navigating) { entry.cancel?.(); entry.promise = Promise.resolve(null); }
    }
    this.#changed();
  }
  #tryRebindCurrentChart(): boolean {
    if (!this.#chartNeedsRebind) return true;
    const session = this.#session, scope = this.#scope;
    if (!session || !scope || isAppRef(scope)) return false;
    const current = this.#host.context();
    if (scope.appInstanceId !== current.appInstanceId || scope.chartId !== current.chartId) {
      this.revoke(); return false;
    }
    if (sameSelection(scope, current)) return false;
    try {
      session.rebindChart(current);
      this.#scope = Object.freeze({ ...current });
      this.#chartNeedsRebind = false;
      return true;
    } catch { return false; }
  }
  revoke(): void { this.#endAccess('revoked'); }
  close(): void { this.#unsubscribeTools?.(); this.#notificationDirty = false; this.#endAccess('closed'); this.#requests.clear(); }
  #endAccess(state: McpAccess): void {
    // A queued UI action must never revive a detached/closed connection.
    if (this.#access === 'closed') return;
    this.#epoch++; this.#access = state;
    this.#chartNeedsRebind = false;
    this.#session?.close(); this.#session = undefined;
    for (const item of [...this.#approvals.values()]) item.decide(false);
    this.#proposals.clear();
    // Keep ID tombstones, never old readable results or approvals across grants.
    for (const entry of this.#requests.values()) {
      entry.cancel?.(); entry.promise = Promise.resolve(null);
    }
    this.#changed();
  }

  async receive(text: string): Promise<string | null> {
    if (this.#access === 'closed') return null;
    this.#refreshCatalog();
    let raw: JsonValue;
    try { raw = parseJson(text, CAPABILITY_LIMITS.maxRequestBytes).value; }
    catch { return rpcError(null, -32700, 'Invalid or oversized JSON'); }
    if (!record(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string'
      || Object.keys(raw).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k))
      || (raw.params !== undefined && !record(raw.params))
      || (Object.hasOwn(raw, 'id') && !validId(raw.id))) return rpcError(null, -32600, 'Invalid request');
    const params = (raw.params ?? {}) as RecordValue;
    if (!Object.hasOwn(raw, 'id')) {
      if (raw.method === 'notifications/initialized' && this.#initialized) { this.#ready = true; this.#changed(); }
      if (raw.method === 'notifications/cancelled' && validId(params.requestId)) {
        const entry = this.#requests.get(JSON.stringify(params.requestId));
        if (entry) { entry.cancelled = true; entry.cancel?.(); }
      }
      return null;
    }
    const id = raw.id as RpcId;
    if (raw.method === 'server/discover') return rpcError(id, -32601, 'Use legacy MCP initialize (2025-11-25 or 2025-06-18)');
    if (raw.method === 'ping') return rpcReply(id, {});
    if (raw.method === 'initialize') {
      if (this.#initialized || typeof params.protocolVersion !== 'string'
        || !record(params.capabilities) || !record(params.clientInfo)
        || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        return rpcError(id, -32602, 'Invalid initialization');
      }
      this.#initialized = true;
      this.#name = params.clientInfo.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || 'MCP client';
      this.#changed();
      return rpcReply(id, { protocolVersion: MCP_VERSIONS.includes(params.protocolVersion as typeof MCP_VERSIONS[number])
        ? params.protocolVersion : MCP_VERSIONS[0], capabilities: { tools: { listChanged: !!this.#unsubscribeTools && !!this.#toolsChanged } },
        serverInfo: { name: 'tradeflow-lite', version: '0.1.0' },
        instructions: 'This local MCP connection is already authorized by the pairing credential in the copied Lite configuration. No additional Lite approval step is required. Call tf_context_get before chart tools to read the current chart. '
          + 'Pass its exact context to chart tools. App tools accept input only and do not require tf_context_get. '
          + 'Never invent data or retarget stale requests. '
          + 'Refresh tools/list after notifications/tools/list_changed or a tool_changed result; do not retry old request IDs. '
          + 'The authenticated connection covers all exposed Lite business tools; there are no per-operation approval prompts. User indicator tools access only .tfi library source, not application source, arbitrary files, terminal or trading.' });
    }
    if (!this.#ready) return rpcError(id, -32002, 'MCP initialization required');
    if (raw.method === 'tools/list') {
      if (Object.keys(params).some(k => k !== '_meta')) return rpcError(id, -32602, 'Invalid cursor or list parameters');
      this.#listed = new Map(this.#tools);
      if (this.#session && this.#access === 'authorized') this.#session.refreshTools(this.#permissions());
      return rpcReply(id, { tools: [
        { name: 'tf_context_get', description: 'Read the current chart selection under the existing one-time user authorization. Chart changes do not require a new authorization. Old chart requests are never retargeted.',
          inputSchema: objectSchema({}), annotations: { readOnlyHint: true, openWorldHint: false } },
        ...[...this.#tools].map(([name, tool]) => ({ name, description: tool.description,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          ...(tool.registrationRevision === undefined ? {} : { _meta: { 'tradeflow/registrationRevision': tool.registrationRevision,
            'tradeflow/id': tool.id, 'tradeflow/version': tool.version,
            'tradeflow/source': tool.source, ...(tool.ownerId ? { 'tradeflow/ownerId': tool.ownerId } : {}) } }),
          inputSchema: toolArgumentsSchema(tool),
          annotations: { readOnlyHint: tool.effect !== 'write', destructiveHint: tool.effect === 'write',
            idempotentHint: tool.effect === 'read', openWorldHint: false } })),
      ] });
    }
    if (raw.method !== 'tools/call') return rpcError(id, -32601, 'Method not found');
    if (Object.keys(params).some(k => !['name', 'arguments', '_meta'].includes(k)) || typeof params.name !== 'string') {
      return rpcError(id, -32602, 'Invalid tool parameters');
    }
    const key = JSON.stringify(id);
    const fingerprint = snapshotJson(raw, CAPABILITY_LIMITS.maxRequestBytes).text;
    const previous = this.#requests.get(key);
    if (previous && !sameTool(previous.tool, this.#tools.get(previous.name))) return toolError(id, 'tool_changed');
    // Replayed IDs must pass current app/selection checks too, not just fresh calls.
    if (this.#scope && this.#access === 'authorized') {
      const current = this.#host.context();
      if (this.#scope.appInstanceId !== current.appInstanceId) { this.revoke(); return toolError(id, 'context_stale'); }
      if (previous?.scope === 'chart' && !sameSelection(this.#scope, current)) {
        this.invalidate(); return toolError(id, 'context_stale');
      }
    }
    if (previous) {
      if (previous.scope === 'chart' && previous.chartEpoch !== this.#chartEpoch) return toolError(id, 'context_stale');
      if (previous.epoch !== this.#epoch || this.#access !== 'authorized') return toolError(id, 'context_stale');
      return previous.fingerprint === fingerprint ? previous.promise : rpcError(id, -32600, 'Request ID reused with different content');
    }
    if (this.#requests.size >= MCP_LIMITS.requests || this.#bytes + bytes(fingerprint) + OUTPUT_RESERVATION > MCP_LIMITS.retainedBytes) {
      return toolError(id, 'session_capacity');
    }
    if (this.#active >= MCP_LIMITS.activeCalls) return toolError(id, 'busy');
    const entry: RequestEntry = { fingerprint, epoch: this.#epoch, chartEpoch: this.#chartEpoch,
      scope: this.#tools.get(params.name)?.scope === 'app' ? 'app' : 'chart',
      name: params.name, tool: this.#tools.get(params.name),
      promise: Promise.resolve(null), cancelled: false };
    this.#requests.set(key, entry); this.#bytes += bytes(fingerprint) + OUTPUT_RESERVATION;
    this.#active++; this.#changed();
    entry.promise = this.#call(id, params, entry).catch(() => toolError(id, 'tool_failed')).then(result => {
      this.#refreshCatalog();
      if (entry.cancelled || this.#access === 'closed') { this.#bytes -= OUTPUT_RESERVATION; return null; }
      if (!entry.completed && !sameTool(entry.tool, this.#tools.get(entry.name))) result = toolError(id, 'tool_changed');
      const verifiedNavigation = entry.completed && !!entry.tool && CHART_NAVIGATION_TOOLS.has(entry.tool.id);
      if (entry.epoch !== this.#epoch || (entry.scope !== 'app' && entry.chartEpoch !== this.#chartEpoch && !verifiedNavigation)) {
        result = toolError(id, 'context_stale');
      }
      if (bytes(result) > OUTPUT_RESERVATION) result = toolError(id, 'invalid_output');
      this.#bytes -= OUTPUT_RESERVATION - bytes(result);
      return result;
    }).finally(() => { this.#active--; entry.cancel = undefined; this.#changed(); });
    return entry.promise;
  }

  async #call(id: RpcId, params: RecordValue, entry: RequestEntry): Promise<string> {
    const session = this.#session;
    if (this.#access !== 'authorized' || !session || !this.#scope) return toolError(id, 'authorization_required');
    if (this.#scope.appInstanceId !== this.#host.context().appInstanceId) { this.revoke(); return toolError(id, 'context_stale'); }
    const args = params.arguments ?? {};
    if (params.name === 'tf_context_get') {
      if (!record(args) || Object.keys(args).length) return rpcError(id, -32602, 'This tool takes no arguments');
      if (this.#chartNeedsRebind && !this.#tryRebindCurrentChart()) return toolError(id, 'context_stale');
      return toolReply(id, { context: this.#scope, mode: this.#mode });
    }
    const tool = this.#tools.get(params.name as string);
    if (!sameTool(tool, this.#listed.get(params.name as string))) return toolError(id, 'tool_changed');
    if (!tool) return rpcError(id, -32602, 'Unknown tool');
    if (tool.scope !== 'app') {
      const current = this.#host.context();
      if (!sameSelection(this.#scope, current)) {
        if (!this.#chartNeedsRebind) this.invalidate();
        if (!this.#tryRebindCurrentChart()) return toolError(id, 'context_stale');
      }
    }
    const scope = this.#scope!;
    try { validateValue(args, toolArgumentsSchema(tool), 'arguments'); }
    catch (error) {
      if (error instanceof ValueValidationError) {
        return rpcError(id, -32602, 'Invalid tool arguments', {
          path: error.path, reason: error.reason, expected: error.expected,
        });
      }
      return rpcError(id, -32602, 'Invalid tool arguments');
    }
    const input = (args as RecordValue).input;
    const context: CapabilityContext = tool.scope === 'app' ? { scope: 'app', appInstanceId: scope.appInstanceId } : scope;
    if (tool.scope !== 'app' && !sameSelection(scope, (args as RecordValue).context as unknown as SelectionRef)) return toolError(id, 'context_stale');
    const requestId = `mcp-${++this.#sequence}`;
    entry.cancel = () => { session.cancel(requestId); this.#approvals.get(requestId)?.decide(false); };
    let result: ToolReply = await session.invoke(JSON.stringify({ protocolVersion: 1, requestId, toolId: tool.id, context, input }));
    if (result.status === 'approval_required') {
      if (entry.cancelled || this.#session !== session) { session.cancel(requestId); return toolError(id, 'cancelled'); }
      const changeSetId = record(input) && typeof input.changeSetId === 'string' ? input.changeSetId : undefined;
      const proposal = changeSetId ? this.#proposals.get(changeSetId) : undefined;
      const accepted = await new Promise<boolean>(resolve => {
        let settled = false;
        const decide = (yes: boolean) => {
          if (settled) return; settled = true;
          clearTimeout(timer); this.#approvals.delete(requestId); resolve(yes); this.#changed();
        };
        const timer = setTimeout(() => decide(false), this.#approvalMs);
        this.#approvals.set(requestId, { view: Object.freeze({ id: requestId, toolId: tool.id, input, context,
          ...(proposal === undefined ? {} : { proposal }) }), decide });
        this.#changed();
      });
      if (!accepted || entry.cancelled || this.#session !== session) {
        session.cancel(requestId); result = { status: 'error', requestId, code: 'cancelled' };
      } else result = await session.approve(requestId);
    }
    // A committed success or failed compensation is a final outcome, not merely a
    // stale catalog. Preserve its first reply: tool_changed must never imply that
    // a failed rollback recovered user content. Replays still check registration identity.
    entry.completed = result.status === 'ok' || (result.status === 'error' && result.code === 'rollback_failed');
    if (result.status === 'ok' && CHART_NAVIGATION_TOOLS.has(tool.id)) {
      // Only the verified result of this explicit navigation may move this grant.
      // Do not adopt whichever chart happens to be current after an unrelated UI action.
      if (entry.cancelled || this.#session !== session || entry.epoch !== this.#epoch) return toolError(id, 'context_stale');
      const data = record(result.data) ? result.data : undefined;
      const expected = record(input) ? input.expected : undefined;
      try {
        if (!data) throw new Error('missing navigation result');
        validateValue(data.from, SELECTION_SCHEMA); validateValue(data.selection, SELECTION_SCHEMA);
        const from = data!.from as unknown as SelectionRef, next = data!.selection as unknown as SelectionRef;
        if (!expected || !sameSelection(from, expected as unknown as SelectionRef) || data!.ready !== true
          || from.appInstanceId !== scope.appInstanceId || from.chartId !== scope.chartId
          || next.appInstanceId !== from.appInstanceId || next.chartId !== from.chartId
          || next.selectionGeneration !== from.selectionGeneration + 1
          || !sameSelection(next, this.#host.context())) throw new Error('stale navigation');
        session.rebindChart(next);
        this.#scope = Object.freeze({ ...next }); this.#chartEpoch++; this.#chartNeedsRebind = false;
        this.#access = 'authorized'; this.#proposals.clear(); this.#changed();
      } catch { return toolError(id, 'context_stale'); }
    }
    if (result.status === 'ok' && tool.id === 'tf.drawings.propose' && record(result.data)
      && typeof result.data.changeSetId === 'string') {
      this.#proposals.set(result.data.changeSetId, result.data);
      if (this.#proposals.size > 32) this.#proposals.delete(this.#proposals.keys().next().value!);
    }
    return toolReply(id, result, result.status !== 'ok');
  }
}
