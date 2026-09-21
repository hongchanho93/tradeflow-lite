import { mkdir, readdir, writeFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { startFormatBridge } from './user-data-format-bridge.mjs';
/** Generates only synthetic test files into a new/empty directory. No overwrite. */
export async function writeFormatFixtures(directory){
  await mkdir(directory,{recursive:true});if((await readdir(directory)).length)throw Error('format fixture directory must be empty');
  const bridge=await startFormatBridge();
  try{
    const files=await bridge.invoke('test_fixtures');
    if(files.length!==3)throw Error('unexpected native fixtures');
    for(const file of files){
      if(!['market.db','SH_600000.parquet','SZ_000001.parquet'].includes(file.name)||!Array.isArray(file.data)
        ||file.data.length>1024*1024||file.data.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('invalid native fixture');
      await writeFile(path.join(directory,file.name),new Uint8Array(file.data),{flag:'wx'});
    }
  }finally{await bridge.close();}
  return directory;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const target=fileURLToPath(new URL('../src-tauri/target/',import.meta.url));await mkdir(target,{recursive:true});
  const output=await mkdtemp(path.join(target,'format-examples-'));await writeFormatFixtures(output);
  console.log(`Synthetic SQLite/Parquet examples: ${output}`);
}
