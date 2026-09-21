import type { AsyncToolTransaction, JsonValue, ToolSessionScope } from '../ai-capabilities/contracts.ts';
import { TASK_LIMITS, TaskError, exact, object, taskError, taskJson, taskParameters, taskSymbol, text, type TaskManifest, type TaskSymbol } from './contracts.ts';
import { openTaskRuntime, type TaskRuntime, type TaskRuntimeOptions } from './runtime-client.ts';
import { TaskResultStore, type ResultPageQuery } from './results.ts';
import type { TaskDataHost, TaskSourceLease } from './sources.ts';

export interface ValidatedTask { readonly source: string; readonly hash: string; readonly manifest: TaskManifest }
export type TaskUniverse = { type: 'catalog' } | { type: 'symbols'; symbols: readonly TaskSymbol[] }
  | { type: 'result'; taskId: string; artifactId: string };
export interface TaskStart { providerId: string; venue?: string; universe: TaskUniverse; parameters?: JsonValue }
export interface TaskManagerOptions extends TaskRuntimeOptions { ioTimeoutMs?: number }
type State = 'prepared' | 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
type Run = { id: string; validated: ValidatedTask; owner: ToolSessionScope; definitionSignal?: AbortSignal; abort: AbortController;
  lease: TaskSourceLease; options: TaskStart; state: State; results: TaskResultStore; discovered: number; processed: number;
  universeComplete: boolean; shortfallSymbols: number; emptySymbols: number; startedAt: number; finishedAt?: number; errorCode?: string; currentSymbol?: string; failedSymbol?: string;
  runtime?: TaskRuntime; done: Promise<void>; resolve(): void; cleanup(): void; removeAfter: boolean; executionStarted: boolean;
  readers: Map<ToolSessionScope, () => void> };

