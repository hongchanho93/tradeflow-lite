import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequest, TurnDecoder, toolResults, API_LIMITS } from '../src/ai-api/protocol.ts';
import { ApiConversation, probeApi } from '../src/ai-api/conversation.ts';
import { CapabilityCore, CapabilityRegistry } from '../src/ai-capabilities/index.ts';

const tests = []; const test = (name, fn) => tests.push([name, fn]);
const settings = protocol => ({ protocol, endpoint: 'https://fixture.invalid/api', model: 'fixture', stream: true, tools: true,
  includeUsage: true, chatTokenField: 'max_tokens', maxTokens: 2048, timeoutSeconds: 60, allowLocalHttp: false });
const profile = protocol => ({ settings: settings(protocol), revision: 'fixture-revision', hasKey: true, remembered: false });
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const empty = schema({}); const numeric = schema({ n: { type: 'number' } });
const sampleTool = { name: 'tf_test', description: 'A synthetic tool', inputSchema: numeric };
const ev = value => ({ kind: 'event', data: typeof value === 'string' ? value : JSON.stringify(value) });
const chunk = (delta, reason = null) => ev({ choices: [{ index: 0, delta, finish_reason: reason }] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i=0; i<100; i++) { if (fn()) return; await sleep(2); } throw Error('test wait expired'); };
function complete(protocol, { text = '合成 OK', calls = [], reasoning = 'opaque-reasoning' } = {}) {
  const usage = { input_tokens: 10, output_tokens: 4 };
  if (protocol === 'chat') return { choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : 'stop',
    message: { role: 'assistant', content: text, reasoning_content: reasoning,
      ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) } }],
    usage: { prompt_tokens: 10, completion_tokens: 4 } };
  if (protocol === 'responses') return { id: 'resp-test', status: 'completed', usage,
    output: [{ type: 'reasoning', id: 'rs-1', encrypted_content: 'ciphertext-fixture', summary: [] },
      ...(text ? [{ type: 'message', id: 'msg1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }] : []),
      ...calls.map(c => ({ type: 'function_call', id: `fc-${c.id}`, status: 'completed', call_id: c.id, name: c.name, arguments: c.arguments }))] };
  return { type: 'message', role: 'assistant', stop_reason: calls.length ? 'tool_use' : 'end_turn', usage,
    content: [{ type: 'thinking', thinking: reasoning, signature: 'signed-fixture' }, ...(text ? [{ type: 'text', text }] : []),
      ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: JSON.parse(c.arguments) }))] };
}
const decode = (protocol, value) => { const d = new TurnDecoder(protocol); d.consume({ kind:'json', data: JSON.stringify(value) }); return d.finish(); };

