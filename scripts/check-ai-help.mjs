import assert from 'node:assert/strict';
import { createAiHelpTools } from '../src/ai-capabilities/help-tools.ts';
import { USER_INDICATOR_AI_API_SUMMARY, USER_INDICATOR_AI_SYSTEM_PROMPT } from '../src/user-indicator-runtime/ai-guide.ts';

const [help]=createAiHelpTools();
assert.equal(help.id,'tf.ai.help');
for(const topic of ['overview','chart','market','indicator','drawing','data','task','files']){
  const result=help.run({topic});
  assert.equal(result.topic,topic);assert.ok(result.guide.length>80,`${topic} guide is too thin`);
}
const indicator=help.run({topic:'indicator'}).guide;
for(const phrase of ['sourceResolution','context.data.get','context.data.status','Do not change','tf_indicator_guide','retained history','BarStyle','context.log','coveredReasons','tf_indicator_draft_release','allOutputsEmpty']) assert.ok(indicator.includes(phrase),`indicator help missing ${phrase}`);
const chart=help.run({topic:'chart'}).guide;
assert.match(chart,/does not cancel|context_stale/i);
const market=help.run({topic:'market'}).guide;
assert.match(market,/tf_market_history/);assert.match(market,/do not change/i);
const drawing=help.run({topic:'drawing'}).guide;
for(const phrase of ['tf_drawings_apply_existing','does NOT show a second per-operation confirmation','clearly authorizes']) assert.ok(drawing.includes(phrase),`drawing help missing ${phrase}`);
const task=help.run({topic:'task'}).guide;
for(const phrase of ['NEW run','id+revision','providerId']) assert.ok(task.includes(phrase),`task help missing ${phrase}`);
for(const phrase of ['data?',"context.data.get('monthly')",'MTF/多周期','不要为了 MTF 指标切换用户当前图表周期','number / boolean / color / text / select','activeWhen','context.log','coveredReasons','tf_indicator_draft_release','defaultHeight']){
  assert.ok((USER_INDICATOR_AI_API_SUMMARY+'\n'+USER_INDICATOR_AI_SYSTEM_PROMPT).includes(phrase),`.tfi AI guide missing ${phrase}`);
}

console.log('AI capability help: ok');
