import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten-core';
import { USER_INDICATOR_RUNTIME_LIMITS } from './limits';
import {
  USER_INDICATOR_PROTOCOL_VERSION,
  type UserIndicatorSandboxRequest,
  type UserIndicatorSandboxResponse,
} from './protocol';

type WorkerPort = {
  postMessage(message: UserIndicatorSandboxResponse): void;
  onmessage: ((event: MessageEvent<UserIndicatorSandboxRequest>) => void) | null;
};

const port = globalThis as unknown as WorkerPort;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Vite's default worker output is IIFE. Keep initialization inside an async IIFE
// instead of top-level await so the worker remains compatible with that output.
void (async () => {
  const quickJs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes);
  runtime.setMaxStackSize(USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes);
  const context = runtime.newContext();

  port.onmessage = (event) => {
    try {
      const request = event.data;
      if (
        request.protocolVersion !== USER_INDICATOR_PROTOCOL_VERSION
        || request.type !== 'sandbox-self-test'
      ) {
        return;
      }

      runtime.setInterruptHandler(
        shouldInterruptAfterDeadline(Date.now() + USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs),
      );
      const result = context.evalCode(`({
        window: typeof window,
        document: typeof document,
        fetch: typeof fetch,
        WebSocket: typeof WebSocket,
        XMLHttpRequest: typeof XMLHttpRequest,
        indexedDB: typeof indexedDB,
        Worker: typeof Worker,
        SharedWorker: typeof SharedWorker,
        BroadcastChannel: typeof BroadcastChannel,
        localStorage: typeof localStorage,
        sessionStorage: typeof sessionStorage,
        __TAURI__: typeof __TAURI__
      })`);
      runtime.removeInterruptHandler();

      if (result.error) {
        const dumped = context.dump(result.error);
        result.error.dispose();
        throw new Error(errorMessage(dumped));
      }

      if (!result.value) throw new Error('QuickJS self-test returned no value');
      const globals = context.dump(result.value) as Record<string, string>;
      result.value.dispose();
      port.postMessage({
        protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
        type: 'sandbox-self-test-result',
        requestId: request.requestId,
        globals,
      });
    } catch (error: unknown) {
      runtime.removeInterruptHandler();
      port.postMessage({
        protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
        type: 'sandbox-fatal',
        message: errorMessage(error),
      });
    }
  };

  port.postMessage({
    protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
    type: 'sandbox-ready',
  });
})().catch((error: unknown) => {
  port.postMessage({
    protocolVersion: USER_INDICATOR_PROTOCOL_VERSION,
    type: 'sandbox-fatal',
    message: errorMessage(error),
  });
});
