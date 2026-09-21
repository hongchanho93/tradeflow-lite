import { USER_INDICATOR_PROTOCOL_VERSION } from './protocol.ts';
import type {
  UserIndicatorValidateSourceRequest,
  UserIndicatorValidateSourceResponse,
} from './validator-protocol.ts';
import { validateUserIndicatorSource } from './validator-engine.ts';

type ValidatorWorkerPort = {
  postMessage(message: UserIndicatorValidateSourceResponse): void;
  onmessage: ((event: MessageEvent<UserIndicatorValidateSourceRequest>) => void) | null;
  close(): void;
};

const port = globalThis as unknown as ValidatorWorkerPort;

port.onmessage = (event) => {
  const request = event.data;
  if (
    request.protocolVersion !== USER_INDICATOR_PROTOCOL_VERSION
    || request.type !== 'validate-source'
    || typeof request.requestId !== 'string'
    || typeof request.source !== 'string'
  ) {
    return;
  }

  void validateUserIndicatorSource(request.source).catch((error: unknown) => ({
    ok: false as const,
    error: {
      code: 'runtime_exception' as const,
      message: error instanceof Error ? error.message : String(error),
    },
  })).then((result) => {
    port.postMessage({
      protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
      type: 'validate-source-result',
      requestId: request.requestId,
      result,
    });
    port.close();
  });
};
