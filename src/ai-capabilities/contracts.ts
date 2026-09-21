/** Model/transport-independent contracts. Only trusted host modules register tools. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Deliberately supported JSON Schema subset, not a general schema implementation. */
export type ValueSchema =
  | { readonly type: 'null' | 'boolean' }
  | { readonly type: 'string'; readonly enum?: readonly string[]; readonly maxLength?: number }
  | { readonly type: 'number' | 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'array'; readonly items: ValueSchema; readonly maxItems?: number }
  | {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, ValueSchema>>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };

export interface SelectionRef {
  readonly appInstanceId: string;
  readonly chartId: string;
  readonly provider: string;
  readonly instrument: string;
  readonly resolution: string;
  readonly adjustment: string;
  readonly selectionGeneration: number;
}

/** Application-owned data does not require a selected/loaded chart. */
export interface AppRef {
  readonly scope: 'app';
  readonly appInstanceId: string;
}
export type CapabilityContext = SelectionRef | AppRef;
export function isAppRef(context: CapabilityContext): context is AppRef {
  return 'scope' in context && context.scope === 'app';
}
export function requireChartSelection(context: CapabilityContext): SelectionRef {
  if (isAppRef(context)) throw new CapabilityError('context_stale');
  return context;
}

export interface ToolRequest {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly toolId: string;
  readonly context: CapabilityContext;
  readonly input: JsonValue;
}

export type Permission = 'allow' | 'ask' | 'deny';
export type ToolEffect = 'read' | 'propose' | 'write';
export interface ToolDescriptor {
  readonly id: string;
  /** Tool contract version, independent of the wire protocol version. */
  readonly version: number;
  readonly title?: string;
  /** Assigned by the registry, never trusted from model or manifest fields. */
  readonly source?: 'builtin' | 'extension';
  readonly ownerId?: string;
  readonly registrationRevision?: number;
  readonly wireName?: string;
  readonly description: string;
  readonly effect: ToolEffect;
  /** Missing scope preserves the original chart-only contract. Host-defined, never a wire permission. */
  readonly scope?: 'chart' | 'app';
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
}

export interface ToolExecutionContext {
  readonly context: CapabilityContext;
  readonly signal: AbortSignal;
  /** Host-owned identity, never supplied by wire input or serialized to the model. */
  readonly session: ToolSessionScope;
  /** Dynamic tool lifetime, also cancelled on session/chart retirement. Share data by session,
   * clean implementation-specific resources on registration.signal. Never a wire value. */
  readonly registration?: ToolSessionScope;
  /** Check again after asynchronous work; this is NOT an OS/JavaScript sandbox. */
  readonly checkpoint: () => void;
}

export interface ToolSessionScope {
  /** Revocation/close releases session-owned datasets as well as running tasks. */
  readonly signal: AbortSignal;
  /** Host-only identity shared by app/chart scopes belonging to one CapabilitySession. Never serialized. */
  readonly sessionIdentity?: object;
}

export interface ToolDefinition extends ToolDescriptor {
  /** Host-selected I/O budget, never a request parameter. Default tools keep the core budget. */
  readonly timeoutMs?: number;
  /** Read/proposal handler. Never called for a write tool. */
  readonly run: (input: JsonValue, context: ToolExecutionContext) => JsonValue | Promise<JsonValue>;
  /** Trusted preparation only: no document mutation before commit. */
  readonly prepare?: (input: JsonValue, context: ToolExecutionContext) => ToolTransaction | Promise<ToolTransaction>;
  /** Trusted storage/navigation port only. UI/model input cannot select this execution path. */
  readonly prepareAsync?: (input: JsonValue, context: ToolExecutionContext) => AsyncToolTransaction | Promise<AsyncToolTransaction>;
}

export interface ToolTransaction {
  /** Validated and reserved BEFORE any side effect. No output created by commit. */
  readonly result: JsonValue;
  /** Synchronous, bounded host transaction. No await, user code or external I/O. */
  readonly commit: () => undefined;
  /** Must restore partial commits too; failure is explicitly reported, never hidden. */
  readonly rollback: () => undefined;
  /** Release a preparation lease even if validation/cancellation prevents commit. */
  readonly dispose?: () => void;
}

