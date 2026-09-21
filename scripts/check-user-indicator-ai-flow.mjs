import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  USER_INDICATOR_AI_API_SUMMARY,
  USER_INDICATOR_AI_SYSTEM_PROMPT,
  USER_INDICATOR_MINIMAL_TEMPLATE,
  buildUserIndicatorAiPrompt,
  formatUserIndicatorAiDiagnostic,
} from '../src/user-indicator-runtime/ai-guide.ts';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';
import { validateUserIndicatorSource } from '../src/user-indicator-runtime/validator-engine.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureNames = [
  '01-sma.tfi',
  '02-range-pane.tfi',
  '03-marker-style.tfi',
  '04-canvas.tfi',
  '05-panel.tfi',
];

function bar(time, open, high, low, close, volume) {
  return Object.freeze({ time, open, high, low, close, volume });
}

const initialBars = Object.freeze([
  bar(1, 10, 12, 9, 11, 100),
  bar(2, 11, 13, 10, 12, 110),
  bar(3, 12, 15, 11, 14, 120),
  bar(4, 14, 15, 12, 13, 130),
]);

const initialEvent = Object.freeze({
  reason: 'initial',
  changedFrom: 0,
  barsPatch: Object.freeze({ mode: 'replace-all', bars: initialBars }),
});

const realtimeEvent = Object.freeze({
  reason: 'realtime',
  changedFrom: 3,
  barsPatch: Object.freeze({
    mode: 'replace-from',
    baseLength: initialBars.length,
    from: 3,
    bars: Object.freeze([
      bar(4, 14, 16, 12, 15, 140),
      bar(5, 15, 17, 14, 16, 150),
    ]),
  }),
  realtimeUpdates: Object.freeze([
    Object.freeze({ barTime: 4, closed: true, closedBy: 'newer-bar' }),
    Object.freeze({ barTime: 5, closed: false }),
  ]),
});

const documentedExamples = [];
for (const language of ['en', 'zh-CN']) {
  const guide = await readFile(path.join(projectRoot, 'docs', language, 'indicators.md'), 'utf8');
  const examples = [...guide.matchAll(/```tfi\n([\s\S]*?)\n```/g)].map((match, index) => ({
    name: `documented-${language}-${index + 1}`, source: match[1],
  }));
  assert.ok(examples.length >= 1, `${language} handbook must contain a complete executable .tfi example`);
  documentedExamples.push(...examples);
}
const sources = [
  ...await Promise.all(fixtureNames.map(async name => ({ name,
    source: await readFile(path.join(projectRoot, 'fixtures/user-indicators', name), 'utf8') }))),
  ...documentedExamples,
];
for (const [index, { name: fixtureName, source }] of sources.entries()) {
  const validation = await validateUserIndicatorSource(source);
  assert.equal(validation.ok, true, `${fixtureName} failed validation: ${validation.ok ? '' : validation.error.message}`);
  if (!validation.ok) continue;

  const engine = await UserIndicatorExecutionEngine.create();
  const createResponse = engine.createInstance(Object.freeze({
    protocolVersion: 1,
    type: 'create',
    instanceId: `fixture-${index + 1}`,
    generation: 1,
    requestId: 1,
    source,
    inputs: Object.freeze(Object.fromEntries(Object.entries(validation.manifest.inputs).map(([key, definition]) => [key, definition.default]))),
    context: Object.freeze({
      instanceId: `fixture-${index + 1}`,
      instrument: Object.freeze({ priceTick: 0.01, timeZone: 'UTC', tradingCalendar: '24/7' }),
      selection: Object.freeze({
        symbol: 'TEST:FIXTURE', resolution: '1', adjustment: 'none', seriesKind: 'ohlcv', marketKind: 'crypto', providerId: 'fixture',
      }),
      theme: 'dark',
    }),
    initialEvent,
  }));
  assert.equal(createResponse.type, 'success', `${fixtureName} create failed: ${createResponse.message ?? ''}`);

  const updateResponse = engine.updateInstance(Object.freeze({
    protocolVersion: 1,
    type: 'update',
    instanceId: `fixture-${index + 1}`,
    generation: 1,
    requestId: 2,
    event: realtimeEvent,
  }));
  assert.equal(updateResponse.type, 'success', `${fixtureName} realtime failed: ${updateResponse.message ?? ''}`);
  if (!engine.isPoisoned()) engine.dispose();
}

