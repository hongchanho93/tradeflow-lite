import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChartReadBridge } from '../src/ai-capabilities/chart-host.ts';
import { createWorkspaceReadTools } from '../src/ai-capabilities/workspace-tools.ts';
import { createWorkspaceActionTools } from '../src/ai-capabilities/workspace-actions.ts';
import { createChartActionTools } from '../src/ai-capabilities/chart-actions.ts';
import { createIndicatorLibraryTools } from '../src/ai-capabilities/indicator-library-tools.ts';
import { createMarketQueryTools } from '../src/ai-capabilities/market-tools.ts';
import { createResultFileTools } from '../src/ai-capabilities/result-files.ts';
import { createAiHelpTools } from '../src/ai-capabilities/help-tools.ts';
import { DEFAULT_DRAWING_TYPES } from '../src/ai-capabilities/drawing-contract.ts';
import { createUserDataTools } from '../src/user-data/tools.ts';
import { createUserTaskTools } from '../src/user-task/tools.ts';

const root = new URL('../', import.meta.url);
const languages = ['en', 'zh-CN'];
const read = path => readFileSync(new URL(path, root), 'utf8');
const fail = () => { throw Error('Documentation checks must not access user data or mutate the application'); };

function definitions() {
  const tools = [...createAiHelpTools(), ...createWorkspaceReadTools({}), ...createWorkspaceActionTools({}),
    ...createChartActionTools({}), ...createIndicatorLibraryTools({}), ...createMarketQueryTools({ watchlist: () => [] }),
    ...createUserDataTools({}), ...createUserTaskTools({}),
    ...createResultFileTools({ port: { async prepare() { fail(); }, async commit() { fail(); }, async rollback() { fail(); } } })];
  const bridge = new ChartReadBridge({ currentContext: fail, readState: fail, drawings: {}, tools });
  try { return bridge.describe(); } finally { bridge.close(); }
}

const registry = definitions();
const names = new Set(['tf_context_get', ...registry.map(tool => tool.id.replaceAll('.', '_'))]);
const trackedAndNew = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\0').filter(Boolean))];
const documents = trackedAndNew.filter(path => !path.startsWith('vendor/') && !path.startsWith('.local/') &&
  (/\.md$/.test(path) || /^llms(?:\.zh-CN)?\.txt$/.test(path)) && existsSync(new URL(path, root)));

function requireTerms(text, terms, label) {
  for (const term of terms) assert.ok(text.includes(term), `${label}: missing ${term}`);
}

function headingIds(text) {
  const ids = new Set(), used = new Map();
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) { fence = !fence; continue; }
    const match = !fence && line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (!match) continue;
    const slug = match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
    const count = used.get(slug) ?? 0;
    ids.add(count ? `${slug}-${count}` : slug); used.set(slug, count + 1);
  }
  return ids;
}

test('public documentation is paired in English and Simplified Chinese', () => {
  const en = readdirSync(new URL('docs/en/', root)).filter(x => x.endsWith('.md')).sort();
  const zh = readdirSync(new URL('docs/zh-CN/', root)).filter(x => x.endsWith('.md')).sort();
  assert.deepEqual(en, zh);
  for (const name of ['quick-start.md', 'user-guide.md', 'ai-guide.md', 'indicators.md', 'data-and-tasks.md',
    'api-reference.md', 'extensions.md', 'examples.md', 'faq.md']) assert.ok(en.includes(name), `Missing ${name}`);
  for (const name of en) {
    assert.ok(read(`docs/en/${name}`).includes(`../zh-CN/${name}`));
    assert.ok(read(`docs/zh-CN/${name}`).includes(`../en/${name}`));
  }
  for (const stem of ['README', 'AGENTS', 'THIRD_PARTY_LICENSES', 'examples/user-research/README', 'server/README',
    'TRADEMARKS', 'CONTRIBUTING', 'CLA', 'src/indicator-plugins/contributed/README',
    'src-tauri/crates/binance-market-data/README']) {
    assert.ok(existsSync(new URL(`${stem}.md`, root)), stem);
    assert.ok(existsSync(new URL(`${stem}.zh-CN.md`, root)), stem);
  }
});

