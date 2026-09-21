import type { UserIndicatorValidationResult } from './validator-engine.ts';
import { USER_INDICATOR_PROTOCOL_VERSION } from './protocol.ts';

export interface UserIndicatorValidateSourceRequest {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'validate-source';
  readonly requestId: string;
  readonly source: string;
}

export interface UserIndicatorValidateSourceResponse {
  readonly protocolVersion: typeof USER_INDICATOR_PROTOCOL_VERSION;
  readonly type: 'validate-source-result';
  readonly requestId: string;
  readonly result: UserIndicatorValidationResult;
}
