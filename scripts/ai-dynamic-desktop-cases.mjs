import assert from 'node:assert/strict';

/** Real stdio discovery and execution, scoped to the runner's synthetic owner/app. */
export async function runDynamicDesktopCases({ command, test, client, result, timeout }) {
  await command('start'); const config = await command('config'), c = client(config);
  const probe = input => command('dynamic-registry', input);
  const wait = async predicate => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 20)); }
    throw Error('dynamic fixture state/notification timeout');
  };
  const notifications = () => c.received.filter(item => item.method === 'notifications/tools/list_changed');
  const list = async () => (await c.request('tools/list').promise).result.tools;
  const call = async (name = 'user_desktop_dynamic_value') => result(await c.call(name, { input: {} }).promise);
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: '动态目录验收', version: '1' } }).promise;
    assert.equal(init.result.capabilities.tools.listChanged, true); c.notify('notifications/initialized');
    await test('dynamic: live native notification discovers a new owner without reconnecting', async () => {
      assert.ok(!(await list()).some(t => t.name === 'user_desktop_dynamic_value'));
      await probe({ op: 'register', version: 1 }); await wait(() => notifications().length > 0);
      assert.deepEqual(Object.keys(notifications()[0]).sort(), ['jsonrpc', 'method']);
      assert.equal((await call()).code, 'tool_changed');
      assert.ok((await list()).some(t => t.title === '我的动态测试工具'));
      assert.equal((await call()).data, 1);
    });
    await test('dynamic: updated implementation rejects old request IDs and old discovery until refreshed', async () => {
      const old = c.call('user_desktop_dynamic_value', { input: {} }); assert.equal(result(await old.promise).data, 1);
      const before = notifications().length; await probe({ op: 'update', version: 2 }); await wait(() => notifications().length > before);
      assert.equal((await call()).code, 'tool_changed'); await list(); assert.equal((await call()).data, 2);
      const priorCount = c.received.length;
      c.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: old.id, method: 'tools/call', params: { name: 'user_desktop_dynamic_value', arguments: { input: {} } } }) + '\n');
      await wait(() => c.received.slice(priorCount).some(item => item.id === old.id));
      assert.equal(result(c.received.slice(priorCount).find(item => item.id === old.id)).code, 'tool_changed');
    });
    await test('dynamic: long internal IDs work via a stable model-compatible alias', async () => {
      const { id } = await probe({ op: 'long' }); const item = (await list()).find(t => t._meta?.['tradeflow/id'] === id);
      assert.match(item.name, /^[A-Za-z0-9_-]{1,64}$/); assert.equal((await call(item.name)).data, 1);
    });
    await test('dynamic: a newly changed write inherits the existing one-time authorization without another prompt', async () => {
      await probe({ op: 'update', version: 3, write: true }); await list();
      assert.equal((await call()).data, 3); assert.equal((await probe({ op: 'state' })).value, 3);
    });
    await test('dynamic: retirement waits for actual asynchronous compensation and prevents new-version overlap', async () => {
      await probe({ op: 'stall' }); await list();
      const old = c.call('user_desktop_dynamic_value', { input: {} });
      let replied = false; old.promise.then(() => { replied = true; });
      await wait(async () => (await probe({ op: 'state' })).value === 5);
      await probe({ op: 'retire-running' }); await list();
      assert.equal(replied, false); assert.equal((await call()).code, 'busy');
      assert.equal((await probe({ op: 'state' })).retired, false);
      await probe({ op: 'release' }); await wait(async () => (await probe({ op: 'state' })).rollbackStarted);
      assert.equal(replied, false); await probe({ op: 'release-rollback' });
      assert.equal(result(await old.promise).code, 'tool_changed');
      await wait(async () => (await probe({ op: 'state' })).retired);
      assert.equal((await probe({ op: 'state' })).value, 3); assert.equal((await call()).data, 6);
    });
    await test('dynamic: uninstall removes tools, reinstallation does not restore stale identities, existing business remains available', async () => {
      const before = notifications().length; await probe({ op: 'dispose' }); await wait(() => notifications().length > before);
      assert.equal((await call()).code, 'tool_changed'); assert.ok(!(await list()).some(t => t.name.startsWith('user_desktop_dynamic_')));
      assert.equal((await call('tf_market_providers')).status, 'ok');
      await probe({ op: 'register', version: 7 }); assert.equal((await call()).code, 'tool_changed');
      await list(); assert.equal((await call()).data, 7);
    });
  } finally {
    await probe({ op: 'dispose' }); c.child.stdin.end(); await timeout(c.exited, 6000, 'dynamic client EOF');
    await command('wait-connections', { count: 0 }); await command('stop');
  }
}
