import type { UserIndicatorRuntimeDataEvent } from './data-protocol.ts';
import type { UserIndicatorOutputEnvelope } from './output-protocol.ts';
import type { UserIndicatorUpdateReason } from './limits.ts';

export const USER_INDICATOR_EXECUTION_PROTOCOL_VERSION = 1 as const;

export type UserIndicatorPointerType = 'click' | 'hover' | 'leave';
export type UserIndicatorPointerEvent = Readonly<{
  type: UserIndicatorPointerType;
  id: string;
  time: number | null;
  price: number | null;
  pane: string;
}>;

export type UserIndicatorExecutionPhase = 'create' | 'update' | 'pointer' | 'destroy';

export type UserIndicatorExecutionLog = Readonly<{
  phase: 'create' | 'update' | 'pointer';
  message: string;
}>;

type UserIndicatorExecutionRequestBase = {
  readonly protocolVersion: typeof USER_INDICATOR_EXECUTION_PROTOCOL_VERSION;
  readonly instanceId: string;
  readonly generation: number;
  readonly requestId: number;
};

export type UserIndicatorExecutionCreateRequest = UserIndicatorExecutionRequestBase & {
  readonly type: 'create';
  readonly source: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly initialEvent: UserIndicatorRuntimeDataEvent;
};

export type UserIndicatorExecutionUpdateRequest = UserIndicatorExecutionRequestBase & {
  readonly type: 'update';
  readonly event: UserIndicatorRuntimeDataEvent;
};

export type UserIndicatorExecutionPointerRequest = UserIndicatorExecutionRequestBase & {
  readonly type: 'pointer';
  readonly event: UserIndicatorPointerEvent;
};

export type UserIndicatorExecutionDestroyRequest = UserIndicatorExecutionRequestBase & {
  readonly type: 'destroy';
};

export type UserIndicatorExecutionRequest =
  | UserIndicatorExecutionCreateRequest
  | UserIndicatorExecutionUpdateRequest
  | UserIndicatorExecutionPointerRequest
  | UserIndicatorExecutionDestroyRequest;

type UserIndicatorExecutionResponseBase = {
  readonly protocolVersion: typeof USER_INDICATOR_EXECUTION_PROTOCOL_VERSION;
  readonly instanceId: string;
  readonly generation: number;
  readonly requestId: number;
};

export type UserIndicatorExecutionSuccess = UserIndicatorExecutionResponseBase & {
  readonly type: 'success';
  readonly phase: UserIndicatorExecutionPhase;
  readonly output: UserIndicatorOutputEnvelope;
  readonly pointerEnabled?: boolean;
  readonly timing?: Readonly<{
    readonly reason: UserIndicatorUpdateReason | 'pointer';
    readonly durationMs: number;
    readonly budgetMs: number;
  }>;
};

export type UserIndicatorExecutionFailure = UserIndicatorExecutionResponseBase & {
  readonly type: 'failure';
  readonly phase: UserIndicatorExecutionPhase;
  readonly code: string;
  readonly message: string;
  readonly logs?: readonly UserIndicatorExecutionLog[];
};

export type UserIndicatorExecutionResponse =
  | UserIndicatorExecutionSuccess
  | UserIndicatorExecutionFailure;
