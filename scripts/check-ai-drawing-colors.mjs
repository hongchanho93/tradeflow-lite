import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingColor } from '../src/ai-capabilities/drawing-colors.ts';
import { DrawingTypeRegistry } from '../src/ai-capabilities/drawing-contract.ts';
test('color normalization accepts common hex, RGB, HSL and names without evaluating CSS',()=>{
  for(const [input,expected] of [['#aBc','#aabbcc'],['#abcd','#aabbccdd'],['red','#ff0000'],['transparent','#00000000'],
    ['rgb(255, 0, 128)','#ff0080'],['rgba(255,0,0,0.5)','#ff000080'],['rgb(100% 0% 0% / 50%)','#ff000080'],
    ['hsl(120,100%,50%)','#00ff00'],['hsl(-120 100% 50% / .25)','#0000ff40']]) assert.equal(normalizeDrawingColor(input),expected);
  for(const bad of ['url(https://x)','var(--secret)','expression(1)','red;background:url(x)','rgb(300,0,0)','hsl(0 200% 50%)','rgb(NaN,0,0)','rgba(1,2,3,4)'])assert.throws(()=>normalizeDrawingColor(bad));
});
test('all 21 type schemas reject incomplete, excessive and mismatched points; freehand supports a bounded path',()=>{
  const types=new DrawingTypeRegistry();assert.equal(types.describe().length,21);
  const points=Array.from({length:64},(_,time)=>({time,price:time}));
  assert.equal(types.validate({type:'Brush',points,style:{color:'rgba(255,0,0,0.5)',lineWidth:20}}).style.color,'#ff000080');
  for(const spec of [{type:'Brush',points:points.slice(0,1),style:{}},{type:'Path',points:[...points,points[0]],style:{}},
    {type:'Circle',points:points.slice(0,3),style:{}},{type:'UpArrow',points:points.slice(0,1),style:{size:999}},
    {type:'FibRetracement',points:points.slice(0,2),style:{levels:[]}}])assert.throws(()=>types.validate(spec));
});
