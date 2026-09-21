import { attachConnectorWorker, type ConnectorWorkerPort } from './runtime-worker.ts';
attachConnectorWorker(globalThis as unknown as ConnectorWorkerPort);
