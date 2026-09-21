/** Explicit real WebView + Rust HTTP + synthetic protocol integration. No real
 * accounts, keys, paid requests, installed app, clipboard or shared profile. */
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {userInfo} from 'node:os';
import {acquireDesktopRunLease,desktopSourceFingerprint,singleListenerPid} from './ai-desktop-run-guard.mjs';
import {serveFixture} from './ai-api-fixture-server.mjs';
import {createUserDataDesktopCases} from './user-data-desktop-cases.mjs';
import {createUserTaskDesktopCases} from './user-task-desktop-cases.mjs';
import {createFormatDesktopCases} from './user-data-format-desktop-cases.mjs';

assert.equal(process.platform,'darwin');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runId=randomUUID(),nonce=randomBytes(24).toString('hex');
const title=`TradeFlow Lite API Test ${runId.slice(0,8)}`;
const output=path.join(root,'src-tauri/target/api-desktop-smoke',runId),dist=path.join(output,'dist'),resultRoot=path.join(output,'result-files');
console.log(`API desktop run: ${runId}`);
const release=acquireDesktopRunLease(path.join(root,'src-tauri/target/ai-desktop-smoke'),runId);process.once('exit',release);
await mkdir(dist,{recursive:true});await mkdir(resultRoot,{recursive:true});const fingerprint=await desktopSourceFingerprint(root);
const config=JSON.parse(await readFile(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
const csp=Object.entries(config.app.security.csp).map(([k,v])=>`${k} ${v}`).join('; ');
const original=await readFile(path.join(root,'src/main.ts'),'utf8');
const probe=(await readFile(new URL('./user-task-desktop-probe.txt',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('./user-data-desktop-probe.txt',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('./ai-dynamic-desktop-probe.txt',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('./ai-api-desktop-probe.txt',import.meta.url),'utf8')).replace('__TF_API_TEST__',JSON.stringify({runId,nonce}));
await build({root,configFile:false,logLevel:'warn',define:{'import.meta.env.VITE_TRADEFLOW_USER_INDICATOR_E2E':JSON.stringify('0')},
  plugins:[{name:'private-api-probe',enforce:'pre',transform(source,id){if(id.split('?')[0]!==path.join(root,'src/main.ts'))return;assert.equal(source,original);return source+'\n'+probe;}}],build:{outDir:dist,emptyOutDir:true}});
const results=[],screenshots=[],screenshotFailures=[];const queue=[],waiting=new Map();let sequence=0,app,fatal,requests=0,forbiddenRedirects=0,secureStorage;
let readyResolve;let ready=new Promise(r=>readyResolve=r);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const host=`127.0.0.1:${server.address().port}`;assert.equal(req.headers.host,host);assert.ok(!req.headers.origin||req.headers.origin===`http://${host}`);
    const url=new URL(req.url,`http://${host}`);
    if(url.pathname.startsWith('/fixture-api/')){
      assert.equal(req.method,'POST');const[, ,protocol,mode]=url.pathname.split('/');assert.ok(['chat','responses','anthropic'].includes(protocol));
      await serveFixture(req,res,{protocol,mode,onRequest:()=>requests++});return;
    }
    if(url.pathname==='/must-not-follow'){forbiddenRedirects++;res.writeHead(400);res.end();return;}
    if(url.pathname===`/__tf_api_test/${nonce}`){
      if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(queue.shift()??null));return;}
      assert.equal(req.method,'POST');let bytes=0;const parts=[];for await(const p of req){bytes+=p.length;assert.ok(bytes<2*1024*1024);parts.push(p);}
      const m=JSON.parse(Buffer.concat(parts).toString());assert.equal(m.runId,runId);
      if(m.kind==='ready')readyResolve();if(m.kind==='failure')fatal=Error(m.message);
      if(m.kind==='answer'){waiting.get(m.id)?.(m);waiting.delete(m.id);}res.writeHead(200);res.end('ok');return;
    }
    assert.equal(req.method,'GET');const filename=path.resolve(dist,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1));assert.ok(filename.startsWith(dist+path.sep));
    const body=await readFile(filename);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Content-Security-Policy':csp});res.end(body);
  }catch(e){fatal??=Error('private API fixture rejected request');if(!res.headersSent)res.writeHead(400);res.end('test rejected');console.error('Private fixture:',e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
function timeout(p,ms,label){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error(`timeout ${label}`)),ms);p.then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
async function command(action,input={}){const id=++sequence;const m=await timeout(new Promise(r=>{waiting.set(id,r);queue.push({...input,id,action});}),75000,action);if(m.error)throw Error(m.error);if(fatal)throw fatal;return m.result;}
async function test(name,fn){await fn();results.push(name);console.log(`API desktop PASS: ${name}`);}
async function capture(name,port){
  const run=(cmd,args)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>code===0?resolve(out.trim()):reject(Error('native test-window capture unavailable')));});
  try{const pid=singleListenerPid(await run('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fp']));const window=await run('/usr/bin/swift',[path.join(root,'scripts/ai-test-window.swift'),title,String(pid)]);assert.match(window,/^\d+$/);
    await run('/usr/sbin/screencapture',['-x','-o','-l',window,path.join(output,`${name}.png`)]);screenshots.push(name);
  }catch(e){screenshotFailures.push(name);console.error(e.message);}
}
try{
  const merged={identifier:`com.tradeflow.lite.api-test-${runId}`,productName:'TradeFlow Lite API Test',build:{beforeDevCommand:'',beforeBuildCommand:'',devUrl:origin},
    app:{windows:[{...config.app.windows[0],label:'main',title}],security:{devCsp:config.app.security.csp,capabilities:['default',{identifier:'api-test-close',windows:['main'],permissions:['core:window:allow-close','core:window:allow-show','core:window:allow-set-focus']}]}}};
  const launch=()=>{
    app=spawn(process.execPath,[path.join(root,'node_modules/@tauri-apps/cli/tauri.js'),'dev','--no-watch','--config',JSON.stringify(merged)],{cwd:root,detached:true,
    // The application ID isolates our synthetic credential. A fake HOME would
    // prevent Security.framework from locating the login keychain at all.
    env:{...process.env,HOME:userInfo().homedir,TRADEFLOW_WORKSPACE_ROOT:path.join(output,'workspace-state'),TRADEFLOW_RESULT_ROOT:resultRoot,
      CARGO_BUILD_JOBS:'2',CARGO_TARGET_DIR:path.join(root,'src-tauri/target/ai-desktop-smoke-cargo')},stdio:['ignore','pipe','pipe']});
    app.stdout.on('data',()=>{});app.stderr.on('data',d=>process.stderr.write(d));
    return new Promise((resolve,reject)=>{app.once('error',reject);app.once('exit',(code,signal)=>resolve({code,signal}));});
  };
  let exited=launch();
  const restart=async()=>{
    await command('finish');const exit=await timeout(exited,6000,'normal exit before restart');assert.equal(exit.code,0);assert.equal(exit.signal,null);
    ready=new Promise(r=>readyResolve=r);exited=launch();
    await timeout(Promise.race([ready,exited.then(()=>{throw Error('App exited before restart test');})]),300000,'restart');
  };
  await timeout(Promise.race([ready,exited.then(()=>{throw Error('App exited before test');})]),300000,'boot');
  await test('WidgetBar opens the API chat page without network calls',async()=>{await command('open');assert.equal(requests,0);});
  await test('one assistant exposes no mode selector or tool-disabling setting',()=>command('single-mode'));
  await test('ordinary chat hides the standalone task page entry while retaining the runtime',async()=>{assert.deepEqual(await command('task-entry-hidden'),{hidden:true});});
  await test('AI result tool writes a real Markdown file without an export button or arbitrary path access',async()=>{
    const saved=await command('result-file-save');assert.equal(saved.saved,true);assert.equal(saved.filename,'AI测试报告.md');
    assert.equal(saved.path,'测试输出/研究结果/AI测试报告.md');
    assert.equal(await readFile(path.join(resultRoot,'研究结果','AI测试报告.md'),'utf8'),'# AI测试报告\n真实桌面写文件验证');
  });
  const aiRecoveryOnly=process.argv.includes('--ai-recovery-only');
  if(aiRecoveryOnly){
    await test('invalid model tool arguments are returned to the model and repaired without user intervention',async()=>{
      await command('configure',{protocol:'chat',mode:'tool-repair',stream:false});const before=requests;
      await command('send',{text:'REPAIR_TEST'});await command('tool-repair-complete');
      assert.equal(requests,before+3,'invalid args should require one repaired tool call and one final model turn');
    });
    await test('repeated identical tool calls stop locally and the same desktop chat remains usable',async()=>{
      await command('configure',{protocol:'chat',mode:'tool-loop',stream:false});const before=requests;
      await command('send',{text:'LOOP_TEST'});await command('tool-loop-stopped');
      assert.equal(requests,before+3,'loop should stop after two identical tool executions');
      await command('send',{text:'LOOP_RECOVER'});await command('complete',{text:'循环停止后继续成功'});
    });
    await test('manual period switch does not abort an in-flight API model turn',async()=>{
      await command('configure',{protocol:'chat',mode:'delayed-ok',stream:false});const before=requests;
      await command('send',{text:'PLAIN'});const switched=await command('switch-resolution-while-busy');assert.equal(switched.busy,true);assert.notEqual(switched.before,switched.after);
      await command('complete',{text:'合成回答 中文😀'});assert.equal(requests,before+1);
    });
  }else{
  const owner=await command('mcp-owner');
  const dataCases=await createUserDataDesktopCases({root,output,title,command,test,capture,requests:()=>requests});
  const dataSource=await dataCases.setup(owner.port);
  const taskCases=createUserTaskDesktopCases({command,test,capture,requests:()=>requests});
  await taskCases.setup(dataSource.id,owner.port);
  const formatCases=process.argv.includes('--formats')?await createFormatDesktopCases({dataCases,command,test,capture,requests:()=>requests}):null;
  if(formatCases)await formatCases.setup(owner.port);
  if(process.argv.includes('--tasks-only')) {
    let workspaceSeed;
    if(process.argv.includes('--workspace-persistence')) {
      await test('ai: a single response larger than the former 4 MiB local cap completes through real Rust HTTP and WebView decoding',async()=>{
        await command('configure',{protocol:'chat',mode:'large-output',stream:false});
        await command('send',{text:'LONG_OUTPUT_REGRESSION'});
        const result=await command('large-output-complete');
        assert.ok(result.length>4*1024*1024);
      });
      await test('ai: manual symbol switch preserves the same chat and the next send uses the new chart without forcing New Chat',async()=>{
        await command('configure',{protocol:'chat',mode:'ok'});
        await command('send',{text:'CHAT_SWITCH_FIRST'});await command('complete',{text:'合成回答 中文😀'});
        const switched=await command('manual-switch');assert.equal(switched.state,'chart_changed');
        await command('send',{text:'CHAT_SWITCH_SECOND'});await command('complete',{text:'合成回答 中文😀'});
      });
      await test('ai: New Chat archives the old transcript and History reopens it in the same process',async()=>{
        await command('new-chat');const history=await command('history-open-first');
        assert.ok(history.text.includes('CHAT_SWITCH_FIRST')&&history.text.includes('CHAT_SWITCH_SECOND'));
      });
      await test('workspace: watchlist and indicator are written to the origin-independent native store',async()=>{workspaceSeed=await command('workspace-seed');});
    }
    await dataCases.beforeRestart();await restart();await taskCases.afterRestart();await formatCases?.afterRestart();await dataCases.afterRestart();
    if(workspaceSeed) {
      await test('workspace: fresh browser storage restores watchlist and indicator from native state after process restart',async()=>{
        assert.deepEqual(await command('workspace-verify',{key:workspaceSeed.key}),{watchlist:true,indicator:true});
      });
      await test('ai: conversation History survives a real process restart without restoring old chart authority',async()=>{
        const history=await command('history-open-first');assert.ok(history.text.includes('CHAT_SWITCH_FIRST')&&history.text.includes('CHAT_SWITCH_SECOND'));
      });
    }
    await restart();await taskCases.afterDeletionRestart();await dataCases.afterDeletionRestart();
  } else {
  for(const protocol of ['chat','responses','anthropic']){
    await test(`${protocol} selected local CSV validates, installs and queries through real native I/O and the shared dynamic registry`,async()=>{
      await command('configure',{protocol});
      await command('send',{text:`DESKTOP_USER_DATA ${dataSource.id}`});
      await command('complete',{text:'本地数据接入、安装和分页查询验证完成'});
      await dataCases.probe('verify',{sourceId:dataSource.id});
    });
  }
  for (const protocol of ['chat','responses','anthropic']) {
    await test(`${protocol} actual Task tools validate, run, page and save the chosen CSV research task`, async () => {
      await command('configure', {protocol});
      const before = await command('business-state');
      await command('send', {text:`DESKTOP_USER_TASK_BUILD ${dataSource.id}`});
      await command('complete', {text:'用户任务生成、运行和保存验证完成'});
      assert.deepEqual((await command('business-state')).selection, before.selection);
      const state = await command('user-task', {op:'state'});
      assert.ok(state.library.some(item => item.id === 'example.protocol_task' && item.status === 'ready'));
    });
    await test(`${protocol} the same chat discovers the saved task, reuses its SymbolList and removes the tool`, async () => {
      await command('send', {text:`DESKTOP_USER_TASK_REUSE ${dataSource.id}`});
      await command('complete', {text:'已保存任务复用和删除验证完成'});
      assert.equal((await command('user-task', {op:'state'})).library.some(item => item.id === 'example.protocol_task'), false);
    });
  }
  for(const protocol of ['chat','responses','anthropic']){
    await test(`${protocol} saving the API profile does not call a model and clears Key input`,async()=>{const before=requests;await command('configure',{protocol});assert.equal(requests,before);});
    await test(`${protocol} settings expose no separate connection-test layer`,async()=>{assert.deepEqual(await command('probe'),{removed:true});});
    await test(`${protocol} real chart read, compute and drawing without selecting modes or approving each call`,async()=>{
      const before=(await command('status')).drawings;await command('send');
      const after=await command('complete');assert.equal(after.drawings,before+1);
    });
    await command('screenshot');await capture(`api-${protocol}-chat`,owner.port);
    await test(`${protocol} nonstream JSON also completes the full chart-tool workflow`,async()=>{
      await command('configure',{protocol,stream:false});const before=(await command('status')).drawings;
      await command('send');
      assert.equal((await command('complete')).drawings,before+1);
    });
  }
  for (const protocol of ['chat', 'responses', 'anthropic']) {
    await test(`${protocol} actual navigation and watchlist writes finish in one conversation without repeated approvals`, async () => {
      await command('configure', { protocol }); const before = await command('business-state');
      await command('send', { text: 'DESKTOP_PLATFORM_NAV' }); await command('complete', { text: '平台导航和自选工作流验证完成' });
      const after = await command('business-state'); assert.equal(after.selection.instrument, before.selection.instrument);
      assert.equal(after.selection.resolution, before.selection.resolution); assert.deepEqual(after.watchlist, before.watchlist);
    });
    await test(`${protocol} generated user indicator repairs a runtime-failing draft before isolated install`, async () => {
      await command('configure', { protocol }); const before = await command('business-state');
      await command('send', { text: 'DESKTOP_PLATFORM_INDICATOR' }); const answer = await command('complete', { text: '用户指标生成和管理工作流验证完成' });
      assert.ok(answer.text.includes('验证用户指标 · 完成')); assert.ok(answer.text.includes('预运行用户指标 · 完成'));
      const after = await command('business-state'); assert.deepEqual(after.indicators, before.indicators); assert.deepEqual(after.library, before.library);
    });
  }
  for(const protocol of ['chat','responses','anthropic']){
    await test(`${protocol} dynamic add, update and removal are discovered in the same chat with readable tool labels`,async()=>{
      await command('configure',{protocol});await command('send',{text:'PLAIN'});await command('complete',{text:'合成回答'});
      try {
        await command('dynamic-registry',{op:'register',version:1});
        await command('send',{text:'DESKTOP_DYNAMIC 1'});const first=await command('complete',{text:'动态工具验证完成 1'});
        assert.ok(first.text.includes('我的动态测试工具'));assert.ok(first.text.includes('PLAIN'));
        await command('dynamic-registry',{op:'update',version:2});
        await command('send',{text:'DESKTOP_DYNAMIC 2'});await command('complete',{text:'动态工具验证完成 2'});
        await command('dynamic-registry',{op:'dispose'});
        await command('send',{text:'DESKTOP_DYNAMIC_REMOVED'});await command('complete',{text:'动态工具移除完成'});
      } finally {await command('dynamic-registry',{op:'dispose'});}
    });
  }
  await test('nonstream JSON response works without interpreting HTML in text',async()=>{
    await command('configure',{protocol:'chat',stream:false});await command('send',{text:'PLAIN'});
    const answer=await command('complete',{text:'<script>not executable</script>'});assert.ok(answer.text.includes('中文😀'));
  });
  await test('separate settings preserves drafts, IME input and a fixed composer without a model request',async()=>{
    const before=requests;await command('usability');assert.equal(requests,before);
  });
  for(const protocol of ['chat','responses','anthropic']){
    await test(`${protocol} plain questions, actual chart reads and drawing continue in one conversation`,async()=>{
      await command('configure',{protocol});await command('send',{text:'PLAIN'});
      await command('complete',{text:'合成回答'});const before=(await command('status')).drawings;
      const count=requests;await command('single-mode');assert.equal(requests,count);
      await command('send',{text:'DESKTOP_READ'});await command('complete',{text:'只读验证完成'});
      assert.equal((await command('status')).drawings,before);
      await command('send',{text:'DESKTOP_FLOW'});const final=await command('complete');
      assert.ok(final.text.includes('只读验证完成')&&final.text.includes('合成回答'));assert.equal(final.drawings,before+1);
    });
  }
  await command('screenshot');await capture('api-single-assistant',owner.port);
  await test('existing objects can be deleted and restored from a new conversation without individual approvals',async()=>{
    await command('configure',{protocol:'chat'});const before=(await command('status')).drawings;assert.ok(before>0);
    await command('send',{text:'DESKTOP_EXISTING_DELETE'});assert.equal((await command('complete',{text:'已有绘图删除验证完成'})).drawings,before-1);
    await command('configure',{protocol:'chat'});await command('send',{text:'DESKTOP_REVERT_SAVED'});
    assert.equal((await command('complete',{text:'历史撤销验证完成'})).drawings,before);
  });
  await test('a requested drawing batch can be created and reverted directly',async()=>{
    await command('configure',{protocol:'chat'});const before=(await command('status')).drawings;
    await command('send',{text:'DESKTOP_FLOW_REVERT'});assert.equal((await command('complete')).drawings,before);
  });
  await test('DeepSeek-style markup stays non-executable in streaming and JSON',async()=>{
    for(const stream of [true,false]){
      await command('configure',{protocol:'chat',mode:'tool-text',stream});const before=(await command('status')).drawings,count=requests;
      await command('send',{text:'你能读到什么数据'});const result=await command('tool-text-notice');
      assert.equal(result.drawings,before);assert.equal(requests,count+1);
    }
  });
  await test('repeated identical tool calls stop locally and the same desktop chat remains usable',async()=>{
    await command('configure',{protocol:'chat',mode:'tool-loop',stream:false});const before=requests;
    await command('send',{text:'LOOP_TEST'});await command('tool-loop-stopped');
    assert.equal(requests,before+3,'loop should stop after two identical tool executions');
    await command('send',{text:'LOOP_RECOVER'});await command('complete',{text:'循环停止后继续成功'});
  });
  await test('manual recovery after a successful drawing retries only the model, not the drawing',async()=>{
    await command('configure',{protocol:'chat',mode:'resume'});const before=(await command('status')).drawings;
    await command('send');await command('error');const requested=requests;
    const result=await command('resume');assert.equal(result.before,before+1);assert.equal(result.after,before+1);assert.equal(requests,requested+1);
  });
  await test('OS credential-store saves this isolated synthetic profile by default',async()=>{
    const before=requests;secureStorage=await command('storage-attempt');assert.equal(requests,before);
    assert.equal(secureStorage.saved,true);
    await command('configure',{protocol:'chat'});
  });
  await test('saved secret cannot move to a changed endpoint through blank input',()=>command('change-endpoint-without-key'));
  await test('401 is sanitized with no automatic retry',async()=>{
    await command('configure',{protocol:'chat',mode:'401'});const before=requests;await command('send',{text:'test'});const reply=await command('error');assert.ok(!reply.text.includes('private provider detail'));assert.equal(requests,before+1);
  });
  await test('redirect never forwards authentication to a different path',async()=>{
    await command('configure',{protocol:'chat',mode:'redirect'});await command('send',{text:'test'});await command('error');assert.equal(forbiddenRedirects,0);
  });
  await test('cancellation closes a stalled streaming request without a late drawing',async()=>{
    await command('configure',{protocol:'chat',mode:'slow'});const before=(await command('status')).drawings;await command('send',{text:'wait'});
    const cancelled=await command('cancel');assert.equal(cancelled.drawings,before);assert.ok(cancelled.status.includes('停止'));
  });
  await test('manual period switch does not abort an in-flight API model turn',async()=>{
    await command('configure',{protocol:'chat',mode:'delayed-ok',stream:false});const before=requests;
    await command('send',{text:'PLAIN'});const switched=await command('switch-resolution-while-busy');assert.equal(switched.busy,true);assert.notEqual(switched.before,switched.after);
    await command('complete',{text:'合成回答 中文😀'});assert.equal(requests,before+1);
  });
  await command('screenshot',{width:280,config:true});await capture('api-settings-narrow',owner.port);
  await command('screenshot',{width:520,light:true,config:true});await capture('api-settings-light',owner.port);
  await test('securely saving the connection does not call a model',async()=>{
    await command('configure',{protocol:'chat'});const before=requests;await command('persist-connection');assert.equal(requests,before);
  });
  await dataCases.beforeRestart();
  const beforeRestart=requests;await restart();
  await test('actual process restart restores the profile and reuses its Key without re-entry',async()=>{
    const result=await command('restored-connection');assert.equal(result.restored,true);assert.equal(requests,beforeRestart);
    await command('send',{text:'PLAIN'});await command('complete',{text:'合成回答'});assert.equal(requests,beforeRestart+1);
  });
  await test('private native deletion of the saved connection does not call a model',async()=>{
    const before=requests;await command('forget-connection');assert.equal(requests,before);
  });
  await taskCases.afterRestart();await formatCases?.afterRestart();
  await dataCases.afterRestart();
  const beforeDeletionRestart=requests;await restart();
  await test('a deleted connection stays deleted after another real restart',async()=>{
    await command('empty-connection');assert.equal(requests,beforeDeletionRestart);
  });
  await taskCases.afterDeletionRestart();
  await dataCases.afterDeletionRestart();
  }
  }
  await command('finish');const exit=await timeout(exited,6000,'normal exit');assert.equal(exit.code,0);assert.equal(exit.signal,null);
}catch(e){fatal=e;console.error('API desktop failure:',e.message);}
finally{
  if(app&&app.exitCode===null&&app.signalCode===null){try{process.kill(-app.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
  server.closeAllConnections();server.close();const finalFingerprint=await desktopSourceFingerprint(root);
  if(finalFingerprint.sha256!==fingerprint.sha256)fatal??=Error('source changed during run');
  await writeFile(path.join(output,'acceptance.json'),JSON.stringify({runId,passed:!fatal,scenarios:results,requests,forbiddenRedirects,secureStorage,screenshots,screenshotFailures,fingerprint,finalFingerprint,failure:fatal?.message??null},null,2));release();
}
if(fatal)throw fatal;console.log(`API desktop: ${results.length} scenarios passed. Evidence: ${output}`);