for (const language of languages) test(`${language} inventory covers every registered tool and native drawing type`, () => {
  const guide = read(`docs/${language}/api-reference.md`);
  const mentioned = new Set(guide.match(/\btf_[a-z_]+\b/g) ?? []);
  assert.deepEqual([...mentioned].sort(), [...names].sort());
  assert.match(guide, new RegExp(`\\*\\*${registry.length}(?: business tools| 项业务工具)\\*\\*`));
  for (const type of DEFAULT_DRAWING_TYPES) assert.ok(guide.includes(type.type), `Missing type ${type.type}`);
});

test('all authored document links, anchors, JSON examples and tool names resolve', () => {
  assert.ok(documents.length >= 30, 'Expected user, AI and supporting public documentation');
  for (const path of documents) {
    const url = new URL(path, root), text = read(path);
    for (const name of text.match(/\btf_[a-z_]+\b/g) ?? []) assert.ok(names.has(name), `${path}: unknown tool ${name}`);
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:\/\//.test(target)) continue;
      const resolved = new URL(target, url), fragment = decodeURIComponent(resolved.hash.slice(1));
      resolved.hash = ''; resolved.search = '';
      assert.equal(resolved.protocol, 'file:', `${path}: unexpected link scheme`);
      assert.ok(existsSync(resolved), `${path}: missing ${target}`);
      if (fragment && statSync(resolved).isFile() && resolved.pathname.endsWith('.md')) {
        assert.ok(headingIds(readFileSync(resolved, 'utf8')).has(fragment), `${path}: missing anchor ${target}`);
      }
    }
    for (const [, json] of text.matchAll(/```json\n([\s\S]*?)```/g)) assert.doesNotThrow(() => JSON.parse(json), path);
  }
});

