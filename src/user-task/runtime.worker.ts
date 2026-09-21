import { attachTaskWorker, type TaskWorkerPort } from './runtime-worker.ts';
attachTaskWorker(globalThis as unknown as TaskWorkerPort);
