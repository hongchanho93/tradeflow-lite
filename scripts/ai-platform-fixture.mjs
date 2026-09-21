/** Synthetic model decisions for the private three-protocol desktop test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const template = readFileSync(new URL('../fixtures/user-indicators/01-sma.tfi', import.meta.url), 'utf8');
let sequence = 0;

export function platformAnswer(protocol, user, outputs) {
  if (!['DESKTOP_PLATFORM_NAV', 'DESKTOP_PLATFORM_INDICATOR'].includes(user)) return null;
  const previous = name => outputs.filter(output => output.name === name).at(-1)?.value;
  const call = (name, input, chart) => ({ text: '', calls: [{ id: `platform-${++sequence}`, name,
    arguments: JSON.stringify(chart ? { context: chart, input } : name === 'tf_context_get' ? {} : { input }) }] });
  for (const output of outputs) if (output.value.status) assert.equal(output.value.status, 'ok', `${output.name}: ${JSON.stringify(output.value)}`);
  if (user === 'DESKTOP_PLATFORM_NAV') {
    if (!previous('tf_chart_current')) return call('tf_chart_current', {});
    const initial = previous('tf_chart_current').data.selection;
    const navigations = outputs.filter(output => output.name === 'tf_chart_open');
    if (!navigations.length) return call('tf_chart_open', { expected: initial, providerId: 'tdx',
      symbol: initial.instrument === 'SZ:000001' ? 'SH:600000' : 'SZ:000001', kind: 'stock', resolution: '1D', adjustment: 'none' });
    const selected = navigations[0].value.data.selection;
    if (!previous('tf_chart_data_window')) return call('tf_chart_data_window', {}, selected);
    assert.equal(previous('tf_chart_data_window').data.available, true);
    if (!previous('tf_watchlist_list')) return call('tf_watchlist_list', { limit: 100 });
    const original = previous('tf_watchlist_list').data.items;
    const symbol = ['SH:600519', 'SZ:000333', 'SH:601318', 'SZ:002415'].find(symbol => !original.some(item => item.key === `tdx|${symbol}`));
    assert.ok(symbol); const key = `tdx|${symbol}`;
    if (!previous('tf_watchlist_add')) return call('tf_watchlist_add', { items: [{ providerId: 'tdx', symbol }] });
    if (!previous('tf_watchlist_move')) return call('tf_watchlist_move', { key, index: 0 });
    if (!previous('tf_watchlist_quotes')) return call('tf_watchlist_quotes', { limit: 1 });
    const quote = previous('tf_watchlist_quotes').data.items[0]; assert.equal(quote.key, key); assert.equal(quote.status, 'ok');
    if (!previous('tf_watchlist_remove')) return call('tf_watchlist_remove', { keys: [key] });
    if (navigations.length < 2) return call('tf_chart_open', { expected: selected, providerId: initial.provider,
      symbol: initial.instrument, kind: 'stock', resolution: initial.resolution, adjustment: initial.adjustment });
    return { text: '平台导航和自选工作流验证完成。', calls: [] };
  }

  const id = `desktop.api-${protocol}`, source = template.replace("id: 'fixture.sma'", `id: '${id}'`);
  const broken = source.replace('return { update(event) {', 'return { update(event) { while (true) {}');
  const values = name => outputs.filter(output => output.name === name).map(output => output.value);
  if (!previous('tf_indicator_guide')) return call('tf_indicator_guide', {});
  assert.ok(previous('tf_indicator_guide').data.api.includes('createSeries'));
  if (!previous('tf_context_get')) return call('tf_context_get', {});
  const chart = previous('tf_context_get').context;
  const validations = values('tf_indicator_validate');
  if (!validations.length) return call('tf_indicator_validate', { source: broken });
  const first = validations[0].data; assert.equal(first.valid, true); assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
  const tests = values('tf_indicator_test');
  if (!tests.length) return call('tf_indicator_test', { draftId: first.draftId }, chart);
  const failed = tests[0].data; assert.equal(failed.valid, false); assert.equal(failed.stage, 'runtime'); assert.equal(failed.sourceHash, first.sourceHash);
  assert.equal(failed.errorCode, 'execution_timeout');
  if (validations.length === 1) return call('tf_indicator_validate', { source });
  const validated = validations.at(-1).data; assert.equal(validated.valid, true); assert.notEqual(validated.sourceHash, first.sourceHash);
  if (tests.length === 1) return call('tf_indicator_test', { draftId: validated.draftId }, chart);
  const passed = tests.at(-1).data; assert.equal(passed.valid, true); assert.equal(passed.sourceHash, validated.sourceHash); assert.ok(passed.sampleRows > 0);
  if (!previous('tf_indicator_install')) return call('tf_indicator_install', { draftId: validated.draftId });
  if (!previous('tf_indicator_add')) return call('tf_indicator_add', { indicatorId: id, inputsJson: '{"period":17}' }, chart);
  const instanceId = previous('tf_indicator_add').data.instanceId;
  if (!previous('tf_indicator_instances')) return call('tf_indicator_instances', {}, chart);
  const instance = previous('tf_indicator_instances').data.items.find(item => item.instanceId === instanceId);
  assert.ok(instance); assert.equal(instance.failed, false); assert.equal(instance.visible, true); assert.equal(JSON.parse(instance.inputsJson).period, 17);
  if (!previous('tf_indicator_remove')) return call('tf_indicator_remove', { instanceId }, chart);
  if (!previous('tf_indicator_library_remove')) return call('tf_indicator_library_remove', { indicatorId: id });
  return { text: '用户指标生成和管理工作流验证完成。', calls: [] };
}