for (const protocol of ['chat','responses','anthropic']) {
  test(`${protocol} request protocol, typed tool declarations and paired result continuation`, () => {
    const s = settings(protocol); const p = buildRequest(s, [{ role:'user',content:'fixture' }], [sampleTool], 'system');
    assert.equal(p.model,'fixture'); assert.equal(p.stream,true);
    if (protocol === 'chat') { assert.equal(p.messages[0].role,'system'); assert.equal(p.tools[0].function.parameters.additionalProperties,false); }
    if (protocol === 'responses') { assert.equal(p.instructions,'system'); assert.equal(p.store,false); assert.deepEqual([...p.include],['reasoning.encrypted_content']); assert.equal(p.tools[0].strict,false); }
    if (protocol === 'anthropic') { assert.equal(p.system,'system'); assert.equal(p.messages.length,1); assert.equal(p.tools[0].input_schema.type,'object'); }
    const call = { id: 'call-1', name:'tf_test', arguments:'{"n":3}' };
    const turn = decode(protocol,complete(protocol,{ calls:[call] })); assert.deepEqual(turn.calls,[call]);
    const continuation = buildRequest(s, [...turn.replay, ...toolResults(protocol,[{call,text:'{"n":3}',error:false}])], [sampleTool], 'system');
    assert.ok(JSON.stringify(continuation).includes('call-1'));
    assert.ok(JSON.stringify(continuation).includes(protocol==='responses'?'ciphertext-fixture':protocol==='anthropic'?'signed-fixture':'opaque-reasoning'));
    assert.deepEqual(turn.usage,{inputTokens:10,outputTokens:4});
  });
  test(`${protocol} duplicate call IDs and invalid JSON arguments never leave decoder`, () => {
    const call = { id:'dup',name:'tf_test',arguments:'{"n":1}' };
    assert.throws(()=>decode(protocol,complete(protocol,{calls:[call,call]})),/invalid_tool_call/);
    if (protocol !== 'anthropic') assert.throws(()=>decode(protocol,complete(protocol,{calls:[{...call,arguments:'{"n":'}]})));
    assert.throws(()=>decode(protocol,complete(protocol,{calls:[{...call,name:'../../write'}]})),/invalid_tool_call/);
  });
}
test('chat split arguments, interleaved calls, explicit completion and separate usage', () => {
  const d = new TurnDecoder('chat');
  d.consume(chunk({reasoning_content:'思考',content:'开始'}));
  d.consume(chunk({tool_calls:[{index:0,id:'one',type:'function',function:{name:'tf_test',arguments:'{"n":'}},{index:1,id:'two',type:'function',function:{name:'tf_test',arguments:'{"n":2'}}]}));
  d.consume(chunk({tool_calls:[{index:1,function:{arguments:'}'}},{index:0,function:{arguments:'1}'}}]}));
  d.consume(chunk({},'tool_calls')); d.consume(ev({choices:[],usage:{prompt_tokens:20,completion_tokens:9}})); d.consume(ev('[DONE]'));
  const turn = d.finish(); assert.deepEqual(turn.calls.map(c=>JSON.parse(c.arguments).n),[1,2]);
  assert.equal(turn.replay[0].reasoning_content,'思考'); assert.deepEqual(turn.usage,{inputTokens:20,outputTokens:9});
});
test('chat preserves an explicitly empty reasoning_content for compatible thinking services', () => {
  const d = new TurnDecoder('chat'); d.consume(chunk({reasoning_content:'',content:'OK'})); d.consume(chunk({},'stop')); d.consume(ev('[DONE]'));
  assert.equal(Object.hasOwn(d.finish().replay[0],'reasoning_content'),true);
});
test('thinking progress is visible without exposing private reasoning text', () => {
  const activity=[],text=[];const decoder=new TurnDecoder('chat',value=>text.push(value),value=>activity.push(value));
  decoder.consume(chunk({reasoning_content:'private reasoning'}));assert.deepEqual(activity,['thinking']);assert.deepEqual(text,[]);
  decoder.consume(chunk({content:'answer'}));decoder.consume(chunk({},'stop'));decoder.consume(ev('[DONE]'));
  assert.equal(decoder.finish().replay[0].reasoning_content,'private reasoning');assert.deepEqual(text,['answer']);assert.equal(activity.at(-1),'receiving');
});
test('truncation, length stops and error after partial tools cannot authorize execution', () => {
  const d = new TurnDecoder('chat'); d.consume(chunk({tool_calls:[{index:0,id:'x',function:{name:'tf_test',arguments:'{"n":1}'}}]}));
  assert.throws(()=>d.finish(),/stream_incomplete/); d.consume(chunk({},'length')); d.consume(ev('[DONE]')); assert.throws(()=>d.finish(),/model_output_limit/);
  const e = new TurnDecoder('chat'); e.consume(chunk({content:'partial'})); assert.throws(()=>e.consume(ev({error:{message:'sensitive raw message'}})),/provider_stream_error/);
  assert.throws(()=>new TurnDecoder('responses').finish(),/stream_incomplete/);
});
test('Responses accepts only canonical completed output and retains encrypted reasoning', () => {
  const d = new TurnDecoder('responses'); const partial = [];
  const p = new TurnDecoder('responses', t=>partial.push(t)); p.consume(ev({type:'response.output_text.delta',delta:'中文'}));
  assert.deepEqual(partial,['中文']); p.consume(ev({type:'response.completed',response:complete('responses')})); assert.equal(p.finish().replay[0].encrypted_content,'ciphertext-fixture');
  assert.throws(()=>d.consume(ev({type:'response.incomplete',response:{status:'incomplete'}})),/provider_stream_error/);
  const invalid = complete('responses'); invalid.output.push({type:'computer_call'}); assert.throws(()=>decode('responses',invalid),/unsupported_model_response/);
});
test('Anthropic delta blocks, signatures, multiline arguments and cache-inclusive usage', () => {
  const d = new TurnDecoder('anthropic');
  for(const data of [
    {type:'message_start',message:{usage:{input_tokens:2,cache_read_input_tokens:3,cache_creation_input_tokens:4}}},
    {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},
    {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'hidden'}},
    {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'signed'}},
    {type:'content_block_stop',index:0},
    {type:'content_block_start',index:1,content_block:{type:'tool_use',id:'a1',name:'tf_test',input:{}}},
    {type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{\n"n":'}},
    {type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'2}'}},
    {type:'content_block_stop',index:1},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:5}}, {type:'message_stop'},
  ]) d.consume(ev(data));
  const turn = d.finish(); assert.equal(turn.calls[0].arguments,'{"n":2}'); assert.equal(turn.replay[0].content[0].signature,'signed');
  assert.deepEqual(turn.usage,{inputTokens:9,outputTokens:5}); assert.equal(turn.text,'');
});
test('Anthropic cannot complete a message with an open tool block', () => {
  const d = new TurnDecoder('anthropic'); d.consume(ev({type:'message_start',message:{usage:{}}}));
  d.consume(ev({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'x',name:'tf_test',input:{}}}));
  assert.throws(()=>d.consume(ev({type:'message_stop'})),/stream_incomplete/);
});
test('unsupported multi-choice, oversized text, unknown usage and explicit token-field options', () => {
  const d = new TurnDecoder('chat'); assert.throws(()=>d.consume(chunk({content:'x'.repeat(API_LIMITS.textBytes+1)})),/response_too_large/);
  const unknown = complete('chat'); delete unknown.usage; assert.deepEqual(decode('chat',unknown).usage,{inputTokens:null,outputTokens:null});
  const s = {...settings('chat'),stream:false,includeUsage:false,chatTokenField:'max_completion_tokens'};
  const request = buildRequest(s,[],[],'sys'); assert.equal(request.max_completion_tokens,2048); assert.equal(request.max_tokens,undefined); assert.equal(request.stream_options,undefined);
});
test('normal long model output is not blocked by the former 256KiB/4MiB local caps', () => {
  assert.ok(API_LIMITS.textBytes >= 8 * 1024 * 1024, 'text guard is still user-facing: '+API_LIMITS.textBytes);
  assert.ok(API_LIMITS.replyBytes >= 64 * 1024 * 1024, 'reply guard is still user-facing: '+API_LIMITS.replyBytes);
  assert.doesNotThrow(() => decode('chat', complete('chat', { text: '长'.repeat(200_000), reasoning: '思考'.repeat(200_000) })));
});

