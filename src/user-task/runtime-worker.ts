import { createTaskEngine } from './runtime-engine.ts';
import { exact, TaskError, taskError, taskJson, taskParameters, TASK_LIMITS } from './contracts.ts';
export interface TaskWorkerPort { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(message: unknown): void; close(): void }
export function attachTaskWorker(port: TaskWorkerPort): void {
  let id: string | undefined, sequence = 0, phase: 'idle' | 'loading' | 'ready' | 'running' | 'done' = 'idle';
  let engine: Awaited<ReturnType<typeof createTaskEngine>> | undefined;
  port.onmessage = event => { void (async () => {
    const m = event.data;
    if (phase === 'idle') {
      exact(m, ['id','sequence','type','source']);
      if (typeof m.id !== 'string' || m.sequence !== 0 || m.type !== 'load' || typeof m.source !== 'string') throw new TaskError('task_invalid_protocol');
      id = m.id; phase = 'loading'; engine = await createTaskEngine(m.source); phase = 'ready';
      port.postMessage({ id, sequence, type: 'manifest', value: engine.manifest }); return;
    }
    exact(m, ['id','sequence','type','input']);
    if (!engine || m.id !== id || m.sequence !== sequence + 1 || !['start','process','finish'].includes(m.type as string)
      || (m.type === 'start' ? phase !== 'ready' : phase !== 'running')) throw new TaskError('task_invalid_protocol');
    sequence++; const operation = m.type as 'start' | 'process' | 'finish';
    const input = operation === 'start' ? taskParameters(m.input, engine.manifest) : taskJson(m.input, TASK_LIMITS.inputBytes);
    const value = engine.call(operation, input); phase = operation === 'finish' ? 'done' : 'running';
    port.postMessage({ id, sequence, type: 'result', value });
    if (phase === 'done') port.close();
  })().catch(error => {
    if (phase === 'done') return;
    phase = 'done';
    const failure = taskError(error);
    port.postMessage({ id, sequence, type: 'error', code: failure.code,
      ...(failure.path ? { path: failure.path } : {}),
      ...(failure.reason ? { reason: failure.reason } : {}),
      ...(failure.expected ? { expected: failure.expected } : {}) });
    port.close();
  }); };
}
