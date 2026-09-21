import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';
import { USER_INDICATOR_PROTOCOL_VERSION } from './protocol.ts';
import type { UserIndicatorValidationResult } from './validator-engine.ts';
import type {
  UserIndicatorValidateSourceRequest,
  UserIndicatorValidateSourceResponse,
} from './validator-protocol.ts';
import { createUserIndicatorValidatorWorker } from './validator-worker-factory.ts';

export interface UserIndicatorValidatorWorkerLike {
  onmessage: ((event: MessageEvent<UserIndicatorValidateSourceResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: UserIndicatorValidateSourceRequest): void;
  terminate(): void;
}

export interface UserIndicatorValidatorClientOptions {
  readonly hardTimeoutMs?: number;
  readonly workerFactory?: () => UserIndicatorValidatorWorkerLike;
}

let requestSequence = 0;

function runtimeFailure(message: string): UserIndicatorValidationResult {
  return { ok: false, error: { code: 'runtime_exception', message } };
}

function timeoutFailure(timeoutMs: number): UserIndicatorValidationResult {
  return {
    ok: false,
    error: {
      code: 'execution_timeout',
      message: `indicator validation exceeded hard timeout ${timeoutMs}ms`,
    },
  };
}

export function validateUserIndicatorSourceIsolated(
  source: string,
  options: UserIndicatorValidatorClientOptions = {},
): Promise<UserIndicatorValidationResult> {
  if (new TextEncoder().encode(source).byteLength > USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'source_too_large',
        message: `indicator source exceeds ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
      },
    });
  }

  const hardTimeoutMs = options.hardTimeoutMs ?? USER_INDICATOR_RUNTIME_LIMITS.definitionHardMs;
  const workerFactory = options.workerFactory ?? createUserIndicatorValidatorWorker;
  const worker = workerFactory();
  const requestId = `validate-${Date.now()}-${requestSequence += 1}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: UserIndicatorValidationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(timeoutFailure(hardTimeoutMs));
    }, hardTimeoutMs);

    worker.onmessage = (event: MessageEvent<UserIndicatorValidateSourceResponse>) => {
      const response = event.data;
      if (
        response.protocolVersion !== USER_INDICATOR_PROTOCOL_VERSION
        || response.type !== 'validate-source-result'
        || response.requestId !== requestId
      ) {
        return;
      }
      finish(response.result);
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.();
      finish(runtimeFailure(event.message || 'validator Worker failed'));
    };
    worker.onmessageerror = () => {
      finish(runtimeFailure('validator Worker returned an unreadable message'));
    };
    worker.postMessage({
      protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
      type: 'validate-source',
      requestId,
      source,
    });
  });
}
