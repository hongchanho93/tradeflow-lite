import assert from 'node:assert/strict';
import { CSV_CONNECTOR_SOURCE } from '../src/user-data/csv-example.ts';
let sequence = 0;
/** Deterministic tool planning, never a remote model or natural-language success claim. */
export function userDataAnswer(user, outputs, tools) {
  if (!user.startsWith('DESKTOP_USER_DATA ')) return null;
  const sourceId = user.split(' ')[1]; assert.match(sourceId, /^[a-f0-9]{32}$/);
  const last = name => outputs.filter(item => item.name === name).at(-1)?.value;
  const values = name => outputs.filter(item => item.name === name).map(item => item.value);
  const call = (name, input = {}) => ({ text: '', calls: [{ id: `data-${++sequence}`, name, arguments: JSON.stringify({ input }) }] });
  const ok = result => { assert.equal(result?.status, 'ok', JSON.stringify(result)); return result.data; };
  const checked = name => { const data = ok(last(name)); assert.equal(data.errorCode, undefined); return data; };
  if (!last('tf_data_guide')) return call('tf_data_guide');
  assert.match(checked('tf_data_guide').example, /defineConnector/);
  if (!last('tf_data_list')) return call('tf_data_list');
  assert.ok(checked('tf_data_list').sources.some(row => row.sourceId === sourceId));
  if (!last('tf_data_files')) return call('tf_data_files', { sourceId, limit: 2 });
  assert.equal(checked('tf_data_files').entries[0].name, 'SH_600000.csv');
  if (!last('tf_data_sample')) return call('tf_data_sample', { sourceId, path: 'SH_600000.csv' });
  assert.match(checked('tf_data_sample').content, /time,open,high,low,close,volume/);
  const validations = values('tf_data_validate');
  if (!validations.length) return call('tf_data_validate', { sourceId, source: CSV_CONNECTOR_SOURCE.replace('formatVersion:1', 'formatVersion:2') });
  const broken = ok(validations[0]); assert.equal(broken.valid, false); assert.equal(broken.extensionType, 'connector'); assert.equal(broken.stage, 'validate');
  assert.match(broken.sourceHash, /^[a-f0-9]{64}$/); assert.equal(typeof broken.errorCode, 'string');
  if (validations.length === 1) return call('tf_data_validate', { sourceId, source: CSV_CONNECTOR_SOURCE });
  const draft = ok(validations.at(-1)); assert.equal(draft.valid, true); assert.ok(draft.draftId); assert.notEqual(draft.sourceHash, broken.sourceHash);
  if (!last('tf_data_install')) return call('tf_data_install', { draftId: draft.draftId });
  checked('tf_data_install');
  const name = `user_data_${sourceId}_query`;
  assert.ok(tools.some(tool => (tool.function ?? tool).name === name), 'new source query missing from refreshed model tool list');
  const results = outputs.filter(item => item.name === name).map(item => { assert.equal(item.value.status, 'ok'); assert.equal(item.value.data.errorCode, undefined); return item.value.data; });
  if (!results.some(row => row.operation === 'catalog')) return call(name, { operation: 'catalog', limit: 1 });
  const catalog = results.find(row => row.operation === 'catalog'); assert.equal(catalog.symbols[0].symbol, 'SH:600000'); assert.ok(catalog.nextCursor);
  if (!results.some(row => row.operation === 'history')) return call(name, { operation: 'history', symbol: 'SH:600000', kind: 'stock', resolution: '1D', count: 3 });
  const history = results.find(row => row.operation === 'history'); assert.equal(history.dataset.rowCount, 3); assert.ok(history.dataset.nextCursor);
  if (!results.some(row => row.operation === 'page')) return call(name, { operation: 'page', datasetId: history.dataset.datasetId, limit: 2 });
  const page = results.find(row => row.operation === 'page'); assert.equal(page.rows.length, 2); assert.equal(page.rows[0].close, 2);
  return { text: '本地数据接入、安装和分页查询验证完成', calls: [] };
}
