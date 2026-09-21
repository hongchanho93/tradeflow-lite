/** Deterministic synthetic provider for opt-in desktop tests. Never a model
 * proxy: requests only arrive on this test's ephemeral loopback listener. */
import assert from 'node:assert/strict';
import { platformAnswer } from './ai-platform-fixture.mjs';
import { userDataAnswer } from './user-data-api-fixture.mjs';
import { userTaskAnswer } from './user-task-api-fixture.mjs';
let callNumber = 0;
let resumeFailureSent = false;
const parse = text => JSON.parse(text);
function transcript(protocol, body) {
  const messages = protocol === 'responses' ? body.input : body.messages;
  const names = new Map(); const outputs = [];
  for (const m of messages) {
    if (protocol === 'chat') {
      for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
      if (m.role === 'tool') outputs.push({ name:names.get(m.tool_call_id), value:parse(m.content) });
    } else if (protocol === 'responses') {
      if (m.type === 'function_call') names.set(m.call_id,m.name);
      if (m.type === 'function_call_output') outputs.push({name:names.get(m.call_id),value:parse(m.output)});
    } else if(Array.isArray(m.content)) {
      for(const block of m.content) {
        if(block.type==='tool_use') names.set(block.id,block.name);
        if(block.type==='tool_result') outputs.push({name:names.get(block.tool_use_id),value:parse(block.content)});
      }
    }
  }
  const user = [...messages].reverse().find(m=>m.role==='user'&&typeof m.content==='string')?.content ?? '';
  return {outputs,user};
}
function answer(protocol, body) {
  const {outputs,user} = transcript(protocol,body);
  const platform = platformAnswer(protocol, user, outputs);
  if (platform) return platform;
  const userData = userDataAnswer(user, outputs, body.tools ?? []);
  if (userData) return userData;
  const userTask = userTaskAnswer(user, outputs, body.tools ?? []);
  if (userTask) return userTask;
  const tools = body.tools ?? []; const definition = t=>t.function??t;
  if (user.startsWith('DESKTOP_DYNAMIC')) {
    const name = 'user_desktop_dynamic_value';
    if (user === 'DESKTOP_DYNAMIC_REMOVED') {
      assert.ok(!tools.some(t=>definition(t).name===name)); return {text:'动态工具移除完成',calls:[]};
    }
    assert.ok(tools.some(t=>definition(t).name===name));
    const expected=Number(user.split(' ').at(-1));
    const latest=outputs.filter(o=>o.name===name).at(-1)?.value;
    if(latest?.status==='ok'&&latest.data===expected)return {text:`动态工具验证完成 ${expected}`,calls:[]};
    return {text:'',calls:[{id:`dynamic-${++callNumber}`,name,arguments:JSON.stringify({input:{}})}]};
  }
  if(tools.some(t=>definition(t).name==='tf_api_probe')) {
    if(outputs.some(o=>o.name==='tf_api_probe')) return {text:'合成连接 OK',calls:[]};
    const tool=definition(tools[0]);const nonce=(tool.parameters??tool.input_schema).properties.nonce.enum[0];
    return {text:'',calls:[{id:`probe-${++callNumber}`,name:'tf_api_probe',arguments:JSON.stringify({nonce})}]};
  }
  if(user.startsWith('DESKTOP_READ')) {
    const previous=name=>outputs.filter(o=>o.name===name).at(-1)?.value;
    const call=(name,input)=>({text:'',calls:[{id:`read-${++callNumber}`,name,arguments:JSON.stringify(input)}]});
    for(const name of ['tf_drawings_apply','tf_drawings_apply_existing','tf_drawings_revert','tf_drawings_revert_saved'])assert.ok(tools.some(t=>definition(t).name===name));
    if(!previous('tf_context_get'))return call('tf_context_get',{});
    const context=previous('tf_context_get').context;
    if(!previous('tf_chart_snapshot'))return call('tf_chart_snapshot',{context,input:{}});
    const snapshot=previous('tf_chart_snapshot').data;assert.ok(snapshot.snapshotId);
    if(!previous('tf_compute_summary'))return call('tf_compute_summary',{context,input:{snapshotId:snapshot.snapshotId,field:'close'}});
    const summary=previous('tf_compute_summary').data;assert.ok(summary.mean>0);
    return {text:`只读验证完成：${context.instrument} / ${context.resolution}，区间均价 ${summary.mean}。`,calls:[]};
  }
  if(user==='DESKTOP_EXISTING_DELETE'||user==='DESKTOP_REVERT_SAVED') {
    const previous=name=>outputs.filter(o=>o.name===name).at(-1)?.value;
    const call=(name,input)=>({text:'',calls:[{id:`existing-${++callNumber}`,name,arguments:JSON.stringify(input)}]});
    if(!previous('tf_context_get'))return call('tf_context_get',{});
    const context=previous('tf_context_get').context;
    if(user==='DESKTOP_REVERT_SAVED'){
      if(!previous('tf_drawings_history'))return call('tf_drawings_history',{context,input:{}});
      const receipt=previous('tf_drawings_history').data.filter(r=>r.state==='applied').sort((a,b)=>b.createdAtMs-a.createdAtMs)[0];
      assert.ok(receipt);
      if(!previous('tf_drawings_revert_saved'))return call('tf_drawings_revert_saved',{context,input:{changeSetId:receipt.changeSetId}});
      assert.equal(previous('tf_drawings_revert_saved').status,'ok');
      return {text:'历史撤销验证完成。',calls:[]};
    }
    if(!previous('tf_drawings_list'))return call('tf_drawings_list',{context,input:{}});
    const existing=previous('tf_drawings_list').data.find(d=>d.ownership==='user-or-other');assert.ok(existing);
    if(!previous('tf_drawings_propose'))return call('tf_drawings_propose',{context,input:{operations:[{op:'delete',id:existing.id,version:existing.version}]}});
    const proposal=previous('tf_drawings_propose').data;assert.equal(proposal.requiresExistingPermission,true);
    if(!previous('tf_drawings_apply_existing'))return call('tf_drawings_apply_existing',{context,input:{changeSetId:proposal.changeSetId}});
    assert.equal(previous('tf_drawings_apply_existing').status,'ok');return {text:'已有绘图删除验证完成。',calls:[]};
  }
  if(!user.startsWith('DESKTOP_FLOW')) return {text:'合成回答 中文😀 <script>not executable</script>',calls:[]};
  const previous = name=>outputs.filter(o=>o.name===name).at(-1)?.value;
  const args = (name,input)=>({id:`flow-${++callNumber}`,name,arguments:JSON.stringify(input)});
  if(!previous('tf_context_get')) return {text:'',calls:[args('tf_context_get',{})]};
  const context=previous('tf_context_get').context; assert.ok(context.instrument);
  if(!previous('tf_chart_snapshot'))return {text:'',calls:[args('tf_chart_snapshot',{context,input:{}})]};
  const snapshot=previous('tf_chart_snapshot').data;assert.ok(snapshot.snapshotId);
  if(!previous('tf_compute_summary'))return {text:'',calls:[args('tf_compute_summary',{context,input:{snapshotId:snapshot.snapshotId,field:'close'}})]};
  const summary=previous('tf_compute_summary').data;assert.ok(summary.mean>0);
  if(!previous('tf_drawings_types'))return {text:'',calls:[args('tf_drawings_types',{context,input:{}})]};
  if(!previous('tf_drawings_propose'))return {text:'',calls:[args('tf_drawings_propose',{context,input:{operations:[{op:'create',drawing:{type:'HorizontalLine',points:[{time:summary.toTime,price:summary.mean}],style:{color:'#2962ff'}}}]}})]};
  const plan=previous('tf_drawings_propose').data;assert.ok(plan.changeSetId);
  if(!previous('tf_drawings_apply'))return {text:'',calls:[args('tf_drawings_apply',{context,input:{changeSetId:plan.changeSetId}})]};
  assert.equal(previous('tf_drawings_apply').status,'ok');
  if(user==='DESKTOP_FLOW_REVERT'){
    if(!previous('tf_drawings_revert'))return {text:'',calls:[args('tf_drawings_revert',{context,input:{changeSetId:plan.changeSetId}})]};
    assert.equal(previous('tf_drawings_revert').status,'ok');
  }
  return {text:'合成验证完成：读取、计算、绘图均成功。',calls:[]};
}
export async function serveFixture(req,res,{protocol,mode='ok',onRequest=()=>{}}) {
  let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;assert.ok(length<2*1024*1024);chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(body.model,'fixture');
  const header=protocol==='anthropic'?req.headers['x-api-key']:req.headers.authorization;
  assert.equal(header,protocol==='anthropic'?'tf-test-only-key':'Bearer tf-test-only-key');
  assert.ok(!JSON.stringify(body).includes('tf-test-only-key'));onRequest();
  if(mode==='401'){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"private provider detail"}');return;}
  if(mode==='redirect'){res.writeHead(302,{Location:'/must-not-follow'});res.end();return;}
  if(mode==='resume'&&!resumeFailureSent&&transcript(protocol,body).outputs.some(o=>o.name==='tf_drawings_apply')){
    resumeFailureSent=true;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"synthetic one-off failure"}');return;
  }
  if(mode==='slow'){
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': idle\n\n');
    const timer=setTimeout(()=>res.end(),30000);res.on('close',()=>clearTimeout(timer));return;
  }
  if(mode==='delayed-ok') await new Promise(resolve=>setTimeout(resolve,6000));
  // Synthetic model latency avoids a zero-latency busy poll; it never waits on
  // private task internals or turns unfinished task status into fake success.
  if (transcript(protocol, body).user.startsWith('DESKTOP_USER_TASK_')) await new Promise(resolve => setTimeout(resolve, 80));
  const {text,calls}=mode==='tool-text'
    ? {text:'<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="tf_context_get">\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>',calls:[]}
    : mode==='tool-repair'
      ? (()=>{
          const seen=transcript(protocol,body).outputs.filter(o=>o.name==='tf_context_get').map(o=>o.value);
          if(seen.some(value=>value?.status==='ok'||value?.context))return {text:'工具参数自动修复完成',calls:[]};
          if(seen.some(value=>value?.code==='invalid_request'))return {text:'',calls:[{id:`repair-${++callNumber}`,name:'tf_context_get',arguments:'{}'}]};
          return {text:'',calls:[{id:`repair-${++callNumber}`,name:'tf_context_get',arguments:'{"unexpected":1}'}]};
        })()
    : mode==='tool-loop'
      ? transcript(protocol,body).user==='LOOP_RECOVER'
        ? {text:'循环停止后继续成功',calls:[]}
        : {text:'',calls:[{id:`loop-${++callNumber}`,name:'tf_context_get',arguments:'{}'}]}
    : mode==='large-output'
      ? {text:'LARGE_OUTPUT_BEGIN\n'+'x'.repeat(5 * 1024 * 1024)+'\nLARGE_OUTPUT_END',calls:[]}
      : answer(protocol,body);
  const usage={input_tokens:10,output_tokens:5};
  let full;
  if(protocol==='chat') full={choices:[{index:0,finish_reason:calls.length?'tool_calls':'stop',message:{role:'assistant',content:text,reasoning_content:'',
    ...(calls.length?{tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}))}:{})}}],usage:{prompt_tokens:10,completion_tokens:5}};
  else if(protocol==='responses')full={status:'completed',usage,output:[{type:'reasoning',id:'r1',summary:[],encrypted_content:'fixture-ciphertext'},
    ...(text?[{type:'message',id:'m1',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]:[]),
    ...calls.map(c=>({type:'function_call',id:`fc-${c.id}`,call_id:c.id,status:'completed',name:c.name,arguments:c.arguments}))]};
  else full={type:'message',role:'assistant',stop_reason:calls.length?'tool_use':'end_turn',usage,content:[
    ...(text?[{type:'text',text}]:[]),...calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:JSON.parse(c.arguments)}))]};
  if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(full));return;}
  const events=[];const push=data=>events.push(`data: ${typeof data==='string'?data:JSON.stringify(data)}\r\n\r\n`);
  if(protocol==='chat'){
    push({choices:[{index:0,delta:{role:'assistant',content:text,reasoning_content:'',...(calls.length?{tool_calls:calls.map((c,index)=>({index,id:c.id,type:'function',function:{name:c.name,arguments:c.arguments.slice(0,4)}}))}:{})},finish_reason:null}]});
    if(calls.length)push({choices:[{index:0,delta:{tool_calls:calls.map((c,index)=>({index,function:{arguments:c.arguments.slice(4)}}))},finish_reason:null}]});
    push({choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]});push({choices:[],usage:full.usage});push('[DONE]');
  }else if(protocol==='responses'){
    if(text)push({type:'response.output_text.delta',delta:text});push({type:'response.completed',response:full});
  }else{
    push({type:'message_start',message:{usage:{input_tokens:10,output_tokens:0}}});
    full.content.forEach((b,index)=>{push({type:'content_block_start',index,content_block:b.type==='text'?{type:'text',text:''}:{...b,input:{}}});
      push({type:'content_block_delta',index,delta:b.type==='text'?{type:'text_delta',text:b.text}:{type:'input_json_delta',partial_json:JSON.stringify(b.input)}});push({type:'content_block_stop',index});});
    push({type:'message_delta',delta:{stop_reason:full.stop_reason},usage:{output_tokens:5}});push({type:'message_stop'});
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const data=Buffer.from(events.join(''));for(let i=0;i<data.length;i+=43)res.write(data.subarray(i,i+43));res.end();
}
