import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyzeUserIndicatorOutput,
  analyzeUserIndicatorSeriesOutput,
  testUserIndicatorSourceIsolated,
  USER_INDICATOR_PREFLIGHT_LIMITS,
} from '../src/user-indicator-runtime/preflight.ts';
import { UserIndicatorExecutionEngine } from '../src/user-indicator-runtime/execution-engine.ts';

const bars=[1,2,3,4].map(time=>Object.freeze({time,open:1,high:2,low:0,close:1,volume:1}));
const event=Object.freeze({reason:'initial',bars:Object.freeze(bars),changedFrom:0});

const empty=analyzeUserIndicatorSeriesOutput(Object.freeze({callbacks:Object.freeze([
  Object.freeze({phase:'create',commands:Object.freeze([
    Object.freeze({type:'create-series',key:'line',seriesType:'line',pane:'main'}),
  ])}),
  Object.freeze({phase:'update',reason:'initial',changedFrom:0,barsLength:4,commands:Object.freeze([
    Object.freeze({type:'series-set-values',key:'line',values:Object.freeze([null,null,null,null]),dirtyFrom:0}),
  ])}),
])}),event);
assert.deepEqual(empty,[{key:'line',type:'line',points:4,ready:0,allEmpty:true}]);

const partial=analyzeUserIndicatorSeriesOutput(Object.freeze({callbacks:Object.freeze([
  Object.freeze({phase:'create',commands:Object.freeze([
    Object.freeze({type:'create-series',key:'line',seriesType:'line',pane:'main'}),
  ])}),
  Object.freeze({phase:'update',reason:'initial',changedFrom:0,barsLength:4,commands:Object.freeze([
    Object.freeze({type:'series-set-data',key:'line',points:Object.freeze([
      Object.freeze({time:1}),Object.freeze({time:2,value:10}),Object.freeze({time:4,value:20}),
    ])}),
  ])}),
])}),event);
assert.deepEqual(partial,[{key:'line',type:'line',points:3,ready:2,firstReadyTime:2,lastReadyTime:4,allEmpty:false}]);

const mixed=analyzeUserIndicatorOutput(Object.freeze({callbacks:Object.freeze([
  Object.freeze({phase:'create',commands:Object.freeze([
    Object.freeze({type:'create-marker-contribution',key:'signals',priority:1}),
    Object.freeze({type:'create-bar-style-contribution',key:'colors',priority:1,chartKinds:Object.freeze(['candles'])}),
    Object.freeze({type:'create-canvas-layer',key:'zone',target:'pane',zOrder:'normal'}),
    Object.freeze({type:'create-panel',key:'stats',paneKey:'main',position:'top-right'}),
    Object.freeze({type:'debug-log',message:'create ok'}),
  ])}),
  Object.freeze({phase:'update',reason:'initial',changedFrom:0,barsLength:4,commands:Object.freeze([
    Object.freeze({type:'marker-set',key:'signals',markers:Object.freeze([
      Object.freeze({time:2,position:'aboveBar',shape:'circle',color:'#fff'}),
      Object.freeze({time:4,position:'belowBar',shape:'circle',color:'#fff'}),
    ])}),
    Object.freeze({type:'canvas-set-commands',key:'zone',commands:Object.freeze([{type:'line'},{type:'text'}])}),
    Object.freeze({type:'bar-style-set',key:'colors',styles:Object.freeze([
      Object.freeze({time:2,color:'#f00'}),Object.freeze({time:4,color:'#0f0'}),
    ])}),
    Object.freeze({type:'panel-set',key:'stats',content:Object.freeze({
      columns:Object.freeze([{key:'a',title:'A'},{key:'b',title:'B'}]),
      rows:Object.freeze([{cells:Object.freeze([{text:'1'},{text:'2'}])},{cells:Object.freeze([{text:'3'},{text:'4'}])}]),
    })}),
    Object.freeze({type:'debug-log',message:'initial ok'}),
  ])}),
])}),event);
assert.deepEqual(mixed.markers,[{key:'signals',points:2,firstTime:2,lastTime:4,allEmpty:false}]);
assert.deepEqual(mixed.barStyles,[{key:'colors',points:2,firstTime:2,lastTime:4,allEmpty:false}]);
assert.deepEqual(mixed.canvases,[{key:'zone',commands:2,allEmpty:false}]);
assert.deepEqual(mixed.panels,[{key:'stats',columns:2,rows:2,cells:4,allEmpty:false}]);
assert.deepEqual(mixed.logs,[{phase:'create',message:'create ok'},{phase:'update',message:'initial ok'}]);
assert.equal(mixed.allOutputsEmpty,false);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.markersPerCallback,2000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.seriesDataPointsPerCallback,12000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.paneMinHeight,40);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.paneMaxHeight,2000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.outboxCommandsPerCallback,256);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.canvasPointsPerCommand,2000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.textFieldChars,512);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.bulkOutputBytes,8*1024*1024);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.realtimeOutputBytes,4*1024*1024);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.series,32);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.initialUpdateVmMs,2000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.historyUpdateVmMs,1000);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.realtimeUpdateVmMs,100);
assert.equal(USER_INDICATOR_PREFLIGHT_LIMITS.reconciliationUpdateVmMs,2000);

