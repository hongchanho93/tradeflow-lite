/** Editable reference formats, not a required user storage layout. */
export const SQLITE_CONNECTOR_SOURCE = String.raw`// Stable SQLite snapshot; example schema only. Adapt the query to YOUR tables.
// daily_bars(symbol,time,open,high,low,close,volume), Unix seconds, raw daily prices.
// Ordered oldest to newest with keyset continuation; never claim this is latest.
function cursor(value){
  if(!value)return {};
  const c=JSON.parse(value);
  if(!c||typeof c.revision!=='string'||Object.keys(c).some(k=>k!=='after'&&k!=='revision'))throw Error('Invalid cursor');
  return c;
}
defineConnector({formatVersion:1,apiVersion:1,id:'example.sqlite-daily',version:1,name:'SQLite 日线参考接入',
  description:'只读 market.db 的 daily_bars 示例表；真实库应按实际表名、字段、时间和复权修改接入代码。',
  supports:{venues:['SH','SZ','BJ'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
  *listSymbols(q,io){
    const c=cursor(q.cursor);if(c.after!==undefined&&typeof c.after!=='string')throw Error('Invalid symbol cursor');
    const r=yield io.sqlite('market.db',{sql:'SELECT DISTINCT symbol FROM daily_bars WHERE symbol > ?1 ORDER BY symbol',parameters:[c.after??''],limit:q.limit,fileRevision:c.revision});
    const symbols=r.rows.map(row=>({symbol:row[0],name:row[0],kind:'stock'}));
    return {symbols,nextCursor:r.truncated?JSON.stringify({after:symbols[symbols.length-1].symbol,revision:r.revision}):null};
  },
  *getHistory(q,io){
    const c=cursor(q.cursor);if(c.after!==undefined&&!Number.isSafeInteger(c.after))throw Error('Invalid time cursor');
    const r=yield io.sqlite('market.db',{sql:'SELECT time,open,high,low,close,volume FROM daily_bars WHERE symbol=?1 AND time>?2 ORDER BY time',parameters:[q.symbol,c.after??-9007199254740991],limit:q.count,fileRevision:c.revision});
    const bars=r.rows.map(v=>({time:v[0],open:v[1],high:v[2],low:v[3],close:v[4],volume:v[5]}));
    return {seriesKind:'ohlcv',bars,nextCursor:r.truncated?JSON.stringify({after:bars[bars.length-1].time,revision:r.revision}):null};
  }
});`;

export const PARQUET_CONNECTOR_SOURCE = String.raw`// One file per symbol: SH_600000.parquet. This is a reference, not a format requirement.
// Columns: time/open/high/low/close/volume; ascending raw daily OHLCV.
// time: annotated timestamp ns/us/ms, DATE days, or unannotated Unix seconds.
// Native reader keeps exact integers. Convert timestamp units before Number().
function seconds(value,type){
  const raw=typeof value==='object'&&value&&value.type==='integer'?value.value:value;
  if(typeof raw==='number'?!Number.isSafeInteger(raw):typeof raw!=='string'||!/^[-]?\d+$/.test(raw))throw Error('Missing or invalid integer timestamp');
  const n=BigInt(raw);
  const meta=String(type).toLowerCase();
  const unit=meta.includes('timestamp')?(meta.includes('nanos')?1000000000n:meta.includes('micros')?1000000n:meta.includes('millis')?1000n:0n):1n;
  if(!unit)throw Error('Unknown timestamp unit');
  const date=meta.includes('converted_type: date')||meta.includes('logical_type: some(date)');
  // Bar time has second precision. Reject duplicates/order errors below, never merge silently.
  const whole=date?n*86400n:n/unit-(n<0n&&n%unit!==0n?1n:0n);
  const result=Number(whole);if(!Number.isSafeInteger(result))throw Error('Timestamp out of range');return result;
}
defineConnector({formatVersion:1,apiVersion:1,id:'example.parquet-daily',version:1,name:'Parquet 日线参考接入',
  description:'只读每品种一个 Parquet 文件；按原文件顺序分页。表名、字段、分区和时间规则需要按真实数据适配。',
  supports:{venues:['SH','SZ','BJ'],kinds:['stock'],resolutions:['1D'],adjustments:['none']},
  *listSymbols(q,io){
    const page=yield io.list('',q.cursor,q.limit),symbols=[];
    for(const entry of page.entries){const match=/^(SH|SZ|BJ)_([A-Z0-9._-]+)\.parquet$/.exec(entry.name);
      if(match&&(entry.kind==='file'||entry.kind==='link'))symbols.push({symbol:match[1]+':'+match[2],name:entry.name,kind:'stock'});}
    return {symbols,nextCursor:page.next};
  },
  *getHistory(q,io){
    const c=q.cursor?JSON.parse(q.cursor):{offset:0};
    if(!c||!Number.isSafeInteger(c.offset)||c.offset<0||Object.keys(c).some(k=>!['offset','revision','lastTime'].includes(k))
      ||(q.cursor&&(typeof c.revision!=='string'||!Number.isSafeInteger(c.lastTime))))throw Error('Invalid history cursor');
    const r=yield io.parquet(q.symbol.replace(':','_')+'.parquet',{offset:c.offset,limit:q.count,columns:['time','open','high','low','close','volume'],fileRevision:c.revision});
    let previous=c.lastTime??-Infinity;
    const bars=r.rows.map(v=>{const time=seconds(v[0],r.types[0]);if(time<=previous)throw Error('Source time order/second precision mismatch');previous=time;
      return {time,open:v[1],high:v[2],low:v[3],close:v[4],volume:v[5]};});
    return {seriesKind:'ohlcv',bars,nextCursor:r.nextOffset===undefined?null:JSON.stringify({offset:r.nextOffset,revision:r.revision,lastTime:previous})};
  }
});`;
