import type { UserIndicatorWorkerLike } from './supervisor.ts';

export function createUserIndicatorExecutionWorker(): UserIndicatorWorkerLike {
  return new Worker(new URL('./execution.worker.ts', import.meta.url), {
    type: 'module',
    name: 'tradeflow-user-indicator-execution',
  }) as unknown as UserIndicatorWorkerLike;
}
