import {
  USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
  type UserIndicatorExecutionRequest,
  type UserIndicatorExecutionResponse,
} from './supervisor-protocol.ts';
import { UserIndicatorExecutionEngine } from './execution-engine.ts';

type WorkerPort = {
  postMessage(message: UserIndicatorExecutionResponse): void;
  onmessage: ((event: MessageEvent<UserIndicatorExecutionRequest>) => void) | null;
};

const port = globalThis as unknown as WorkerPort;
let engine: UserIndicatorExecutionEngine | null = null;
let queue = Promise.resolve();

function workerFailure(request: UserIndicatorExecutionRequest, message: string): UserIndicatorExecutionResponse {
  return {
    protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
    type: 'failure',
    phase: request.type === 'destroy' ? 'destroy' : request.type,
    instanceId: request.instanceId,
    generation: request.generation,
    requestId: request.requestId,
    code: 'worker_failed',
    message,
  };
}

async function handleRequest(request: UserIndicatorExecutionRequest): Promise<void> {
  if (request.protocolVersion !== USER_INDICATOR_EXECUTION_PROTOCOL_VERSION) return;
  try {
    if (request.type === 'create') {
      if (engine !== null) {
        port.postMessage(workerFailure(request, 'user indicator execution Worker already owns an instance'));
        return;
      }
      engine = await UserIndicatorExecutionEngine.create();
      port.postMessage(engine.createInstance(request));
      return;
    }
    if (request.type === 'update') {
      if (engine === null) {
        port.postMessage(workerFailure(request, 'user indicator execution Worker has no active instance'));
        return;
      }
      port.postMessage(engine.updateInstance(request));
      return;
    }
    if (request.type === 'pointer') {
      if (engine === null) {
        port.postMessage(workerFailure(request, 'user indicator execution Worker has no active instance'));
        return;
      }
      port.postMessage(engine.pointerInstance(request));
      return;
    }
    port.postMessage(workerFailure(request, 'graceful destroy is not implemented in P3-1C2'));
  } catch (error) {
    port.postMessage(workerFailure(request, error instanceof Error ? error.message : String(error)));
  }
}

port.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(() => handleRequest(request));
};
