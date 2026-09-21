import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSRuntime,
} from 'quickjs-emscripten-core';
import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';
import {
  UserIndicatorValidationError,
  type UserIndicatorManifest,
  type UserIndicatorValidationErrorCode,
  validateCapturedUserIndicatorDefinition,
} from './user-definition.ts';

export interface UserIndicatorValidationDiagnostic {
  readonly code: UserIndicatorValidationErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly reason?: string;
  readonly expected?: string;
  readonly failureDetail?: string;
  readonly line?: number;
  readonly column?: number;
}

export type UserIndicatorValidationResult =
  | { readonly ok: true; readonly manifest: UserIndicatorManifest }
  | { readonly ok: false; readonly error: UserIndicatorValidationDiagnostic };

const CAPTURE_BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const safeDefineProperty = Object.defineProperty;
  const safeKeys = Object.keys;
  const safeStringify = JSON.stringify;
  let count = 0;
  let snapshot = null;

  const defineIndicator = (definition) => {
    count += 1;
    if (count !== 1) return;
    snapshot = safeStringify({
      definitionKeys: safeKeys(definition),
      formatVersion: definition.formatVersion,
      apiVersion: definition.apiVersion,
      id: definition.id,
      indicatorVersion: definition.indicatorVersion,
      name: definition.name,
      description: definition.description,
      author: definition.author,
      inputs: definition.inputs,
      supports: definition.supports,
      data: definition.data,
      hasCreate: typeof definition.create === 'function',
    });
  };

  safeDefineProperty(globalThis, 'defineIndicator', {
    value: defineIndicator,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  safeDefineProperty(globalThis, '__tradeflowDefinitionCount', {
    value: () => count,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  safeDefineProperty(globalThis, '__tradeflowDefinitionSnapshot', {
    value: () => snapshot,
    enumerable: false,
    configurable: false,
    writable: false,
  });
})();
`;

let quickJsPromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;

function getQuickJs() {
  quickJsPromise ??= newQuickJSWASMModuleFromVariant(variant);
  return quickJsPromise;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message ?? value);
  }
  return String(value);
}

function sourceLocation(value: unknown): { line?: number; column?: number } {
  if (!value || typeof value !== 'object') return {};
  const stack = 'stack' in value ? String((value as { stack?: unknown }).stack ?? '') : '';
  const match = /user-indicator\.tfi:(\d+)(?::(\d+))?/.exec(stack);
  if (!match) return {};
  const line = Number.parseInt(match[1], 10);
  const column = match[2] ? Number.parseInt(match[2], 10) : undefined;
  return {
    ...(Number.isFinite(line) ? { line } : {}),
    ...(column !== undefined && Number.isFinite(column) ? { column } : {}),
  };
}

function classifyQuickJsError(value: unknown): UserIndicatorValidationDiagnostic {
  const message = errorMessage(value);
  const location = sourceLocation(value);
  let code: UserIndicatorValidationErrorCode = 'runtime_exception';
  if (/interrupted/i.test(message)) code = 'execution_timeout';
  else if (/out of memory/i.test(message)) code = 'memory_limit_exceeded';
  else if (/stack overflow|maximum call stack size exceeded/i.test(message)) code = 'stack_limit_exceeded';
  const diagnostic = code === 'execution_timeout'
    ? { reason: 'execution_timeout', expected: 'top-level evaluation within ' + USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs + 'ms' }
    : code === 'memory_limit_exceeded'
      ? { reason: 'memory_limit_exceeded', expected: 'memory use within ' + USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes + ' bytes' }
      : code === 'stack_limit_exceeded'
        ? { reason: 'stack_limit_exceeded', expected: 'stack use within ' + USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes + ' bytes' }
        : { reason: 'source_runtime_error', expected: 'valid synchronous JavaScript accepted by the .tfi validator' };
  return { code, message, ...diagnostic, failureDetail: message, ...location };
}

function validationFailure(error: unknown): UserIndicatorValidationResult {
  if (error instanceof UserIndicatorValidationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.field === undefined ? {} : { field: error.field }),
        reason: 'definition_contract_mismatch',
        expected: error.message,
        failureDetail: error.message,
      },
    };
  }
  return { ok: false, error: { code: 'runtime_exception', message: errorMessage(error) } };
}

/**
 * Internal VM validator. Production callers must execute this inside the
 * short-lived validator Worker and terminate that Worker after the result.
 * A runtime that has scheduled Promise jobs is intentionally abandoned rather
 * than disposed: QuickJS 0.32.0 can assert during JS_FreeRuntime for that case.
 */
export async function validateUserIndicatorSource(source: string): Promise<UserIndicatorValidationResult> {
  if (new TextEncoder().encode(source).byteLength > USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) {
    return {
      ok: false,
      error: {
        code: 'source_too_large',
        message: `indicator source exceeds ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
        reason: 'max_bytes_exceeded',
        expected: `source <= ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
        failureDetail: `indicator source exceeds ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
      },
    };
  }

  const quickJs = await getQuickJs();
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes);
  runtime.setMaxStackSize(USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes);
  const context = runtime.newContext();
  let safeToDispose = true;

  try {
    const bootstrap = context.evalCode(CAPTURE_BOOTSTRAP, 'tradeflow-user-indicator-bootstrap.js', {
      type: 'global',
      strict: true,
    });
    if (bootstrap.error) {
      const dumped = context.dump(bootstrap.error);
      bootstrap.error.dispose();
      throw new Error(`validator bootstrap failed: ${errorMessage(dumped)}`);
    }
    bootstrap.value?.dispose();

    runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs),
    );
    const evaluated = context.evalCode(source, 'user-indicator.tfi', {
      type: 'global',
      strict: true,
    });
    runtime.removeInterruptHandler();
    if (evaluated.error) {
      const dumped = context.dump(evaluated.error);
      evaluated.error.dispose();
      // QuickJS 0.32.0 can leave runtime-owned GC objects behind after several
      // guest failure modes (notably stack overflow). Treat every guest eval
      // failure as a poisoned VM and let the one-shot Worker reclaim it.
      safeToDispose = false;
      return { ok: false, error: classifyQuickJsError(dumped) };
    }
    evaluated.value?.dispose();

    if (runtime.hasPendingJob()) {
      // Do not execute guest Promise jobs just to clean up. Once async work has
      // been scheduled this VM is rejected and left for the outer Worker
      // terminate boundary to reclaim as a whole.
      safeToDispose = false;
      return {
        ok: false,
        error: {
          code: 'async_not_supported',
          message: 'user indicator top-level code must be synchronous; pending Promise/async jobs are not supported',
          reason: 'async_not_supported',
          expected: 'synchronous top-level code with no pending Promise/async jobs',
          failureDetail: 'user indicator top-level code must be synchronous; pending Promise/async jobs are not supported',
        },
      };
    }

    runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs),
    );
    const captured = context.evalCode(`({
      count: __tradeflowDefinitionCount(),
      snapshot: __tradeflowDefinitionSnapshot()
    })`, 'tradeflow-user-indicator-capture.js', {
      type: 'global',
      strict: true,
    });
    runtime.removeInterruptHandler();
    if (captured.error) {
      const dumped = context.dump(captured.error);
      captured.error.dispose();
      safeToDispose = false;
      return { ok: false, error: classifyQuickJsError(dumped) };
    }
    if (!captured.value) {
      return { ok: false, error: { code: 'runtime_exception', message: 'definition capture returned no value' } };
    }
    const capture = context.dump(captured.value) as { count?: unknown; snapshot?: unknown };
    captured.value.dispose();

    if (capture.count === 0) {
      return { ok: false, error: { code: 'definition_missing', message: 'indicator source must call defineIndicator() exactly once',
        reason: 'definition_missing', expected: 'exactly one defineIndicator(...) call', failureDetail: 'indicator source must call defineIndicator() exactly once' } };
    }
    if (capture.count !== 1) {
      return { ok: false, error: { code: 'definition_duplicate', message: 'indicator source must call defineIndicator() exactly once',
        reason: 'definition_duplicate', expected: 'exactly one defineIndicator(...) call', failureDetail: 'indicator source must call defineIndicator() exactly once' } };
    }
    if (typeof capture.snapshot !== 'string') {
      return { ok: false, error: { code: 'invalid_definition', message: 'defineIndicator() must receive a serializable definition object',
        reason: 'definition_contract_mismatch', expected: 'a JSON-serializable indicator definition object',
        failureDetail: 'defineIndicator() must receive a serializable definition object' } };
    }
    if (new TextEncoder().encode(capture.snapshot).byteLength > USER_INDICATOR_RUNTIME_LIMITS.definitionSnapshotBytes) {
      return {
        ok: false,
        error: {
          code: 'invalid_definition',
          message: `indicator definition snapshot exceeds ${USER_INDICATOR_RUNTIME_LIMITS.definitionSnapshotBytes} bytes`,
          field: 'definition',
          reason: 'max_bytes_exceeded',
          expected: `definition <= ${USER_INDICATOR_RUNTIME_LIMITS.definitionSnapshotBytes} bytes`,
          failureDetail: `indicator definition snapshot exceeds ${USER_INDICATOR_RUNTIME_LIMITS.definitionSnapshotBytes} bytes`,
        },
      };
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(capture.snapshot);
    } catch (error) {
      return validationFailure(error);
    }
    try {
      return { ok: true, manifest: validateCapturedUserIndicatorDefinition(candidate) };
    } catch (error) {
      return validationFailure(error);
    }
  } catch (error) {
    // Any host-side exception while interacting with guest VM state leaves the
    // runtime recovery status uncertain. Do not attempt JS_FreeRuntime here;
    // the one-shot validator Worker is the final reclamation boundary.
    safeToDispose = false;
    if (error instanceof UserIndicatorValidationError) return validationFailure(error);
    return { ok: false, error: classifyQuickJsError(error) };
  } finally {
    runtime.removeInterruptHandler();
    if (safeToDispose) {
      context.dispose();
      runtime.dispose();
    }
  }
}
