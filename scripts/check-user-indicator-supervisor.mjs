import assert from 'node:assert/strict';
import { UserIndicatorSupervisor } from '../src/user-indicator-runtime/supervisor.ts';
import './check-user-indicator-lifecycle.mjs';

function bar(time, close = time) {
  return Object.freeze({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 + time });
}

function event(reason, bars, changedFrom, realtimeUpdates) {
  return Object.freeze({ reason, bars: Object.freeze(bars), changedFrom, ...(realtimeUpdates ? { realtimeUpdates } : {}) });
}

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  messages = [];
  terminated = false;

  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(response) { this.onmessage?.({ data: response }); }
}

const workers = [];
const outputs = [];
const failures = [];
const supervisor = new UserIndicatorSupervisor({
  workerFactory: () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  },
  onOutput: (output) => outputs.push(output),
  onFailure: (failure) => failures.push(failure),
});

const barsA1 = [bar(1), bar(2), bar(3)];
supervisor.create('instance-1', 'source', Object.freeze({ period: 20 }), Object.freeze({ symbol: 'A' }), event('initial', barsA1, 0));
assert.equal(workers.length, 1);
const workerA1 = workers[0];
const createA1 = workerA1.messages[0];
assert.equal(createA1.type, 'create');
assert.equal(createA1.generation, 1);
assert.equal(createA1.initialEvent.barsPatch.mode, 'replace-all');

const barsA2 = [bar(1), bar(2), bar(3, 30)];
const barsA3 = [...barsA2, bar(4, 40)];
supervisor.update('instance-1', event('realtime', barsA2, 2, [{ barTime: 3, closed: true, closedBy: 'newer-bar' }]));
supervisor.update('instance-1', event('realtime', barsA3, 3, [{ barTime: 4, closed: false }]));
assert.equal(workerA1.messages.length, 1, 'updates must coalesce while create is in flight');
assert.equal(supervisor.list()[0].pending, true);

workerA1.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'instance-1',
  generation: 1,
  requestId: createA1.requestId,
  output: {
    callbacks: [
      { phase: 'create', commands: [] },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 3, commands: [] },
    ],
  },
});
assert.equal(workerA1.messages.length, 2);
const updateA1 = workerA1.messages[1];
assert.equal(updateA1.type, 'update');
assert.equal(updateA1.event.changedFrom, 2);
assert.equal(updateA1.event.barsPatch.mode, 'replace-from');
assert.equal(updateA1.event.barsPatch.from, 2);
assert.deepEqual(updateA1.event.realtimeUpdates, [
  { barTime: 3, closed: true, closedBy: 'newer-bar' },
  { barTime: 4, closed: false },
]);

supervisor.rebuild('instance-1', 'source', Object.freeze({ period: 30 }), Object.freeze({ symbol: 'B' }), event('initial', [bar(10)], 0));
assert.equal(workerA1.terminated, true, 'rebuild must hard terminate the previous generation');
assert.equal(workers.length, 2);
const workerB = workers[1];
const createB = workerB.messages[0];
assert.equal(createB.generation, 2);

workerB.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 2,
  requestId: createB.requestId,
  output: { callbacks: [] },
});
assert.equal(supervisor.list()[0].inFlight, true, 'wrong-phase response must not acknowledge the request');

workerA1.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'instance-1',
  generation: 1,
  requestId: updateA1.requestId,
  output: { callbacks: [] },
});
assert.equal(outputs.length, 1, 'stale A1 output must not be accepted after rebuild');

supervisor.rebuild('instance-1', 'source', Object.freeze({ period: 20 }), Object.freeze({ symbol: 'A' }), event('initial', barsA3, 0));
assert.equal(workerB.terminated, true);
assert.equal(workers.length, 3);
const workerA2 = workers[2];
assert.equal(workerA2.messages[0].generation, 3, 'A → B → A must use a new generation');

workerA2.reply({
  protocolVersion: 1,
  type: 'failure',
  phase: 'create',
  instanceId: 'instance-1',
  generation: 3,
  requestId: workerA2.messages[0].requestId,
  code: 'runtime_exception',
  message: 'boom',
});
assert.equal(workerA2.terminated, true);
assert.equal(supervisor.list()[0].failed, true);
assert.equal(failures.at(-1).code, 'runtime_exception');

supervisor.retry('instance-1', event('initial', barsA3, 0));
assert.equal(workers.length, 4);
assert.equal(supervisor.list()[0].generation, 4);
assert.equal(supervisor.list()[0].failed, false);

const workerA3 = workers[3];
supervisor.remove('instance-1');
assert.equal(workerA3.terminated, true);
assert.equal(supervisor.list().length, 0);

const boundaryWorkers = [];
const boundaryOutputs = [];
const boundaryFailures = [];
const boundarySupervisor = new UserIndicatorSupervisor({
  workerFactory: () => {
    const worker = new FakeWorker();
    boundaryWorkers.push(worker);
    return worker;
  },
  onOutput: (output) => boundaryOutputs.push(output),
  onFailure: (failure) => boundaryFailures.push(failure),
});

boundarySupervisor.create(
  'boundary-instance',
  'source',
  Object.freeze({}),
  Object.freeze({ symbol: 'A' }),
  event('initial', [bar(1)], 0),
);
const boundaryWorker = boundaryWorkers[0];
const boundaryCreate = boundaryWorker.messages[0];
boundaryWorker.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'create',
  instanceId: 'boundary-instance',
  generation: 1,
  requestId: boundaryCreate.requestId,
  output: {
    callbacks: [
      {
        phase: 'create',
        commands: [{ type: 'create-series', key: 'signal', seriesType: 'line', pane: 'main' }],
      },
      { phase: 'update', reason: 'initial', changedFrom: 0, barsLength: 1, commands: [] },
    ],
  },
});
assert.equal(boundaryOutputs.length, 1);
boundarySupervisor.update('boundary-instance', event('realtime', [bar(1, 10)], 0));
const boundaryUpdate = boundaryWorker.messages[1];
boundaryWorker.reply({
  protocolVersion: 1,
  type: 'success',
  phase: 'update',
  instanceId: 'boundary-instance',
  generation: 1,
  requestId: boundaryUpdate.requestId,
  output: {
    callbacks: [{
      phase: 'update',
      reason: 'realtime',
      changedFrom: 0,
      barsLength: 1,
      commands: [{ type: 'series-set-values', key: 'signal', values: [Number.POSITIVE_INFINITY] }],
    }],
  },
});
assert.equal(boundaryWorker.terminated, true, 'Supervisor must terminate a Worker that returns invalid output');
assert.equal(boundarySupervisor.list()[0].failed, true);
assert.equal(boundaryFailures.at(-1).code, 'invalid_output');
assert.equal(boundaryOutputs.length, 1, 'invalid Worker output must never reach the host output callback');

console.log('user indicator supervisor: ok');
