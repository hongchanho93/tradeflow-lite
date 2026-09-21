// Test-only Rust binary protocol; never used by the production application.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const home=userInfo().homedir;
const env={...process.env,CARGO_HOME:process.env.CARGO_HOME??path.join(home,'.cargo'),RUSTUP_HOME:process.env.RUSTUP_HOME??path.join(home,'.rustup')};
let building;
export function buildFormatBridge(){
  return building??=new Promise((resolve,reject)=>{
    const process=spawn('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--lib','--no-run','--locked','--offline','--message-format=json'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let executable,stderr='';const timer=setTimeout(()=>{process.kill('SIGTERM');reject(Error('native test build timeout'));},600000);
    const lines=createInterface({input:process.stdout});
    lines.on('line',line=>{try{const m=JSON.parse(line);if(m.reason==='compiler-artifact'&&m.target?.name==='tradeflow_lite_lib'&&m.executable)executable=m.executable;}catch{}});
    process.stderr.on('data',b=>{stderr=(stderr+b).slice(-12000);});
    process.once('error',error=>{clearTimeout(timer);reject(error);});
    process.once('exit',code=>{clearTimeout(timer);lines.close();code===0&&executable?resolve(executable):reject(Error(`native test build failed (${code}): ${stderr}`));});
  });
}
export async function startFormatBridge({binary}={}){
  binary??=await buildFormatBridge();
  const process=spawn(binary,['--ignored','--exact','user_data::state::tests::format_bridge','--nocapture','--test-threads=1'],{cwd:root,env,stdio:['pipe','pipe','pipe']});
  let sequence=0,stderr='',resolveReady,rejectReady;const pending=new Map();
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const exited=new Promise(resolve=>process.once('exit',(code,signal)=>resolve({code,signal})));
  const lines=createInterface({input:process.stdout});
  const startup=setTimeout(()=>{process.kill('SIGTERM');rejectReady(Error('native bridge startup timeout'));},30000);
  const fail=error=>{clearTimeout(startup);rejectReady(error);for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  process.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
  lines.on('line',line=>{
    try{
      const start=line.indexOf('TF_FORMAT_READY ');if(start>=0){clearTimeout(startup);resolveReady(JSON.parse(line.slice(start+16)));return;}
      if(!line.startsWith('TF_FORMAT_REPLY '))return;
      const message=JSON.parse(line.slice(16)),p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);
      message.error?p.reject(message.error):p.resolve(message.value);
    }catch(error){fail(error);}
  });
  process.once('error',fail);process.once('exit',(code,signal)=>{lines.close();fail(Error(`native bridge exited ${code}/${signal}: ${stderr}`));});
  const info=await ready;
  return {info,
    invoke(command,args={}){return new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('native fixture request timeout'));},35000);
      pending.set(id,{resolve,reject,timer});process.stdin.write(JSON.stringify({id,command,args})+'\n');
    });},
    async close(){process.stdin.end(JSON.stringify({id:++sequence,command:'quit',args:{}})+'\n');
      const timer=setTimeout(()=>process.kill('SIGTERM'),10000);const result=await exited;clearTimeout(timer);
      if(result.code!==0||result.signal)throw Error(`native fixture did not exit normally: ${JSON.stringify(result)} ${stderr}`);
    },
  };
}
