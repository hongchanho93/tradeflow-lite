import { CapabilityError } from './contracts.ts';

// Pure value normalization; never sends color strings through HTML, CSS declarations or URL loaders.
const names: Readonly<Record<string, string>> = Object.freeze({
  black:'#000000',silver:'#c0c0c0',gray:'#808080',grey:'#808080',white:'#ffffff',maroon:'#800000',red:'#ff0000',purple:'#800080',
  fuchsia:'#ff00ff',magenta:'#ff00ff',green:'#008000',lime:'#00ff00',olive:'#808000',yellow:'#ffff00',navy:'#000080',blue:'#0000ff',
  teal:'#008080',aqua:'#00ffff',cyan:'#00ffff',orange:'#ffa500',gold:'#ffd700',pink:'#ffc0cb',brown:'#a52a2a',violet:'#ee82ee',
  indigo:'#4b0082',rebeccapurple:'#663399',transparent:'#00000000',
});
export function normalizeDrawingColor(input: unknown): string {
  if (typeof input !== 'string' || input.length > 128) throw new CapabilityError('invalid_request');
  const value=input.trim().toLowerCase();
  if (Object.hasOwn(names,value)) return names[value];
  if (/^#(?:[\da-f]{3}|[\da-f]{4})$/.test(value)) return '#'+[...value.slice(1)].map(c=>c+c).join('');
  if (/^#(?:[\da-f]{6}|[\da-f]{8})$/.test(value)) return value;
  const match=/^(rgb|rgba|hsl|hsla)\(([^()]+)\)$/.exec(value);
  if (!match) throw new CapabilityError('invalid_request');
  const parts=match[2].trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length<3||parts.length>4||parts.some(p=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(p))) throw new CapabilityError('invalid_request');
  const alpha=parts[3]===undefined?1:parseFloat(parts[3])/(parts[3].endsWith('%')?100:1);
  let rgb:number[];
  if (match[1].startsWith('rgb')) rgb=parts.slice(0,3).map(p=>parseFloat(p)*(p.endsWith('%')?255/100:1));
  else {
    if (!parts[1].endsWith('%')||!parts[2].endsWith('%')) throw new CapabilityError('invalid_request');
    const hue=((Number(parts[0])%360)+360)%360,s=parseFloat(parts[1])/100,l=parseFloat(parts[2])/100;
    if (s<0||s>1||l<0||l>1) throw new CapabilityError('invalid_request');
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;
    const sector=Math.floor(hue/60);rgb=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][sector].map(v=>(v+m)*255);
  }
  if (!rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255)||!Number.isFinite(alpha)||alpha<0||alpha>1) throw new CapabilityError('invalid_request');
  return '#'+[...rgb,...(alpha<1?[alpha*255]:[])].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
}

export const DRAWING_COLOR_FIELDS = ['color','fill','textColor','middleColor','riskColor','targetColor','riskFill','targetFill'] as const;
