import assert from 'node:assert/strict';
import { TASK_FIXTURE } from './user-task-fixtures.mjs';

export function createUserTaskDesktopCases({ command, test, capture, requests }) {
  const probe=(op,input={})=>command('user-task',{op,...input});let task,saved;
  return {
    async setup(sourceId,port) {
      await test('task: ordinary .tft import runs against the explicitly selected CSV source in the real WebView Worker',async()=>{
        const before=requests();task=await probe('run',{sourceId,source:TASK_FIXTURE});assert.equal(task.processed,2);assert.equal(task.universeScope,'connector-catalog');assert.equal(requests(),before);
      });
      await test('task: table, filter, Series point, Report, CSV/JSON and an unsent AI result handoff are usable',async()=>{
        const before=requests();const result=await probe('results',{taskId:task.taskId});assert.equal(result.tableRows,2);assert.equal(requests(),before);
      });
      await test('task: saving persists a definition and registers the common reusable tool, without executing it again',async()=>{
        const before=requests();saved=await probe('save',{taskId:task.taskId});assert.equal(saved.status,'ready');assert.equal(requests(),before);
      });
      await test('task: narrow and light-theme result workspaces stay bounded and separate from settings/chat',async()=>{
        await probe('layout',{taskId:task.taskId,width:280});await capture('user-task-narrow',port);
        await probe('layout',{taskId:task.taskId,width:520,toggleTheme:true});await capture('user-task-light',port);
        await probe('layout',{taskId:task.taskId,width:440,toggleTheme:true});
      });
      await test('task: Stop terminates a real user Worker and retains an explicit incomplete state',async()=>{
        const source=TASK_FIXTURE.replace("id:'example.scan'","id:'example.cancel'").replace('count++;const bars=', 'while(true){} count++;const bars=');
        const result=await probe('cancel',{sourceId,source});assert.equal(result.state,'cancelled');assert.equal(result.complete,false);
      });
      await command('user-data',{op:'handoff',sourceId});
    },
    async afterRestart() {
      await test('task: real process restart restores only the saved definition; explicit removal retires its tool',async()=>{
        assert.deepEqual(await probe('restored',{taskDefinitionId:saved.id}),{restored:true,removed:true});
      });
    },
    async afterDeletionRestart() {
      await test('task: removed task definition stays absent after another real process restart',async()=>assert.equal((await probe('deleted')).empty,true));
    },
  };
}
