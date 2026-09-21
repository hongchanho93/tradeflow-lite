import { CapabilityError, type JsonValue } from './contracts.ts';
import { DRAWING_COLOR_FIELDS, normalizeDrawingColor } from './drawing-colors.ts';

type Mapping = Readonly<Record<string, readonly string[]>>;
const line: Mapping = { color:['line.color'],lineWidth:['line.width'] };
const box = (key:string): Mapping => ({color:[`${key}.border.color`],lineWidth:[`${key}.border.width`],fill:[`${key}.background.color`]});
/** The sole mapping from flat business styles to trusted, installed native option paths. */
const mappings: Readonly<Record<string,Mapping>> = {
  TrendLine:line,Ray:line,Arrow:line,ExtendedLine:line,HorizontalLine:line,HorizontalRay:line,VerticalLine:line,CrossLine:line,
  Brush:line,Highlighter:line,Path:line,
  Text:{text:['text.value'],color:['text.font.color'],fontSize:['text.font.size']},
  Callout:{...line,text:['text.value'],textColor:['text.font.color'],fontSize:['text.font.size'],fill:['text.box.background.color']},
  Rectangle:box('rectangle'),Circle:box('circle'),Triangle:box('triangle'),
  ParallelChannel:{color:['channelLine.color'],lineWidth:['channelLine.width'],middleColor:['middleLine.color'],fill:['background.color']},
  FibRetracement:{lineWidth:['line.width']},
  PriceRange:{...box('priceRange.rectangle'),color:['priceRange.rectangle.border.color','priceRange.verticalLine.color','priceRange.horizontalLine.color']},
  LongShortPosition:{riskColor:['entryStopLossRectangle.border.color'],targetColor:['entryPtRectangle.border.color'],
    riskFill:['entryStopLossRectangle.background.color'],targetFill:['entryPtRectangle.background.color'],
    lineWidth:['entryStopLossRectangle.border.width','entryPtRectangle.border.width']},
  UpArrow:{color:['arrow.color'],size:['arrow.size'],opacity:['arrow.opacity']},
};
const colorFields = new Set<string>(DRAWING_COLOR_FIELDS);
const readPath = (value:any,path:string) => path.split('.').reduce((node,key)=>node?.[key],value);
function setPath(value:any,path:string,result:unknown):void {
  const keys=path.split('.');let target=value;
  for(const key of keys.slice(0,-1)){target[key]??={};target=target[key];}
  target[keys.at(-1)!]=result;
}
export function defaultDrawingStyle(type:string):Record<string,JsonValue> {
  if(type==='Text')return {color:'#d1d4dc',fontSize:12,visible:true};
  if(type==='UpArrow')return {color:'#089981',size:34,opacity:1,visible:true};
  if(type==='LongShortPosition')return {riskColor:'#ff0000',targetColor:'#00ff00',riskFill:'#ff000033',targetFill:'#00800033',lineWidth:2,visible:true};
  if(type==='FibRetracement')return {lineWidth:2,visible:true,levels:[0,0.236,0.382,0.5,0.618,0.786,1,1.618,2.618,3.618,4.236].map(coeff=>({coeff,color:'#2962ff',opacity:0}))};
  const style:Record<string,JsonValue>={color:type==='Highlighter'?'#ffff0066':'#2962ff',lineWidth:type==='Highlighter'?20:2,visible:true};
  if(['Rectangle','Circle','Triangle','PriceRange','ParallelChannel','Callout'].includes(type))style.fill='#2962ff22';
  if(type==='ParallelChannel')style.middleColor='#2962ff';
  if(type==='Callout'){style.textColor='#ffffff';style.fontSize=14;}
  return style;
}
export function readNativeStyle(type:string,options:Record<string,any>):Record<string,JsonValue> {
  const mapping=mappings[type];if(!mapping)throw new CapabilityError('drawing_unavailable');
  const style:Record<string,JsonValue>={visible:options.visible!==false};
  for(const [field,paths] of Object.entries(mapping)){
    const value=readPath(options,paths[0]);style[field]=colorFields.has(field)?normalizeDrawingColor(value):value;
  }
  if(type==='FibRetracement') {
    if(!Array.isArray(options.levels))throw new CapabilityError('drawing_host_failed');
    style.levels=options.levels.map((level:any)=>({coeff:level.coeff,color:normalizeDrawingColor(level.color),opacity:level.opacity??0}));
  }
  return style;
}
export function writeNativeStyle(type:string,style:Readonly<Record<string,JsonValue>>,before:Record<string,any>):Record<string,any> {
  const mapping=mappings[type];if(!mapping)throw new CapabilityError('drawing_unavailable');
  const options=JSON.parse(JSON.stringify(before));options.visible=style.visible;
  for(const [field,paths] of Object.entries(mapping))for(const path of paths)setPath(options,path,style[field]);
  if(type==='FibRetracement')options.levels=(style.levels as Record<string,JsonValue>[]).map(level=>({
    ...(Array.isArray(before.levels)?before.levels.find((old:any)=>old.coeff===level.coeff):{}),
    distanceFromCoeffEnabled:false,distanceFromCoeff:0,...level,opacity:level.opacity??0,
  }));
  return options;
}
