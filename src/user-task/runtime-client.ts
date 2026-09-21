import type { JsonValue } from '../ai-capabilities/contracts.ts';
import { TASK_LIMITS, TaskError, taskError, taskJson, exact, validateTaskManifest, taskParameters, type TaskManifest } from './contracts.ts';
export interface TaskWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void; terminate(): void;
}
export interface TaskRuntimeOptions { workerFactory?: () => TaskWorker; hardTimeoutMs?: number }
export interface TaskRuntime {
  readonly manifest: TaskManifest;
  start(parameters: JsonValue): Promise<JsonValue>;
  process(batch: JsonValue): Promise<JsonValue>;
  finish(): Promise<JsonValue>;
  close(): void;
}
/** The host sends one bounded message and awaits one acknowledgement. No queued batches. */
export async function openTaskRuntime(source: string, signal: AbortSignal, options: TaskRuntimeOptions = {}): Promise<TaskRuntime> {
  if (signal.aborted) throw new TaskError('task_cancelled');
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > TASK_LIMITS.sourceBytes) throw new TaskError('task_source_limit');
  const worker: TaskWorker = (options.workerFactory ?? (() => new Worker(new URL('./runtime.worker.ts', import.meta.url), { type: 'module', name: 'tradeflow-user-task' })))();
  const id = crypto.randomUUID(); let sequence = -1, closed: TaskError | undefined;
  let pending: { sequence: number; type: string; resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> } | undefined;
  const stop = (error = new TaskError('task_closed')) => {
    if (closed) return; closed = error; signal.removeEventListener('abort', abort);
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
  };
  const abort = () => stop(new TaskError('task_cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  worker.onerror = event => { event.preventDefault?.(); stop(new TaskError('task_worker_failed')); };
  worker.onmessageerror = () => stop(new TaskError('task_invalid_protocol'));
  worker.onmessage = event => {
    try {
      const m = event.data; exact(m, ['id','sequence','type','value','code','path','reason','expected'], ['id','sequence','type']);
      if (!pending || m.id !== id || m.sequence !== pending.sequence) throw new TaskError('task_invalid_protocol');
      if (m.type === 'error') {
        if (typeof m.code !== 'string'
          || (m.path !== undefined && typeof m.path !== 'string')
          || (m.reason !== undefined && typeof m.reason !== 'string')
          || (m.expected !== undefined && typeof m.expected !== 'string')) throw new TaskError('task_invalid_protocol');
        stop(new TaskError(m.code, { path: m.path as string | undefined, reason: m.reason as string | undefined, expected: m.expected as string | undefined }));
        return;
      }
      if (m.type !== pending.type || m.code !== undefined || m.value === undefined) throw new TaskError('task_invalid_protocol');
      const value = pending.type === 'manifest' ? validateTaskManifest(taskJson(m.value, TASK_LIMITS.manifestBytes)) : taskJson(m.value);
      const current = pending; pending = undefined; clearTimeout(current.timer); current.resolve(value);
    } catch (error) { stop(taskError(error)); }
  };
  const send = (type: string, input?: JsonValue): Promise<unknown> => {
    if (closed || signal.aborted) return Promise.reject(closed ?? new TaskError('task_cancelled'));
    if (pending) return Promise.reject(new TaskError('task_busy'));
    return new Promise((resolve, reject) => {
      pending = { sequence: ++sequence, type: type === 'load' ? 'manifest' : 'result', resolve, reject,
        timer: setTimeout(() => stop(new TaskError('task_execution_timeout')), options.hardTimeoutMs ?? TASK_LIMITS.hardStepMs) };
      try { worker.postMessage({ id, sequence, type, ...(type === 'load' ? { source } : { input: input ?? null }) }); }
      catch { stop(new TaskError('task_worker_failed')); }
    });
  };
  if (signal.aborted) abort();
  const manifest = await send('load') as TaskManifest;
  return { manifest,
    async start(parameters) { return await send('start', taskParameters(parameters, manifest)) as JsonValue; },
    async process(batch) { return await send('process', taskJson(batch, TASK_LIMITS.inputBytes)) as JsonValue; },
    async finish() { const value = await send('finish') as JsonValue; stop(); return value; },
    close: () => stop(),
  };
}
