import { CapabilityError, type ToolDefinition, type ToolDescriptor } from './contracts.ts';
import { compileSchema, snapshotJson } from './json.ts';
import { capabilityToolName } from './tool-name.ts';

export const REGISTRY_LIMITS = Object.freeze({ catalogBytes: 16 * 1024 * 1024, owners: 1024 });
export interface RegistryChange {
  readonly revision: number;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
}
/** Host-held authority, not a model tool and not a code sandbox. */
export interface CapabilityOwner {
  readonly id: string;
  register(tool: ToolDefinition): ToolDescriptor;
  /** Replacement is immediately visible. Await retirement before disposing the old runtime. */
  update(tool: ToolDefinition): Promise<void>;
  unregister(id: string): Promise<void>;
  describe(): readonly ToolDescriptor[];
  /** Immediately removes all tools; waits for actual handlers and their compensation. */
  dispose(): Promise<void>;
}
export interface Registration {
  readonly tool: ToolDefinition;
  readonly descriptor: ToolDescriptor;
  readonly bytes: number;
  readonly controller: AbortController;
  active: number;
  retired: boolean;
  readonly drained: Promise<void>;
  drain(): void;
}

/** Validate all registration data before the live catalog can change. */
export function compileRegistration(value: ToolDefinition, revision: number, ownerId?: string): Registration {
  const validId = ownerId === undefined ? /^tf\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/.test(value.id)
    : value.id.startsWith(`user.${ownerId}.`) && /^user\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/.test(value.id);
  if (!validId || value.id.length > 128 || !Number.isSafeInteger(value.version) || value.version < 1
    || typeof value.description !== 'string' || !value.description.length || value.description.length > 2048
    || (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 128))
    || !['read', 'propose', 'write'].includes(value.effect) || typeof value.run !== 'function'
    || (value.scope !== undefined && value.scope !== 'chart' && value.scope !== 'app')
    || (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0 || value.timeoutMs > 120_000))
    || (value.prepare !== undefined && (value.effect !== 'write' || typeof value.prepare !== 'function'))
    || (value.prepareAsync !== undefined && (value.effect !== 'write' || typeof value.prepareAsync !== 'function' || value.prepare !== undefined))) {
    throw new CapabilityError('invalid_contract');
  }
  const descriptor: ToolDescriptor = Object.freeze({ id: value.id, version: value.version, description: value.description,
    wireName: capabilityToolName(value.id),
    source: ownerId === undefined ? 'builtin' : 'extension', ...(ownerId === undefined ? {} : { ownerId }),
    registrationRevision: revision, ...(value.title === undefined ? {} : { title: value.title }),
    effect: value.effect, ...(value.scope === undefined ? {} : { scope: value.scope }),
    inputSchema: compileSchema(value.inputSchema), outputSchema: compileSchema(value.outputSchema) });
  const bytes = snapshotJson(descriptor, REGISTRY_LIMITS.catalogBytes).bytes;
  const tool = Object.freeze({ ...descriptor, run: value.run,
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
    ...(value.prepare === undefined ? {} : { prepare: value.prepare }),
    ...(value.prepareAsync === undefined ? {} : { prepareAsync: value.prepareAsync }) });
  let drain!: () => void;
  const drained = new Promise<void>(resolve => { drain = resolve; });
  return { tool, descriptor, bytes, controller: new AbortController(), active: 0, retired: false, drained, drain };
}
