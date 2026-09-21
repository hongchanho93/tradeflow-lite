import type { IndicatorBar } from '../indicator-sdk/contracts.ts';
import {
  coalesceUserIndicatorDataEvent,
  toUserIndicatorRuntimeDataEvent,
  type CoalescedIndicatorDataEvent,
  type UserIndicatorDataEvent,
} from './data-protocol.ts';
import { USER_INDICATOR_RUNTIME_LIMITS, userIndicatorUpdateHardMs } from './limits.ts';
import {
  UserIndicatorOutputError,
  createUserIndicatorOutputValidationState,
  validateUserIndicatorOutputEnvelope,
  type UserIndicatorOutputExpectation,
  type UserIndicatorOutputValidationState,
} from './output-protocol.ts';
import {
  USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
  type UserIndicatorExecutionLog,
  type UserIndicatorExecutionPhase,
  type UserIndicatorPointerEvent,
  type UserIndicatorExecutionRequest,
  type UserIndicatorExecutionResponse,
  type UserIndicatorExecutionSuccess,
} from './supervisor-protocol.ts';

export interface UserIndicatorWorkerLike {
  postMessage(message: UserIndicatorExecutionRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<UserIndicatorExecutionResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export type UserIndicatorWorkerFactory = () => UserIndicatorWorkerLike;

export type UserIndicatorSupervisorFailure = Readonly<{
  instanceId: string;
  generation: number;
  phase: UserIndicatorExecutionPhase | 'worker';
  code: string;
  message: string;
  logs?: readonly UserIndicatorExecutionLog[];
}>;

export type UserIndicatorSupervisorOptions = Readonly<{
  workerFactory: UserIndicatorWorkerFactory;
  onOutput?: (
    response: Readonly<UserIndicatorExecutionSuccess>,
    event: Readonly<UserIndicatorDataEvent>,
  ) => void;
  onFailure?: (failure: UserIndicatorSupervisorFailure) => void;
}>;

type InFlightRequest = {
  readonly requestId: number;
  readonly phase: UserIndicatorExecutionPhase;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly eventAfterAck: Readonly<UserIndicatorDataEvent>;
  readonly outputExpectation: UserIndicatorOutputExpectation;
};

type RuntimeRecord = {
  readonly instanceId: string;
  generation: number;
  requestSequence: number;
  worker: UserIndicatorWorkerLike | null;
  source: string;
  inputs: Readonly<Record<string, unknown>>;
  context: Readonly<Record<string, unknown>>;
  acknowledgedBars: readonly IndicatorBar[] | null;
  outputState: UserIndicatorOutputValidationState;
  inFlight: InFlightRequest | null;
  pending: CoalescedIndicatorDataEvent | null;
  pendingPointer: UserIndicatorPointerEvent | null;
  failed: boolean;
};

function snapshotOutputEvent(pending: CoalescedIndicatorDataEvent): Readonly<UserIndicatorDataEvent> {
  return Object.freeze({
    reason: pending.event.reason,
    bars: Object.freeze(pending.event.bars.map((bar) => Object.freeze({ ...bar }))),
    changedFrom: pending.changedFrom,
    ...(pending.realtimeUpdates === undefined
      ? {}
      : { realtimeUpdates: Object.freeze(pending.realtimeUpdates.map((update) => Object.freeze({ ...update }))) }),
    ...(pending.depth === undefined ? {} : { depth: pending.depth }),
    ...(pending.trades === undefined ? {} : { trades: pending.trades }),
    ...(pending.marketStatus === undefined ? {} : { marketStatus: pending.marketStatus }),
  });
}

function hardDeadlineMs(phase: UserIndicatorExecutionPhase, event?: UserIndicatorDataEvent): number {
  if (phase === 'create') {
    return USER_INDICATOR_RUNTIME_LIMITS.createHardMs
      + userIndicatorUpdateHardMs(event?.reason ?? 'initial');
  }
  if (phase === 'pointer') return USER_INDICATOR_RUNTIME_LIMITS.pointerHardMs;
  if (phase === 'destroy') return USER_INDICATOR_RUNTIME_LIMITS.destroyHardMs;
  return userIndicatorUpdateHardMs(event?.reason ?? 'reconciliation');
}

function responseMatches(
  record: RuntimeRecord,
  response: UserIndicatorExecutionResponse,
): boolean {
  const inFlight = record.inFlight;
  if (!inFlight) return false;
  const phaseMatches = inFlight.phase === response.phase
    || (inFlight.phase === 'create' && response.type === 'failure' && response.phase === 'update');
  return response.protocolVersion === USER_INDICATOR_EXECUTION_PROTOCOL_VERSION
    && response.instanceId === record.instanceId
    && response.generation === record.generation
    && inFlight.requestId === response.requestId
    && phaseMatches;
}

export class UserIndicatorSupervisor {
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly options: UserIndicatorSupervisorOptions;

  constructor(options: UserIndicatorSupervisorOptions) {
    this.options = options;
  }

  create(
    instanceId: string,
    source: string,
    inputs: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
    initialEvent: UserIndicatorDataEvent,
  ): void {
    if (!instanceId.trim()) throw new Error('user indicator instanceId must be non-empty');
    if (this.records.has(instanceId)) throw new Error(`user indicator instance ${instanceId} already exists`);
    if (this.records.size >= USER_INDICATOR_RUNTIME_LIMITS.activeInstances) {
      throw new Error(`user indicator active instance limit ${USER_INDICATOR_RUNTIME_LIMITS.activeInstances} reached`);
    }
    const record: RuntimeRecord = {
      instanceId,
      generation: 0,
      requestSequence: 0,
      worker: null,
      source,
      inputs,
      context,
      acknowledgedBars: null,
      outputState: createUserIndicatorOutputValidationState(),
      inFlight: null,
      pending: null,
      pendingPointer: null,
      failed: false,
    };
    this.records.set(instanceId, record);
    this.restart(record, initialEvent);
  }

  rebuild(
    instanceId: string,
    source: string,
    inputs: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
    initialEvent: UserIndicatorDataEvent,
  ): void {
    const record = this.require(instanceId);
    record.source = source;
    record.inputs = inputs;
    record.context = context;
    this.restart(record, initialEvent);
  }

  update(instanceId: string, event: UserIndicatorDataEvent): void {
    const record = this.require(instanceId);
    if (record.failed || !record.worker) return;
    if (record.inFlight) {
      record.pending = coalesceUserIndicatorDataEvent(record.pending, event);
      return;
    }
    this.dispatchUpdate(record, coalesceUserIndicatorDataEvent(null, event));
  }

  pointer(instanceId: string, event: UserIndicatorPointerEvent): void {
    const record = this.require(instanceId);
    if (record.failed || !record.worker || record.acknowledgedBars === null) return;
    if (record.inFlight) {
      record.pendingPointer = event;
      return;
    }
    this.dispatchPointer(record, event);
  }

  retry(instanceId: string, event: UserIndicatorDataEvent): void {
    const record = this.require(instanceId);
    if (!record.failed) return;
    this.restart(record, event);
  }

  remove(instanceId: string): void {
    const record = this.records.get(instanceId);
    if (!record) return;
    this.stopWorker(record);
    this.records.delete(instanceId);
  }

  destroy(): void {
    for (const instanceId of [...this.records.keys()]) this.remove(instanceId);
  }

  list(): readonly Readonly<{
    instanceId: string;
    generation: number;
    running: boolean;
    ready: boolean;
    failed: boolean;
    inFlight: boolean;
    pending: boolean;
  }>[] {
    return [...this.records.values()].map((record) => Object.freeze({
      instanceId: record.instanceId,
      generation: record.generation,
      running: record.worker !== null,
      ready: !record.failed && record.acknowledgedBars !== null,
      failed: record.failed,
      inFlight: record.inFlight !== null,
      pending: record.pending !== null || record.pendingPointer !== null,
    }));
  }

  private require(instanceId: string): RuntimeRecord {
    const record = this.records.get(instanceId);
    if (!record) throw new Error(`user indicator instance ${instanceId} does not exist`);
    return record;
  }

  private restart(record: RuntimeRecord, initialEvent: UserIndicatorDataEvent): void {
    this.stopWorker(record);
    record.generation += 1;
    record.requestSequence = 0;
    record.acknowledgedBars = null;
    record.outputState = createUserIndicatorOutputValidationState();
    record.pending = null;
    record.pendingPointer = null;
    record.failed = false;

    let worker: UserIndicatorWorkerLike;
    try { worker = this.options.workerFactory(); }
    catch {
      this.fail(record, 'worker', 'worker_failed', 'user indicator worker could not be started');
      return;
    }
    record.worker = worker;
    const generation = record.generation;
    const current = () => this.records.get(record.instanceId) === record && record.worker === worker && record.generation === generation;
    worker.onmessage = (event) => { if (current()) this.handleResponse(record, event.data); };
    worker.onerror = () => { if (current()) this.fail(record, 'worker', 'worker_failed', 'user indicator worker failed'); };
    worker.onmessageerror = () => { if (current()) this.fail(record, 'worker', 'worker_failed', 'user indicator worker message could not be decoded'); };

    const pending = coalesceUserIndicatorDataEvent(null, initialEvent);
    const runtimeEvent = toUserIndicatorRuntimeDataEvent(null, pending);
    const requestId = ++record.requestSequence;
    const request: UserIndicatorExecutionRequest = {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'create',
      instanceId: record.instanceId,
      generation: record.generation,
      requestId,
      source: record.source,
      inputs: record.inputs,
      context: record.context,
      initialEvent: runtimeEvent,
    };
    const timer = setTimeout(
      () => this.hardTimeout(record, generation, requestId, 'create'),
      hardDeadlineMs('create', initialEvent),
    );
    const eventAfterAck = snapshotOutputEvent(pending);
    record.inFlight = {
      requestId,
      phase: 'create',
      timer,
      eventAfterAck,
      outputExpectation: Object.freeze({
        type: 'create',
        reason: runtimeEvent.reason,
        changedFrom: runtimeEvent.changedFrom,
        barsLength: eventAfterAck.bars.length,
      }),
    };
    this.postMessage(record, worker, request);
  }

  private dispatchUpdate(record: RuntimeRecord, pending: CoalescedIndicatorDataEvent): void {
    const worker = record.worker;
    if (!worker || record.failed) return;
    const runtimeEvent = toUserIndicatorRuntimeDataEvent(record.acknowledgedBars, pending);
    const generation = record.generation;
    const requestId = ++record.requestSequence;
    const request: UserIndicatorExecutionRequest = {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'update',
      instanceId: record.instanceId,
      generation: record.generation,
      requestId,
      event: runtimeEvent,
    };
    const timer = setTimeout(
      () => this.hardTimeout(record, generation, requestId, 'update'),
      hardDeadlineMs('update', pending.event),
    );
    const eventAfterAck = snapshotOutputEvent(pending);
    record.inFlight = {
      requestId,
      phase: 'update',
      timer,
      eventAfterAck,
      outputExpectation: Object.freeze({
        type: 'update',
        reason: runtimeEvent.reason,
        changedFrom: runtimeEvent.changedFrom,
        barsLength: eventAfterAck.bars.length,
      }),
    };
    this.postMessage(record, worker, request);
  }

  private dispatchPointer(record: RuntimeRecord, event: UserIndicatorPointerEvent): void {
    const worker = record.worker;
    const bars = record.acknowledgedBars;
    if (!worker || record.failed || bars === null) return;
    const generation = record.generation;
    const requestId = ++record.requestSequence;
    const request: UserIndicatorExecutionRequest = {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'pointer',
      instanceId: record.instanceId,
      generation,
      requestId,
      event,
    };
    const timer = setTimeout(
      () => this.hardTimeout(record, generation, requestId, 'pointer'),
      USER_INDICATOR_RUNTIME_LIMITS.pointerHardMs,
    );
    const eventAfterAck: Readonly<UserIndicatorDataEvent> = Object.freeze({
      reason: 'realtime',
      bars,
      changedFrom: bars.length,
    });
    record.inFlight = {
      requestId,
      phase: 'pointer',
      timer,
      eventAfterAck,
      outputExpectation: Object.freeze({
        type: 'pointer',
        pointerType: event.type,
        id: event.id,
        time: event.time,
        price: event.price,
        pane: event.pane,
        barsLength: bars.length,
      }),
    };
    this.postMessage(record, worker, request);
  }

  private postMessage(record: RuntimeRecord, worker: UserIndicatorWorkerLike, request: UserIndicatorExecutionRequest): void {
    try { worker.postMessage(request); }
    catch { this.fail(record, 'worker', 'worker_failed', 'user indicator worker message could not be sent'); }
  }

  private handleResponse(record: RuntimeRecord, response: UserIndicatorExecutionResponse): void {
    if (!responseMatches(record, response)) return;
    const inFlight = record.inFlight;
    if (!inFlight) return;
    clearTimeout(inFlight.timer);
    record.inFlight = null;

    if (response.type === 'failure') {
      this.fail(record, response.phase, response.code, response.message, response.logs);
      return;
    }

    let validatedOutput;
    try {
      const validated = validateUserIndicatorOutputEnvelope(
        response.output,
        record.outputState,
        inFlight.outputExpectation,
      );
      record.outputState = validated.state;
      validatedOutput = validated.output;
    } catch (error) {
      const code = error instanceof UserIndicatorOutputError ? error.code : 'invalid_output';
      const message = error instanceof Error ? error.message : String(error);
      this.fail(record, response.phase, code, message);
      return;
    }

    const validatedResponse = Object.freeze({ ...response, output: validatedOutput });
    const worker = record.worker;
    try {
      this.options.onOutput?.(validatedResponse, inFlight.eventAfterAck);
    } catch (error) {
      this.fail(
        record,
        response.phase,
        'output_apply_failed',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (this.records.get(record.instanceId) !== record || record.worker !== worker || record.generation !== response.generation) return;
    if (inFlight.phase !== 'pointer') record.acknowledgedBars = inFlight.eventAfterAck.bars;
    const pending = record.pending;
    record.pending = null;
    if (pending) {
      this.dispatchUpdate(record, pending);
      return;
    }
    const pendingPointer = record.pendingPointer;
    record.pendingPointer = null;
    if (pendingPointer) this.dispatchPointer(record, pendingPointer);
  }

  private hardTimeout(record: RuntimeRecord, generation: number, requestId: number, phase: UserIndicatorExecutionPhase): void {
    if (record.generation !== generation || record.inFlight?.requestId !== requestId) return;
    this.fail(record, phase, 'execution_timeout', `user indicator ${phase} exceeded hard wall timeout`);
  }

  private fail(
    record: RuntimeRecord,
    phase: UserIndicatorSupervisorFailure['phase'],
    code: string,
    message: string,
    logs?: readonly UserIndicatorExecutionLog[],
  ): void {
    if (record.failed || this.records.get(record.instanceId) !== record) return;
    record.failed = true;
    this.stopWorker(record);
    try {
      this.options.onFailure?.(Object.freeze({
        instanceId: record.instanceId,
        generation: record.generation,
        phase,
        code,
        message,
        ...(logs?.length ? { logs } : {}),
      }));
    } catch {
      console.error('user_indicator.failure_handler_failed', { instanceId: record.instanceId, code });
    }
  }

  private stopWorker(record: RuntimeRecord): void {
    if (record.inFlight) clearTimeout(record.inFlight.timer);
    record.inFlight = null;
    record.pending = null;
    record.pendingPointer = null;
    const worker = record.worker;
    record.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}
