import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CSV_CONNECTOR_SOURCE } from '../src/user-data/csv-example.ts';
import { runConnector } from '../src/user-data/runtime-client.ts';
import { ConnectorProvider } from '../src/user-data/provider.ts';
import { createUserDataTools } from '../src/user-data/tools.ts';
import { openTaskRuntime } from '../src/user-task/runtime-client.ts';
import { TaskResultStore } from '../src/user-task/results.ts';
import { UserTaskManager } from '../src/user-task/manager.ts';
import { createTaskDataHost } from '../src/user-task/sources.ts';
import { UserTaskLibrary } from '../src/user-task/library.ts';
import { createUserTaskTools, createSavedTaskTool } from '../src/user-task/tools.ts';
import { CapabilityCore } from '../src/ai-capabilities/core.ts';
import { CapabilityRegistry } from '../src/ai-capabilities/registry.ts';
import { McpConnection } from '../src/ai-mcp/session.ts';
import { taskWorkerFactory } from './user-task-fixtures.mjs';
import { dataWorkerFactory, dataInfo } from './user-data-fixtures.mjs';

const root = new URL('../examples/user-research/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const signal = () => new AbortController().signal;
const symbol = { providerId: 'test', symbol: 'SH:600000', kind: 'stock', name: '合成样本' };
const bars = (closes, opens = closes) => closes.map((close, i) => ({ time: 1704067200 + i * 86400,
  open: opens[i], high: Math.max(opens[i], close), low: Math.min(opens[i], close), close, volume: 100 }));
const batch = (rows, overrides = {}) => ({ symbol, history: { daily: { rows, seriesKind: 'ohlcv',
  requestedCount: 120, shortfall: rows.length < 120, coverage: 'provider-returned-window', finality: 'unknown', ...overrides } } });

async function run(name, batches, parameters) {
  const runtime = await openTaskRuntime(read(name), signal(), { workerFactory: taskWorkerFactory });
  const results = new TaskResultStore(runtime.manifest.outputs);
  try {
    results.append(await runtime.start(parameters ?? runtime.manifest.defaults));
    for (const value of batches) results.append(await runtime.process(value));
    results.append(await runtime.finish());
    return results;
  } catch (error) { results.close(); throw error; }
  finally { runtime.close(); }
}
function rowObjects(results, id) {
  const page = results.page(id);
  return page.rows.map(row => Object.fromEntries(page.columns.map((c, i) => [c.id, row[i]])));
}
const zeroCosts = { '均线根数': 3, '初始资金': 1000, '单边费用基点': 0, '单边滑点基点': 0, '净值品种': 'SH:600000' };

test('P6 downloadable CSV is exactly the existing SDK reference, not a second implementation', () => {
  assert.equal(read('csv-daily.tfc').trim(), CSV_CONNECTOR_SOURCE.trim());
});
test('P6 scan excludes the current close, treats equal highs as no breakout and preserves source identity', async () => {
  const values = [batch(bars([10, 11, 12, 13])), batch(bars([10, 11, 12, 12])), batch(bars([10, 11, 12, 9]))];
  const result = await run('window-breakout.tft', values);
  try {
    assert.deepEqual(rowObjects(result, 'table').map(r => r.matched), [true, false, false]);
    assert.deepEqual(rowObjects(result, 'table').map(r => r.previous_high), [12, 12, 12]);
    const selected = result.page('selected').rows;
    assert.equal(Object.getPrototypeOf(selected[0]), null);
    assert.deepEqual(selected.map(row => ({ ...row })), [symbol]);
    assert.match(result.page('report').text, /实际返回窗口/);
  } finally { result.close(); }
});
test('P6 scan exposes insufficient/non-OHLCV/invalid-price inputs instead of fabricating matches', async () => {
  const result = await run('window-breakout.tft', [batch([]), batch(bars([1, 2])),
    batch([{ time: 1, value: 50 }], { seriesKind: 'probability' }), batch(bars([1, 2, 3, 0]))]);
  try {
    assert.deepEqual(rowObjects(result, 'table').map(r => r.status), ['数据不足', '数据不足', '非OHLCV', '价格无效']);
    assert.equal(result.page('selected').total, 0);
  } finally { result.close(); }
});
test('P6 scan reports actual oldest-window timestamps, shortfall and continuation without claiming recent data', async () => {
  const input = batch(bars([10, 11, 12, 13]), { nextCursor: 'more' });
  const result = await run('window-breakout.tft', [input]);
  try {
    const row = rowObjects(result, 'table')[0];
    assert.equal(row.start, input.history.daily.rows[0].time); assert.equal(row.end, input.history.daily.rows.at(-1).time);
    assert.equal(row.shortfall, true); assert.equal(row.more, true); assert.equal(row.finality, 'unknown');
  } finally { result.close(); }
});
test('P6 backtest uses prior close signals and next open fills; unrealized ending position is not force-sold', async () => {
  const rows = bars([10, 11, 12, 9, 10], [10, 10, 10, 20, 10]);
  const result = await run('sma-backtest.tft', [batch(rows)], zeroCosts);
  try {
    const fills = rowObjects(result, 'fills'), summary = rowObjects(result, 'summary')[0];
    assert.deepEqual(fills.map(r => [r.action, r.price, r.signal_time, r.fill_time]), [
      ['买入', 20, rows[2].time, rows[3].time], ['卖出', 10, rows[3].time, rows[4].time] ]);
    assert.equal(summary.final_equity, 500); assert.equal(summary.return_pct, -50); assert.equal(summary.holding, false);
    assert.ok(Math.abs(summary.drawdown_pct - 55) < 1e-9);
    assert.deepEqual(result.page('equity').rows.map(p => p.value), [1000, 1000, 1000, 450, 500]);
  } finally { result.close(); }
  const partial = await run('sma-backtest.tft', [batch(rows.slice(0, 4))], zeroCosts);
  try { assert.equal(partial.page('fills').total, 1); assert.equal(rowObjects(partial, 'summary')[0].holding, true); }
  finally { partial.close(); }
});
test('P6 changing the fill-day close cannot change that day entry; future bars do not change earlier equity', async () => {
  const rows = bars([10, 11, 12, 9, 10], [10, 10, 10, 20, 10]);
  const changed = bars([10, 11, 12, 100, 10], [10, 10, 10, 20, 10]);
  const a = await run('sma-backtest.tft', [batch(rows)], zeroCosts);
  const b = await run('sma-backtest.tft', [batch(changed)], zeroCosts);
  const prefix = await run('sma-backtest.tft', [batch(rows.slice(0, 4))], zeroCosts);
  try {
    assert.deepEqual(rowObjects(a, 'fills')[0], rowObjects(b, 'fills')[0]);
    assert.deepEqual(prefix.page('equity').rows, a.page('equity').rows.slice(0, 4));
  } finally { a.close(); b.close(); prefix.close(); }
});
test('P6 fees/slippage are charged on both sides and each symbol has an independent account', async () => {
  const first = batch(bars([10, 11, 12, 9, 10], [10, 10, 10, 20, 10]));
  const second = { ...first, symbol: { ...symbol, symbol: 'SZ:000001' } };
  const result = await run('sma-backtest.tft', [first, second], { ...zeroCosts, '单边费用基点': 10, '单边滑点基点': 5 });
  try {
    const expected = 1000 / (20 * 1.0005 * 1.001) * (10 * 0.9995) * 0.999;
    const summaries = rowObjects(result, 'summary');
    for (const row of summaries) assert.ok(Math.abs(row.final_equity - expected) < 1e-8);
    assert.equal(summaries.length, 2); assert.equal(result.page('equity').total, 5);
    assert.equal(rowObjects(result, 'fills').every(r => r.fee > 0), true);
  } finally { result.close(); }
});
test('P6 backtest handles short, empty, unsupported and nonpositive prices without fake returns', async () => {
  const result = await run('sma-backtest.tft', [batch([]), batch(bars([1, 2])),
    batch([{ time: 1, value: 50 }], { seriesKind: 'probability' }), batch(bars([1, 2, 3, 0]))], zeroCosts);
  try {
    assert.deepEqual(rowObjects(result, 'summary').map(r => r.status), ['数据不足', '数据不足', '非OHLCV', '价格无效']);
    assert.equal(result.page('fills').total, 0); assert.equal(result.page('equity').total, 0);
    assert.equal(rowObjects(result, 'summary').every(r => r.return_pct === null), true);
  } finally { result.close(); }
});

test('P6 example parameter constraints reject invalid lookbacks and costs in the original runtime', async () => {
  for (const value of [1, 2.5, 120]) {
    await assert.rejects(run('window-breakout.tft', [], { '回看根数': value }), error => error.code === 'task_invalid_parameters');
  }
  for (const parameters of [{ ...zeroCosts, '单边费用基点': -1 }, { ...zeroCosts, '单边滑点基点': 101 },
    { ...zeroCosts, '均线根数': 3.5 }, { ...zeroCosts, '初始资金': 0 }]) {
    await assert.rejects(run('sma-backtest.tft', [], parameters), error => error.code === 'task_invalid_parameters');
  }
});
test('P6 full-size returned window works at maximum lookback without silently truncating it', async () => {
  const input = batch(bars(Array.from({ length: 120 }, (_, i) => i + 10)));
  const result = await run('window-breakout.tft', [input], { '回看根数': 119 });
  try {
    const row = rowObjects(result, 'table')[0];
    assert.equal(row.bars, 120); assert.equal(row.shortfall, false); assert.equal(row.matched, true);
    assert.equal(row.previous_high, 128); assert.equal(row.last_close, 129);
  } finally { result.close(); }
});
test('P6 missing selected equity symbol leaves the series empty and does not substitute another symbol', async () => {
  const result = await run('sma-backtest.tft', [batch(bars([10, 11, 12, 13, 14]))], { ...zeroCosts, '净值品种': 'SZ:000001' });
  try {
    assert.equal(result.page('summary').total, 1); assert.equal(result.page('equity').total, 0);
    assert.match(result.page('report').text, /未得到可计算数据/);
  } finally { result.close(); }
});

// Trusted Node test adapter only. Guest files still enter the production Connector Worker;
// it cannot use Node fs, and the bridge serves only these two immutable synthetic fixtures.
async function fixture() {
  const source = read('csv-daily.tfc'), names = ['SH_600000.csv', 'SZ_000001.csv'];
  const files = new Map(names.map(name => [name, new TextEncoder().encode(read(`data/${name}`))]));
  const before = names.map(name => read(`data/${name}`)); let reads = 0;
  const io = { async execute(q, active) {
    assert.equal(active.aborted, false);
    if (q.operation === 'list') {
      assert.equal(q.path, ''); const remaining = names.filter(n => !q.after || n > q.after), page = remaining.slice(0, q.limit);
      return { entries: page.map(name => ({ name, kind: 'file' })), next: remaining.length > page.length ? page.at(-1) : null };
    }
    reads++; const bytes = files.get(q.path); assert.ok(bytes, 'No arbitrary test filesystem access');
    if (q.fileRevision) assert.equal(q.fileRevision, 'p6-synthetic-v1');
    return { data: [...bytes.slice(q.offset, q.offset + Math.min(q.length, 17))], offset: q.offset, size: bytes.length, revision: 'p6-synthetic-v1' };
  } };
  const { manifest } = await runConnector({ source, operation: 'validate' }, null, signal(), { workerFactory: dataWorkerFactory });
  const provider = new ConnectorProvider(dataInfo, source, manifest, io, { workerFactory: dataWorkerFactory });
  const dataHost = createTaskDataHost({ data: () => ({ async initialize() {}, connector(id) {
    assert.equal(id, dataInfo.id); return { provider, manifest, name: 'P6 合成数据', revision: dataInfo.revision };
  } }) });
  const manager = new UserTaskManager(dataHost, { workerFactory: taskWorkerFactory });
  const records = new Map(); const store = { async list() { return structuredClone([...records.values()]); }, async close() {},
    async compareAndSwap(id, expected, record) {
      assert.equal(records.get(id)?.revision ?? null, expected);
      if (record) records.set(id, structuredClone(record)); else records.delete(id);
    } };
  let library; const taskHost = { manager, library: () => library, watchlist: () => [] };
  const registry = new CapabilityRegistry(createUserTaskTools(taskHost));
  library = new UserTaskLibrary(manager, store, id => registry.createOwner(id), (v, id, lifetime) => createSavedTaskTool(taskHost, v, id, lifetime));
  const core = new CapabilityCore(registry), context = { appInstanceId: 'p6-test', chartId: 'main', provider: 'test',
    instrument: 'SH:600000', resolution: '1D', adjustment: 'none', selectionGeneration: 1 };
  const host = { context: () => context, describe: () => registry.describe(), subscribeTools: fn => registry.subscribe(fn),
    open: permissions => core.openSession({ context, currentContext: () => context, permissions }) };
  const connection = new McpConnection(host, () => {}); let id = 0;
  const rpc = async (method, params = {}) => JSON.parse(await connection.receive(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })));
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'p6-test', version: '1' } });
  await connection.receive(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  connection.authorizeAssistant(); await library.initialize();
  return { manager, library, registry, provider, records, rpc, get reads() { return reads; },
    async call(name, input = {}) {
      const result = await rpc('tools/call', { name, arguments: { input } });
      const reply = result.result?.structuredContent?.reply;
      assert.equal(reply?.status, 'ok', JSON.stringify(result)); return reply.data;
    },
    async close() { connection.close(); await library.close(); await manager.close(); provider.close();
      assert.deepEqual(names.map(name => read(`data/${name}`)), before); }
  };
}
test('P6 actual CSV -> Connector -> Task -> MCP save/discover/reuse/remove uses one runtime and source', async () => {
  const f = await fixture();
  try {
    const valid = await f.call('tf_task_validate', { source: read('window-breakout.tft') }); assert.equal(valid.valid, true);
    const started = await f.call('tf_task_start', { draftId: valid.draftId, providerId: f.provider.providerId, universe: 'catalog' });
    await f.manager.wait(started.taskId);
    const status = (await f.call('tf_task_status', { taskId: started.taskId })).task;
    assert.equal(status.state, 'completed'); assert.equal(status.processed, 2); assert.equal(status.shortfallSymbols, 2);
    assert.equal(status.definitionHash, valid.sourceHash); assert.equal(status.universeScope, 'connector-catalog');
    const page = await f.call('tf_task_page', { taskId: started.taskId, artifactId: 'selected' });
    assert.deepEqual(JSON.parse(page.rowsJson).map(r => [r.providerId, r.symbol]), [[f.provider.providerId, 'SZ:000001']]);
    const sorted = f.manager.page(started.taskId, 'table', { sortBy: 'last_close', descending: true, limit: 1 });
    assert.equal(sorted.rows[0][0].symbol, 'SZ:000001'); assert.equal(sorted.nextOffset, 1);
    assert.equal(f.manager.page(started.taskId, 'table', { filter: 'SH:600000' }).matched, 1);
    assert.match(f.manager.export(started.taskId, 'table', 'csv'), /SH:600000/);
    const saved = await f.call('tf_task_save', { taskId: started.taskId });
    const row = (await f.call('tf_task_library')).tasks[0];
    assert.ok((await f.rpc('tools/list')).result.tools.some(t => t.name === row.toolName));
    const again = await f.call(row.toolName, { providerId: f.provider.providerId, universe: 'catalog', parameters: { '回看根数': 3 } });
    await f.manager.wait(again.taskId); assert.equal(f.manager.status(again.taskId).processed, 2);
    const exported = f.manager.export(again.taskId, 'table', 'json');
    assert.equal(JSON.parse(exported).rows.length, 2);
    const candidates = await f.call(row.toolName, { providerId: f.provider.providerId, universe: 'result',
      resultTaskId: started.taskId, artifactId: 'selected', parameters: { '回看根数': 3 } });
    await f.manager.wait(candidates.taskId);
    assert.equal(f.manager.status(candidates.taskId).processed, 1);
    assert.equal(f.manager.page(candidates.taskId, 'table', {}).rows[0][0].symbol, 'SZ:000001');
    await f.call('tf_task_remove', { id: row.id, revision: saved.revision });
    assert.equal((await f.rpc('tools/list')).result.tools.some(t => t.name === row.toolName), false);
    assert.equal(f.records.size, 0); assert.ok(f.reads > 0);
  } finally { await f.close(); }
});
test('P6 sample backtest traverses the production Connector and Task source adapter, not pre-parsed bars', async () => {
  const f = await fixture();
  try {
    const valid = await f.call('tf_task_validate', { source: read('sma-backtest.tft') });
    assert.equal(valid.valid, true, JSON.stringify(valid));
    const started = await f.call('tf_task_start', { draftId: valid.draftId, providerId: f.provider.providerId, universe: 'catalog', parametersJson: JSON.stringify(zeroCosts) });
    await f.manager.wait(started.taskId); assert.equal(f.manager.status(started.taskId).state, 'completed');
    const page = f.manager.page(started.taskId, 'summary');
    const equity = page.columns.findIndex(c => c.id === 'final_equity');
    assert.deepEqual(page.rows.map(r => r[equity]), [500, 1000]);
  } finally { await f.close(); }
});
for (const language of ['en', 'zh-CN']) test(`${language} AI walkthrough names only actual tools, including shorthand groups`, () => {
  const known = new Set([...createUserDataTools({}), ...createUserTaskTools({})].map(t => t.id.replaceAll('.', '_')));
  const text = readFileSync(new URL(`../docs/${language}/examples.md`, import.meta.url), 'utf8');
  for (const [, group] of text.matchAll(/`(tf_[a-z_]+(?:\/[a-z_]+)*)`/g)) {
    const [first, ...rest] = group.split('/'), prefix = first.slice(0, first.lastIndexOf('_') + 1);
    for (const name of [first, ...rest.map(suffix => prefix + suffix)]) assert.ok(known.has(name), `Unknown documented tool ${name}`);
  }
});
for (const language of ['en', 'zh-CN']) test(`${language} walkthrough and downloadable examples have valid links and explicit boundaries`, () => {
  const urls = [new URL(language === 'en' ? 'README.md' : 'README.zh-CN.md', root), new URL(`../docs/${language}/examples.md`, import.meta.url)];
  for (const url of urls) {
    const text = readFileSync(url, 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      assert.ok(existsSync(new URL(target.split('#')[0], url)), `${url}: missing ${target}`);
    }
    const terms = language === 'en' ? ['synthetic', 'short windows', 'SQLite', 'next bar open', 'Save as tool'] : ['合成', '短窗口', 'SQLite', '下一根开盘', '保存为工具'];
    for (const term of terms) assert.ok(text.includes(term), `Missing ${term}`);
  }
});
