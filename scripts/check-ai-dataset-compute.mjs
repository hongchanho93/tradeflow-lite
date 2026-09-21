import assert from 'node:assert/strict';
import { MarketResultStore } from '../src/ai-capabilities/market-data.ts';
import { ChartSnapshotStore } from '../src/ai-capabilities/chart-data.ts';
import { createChartReadTools } from '../src/ai-capabilities/chart-tools.ts';

const bars=[1,2,3,4].map((time,index)=>{const close=(index+1)*10;return{time,open:close-1,high:close+1,low:close-2,close,volume:100};});
const query={providerId:'tdx',symbol:'SH:600000',kind:'stock',resolution:'1M',adjustment:'none',count:4};
const controller=new AbortController();
const identity=Object.freeze({});
const appScope=Object.freeze({signal:controller.signal,sessionIdentity:identity});
const chartScope=Object.freeze({signal:controller.signal,sessionIdentity:identity});
const appContext={scope:'app',appInstanceId:'app'};
const chartContext={appInstanceId:'app',chartId:'main',provider:'tdx',instrument:'SH:600000',resolution:'1D',adjustment:'none',selectionGeneration:1};
const ctx=(context,session)=>({context,signal:controller.signal,session,checkpoint(){if(controller.signal.aborted)throw Error('cancelled');}});

const marketStore=new MarketResultStore({
  async execute(){return{symbol:query.symbol,seriesKind:'ohlcv',bars,diagnostics:{source:'fixture'}};},
});
const descriptor=await marketStore.capture(query,ctx(appContext,appScope));
assert.equal(descriptor.rowCount,4);assert.equal(descriptor.resolution,'1M');

const chartStore=new ChartSnapshotStore(()=>({
  context:chartContext,displayedGeneration:1,dataRevision:1,seriesKind:'ohlcv',bars,timeZone:'Asia/Shanghai',displayTimeZone:'Asia/Shanghai',
}));
const tools=createChartReadTools(chartStore,marketStore);
const summary=tools.find(tool=>tool.id==='tf.compute.summary');
const sma=tools.find(tool=>tool.id==='tf.compute.sma');
assert.ok(summary&&sma);

const summaryResult=summary.run({datasetId:descriptor.datasetId,field:'close'},ctx(chartContext,chartScope));
assert.equal(summaryResult.source,'market');assert.equal(summaryResult.datasetId,descriptor.datasetId);
assert.equal(summaryResult.mean,25);assert.equal(summaryResult.first,10);assert.equal(summaryResult.last,40);

const smaResult=sma.run({datasetId:descriptor.datasetId,field:'close',period:2},ctx(chartContext,chartScope));
assert.equal(smaResult.source,'market');assert.deepEqual(smaResult.points.map(point=>point.ready?point.value:null),[null,15,25,35]);

assert.throws(()=>summary.run({datasetId:descriptor.datasetId,snapshotId:'also',field:'close'},ctx(chartContext,chartScope)),/invalid_request/);
const otherIdentity=Object.freeze({});
const otherScope=Object.freeze({signal:controller.signal,sessionIdentity:otherIdentity});
assert.throws(()=>sma.run({datasetId:descriptor.datasetId,field:'close',period:2},ctx(chartContext,otherScope)),/snapshot_unavailable/);

console.log('AI market dataset compute: ok');