const templateValidation = await validateUserIndicatorSource(USER_INDICATOR_MINIMAL_TEMPLATE);
assert.equal(templateValidation.ok, true, 'minimal AI template must validate');

for (const forbidden of ['import/export', '网络', 'DOM', '文件系统', 'Tauri API', '原始 Canvas', 'Promise']) {
  assert.ok(USER_INDICATOR_AI_SYSTEM_PROMPT.includes(forbidden), `AI prompt is missing restriction ${forbidden}`);
}
for (const capability of ['createSeries', 'createMarkerContribution', 'createBarStyleContribution', 'createCanvasLayer', 'createPanel', 'context.data.get', 'context.data.status', 'MTF/多周期']) {
  assert.ok(USER_INDICATOR_AI_API_SUMMARY.includes(capability), `AI API summary is missing ${capability}`);
}

const generatedPrompt = buildUserIndicatorAiPrompt('画一条 20 周期均线');
assert.ok(generatedPrompt.includes('画一条 20 周期均线'));
assert.ok(generatedPrompt.includes('最终只输出完整 .tfi 源码'));
assert.ok(generatedPrompt.includes(USER_INDICATOR_MINIMAL_TEMPLATE), 'copying AI template must include a usable complete file');
assert.ok(generatedPrompt.includes('普通用户'), 'AI must optimize for a directly usable result');
assert.ok(generatedPrompt.includes('尚未实现'), 'unsupported capabilities must not be presented as permanent bans');
assert.ok(generatedPrompt.includes('现有指标的修改应保留 id'), 'AI edits must keep update identity');
assert.ok(generatedPrompt.includes('不要为了 MTF 指标切换用户当前图表周期'), 'AI must not use chart navigation as an MTF workaround');
for (const item of ['textColor', 'atPriceTop', 'lineWidth', 'paneKey', 'fillColor', 'dirtyFrom']) {
  assert.ok(USER_INDICATOR_AI_API_SUMMARY.includes(item), `copied API reference must describe ${item}`);
}

for (const language of ['en', 'zh-CN']) {
  for (const document of ['ai-guide.md', 'indicators.md', 'extensions.md']) {
    const filename = path.join(projectRoot, 'docs', language, document);
    const text = await readFile(filename, 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      await access(path.resolve(path.dirname(filename), decodeURIComponent(match[1].split('#')[0])));
    }
  }
}

const diagnostic = formatUserIndicatorAiDiagnostic({
  indicatorId: 'user.broken',
  indicatorVersion: 3,
  phase: 'update',
  code: 'runtime_exception',
  failureDetail: 'failed at file:///Users/jim/Documents/private-indicator.tfi and /tmp/secret.txt',
  logs: [{ phase: 'update', message: 'before failure at /Users/jim/private.log' }],
  line: 42,
  column: 7,
});
for (const fragment of ['user.broken v3', 'Phase: update', 'Error code: runtime_exception', 'Failure detail: failed at [path]', 'Failure callback logs:', '[update] before failure at [path]', 'Source line: 42, column: 7', 'QuickJS heap', 'realtime VM deadline', USER_INDICATOR_AI_API_SUMMARY]) {
  assert.ok(diagnostic.includes(fragment), `AI diagnostic is missing ${fragment}`);
}
assert.ok(!diagnostic.includes('/Users/jim'));
assert.ok(!diagnostic.includes('/tmp/secret.txt'));
assert.ok(!diagnostic.includes('TEST:FIXTURE'), 'AI diagnostic must not include market fixture data');
for (const capability of ['field/reason/expected/failureDetail', '没有 onPointer', 'hard timeout', '失败 callback']) {
  assert.ok((USER_INDICATOR_AI_API_SUMMARY + '\n' + USER_INDICATOR_AI_SYSTEM_PROMPT).includes(capability), `.tfi AI guide missing ${capability}`);
}

console.log('user indicator AI generation/repair flow: ok');