function harness(respond, protocol='chat') {
  let context = {appInstanceId:'app',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
  let reads=0,writes=0,constantReads=0; const requests=[];
  const stableDataset = {type:'object',properties:{n:{type:'number'},datasetId:{type:'string'}},required:['n','datasetId'],additionalProperties:false};
  const registry = new CapabilityRegistry([
    {id:'tf.chart.snapshot',version:1,effect:'read',description:'test',inputSchema:empty,outputSchema:numeric,run:()=>({n:++reads})},
    {id:'tf.chart.constant',version:1,effect:'read',description:'stable test read',inputSchema:empty,outputSchema:stableDataset,run:()=>{constantReads++;return {n:1,datasetId:'dataset-'+constantReads};}},
    ...['tf.drawings.apply','tf.drawings.apply_existing','tf.drawings.revert','tf.drawings.revert_saved'].map(id=>
      ({id,version:1,effect:'write',description:'test',inputSchema:numeric,outputSchema:numeric,run:()=>{throw Error('wrong path');},
        prepare:input=>({result:{n:input.n},commit:()=>{writes++;},rollback:()=>{writes--;}})})),
  ]);
  const core = new CapabilityCore(registry); const host={context:()=>context,describe:()=>registry.describe(),open:permissions=>core.openSession({context,currentContext:()=>context,permissions})};
  const transport={turn:async(p,payload,signal,partial)=>{
    requests.push(payload); return respond({profile:p,payload,signal,partial,index:requests.length-1,context});
  }};
  const conversation = new ApiConversation(host,transport); conversation.reset(profile(protocol));
  const turn = (calls=[],text='OK')=>decode(protocol,complete(protocol,{calls,text}));
  const call = (name='tf_chart_snapshot',input={})=>({id:`call${requests.length}`,name,arguments:JSON.stringify({context,input})});
  return {conversation,core,requests,turn,call,transport,context:()=>context,counts:()=>({reads,writes}),constantReads:()=>constantReads,
    switch(){context={...context,selectionGeneration:context.selectionGeneration+1};conversation.invalidate();}};
}
for(const protocol of ['chat','responses','anthropic']) {
  test(`${protocol} real in-process capability tool round trip and assistant continuation`, async()=>{
    const h=harness(({index})=> index===0?h.turn([h.call()]):h.turn([], '结果已核对'),protocol);
    await h.conversation.send('read'); assert.equal(h.counts().reads,1); assert.equal(h.conversation.view().status,'completed');
    assert.ok(JSON.stringify(h.requests[1]).includes('call1')); assert.equal(h.conversation.view().usage.inputTokens,20); h.conversation.reset(); assert.equal(h.core.openSessions,0);
  });
}
test('ordinary questions use the same assistant without eagerly sending chart data',async()=>{
  const h=harness(({payload})=>{assert.ok(payload.tools.length);assert.ok(!JSON.stringify(payload).includes('SH:600000'));return h.turn();});
  await h.conversation.send('hello');assert.deepEqual(h.counts(),{reads:0,writes:0});h.conversation.reset();
});
test('one user request may continue through more than the former 12 rounds / 48 tools until the model actually finishes',async()=>{
  const target = 64;
  const h=harness(({index})=>index<target?h.turn([h.call()]):h.turn([], '长任务完成'));
  await h.conversation.send('完成一个需要很多工具往返的任务');
  assert.equal(h.counts().reads,target);
  assert.equal(h.conversation.view().failed,false);
  assert.equal(h.conversation.view().status,'completed');
  h.conversation.reset();
});
test('unchanged identical tool cycles stop locally instead of looping forever, and the same chat remains usable',async()=>{
  let h; h=harness(({index})=>index<3?h.turn([h.call('tf_chart_constant')],''):h.turn([], '已经恢复'));
  await h.conversation.send('重复调用测试');
  assert.equal(h.constantReads(),2); assert.equal(h.requests.length,3);
  assert.equal(h.conversation.view().failed,false); assert.equal(h.conversation.view().status,'completed');
  assert.equal(h.conversation.view().notice,'tool_loop_stopped');
  await h.conversation.send('继续');
  assert.equal(h.requests.length,4); assert.equal(h.conversation.view().status,'completed');
  assert.equal(h.conversation.view().messages.filter(m=>m.role==='user').length,2); h.conversation.reset();
});
test('a continuous chat is not forced into a new conversation by the former local message/history caps',async()=>{
  const h=harness(({index})=>h.turn([],'answer-'+index));
  for(let i=0;i<100;i++) await h.conversation.send('message-'+i);
  assert.equal(h.conversation.view().failed,false);
  assert.equal(h.conversation.view().messages.filter(m=>m.role==='user').length,100);
  h.conversation.reset();
});
for(const protocol of ['chat','responses','anthropic']) {
  test(`${protocol} ordinary conversation, chart reading and drawing share one continuous grant`,async()=>{
    const h=harness(({index,payload})=>{
      if(index===0)return h.turn([],'普通聊天已完成');
      assert.ok(JSON.stringify(payload).includes('普通聊天已完成'));
      if(index===1)return h.turn([h.call()]);
      if(index===2)return h.turn([],'读图已完成');
      assert.ok(JSON.stringify(payload).includes('读图已完成'));
      if(index===3)return h.turn([h.call('tf_drawings_apply',{n:1})]);
      return h.turn([],'绘图已完成');
    },protocol);
    await h.conversation.send('先聊天');await h.conversation.send('现在读图');await h.conversation.send('现在画线');
    assert.deepEqual(h.counts(),{reads:1,writes:1});assert.equal(h.core.openSessions,1);
    assert.equal(h.conversation.view().messages.filter(m=>m.role==='user').length,3);
    assert.equal(h.conversation.view().status,'completed');h.conversation.reset();
  });
}
test('a new conversation abandons interrupted work without replaying committed drawings',async()=>{
  const h=harness(({index,payload})=>{
    if(index===0)return h.turn([h.call('tf_drawings_apply',{n:4})]);
    if(index===1)throw Error('stream_disconnected');
    assert.doesNotMatch(JSON.stringify(payload),/不要重做的旧任务|tool_call_id/);return h.turn();
  });
  await h.conversation.send('不要重做的旧任务');assert.equal(h.counts().writes,1);assert.equal(h.conversation.view().canResume,true);
  h.conversation.reset(profile('chat'));assert.equal(h.core.openSessions,0);await assert.rejects(h.conversation.resume(),/not_ready/);
  await h.conversation.send('新问题');assert.equal(h.counts().writes,1);h.conversation.reset();
});
test('DSML in answer text is not a tool invocation and gets a nonfatal, non-retrying notice',async()=>{
  for(const protocol of ['chat','responses','anthropic']){
    const raw='<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="tf_context_get">\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';
    const h=harness(({index})=>h.turn([],index===0?raw:'普通回答'),protocol);
    await h.conversation.send('你能读到什么数据');
    assert.deepEqual(h.counts(),{reads:0,writes:0});assert.equal(h.requests.length,1);
    assert.equal(h.conversation.view().notice,'tool_call_text_only');assert.equal(h.conversation.view().failed,false);
    await h.conversation.send('继续');assert.equal(h.conversation.view().notice,'');h.conversation.reset();
  }
});
test('stop still prevents a late tool response from modifying any drawing',async()=>{
  let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));const running=h.conversation.send('write');await until(()=>release);
  const result=h.turn([h.call('tf_drawings_apply_existing',{n:4})]);h.conversation.cancel();release(result);await running;
  assert.equal(h.counts().writes,0);assert.equal(h.conversation.view().status,'cancelled');assert.equal(h.core.openSessions,0);
});
test('an invalid mixed tool batch executes nothing and the model can self-repair in the same turn',async()=>{
  const h=harness(({index,payload})=>{
    if(index===0)return h.turn([h.call('tf_drawings_apply',{n:1}),{id:'bad',name:'shell',arguments:'{}'}]);
    assert.ok(JSON.stringify(payload).includes('batch_rejected'));assert.ok(JSON.stringify(payload).includes('unknown_tool'));
    return h.turn([],'工具参数已自行修正');
  });
  await h.conversation.send('bad batch');assert.equal(h.counts().writes,0);assert.equal(h.requests.length,2);
  assert.equal(h.conversation.view().failed,false);assert.equal(h.conversation.view().status,'completed');
  assert.ok(h.conversation.view().messages.some(m=>m.role==='tool'&&m.text.includes('batch_rejected')));
  assert.ok(h.conversation.view().messages.some(m=>m.role==='tool'&&m.text.includes('unknown_tool')));h.conversation.reset();
});
test('invalid model tool arguments are returned to the model for automatic repair instead of failing the chat',async()=>{
  let h;h=harness(({index,payload})=>{
    if(index===0)return h.turn([{id:'bad-args',name:'tf_drawings_apply',arguments:JSON.stringify({context:h.context(),input:{n:'wrong'}})}]);
    if(index===1){const encoded=JSON.stringify(payload);assert.ok(encoded.includes('invalid_request'));assert.ok(encoded.includes('arguments.input.n'));assert.ok(encoded.includes('finite number'));return h.turn([h.call('tf_drawings_apply',{n:2})]);}
    return h.turn([],'参数已修正并完成');
  });
  await h.conversation.send('自动修参数');assert.equal(h.counts().writes,1);assert.equal(h.requests.length,3);
  assert.equal(h.conversation.view().failed,false);assert.equal(h.conversation.view().status,'completed');
  assert.ok(h.conversation.view().messages.some(m=>m.role==='tool'&&m.text.includes('invalid_request')));h.conversation.reset();
});
test('repeated unchanged invalid tool arguments stop nonfatally instead of spinning forever',async()=>{
  let h;h=harness(()=>h.turn([{id:'same-invalid',name:'tf_drawings_apply',arguments:JSON.stringify({context:h.context(),input:{n:'wrong'}})}]));
  await h.conversation.send('重复错误参数');
  assert.equal(h.requests.length,3);assert.equal(h.counts().writes,0);assert.equal(h.conversation.view().failed,false);
  assert.equal(h.conversation.view().status,'completed');assert.equal(h.conversation.view().notice,'tool_repair_stopped');
  h.conversation.reset();
});
test('manual chart changes do not abort an in-flight model turn; stale chart writes are rejected and the same task continues',async()=>{
  let release;let h;h=harness(({index})=>index===0?new Promise(r=>{release=r;}):h.turn([], '切图后任务继续完成'));
  const running=h.conversation.send('wait');await until(()=>release);
  const oldCall=h.call('tf_drawings_apply',{n:1});h.switch();h.switch();release(h.turn([oldCall]));await running;
  assert.equal(h.counts().writes,0);assert.equal(h.requests.length,2);assert.equal(h.conversation.view().status,'completed');assert.equal(h.conversation.view().failed,false);
  assert.ok(h.conversation.view().messages.some(m=>m.role==='tool'&&m.text.includes('context_stale')));
  assert.ok(h.conversation.view().messages.some(m=>m.role==='assistant'&&m.text==='切图后任务继续完成'));
  let release2;const g=harness(()=>new Promise(r=>{release2=r;}));const old=g.conversation.send('private old conversation');await until(()=>release2);
  g.conversation.reset({...profile('chat'),revision:'new',settings:{...settings('chat'),endpoint:'https://different.invalid'}});release2(g.turn([], 'old response'));await old;
  assert.deepEqual(g.conversation.view().messages,[]);assert.equal(g.core.openSessions,0);
});
test('manual chart change while the provider is thinking does not cancel a text-only answer',async()=>{
  let release;const h=harness(()=>new Promise(r=>{release=r;}));const running=h.conversation.send('分析原任务');await until(()=>release);
  h.switch();release(h.turn([], '继续完成原任务'));await running;
  assert.equal(h.requests.length,1);assert.equal(h.conversation.view().status,'completed');assert.equal(h.conversation.view().failed,false);
  assert.ok(h.conversation.view().messages.some(m=>m.role==='assistant'&&m.text==='继续完成原任务'));h.conversation.reset();
});
test('manual chart switch keeps the same conversation and rebinds the next chart tool call to the new selection',async()=>{
  const h=harness(({index})=>{
    if(index===0)return h.turn([], '第一个品种的说明');
    if(index===1)return h.turn([h.call()]);
    return h.turn([], '第二个品种已读取');
  });
  await h.conversation.send('先看这个品种');
  const before=h.conversation.snapshot();
  h.switch();
  assert.equal(h.conversation.view().failed,false);
  assert.equal(h.conversation.view().status,'chart_changed');
  await h.conversation.send('继续看切换后的品种');
  assert.equal(h.counts().reads,1);
  assert.equal(h.conversation.view().status,'completed');
  assert.equal(h.conversation.view().messages.filter(m=>m.role==='user').length,2);
  assert.equal(h.conversation.view().messages[1].text,before.messages[1].text);
  h.conversation.reset();
});
test('conversation snapshot restores visible history but never restores old chart authority',async()=>{
  const first=harness(()=>h.turn([], '保存的回复'));await first.conversation.send('保存的问题');
  const snapshot=first.conversation.snapshot();first.conversation.reset();
  const second=harness(({index})=>index===0?second.turn([second.call()]):second.turn([], '重新读取完成'));
  second.conversation.restore(profile('chat'),snapshot);
  assert.equal(second.core.openSessions,0);
  assert.equal(second.conversation.view().messages[0].text,'保存的问题');
  await second.conversation.send('继续');
  assert.equal(second.counts().reads,1);
  assert.equal(second.conversation.view().messages.filter(m=>m.role==='user').length,2);
  second.conversation.reset();
});
test('a failed model turn never retries itself and never bricks the conversation',async()=>{
  let h;h=harness(({index})=>{if(index===0)throw Error('authentication_failed');return h.turn([], '恢复成功');});
  await h.conversation.send('one');
  assert.equal(h.requests.length,1);assert.equal(h.conversation.view().failed,true);assert.equal(h.core.openSessions,0);
  await h.conversation.send('two');
  assert.equal(h.requests.length,2);assert.equal(h.conversation.view().failed,false);assert.equal(h.conversation.view().status,'completed');
  assert.equal(h.conversation.view().messages.filter(m=>m.role==='user').length,2);h.conversation.reset();
});
test('temporary disconnect preserves history and only retries on an explicit resume',async()=>{
  const h=harness(({index,partial})=>{if(index===1){partial('未完成的回复');throw Error('stream_disconnected');}return h.turn([],`answer-${index}`);});
  await h.conversation.send('first');await h.conversation.send('second');
  assert.equal(h.requests.length,2);assert.equal(h.conversation.view().canResume,true);
  assert.equal(h.conversation.view().messages.at(-1).incomplete,true);
  await h.conversation.resume();assert.equal(h.requests.length,3);assert.equal(h.conversation.view().failed,false);
  assert.deepEqual(h.requests[2].messages.filter(m=>m.role==='user').map(m=>m.content),['first','second']);
  assert.ok(!JSON.stringify(h.requests[2]).includes('未完成的回复'));h.conversation.reset();
});
for (const code of ['provider_internal_error','provider_bad_gateway','provider_overloaded','provider_gateway_timeout','provider_unavailable']) {
  test(`${code} preserves the exact task for explicit resume and never retries automatically`,async()=>{
    let h;h=harness(({index})=>{if(index===0)throw Error(code);return h.turn([], '恢复完成');});
    await h.conversation.send('provider temporary failure');
    assert.equal(h.requests.length,1);assert.equal(h.conversation.view().failed,true);assert.equal(h.conversation.view().canResume,true);
    await h.conversation.resume();assert.equal(h.requests.length,2);assert.equal(h.conversation.view().failed,false);assert.equal(h.conversation.view().status,'completed');
    h.conversation.reset();
  });
}
test('resume after a committed drawing does not replay its tool call',async()=>{
  const h=harness(({index})=>{if(index===0)return h.turn([h.call('tf_drawings_apply',{n:7})]);if(index===1)throw Error('request_timeout');return h.turn();});
  await h.conversation.send('draw');assert.equal(h.counts().writes,1);assert.equal(h.conversation.view().canResume,true);
  await h.conversation.resume();assert.equal(h.counts().writes,1);assert.equal(h.conversation.view().status,'completed');
  assert.ok(h.requests[2].messages.some(m=>m.role==='tool'));h.conversation.reset();
});
test('chart changes preserve an explicitly resumable model request; user cancel still discards it',async()=>{
  let switched;switched=harness(({index})=>{if(index===0)throw Error('request_timeout');return switched.turn([], '切图后恢复完成');});
  await switched.conversation.send('read');assert.equal(switched.conversation.view().canResume,true);switched.switch();
  assert.equal(switched.conversation.view().canResume,true);await switched.conversation.resume();assert.equal(switched.conversation.view().status,'completed');switched.conversation.reset();
  const cancelled=harness(()=>{throw Error('request_timeout');});await cancelled.conversation.send('read');
  assert.equal(cancelled.conversation.view().canResume,true);cancelled.conversation.cancel();assert.equal(cancelled.conversation.view().canResume,false);
  await assert.rejects(cancelled.conversation.resume(),/not_ready/);assert.equal(cancelled.core.openSessions,0);
});
test('synthetic capability probe validates echo without opening chart capabilities',async()=>{
  let i=0;
  const transport={turn:async(p,payload)=>{
    i++; if(i===2){const nonce=payload.tools[0].function.parameters.properties.nonce.enum[0];return decode('chat',complete('chat',{calls:[{id:'probe',name:'tf_api_probe',arguments:JSON.stringify({nonce})}]}));}
    assert.ok(!JSON.stringify(payload).includes('SH:600000'));return decode('chat',complete('chat'));
  }};
  assert.deepEqual(await probeApi(profile('chat'),transport,new AbortController().signal),{chat:true,streaming:true,toolRoundTrip:true});assert.equal(i,3);
});
test('stopping after a completed turn closes the old tool session but never requires a new conversation',async()=>{
  let h;h=harness(()=>h.turn());await h.conversation.send('read');h.conversation.cancel();
  assert.equal(h.conversation.view().failed,false);assert.equal(h.conversation.view().status,'cancelled');assert.equal(h.core.openSessions,0);
  await h.conversation.send('again');assert.equal(h.conversation.view().status,'completed');assert.equal(h.requests.length,2);h.conversation.reset();
});
test('chat refusal text is visible instead of a misleading empty response',()=>{
  const r=complete('chat');r.choices[0].message.content=null;r.choices[0].message.refusal='Declined';assert.equal(decode('chat',r).text,'Declined');
});
test('completed tool-only assistant turns do not leave blank message bubbles',async()=>{
  const h=harness(({index})=>index===0?h.turn([h.call()],''):h.turn());await h.conversation.send('read');
  assert.ok(!h.conversation.view().messages.some(m=>m.role==='assistant'&&!m.text));h.conversation.reset();
});
test('provider cannot replay an old call ID to execute a second mutation',async()=>{
  const h=harness(()=>h.turn([{...h.call('tf_drawings_apply',{n:1}),id:'same-call'}]));
  await h.conversation.send('write');assert.equal(h.counts().writes,1);assert.equal(h.conversation.view().status,'invalid_tool_call');
});
test('long token stream retains the exact text without repeatedly encoding its whole prefix',()=>{
  const decoder=new TurnDecoder('chat');const frame=chunk({content:'中'});const started=performance.now();
  for(let i=0;i<12000;i++)decoder.consume(frame);
  decoder.consume(chunk({},'stop'));decoder.consume(ev('[DONE]'));assert.equal(decoder.finish().text,'中'.repeat(12000));
  console.log(`API 12,000-delta decode: ${(performance.now()-started).toFixed(1)}ms (Node, not desktop latency)`);
});
for(const protocol of ['chat','responses','anthropic']) {
  test(`${protocol} single assistant exposes all current chart capabilities on the first message without selecting a mode`,async()=>{
    const h=harness(({index,payload})=>{
      const names=payload.tools.map(t=>t.function?.name??t.name);
      for(const name of ['tf_context_get','tf_chart_snapshot','tf_drawings_apply','tf_drawings_apply_existing','tf_drawings_revert','tf_drawings_revert_saved'])assert.ok(names.includes(name),name);
      const system=protocol==='chat'?payload.messages[0].content:protocol==='responses'?payload.instructions:payload.system;
      assert.doesNotMatch(system,/仅聊天|分析图表|辅助绘图|自动绘图|no tools|read and compute only/i);
      return index===0?h.turn([h.call()]):h.turn();
    },protocol);
    assert.equal(h.requests.length,0);assert.equal(h.core.openSessions,0);
    await h.conversation.send('你能读到什么数据');assert.equal(h.counts().reads,1);
    assert.equal(h.conversation.view().status,'completed');h.conversation.reset();
  });
}
test('single assistant automatically executes all four registered chart write capabilities',async()=>{
  const names=['tf_drawings_apply','tf_drawings_apply_existing','tf_drawings_revert','tf_drawings_revert_saved'];
  const h=harness(({index})=>index<names.length?h.turn([h.call(names[index],{n:index})]):h.turn());
  const run=h.conversation.send('按我的要求修改并撤销绘图');
  // Reject unexpected approval without hanging the test or granting it.
  const timer=setInterval(()=>{for(const a of h.conversation.view().approvals)h.conversation.approve(a.id,false);},2);
  try{await run;assert.equal(h.counts().writes,4);assert.equal(h.conversation.view().status,'completed');}
  finally{clearInterval(timer);h.conversation.reset();}
});
test('legacy tools=false cannot create a hidden chat-only assistant',async()=>{
  const h=harness(({index,payload})=>{assert.ok(payload.tools.length);return index===0?h.turn([h.call()]):h.turn();});
  const old={...profile('chat'),settings:{...settings('chat'),tools:false}};h.conversation.reset(old);
  await h.conversation.send('读取数据');assert.equal(h.counts().reads,1);assert.equal(old.settings.tools,false);h.conversation.reset();
});
test('single assistant UI has no mode, persistence or permission switches',()=>{
  const read=f=>readFileSync(new URL(`../src/ai-api/${f}`,import.meta.url),'utf8');
  for(const file of ['page.ts','controller.ts'])assert.doesNotMatch(read(file),/api-mode(?:-hint|['"])|api-tools|setMode|ChatMode/);
  assert.match(read('controller.ts'),/tools:\s*true/);
  assert.doesNotMatch(read('page.ts'),/api-consent|api-remember|连接管理与测试|权限与会话说明/);
});
test('UI and transport never store credentials or execute model HTML/code',()=>{
  const read=f=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
  for(const file of ['src/ai-api/controller.ts','src/ai-api/conversation.ts','src/ai-api/transport.ts']) {
    const source=read(file);assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|eval\(|new Function|fetch\(|innerHTML\s*=/);
  }
  assert.match(read('src/ai-api/transport.ts'),/if \(signal.aborted\) throw new Error\('cancelled'\)/);
  assert.doesNotMatch(read('src/ai-api/page.ts'),/id="api-consent"|id="api-remember"/);
});

let failures=0;for(const[name,fn]of tests){try{await fn();}catch(e){failures++;console.error(`FAIL ${name}`,e);}}
if(failures)throw Error(`API: ${failures}/${tests.length} failed`);
console.log(`AI API protocols and conversations: ${tests.length} scenarios passed`);