export interface AsyncToolTransaction {
  readonly result: JsonValue;
  /** Cooperative bounded I/O. Failure/cancellation must be compensated before settling. */
  readonly commit: () => Promise<undefined>;
  readonly rollback: () => Promise<undefined>;
  readonly dispose?: () => void;
}

export type CapabilityErrorCode =
  | 'invalid_request' | 'unsupported_version' | 'invalid_contract' | 'unknown_tool'
  | 'permission_denied' | 'write_requires_changeset' | 'context_stale'
  | 'request_conflict' | 'session_closed' | 'session_capacity' | 'busy'
  | 'cancelled' | 'timeout' | 'invalid_output' | 'tool_failed' | 'not_awaiting_approval'
  | 'data_not_ready' | 'invalid_chart_data' | 'snapshot_unavailable' | 'snapshot_capacity'
  | 'field_unavailable' | 'numeric_overflow'
  | 'drawing_conflict' | 'drawing_unavailable' | 'drawing_capacity' | 'drawing_host_failed'
  | 'changeset_unavailable' | 'changeset_state' | 'rollback_failed'
  | 'state_conflict' | 'storage_failed' | 'indicator_failed' | 'navigation_failed'
  | 'tool_changed' | 'registry_capacity';

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly details?: JsonValue;
  constructor(code: CapabilityErrorCode, details?: JsonValue) {
    super(code);
    this.name = 'CapabilityError';
    this.code = code;
    this.details = details;
  }
}

export type ToolReply =
  | { readonly status: 'ok'; readonly requestId: string; readonly data: JsonValue }
  | { readonly status: 'approval_required'; readonly requestId: string }
  | { readonly status: 'error'; readonly requestId: string; readonly code: CapabilityErrorCode;
      readonly path?: string; readonly reason?: string; readonly expected?: string; readonly details?: JsonValue };

export const CAPABILITY_LIMITS = Object.freeze({
  // A valid 256 KiB .tfi plus JSON framing. Schemas and retained session bytes
  // still bound normal inputs; the transport budget grants no execution rights.
  maxRequestBytes: 16 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxJsonDepth: 32,
  maxJsonNodes: 30_000,
  // Catalog/session counts are process-safety ceilings, not product quotas.
  // Keep them far beyond ordinary user workspaces; byte/concurrency budgets
  // remain the meaningful resource guards.
  maxTools: 1024,
  maxSessions: 32,
  maxRequestsPerSession: 4096,
  maxStoredBytesPerSession: 64 * 1024 * 1024,
  maxActiveGlobal: 4,
  maxActivePerSession: 2,
  timeoutMs: 10_000,
});

export type CapabilityLimits = { readonly [K in keyof typeof CAPABILITY_LIMITS]: number };

export const APP_SCHEMA: ValueSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    scope: Object.freeze({ type: 'string', enum: Object.freeze(['app']) }),
    appInstanceId: Object.freeze({ type: 'string', maxLength: 128 }),
  }),
  required: Object.freeze(['scope', 'appInstanceId']),
  additionalProperties: false,
});

export const SELECTION_SCHEMA: ValueSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    appInstanceId: Object.freeze({ type: 'string', maxLength: 128 }),
    chartId: Object.freeze({ type: 'string', maxLength: 128 }),
    provider: Object.freeze({ type: 'string', maxLength: 128 }),
    instrument: Object.freeze({ type: 'string', maxLength: 256 }),
    resolution: Object.freeze({ type: 'string', maxLength: 128 }),
    adjustment: Object.freeze({ type: 'string', maxLength: 128 }),
    selectionGeneration: Object.freeze({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  }),
  required: Object.freeze([
    'appInstanceId', 'chartId', 'provider', 'instrument', 'resolution', 'adjustment', 'selectionGeneration',
  ]),
  additionalProperties: false,
});

export function sameSelection(a: SelectionRef, b: SelectionRef): boolean {
  return a.appInstanceId === b.appInstanceId && a.chartId === b.chartId
    && a.provider === b.provider && a.instrument === b.instrument
    && a.resolution === b.resolution && a.adjustment === b.adjustment
    && a.selectionGeneration === b.selectionGeneration;
}
