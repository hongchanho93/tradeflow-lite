export function createUserIndicatorValidatorWorker(): Worker {
  return new Worker(new URL('./validator.worker.ts', import.meta.url), {
    type: 'module',
    name: 'tradeflow-user-indicator-validator',
  });
}
