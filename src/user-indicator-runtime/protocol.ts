export const USER_INDICATOR_PROTOCOL_VERSION = 1 as const;

export interface UserIndicatorSandboxSelfTestRequest {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'sandbox-self-test';
  readonly requestId: string;
}

export type UserIndicatorSandboxRequest = UserIndicatorSandboxSelfTestRequest;

export interface UserIndicatorSandboxReady {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'sandbox-ready';
}

export interface UserIndicatorSandboxSelfTestResult {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'sandbox-self-test-result';
  readonly requestId: string;
  readonly globals: Readonly<Record<string, 'undefined' | string>>;
}

export interface UserIndicatorSandboxFatal {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'sandbox-fatal';
  readonly message: string;
}

export type UserIndicatorSandboxResponse =
  | UserIndicatorSandboxReady
  | UserIndicatorSandboxSelfTestResult
  | UserIndicatorSandboxFatal;
