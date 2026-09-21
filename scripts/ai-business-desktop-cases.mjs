/** Private end-to-end cases. All changes occur in the runner's isolated app. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function runBusinessDesktopCases({ command, test, client, result, timeout, capture }) {
  async function connection(run) {
    await command('start'); const config = await command('config'); const c = client(config);
    try {
      await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: '平台业务验收', version: '1' } }).promise;
      c.notify('notifications/initialized');
      let selection = result(await c.call('tf_context_get').promise).context;
      const raw = async (name, input = {}, chart = false) => result(await c.call(name, chart ? { context: selection, input } : { input }).promise);
      const read = async (name, input = {}, chart = false) => {
        const r = await raw(name, input, chart); assert.equal(r.status, 'ok', `${name}: ${JSON.stringify(r)}`); return r.data;
      };
      const write = async (name, input, chart = false, expectedError) => {
        const r = result(await c.call(name, chart ? { context: selection, input } : { input }).promise);
        if (expectedError) { assert.equal(r.code, expectedError, JSON.stringify(r)); return r; }
        assert.equal(r.status, 'ok', `${name}: ${JSON.stringify(r)}`);
        if (r.data.selection) selection = r.data.selection;
        return r.data;
      };
      await run({ c, raw, read, write, context: () => selection, config });
    } finally {
      c.child.stdin.end(); await timeout(c.exited, 6000, 'platform helper EOF');
      await command('wait-connections', { count: 0 }); await command('stop');
    }
  }

  await connection(async ({ read, write, context, c }) => {
    const original = (await read('tf_chart_current')).selection;
    await test('platform: chart open, period and adjustment hand off only the initiating connection', async () => {
      const opened = await write('tf_chart_open', { expected: original, providerId: 'tdx', symbol: 'SZ:000001', kind: 'stock', resolution: '1D', adjustment: 'none' });
      assert.equal(opened.selection.instrument, 'SZ:000001');
      assert.deepEqual(result(await c.call('tf_context_get').promise).context, opened.selection);
      assert.equal((await read('tf_chart_data_window', {}, true)).available, true);
      assert.equal(result(await c.call('tf_chart_data_window', { context: original, input: {} }).promise).code, 'context_stale');
      const week = await write('tf_chart_resolution', { expected: context(), resolution: '1W' });
      assert.equal(week.selection.resolution, '1W');
      assert.equal((await write('tf_chart_adjustment', { expected: context(), adjustment: 'qfq' })).selection.adjustment, 'qfq');
      assert.equal((await read('tf_chart_visible_range', {}, true)).available, true);
      const before = context();
      await write('tf_chart_resolution', { expected: before, resolution: 'not-a-period' }, false, 'field_unavailable');
      assert.deepEqual((await read('tf_chart_current')).selection, before);
      await write('tf_chart_open', { expected: context(), providerId: original.provider, symbol: original.instrument, kind: 'stock', resolution: original.resolution, adjustment: original.adjustment });
    });
    await test('platform: existing watchlist supports add, move, fresh quotes and remove without chart changes', async () => {
      const before = await read('tf_watchlist_list', { limit: 100 }), selected = context();
      const keys = new Set(before.items.map(row => row.key));
      const items = ['SH:600519', 'SZ:000333', 'SH:601318', 'SZ:002415'].filter(symbol => !keys.has(`tdx|${symbol}`)).slice(0, 2)
        .map(symbol => ({ providerId: 'tdx', symbol }));
      assert.equal(items.length, 2);
      await write('tf_watchlist_add', { items });
      await write('tf_watchlist_move', { key: `tdx|${items[1].symbol}`, index: 0 });
      assert.equal((await read('tf_watchlist_list')).items[0].key, `tdx|${items[1].symbol}`);
      const quotes = await read('tf_watchlist_quotes', { limit: 1 });
      assert.equal(quotes.items[0].status, 'ok', JSON.stringify(quotes)); assert.ok(quotes.items[0].data.quote.last > 0);
      await write('tf_watchlist_remove', { keys: items.map(item => `tdx|${item.symbol}`) });
      assert.deepEqual((await read('tf_watchlist_list', { limit: 100 })).items.map(row => row.key), before.items.map(row => row.key));
      assert.deepEqual((await read('tf_chart_current')).selection, selected);
    });
    await test('platform: trusted indicator parameters, visibility and removal use the live instance', async () => {
      const original = await read('tf_indicator_instances', {}, true);
      const added = await write('tf_indicator_add', { indicatorId: 'builtin.ma' }, true);
      const values = await read('tf_indicator_inputs_get', { instanceId: added.instanceId }, true);
      const schema = JSON.parse(values.schemaJson);
      const numeric = Object.entries(schema).find(([, field]) => field.type === 'number'); assert.ok(numeric);
      const [key, field] = numeric;
      const value = Math.min(field.max ?? 100, Math.max(field.min ?? 1, (field.default ?? 10) + (field.step ?? 1)));
      await write('tf_indicator_inputs_set', { instanceId: added.instanceId, inputsJson: JSON.stringify({ [key]: value }) }, true);
      assert.equal(JSON.parse((await read('tf_indicator_inputs_get', { instanceId: added.instanceId }, true)).inputsJson)[key], value);
      await write('tf_indicator_visibility', { instanceId: added.instanceId, visible: false }, true);
      assert.equal((await read('tf_indicator_instances', {}, true)).items.find(row => row.instanceId === added.instanceId).visible, false);
      await write('tf_indicator_remove', { instanceId: added.instanceId }, true);
      assert.deepEqual((await read('tf_indicator_instances', {}, true)).items.map(row => row.instanceId), original.items.map(row => row.instanceId));
    });
    await test('platform: monthly MA16 runs on a daily chart through host MTF data without changing display resolution', async () => {
      const beforeSelection = context();
      if (beforeSelection.resolution !== '1D') await write('tf_chart_resolution', { expected: context(), resolution: '1D' });
      const dailySelection = context(); assert.equal(dailySelection.resolution, '1D');
      const beforeInstances = await read('tf_indicator_instances', {}, true);
      const added = await write('tf_indicator_add', {
        indicatorId: 'builtin.ma', inputsJson: JSON.stringify({ period: 16, sourceResolution: '1M' }),
      }, true);
      const ready = await command('indicator-ready', { instanceId: added.instanceId });
      assert.equal(ready.instance.failed, false); assert.equal(ready.instance.indicatorId, 'builtin.ma');
      assert.equal(ready.instance.inputs.period, 16); assert.equal(ready.instance.inputs.sourceResolution, '1M');
      assert.equal(context().resolution, '1D'); assert.equal((await read('tf_chart_current')).selection.resolution, '1D');
      const configured = JSON.parse((await read('tf_indicator_inputs_get', { instanceId: added.instanceId }, true)).inputsJson);
      assert.equal(configured.period, 16); assert.equal(configured.sourceResolution, '1M');
      await write('tf_indicator_remove', { instanceId: added.instanceId }, true);
      assert.deepEqual((await read('tf_indicator_instances', {}, true)).items.map(row => row.instanceId), beforeInstances.items.map(row => row.instanceId));
      if (beforeSelection.resolution !== '1D') await write('tf_chart_resolution', { expected: context(), resolution: beforeSelection.resolution });
    });
  });

  await connection(async ({ read, write, raw, context, config }) => {
    const id = 'desktop.platform-indicator';
    const template = (await readFile(new URL('../fixtures/user-indicators/01-sma.tfi', import.meta.url), 'utf8'))
      .replace("id: 'fixture.sma'", `id: '${id}'`)
      .replace('create(context, inputs) {', "create(context, inputs) {\n    const pane = context.panes.create({key:'sma',defaultHeight:150});")
      .replace("pane: 'main'", 'pane: pane.key');
    let instance, saved;
    const stage = async source => { const validated = await read('tf_indicator_validate', { source }); assert.equal(validated.valid, true); return validated.draftId; };
    await test('platform: full-size .tfi crosses native MCP framing and isolated validation without installation', async () => {
      const padded = template + '\n/*' + 'a'.repeat(256 * 1024 - Buffer.byteLength(template) - 5) + '*/';
      assert.ok(await stage(padded));
      assert.equal((await read('tf_indicator_library')).items.some(row => row.id === id), false);
    });
    await test('platform: generated indicator validates, installs, renders and preserves its parameter/layout identity on update', async () => {
      const guide = await read('tf_indicator_guide'); assert.ok(guide.api.includes('createSeries'));
      await write('tf_indicator_install', { draftId: await stage(template) });
      instance = await write('tf_indicator_add', { indicatorId: id, inputsJson: '{"period":17}' }, true);
      saved = await command('indicator-ready', { instanceId: instance.instanceId }); assert.equal(saved.instance.failed, false);
      await write('tf_indicator_visibility', { instanceId: instance.instanceId, visible: false }, true);
      await write('tf_indicator_install', { draftId: await stage(template.replace('indicatorVersion: 1', 'indicatorVersion: 2')) });
      const current = await command('indicator-ready', { instanceId: instance.instanceId });
      assert.equal(current.instance.indicatorVersion, 2); assert.equal(current.instance.inputs.period, 17); assert.equal(current.instance.visible, false);
      assert.deepEqual(current.panes.map(p => p.key), saved.panes.map(p => p.key));
      for (let i = 0; i < saved.panes.length; i++) assert.ok(Math.abs(current.panes[i].height - saved.panes[i].height) <= 2);
      assert.equal((await read('tf_indicator_source', { indicatorId: id })).indicatorVersion, 2);
    });
    await test('platform: a validated but failing replacement restores the last working source and live settings', async () => {
      const broken = template.replace('indicatorVersion: 1', 'indicatorVersion: 3').replace('update(event) {', "update(event) { throw new Error('fixture runtime failure');");
      await write('tf_indicator_install', { draftId: await stage(broken) }, false, 'indicator_failed');
      const restored = await command('indicator-ready', { instanceId: instance.instanceId });
      assert.equal(restored.instance.indicatorVersion, 2); assert.equal(restored.instance.inputs.period, 17); assert.equal(restored.instance.visible, false);
      assert.equal((await read('tf_indicator_source', { indicatorId: id })).indicatorVersion, 2);
    });
    await test('platform: removing and reimporting the same user source recovers the old instance without project-file access', async () => {
      const working = (await read('tf_indicator_source', { indicatorId: id })).source;
      await write('tf_indicator_library_remove', { indicatorId: id });
      assert.equal((await read('tf_indicator_instances', {}, true)).items.some(row => row.instanceId === instance.instanceId), false);
      await write('tf_indicator_install', { draftId: await stage(working) });
      const restored = await command('indicator-ready', { instanceId: instance.instanceId });
      assert.equal(restored.instance.inputs.period, 17); assert.equal(restored.instance.visible, false);
      assert.equal((await raw('tf_indicator_source', { indicatorId: '../src/main.ts' })).code, 'field_unavailable');
      await write('tf_indicator_remove', { instanceId: instance.instanceId }, true);
      await write('tf_indicator_library_remove', { indicatorId: id });
    });
    await test('platform: ordinary import-and-add button uses real validation and Worker rendering', async () => {
      const uiSource = template.replace(id, 'desktop.platform-ui-import');
      const added = await command('import-and-add', { source: uiSource, indicatorId: 'desktop.platform-ui-import' });
      assert.equal(added.instance.failed, false);
      await capture('platform-imported-indicator', config.env.TRADEFLOW_MCP_PORT);
      await write('tf_indicator_remove', { instanceId: added.instance.instanceId }, true);
      await write('tf_indicator_library_remove', { indicatorId: 'desktop.platform-ui-import' });
    });
    assert.equal((await read('tf_chart_current')).selection.instrument, context().instrument);
  });

  await connection(async ({ read, config }) => {
    await test('platform: all 21 native drawing types render in one batch and batch undo preserves the previous scene', async () => {
      const types = await read('tf_drawings_types', {}, true); assert.equal(types.length, 21);
      const before = await read('tf_drawings_list', {}, true);
      const window = await read('tf_chart_visible_range', {}, true), data = await read('tf_chart_data_window', {}, true);
      const t = window.from, span = window.to - window.from, price = data.close;
      const points = [{ time: t + span * .4, price }, { time: t + span * .6, price: price * .94 }, { time: t + span * .6, price: price * 1.06 }];
      const operations = types.map(type => ({ op: 'create', drawing: { type: type.type, points: points.slice(0, type.points),
        style: ['Text', 'Callout'].includes(type.type) ? { text: type.type, color: 'rgb(41,98,255)' } : {} } }));
      const plan = await read('tf_drawings_propose', { operations }, true);
      await read('tf_drawings_apply', { changeSetId: plan.changeSetId }, true);
      const after = await read('tf_drawings_list', {}, true);
      assert.equal(after.length, before.length + 21);
      assert.deepEqual([...new Set(after.filter(row => !before.some(old => old.id === row.id)).map(row => row.value.type))].sort(), types.map(row => row.type).sort());
      await capture('platform-all-drawing-types', config.env.TRADEFLOW_MCP_PORT);
      await read('tf_drawings_revert', { changeSetId: plan.changeSetId }, true);
      assert.deepEqual((await read('tf_drawings_list', {}, true)).map(row => row.id), before.map(row => row.id));
    });
  });
}
