import { Worker } from 'node:worker_threads';
export const taskWorkers = [];
export function taskWorkerFactory() {
  const node = new Worker(new URL('./user-task-node-worker.mjs', import.meta.url));
  const worker = { onmessage: null, onerror: null, onmessageerror: null, terminated: 0,
    postMessage: message => node.postMessage(message), terminate() { this.terminated++; void node.terminate(); } };
  node.on('message', data => worker.onmessage?.({ data }));
  node.on('error', error => worker.onerror?.({ message: error.message, preventDefault() {} }));
  node.on('messageerror', () => worker.onmessageerror?.({}));
  taskWorkers.push(worker); return worker;
}
export const TASK_FIXTURE = `defineTask({
  formatVersion:1,apiVersion:1,id:'example.scan',version:1,name:'收盘变化研究',
  inputSchema:{type:'object',properties:{minimum:{type:'number'}},required:['minimum'],additionalProperties:false},defaults:{minimum:0},
  history:[{id:'daily',resolution:'1D',count:3,adjustment:'none'}],
  outputs:[{id:'table',type:'table',title:'符合条件',columns:[{id:'symbol',title:'品种',type:'symbol'},{id:'change',title:'变化',type:'number'}]},
    {id:'symbols',type:'symbol_list',title:'候选品种'},{id:'series',type:'series',title:'累计样本'},
    {id:'report',type:'report',title:'研究说明'}],
  create(parameters){let count=0;return {
    onSymbol(batch){count++;const bars=batch.history.daily.rows;const change=bars.at(-1).close-bars[0].close;
      return change>=parameters.minimum?[{artifactId:'table',rows:[[batch.symbol,change]]},{artifactId:'symbols',rows:[batch.symbol]}]:[];},
    finish(){return [{artifactId:'series',rows:[{time:1,value:count}]},{artifactId:'report',text:'仅为用户研究示例，不是交易建议。'}];}
  };}
});`;
export const TASK_SYMBOL = { providerId: 'test', symbol: 'SH:600000', kind: 'stock', name: '测试品种' };
export const TASK_BATCH = { symbol: TASK_SYMBOL, history: { daily: { rows: [
  {time:1,open:1,high:2,low:1,close:1,volume:10},{time:2,open:1,high:2,low:1,close:2,volume:20}],
  seriesKind:'ohlcv',requestedCount:3,shortfall:true,coverage:'provider-returned-window'} } };
