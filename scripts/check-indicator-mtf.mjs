import assert from 'node:assert/strict';
import { IndicatorRegistry } from '../src/indicator-sdk/registry.ts';
import { IndicatorRuntime } from '../src/indicator-sdk/runtime.ts';
import { defineIndicator } from '../src/indicator-sdk/define-indicator.ts';
import { createIndicatorTestHarness } from '../src/indicator-sdk/testing.ts';
import { sma } from '../src/indicators.ts';

const bar=(time,close)=>Object.freeze({time,open:close-1,high:close+1,low:close-2,close,volume:100});
const mainBars=Object.freeze([bar(100,10),bar(200,11),bar(300,12)]);
const event=Object.freeze({reason:'initial',bars:mainBars,changedFrom:0});
const selection=Object.freeze({
  symbol:Object.freeze({symbol:'SH:600000',code:'600000',name:'浦发银行',exchange:'SH',providerId:'tdx',providerDisplayName:'TDX',venue:'SH',kind:'stock'}),
  resolution:'1D',adjustment:'none',seriesKind:'ohlcv',marketKind:'stock',providerId:'tdx',
});

// The same MTF contract used by built-in MA consumes a higher-timeframe snapshot
// without changing chart resolution. The existing plugin/Vite contracts compile
// the real MA/EMA modules separately.
const monthly=Object.freeze([bar(100,1),bar(200,3),bar(300,5),bar(400,7)]);
const maLikeDefinition=defineIndicator({
  id:'fixture.mtf-ma',apiVersion:1,indicatorVersion:1,name:'MTF MA',supports:{seriesKinds:['ohlcv']},
  inputs:{period:{type:'number',title:'周期',default:2},sourceResolution:{type:'select',title:'数据周期',default:'1M',options:[{value:'1M',label:'月线'}]}},
  dataRequests(){return[{key:'source',resolution:'1M',count:8000,adjustment:'current'}];},
  create(context,inputs){
    const line=context.layers.createSeries({key:'ma',type:'line',pane:'main'});
    return{update(event){const external=context.data.get('source');const bars=external?.bars??event.bars;const values=sma(bars.map(item=>item.close),inputs.period);line.setData(bars.flatMap((item,index)=>values[index]==null?[]:[{time:item.time,value:values[index]}]));}};
  },
});
const harness=createIndicatorTestHarness(maLikeDefinition,{
  inputs:{period:2,sourceResolution:'1M'},selection,
  data:[Object.freeze({key:'source',resolution:'1M',adjustment:'none',bars:monthly,capturedAtMs:1})],
});
harness.update(event);
assert.equal(harness.context.selection.resolution,'1D');
assert.deepEqual(harness.series('ma').points.map(p=>[p.time,p.value]),[[200,2],[300,4],[400,6]]);
harness.dispose();

// Runtime fetches declared extra data outside the synchronous indicator callback,
// then rebuilds once and exposes the frozen snapshot through context.data.get().
let created=0,seenSnapshot=null,historyCalls=0;
const mtf=defineIndicator({
  id:'fixture.mtf',apiVersion:1,indicatorVersion:1,name:'MTF',supports:{seriesKinds:['ohlcv']},inputs:{},
  dataRequests(){return[{key:'monthly',resolution:'1M',count:64,adjustment:'current'}];},
  create(context){created++;seenSnapshot=context.data.get('monthly');return{update(){}};},
});
const registry=new IndicatorRegistry([mtf]);
const noOp=()=>({dispose(){}});
const chartHost={
  setCanvasErrorHandler(){},clear(){},remove(){},setVisible(){},finishBinding(){},abortBinding(){},
  beginBinding(){return{layers:{createSeries(){throw Error('unused');},createCanvasLayer(){throw Error('unused');},createOverlay(){throw Error('unused');}},panes:{main:{key:'main',getHeight:()=>600},create(){throw Error('unused');},get(){return null;}}};},
};
const mainSeries={createBarStyleContribution(){throw Error('unused');},createMarkerContribution(){throw Error('unused');}};
const market={capabilities:()=>({depth:{supported:false},trades:{supported:false,eventKinds:[]},historicalDepth:false,historicalTrades:false,orderByOrder:false}),status:()=>({state:'available'}),getDepth:()=>null,onDepth:noOp,onTrades:noOp,onStatus:noOp};
const runtime=new IndicatorRuntime(registry,{
  chartHost,mainSeries,market,events:{onCrosshairMove:noOp,onClick:noOp,onVisibleRangeChange:noOp},theme:()=> 'dark',
  async history(_selection,request){historyCalls++;assert.equal(request.resolution,'1M');assert.equal(request.count,64);return monthly;},
});
runtime.setContext(selection,event);runtime.add({instanceId:'mtf-1',indicatorId:'fixture.mtf'});
assert.equal(created,0,'indicator must not run before requested data is ready');
for(let i=0;i<10&&created===0;i++)await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(historyCalls,1);assert.equal(created,1);assert.equal(seenSnapshot.resolution,'1M');assert.ok(Object.isFrozen(seenSnapshot.bars));
runtime.destroy();

console.log('indicator MTF host: ok');