const barStyleOnly=analyzeUserIndicatorOutput(Object.freeze({callbacks:Object.freeze([
  Object.freeze({phase:'create',commands:Object.freeze([
    Object.freeze({type:'create-bar-style-contribution',key:'only',priority:1,chartKinds:Object.freeze(['candles'])}),
  ])}),
  Object.freeze({phase:'update',reason:'initial',changedFrom:0,barsLength:4,commands:Object.freeze([
    Object.freeze({type:'bar-style-set',key:'only',styles:Object.freeze([Object.freeze({time:3,color:'#fff'})])}),
  ])}),
])}),event);
assert.equal(barStyleOnly.allOutputsEmpty,false);
assert.deepEqual(barStyleOnly.barStyles,[{key:'only',points:1,firstTime:3,lastTime:3,allEmpty:false}]);

const preflightSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-phases', indicatorVersion:1,
  name:'Preflight phases', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto'],requires:{depth:true,trades:['aggregate-trade']}},
  create(context) {
    let calls=0;
    const markers=context.mainSeries.createMarkerContribution({key:'signals',priority:1});
    context.log('create');
    return {
      update(event) {
        calls += 1;
        context.log(event.reason + ':' + calls);
        const last=event.bars[event.bars.length-1];
        markers.set([{time:last.time,position:'aboveBar',shape:'circle',color:'#fff',id:'preflight-signal',hitTest:true}]);
        if (event.reason === 'realtime') {
          if (!event.depth || event.depth.coverage !== 'current-snapshot' || event.depth.source !== 'preflight-synthetic' || !Object.isFrozen(event.depth)) throw new Error('preflight-depth-missing');
          if (!event.trades || event.trades.source !== 'preflight-synthetic' || event.trades.events[0].eventKind !== 'aggregate-trade' || !Object.isFrozen(event.trades.events)) throw new Error('preflight-trades-missing');
          context.log('market:' + event.depth.bids.length + '/' + event.trades.events.length);
        }
      },
      onPointer(event){context.log('pointer:' + event.type + ':' + event.id + ':' + calls);},
    };
  },
});
`;
const preflightEngine=await UserIndicatorExecutionEngine.create();
const worker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? preflightEngine.createInstance(message)
          : message.type==='pointer'
            ? preflightEngine.pointerInstance(message)
            : preflightEngine.updateInstance(message);
        worker.onmessage?.({data:response});
      } catch {
        worker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){preflightEngine.dispose();},
};
const controller=new AbortController();
const preflight=await testUserIndicatorSourceIsolated(
  preflightSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), controller.signal, ()=>worker, {depth:true,trades:['aggregate-trade']},
);
assert.equal(preflight.valid,true);
assert.deepEqual(preflight.coveredReasons,['initial','history','realtime','reconciliation']);
assert.deepEqual(preflight.timings.map(item=>[item.reason,item.budgetMs]),[
  ['initial',2000],['history',1000],['realtime',100],['reconciliation',2000],
]);
assert.deepEqual(preflight.coveredPointerTypes,['hover','click','leave']);
assert.deepEqual(preflight.pointerTimings.map(item=>[item.type,item.budgetMs]),[['hover',100],['click',100],['leave',100]]);
assert.deepEqual(preflight.logs.map(item=>item.message),[
  'create','initial:1','history:2','realtime:3','market:1/1','reconciliation:4',
  'pointer:hover:preflight-signal:4','pointer:click:preflight-signal:4','pointer:leave:preflight-signal:4',
]);

const noPointerSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-no-pointer', indicatorVersion:1,
  name:'Preflight no pointer', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto']},
  create(context) {
    const markers=context.mainSeries.createMarkerContribution({key:'signals',priority:1});
    return {
      update(event) {
        const last=event.bars[event.bars.length-1];
        markers.set([{time:last.time,position:'aboveBar',shape:'circle',color:'#fff',id:'no-pointer',hitTest:true}]);
      },
    };
  },
});
`;
const noPointerEngine=await UserIndicatorExecutionEngine.create();
const noPointerWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? noPointerEngine.createInstance(message)
          : message.type==='pointer'
            ? noPointerEngine.pointerInstance(message)
            : noPointerEngine.updateInstance(message);
        noPointerWorker.onmessage?.({data:response});
      } catch {
        noPointerWorker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){noPointerEngine.dispose();},
};
const noPointer=await testUserIndicatorSourceIsolated(
  noPointerSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), new AbortController().signal, ()=>noPointerWorker,
);
assert.equal(noPointer.valid,true);
assert.deepEqual(noPointer.coveredPointerTypes,[]);
assert.deepEqual(noPointer.pointerTimings,[]);

const initialFailureSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-initial-failure', indicatorVersion:1,
  name:'Preflight initial failure', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto']},
  create(context) {
    context.log('create-before-initial-failure');
    return {
      update(event) {
        if (event.reason === 'initial') throw new Error('initial-update-regression-sentinel');
      },
    };
  },
});
`;
const initialFailureEngine=await UserIndicatorExecutionEngine.create();
const initialFailureWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? initialFailureEngine.createInstance(message)
          : message.type==='pointer'
            ? initialFailureEngine.pointerInstance(message)
            : initialFailureEngine.updateInstance(message);
        initialFailureWorker.onmessage?.({data:response});
      } catch {
        initialFailureWorker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){initialFailureEngine.dispose();},
};
const initialFailureStarted=performance.now();
const initialFailure=await testUserIndicatorSourceIsolated(
  initialFailureSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), new AbortController().signal, ()=>initialFailureWorker,
);
assert.equal(initialFailure.valid,false);
assert.equal(initialFailure.failurePhase,'update');
assert.equal(initialFailure.errorCode,'runtime_exception');
assert.match(initialFailure.failureDetail,/initial-update-regression-sentinel/);
assert.ok(performance.now()-initialFailureStarted<1500,'initial update failures must not fall through to the create hard wall timeout');

const laterFailureSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-later-failure', indicatorVersion:1,
  name:'Preflight later failure', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto']},
  create(context) {
    context.log('create-retained-on-failure');
    return {
      update(event) {
        context.log(event.reason + '-retained-on-failure');
        if (event.reason === 'history') throw new Error('history-failure-sentinel');
      },
    };
  },
});
`;
const laterFailureEngine=await UserIndicatorExecutionEngine.create();
const laterFailureWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? laterFailureEngine.createInstance(message)
          : message.type==='pointer'
            ? laterFailureEngine.pointerInstance(message)
            : laterFailureEngine.updateInstance(message);
        laterFailureWorker.onmessage?.({data:response});
      } catch {
        laterFailureWorker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){laterFailureEngine.dispose();},
};
const laterFailure=await testUserIndicatorSourceIsolated(
  laterFailureSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), new AbortController().signal, ()=>laterFailureWorker,
);
assert.equal(laterFailure.valid,false);
assert.equal(laterFailure.failurePhase,'update');
assert.match(laterFailure.failureDetail,/history-failure-sentinel/);
assert.deepEqual(laterFailure.logs.map(item=>item.message),[
  'create-retained-on-failure','initial-retained-on-failure','history-retained-on-failure',
]);

const createFailureSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-create-failure-log', indicatorVersion:1,
  name:'Preflight create failure log', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto']},
  create(context) {
    context.log('create-start-before-failure');
    throw new Error('create-failure-sentinel');
  },
});
`;
const createFailureEngine=await UserIndicatorExecutionEngine.create();
const createFailureWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? createFailureEngine.createInstance(message)
          : message.type==='pointer'
            ? createFailureEngine.pointerInstance(message)
            : createFailureEngine.updateInstance(message);
        createFailureWorker.onmessage?.({data:response});
      } catch {
        createFailureWorker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){createFailureEngine.dispose();},
};
const createFailure=await testUserIndicatorSourceIsolated(
  createFailureSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), new AbortController().signal, ()=>createFailureWorker,
);
assert.equal(createFailure.valid,false);
assert.equal(createFailure.failurePhase,'create');
assert.match(createFailure.failureDetail,/create-failure-sentinel/);
assert.deepEqual(createFailure.logs.map(item=>item.message),['create-start-before-failure']);

const pointerFailureSource=String.raw`
defineIndicator({
  formatVersion:1, apiVersion:1, id:'user.preflight-pointer-failure-log', indicatorVersion:1,
  name:'Preflight pointer failure log', inputs:{}, supports:{seriesKinds:['ohlcv'],marketKinds:['crypto']},
  create(context) {
    const markers=context.mainSeries.createMarkerContribution({key:'signals',priority:1});
    return {
      update(event) {
        const last=event.bars[event.bars.length-1];
        markers.set([{time:last.time,position:'aboveBar',shape:'circle',color:'#fff',id:'pointer-fail',hitTest:true}]);
      },
      onPointer(event) {
        context.log('pointer-before-' + event.type);
        if (event.type === 'click') throw new Error('pointer-click-failure-sentinel');
      },
    };
  },
});
`;
const pointerFailureEngine=await UserIndicatorExecutionEngine.create();
const pointerFailureWorker={
  onmessage:null,onerror:null,onmessageerror:null,
  postMessage(message){
    queueMicrotask(()=>{
      try {
        const response=message.type==='create'
          ? pointerFailureEngine.createInstance(message)
          : message.type==='pointer'
            ? pointerFailureEngine.pointerInstance(message)
            : pointerFailureEngine.updateInstance(message);
        pointerFailureWorker.onmessage?.({data:response});
      } catch {
        pointerFailureWorker.onerror?.(new Event('error'));
      }
    });
  },
  terminate(){pointerFailureEngine.dispose();},
};
const pointerFailure=await testUserIndicatorSourceIsolated(
  pointerFailureSource, Object.freeze({}), Object.freeze({ selection:Object.freeze({providerId:'binance_spot',symbol:'BINANCE:BTCUSDT'}) }),
  Object.freeze(bars), new AbortController().signal, ()=>pointerFailureWorker,
);
assert.equal(pointerFailure.valid,false);
assert.equal(pointerFailure.failurePhase,'pointer');
assert.match(pointerFailure.failureDetail,/pointer-click-failure-sentinel/);
assert.ok(pointerFailure.logs.some(item=>item.message==='pointer-before-hover'));
assert.ok(pointerFailure.logs.some(item=>item.message==='pointer-before-click'));

const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
assert.doesNotMatch(main,/Math\.min\(512,\s*state\.bars\.length\)/);
assert.match(main,/const bars = state\.bars\.map\(bar => Object\.freeze\(\{ \.\.\.bar \}\)\)/);
assert.match(main,/failureDetail:\s*safeUserIndicatorFailureDetail\(message\)/);
assert.match(main,/failureDetail:\s*userIndicatorRuntimeFailures\.get\(instance\.instanceId\)!\.failureDetail/);

console.log('user indicator preflight diagnostics: ok');
