import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { writeFormatFixtures } from './write-format-fixtures.mjs';
import { SQLITE_CONNECTOR_SOURCE, PARQUET_CONNECTOR_SOURCE } from '../src/user-data/format-examples.ts';

export async function createFormatDesktopCases({dataCases,command,test,capture,requests}){
  const records=[],hashes=new Map();
  const task=(op,args={})=>command('user-task',{op,...args});
  return {
    async setup(port){
      for(const [format,source,taskFile] of [['sqlite',SQLITE_CONNECTOR_SOURCE,'window-breakout.tft'],['parquet',PARQUET_CONNECTOR_SOURCE,'sma-backtest.tft']]){
        const directory=`formats-${format}`,folder=path.join(dataCases.fixtureRoot,directory);await writeFormatFixtures(folder);
        for(const name of ['market.db','SH_600000.parquet','SZ_000001.parquet']){
          const filename=path.join(folder,name);hashes.set(filename,createHash('sha256').update(await readFile(filename)).digest('hex'));
        }
        let row,run,saved;
        await test(`${format}: real native picker and ordinary Connector import use the existing directory/Worker boundary`,async()=>{
          const count=requests();row=await dataCases.select(port,directory);await dataCases.probe('import',{sourceId:row.id,source});
          const verified=await dataCases.probe('format-verify',{sourceId:row.id,format});assert.equal(verified.rows,5);assert.equal(requests(),count);
        });
        await test(`${format}: shipped research task renders five-row inputs, result artifacts and a corresponding chart`,async()=>{
          const source=await readFile(new URL('../examples/user-research/'+taskFile,import.meta.url),'utf8');
          run=await task('run',{sourceId:row.id,source});assert.equal(run.processed,2);
          assert.deepEqual(await task('format-results',{taskId:run.taskId}),{rows:2,chartOpened:true,localSource:true});
          await task('layout',{taskId:run.taskId,width:520});await capture(`format-${format}-result`,port);
        });
        await test(`${format}: the successful task is saved into the same dynamic tool catalog`,async()=>{
          saved=await task('save',{taskId:run.taskId});assert.equal(saved.status,'ready');
        });
        records.push({format,sourceId:row.id,taskDefinitionId:saved.id});
        await dataCases.probe('handoff',{sourceId:row.id});
      }
    },
    async afterRestart(){
      for(const row of records)await test(`${row.format}: real process restart restores Connector and saved Task without automatic execution`,async()=>{
        assert.equal((await dataCases.probe('format-verify',row)).rows,5);
        assert.deepEqual(await task('restored',{taskDefinitionId:row.taskDefinitionId}),{restored:true,removed:true});
      });
      for(const [filename,hash] of hashes)assert.equal(createHash('sha256').update(await readFile(filename)).digest('hex'),hash);
    },
  };
}
