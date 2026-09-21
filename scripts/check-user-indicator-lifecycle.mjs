import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserIndicatorSupervisor } from '../src/user-indicator-runtime/supervisor.ts';
import { UserIndicatorRuntimeManager } from '../src/user-indicator-runtime/runtime-manager.ts';
import { USER_INDICATOR_RUNTIME_LIMITS as limits } from '../src/user-indicator-runtime/limits.ts';

const event = { reason: 'initial', bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }], changedFrom: 0 };
const context = { instrument: {}, selection: { symbol: 'TEST:A', resolution: '1', adjustment: 'none',
  seriesKind: 'ohlcv', marketKind: 'stock', providerId: 'test' }, theme: 'dark' };
const library = { id: 'user.lifecycle', source: 'source', sourceHash: 'a'.repeat(64), indicatorVersion: 1,
  manifest: { inputs: {}, supports: { seriesKinds: ['ohlcv'] } } };
const config = instanceId => ({ instanceId, indicatorId: library.id, sourceHash: library.sourceHash, indicatorVersion: 1 });

class Worker {
  onmessage = null; onerror = null; onmessageerror = null;
  messages = []; terminated = false; throwOnPost = false;
  postMessage(request) { if (this.throwOnPost) throw new Error('synthetic postMessage failure'); this.messages.push(request); }
  terminate() { this.terminated = true; }
  acknowledge() {
    const request = this.messages.at(-1);
    const data = request.type === 'create' ? request.initialEvent : request.event;
    this.onmessage?.({ data: { protocolVersion: 1, type: 'success', phase: request.type,
      instanceId: request.instanceId, generation: request.generation, requestId: request.requestId,
      output: { callbacks: [
        ...(request.type === 'create' ? [{ phase: 'create', commands: [] }] : []),
        { phase: 'update', reason: data.reason, changedFrom: data.changedFrom, barsLength: 1, commands: [] },
      ] } } });
  }
}

function fixture(t, factory) {
  const workers = [], failures = [];
  const supervisor = new UserIndicatorSupervisor({ workerFactory: () => {
    const worker = factory?.() ?? new Worker(); workers.push(worker); return worker;
  }, onFailure: failure => failures.push(failure) });
  const controller = Object.fromEntries(['create', 'rebuild', 'update', 'retry', 'remove', 'destroy', 'list']
    .map(name => [name, (...args) => supervisor[name](...args)]));
  controller.setVisible = () => {};
  const manager = new UserIndicatorRuntimeManager(controller);
  t.after(() => manager.destroy());
  return { supervisor, controller, manager, workers, failures };
}

test('capacity rejection rolls back the manager and later ticks still work', t => {
  const { manager, supervisor } = fixture(t);
  manager.setContext(context, event);
  for (let i = 0; i < limits.activeInstances; i++) manager.add(config(`u${i}`), library);
  assert.throws(() => manager.add(config('rejected'), library), /limit/);
  assert.equal(manager.get('rejected'), null);
  assert.equal(manager.list().length, supervisor.list().length);
  for (let i = 0; i < 3; i++) assert.doesNotThrow(() => manager.update({ ...event, reason: 'realtime' }));
  manager.remove('u0'); manager.add(config('replacement'), library);
  assert.equal(manager.get('replacement').running, true);
});

test('saved inactive instances beyond capacity do not break a context switch or auto-retry every tick', t => {
  const { manager, workers } = fixture(t);
  for (let i = 0; i <= limits.activeInstances; i++) manager.add(config(`saved${i}`), library);
  assert.doesNotThrow(() => manager.setContext(context, event));
  assert.equal(manager.get(`saved${limits.activeInstances}`).failed, true);
  for (let i = 0; i < 3; i++) assert.doesNotThrow(() => manager.update({ ...event, reason: 'realtime' }));
  assert.equal(workers.length, limits.activeInstances);
  manager.remove('saved0'); manager.retry(`saved${limits.activeInstances}`);
  assert.equal(manager.get(`saved${limits.activeInstances}`).running, true);
  assert.equal(manager.get(`saved${limits.activeInstances}`).failed, false);
});

test('Worker construction failure is retryable and does not interrupt other instances', t => {
  let fail = true;
  const { manager, workers, failures } = fixture(t, () => { if (fail) throw new Error('constructor'); return new Worker(); });
  manager.setContext(context, event);
  assert.doesNotThrow(() => manager.add(config('broken'), library));
  assert.equal(manager.get('broken').failed, true);
  assert.equal(failures.length, 1);
  fail = false; manager.add(config('healthy'), library); workers[0].acknowledge();
  manager.update({ ...event, reason: 'realtime' });
  assert.equal(workers[0].messages.at(-1).type, 'update');
  manager.retry('broken');
  assert.equal(manager.get('broken').running, true);
});

for (const phase of ['create', 'update']) test(`postMessage failure during ${phase} clears timers/worker and permits retry`, t => {
  const { manager, workers } = fixture(t, () => { const worker = new Worker(); worker.throwOnPost = phase === 'create'; return worker; });
  manager.setContext(context, event);
  assert.doesNotThrow(() => manager.add(config('test'), library));
  if (phase === 'update') {
    workers[0].acknowledge(); workers[0].throwOnPost = true;
    assert.doesNotThrow(() => manager.update({ ...event, reason: 'realtime' }));
  }
  assert.equal(workers[0].terminated, true);
  assert.equal(manager.get('test').failed, true);
  assert.equal(manager.get('test').running, false);
  assert.equal(manager.list().length, 1);
});

test('a queued error from an old Worker cannot fail the new generation', t => {
  const { supervisor, workers, failures } = fixture(t);
  supervisor.create('test', 'source', {}, {}, event);
  const lateError = workers[0].onerror;
  const lateMessageError = workers[0].onmessageerror;
  supervisor.rebuild('test', 'source', {}, {}, event);
  lateError({}); lateMessageError({});
  assert.equal(supervisor.list()[0].running, true);
  assert.equal(workers[1].terminated, false);
  assert.equal(failures.length, 0);
});

test('host-side failure isolates one record and explicit retry restores it', t => {
  const { controller, manager, workers } = fixture(t);
  manager.setContext(context, event); manager.add(config('broken'), library); manager.add(config('healthy'), library);
  workers.forEach(worker => worker.acknowledge());
  const update = controller.update;
  controller.update = (id, data) => { if (id === 'broken') throw new Error('synthetic host failure'); update(id, data); };
  assert.doesNotThrow(() => manager.update({ ...event, reason: 'realtime' }));
  assert.equal(manager.get('broken').failed, true);
  assert.equal(workers[1].messages.at(-1).type, 'update');
  assert.doesNotThrow(() => manager.update({ ...event, reason: 'realtime' }));
  manager.retry('broken'); assert.equal(manager.get('broken').running, true);
});
