export function createUserIndicatorRuntimeWorker(): Worker {
  return new Worker(new URL('./runtime.worker.ts', import.meta.url), {
    type: 'module',
    name: 'tradeflow-user-indicator-runtime',
  });
}