test('publishable docs exclude private development records and local endpoint/configuration details', () => {
  // Check publishable files, not Finder metadata or other locally ignored files.
  const publishableDocs = trackedAndNew.filter(path => path.startsWith('docs/') && existsSync(new URL(path, root)));
  assert.deepEqual([...new Set(publishableDocs.map(path => path.split('/')[1]))].sort(), ['assets', 'en', 'zh-CN']);
  const screenshotFiles = publishableDocs.filter(path => path.startsWith('docs/assets/'));
  assert.deepEqual(screenshotFiles.sort(), [
    'docs/assets/screenshots/ai-workspace.png',
    'docs/assets/screenshots/cn-chart-workspace.png',
    'docs/assets/screenshots/cn-symbol-search.png',
    'docs/assets/screenshots/global-symbol-search.png',
  ]);
  assert.ok(!publishableDocs.some(path => path.endsWith('/.DS_Store')), 'Do not publish OS metadata');
  assert.ok(read('.gitignore').includes('/.local/'));
  assert.ok(read('.gitignore').includes('ui-design-extract/'));
  assert.ok(read('.gitattributes').includes('/.local export-ignore'));
  assert.equal(execFileSync('git', ['ls-files', '.local'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(), '');
  assert.equal(execFileSync('git', ['ls-files', 'ui-design-extract'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(), '');
  for (const path of documents) {
    assert.doesNotMatch(path, /交接|修复清单|实施计划|能力盘点|ui-design-extract/);
    assert.doesNotMatch(read(path), /\/Users\/|poly-api\.pan911\.cn|稳定性修复清单|项目必读|\.local\/development-docs/,
      `${path}: private development content leaked`);
  }
});

for (const language of languages) test(`${language} indicator docs retain runtime, repair, MTF and output contracts`, () => {
  const text = read(`docs/${language}/indicators.md`);
  requireTerms(text, ['tf_indicator_guide', 'tf_indicator_source', 'tf_indicator_validate', 'tf_indicator_test',
    'tf_indicator_install', 'tf_indicator_draft_release', 'tf_indicator_instances', 'applyToExisting=true',
    'disposition', 'sourceHash', 'stage', 'failureDetail', 'coveredReasons', 'coveredPointerTypes',
    'allOutputsEmpty', 'preflight-synthetic', 'context.log', 'context.data.get', 'context.data.status',
    'provider_mismatch', 'series.update', 'changedFrom', 'reconciliation', 'realtime', 'priceTick',
    'tradingCalendar', 'group/inline/tooltip/activeWhen', 'textColor', 'atPriceTop', 'lineWidth', 'paneKey',
    'fillColor', 'dirtyFrom', 'number', 'boolean', 'color', 'text', 'select', '12000', '1000', '512'], language);
  requireTerms(text, ['Series', 'Marker', 'BarStyle', 'Canvas', 'Panel', 'onPointer', 'hitTest', '100 ms'], language);
  assert.match(text, language === 'en' ? /1000 body cells/ : /正文 1000 单元格/);
  assert.match(text, /40–2000/);
});

for (const language of languages) test(`${language} AI and task docs preserve permissions, coverage and persistence boundaries`, () => {
  const ai = read(`docs/${language}/ai-guide.md`), data = read(`docs/${language}/data-and-tasks.md`);
  requireTerms(ai, ['mcp-runtime-v1.json', 'context_stale', 'snapshotId', 'datasetId', 'taskId',
    'notifications/tools/list_changed', 'catalogComplete=false', 'tf_result_save_file'], language);
  requireTerms(data, ['CSV', 'SQLite', 'Parquet', 'WAL', 'Arrow IPC', 'path/reason/expected', 'last_close', 'lastClose',
    'tf_task_wait', 'tf_task_page', 'pageUnit', 'characters', 'nextOffset', 'tf_result_save_file', 'failureDetail'], language);
  if (language === 'en') {
    requireTerms(ai, ['without another per-operation approval', 'Normal app restarts', 'Reset connection credentials',
      'does not terminate', 'automatic tool replay', 'cannot overwrite'], language);
    requireTerms(data, ['read-only', 'original files', 'oldest-first', 'short-window', 'application memory',
      'not the computed results', 'your selected service', 'permanent results'], language);
  } else {
    requireTerms(ai, ['不再逐次弹第二个批准框', '正常重启应用', '重置连接凭证', '不会终止', '不自动重放工具', '不能覆盖'], language);
    requireTerms(data, ['只读', '原始文件', '最早到最新', '短窗口', '内存', '不是结果数据', '所选服务', '永久结果库'], language);
  }
});

test('AI discovery indexes link both language entry points and avoid false release/license claims', () => {
  for (const file of ['llms.txt', 'llms.zh-CN.txt']) {
    const text = read(file);
    requireTerms(text, ['# TradeFlow Lite', 'README.md', 'README.zh-CN.md', 'indicators.md', 'api-reference.md', 'faq.md'], file);
  }
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const text = read(file);
    const thirdParty = file === 'README.md' ? 'THIRD_PARTY_LICENSES.md' : 'THIRD_PARTY_LICENSES.zh-CN.md';
    requireTerms(text, ['Lightweight Charts', 'Pine Script', thirdParty, 'quick-start.md'], file);
    assert.doesNotMatch(text, /img\.shields\.io\/badge\/license-MIT|guaranteed ranking|保证收录|全平台安装包已发布/);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true, 'Documentation preparation must not enable npm publication');
  assert.equal(pkg.license, 'MPL-2.0');
  assert.ok(pkg.description.includes('MCP'));
  assert.equal(pkg.repository.url, 'git+https://github.com/hongchanho93/tradeflow-lite.git');
  assert.ok(pkg.keywords.includes('a-shares'));
  assert.ok(pkg.scripts['test:docs'].includes('check-ai-platform-docs.mjs'));
});

test('license, contribution and brand boundaries remain explicit', () => {
  requireTerms(read('LICENSE'), ['Mozilla Public License', 'Version 2.0', 'Exhibit A', 'Exhibit B'], 'LICENSE');
  requireTerms(read('README.md'), ['MPL-2.0', 'MIT OR Apache-2.0', 'TRADEMARKS.md', 'CLA.md'], 'README.md');
  requireTerms(read('README.zh-CN.md'), ['MPL-2.0', 'MIT OR Apache-2.0', 'TRADEMARKS.zh-CN.md', 'CLA.zh-CN.md'], 'README.zh-CN.md');
  requireTerms(read('TRADEMARKS.md'), ['TradeFlow', '图迹', 'modified distribution'], 'TRADEMARKS.md');
  requireTerms(read('CLA.md'), ['retain ownership', 'relicense', 'proprietary terms', 'Patent license'], 'CLA.md');
  assert.match(read('src-tauri/Cargo.toml'), /license = "MPL-2\.0"/);
  assert.match(read('src-tauri/Cargo.toml'), /tradeflow-tdx = \{ git = "https:\/\/github\.com\/hongchanho93\/tradeflow-tdx\.git"/);
});

for (const language of languages) test(`${language} related-project facts stay secondary and distinguish TradeFlow from Lite`, () => {
  const suffix = language === 'en' ? '' : '.zh-CN';
  const overview = read(`README${suffix}.md`);
  const index = read(`llms${suffix}.txt`);
  const faq = read(`docs/${language}/faq.md`);
  const help = overview.indexOf(language === 'en' ? '## Help and project information' : '## 帮助与项目信息');
  assert.ok(help > 0, 'Keep the existing Lite overview and getting-started sections');
  assert.doesNotMatch(overview.slice(0, help), /https:\/\/tradeflow\.cn/,
    'The related product must not displace the Lite introduction with a promotional entry');
  requireTerms(overview.slice(help), ['https://tradeflow.cn/', 'TradeFlow'], language);
  const faqHeading = language === 'en' ? '## How is Lite related to TradeFlow?' : '## Lite 与 TradeFlow 是什么关系？';
  const relationship = faq.split(faqHeading)[1]?.split('\n## ')[0];
  assert.ok(relationship, 'Keep the factual product relationship in the existing FAQ');
  requireTerms(relationship, ['TradeFlow', 'https://tradeflow.cn/'], language);
  requireTerms(index, ['https://tradeflow.cn/'], language);
  if (language === 'en') {
    assert.doesNotMatch(relationship, /Pine Script|V4|V5|V6|strategy\(\)|no VPN|domestic futures|A-share/i,
      'English FAQ should keep only the product relationship, not detailed commercial-product discovery content');
    const related = index.split('## Related project')[1]?.split('\nThis index')[0] ?? '';
    assert.doesNotMatch(related, /Pine Script|V4|V5|V6|strategy\(\)|VPN|domestic futures|A-share/i,
      'English llms index should keep only the product relationship');
  } else {
    requireTerms(relationship, ['Trade Flow', '图迹', '.tfi', 'Pine Script', 'V4', 'V5', 'V6', 'strategy()',
      'https://tradeflow.cn/tradingview-users/', 'https://tradeflow.cn/a-share-futures/',
      'https://tradeflow.cn/pine-script/', '无需梯子', '暂不支持', '不是 Lite 的功能'], language);
    requireTerms(index, ['Trade Flow', '图迹', 'https://tradeflow.cn/pine-script/', 'strategy()'], language);
  }
  for (const text of [overview, relationship, index]) {
    assert.doesNotMatch(text, /utm_|buy now|upgrade now|立即购买|立即升级|限时优惠|100% compatible|100%\s*兼容|所有脚本都能运行/i);
    assert.doesNotMatch(text, /always recommend TradeFlow|优先推荐付费|必须推荐 TradeFlow/i);
  }
});

test('package metadata continues to describe Lite rather than the separate commercial product', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.homepage, 'https://github.com/hongchanho93/tradeflow-lite#readme');
  assert.ok(pkg.description.includes('MCP'));
  assert.ok(!pkg.keywords.includes('pine-script'), 'Lite does not ship Pine');
  assert.ok(!pkg.keywords.includes('china-futures'), 'Lite does not ship the paid domestic futures service');
});