/** Long task lifetime is distinct from the short start Tool request. No foreground chart state. */
export class UserTaskManager {
  readonly #data: TaskDataHost; readonly #options: TaskManagerOptions;
  readonly #validated = new WeakSet<ValidatedTask>(); readonly #runs = new Map<string, Run>();
  readonly #localSessions = new WeakSet<ToolSessionScope>();
  readonly #listeners = new Set<() => void>(); readonly #lifetime = new AbortController();
  readonly #acquiring = new Set<Promise<void>>();
  readonly #shares = new Map<string, { taskId: string; expires: number }>();
  #closed = false; #preparing = 0; #lastProgress = 0;
  constructor(data: TaskDataHost, options: TaskManagerOptions = {}) { this.#data = data; this.#options = options; }
  #check() { if (this.#closed) throw new TaskError('task_closed'); }
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #emit(force = false) {
    if (!force && performance.now() - this.#lastProgress < 80) return; this.#lastProgress = performance.now();
    for (const listener of this.#listeners) { try { listener(); } catch { /* UI observers cannot fail a task. */ } }
  }
  get activeCount() { return [...this.#runs.values()].filter(r => !['completed','cancelled','failed'].includes(r.state)).length + this.#preparing; }
  async validate(source: string, signal: AbortSignal): Promise<ValidatedTask> {
    this.#check(); const scope = AbortSignal.any([signal, this.#lifetime.signal]);
    const runtime = await openTaskRuntime(source, scope, this.#options);
    try {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(n => n.toString(16).padStart(2, '0')).join('');
      this.#check(); if (scope.aborted) throw new TaskError('task_cancelled');
      const prepared = Object.freeze({ source, hash, manifest: runtime.manifest }); this.#validated.add(prepared); return prepared;
    } finally { runtime.close(); }
  }
  assertValidated(value: ValidatedTask): void { this.#check(); if (!this.#validated.has(value)) throw new TaskError('task_validation_required'); }
  /** Ordinary app UI authority; never accepted from model input or exposed as a Tool. */
  createLocalSession(signal: AbortSignal): ToolSessionScope {
    this.#check(); const owner = Object.freeze({ signal }); this.#localSessions.add(owner); return owner;
  }
  /** Registry retirement alone drains the short start call, not its long job. */
  async retireDefinition(signal: AbortSignal): Promise<void> {
    const runs = [...this.#runs.values()].filter(r => r.definitionSignal === signal);
    for (const run of runs) this.#cancel(run, new TaskError('task_definition_changed'));
    await Promise.all(runs.map(r => r.done));
  }
  #get(id: string, owner?: ToolSessionScope, readOnly = false): Run {
    this.#check(); const run = this.#runs.get(id);
    if (!run || run.removeAfter || (owner && (owner.signal.aborted || (run.owner !== owner && !(readOnly && (run.readers.has(owner) || this.#localSessions.has(owner))))))) throw new TaskError('task_unavailable'); return run;
  }
  status(id: string, owner?: ToolSessionScope) {
    const r = this.#get(id, owner, true);
    return { taskId: r.id, title: r.validated.manifest.name, state: r.state, definitionId: r.validated.manifest.id,
      definitionVersion: r.validated.manifest.version, definitionHash: r.validated.hash, providerId: r.lease.providerId, sourceName: r.lease.name,
      sourceRevision: r.lease.revision, processed: r.processed, discovered: r.discovered, universeComplete: r.universeComplete,
      universeScope: r.options.universe.type === 'catalog' ? r.lease.catalogScope ?? 'provider-returned-catalog' : 'explicit-symbols',
      shortfallSymbols: r.shortfallSymbols, emptySymbols: r.emptySymbols,
      complete: r.state === 'completed', startedAt: r.startedAt, resultBytes: r.results.bytes,
      ...(r.finishedAt === undefined ? {} : { finishedAt: r.finishedAt }), ...(r.errorCode ? { errorCode: r.errorCode } : {}),
      ...(r.state === 'failed' ? { failureStage: 'runtime' } : {}),
      ...(r.currentSymbol ? { currentSymbol: r.currentSymbol } : {}), ...(r.failedSymbol ? { failedSymbol: r.failedSymbol } : {}), artifacts: r.results.describe() };
  }
  list(owner?: ToolSessionScope) { this.#check(); return [...this.#runs.values()].filter(r => !r.removeAfter && (!owner || !owner.signal.aborted && (r.owner === owner || r.readers.has(owner)))).map(r => this.status(r.id, owner)); }
  page(id: string, artifactId: string, query: ResultPageQuery, owner?: ToolSessionScope) { return this.#get(id, owner, true).results.page(artifactId, query); }
  /** Only the ordinary UI creates a short-lived result share after an explicit user click.
   * This is a read grant, not cancellation, template installation or directory authority. */
  createShare(id: string): string {
    this.#get(id); const now = Date.now();
    for (const [token, share] of this.#shares) if (share.expires <= now || !this.#runs.has(share.taskId)) this.#shares.delete(token);
    if (this.#shares.size >= 16) throw new TaskError('task_share_limit');
    const token = crypto.randomUUID(); this.#shares.set(token, { taskId: id, expires: now + 300_000 }); return token;
  }
  claimShare(token: string, owner: ToolSessionScope) {
    this.#check(); const share = this.#shares.get(token); this.#shares.delete(token);
    if (!share || share.expires <= Date.now() || owner.signal.aborted) throw new TaskError('task_share_unavailable');
    const run = this.#get(share.taskId);
    if (!run.readers.has(owner)) {
      if (run.readers.size >= 8) throw new TaskError('task_share_limit');
      const revoke = () => { run.readers.delete(owner); owner.signal.removeEventListener('abort', revoke); };
      run.readers.set(owner, revoke); owner.signal.addEventListener('abort', revoke, { once: true });
    }
    return this.status(run.id, owner);
  }
  export(id: string, artifactId: string, format: 'csv' | 'json' | 'markdown', owner?: ToolSessionScope) { return this.#get(id, owner).results.export(artifactId, format); }
  definition(id: string, owner?: ToolSessionScope): ValidatedTask {
    const r = this.#get(id, owner); if (r.state !== 'completed') throw new TaskError('task_not_completed'); return r.validated;
  }
  manifest(id: string): TaskManifest { return this.#get(id).validated.manifest; }
  revokeShare(token: string): void { this.#shares.delete(token); }
  async wait(id: string, owner?: ToolSessionScope): Promise<void> { await this.#get(id, owner).done; }
  cancel(id: string, owner?: ToolSessionScope): void { this.#cancel(this.#get(id, owner), new TaskError('task_cancelled')); }
  release(id: string, owner?: ToolSessionScope): void {
    const run = this.#get(id, owner); run.removeAfter = true; this.#cancel(run, new TaskError('task_cancelled'));
    if (['completed','cancelled','failed'].includes(run.state)) this.#drop(run); this.#emit(true);
  }
  #drop(run: Run) {
    run.cleanup(); for (const revoke of run.readers.values()) revoke(); run.readers.clear();
    for (const [token, share] of this.#shares) if (share.taskId === run.id) this.#shares.delete(token);
    run.results.close(); this.#runs.delete(run.id); this.#emit(true);
  }
  #cancel(run: Run, error: TaskError) {
    if (['completed','cancelled','failed'].includes(run.state)) return;
    run.abort.abort(error); run.runtime?.close(); run.state = 'cancelling'; this.#emit(true);
    if (!run.executionStarted) this.#finish(run, error);
  }
  #finish(run: Run, error?: unknown) {
    if (['completed','cancelled','failed'].includes(run.state)) return;
    const failure = run.abort.signal.aborted ? taskError(run.abort.signal.reason) : error === undefined ? undefined : taskError(error);
    run.state = !failure ? 'completed' : failure.code === 'task_cancelled' ? 'cancelled' : 'failed';
    run.errorCode = failure?.code; run.finishedAt = Date.now(); run.failedSymbol = failure && failure.code !== 'task_cancelled' ? run.currentSymbol : undefined; run.currentSymbol = undefined;
    run.runtime?.close(); run.runtime = undefined; run.lease.close(); run.resolve();
    if (run.removeAfter) this.#drop(run); this.#emit(true);
  }
  #universe(input: unknown, owner: ToolSessionScope, providerId: string): TaskUniverse {
    exact(input, ['type','symbols','taskId','artifactId'], ['type']);
    if (input.type === 'catalog') { exact(input, ['type']); return { type: 'catalog' }; }
    if (input.type === 'symbols') {
      exact(input, ['type','symbols']); if (!Array.isArray(input.symbols) || !input.symbols.length || input.symbols.length > TASK_LIMITS.universe) throw new TaskError('task_universe_limit');
      const symbols = input.symbols.map(taskSymbol);
      if (symbols.some(s => s.providerId !== providerId)) throw new TaskError('task_invalid_symbol');
      return { type: 'symbols', symbols: Object.freeze(symbols) };
    }
    if (input.type !== 'result') throw new TaskError('task_invalid_request'); exact(input, ['type','taskId','artifactId']);
    if (!text(input.taskId) || !text(input.artifactId)) throw new TaskError('task_invalid_request');
    const previous = this.#get(input.taskId, owner, true); if (previous.state !== 'completed') throw new TaskError('task_not_completed');
    const page = previous.results.page(input.artifactId, { limit: 1 }); if (page.type !== 'symbol_list') throw new TaskError('task_invalid_universe');
    const symbols: TaskSymbol[] = [];
    for (let offset = 0; offset < page.total; offset += TASK_LIMITS.pageRows) {
      const rows = previous.results.page(input.artifactId, { offset, limit: TASK_LIMITS.pageRows }).rows;
      for (const row of rows) { const symbol = taskSymbol(row); if (symbol.providerId !== providerId) throw new TaskError('task_invalid_symbol'); symbols.push(symbol); }
    }
    if (symbols.length > TASK_LIMITS.universe) throw new TaskError('task_universe_limit');
    // Snapshot identities only: releasing the original result cannot invalidate a queued job.
    return { type: 'symbols', symbols: Object.freeze(symbols) };
  }
  async prepareStart(validated: ValidatedTask, input: TaskStart, owner: ToolSessionScope,
    requestSignal: AbortSignal = owner.signal, definitionSignal?: AbortSignal): Promise<AsyncToolTransaction> {
    this.#check(); if (!this.#validated.has(validated)) throw new TaskError('task_validation_required');
    if (this.activeCount >= TASK_LIMITS.activeRuns || this.#runs.size + this.#preparing >= TASK_LIMITS.runs) throw new TaskError('task_capacity');
    exact(input, ['providerId','venue','universe','parameters'], ['providerId','universe']);
    if (!text(input.providerId,128)) throw new TaskError('task_invalid_source');
    const parameters = taskParameters(input.parameters, validated.manifest), universe = this.#universe(input.universe, owner, input.providerId);
    const preparing = AbortSignal.any([requestSignal, owner.signal, this.#lifetime.signal, ...(definitionSignal ? [definitionSignal] : [])]);
    if (preparing.aborted) throw new TaskError('task_cancelled'); this.#preparing++;
    let acquired!: () => void; const acquiring = new Promise<void>(resolve => { acquired = resolve; }); this.#acquiring.add(acquiring);
    const abort = new AbortController();
    const cancelPreparation = () => abort.abort(new TaskError('task_cancelled'));
    requestSignal.addEventListener('abort', cancelPreparation, { once: true });
    const dataLifetime = AbortSignal.any([abort.signal, owner.signal, this.#lifetime.signal, ...(definitionSignal ? [definitionSignal] : [])]);
    let lease: TaskSourceLease;
    try {
      lease = await this.#data.acquire(input.providerId, input.venue, validated.manifest.history, dataLifetime);
      if (preparing.aborted || lease.signal.aborted || this.#closed) { lease.close(); throw new TaskError('task_cancelled'); }
    } catch (error) { requestSignal.removeEventListener('abort', cancelPreparation); abort.abort(); throw error; }
    finally { this.#preparing--; this.#acquiring.delete(acquiring); acquired(); }
    let resolve!: () => void; const done = new Promise<void>(r => { resolve = r; });
    const id = crypto.randomUUID();
    const run: Run = { id, validated, owner, definitionSignal, abort, lease, options: { ...input, parameters, universe }, state: 'prepared',
      results: new TaskResultStore(validated.manifest.outputs), discovered: 0, processed: 0, universeComplete: false, shortfallSymbols: 0, emptySymbols: 0,
      startedAt: Date.now(), done, resolve, cleanup: () => {}, removeAfter: false, executionStarted: false, readers: new Map() };
    this.#runs.set(id, run);
    const retired = () => this.#cancel(run, new TaskError('task_source_changed'));
    const revoked = () => { run.removeAfter = true; this.#cancel(run, new TaskError('task_cancelled')); if (['completed','failed','cancelled'].includes(run.state)) this.#drop(run); };
    const uninstalled = () => this.#cancel(run, new TaskError('task_definition_changed'));
    owner.signal.addEventListener('abort', revoked, { once: true });
    lease.signal.addEventListener('abort', retired, { once: true });
    definitionSignal?.addEventListener('abort', uninstalled, { once: true });
    run.cleanup = () => { requestSignal.removeEventListener('abort', cancelPreparation); owner.signal.removeEventListener('abort', revoked); lease.signal.removeEventListener('abort', retired); definitionSignal?.removeEventListener('abort', uninstalled); };
    let committed = false, disposed = false;
    return { result: { taskId: id, state: 'queued', title: validated.manifest.name },
      commit: async () => {
        if (disposed || committed || preparing.aborted || run.state !== 'prepared') throw new TaskError('task_cancelled');
        committed = true; run.state = 'queued'; this.#emit(true); return undefined;
      },
      rollback: async () => { committed = false; run.removeAfter = true; this.#cancel(run, new TaskError('task_cancelled')); await done; if (this.#runs.has(id)) this.#drop(run); return undefined; },
      dispose: () => {
        if (disposed) return; disposed = true;
        requestSignal.removeEventListener('abort', cancelPreparation);
        if (!committed || preparing.aborted) { run.removeAfter = true; this.#cancel(run, new TaskError('task_cancelled')); if (this.#runs.has(id)) this.#drop(run); return; }
        // After the Core has confirmed the short transaction, no transient request timer owns the job.
        run.executionStarted = true; void this.#execute(run).catch(error => this.#finish(run, error));
      },
    };
  }
  async #execute(run: Run): Promise<void> {
    const checkpoint = () => { if (run.abort.signal.aborted) throw taskError(run.abort.signal.reason); if (this.#closed) throw new TaskError('task_cancelled'); };
    const timer = setTimeout(() => this.#cancel(run, new TaskError('task_wall_timeout')), TASK_LIMITS.taskWallMs);
    const read = async <T,>(operation: () => Promise<T>): Promise<T> => {
      checkpoint();
      const ioTimer = setTimeout(() => this.#cancel(run, new TaskError('task_data_timeout')), this.#options.ioTimeoutMs ?? TASK_LIMITS.ioMs);
      try { const value = await operation(); checkpoint(); return value; }
      finally { clearTimeout(ioTimer); }
    };
    const append = (value: JsonValue) => {
      checkpoint(); const others = [...this.#runs.values()].reduce((sum, r) => sum + (r === run ? 0 : r.results.bytes), 0);
      run.results.append(value, Math.max(0, TASK_LIMITS.totalResultBytes - others));
    };
    try {
      checkpoint(); run.state = 'running'; this.#emit(true);
      const runtime = await openTaskRuntime(run.validated.source, run.abort.signal, this.#options); run.runtime = runtime; checkpoint();
      if (JSON.stringify(runtime.manifest) !== JSON.stringify(run.validated.manifest)) throw new TaskError('task_definition_changed');
      append(await runtime.start(run.options.parameters!));
      const seen = new Set<string>();
      const process = async (raw: TaskSymbol) => {
        checkpoint(); const symbol = taskSymbol(raw); if (symbol.providerId !== run.lease.providerId) throw new TaskError('task_invalid_symbol');
        const identity = `${symbol.providerId}|${symbol.symbol}|${symbol.kind}`;
        if (seen.has(identity)) throw new TaskError('task_duplicate_symbol'); if (seen.size >= TASK_LIMITS.universe) throw new TaskError('task_universe_limit'); seen.add(identity);
        run.currentSymbol = symbol.symbol; const history: Record<string, JsonValue> = Object.create(null);
        for (const need of run.validated.manifest.history) { history[need.id] = await read(() => run.lease.history(symbol, need, run.abort.signal)); }
        append(await runtime.process(taskJson({ symbol, history }, TASK_LIMITS.inputBytes))); checkpoint();
        if (Object.values(history).some(h => object(h) && h.shortfall === true)) run.shortfallSymbols++;
        if (Object.values(history).some(h => object(h) && Array.isArray(h.rows) && h.rows.length === 0)) run.emptySymbols++;
        run.processed++; this.#emit();
      };
      const universe = run.options.universe;
      if (universe.type === 'symbols') {
        run.discovered = universe.symbols.length; run.universeComplete = true;
        for (const symbol of universe.symbols) await process(symbol);
      } else {
        let cursor: string | undefined; const cursors = new Set<string>(); let pages = 0;
        do {
          checkpoint(); if (++pages > TASK_LIMITS.catalogPages) throw new TaskError('task_catalog_limit');
          const page = await read(() => run.lease.catalog(cursor, TASK_LIMITS.catalogPage, run.abort.signal));
          if (!Array.isArray(page.symbols) || page.symbols.length > TASK_LIMITS.catalogPage) throw new TaskError('task_invalid_output');
          run.discovered += page.symbols.length; if (run.discovered > TASK_LIMITS.universe) throw new TaskError('task_universe_limit');
          for (const symbol of page.symbols) await process(symbol);
          cursor = page.nextCursor;
          if (cursor !== undefined) { if (!text(cursor, 4096) || cursors.has(cursor)) throw new TaskError('task_cursor_stalled'); cursors.add(cursor); }
        } while (cursor !== undefined);
        run.universeComplete = true;
      }
      append(await runtime.finish()); checkpoint(); this.#finish(run);
    } catch (error) { this.#finish(run, error); }
    finally { clearTimeout(timer); }
  }
  async close(): Promise<void> {
    if (this.#closed) return; this.#closed = true; this.#lifetime.abort();
    const runs = [...this.#runs.values()];
    for (const run of runs) { run.removeAfter = true; this.#cancel(run, new TaskError('task_cancelled')); }
    await Promise.all([...this.#acquiring, ...runs.map(r => r.done)]); for (const run of runs) this.#drop(run); this.#listeners.clear();
  }
}
